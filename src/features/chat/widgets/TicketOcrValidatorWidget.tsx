import { useEffect, useMemo, useState } from "react";
import {
  patchTicketDraftByVoice,
  type VoiceDisambiguationPayload,
} from "../../../agent/voiceFormPatcher";
import { Gate2TicketCommitPayloadSchema } from "../../../core/contracts/schemas";
import { useRegisterOverlayVoice } from "../../../ui/overlayVoiceContext";
import type {
  ActiveWidgetEnvelope,
  ExpenseTicketRow,
  Gate2TicketDraftPayload,
  JobRow,
  TicketVatRate,
} from "../../../core/contracts/types";
import { JobsRepository } from "../../../core/db/repositories/jobsRepo";
import { TicketsRepository } from "../../../core/db/repositories/ticketsRepo";
import { deriveFiscalQuarter, isValidIsoDate } from "../../../core/fiscal/dateQuarter";
import { computeInverseVat21, formatCentsEs } from "../../../core/fiscal/fiscalEngine";
import type { WidgetCommonProps } from "./widgetTypes";

type TicketWidget = Extract<ActiveWidgetEnvelope, { ui_widget_type: "TicketOcrValidatorWidget" }>;

const TICKET_CATEGORIES = ["materiales", "herramientas", "transporte", "subcontrata", "otros"];
const VAT_OPTIONS: TicketVatRate[] = [21, 10, 4, 0, "mixed"];

function stripFallbackReason(payload: TicketWidget["widget_payload"]): Gate2TicketDraftPayload {
  const { ocr_fallback_reason: _r, ...draft } = payload;
  return draft;
}

function centsToEur(cents: number): string {
  return (cents / 100).toFixed(2);
}

function eurToCents(raw: string): number {
  const normalized = raw.replace(",", ".").trim();
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100);
}

