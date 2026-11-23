import { AIMessage } from "@langchain/core/messages";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import type {
  ActiveWidgetEnvelope,
  ErrorCode,
  Gate2TicketDraftPayload,
  PendingSlotFill,
  QuickAction,
} from "../../core/contracts/types";
import { JobsRepository } from "../../core/db/repositories/jobsRepo";
import { deriveFiscalQuarter, getLocalTodayIso, isValidIsoDate } from "../../core/fiscal/dateQuarter";
import { computeInverseVat21, formatCentsEs } from "../../core/fiscal/fiscalEngine";
import {
  extractTicketFieldsFromText,
  type ParsedTicketFields,
} from "../inference/deterministicSpanishParser";
import { getSeedOverride, type GraphDependencies } from "../ports";
import type { ObraLocalGraphState, ObraLocalGraphUpdate } from "../state";

function buildTicketSummary(params: {
  supplierName: string;
  baseCents: number;
  vatCents: number;
  totalCents: number;
  jobCode: string | null;
}): string {
  const diff = Math.abs(params.baseCents + params.vatCents - params.totalCents);
  const diffNote =
    diff > 0 && diff <= 2 ? `, diferencia térmica de ${formatCentsEs(diff)} dentro de tolerancia` : "";
  const jobNote = params.jobCode ? ` para obra ${params.jobCode}` : "";
  return `Ticket detectado de ${params.supplierName || "Proveedor sin identificar"} (${formatCentsEs(params.totalCents)}${diffNote})${jobNote}.`;
}

