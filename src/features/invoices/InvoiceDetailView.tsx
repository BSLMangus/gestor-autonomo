import { ArrowLeft, CheckCircle2, FileText, RotateCcw, Send, Share2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  InvoiceRow,
  JobRow,
  LocalFileBridge,
  QuoteItemRow,
  QuoteRow,
  SqliteExecutor,
} from "../../core/contracts/types";
import { InvoicesRepository } from "../../core/db/repositories/invoicesRepo";
import { JobsRepository } from "../../core/db/repositories/jobsRepo";
import { QuotesRepository } from "../../core/db/repositories/quotesRepo";
import { SettingsRepository } from "../../core/db/repositories/settingsRepo";
import type { DocumentOpenerService } from "../../core/files/documentOpener";
import { getLocalTodayIso } from "../../core/fiscal/dateQuarter";
import {
  deriveInvoiceAdvancePercent,
  formatCentsEs,
  formatPercentEs,
} from "../../core/fiscal/fiscalEngine";
import type { PdfPort } from "../../core/ports/mediaPorts";
import { ConfirmDeleteDialog } from "../../ui/ConfirmDeleteDialog";

interface InvoiceDetailViewProps {
  invoiceId: string;
  executor: SqliteExecutor;
  fileBridge: LocalFileBridge;
  pdfPort: PdfPort;
  documentOpener: DocumentOpenerService;
  refreshTick: number;
  registerBackHandler?: (priority: number, handler: () => boolean) => () => void;
  onBack: () => void;
  onOpenJob: (jobId: string) => void;
  onOpenClient: (clientId: string) => void;
  onOpenQuote: (quoteId: string) => void;
  onOpenInvoice: (invoiceId: string) => void;
  onShareInvoice: (invoice: InvoiceRow) => Promise<void>;
  onDataChanged: () => Promise<void>;
}

function formatThousandthsEs(thousandths: number): string {
  const val = thousandths / 1000;
  return Number.isInteger(val) ? String(val) : val.toFixed(2).replace(/0+$/, "").replace(".", ",");
}

function kindLabel(
  kind: InvoiceRow["kind"],
  advancePercent?: number
): string {
  switch (kind) {
    case "advance_40":
      return `Factura de anticipo (${formatPercentEs(advancePercent ?? 40)})`;
    case "final":
      return "Factura final / liquidación";
    case "full":
      return "Factura completa";
  }
}

