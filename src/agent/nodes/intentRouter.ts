import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { InputPayloadSchema } from "../../core/contracts/schemas";
import type {
  DisambiguationCandidate,
  InputPayload,
  PendingDisambiguation,
  ResolvedTarget,
  SpecialistRoute,
} from "../../core/contracts/types";
import { InvoicesRepository } from "../../core/db/repositories/invoicesRepo";
import { JobsRepository } from "../../core/db/repositories/jobsRepo";
import { QuotesRepository } from "../../core/db/repositories/quotesRepo";
import { ClientsRepository } from "../../core/db/repositories/clientsRepo";
import { getLocalTodayIso } from "../../core/fiscal/dateQuarter";
import {
  isCancelUtterance,
  normalizeSpanishText,
} from "../inference/deterministicSpanishParser";
import { getSeedOverride, type GraphDependencies } from "../ports";
import type { ObraLocalGraphState, ObraLocalGraphUpdate } from "../state";

const ORDINAL_WORDS: Array<[RegExp, number]> = [
  [/\b(1|primero|primera|el primero|la primera|uno)\b/, 0],
  [/\b(2|segundo|segunda|el segundo|la segunda|dos)\b/, 1],
  [/\b(3|tercero|tercera|el tercero|la tercera|tres)\b/, 2],
  [/\b(4|cuarto|cuarta|cuatro)\b/, 3],
  [/\b(5|quinto|quinta|cinco)\b/, 4],
];

function scoreCandidate(text: string, cand: DisambiguationCandidate, idx: number): number {
  const normText = normalizeSpanishText(text);
  const normLabel = normalizeSpanishText(cand.label);
  const normSub = normalizeSpanishText(cand.subtitle ?? "");

  for (const [rx, targetIdx] of ORDINAL_WORDS) {
    if (idx === targetIdx && rx.test(normText)) {
      return 0.9;
    }
  }

  if (cand.action_choice === "scan_ticket" && /\b(ticket|gasto|compra|factura)\b/.test(normText)) {
    return 0.9;
  }
  if (cand.action_choice === "site_log" && /\b(diario|obra|foto|avance)\b/.test(normText)) {
    return 0.9;
  }
  if (
    cand.action_choice === "edit_existing_quote" &&
    /\b(editar|reeditar|actualizar|existente|mismo)\b/.test(normText)
  ) {
    return 0.88;
  }
  if (
    cand.action_choice === "create_annex_job" &&
    /\b(nueva|anexa|anexo|otra obra|crear obra)\b/.test(normText)
  ) {
    return 0.88;
  }

  if (normText.length >= 3 && (normLabel.includes(normText) || normText.includes(normLabel))) {
    return 0.92;
  }

  const queryTokens = normText.split(/\s+/).filter((t) => t.length >= 2);
  const labelTokens = `${normLabel} ${normSub}`.split(/\s+/).filter((t) => t.length >= 2);
  if (queryTokens.length === 0 || labelTokens.length === 0) {
    return 0;
  }

  let matches = 0;
  for (const qt of queryTokens) {
    if (labelTokens.some((lt) => lt === qt || lt.startsWith(qt) || qt.startsWith(lt))) {
      matches += 1;
    }
  }
  const denom = Math.max(queryTokens.length, 1);
  return matches / denom;
}

function mergeTarget(
  preserved: ResolvedTarget | undefined,
  cand: DisambiguationCandidate
): ResolvedTarget {
  return {
    client_id: cand.client_id ?? preserved?.client_id,
    job_id: cand.job_id ?? preserved?.job_id,
    quote_id: cand.quote_id ?? preserved?.quote_id,
    catalog_item_id: cand.catalog_item_id ?? preserved?.catalog_item_id,
    action_choice: cand.action_choice ?? preserved?.action_choice,
  };
}