export function TicketOcrValidatorWidget({
  widget,
  isActiveGate,
  activePendingGate,
  isSubmitting,
  runtime,
  onResumeDecision,
}: WidgetCommonProps) {
  const ticketWidget = widget as TicketWidget;
  const fallbackReason = ticketWidget.widget_payload.ocr_fallback_reason;
  const initialDraft = useMemo(
    () => stripFallbackReason(ticketWidget.widget_payload),
    [ticketWidget]
  );
  const initialJson = useMemo(() => JSON.stringify(initialDraft), [initialDraft]);

  const [draft, setDraft] = useState<Gate2TicketDraftPayload>(initialDraft);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [duplicates, setDuplicates] = useState<ExpenseTicketRow[]>([]);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<Gate2TicketDraftPayload[]>([]);
  const [voiceChanges, setVoiceChanges] = useState<string[]>([]);
  const [voiceWarnings, setVoiceWarnings] = useState<string[]>([]);
  const [voiceDisambig, setVoiceDisambig] = useState<VoiceDisambiguationPayload | null>(null);

  useEffect(() => {
    setDraft(initialDraft);
    setValidationError(null);
    setUndoStack([]);
    setVoiceChanges([]);
    setVoiceWarnings([]);
    setVoiceDisambig(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJson]);

  useEffect(() => {
    let active = true;
    const jobsRepo = new JobsRepository(runtime.executor);
    jobsRepo
      .listAll()
      .then((list) => {
        if (active) setJobs(list.filter((j) => j.status !== "cancelado"));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [runtime.executor]);

  useEffect(() => {
    let active = true;
    const ticketsRepo = new TicketsRepository(runtime.executor);
    if (!isValidIsoDate(draft.issue_date_iso) || draft.total_cents <= 0) {
      setDuplicates([]);
      return;
    }
    ticketsRepo
      .checkDuplicate({
        issueDateIso: draft.issue_date_iso,
        totalCents: draft.total_cents,
        supplierNif: draft.supplier_nif,
      })
      .then((hits) => {
        if (active) setDuplicates(hits);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [runtime.executor, draft.issue_date_iso, draft.total_cents, draft.supplier_nif]);

  useEffect(() => {
    let revoker: (() => void) | null = null;
    let active = true;
    if (!draft.media_uri) {
      setThumbUrl(null);
      return;
    }
    runtime.fileBridge
      .resolveDisplayUrl(draft.media_uri)
      .then((res) => {
        if (!active) {
          res?.revoke();
          return;
        }
        revoker = res?.revoke ?? null;
        setThumbUrl(res?.url ?? null);
      })
      .catch(() => {
        if (active) setThumbUrl(null);
      });
    return () => {
      active = false;
      revoker?.();
    };
  }, [runtime.fileBridge, draft.media_uri]);

  const canAct = isActiveGate && activePendingGate === "gate_2_ticket";
  const isDirty = useMemo(() => JSON.stringify(draft) !== initialJson, [draft, initialJson]);
  const diffCents = Math.abs(draft.base_cents + draft.vat_cents - draft.total_cents);

  useRegisterOverlayVoice({
    enabled: canAct && !isSubmitting,
    title: "Dictar datos del ticket",
    placeholder: "Ej: Proveedor Obramat, total 84,70 euros, categoría materiales",
    examples: [
      "Proveedor Ferretería El Martillo, NIF B85296341",
      "Total 121 euros con IVA al 21 %",
      "Categoría transporte, fecha de ayer",
    ],
    buttonLabel: "Dictar ticket",
    lastChanges: voiceChanges,
    lastWarnings: voiceWarnings,
    canUndo: undoStack.length > 0,
    onUndo: () => {
      const prev = undoStack[undoStack.length - 1];
      if (!prev) return;
      setUndoStack((s) => s.slice(0, -1));
      setDraft(prev);
      setVoiceChanges(["Último dictado deshecho"]);
      setVoiceWarnings([]);
      setVoiceDisambig(null);
    },
    disambiguation: voiceDisambig
      ? {
          prompt: voiceDisambig.prompt,
          options: voiceDisambig.options,
          onSelect: (id) => {
            setUndoStack((s) => [...s.slice(-9), draft]);
            setDraft((prev) => ({ ...prev, job_id: id }));
            const hit = jobs.find((j) => j.id === id);
            setVoiceChanges([hit ? `Obra: ${hit.job_code}` : "Obra vinculada"]);
            setVoiceWarnings([]);
            setVoiceDisambig(null);
          },
          onDismiss: () => setVoiceDisambig(null),
        }
      : null,
    onTranscript: async (text) => {
      const res = await patchTicketDraftByVoice(draft, text, {
        executor: runtime.executor,
        inferenceAdapter: runtime.inferenceAdapter,
      });
      if (res.changed) {
        setUndoStack((s) => [...s.slice(-9), draft]);
        setDraft(res.nextState);
        setVoiceChanges(res.appliedChanges);
        setVoiceWarnings(res.warnings);
      } else if (!res.disambiguation) {
        setVoiceChanges([]);
        setVoiceWarnings([
          "No detecté cambios claros. Prueba: «Proveedor ..., total ... euros».",
        ]);
      }
      setVoiceDisambig(res.disambiguation ?? null);
    },
  });

  const handleDateChange = (nextDate: string) => {
    setDraft((p) => ({
      ...p,
      issue_date_iso: nextDate,
      quarter: isValidIsoDate(nextDate) ? deriveFiscalQuarter(nextDate) : p.quarter,
    }));
  };

  const applyInverseVat21 = () => {
    if (draft.total_cents <= 0) return;
    const inv = computeInverseVat21(draft.total_cents);
    setDraft((p) => ({
      ...p,
      vat_rate: 21,
      base_cents: inv.baseCents,
      vat_cents: inv.vatCents,
    }));
  };

  const handleConfirm = async () => {
    setValidationError(null);
    const parsed = Gate2TicketCommitPayloadSchema.safeParse(draft);
    if (!parsed.success) {
      setValidationError(parsed.error.issues.map((i) => i.message).join(" · "));
      return;
    }
    if (isDirty) {
      await onResumeDecision({
        gate_id: "gate_2_ticket",
        action: "edit",
        edited_payload: parsed.data,
        client_validated_at_ms: Date.now(),
      });
    } else {
      await onResumeDecision({
        gate_id: "gate_2_ticket",
        action: "approve",
        client_validated_at_ms: Date.now(),
      });
    }
  };

  const handleReject = async () => {
    setValidationError(null);
    await onResumeDecision({
      gate_id: "gate_2_ticket",
      action: "reject",
      rejection_reason: "Ticket descartado",
      client_validated_at_ms: Date.now(),
    });
  };

  return (
    <section
      data-testid="ticket-ocr-validator-widget"
      className="mt-2 mb-2 receipt-slip border-x border-[#E5DFD2] p-3.5 text-[#2C2621] font-sans"
    >
      <div className="flex items-center justify-between gap-2 border-b border-dashed border-[#E5DFD2] pb-2.5">
        <div>
          <span className="inline-flex items-center rounded-full badge-expense px-2.5 py-0.5 text-[11px] font-semibold">
            {canAct ? "Validar ticket de gasto" : "Ticket de Gasto"}
          </span>
          <h3 className="mt-1 text-sm font-bold text-[#2C2621]">
            {draft.supplier_name || "Proveedor por confirmar"}
          </h3>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-mono-nums text-[#6B6860]">
            OCR {draft.ocr_confidence} % · {draft.quarter}
          </div>
          <div
            data-testid="ticket-total-display"
            className="text-base font-extrabold font-mono-nums tabular-nums text-[#2C2621] highlighter-yellow"
          >
            {formatCentsEs(draft.total_cents)}
          </div>
        </div>
      </div>

      {fallbackReason && (
        <div className="mt-2.5 rounded-xl border border-[#D97706]/35 bg-[#FFF3A1] p-2 text-xs text-[#3E3300]">
          Entrada manual asistida ({fallbackReason}): revisa y completa los importes antes de guardar.
        </div>
      )}

      {duplicates.length > 0 && canAct && (
        <div
          data-testid="ticket-duplicate-warning"
          className="mt-2.5 rounded-xl border border-[#EA580C]/35 bg-[#FFD6B0] p-2 text-xs font-medium text-[#4A2500]"
        >
          Posible duplicado detectado ({duplicates.length} ticket(s) con mismo importe y fecha
          {draft.supplier_nif ? ` / NIF ${draft.supplier_nif}` : ""}). Verifica antes de confirmar.
        </div>
      )}

      {thumbUrl && (
        <div className="mt-2.5 paper-sheet rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] p-1.5">
          <img
            src={thumbUrl}
            alt="Previsualización de ticket escaneado"
            className="max-h-36 w-full rounded-lg object-cover"
          />
        </div>
      )}

      <div className="mt-3 space-y-2.5">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-semibold text-[#2C2621]" htmlFor="tk-supplier">
              Proveedor
            </label>
            <input
              id="tk-supplier"
              data-testid="ticket-supplier-input"
              type="text"
              disabled={!canAct || isSubmitting}
              value={draft.supplier_name}
              onChange={(e) => setDraft((p) => ({ ...p, supplier_name: e.target.value }))}
              className="mt-1 w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 text-sm text-[#2C2621] disabled:bg-[#F5F1E6]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#2C2621]" htmlFor="tk-nif">
              NIF/CIF proveedor
            </label>
            <input
              id="tk-nif"
              type="text"
              disabled={!canAct || isSubmitting}
              value={draft.supplier_nif}
              onChange={(e) =>
                setDraft((p) => ({ ...p, supplier_nif: e.target.value.toUpperCase() }))
              }
              placeholder="Ej: B85296341"
              className="mt-1 w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 text-sm font-mono-nums text-[#2C2621] disabled:bg-[#F5F1E6]"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-semibold text-[#2C2621]" htmlFor="tk-date">
              Fecha ticket
            </label>
            <input
              id="tk-date"
              type="date"
              disabled={!canAct || isSubmitting}
              value={draft.issue_date_iso}
              onChange={(e) => handleDateChange(e.target.value)}
              className="mt-1 w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 py-2 text-xs font-mono-nums text-[#2C2621] disabled:bg-[#F5F1E6]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#2C2621]" htmlFor="tk-cat">
              Categoría gasto
            </label>
            <select
              id="tk-cat"
              disabled={!canAct || isSubmitting}
              value={draft.category}
              onChange={(e) => setDraft((p) => ({ ...p, category: e.target.value }))}
              className="mt-1 w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 py-2 text-xs text-[#2C2621] disabled:bg-[#F5F1E6]"
            >
              {TICKET_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#2C2621]" htmlFor="tk-job">
            Obra vinculada
          </label>
          <select
            id="tk-job"
            data-testid="ticket-job-select"
            disabled={!canAct || isSubmitting}
            value={draft.job_id ?? ""}
            onChange={(e) => setDraft((p) => ({ ...p, job_id: e.target.value || null }))}
            className="mt-1 w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 text-xs text-[#2C2621] disabled:bg-[#F5F1E6]"
          >
            <option value="">Gasto general de empresa (sin obra)</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.job_code} · {j.title}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-[11px] font-semibold text-[#2C2621]" htmlFor="tk-base">
              Base (€)
            </label>
            <input
              id="tk-base"
              data-testid="ticket-base-input"
              type="number"
              step="0.01"
              min="0"
              disabled={!canAct || isSubmitting}
              value={centsToEur(draft.base_cents)}
              onChange={(e) => setDraft((p) => ({ ...p, base_cents: eurToCents(e.target.value) }))}
              className="mt-1 w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 py-2 text-xs font-mono-nums tabular-nums text-[#2C2621] disabled:bg-[#F5F1E6]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[#2C2621]" htmlFor="tk-vat">
              IVA (€)
            </label>
            <input
              id="tk-vat"
              data-testid="ticket-vat-input"
              type="number"
              step="0.01"
              min="0"
              disabled={!canAct || isSubmitting}
              value={centsToEur(draft.vat_cents)}
              onChange={(e) => setDraft((p) => ({ ...p, vat_cents: eurToCents(e.target.value) }))}
              className="mt-1 w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 py-2 text-xs font-mono-nums tabular-nums text-[#2C2621] disabled:bg-[#F5F1E6]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[#2C2621]" htmlFor="tk-total">
              Total (€)
            </label>
            <input
              id="tk-total"
              data-testid="ticket-total-input"
              type="number"
              step="0.01"
              min="0"
              disabled={!canAct || isSubmitting}
              value={centsToEur(draft.total_cents)}
              onChange={(e) => setDraft((p) => ({ ...p, total_cents: eurToCents(e.target.value) }))}
              className="mt-1 w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 py-2 text-xs font-bold font-mono-nums tabular-nums text-[#2C2621] disabled:bg-[#F5F1E6]"
            />
          </div>
        </div>

        {canAct && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1">
              {VAT_OPTIONS.map((rate) => (
                <button
                  key={String(rate)}
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setDraft((p) => ({ ...p, vat_rate: rate }))}
                  className={`rounded-lg px-2 py-1 text-[11px] font-semibold ${
                    draft.vat_rate === rate
                      ? "bg-[#4B7094] text-[#FFFDF9]"
                      : "bg-[#F5F1E6] border border-[#E5DFD2] text-[#2C2621]"
                  }`}
                >
                  {rate === "mixed" ? "Mixto" : `${rate}%`}
                </button>
              ))}
            </div>
            <button
              type="button"
              data-testid="ticket-inverse-21-btn"
              disabled={isSubmitting || draft.total_cents <= 0}
              onClick={applyInverseVat21}
              className="rounded-lg border border-[#EA580C]/40 bg-[#FFD6B0] px-2.5 py-1 text-[11px] font-semibold text-[#4A2500]"
            >
              Desglose inverso 21 %
            </button>
          </div>
        )}

        <div className="text-[11px] text-[#6B6860]">
          Trimestre fiscal: <strong className="font-mono-nums text-[#2C2621]">{draft.quarter}</strong> · Diferencia térmica:{" "}
          <strong className={`font-mono-nums tabular-nums ${diffCents > 2 ? "text-[#9A2D08]" : "text-[#1B3A24]"}`}>
            {formatCentsEs(diffCents)}
          </strong>{" "}
          (máx. ±0,02 €)
        </div>

        {validationError && (
          <div
            role="alert"
            className="rounded-xl border border-[#DC2626]/30 bg-[#FAD2D8] p-2.5 text-xs font-medium text-[#5A121C]"
          >
            {validationError}
          </div>
        )}

        {canAct && (
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              data-testid="ticket-reject-btn"
              disabled={isSubmitting}
              onClick={() => void handleReject()}
              className="min-h-12 rounded-xl border border-[#DC2626]/40 bg-[#FFFDF7] px-4 text-xs font-bold text-[#9A2D08]"
            >
              Descartar
            </button>
            <button
              type="button"
              data-testid="ticket-approve-btn"
              disabled={isSubmitting}
              onClick={handleConfirm}
              className="min-h-12 flex-1 rounded-xl bg-[#EA580C] hover:bg-[#D04B00] px-4 text-sm font-bold text-white shadow-sm disabled:opacity-50"
            >
              {isSubmitting
                ? "Archivando ticket..."
                : isDirty
                  ? "Guardar cambios y archivar"
                  : "Confirmar y archivar gasto"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