export function InvoiceDetailView({
  invoiceId,
  executor,
  fileBridge,
  pdfPort,
  documentOpener,
  refreshTick,
  registerBackHandler,
  onBack,
  onOpenJob,
  onOpenClient,
  onOpenQuote,
  onOpenInvoice,
  onShareInvoice,
  onDataChanged,
}: InvoiceDetailViewProps) {
  const [loading, setLoading] = useState(true);
  const [invoice, setInvoice] = useState<InvoiceRow | null>(null);
  const [job, setJob] = useState<JobRow | null>(null);
  const [quote, setQuote] = useState<QuoteRow | null>(null);
  const [quoteItems, setQuoteItems] = useState<QuoteItemRow[]>([]);
  const [advanceInvoice, setAdvanceInvoice] = useState<InvoiceRow | null>(null);
  const [emitterPhone, setEmitterPhone] = useState("");
  const [emitterIban, setEmitterIban] = useState("");
  const [paidDateInput, setPaidDateInput] = useState(getLocalTodayIso());
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadInvoice = async () => {
    setLoading(true);
    try {
      const invRepo = new InvoicesRepository(executor);
      const quotesRepo = new QuotesRepository(executor);
      const inv = await invRepo.getById(invoiceId);
      if (!inv) {
        setInvoice(null);
        setJob(null);
        setQuote(null);
        setQuoteItems([]);
        setAdvanceInvoice(null);
        return;
      }

      const [jobRow, quoteRow, qItems, advInv, settings] = await Promise.all([
        new JobsRepository(executor).getById(inv.job_id),
        quotesRepo.getById(inv.quote_id),
        quotesRepo.getItems(inv.quote_id),
        inv.advance_invoice_id ? invRepo.getById(inv.advance_invoice_id) : Promise.resolve(null),
        new SettingsRepository(executor).getAppSettings(),
      ]);

      setInvoice(inv);
      setJob(jobRow);
      setQuote(quoteRow);
      setQuoteItems(qItems);
      setAdvanceInvoice(advInv);
      setEmitterPhone(settings.emitter_phone);
      setEmitterIban(settings.emitter_iban);
      setPaidDateInput(inv.paid_at_iso ?? getLocalTodayIso());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setErrorMsg(null);
    setStatusMsg(null);
    setConfirmDeleteOpen(false);
    setDeleteError(null);
    void loadInvoice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId, executor, refreshTick]);

  const handleDeleteInvoice = async () => {
    if (!invoice) return;
    setDeleteError(null);
    setBusy(true);
    try {
      await new InvoicesRepository(executor).delete(invoice.id, fileBridge);
      await onDataChanged();
      setConfirmDeleteOpen(false);
      onBack();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const runAction = async (fn: () => Promise<void>, successMessage?: string) => {
    setErrorMsg(null);
    setStatusMsg(null);
    setBusy(true);
    try {
      await fn();
      await loadInvoice();
      await onDataChanged();
      if (successMessage) setStatusMsg(successMessage);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading && !invoice) {
    return (
      <div className="cotton-paper flex flex-1 items-center justify-center p-6 text-xs text-[#6B6860] bg-[#F9F7F2] font-sans">
        Cargando detalle de factura...
      </div>
    );
  }

  if (!invoice) {
    return (
      <div
        data-testid="invoice-not-found-view"
        className="cotton-paper flex flex-1 flex-col items-center justify-center p-6 text-center space-y-3 bg-[#F9F7F2] font-sans"
      >
        <p className="text-sm font-bold text-[#2C2621]">Factura no encontrada</p>
        <button
          type="button"
          onClick={onBack}
          className="min-h-11 rounded-xl bg-[#4B7094] px-4 text-xs font-semibold text-[#FFFDF9] cursor-pointer"
        >
          Volver
        </button>
      </div>
    );
  }

  const isPaid = invoice.status === "pagado";
  const isOverdue = invoice.status === "vencido";
  const deductedTotalCents =
    invoice.advance_deducted_base_cents + invoice.advance_deducted_vat_cents;
  const baseFiscalNote =
    "Se borrará el PDF generado y se recalcularán los totales de tu Hucha Fiscal.";
  const sentOrPaidPrefix =
    isPaid || invoice.sent_at_iso
      ? `Atención: esta factura ya figura como ${isPaid ? "cobrada" : "enviada"}. Si ya se la entregaste al cliente, en facturación oficial corresponde emitir una rectificativa; elimínala solo si fue un error de registro. `
      : "";
  const invoiceWarningNote = `${sentOrPaidPrefix}${baseFiscalNote}`;

  return (
    <div
      data-testid="invoice-detail-view"
      className="cotton-paper flex flex-1 flex-col overflow-y-auto overflow-x-hidden no-scrollbar p-4 pb-8 space-y-4 bg-[#F9F7F2] text-[#2C2621] font-sans text-xs"
    >
      {/* Barra superior */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          data-testid="back-from-invoice-btn"
          onClick={onBack}
          className="paper-cream inline-flex min-h-[42px] items-center gap-1.5 rounded-full border border-[#E5DFD2] bg-[#FFFDF7] px-3.5 text-[12px] font-semibold text-[#2C2621] hover:border-[#EA580C] cursor-pointer shadow-xs"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" />
          <span>Volver</span>
        </button>

        <button
          type="button"
          data-testid="invoice-detail-pdf-btn"
          disabled={busy}
          onClick={() =>
            void runAction(async () => {
              await documentOpener.openPdf(invoice.pdf_uri, "invoice", invoice.id, pdfPort);
            })
          }
          className="paper-cream inline-flex min-h-[42px] items-center gap-1.5 rounded-full border border-[#E5DFD2] bg-[#FFFDF7] px-4 text-[12px] font-semibold text-[#2C2621] hover:border-[#EA580C] cursor-pointer shadow-xs"
        >
          <FileText className="h-4 w-4 shrink-0" />
          <span>PDF</span>
        </button>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-2xl border border-[#DC2626]/30 bg-[#FAD2D8] p-3 text-xs text-[#5A121C] break-words"
        >
          {errorMsg}
        </div>
      )}
      {statusMsg && (
        <div
          role="status"
          className="rounded-2xl border border-[#059669]/30 bg-[#D4EDDA] p-3 font-semibold text-[#1B3A24] break-words"
        >
          {statusMsg}
        </div>
      )}

      {/* Cabecera */}
      <section className="receipt-slip mt-1 border-x border-[#E5DFD2] p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono font-mono-nums text-[14px] font-bold text-[#6B6860] tabular-nums">
                {invoice.invoice_number}
              </span>
              <span
                className={`paper-stamp rounded-sm px-2 py-0.5 text-[10px] font-semibold uppercase ${
                  isPaid
                    ? "status-emerald"
                    : isOverdue
                      ? "status-tangerine"
                      : "status-gold"
                }`}
              >
                {isPaid ? "Cobrada" : isOverdue ? "Vencida" : "Pendiente cobro"}
              </span>
            </div>
            <div className="font-semibold text-[#2C2621]">
              {kindLabel(invoice.kind, deriveInvoiceAdvancePercent(invoice, quote))}
            </div>
            <div className="text-[11px] text-[#6B6860]">
              Emisión: <strong className="font-mono tabular-nums text-[#2C2621]">{invoice.issued_at_iso}</strong> · Vencimiento:{" "}
              <strong className="font-mono tabular-nums text-[#2C2621]">{invoice.due_at_iso}</strong> · {invoice.quarter}
            </div>
            <div className="text-[11px] text-[#6B6860]">
              {invoice.sent_at_iso ? `Enviada el ${invoice.sent_at_iso}` : "Pendiente de envío"}
              {invoice.paid_at_iso ? ` · Cobrada el ${invoice.paid_at_iso}` : ""}
            </div>
          </div>

          <div className="shrink-0 text-right">
            <div className="text-[11px] text-[#6B6860]">Total factura</div>
            <div className="highlighter-yellow font-mono font-mono-nums text-[18px] font-bold text-[#2C2621] tabular-nums">
              {formatCentsEs(invoice.total_cents)}
            </div>
          </div>
        </div>
      </section>

      {/* Emisor y Cliente (datos fiscales RD 1619/2012) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <section className="paper-sheet rounded-[20px] border border-[#E5DFD2] bg-[#FFFDF7] p-4 space-y-1.5">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[#6B6860]">
            Emisor
          </h3>
          <div className="break-words [overflow-wrap:anywhere] text-[13px] font-bold text-[#2C2621]">
            {invoice.emitter_name_snapshot || "Autónomo"}
          </div>
          <div className="text-[#6B6860]">
            <span className="font-semibold text-[#2C2621]">NIF/CIF:</span>{" "}
            <span className="font-mono tabular-nums">{invoice.emitter_nif_snapshot}</span>
          </div>
          <div className="break-words [overflow-wrap:anywhere] text-[#6B6860]">
            {invoice.emitter_address_snapshot}
          </div>
          {emitterPhone && (
            <div className="font-mono tabular-nums text-[#6B6860]">Tel: {emitterPhone}</div>
          )}
          {emitterIban && (
            <div className="break-all font-mono font-mono-nums text-[11px] font-semibold text-[#2C2621] pt-1 tabular-nums">
              IBAN: {emitterIban}
            </div>
          )}
        </section>

        <section className="paper-sheet rounded-[20px] border border-[#E5DFD2] bg-[#FFFDF7] p-4 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[#6B6860]">
              Cliente
            </h3>
            <button
              type="button"
              onClick={() => onOpenClient(invoice.client_id)}
              className="text-[11px] font-semibold text-[#D04B00] hover:underline cursor-pointer"
            >
              Ver ficha →
            </button>
          </div>
          <div className="break-words [overflow-wrap:anywhere] text-[13px] font-bold text-[#2C2621]">
            {invoice.client_name_snapshot}
          </div>
          <div className="text-[#6B6860]">
            <span className="font-semibold text-[#2C2621]">NIF/CIF:</span>{" "}
            <span className="font-mono tabular-nums">{invoice.client_nif_snapshot}</span>
          </div>
          <div className="break-words [overflow-wrap:anywhere] text-[#6B6860]">
            {invoice.client_address_snapshot}
          </div>
          {invoice.client_phone_snapshot && (
            <div className="font-mono tabular-nums text-[#6B6860]">Tel: {invoice.client_phone_snapshot}</div>
          )}
        </section>
      </div>

      {/* Obra y presupuesto de referencia */}
      <section className="ruled-index rounded-[20px] border border-[#E5DFD2] p-4 space-y-2.5">
        <h3 className="text-[13px] font-semibold text-[#2C2621]">Obra y presupuesto de origen</h3>
        <div className="space-y-1">
          <div className="break-words [overflow-wrap:anywhere] font-semibold text-[#2C2621]">
            {job ? `${job.job_code} · ${job.title}` : invoice.job_id}
          </div>
          <div className="flex flex-wrap gap-3 pt-0.5">
            {job && (
              <button
                type="button"
                onClick={() => onOpenJob(job.id)}
                className="text-[11px] font-semibold text-[#D04B00] hover:underline cursor-pointer"
              >
                Ver obra →
              </button>
            )}
            {quote && (
              <button
                type="button"
                onClick={() => onOpenQuote(quote.id)}
                className="text-[11px] font-semibold text-[#D04B00] hover:underline cursor-pointer"
              >
                Ver presupuesto {quote.quote_code} →
              </button>
            )}
          </div>
        </div>

        {quoteItems.length > 0 && (
          <div className="space-y-1.5 border-t border-dashed border-[#E5DFD2] pt-2.5">
            <div className="text-[11px] font-semibold text-[#6B6860]">
              Partidas del presupuesto de referencia ({quoteItems.length})
            </div>
            {quoteItems.map((item) => (
              <div
                key={item.id}
                className="rounded-xl border border-[#E5DFD2] bg-[#FFFDF7]/90 p-2.5 space-y-1"
              >
                <div className="break-words [overflow-wrap:anywhere] font-semibold text-[#2C2621]">
                  {item.description}
                </div>
                <div className="flex justify-between text-[11px] text-[#6B6860] font-mono font-mono-nums tabular-nums">
                  <span>
                    {formatThousandthsEs(item.quantity_thousandths)} {item.unit} ×{" "}
                    {formatCentsEs(item.unit_price_cents)}
                  </span>
                  <span className="font-bold text-[#2C2621]">
                    {formatCentsEs(item.line_subtotal_cents)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Desglose económico */}
      <section className="paper-sheet rounded-[20px] border border-[#E5DFD2] bg-[#FFFDF7] p-4 space-y-2">
        <h3 className="text-[13px] font-semibold text-[#2C2621]">Desglose fiscal</h3>
        <div className="rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] p-3 space-y-1.5">
          <div className="flex justify-between text-[#6B6860]">
            <span>Base imponible factura</span>
            <span className="font-mono font-mono-nums font-semibold text-[#2C2621] tabular-nums">
              {formatCentsEs(invoice.base_cents)}
            </span>
          </div>
          <div className="flex justify-between text-[#6B6860]">
            <span>Cuota IVA ({invoice.vat_rate} %)</span>
            <span className="font-mono font-mono-nums font-semibold text-[#2C2621] tabular-nums">
              {formatCentsEs(invoice.vat_cents)}
            </span>
          </div>
          {deductedTotalCents > 0 && (
            <div className="flex items-center justify-between gap-2 text-[#6B6860] border-t border-dashed border-[#E5DFD2] pt-1.5">
              <span>
                Anticipo deducido{" "}
                {advanceInvoice && (
                  <button
                    type="button"
                    onClick={() => onOpenInvoice(advanceInvoice.id)}
                    className="font-mono font-semibold text-[#D04B00] underline cursor-pointer"
                  >
                    ({advanceInvoice.invoice_number})
                  </button>
                )}
              </span>
              <span className="font-mono font-mono-nums font-semibold text-[#2C2621] tabular-nums">
                -{formatCentsEs(deductedTotalCents)}
              </span>
            </div>
          )}
          <div className="flex justify-between border-t border-dashed border-[#E5DFD2] pt-1.5 text-[14px] font-bold text-[#2C2621]">
            <span>Total a pagar</span>
            <span className="highlighter-yellow font-mono font-mono-nums tabular-nums">{formatCentsEs(invoice.total_cents)}</span>
          </div>
        </div>
      </section>

      {/* Notas */}
      <section className="ruled-index rounded-[20px] border border-[#E5DFD2] p-4 space-y-1.5">
        <h3 className="text-[13px] font-semibold text-[#2C2621]">Notas legales / Forma de pago</h3>
        <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[#6B6860] leading-relaxed">
          {invoice.notes.trim() || "Sin notas adicionales."}
        </p>
      </section>

      {/* Acciones */}
      <section
        data-testid="invoice-detail-actions"
        className="paper-sheet rounded-[20px] border border-[#E5DFD2] bg-[#FFFDF7] p-4 space-y-3"
      >
        <h3 className="text-[13px] font-semibold text-[#2C2621]">Acciones de factura</h3>

        {!isPaid && (
          <label className="flex items-center justify-between gap-2 rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] px-3 py-2">
            <span className="text-[11px] font-semibold text-[#6B6860]">
              Fecha de cobro
            </span>
            <input
              type="date"
              aria-label="Fecha de cobro"
              value={paidDateInput}
              onChange={(e) => setPaidDateInput(e.target.value)}
              className="rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] px-2 py-1 font-mono tabular-nums text-xs text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
            />
          </label>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            data-testid="invoice-detail-toggle-paid-btn"
            disabled={busy}
            onClick={() =>
              void runAction(
                async () => {
                  await new InvoicesRepository(executor).markPaid(
                    invoice.id,
                    isPaid ? null : paidDateInput || getLocalTodayIso()
                  );
                },
                isPaid ? "Factura marcada nuevamente como pendiente." : "Cobro registrado."
              )
            }
            className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-3 font-semibold cursor-pointer disabled:opacity-50 ${
              isPaid
                ? "status-gold"
                : "bg-[#059669] text-white"
            }`}
          >
            {isPaid ? (
              <>
                <RotateCcw className="h-4 w-4 shrink-0" />
                <span>Revertir cobro</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>Marcar cobrada</span>
              </>
            )}
          </button>

          <button
            type="button"
            data-testid="invoice-detail-open-pdf-btn"
            disabled={busy}
            onClick={() =>
              void runAction(async () => {
                await documentOpener.openPdf(invoice.pdf_uri, "invoice", invoice.id, pdfPort);
              })
            }
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 font-semibold text-[#2C2621] hover:border-[#EA580C] cursor-pointer disabled:opacity-50"
          >
            <FileText className="h-4 w-4 shrink-0" />
            <span>Abrir PDF</span>
          </button>

          {!invoice.sent_at_iso && (
            <button
              type="button"
              data-testid="invoice-detail-mark-sent-btn"
              disabled={busy}
              onClick={() =>
                void runAction(
                  async () => {
                    await new InvoicesRepository(executor).markSentManually(invoice.id);
                  },
                  "Factura marcada como enviada."
                )
              }
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 font-semibold text-[#6B6860] hover:border-[#EA580C] cursor-pointer disabled:opacity-50"
            >
              <Send className="h-4 w-4 shrink-0" />
              <span>Marcar enviada</span>
            </button>
          )}

          <button
            type="button"
            data-testid="invoice-detail-share-btn"
            disabled={busy}
            onClick={() => void onShareInvoice(invoice)}
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[#E5DFD2] bg-[#FFD6B0] px-3 font-semibold text-[#4A2500] cursor-pointer disabled:opacity-50"
          >
            <Share2 className="h-4 w-4 shrink-0" />
            <span>Compartir</span>
          </button>
        </div>
      </section>

      {/* Zona de borrado */}
      <section className="paper-sheet rounded-[20px] border border-[#E5DFD2] bg-[#FFFDF7] p-4">
        <button
          type="button"
          data-testid="invoice-detail-delete-btn"
          disabled={busy}
          onClick={() => {
            setDeleteError(null);
            setConfirmDeleteOpen(true);
          }}
          className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl border border-[#DC2626]/30 bg-[#FFFDF7] font-semibold text-[#DC2626] hover:bg-[#FAD2D8] cursor-pointer disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4 shrink-0" />
          <span>Eliminar factura</span>
        </button>
      </section>

      <ConfirmDeleteDialog
        open={confirmDeleteOpen}
        title={`¿Eliminar factura ${invoice.invoice_number}?`}
        description="Se eliminará el registro de esta factura y su archivo PDF. Esta acción no se puede deshacer."
        warningNote={invoiceWarningNote}
        errorMsg={deleteError}
        busy={busy}
        confirmTestId="invoice-detail-confirm-delete-btn"
        registerBackHandler={registerBackHandler}
        onCancel={() => {
          if (!busy) {
            setConfirmDeleteOpen(false);
            setDeleteError(null);
          }
        }}
        onConfirm={handleDeleteInvoice}
      />
    </div>
  );
}