export function createOcrTicketSpecialistNode(deps: GraphDependencies) {
  const jobsRepo = new JobsRepository(deps.executor);

  return async function ocrTicketSpecialistNode(
    state: ObraLocalGraphState,
    config?: LangGraphRunnableConfig
  ): Promise<ObraLocalGraphUpdate> {
    const seedOverride = getSeedOverride(config);
    const input = state.input_payload;
    const todayIso = getLocalTodayIso();

    // 1. Verificar seed_override / recoveredDraftOverride ANTES de effectiveMediaUri != null
    if (seedOverride?.ocrFixtureOverride) {
      const ov = seedOverride.ocrFixtureOverride;
      const issueDate =
        ov.parsed.issueDateIso && isValidIsoDate(ov.parsed.issueDateIso)
          ? ov.parsed.issueDateIso
          : todayIso;
      const targetJobId = input?.session_context?.active_job_id ?? state.active_job_id;
      const job = targetJobId ? await jobsRepo.getById(targetJobId) : null;
      const baseCents = ov.parsed.baseCents ?? 0;
      const vatCents = ov.parsed.vatCents ?? 0;
      const totalCents = ov.parsed.totalCents ?? baseCents + vatCents;

      const draft: Gate2TicketDraftPayload = {
        supplier_name: ov.parsed.supplierName ?? "Proveedor sin identificar",
        supplier_nif: ov.parsed.supplierNif ?? "",
        issue_date_iso: issueDate,
        quarter: deriveFiscalQuarter(issueDate),
        base_cents: baseCents,
        vat_rate: ov.parsed.vatRate ?? 21,
        vat_cents: vatCents,
        total_cents: totalCents,
        ocr_confidence: Math.max(0, Math.min(100, Math.round(ov.confidence))),
        job_id: job?.id ?? null,
        category: "materiales",
        media_uri: null,
      };

      const summary =
        ov.summary_es ??
        buildTicketSummary({
          supplierName: draft.supplier_name,
          baseCents: draft.base_cents,
          vatCents: draft.vat_cents,
          totalCents: draft.total_cents,
          jobCode: job?.job_code ?? null,
        });

      const widget: ActiveWidgetEnvelope = {
        ui_widget_type: "TicketOcrValidatorWidget",
        widget_payload: {
          ...draft,
          ocr_fallback_reason: null,
        },
      };

      return {
        routed_intent: "ocr_ticket_specialist",
        active_widget: widget,
        pending_gate: "gate_2_ticket",
        extracted_entities: {
          ...(state.extracted_entities ?? {}),
          gate2_summary_es: summary,
        },
        messages: [
          new AIMessage(
            `Lectura OCR completada (${draft.ocr_confidence} % confianza): ${draft.supplier_name} por ${formatCentsEs(draft.total_cents)} en ${draft.quarter}. Verifica el importe y la obra vinculada antes de archivar en Hacienda.`
          ),
        ],
        turn_trace: { append_node: "ocr_ticket_specialist" },
      };
    }

    if (seedOverride?.recoveredDraftOverride?.pending_gate === "gate_2_ticket") {
      const rec = seedOverride.recoveredDraftOverride;
      const draft = rec.proposed_payload as Gate2TicketDraftPayload;
      return {
        routed_intent: "ocr_ticket_specialist",
        active_widget: {
          ui_widget_type: "TicketOcrValidatorWidget",
          widget_payload: {
            ...draft,
            ocr_fallback_reason: null,
          },
        },
        pending_gate: "gate_2_ticket",
        extracted_entities: {
          ...(state.extracted_entities ?? {}),
          gate2_summary_es: rec.summary_es,
        },
        messages: [new AIMessage(rec.summary_es)],
        turn_trace: { append_node: "ocr_ticket_specialist" },
      };
    }

    // 2. Ejecución normal (OCR bajo demanda o entrada manual/dictado)
    const effectiveMediaUri = input?.raw_media_uri ?? null;
    const isManualEntry = input?.action_type === "manual_ticket_entry";
    const targetJobId = input?.target_ids?.job_id ?? state.active_job_id;
    const job = targetJobId ? await jobsRepo.getById(targetJobId) : null;

    let fallbackReason: ErrorCode | null = null;
    let supplierName = "Proveedor sin identificar";
    let supplierNif = "";
    let issueDateIso = todayIso;
    let vatRate = undefined as Gate2TicketDraftPayload["vat_rate"];
    let baseCents = 0;
    let vatCents = 0;
    let totalCents = 0;
    let confidence = 0;

    if (effectiveMediaUri !== null && !isManualEntry) {
      try {
        const file = await deps.fileBridge.readAsFile(
          effectiveMediaUri,
          "ticket.jpg",
          effectiveMediaUri.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg"
        );
        const bytes = new Uint8Array(await file.arrayBuffer());
        const mime = file.type === "image/png" ? "image/png" : "image/jpeg";
        const ocrRes = await deps.ocrPort.extractTicketText(bytes, mime);

        confidence = Math.max(0, Math.min(100, Math.round(ocrRes.confidence || 0)));
        supplierName = ocrRes.parsed.supplierName?.trim() || "Proveedor sin identificar";
        supplierNif = ocrRes.parsed.supplierNif?.trim().toUpperCase() || "";
        issueDateIso =
          ocrRes.parsed.issueDateIso && isValidIsoDate(ocrRes.parsed.issueDateIso)
            ? ocrRes.parsed.issueDateIso
            : todayIso;
        vatRate = ocrRes.parsed.vatRate;
        totalCents = ocrRes.parsed.totalCents ?? 0;

        if (ocrRes.parsed.baseCents !== null && ocrRes.parsed.vatCents !== null) {
          baseCents = ocrRes.parsed.baseCents;
          vatCents = ocrRes.parsed.vatCents;
          if (totalCents === 0) totalCents = baseCents + vatCents;
        } else if (totalCents > 0) {
          const inv = computeInverseVat21(totalCents);
          baseCents = inv.baseCents;
          vatCents = inv.vatCents;
          vatRate = vatRate ?? 21;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        fallbackReason = msg.includes("LAZY_CHUNK_LOAD_ERROR")
          ? "LAZY_CHUNK_LOAD_ERROR"
          : "OCR_ENGINE_ERROR";
      }
    } else if (input?.text && input.text.trim().length > 0) {
      const preParsed = state.extracted_entities?.ticket as ParsedTicketFields | undefined;
      const parsed = preParsed ?? extractTicketFieldsFromText(input.text);
      const slotFillAttempt = Number(state.extracted_entities?.slot_fill_attempt ?? 0);
      const hasSupplier = Boolean(parsed.supplier_name);
      const hasAmount = Boolean(
        (parsed.total_cents ?? 0) > 0 ||
          ((parsed.base_cents ?? 0) > 0 && (parsed.vat_cents ?? 0) >= 0)
      );

      if (input.action_type === "free_text_or_voice" && (!hasSupplier || !hasAmount) && slotFillAttempt < 2) {
        const missingFields: string[] = [];
        if (!hasSupplier) missingFields.push("supplier");
        if (!hasAmount) missingFields.push("amount");

        const pendingSlot: PendingSlotFill = {
          target_intent: "ocr_ticket_specialist",
          missing_fields: missingFields,
          collected_data: {
            ticket: parsed,
            ...(job?.id ? { job_id: job.id } : {}),
          },
          original_text: input.text,
          attempts: slotFillAttempt,
        };
        const quickActions: QuickAction[] = [
          {
            id: "qa_open_manual_ticket",
            label: "Abrir formulario manual",
            action_type: "manual_ticket_entry",
            payload: {},
          },
        ];

        let prompt: string;
        if (!hasSupplier && !hasAmount) {
          prompt =
            "Para registrar el gasto me faltan el proveedor y el importe total (o puedes hacer una foto al ticket).\nEjemplo: «Obramat, 85,50 euros».";
        } else if (!hasAmount) {
          prompt = `Vale, gasto en ${parsed.supplier_name}. ¿Cuál es el importe total del ticket?`;
        } else {
          const amountLabel = formatCentsEs(parsed.total_cents ?? (parsed.base_cents ?? 0) + (parsed.vat_cents ?? 0));
          prompt = `Vale, gasto de ${amountLabel}. ¿De qué proveedor o tienda es el ticket?`;
        }

        return {
          routed_intent: "ocr_ticket_specialist",
          pending_slot_fill: pendingSlot,
          active_widget: null,
          pending_gate: null,
          quick_actions: quickActions,
          messages: [new AIMessage(prompt)],
          turn_trace: { append_node: "ocr_ticket_specialist" },
        };
      }

      supplierName = parsed.supplier_name ?? "Proveedor sin identificar";
      supplierNif = parsed.supplier_nif ?? "";
      issueDateIso = parsed.issue_date_iso;
      vatRate = parsed.vat_rate;
      totalCents = parsed.total_cents ?? 0;
      if (parsed.base_cents !== null && parsed.vat_cents !== null) {
        baseCents = parsed.base_cents;
        vatCents = parsed.vat_cents;
      } else if (totalCents > 0) {
        const inv = computeInverseVat21(totalCents);
        baseCents = inv.baseCents;
        vatCents = inv.vatCents;
        vatRate = vatRate ?? 21;
      }
    }

    const quarter = deriveFiscalQuarter(issueDateIso);
    const draft: Gate2TicketDraftPayload = {
      supplier_name: supplierName,
      supplier_nif: supplierNif,
      issue_date_iso: issueDateIso,
      quarter,
      base_cents: baseCents,
      ...(vatRate !== undefined ? { vat_rate: vatRate } : {}),
      vat_cents: vatCents,
      total_cents: totalCents,
      ocr_confidence: confidence,
      job_id: job?.id ?? null,
      category: "materiales",
      media_uri: effectiveMediaUri,
    };

    const summary = buildTicketSummary({
      supplierName,
      baseCents,
      vatCents,
      totalCents,
      jobCode: job?.job_code ?? null,
    });

    const assistantText = fallbackReason
      ? "El motor OCR local falló al leer la imagen. Completa los importes manualmente para validar y archivar el ticket."
      : isManualEntry
        ? "Introduce los datos del ticket de gasto para validarlo antes de archivar en tu Hucha Fiscal."
        : `Ticket procesado (${confidence} % confianza): ${supplierName} por ${formatCentsEs(totalCents)} en ${quarter}.`;

    return {
      routed_intent: "ocr_ticket_specialist",
      pending_slot_fill: null,
      active_widget: {
        ui_widget_type: "TicketOcrValidatorWidget",
        widget_payload: {
          ...draft,
          ocr_fallback_reason: fallbackReason,
        },
      },
      pending_gate: "gate_2_ticket",
      extracted_entities: {
        ...(state.extracted_entities ?? {}),
        gate2_summary_es: summary,
      },
      messages: [new AIMessage(assistantText)],
      turn_trace: {
        append_node: "ocr_ticket_specialist",
        ...(fallbackReason ? { error_code: fallbackReason } : {}),
      },
    };
  };
}
