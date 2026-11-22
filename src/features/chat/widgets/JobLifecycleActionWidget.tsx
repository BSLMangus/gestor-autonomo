import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { useEffect, useMemo, useState } from "react";
import {
  Gate3InvoiceCommitPayloadSchema,
  Gate4ShareCommitPayloadSchema,
} from "../../../core/contracts/schemas";
import type {
  ActiveWidgetEnvelope,
  Gate3InvoiceDraftPayload,
  Gate4ShareDraftPayload,
  InvoiceRow,
  JobRow,
  QuoteRow,
} from "../../../core/contracts/types";
import { InvoicesRepository } from "../../../core/db/repositories/invoicesRepo";
import { JobsRepository } from "../../../core/db/repositories/jobsRepo";
import { QuotesRepository } from "../../../core/db/repositories/quotesRepo";
import { formatCentsEs } from "../../../core/fiscal/fiscalEngine";
import type { WidgetCommonProps } from "./widgetTypes";

type LifecycleWidget = Extract<ActiveWidgetEnvelope, { ui_widget_type: "JobLifecycleActionWidget" }>;

export function JobLifecycleActionWidget({
  widget,
  isActiveGate,
  activePendingGate,
  isSubmitting,
  runtime,
  onResumeDecision,
  onQuickAction,
}: WidgetCommonProps) {
  const lp = (widget as LifecycleWidget).widget_payload;

  const [job, setJob] = useState<JobRow | null>(null);
  const [quote, setQuote] = useState<QuoteRow | null>(null);
  const [invoice, setInvoice] = useState<InvoiceRow | null>(null);
  const [invoicesForJob, setInvoicesForJob] = useState<InvoiceRow[]>([]);

  const initialG3 = lp.gate_3_draft ?? null;
  const initialG4 = lp.gate_4_draft ?? null;
  const initialG3Json = useMemo(() => JSON.stringify(initialG3), [initialG3]);
  const initialG4Json = useMemo(() => JSON.stringify(initialG4), [initialG4]);

  const [g3Draft, setG3Draft] = useState<Gate3InvoiceDraftPayload | null>(initialG3);
  const [g4Draft, setG4Draft] = useState<Gate4ShareDraftPayload | null>(initialG4);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [manualBusy, setManualBusy] = useState(false);

  useEffect(() => {
    setG3Draft(initialG3);
    setG4Draft(initialG4);
    setValidationError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialG3Json, initialG4Json]);

  const loadEntities = async () => {
    const jobsRepo = new JobsRepository(runtime.executor);
    const quotesRepo = new QuotesRepository(runtime.executor);
    const invoicesRepo = new InvoicesRepository(runtime.executor);
    const [j, q, invList, inv] = await Promise.all([
      jobsRepo.getById(lp.job_id),
      lp.quote_id ? quotesRepo.getById(lp.quote_id) : Promise.resolve(null),
      invoicesRepo.listByJobId(lp.job_id),
      lp.invoice_id ? invoicesRepo.getById(lp.invoice_id) : Promise.resolve(null),
    ]);
    setJob(j);
    setQuote(q);
    setInvoicesForJob(invList);
    setInvoice(inv);
  };

  useEffect(() => {
    void loadEntities();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime.executor, lp.job_id, lp.quote_id, lp.invoice_id, lp.mode]);

  const canActGate3 =
    lp.mode === "preview_gate_3" &&
    isActiveGate &&
    activePendingGate === "gate_3_invoice" &&
    g3Draft !== null;

  const canActGate4 =
    lp.mode === "preview_gate_4" &&
    isActiveGate &&
    activePendingGate === "gate_4_share" &&
    g4Draft !== null;

  const handleOpenPdf = async (
    pdfUri: string | null,
    docKind: "quote" | "invoice",
    docId: string
  ) => {
    if (runtime.onOpenPdf) {
      await runtime.onOpenPdf(pdfUri, docKind, docId);
    } else {
      await runtime.documentOpener.openPdf(pdfUri, docKind, docId, runtime.pdfPort);
    }
  };

  const triggerNativeOrWebShare = async (payload: {
    pdfUri: string | null;
    docKind: "quote" | "invoice";
    docId: string;
    messageText: string;
    channel: "whatsapp" | "share_sheet";
    recipientPhone: string;
  }): Promise<string> => {
    try {
      let resolvedPdfUri = payload.pdfUri;
      const fileName =
        payload.docKind === "invoice"
          ? `${invoice?.invoice_number ?? payload.docId}.pdf`
          : `${quote?.quote_code ?? payload.docId}.pdf`;
      if (!resolvedPdfUri) {
        resolvedPdfUri =
          payload.docKind === "invoice"
            ? await new InvoicesRepository(runtime.executor).regeneratePdfOnDemand(
                payload.docId,
                runtime.pdfPort,
                runtime.fileBridge
              )
            : await new QuotesRepository(runtime.executor).regeneratePdfOnDemand(
                payload.docId,
                runtime.pdfPort,
                runtime.fileBridge
              );
      }

      if (Capacitor.isNativePlatform()) {
        const shareUri = await runtime.fileBridge.toShareableNativeUri(resolvedPdfUri);
        await Share.share({
          title: fileName,
          text: payload.messageText,
          files: [shareUri],
        });
        const msg = "Hoja de envío nativa abierta. Marca el documento como enviado si ya lo remitiste.";
        setShareFeedback(msg);
        return msg;
      }

      const file = await runtime.fileBridge.readAsFile(resolvedPdfUri, fileName, "application/pdf");
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        const canShareFile =
          typeof navigator.canShare === "function"
            ? navigator.canShare({ files: [file], text: payload.messageText })
            : false;
        await navigator.share(
          canShareFile
            ? { title: fileName, text: payload.messageText, files: [file] }
            : { title: fileName, text: payload.messageText }
        );
        const msg = "Compartido mediante Web Share. Marca el documento como enviado cuando proceda.";
        setShareFeedback(msg);
        return msg;
      }

      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload.messageText);
      }
      const msg =
        payload.channel === "whatsapp"
          ? `Mensaje preparado para ${payload.recipientPhone || "WhatsApp"}. Marca como enviado tras remitirlo.`
          : "Documento listo localmente. Puedes abrir su PDF o marcar el envío manualmente.";
      setShareFeedback(msg);
      return msg;
    } catch {
      const msg = "Envío cancelado o no disponible; el documento sigue como pendiente de envío.";
      setShareFeedback(msg);
      return msg;
    }
  };

  const handleConfirmGate3 = async () => {
    if (!g3Draft) return;
    setValidationError(null);
    const parsed = Gate3InvoiceCommitPayloadSchema.safeParse(g3Draft);
    if (!parsed.success) {
      setValidationError(parsed.error.issues.map((i) => i.message).join(" · "));
      return;
    }
    const dirty = JSON.stringify(g3Draft) !== initialG3Json;
    await onResumeDecision(
      dirty
        ? {
            gate_id: "gate_3_invoice",
            action: "edit",
            edited_payload: parsed.data,
            client_validated_at_ms: Date.now(),
          }
        : {
            gate_id: "gate_3_invoice",
            action: "approve",
            client_validated_at_ms: Date.now(),
          }
    );
  };

  const handleConfirmGate4 = async () => {
    if (!g4Draft) return;
    setValidationError(null);
    const parsed = Gate4ShareCommitPayloadSchema.safeParse(g4Draft);
    if (!parsed.success) {
      setValidationError(parsed.error.issues.map((i) => i.message).join(" · "));
      return;
    }
    const dirty = JSON.stringify(g4Draft) !== initialG4Json;
    const res = await onResumeDecision(
      dirty
        ? {
            gate_id: "gate_4_share",
            action: "edit",
            edited_payload: parsed.data,
            client_validated_at_ms: Date.now(),
          }
        : {
            gate_id: "gate_4_share",
            action: "approve",
            client_validated_at_ms: Date.now(),
          }
    );

    if (!res || res.error_code !== null) {
      return;
    }

    const updatedPdfUri =
      res.active_widget?.ui_widget_type === "JobLifecycleActionWidget"
        ? res.active_widget.widget_payload.pdf_uri
        : lp.pdf_uri;

    const feedback = await triggerNativeOrWebShare({
      pdfUri: updatedPdfUri ?? lp.pdf_uri,
      docKind: parsed.data.document_kind,
      docId: parsed.data.document_id,
      messageText: parsed.data.message_text,
      channel: parsed.data.channel,
      recipientPhone: parsed.data.recipient_phone,
    });

    runtime.onGate4ShareFinished?.({
      docKind: parsed.data.document_kind,
      docId: parsed.data.document_id,
      shareFeedback: feedback,
    });
  };

  const handleReject = async (gateId: "gate_3_invoice" | "gate_4_share") => {
    setValidationError(null);
    await onResumeDecision({
      gate_id: gateId,
      action: "reject",
      rejection_reason: "Cancelado por el usuario",
      client_validated_at_ms: Date.now(),
    });
  };

  const handleMarkSentToday = async () => {
    setManualBusy(true);
    try {
      if (lp.invoice_id) {
        await new InvoicesRepository(runtime.executor).markSentManually(lp.invoice_id);
      } else if (lp.quote_id) {
        await new QuotesRepository(runtime.executor).markSentManually(lp.quote_id);
      }
      await loadEntities();
      await runtime.onDataMutated?.();
    } finally {
      setManualBusy(false);
    }
  };

  const handleAcceptQuote = async () => {
    if (!quote) return;
    setManualBusy(true);
    try {
      await new QuotesRepository(runtime.executor).acceptOrReject(quote.id, "aceptado");
      await loadEntities();
      await runtime.onDataMutated?.();
    } finally {
      setManualBusy(false);
    }
  };

  const hasAdvance = invoicesForJob.some((i) => i.series_type === "ANT");
  const hasFinal = invoicesForJob.some((i) => i.series_type === "FAC");

  return (
    <section
      data-testid="job-lifecycle-widget"
      data-mode={lp.mode}
      className="mt-2 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm text-slate-900 space-y-3"
    >
      <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2.5">
        <div>
          <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-800">
            {lp.mode === "preview_gate_3"
              ? canActGate3
                ? "Revisión de factura"
                : "Factura"
              : lp.mode === "preview_gate_4"
                ? canActGate4
                  ? "Preparar envío"
                  : "Envío"
                : lp.mode === "ready_to_share"
                  ? "Listo para compartir"
                  : "Ciclo de Obra"}
          </span>
          <h3 className="mt-1 text-sm font-bold text-slate-900">
            {job ? `${job.job_code} · ${job.title}` : `Obra ${lp.job_id}`}
          </h3>
          {quote && (
            <div className="text-xs text-slate-600">
              {quote.quote_code} · {formatCentsEs(quote.total_cents)} · Estado:{" "}
              <strong>{quote.status}</strong>
              {quote.sent_at_iso ? ` · Enviado ${quote.sent_at_iso}` : ""}
            </div>
          )}
          {invoice && (
            <div className="text-xs text-slate-600">
              {invoice.invoice_number} · {formatCentsEs(invoice.total_cents)} · Estado:{" "}
              <strong>{invoice.status}</strong>
              {invoice.sent_at_iso ? ` · Enviado ${invoice.sent_at_iso}` : ""}
            </div>
          )}
        </div>

        {(lp.pdf_uri || lp.invoice_id || lp.quote_id) && (
          <button
            type="button"
            data-testid="lifecycle-open-pdf-btn"
            onClick={() =>
              void handleOpenPdf(
                lp.pdf_uri,
                lp.invoice_id ? "invoice" : "quote",
                lp.invoice_id ?? lp.quote_id ?? ""
              )
            }
            className="min-h-10 rounded-xl border border-slate-300 bg-slate-50 px-3 text-xs font-bold text-slate-800"
          >
            Abrir PDF
          </button>
        )}
      </div>

      {lp.mode === "preview_gate_3" && g3Draft && (
        <div className="space-y-2.5">
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-2 text-xs text-amber-950">
            Bloqueo fiscal correlativo:{" "}
            <strong>
              {g3Draft.sub_intent === "advance_40" ? "Serie ANT (Anticipo 40 %)" : "Serie FAC (Liquidación final)"}
            </strong>
            . Verifica emisor y cliente conforme al RD 1619/2012.
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-semibold text-slate-700" htmlFor="g3-issued">
                Fecha emisión
              </label>
              <input
                id="g3-issued"
                type="date"
                disabled={!canActGate3 || isSubmitting}
                value={g3Draft.issued_at_iso}
                onChange={(e) => setG3Draft((p) => (p ? { ...p, issued_at_iso: e.target.value } : p))}
                className="mt-1 w-full rounded-xl border border-slate-300 px-2.5 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-700" htmlFor="g3-due">
                Vencimiento
              </label>
              <input
                id="g3-due"
                type="date"
                disabled={!canActGate3 || isSubmitting}
                value={g3Draft.due_at_iso}
                onChange={(e) => setG3Draft((p) => (p ? { ...p, due_at_iso: e.target.value } : p))}
                className="mt-1 w-full rounded-xl border border-slate-300 px-2.5 py-1.5 text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label className="block text-[11px] font-semibold text-slate-700" htmlFor="g3-em-name">
                Nombre / Razón social emisor *
              </label>
              <input
                id="g3-em-name"
                type="text"
                disabled={!canActGate3 || isSubmitting}
                value={g3Draft.emitter_name}
                onChange={(e) => setG3Draft((p) => (p ? { ...p, emitter_name: e.target.value } : p))}
                className="mt-1 w-full rounded-xl border border-slate-300 px-2.5 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-700" htmlFor="g3-em-nif">
                NIF/CIF emisor *
              </label>
              <input
                id="g3-em-nif"
                type="text"
                disabled={!canActGate3 || isSubmitting}
                value={g3Draft.emitter_nif}
                onChange={(e) =>
                  setG3Draft((p) => (p ? { ...p, emitter_nif: e.target.value.toUpperCase() } : p))
                }
                className="mt-1 w-full rounded-xl border border-slate-300 px-2.5 py-1.5 text-xs"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-700" htmlFor="g3-em-addr">
              Domicilio fiscal emisor *
            </label>
            <input
              id="g3-em-addr"
              type="text"
              disabled={!canActGate3 || isSubmitting}
              value={g3Draft.emitter_fiscal_address}
              onChange={(e) =>
                setG3Draft((p) => (p ? { ...p, emitter_fiscal_address: e.target.value } : p))
              }
              className="mt-1 w-full rounded-xl border border-slate-300 px-2.5 py-1.5 text-xs"
            />
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label className="block text-[11px] font-semibold text-slate-700" htmlFor="g3-cl-nif">
                NIF/DNI cliente *
              </label>
              <input
                id="g3-cl-nif"
                data-testid="gate3-client-nif-input"
                type="text"
                disabled={!canActGate3 || isSubmitting}
                value={g3Draft.client_nif}
                onChange={(e) =>
                  setG3Draft((p) => (p ? { ...p, client_nif: e.target.value.toUpperCase() } : p))
                }
                placeholder="Ej: 12345678Z"
                className="mt-1 w-full rounded-xl border border-slate-300 px-2.5 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-700" htmlFor="g3-cl-addr">
                Domicilio fiscal cliente *
              </label>
              <input
                id="g3-cl-addr"
                data-testid="gate3-client-address-input"
                type="text"
                disabled={!canActGate3 || isSubmitting}
                value={g3Draft.client_fiscal_address}
                onChange={(e) =>
                  setG3Draft((p) => (p ? { ...p, client_fiscal_address: e.target.value } : p))
                }
                placeholder="Calle, CP, Ciudad"
                className="mt-1 w-full rounded-xl border border-slate-300 px-2.5 py-1.5 text-xs"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-700" htmlFor="g3-notes">
              Notas de factura
            </label>
            <textarea
              id="g3-notes"
              rows={2}
              disabled={!canActGate3 || isSubmitting}
              value={g3Draft.notes}
              onChange={(e) => setG3Draft((p) => (p ? { ...p, notes: e.target.value } : p))}
              className="mt-1 w-full rounded-xl border border-slate-300 px-2.5 py-1.5 text-xs"
            />
          </div>

          {validationError && (
            <div role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-2 text-xs text-rose-800">
              {validationError}
            </div>
          )}

          {canActGate3 && (
            <div className="flex gap-2">
              <button
                type="button"
                data-testid="gate3-reject-btn"
                disabled={isSubmitting}
                onClick={() => void handleReject("gate_3_invoice")}
                className="min-h-12 rounded-xl border border-rose-300 bg-white px-4 text-xs font-bold text-rose-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                data-testid="gate3-approve-btn"
                disabled={isSubmitting}
                onClick={() => void handleConfirmGate3()}
                className="min-h-12 flex-1 rounded-xl bg-orange-600 px-4 text-sm font-bold text-white shadow-sm"
              >
                {isSubmitting ? "Emitiendo factura..." : "Emitir factura correlativa"}
              </button>
            </div>
          )}
        </div>
      )}

      {lp.mode === "preview_gate_4" && g4Draft && (
        <div className="space-y-2.5">
          <div className="flex gap-2">
            {(["whatsapp", "share_sheet"] as const).map((ch) => (
              <button
                key={ch}
                type="button"
                disabled={!canActGate4 || isSubmitting}
                onClick={() => setG4Draft((p) => (p ? { ...p, channel: ch } : p))}
                className={`min-h-10 flex-1 rounded-xl px-3 text-xs font-bold ${
                  g4Draft.channel === ch
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-700"
                }`}
              >
                {ch === "whatsapp" ? "WhatsApp" : "Otras apps / Compartir"}
              </button>
            ))}
          </div>

          {g4Draft.channel === "whatsapp" && (
            <div>
              <label className="block text-[11px] font-semibold text-slate-700" htmlFor="g4-phone">
                Teléfono del cliente
              </label>
              <input
                id="g4-phone"
                data-testid="gate4-phone-input"
                type="tel"
                disabled={!canActGate4 || isSubmitting}
                value={g4Draft.recipient_phone}
                onChange={(e) =>
                  setG4Draft((p) => (p ? { ...p, recipient_phone: e.target.value } : p))
                }
                placeholder="+34600112233"
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          )}

          <div>
            <label className="block text-[11px] font-semibold text-slate-700" htmlFor="g4-msg">
              Mensaje para el cliente
            </label>
            <textarea
              id="g4-msg"
              rows={3}
              disabled={!canActGate4 || isSubmitting}
              value={g4Draft.message_text}
              onChange={(e) =>
                setG4Draft((p) => (p ? { ...p, message_text: e.target.value } : p))
              }
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
            />
          </div>

          {validationError && (
            <div role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-2 text-xs text-rose-800">
              {validationError}
            </div>
          )}

          {canActGate4 && (
            <div className="flex gap-2">
              <button
                type="button"
                data-testid="gate4-reject-btn"
                disabled={isSubmitting}
                onClick={() => void handleReject("gate_4_share")}
                className="min-h-12 rounded-xl border border-rose-300 bg-white px-4 text-xs font-bold text-rose-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                data-testid="gate4-approve-btn"
                disabled={isSubmitting}
                onClick={() => void handleConfirmGate4()}
                className="min-h-12 flex-1 rounded-xl bg-orange-600 px-4 text-sm font-bold text-white shadow-sm"
              >
                {isSubmitting ? "Preparando..." : "Preparar y compartir documento"}
              </button>
            </div>
          )}
        </div>
      )}

      {(lp.mode === "overview" || lp.mode === "ready_to_share") && (
        <div className="space-y-2">
          {shareFeedback && (
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-2 text-xs text-sky-900">
              {shareFeedback}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {quote && (quote.status === "borrador" || quote.status === "enviado") && (
              <button
                type="button"
                data-testid="lifecycle-accept-quote-btn"
                disabled={manualBusy}
                onClick={() => void handleAcceptQuote()}
                className="min-h-10 rounded-xl bg-emerald-600 px-3 text-xs font-bold text-white"
              >
                Marcar presupuesto aceptado
              </button>
            )}

            {(lp.invoice_id || lp.quote_id) &&
              ((invoice && !invoice.sent_at_iso) || (!invoice && quote && !quote.sent_at_iso)) && (
                <button
                  type="button"
                  data-testid="lifecycle-mark-sent-btn"
                  disabled={manualBusy}
                  onClick={() => void handleMarkSentToday()}
                  className="min-h-10 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-800"
                >
                  Confirmar envío manual
                </button>
              )}

            {lp.quote_id && !hasAdvance && !hasFinal && (
              <button
                type="button"
                data-testid="lifecycle-request-advance-btn"
                onClick={() =>
                  void onQuickAction({
                    id: "qa_req_advance",
                    label: "Facturar anticipo 40 %",
                    action_type: "request_advance_gate",
                    payload: {
                      target_ids: { job_id: lp.job_id, quote_id: lp.quote_id ?? undefined },
                      billing_sub_intent: "advance_40",
                    },
                  })
                }
                className="min-h-10 rounded-xl bg-orange-600 px-3 text-xs font-bold text-white"
              >
                Facturar anticipo 40 %
              </button>
            )}

            {lp.quote_id && !hasFinal && (
              <button
                type="button"
                data-testid="lifecycle-request-final-btn"
                onClick={() =>
                  void onQuickAction({
                    id: "qa_req_final",
                    label: "Emitir factura final",
                    action_type: "request_invoice_gate",
                    payload: {
                      target_ids: { job_id: lp.job_id, quote_id: lp.quote_id ?? undefined },
                      billing_sub_intent: "final_invoice",
                    },
                  })
                }
                className="min-h-10 rounded-xl bg-slate-900 px-3 text-xs font-bold text-white"
              >
                {hasAdvance ? "Factura final (60 % restante)" : "Emitir factura final"}
              </button>
            )}

            {(lp.invoice_id || lp.quote_id) && (
              <button
                type="button"
                data-testid="lifecycle-request-share-btn"
                onClick={() =>
                  void onQuickAction({
                    id: "qa_req_share",
                    label: "Compartir documento",
                    action_type: "request_share_gate",
                    payload: {
                      target_ids: {
                        job_id: lp.job_id,
                        ...(lp.invoice_id
                          ? { invoice_id: lp.invoice_id }
                          : { quote_id: lp.quote_id ?? undefined }),
                      },
                    },
                  })
                }
                className="min-h-10 rounded-xl border border-orange-300 bg-orange-50 px-3 text-xs font-bold text-orange-900"
              >
                Enviar por WhatsApp / Share
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
