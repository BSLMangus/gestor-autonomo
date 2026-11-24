import { AIMessage } from "@langchain/core/messages";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { TEXT_LIMITS, truncateText } from "../../core/contracts/textLimits";
import type {
  ActiveWidgetEnvelope,
  Gate1QuoteDraftPayload,
  PendingDisambiguation,
  PendingSlotFill,
  QuickAction,
  RagSnippet,
  ResolvedTarget,
} from "../../core/contracts/types";
import { CatalogRepository } from "../../core/db/repositories/catalogRepo";
import { ClientsRepository } from "../../core/db/repositories/clientsRepo";
import { JobsRepository } from "../../core/db/repositories/jobsRepo";
import { QuotesRepository } from "../../core/db/repositories/quotesRepo";
import { SettingsRepository } from "../../core/db/repositories/settingsRepo";
import {
  computeQuoteTotals,
  formatCentsEs,
  parseQuotePaymentMethodsJson,
  parseQuotePaymentScheduleJson,
} from "../../core/fiscal/fiscalEngine";
import {
  normalizeSpanishText,
  type ParsedQuoteLine,
} from "../inference/deterministicSpanishParser";
import { getSeedOverride, type GraphDependencies } from "../ports";
import type { ObraLocalGraphState, ObraLocalGraphUpdate } from "../state";

function buildQuoteEnvelope(draft: Gate1QuoteDraftPayload): ActiveWidgetEnvelope {
  const totals = computeQuoteTotals(draft.lines, draft.vat_rate);
  return {
    ui_widget_type: "QuoteBuilderWidget",
    widget_payload: {
      ...draft,
      subtotal_cents: totals.subtotalCents,
      vat_cents: totals.vatCents,
      total_cents: totals.totalCents,
    },
  };
}