export function createIntentRouterNode(deps: GraphDependencies) {
  const jobsRepo = new JobsRepository(deps.executor);
  const quotesRepo = new QuotesRepository(deps.executor);
  const clientsRepo = new ClientsRepository(deps.executor);
  const invoicesRepo = new InvoicesRepository(deps.executor);

  return async function intentRouterNode(
    state: ObraLocalGraphState,
    config?: LangGraphRunnableConfig
  ): Promise<ObraLocalGraphUpdate> {
    const rawInput = state.input_payload ?? {
      client_turn_id: `turn_${crypto.randomUUID().slice(0, 8)}`,
      text: "",
      action_type: "free_text_or_voice" as const,
    };
    const input = InputPayloadSchema.parse(rawInput);
    const seedOverride = getSeedOverride(config);
    const now = Date.now();
    const traceId = seedOverride?.traceIdOverride ?? `tr_${crypto.randomUUID().slice(0, 12)}`;

    // Sincronización de vencimientos antes de leer
    await invoicesRepo.syncOverdueOnRead(getLocalTodayIso());

    // Sincronización y validación de session_context
    let activeJobId =
      input.session_context !== undefined ? input.session_context.active_job_id : state.active_job_id;
    let activeQuoteId =
      input.session_context !== undefined
        ? input.session_context.active_quote_id
        : state.active_quote_id;

    if (activeJobId) {
      const job = await jobsRepo.getById(activeJobId);
      if (!job) {
        activeJobId = null;
        activeQuoteId = null;
      }
    } else {
      activeQuoteId = null;
    }

    if (activeQuoteId && activeJobId) {
      const quote = await quotesRepo.getById(activeQuoteId);
      if (!quote || quote.job_id !== activeJobId) {
        activeQuoteId = null;
      }
    }

    const baseReset = {
      active_job_id: activeJobId,
      active_quote_id: activeQuoteId,
      rag_snippets: [],
      extracted_entities: null as Record<string, unknown> | null,
      active_widget: null,
      quick_actions: null,
      pending_gate: null,
      disambiguation_exhausted: false,
      input_payload: input,
    };

    const makeTrace = (
      inferenceEngine:
        | "deterministic_rule_engine"
        | "mediapipe_local_llm"
        | "mediapipe_fallback_deterministic" = "deterministic_rule_engine"
    ) => ({
      turn_id: input.client_turn_id,
      trace_id: traceId,
      parent_trace_id: null,
      started_at_ms: now,
      append_node: "intent_router",
      inference_engine: inferenceEngine,
      rag_hit_count: 0,
      error_code: null,
      rejection_reason: null,
      cloud_cost_eur: 0 as const,
    });

    // Atajo determinista para semillas / recuperación de borrador
    if (
      seedOverride?.quoteFixtureOverride ||
      seedOverride?.recoveredDraftOverride?.pending_gate === "gate_1_quote"
    ) {
      return {
        ...baseReset,
        routed_intent: "quote_specialist",
        turn_trace: makeTrace(),
      };
    }
    if (
      seedOverride?.ocrFixtureOverride ||
      seedOverride?.recoveredDraftOverride?.pending_gate === "gate_2_ticket"
    ) {
      return {
        ...baseReset,
        routed_intent: "ocr_ticket_specialist",
        turn_trace: makeTrace(),
      };
    }

    let pending: PendingDisambiguation | null = state.pending_disambiguation;

    // --- PRIORIDAD 1: Desambiguación activa ---
    if (pending !== null) {
      const isDistinctExplicit =
        input.action_type !== "free_text_or_voice" &&
        input.action_type !== "resolve_disambiguation";
      const isNewPhoto =
        input.action_type === "free_text_or_voice" && input.raw_media_uri != null;

      if (isDistinctExplicit || isNewPhoto) {
        await deps.fileBridge.deleteIfTemp(pending.raw_media_uri ?? null);
        pending = null;
      } else if (input.action_type === "free_text_or_voice" && isCancelUtterance(input.text)) {
        await deps.fileBridge.deleteIfTemp(pending.raw_media_uri ?? null);
        return {
          ...baseReset,
          pending_disambiguation: null,
          routed_intent: "assistant_qa_node",
          extracted_entities: { cancelled_disambiguation: true },
          turn_trace: makeTrace(),
        };
      } else if (input.action_type === "resolve_disambiguation") {
        const chosen = pending.candidates.find(
          (c) =>
            (input.disambiguation_choice && c.action_choice === input.disambiguation_choice) ||
            (input.target_ids?.job_id && c.job_id === input.target_ids.job_id) ||
            (input.target_ids?.client_id && c.client_id === input.target_ids.client_id) ||
            (input.target_ids?.quote_id && c.quote_id === input.target_ids.quote_id) ||
            (input.target_ids?.catalog_item_id &&
              c.catalog_item_id === input.target_ids.catalog_item_id)
        );
        const syntheticCand: DisambiguationCandidate = chosen ?? {
          entity_type: "intent_action",
          id: "manual_choice",
          label: "Selección",
          job_id: input.target_ids?.job_id,
          client_id: input.target_ids?.client_id,
          quote_id: input.target_ids?.quote_id,
          catalog_item_id: input.target_ids?.catalog_item_id,
          action_choice: input.disambiguation_choice,
        };
        const resolvedTarget = mergeTarget(pending.preserved_target, syntheticCand);
        const restoredInput: InputPayload = {
          ...input,
          text: pending.original_text,
          raw_media_uri: pending.raw_media_uri ?? input.raw_media_uri,
        };
        let nextRoute: SpecialistRoute = pending.original_intent ?? "assistant_qa_node";
        if (resolvedTarget.action_choice === "open_job_overview") {
          nextRoute = "lifecycle_billing_specialist";
          restoredInput.billing_sub_intent = "overview";
        } else if (pending.original_intent === null) {
          nextRoute =
            resolvedTarget.action_choice === "scan_ticket"
              ? "ocr_ticket_specialist"
              : "site_log_specialist";
        }
        return {
          ...baseReset,
          input_payload: restoredInput,
          pending_disambiguation: null,
          routed_intent: nextRoute,
          extracted_entities: { resolved_target: resolvedTarget },
          turn_trace: makeTrace(),
        };
      } else {
        // Caso B: Voz/texto libre evaluado frente a candidatos
        const scored = pending.candidates
          .map((cand, idx) => ({ cand, score: scoreCandidate(input.text, cand, idx) }))
          .sort((a, b) => b.score - a.score);
        const top = scored[0];
        const second = scored[1];
        if (
          top &&
          top.score >= 0.65 &&
          (scored.length === 1 || top.score - (second?.score ?? 0) >= 0.25)
        ) {
          const resolvedTarget = mergeTarget(pending.preserved_target, top.cand);
          const restoredInput: InputPayload = {
            ...input,
            text: pending.original_text,
            raw_media_uri: pending.raw_media_uri ?? input.raw_media_uri,
          };
          let nextRoute: SpecialistRoute = pending.original_intent ?? "assistant_qa_node";
          if (resolvedTarget.action_choice === "open_job_overview") {
            nextRoute = "lifecycle_billing_specialist";
            restoredInput.billing_sub_intent = "overview";
          } else if (pending.original_intent === null) {
            nextRoute =
              resolvedTarget.action_choice === "scan_ticket"
                ? "ocr_ticket_specialist"
                : "site_log_specialist";
          }
          return {
            ...baseReset,
            input_payload: restoredInput,
            pending_disambiguation: null,
            routed_intent: nextRoute,
            extracted_entities: { resolved_target: resolvedTarget },
            turn_trace: makeTrace(),
          };
        }

        // Caso C: Cambio de tema de alta confianza
        const topicCheck = await deps.inference.classifyAndExtract({
          text: input.text,
          activeJobId,
          activeQuoteId,
          pendingDisambiguation: null,
          catalogCandidates: [],
        });
        if (topicCheck.confidence >= 0.8 && topicCheck.intent !== "clarification_node") {
          await deps.fileBridge.deleteIfTemp(pending.raw_media_uri ?? null);
          return {
            ...baseReset,
            pending_disambiguation: null,
            routed_intent: topicCheck.intent,
            extracted_entities: topicCheck.entities,
            turn_trace: makeTrace(topicCheck.engine_used),
          };
        }

        // Caso D / Caso E
        if (pending.attempts === 0) {
          return {
            ...baseReset,
            pending_disambiguation: {
              ...pending,
              attempts: 1,
            },
            routed_intent: "clarification_node",
            turn_trace: makeTrace(),
          };
        }

        await deps.fileBridge.deleteIfTemp(pending.raw_media_uri ?? null);
        return {
          ...baseReset,
          pending_disambiguation: null,
          disambiguation_exhausted: true,
          routed_intent: "assistant_qa_node",
          extracted_entities: {
            disambiguation_exhausted_candidates: pending.candidates,
          },
          turn_trace: makeTrace(),
        };
      }
    }

    // --- PRIORIDAD 2: Foto directa en chat sin texto inequívoco ---
    if (input.action_type === "free_text_or_voice" && input.raw_media_uri != null) {
      if (input.text.trim().length > 0) {
        const photoCheck = await deps.inference.classifyAndExtract({
          text: input.text,
          activeJobId,
          activeQuoteId,
          pendingDisambiguation: null,
          catalogCandidates: [],
        });
        if (
          photoCheck.confidence >= 0.8 &&
          (photoCheck.intent === "ocr_ticket_specialist" ||
            photoCheck.intent === "site_log_specialist")
        ) {
          return {
            ...baseReset,
            pending_disambiguation: null,
            routed_intent: photoCheck.intent,
            extracted_entities: photoCheck.entities,
            turn_trace: makeTrace(photoCheck.engine_used),
          };
        }
      }

      const photoPending: PendingDisambiguation = {
        original_intent: null,
        original_text: input.text,
        raw_media_uri: input.raw_media_uri,
        prompt: "Has adjuntado una fotografía. ¿Quieres escanearla como ticket de gasto o guardarla en el diario de obra?",
        candidates: [
          {
            entity_type: "intent_action",
            id: "act_scan_ticket",
            label: "Escanear como ticket de gasto",
            action_choice: "scan_ticket",
          },
          {
            entity_type: "intent_action",
            id: "act_site_log",
            label: "Guardar en diario de obra",
            action_choice: "site_log",
          },
        ],
        attempts: 0,
      };
      return {
        ...baseReset,
        pending_disambiguation: photoPending,
        routed_intent: "clarification_node",
        turn_trace: makeTrace(),
      };
    }

    // --- PRIORIDAD 3: action_type explícito ---
    if (input.action_type !== "free_text_or_voice") {
      if (input.action_type === "scan_ticket" || input.action_type === "manual_ticket_entry") {
        return {
          ...baseReset,
          pending_disambiguation: null,
          routed_intent: "ocr_ticket_specialist",
          turn_trace: makeTrace(),
        };
      }
      if (input.action_type === "start_empty_quote" || input.action_type === "start_job_quote") {
        return {
          ...baseReset,
          pending_disambiguation: null,
          routed_intent: "quote_specialist",
          turn_trace: makeTrace(),
        };
      }
      if (
        input.action_type === "request_invoice_gate" ||
        input.action_type === "request_advance_gate" ||
        input.action_type === "request_share_gate" ||
        input.action_type === "open_job_overview"
      ) {
        return {
          ...baseReset,
          pending_disambiguation: null,
          routed_intent: "lifecycle_billing_specialist",
          turn_trace: makeTrace(),
        };
      }
      if (input.action_type === "open_fiscal_piggybank") {
        return {
          ...baseReset,
          pending_disambiguation: null,
          routed_intent: "fiscal_piggybank_specialist",
          turn_trace: makeTrace(),
        };
      }
      if (input.action_type === "open_schedule_log") {
        return {
          ...baseReset,
          pending_disambiguation: null,
          routed_intent: "schedule_specialist",
          turn_trace: makeTrace(),
        };
      }
      if (input.action_type === "resolve_disambiguation") {
        // Chip huérfano cuando pending_disambiguation ya es null
        const t = input.target_ids ?? {};
        let exists = false;
        if (t.job_id) {
          exists = (await jobsRepo.getById(t.job_id)) !== null;
        } else if (t.quote_id) {
          exists = (await quotesRepo.getById(t.quote_id)) !== null;
        } else if (t.client_id) {
          exists = (await clientsRepo.getById(t.client_id)) !== null;
        }
        if (!exists) {
          return {
            ...baseReset,
            pending_disambiguation: null,
            routed_intent: "assistant_qa_node",
            extracted_entities: { expired_disambiguation: true },
            turn_trace: makeTrace(),
          };
        }
        const choice = input.disambiguation_choice;
        let route: SpecialistRoute = "lifecycle_billing_specialist";
        if (choice === "edit_existing_quote" || choice === "create_annex_job") {
          route = "quote_specialist";
        } else if (choice === "site_log") {
          route = "site_log_specialist";
        } else if (choice === "scan_ticket") {
          route = "ocr_ticket_specialist";
        }
        const resolvedTarget: ResolvedTarget = {
          client_id: t.client_id,
          job_id: t.job_id,
          quote_id: t.quote_id,
          catalog_item_id: t.catalog_item_id,
          action_choice: choice ?? "open_job_overview",
        };
        return {
          ...baseReset,
          pending_disambiguation: null,
          routed_intent: route,
          extracted_entities: { resolved_target: resolvedTarget },
          turn_trace: makeTrace(),
        };
      }
    }

    // --- PRIORIDAD 4: Clasificación híbrida LocalInferenceAdapter ---
    const inferred = await deps.inference.classifyAndExtract({
      text: input.text,
      activeJobId,
      activeQuoteId,
      pendingDisambiguation: null,
      catalogCandidates: [],
    });

    if (inferred.intent === "clarification_node") {
      const clarifPending: PendingDisambiguation = {
        original_intent: null,
        original_text: input.text,
        prompt:
          "No he podido identificar con seguridad la acción. Elige qué quieres hacer o indícalo con más detalle:",
        candidates: [
          {
            entity_type: "intent_action",
            id: "act_open_quote",
            label: "Crear presupuesto",
            action_choice: "edit_existing_quote",
          },
          {
            entity_type: "intent_action",
            id: "act_open_ticket",
            label: "Registrar ticket/gasto",
            action_choice: "scan_ticket",
          },
          {
            entity_type: "intent_action",
            id: "act_open_sitelog",
            label: "Añadir al diario de obra",
            action_choice: "site_log",
          },
        ],
        attempts: 0,
      };
      return {
        ...baseReset,
        pending_disambiguation: clarifPending,
        routed_intent: "clarification_node",
        extracted_entities: inferred.entities,
        turn_trace: makeTrace(inferred.engine_used),
      };
    }

    return {
      ...baseReset,
      pending_disambiguation: null,
      routed_intent: inferred.intent,
      extracted_entities: inferred.entities,
      turn_trace: makeTrace(inferred.engine_used),
    };
  };
}