export function createQuoteSpecialistNode(deps: GraphDependencies) {
  const clientsRepo = new ClientsRepository(deps.executor);
  const catalogRepo = new CatalogRepository(deps.executor);
  const jobsRepo = new JobsRepository(deps.executor);
  const quotesRepo = new QuotesRepository(deps.executor);
  const settingsRepo = new SettingsRepository(deps.executor);

  return async function quoteSpecialistNode(
    state: ObraLocalGraphState,
    config?: LangGraphRunnableConfig
  ): Promise<ObraLocalGraphUpdate> {
    const seedOverride = getSeedOverride(config);
    const input = state.input_payload;

    // Semilla o borrador rescatado directo
    if (seedOverride?.quoteFixtureOverride) {
      const ov = seedOverride.quoteFixtureOverride;
      const widget = buildQuoteEnvelope(ov.proposed_payload);
      return {
        routed_intent: "quote_specialist",
        active_widget: widget,
        pending_gate: "gate_1_quote",
        messages: [new AIMessage(ov.summary_es)],
        turn_trace: { append_node: "quote_specialist" },
      };
    }

    if (seedOverride?.recoveredDraftOverride?.pending_gate === "gate_1_quote") {
      const rec = seedOverride.recoveredDraftOverride;
      const draft = rec.proposed_payload as Gate1QuoteDraftPayload;
      const widget = buildQuoteEnvelope(draft);
      return {
        routed_intent: "quote_specialist",
        active_widget: widget,
        pending_gate: "gate_1_quote",
        messages: [new AIMessage(rec.summary_es)],
        turn_trace: { append_node: "quote_specialist" },
      };
    }

    try {
      const appSettings = await settingsRepo.getAppSettings();
      const defaultVatRate = appSettings.default_vat_rate;
      const resolvedTarget = (state.extracted_entities?.resolved_target ?? {}) as ResolvedTarget;
      const actionChoice = resolvedTarget.action_choice;

      if (input?.action_type === "start_empty_quote") {
        const presetClientId = input.target_ids?.client_id ?? null;
        const presetClient = presetClientId ? await clientsRepo.getById(presetClientId) : null;
        const presetNewClientName =
          !presetClient && input.text.trim().length > 0 ? input.text.trim() : null;
        const emptyDraft: Gate1QuoteDraftPayload = {
          quote_id: null,
          client_id: presetClient?.id ?? null,
          ...(presetNewClientName ? { new_client: { name: presetNewClientName } } : {}),
          job_id: null,
          job_title: presetClient
            ? `Presupuesto trabajos ${presetClient.name}`
            : presetNewClientName
              ? `Trabajos para ${presetNewClientName}`
              : "",
          vat_rate: defaultVatRate,
          validity_days: appSettings.default_quote_validity_days,
          payment_methods: appSettings.default_payment_methods,
          payment_schedule: appSettings.default_payment_schedule,
          notes: "",
          lines: [],
        };
        return {
          routed_intent: "quote_specialist",
          pending_slot_fill: null,
          active_widget: buildQuoteEnvelope(emptyDraft),
          pending_gate: "gate_1_quote",
          messages: [
            new AIMessage(
              presetClient
                ? `Constructor de presupuesto listo para ${presetClient.name}. Añade las partidas.`
                : "Constructor de presupuesto listo. Añade partidas, IVA y cliente si lo necesitas."
            ),
          ],
          turn_trace: { append_node: "quote_specialist" },
        };
      }

      if (input?.action_type === "start_job_quote") {
        const jobId = input.target_ids?.job_id ?? state.active_job_id;
        if (!jobId) {
          throw new Error("INVALID_STATE_TRANSITION: Falta job_id para start_job_quote");
        }
        const job = await jobsRepo.getById(jobId);
        if (!job || job.status === "cancelado") {
          throw new Error("INVALID_STATE_TRANSITION: No se puede presupuestar una obra cancelada");
        }
        const existingQuote = await quotesRepo.getActiveByJobId(job.id);
        if (!existingQuote) {
          const draft: Gate1QuoteDraftPayload = {
            quote_id: null,
            client_id: job.client_id,
            job_id: job.id,
            job_title: job.title,
            vat_rate: defaultVatRate,
            validity_days: appSettings.default_quote_validity_days,
            payment_methods: appSettings.default_payment_methods,
            payment_schedule: appSettings.default_payment_schedule,
            notes: "",
            lines: [],
          };
          return {
            routed_intent: "quote_specialist",
            active_job_id: job.id,
            active_quote_id: null,
            active_widget: buildQuoteEnvelope(draft),
            pending_gate: "gate_1_quote",
            messages: [
              new AIMessage(
                `Nuevo presupuesto vinculado a ${job.job_code} (${job.title}). Añade las partidas.`
              ),
            ],
            turn_trace: { append_node: "quote_specialist" },
          };
        }

        if (existingQuote.status === "borrador") {
          const items = await quotesRepo.getItems(existingQuote.id);
          const draft: Gate1QuoteDraftPayload = {
            quote_id: existingQuote.id,
            client_id: existingQuote.client_id,
            job_id: job.id,
            job_title: job.title,
            vat_rate: existingQuote.vat_rate,
            validity_days: existingQuote.validity_days ?? appSettings.default_quote_validity_days,
            payment_methods: parseQuotePaymentMethodsJson(existingQuote.payment_methods_json),
            payment_schedule: parseQuotePaymentScheduleJson(existingQuote.payment_schedule_json),
            notes: existingQuote.notes,
            lines: items.map((item) => ({
              catalog_item_id: item.catalog_item_id,
              description: item.description,
              category: item.category,
              unit: item.unit,
              quantity_thousandths: item.quantity_thousandths,
              unit_price_cents: item.unit_price_cents,
              original_unit_price_cents: item.unit_price_cents,
              save_to_catalog: false,
            })),
          };
          return {
            routed_intent: "quote_specialist",
            active_job_id: job.id,
            active_quote_id: existingQuote.id,
            active_widget: buildQuoteEnvelope(draft),
            pending_gate: "gate_1_quote",
            messages: [
              new AIMessage(
                `Editando el borrador ${existingQuote.quote_code} de la obra ${job.job_code}.`
              ),
            ],
            turn_trace: { append_node: "quote_specialist" },
          };
        }

        // Enviado o aceptado -> devolver overview con acción Crear obra anexa
        return {
          routed_intent: "quote_specialist",
          active_job_id: job.id,
          active_quote_id: existingQuote.id,
          active_widget: {
            ui_widget_type: "JobLifecycleActionWidget",
            widget_payload: {
              job_id: job.id,
              quote_id: existingQuote.id,
              invoice_id: null,
              mode: "overview",
              pdf_uri: existingQuote.pdf_uri,
            },
          },
          quick_actions: [
            {
              id: "qa_create_annex_job",
              label: "Crear obra anexa",
              action_type: "resolve_disambiguation",
              payload: {
                disambiguation_choice: "create_annex_job",
                target_ids: existingQuote.client_id ? { client_id: existingQuote.client_id } : {},
              },
            },
          ],
          pending_gate: null,
          messages: [
            new AIMessage(
              `La obra ${job.job_code} ya tiene el presupuesto ${existingQuote.quote_code} en estado '${existingQuote.status}'. Puedes abrirlo o crear una obra anexa.`
            ),
          ],
          turn_trace: { append_node: "quote_specialist" },
        };
      }

      // Flujo libre por voz/texto
      const snippets: RagSnippet[] = [];
      const clientQuery = (state.extracted_entities?.client_query as string | null | undefined) ?? null;
      const jobTitleHint =
        (state.extracted_entities?.job_title_hint as string | null | undefined) ?? null;
      const slotFillAttempt = Number(state.extracted_entities?.slot_fill_attempt ?? 0);
      const vatRate =
        (state.extracted_entities?.vat_rate as number | undefined) ?? defaultVatRate;
      const parsedLines = (state.extracted_entities?.quote_lines as ParsedQuoteLine[] | undefined) ?? [];

      let targetJobId: string | null =
        actionChoice === "create_annex_job"
          ? null
          : resolvedTarget.job_id ??
            input?.target_ids?.job_id ??
            (clientQuery || resolvedTarget.client_id ? null : state.active_job_id);
      const targetQuoteId: string | null =
        actionChoice === "create_annex_job" ? null : resolvedTarget.quote_id ?? null;

      // Verificar conflicto con obra activa cuando no hay cliente distinto explícito
      if (
        targetJobId &&
        actionChoice !== "create_annex_job" &&
        actionChoice !== "edit_existing_quote" &&
        !clientQuery &&
        !resolvedTarget.client_id
      ) {
        const activeJob = await jobsRepo.getById(targetJobId);
        if (activeJob) {
          if (activeJob.status === "cancelado") {
            targetJobId = null;
          } else {
            const existingQuote = await quotesRepo.getActiveByJobId(activeJob.id);
            if (existingQuote) {
              const pending: PendingDisambiguation = {
                original_intent: "quote_specialist",
                original_text: input?.text ?? "",
                preserved_target: {
                  job_id: activeJob.id,
                  quote_id: existingQuote.id,
                  ...(existingQuote.client_id ? { client_id: existingQuote.client_id } : {}),
                },
                prompt: `La obra ${activeJob.job_code} ya tiene el presupuesto ${existingQuote.quote_code} (${existingQuote.status}). ¿Qué deseas hacer?`,
                candidates: [
                  ...(existingQuote.status === "borrador"
                    ? [
                        {
                          entity_type: "intent_action" as const,
                          id: "cand_edit_quote",
                          label: `Editar borrador ${existingQuote.quote_code}`,
                          job_id: activeJob.id,
                          quote_id: existingQuote.id,
                          ...(existingQuote.client_id ? { client_id: existingQuote.client_id } : {}),
                          action_choice: "edit_existing_quote" as const,
                        },
                      ]
                    : []),
                  {
                    entity_type: "intent_action",
                    id: "cand_annex_job",
                    label: "Crear obra anexa nueva",
                    ...(existingQuote.client_id ? { client_id: existingQuote.client_id } : {}),
                    action_choice: "create_annex_job",
                  },
                  {
                    entity_type: "intent_action",
                    id: "cand_overview",
                    label: `Ver resumen de ${activeJob.job_code}`,
                    job_id: activeJob.id,
                    quote_id: existingQuote.id,
                    action_choice: "open_job_overview",
                  },
                ],
                attempts: 0,
              };
              return {
                routed_intent: "clarification_node",
                pending_disambiguation: pending,
                pending_gate: null,
                turn_trace: { append_node: "quote_specialist" },
              };
            }
          }
        }
      }

      // Resolver cliente (resolved_target -> FTS5)
      let clientId: string | null =
        resolvedTarget.client_id ?? input?.target_ids?.client_id ?? null;

      if (!clientId && clientQuery) {
        const matches = await clientsRepo.searchFts5WithScore(clientQuery, 5);
        for (const m of matches.slice(0, 2)) {
          snippets.push({
            source_table: "clients",
            record_id: m.id,
            title: truncateText(m.name, TEXT_LIMITS.DISAMBIGUATION_LABEL),
            snippet_text: truncateText(
              m.phone ? `Tel ${m.phone}` : m.fiscal_address || "Cliente registrado",
              TEXT_LIMITS.RAG_SNIPPET
            ),
            bm25_score: m.bm25_score,
          });
        }

        if (matches.length === 1) {
          clientId = matches[0]!.id;
        } else if (matches.length >= 2) {
          const normQ = normalizeSpanishText(clientQuery);
          const exactMatches = matches.filter((m) =>
            normalizeSpanishText(m.name).includes(normQ)
          );
          // Desambiguar si hay >= 2 candidatos relevantes y no hay coincidencia de nombre completo única
          const singleFullMatch = matches.filter((m) => normalizeSpanishText(m.name) === normQ);
          if (singleFullMatch.length === 1) {
            clientId = singleFullMatch[0]!.id;
          } else if (exactMatches.length >= 2 || matches.length >= 2) {
            const pending: PendingDisambiguation = {
              original_intent: "quote_specialist",
              original_text: input?.text ?? "",
              preserved_target: resolvedTarget,
              prompt: truncateText(
                `He encontrado ${matches.length} clientes coincidentes con "${clientQuery}". ¿Para cuál es el presupuesto?`,
                400
              ),
              candidates: matches.slice(0, 5).map((m) => ({
                entity_type: "client",
                id: m.id,
                label: truncateText(m.name, TEXT_LIMITS.DISAMBIGUATION_LABEL),
                subtitle: m.phone || m.fiscal_address ? truncateText(m.phone || m.fiscal_address, 200) : undefined,
                client_id: m.id,
              })),
              attempts: 0,
            };
            return {
              routed_intent: "clarification_node",
              pending_disambiguation: pending,
              rag_snippets: snippets,
              pending_gate: null,
              turn_trace: {
                append_node: "quote_specialist",
                rag_hit_count: snippets.length,
              },
            };
          }
        }
      }

      if (!clientId && targetJobId) {
        const job = await jobsRepo.getById(targetJobId);
        if (job?.client_id) {
          clientId = job.client_id;
        }
      }

      // Cargar borrador existente si eligió edit_existing_quote
      if (actionChoice === "edit_existing_quote" && targetQuoteId) {
        const q = await quotesRepo.getById(targetQuoteId);
        const j = targetJobId ? await jobsRepo.getById(targetJobId) : null;
        if (q && q.status === "borrador") {
          const items = await quotesRepo.getItems(q.id);
          const draft: Gate1QuoteDraftPayload = {
            quote_id: q.id,
            client_id: q.client_id,
            job_id: q.job_id,
            job_title: j?.title ?? "Obra en borrador",
            vat_rate: q.vat_rate,
            validity_days: q.validity_days ?? appSettings.default_quote_validity_days,
            payment_methods: parseQuotePaymentMethodsJson(q.payment_methods_json),
            payment_schedule: parseQuotePaymentScheduleJson(q.payment_schedule_json),
            notes: q.notes,
            lines: items.map((item) => ({
              catalog_item_id: item.catalog_item_id,
              description: item.description,
              category: item.category,
              unit: item.unit,
              quantity_thousandths: item.quantity_thousandths,
              unit_price_cents: item.unit_price_cents,
              original_unit_price_cents: item.unit_price_cents,
              save_to_catalog: false,
            })),
          };
          return {
            routed_intent: "quote_specialist",
            active_widget: buildQuoteEnvelope(draft),
            pending_gate: "gate_1_quote",
            messages: [new AIMessage(`Cargado borrador ${q.quote_code} para edición.`)],
            turn_trace: { append_node: "quote_specialist" },
          };
        }
      }

      // Resolver líneas contra tarifario FTS5 (active = 1)
      const draftLines: Gate1QuoteDraftPayload["lines"] = [];
      for (const line of parsedLines) {
        const matches = await catalogRepo.searchFts5WithScore(line.description, 3);
        const top = matches[0];
        if (top) {
          snippets.push({
            source_table: "catalog_items",
            record_id: top.id,
            title: truncateText(top.description, TEXT_LIMITS.DISAMBIGUATION_LABEL),
            snippet_text: truncateText(
              `${top.category} · ${formatCentsEs(top.unit_price_cents)}/${top.unit}`,
              TEXT_LIMITS.RAG_SNIPPET
            ),
            bm25_score: top.bm25_score,
          });
          const unitPrice = line.explicit_price_cents ?? top.unit_price_cents;
          draftLines.push({
            catalog_item_id: top.id,
            description: top.description,
            category: top.category,
            unit: top.unit,
            quantity_thousandths: line.quantity_thousandths,
            unit_price_cents: unitPrice,
            original_unit_price_cents: top.unit_price_cents,
            save_to_catalog: false,
          });
        } else {
          draftLines.push({
            catalog_item_id: null,
            description: line.description,
            category: "General",
            unit: line.unit,
            quantity_thousandths: line.quantity_thousandths,
            unit_price_cents: line.explicit_price_cents ?? 0,
            original_unit_price_cents: 0,
            save_to_catalog: true,
          });
        }
      }

      const clientRow = clientId ? await clientsRepo.getById(clientId) : null;
      const existingJob = targetJobId ? await jobsRepo.getById(targetJobId) : null;

      // Validación de completitud (Opción A): pedir datos faltantes si no hay partidas
      const hasClientOrJob = Boolean(clientId || clientQuery || targetJobId);
      const hasLines = draftLines.length > 0;

      if (!hasClientOrJob && !hasLines) {
        if (slotFillAttempt < 2) {
          const pendingSlot: PendingSlotFill = {
            target_intent: "quote_specialist",
            missing_fields: ["client", "lines"],
            collected_data: {
              vat_rate: vatRate,
              ...(jobTitleHint ? { job_title_hint: jobTitleHint } : {}),
            },
            original_text: input?.text ?? "",
            attempts: slotFillAttempt,
          };
          const quickActions: QuickAction[] = [
            {
              id: "qa_open_empty_quote",
              label: "Abrir presupuesto vacío",
              action_type: "start_empty_quote",
              payload: {},
            },
          ];
          return {
            routed_intent: "quote_specialist",
            pending_slot_fill: pendingSlot,
            active_widget: null,
            pending_gate: null,
            quick_actions: quickActions,
            messages: [
              new AIMessage(
                [
                  "Vale, para preparar el presupuesto me faltan estos datos:",
                  "1) ¿Para qué cliente es?",
                  "2) ¿Qué trabajos o partidas incluyo (y cantidad o precio si quieres)?",
                  'Ejemplo: «Para Marta Ruiz: 1 plato de ducha y 10 m² de alicatado».',
                ].join("\n")
              ),
            ],
            turn_trace: { append_node: "quote_specialist" },
          };
        }

        const quickActions: QuickAction[] = [
          {
            id: "qa_open_empty_quote",
            label: "Abrir presupuesto vacío",
            action_type: "start_empty_quote",
            payload: {},
          },
        ];
        return {
          routed_intent: "quote_specialist",
          pending_slot_fill: null,
          active_widget: null,
          pending_gate: null,
          quick_actions: quickActions,
          messages: [
            new AIMessage(
              "No he podido detectar el cliente ni las partidas del presupuesto. Puedes abrir el presupuesto vacío y rellenarlo a mano cuando quieras."
            ),
          ],
          turn_trace: { append_node: "quote_specialist" },
        };
      }

      if (hasClientOrJob && !hasLines && slotFillAttempt < 2) {
        const targetLabel =
          clientRow?.name ?? clientQuery ?? existingJob?.title ?? "el cliente";
        const pendingSlot: PendingSlotFill = {
          target_intent: "quote_specialist",
          missing_fields: ["lines"],
          collected_data: {
            ...(clientId ? { client_id: clientId } : {}),
            ...(clientQuery ? { client_query: clientQuery } : {}),
            ...(targetJobId ? { job_id: targetJobId } : {}),
            vat_rate: vatRate,
            ...(jobTitleHint ? { job_title_hint: jobTitleHint } : {}),
          },
          original_text: input?.text ?? "",
          attempts: slotFillAttempt,
        };
        const openManualAction: QuickAction = clientId
          ? {
              id: "qa_open_quote_with_client",
              label: `Abrir borrador para ${targetLabel}`.slice(0, 80),
              action_type: "start_empty_quote",
              payload: { target_ids: { client_id: clientId } },
            }
          : clientQuery
            ? {
                id: "qa_open_quote_with_client",
                label: `Abrir borrador para ${targetLabel}`.slice(0, 80),
                action_type: "start_empty_quote",
                payload: { text: clientQuery },
              }
            : {
                id: "qa_open_empty_quote",
                label: "Abrir presupuesto vacío",
                action_type: "start_empty_quote",
                payload: {},
              };
        return {
          routed_intent: "quote_specialist",
          pending_slot_fill: pendingSlot,
          active_widget: null,
          pending_gate: null,
          quick_actions: [openManualAction],
          messages: [
            new AIMessage(
              `Vale, presupuesto para ${targetLabel}. ¿Qué trabajos o partidas incluyo? (Ejemplo: «1 plato de ducha y 2 puntos de luz a 45 euros»).`
            ),
          ],
          turn_trace: {
            append_node: "quote_specialist",
            rag_hit_count: Math.min(snippets.length, 5),
          },
        };
      }

      const defaultTitle = existingJob
        ? existingJob.title
        : jobTitleHint
          ? jobTitleHint
          : clientRow
            ? `Presupuesto trabajos ${clientRow.name}`
            : clientQuery
              ? `Trabajos para ${clientQuery}`
              : "Nuevo presupuesto de obra";

      const draft: Gate1QuoteDraftPayload = {
        quote_id: null,
        client_id: clientId,
        ...(clientId === null && clientQuery
          ? { new_client: { name: clientQuery } }
          : {}),
        job_id: targetJobId,
        job_title: defaultTitle,
        vat_rate: vatRate,
        validity_days: appSettings.default_quote_validity_days,
        payment_methods: appSettings.default_payment_methods,
        payment_schedule: appSettings.default_payment_schedule,
        notes:
          vatRate === 10
            ? "IVA 10 % sujeto a requisitos de reforma en vivienda."
            : "",
        lines: draftLines,
      };

      const widget = buildQuoteEnvelope(draft);
      const totalFormatted =
        widget.ui_widget_type === "QuoteBuilderWidget"
          ? formatCentsEs(widget.widget_payload.total_cents)
          : "0,00 €";
      const missingClientNote =
        !clientRow && !clientQuery
          ? " Puedes confirmar sin datos de cliente o añadirlo si lo tienes."
          : "";

      return {
        routed_intent: "quote_specialist",
        pending_slot_fill: null,
        rag_snippets: snippets.slice(0, 5),
        active_widget: widget,
        pending_gate: "gate_1_quote",
        messages: [
          new AIMessage(
            `He preparado el borrador de presupuesto${clientRow ? ` para ${clientRow.name}` : ""} (${draftLines.length} líneas, IVA ${vatRate} %, total ${totalFormatted}). Revisa los precios y confirma para generar el PDF.${missingClientNote}`
          ),
        ],
        turn_trace: {
          append_node: "quote_specialist",
          rag_hit_count: Math.min(snippets.length, 5),
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = msg.includes("INVALID_STATE_TRANSITION")
        ? ("INVALID_STATE_TRANSITION" as const)
        : ("SQLITE_QUERY_ERROR" as const);
      return {
        routed_intent: "quote_specialist",
        active_widget: null,
        pending_gate: null,
        messages: [new AIMessage(`No se pudo preparar el presupuesto: ${msg}`)],
        turn_trace: {
          append_node: "quote_specialist",
          error_code: code,
        },
      };
    }
  };
}
