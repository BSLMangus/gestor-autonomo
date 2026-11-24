import { ArrowLeft, CheckCircle2, FileText, Pencil, Send, Share2, Trash2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  ActionType,
  ClientRow,
  InvoiceRow,
  JobRow,
  LocalFileBridge,
  QuoteItemRow,
  QuoteRow,
  QuoteStatus,
  SqliteExecutor,
} from "../../core/contracts/types";
import { ClientsRepository } from "../../core/db/repositories/clientsRepo";
import { InvoicesRepository } from "../../core/db/repositories/invoicesRepo";
import { JobsRepository } from "../../core/db/repositories/jobsRepo";
import { QuotesRepository } from "../../core/db/repositories/quotesRepo";
import { SettingsRepository } from "../../core/db/repositories/settingsRepo";
import type { DocumentOpenerService } from "../../core/files/documentOpener";
import { formatLocalDateIso, getLocalTodayIso } from "../../core/fiscal/dateQuarter";
import {
  computePaymentScheduleAmounts,
  computeQuoteValidUntilIso,
  formatCentsEs,
  formatPercentEs,
  parseQuotePaymentMethodsJson,
  parseQuotePaymentScheduleJson,
  resolveQuoteAdvancePolicy,
} from "../../core/fiscal/fiscalEngine";
import type { PdfPort } from "../../core/ports/mediaPorts";
import { ConfirmDeleteDialog } from "../../ui/ConfirmDeleteDialog";
import { PAYMENT_METHOD_LABELS } from "./QuotePaymentValidityEditor";

interface QuoteDetailViewProps {
  quoteId: string;
  executor: SqliteExecutor;
  fileBridge: LocalFileBridge;
  pdfPort: PdfPort;
  documentOpener: DocumentOpenerService;
  refreshTick: number;
  registerBackHandler?: (priority: number, handler: () => boolean) => () => void;
  onBack: () => void;
  onOpenJob: (jobId: string) => void;
  onOpenClient: (clientId: string) => void;
  onOpenInvoice: (invoiceId: string) => void;
  onStartJobQuote: (jobId: string) => Promise<void>;
  onRunQuoteLifecycleAction: (params: {
    action_type: Extract<
      ActionType,
      "request_advance_gate" | "request_invoice_gate" | "request_share_gate"
    >;
    job_id: string;
    quote_id: string;
    billing_sub_intent?: "advance_40" | "final_invoice" | "share";
  }) => Promise<void>;
  onDataChanged: () => Promise<void>;
}

const STATUS_BADGES: Record<QuoteStatus, { label: string; cls: string }> = {
  borrador: {
    label: "Borrador",
    cls: "bg-terracotta-soft text-on-primary-container border-outline-variant",
  },
  enviado: {
    label: "Enviado",
    cls: "bg-info-container text-on-info-container border-info/20",
  },
  aceptado: {
    label: "Aceptado",
    cls: "bg-success-container text-on-success-container border-emerald-free/20",
  },
  rechazado: {
    label: "Rechazado",
    cls: "bg-error-container text-on-error-container border-coral-alert/20",
  },
};

function formatThousandthsEs(thousandths: number): string {
  const val = thousandths / 1000;
  return Number.isInteger(val) ? String(val) : val.toFixed(2).replace(/0+$/, "").replace(".", ",");
}

export function QuoteDetailView({
  quoteId,
  executor,
  fileBridge,
  pdfPort,
  documentOpener,
  refreshTick,
  registerBackHandler,
  onBack,
  onOpenJob,
  onOpenClient,
  onOpenInvoice,
  onStartJobQuote,
  onRunQuoteLifecycleAction,
  onDataChanged,
}: QuoteDetailViewProps) {
  const [loading, setLoading] = useState(true);
  const [quote, setQuote] = useState<QuoteRow | null>(null);
  const [items, setItems] = useState<QuoteItemRow[]>([]);
  const [job, setJob] = useState<JobRow | null>(null);
  const [client, setClient] = useState<ClientRow | null>(null);
  const [allClients, setAllClients] = useState<ClientRow[]>([]);
  const [emitterIban, setEmitterIban] = useState("");
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [assignClientOpen, setAssignClientOpen] = useState(false);
  const [assignMode, setAssignMode] = useState<"existing" | "new">("existing");
  const [assignClientId, setAssignClientId] = useState("");
  const [assignNewName, setAssignNewName] = useState("");
  const [assignNewNif, setAssignNewNif] = useState("");
  const [assignNewAddress, setAssignNewAddress] = useState("");
  const [assignNewPhone, setAssignNewPhone] = useState("");

  const loadQuote = async () => {
    setLoading(true);
    try {
      const quotesRepo = new QuotesRepository(executor);
      const clientsRepo = new ClientsRepository(executor);
      const q = await quotesRepo.getById(quoteId);
      if (!q) {
        setQuote(null);
        setItems([]);
        setJob(null);
        setClient(null);
        setInvoices([]);
        return;
      }
      const [lineItems, jobRow, clientRow, jobInvoices, clientsPage, settings] = await Promise.all([
        quotesRepo.getItems(q.id),
        new JobsRepository(executor).getById(q.job_id),
        q.client_id ? clientsRepo.getById(q.client_id) : Promise.resolve(null),
        new InvoicesRepository(executor).listByJobId(q.job_id),
        clientsRepo.listPaginated({ limit: 100, offset: 0 }),
        new SettingsRepository(executor).getAppSettings(),
      ]);
      setQuote(q);
      setItems(lineItems);
      setJob(jobRow);
      setClient(clientRow);
      setInvoices(jobInvoices.filter((inv) => inv.quote_id === q.id));
      setAllClients(clientsPage.items);
      setEmitterIban(settings.emitter_iban);
      if (!assignClientId && clientsPage.items[0]) {
        setAssignClientId(clientsPage.items[0].id);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setErrorMsg(null);
    setStatusMsg(null);
    setConfirmDeleteOpen(false);
    setDeleteError(null);
    void loadQuote();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteId, executor, refreshTick]);

  const handleDeleteQuote = async () => {
    if (!quote) return;
    setDeleteError(null);
    setBusy(true);
    try {
      await new QuotesRepository(executor).delete(quote.id, fileBridge);
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
      await loadQuote();
      await onDataChanged();
      if (successMessage) setStatusMsg(successMessage);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading && !quote) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-xs text-on-surface-variant">
        Cargando detalle de presupuesto...
      </div>
    );
  }

  if (!quote) {
    return (
      <div
        data-testid="quote-not-found-view"
        className="flex flex-1 flex-col items-center justify-center p-6 text-center space-y-3"
      >
        <p className="text-sm font-bold text-on-surface">Presupuesto no encontrado</p>
        <button
          type="button"
          onClick={onBack}
          className="min-h-11 rounded-xl bg-secondary px-4 text-xs font-semibold text-on-secondary cursor-pointer"
        >
          Volver a Presupuestos
        </button>
      </div>
    );
  }

  const handleAssignClientSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quote) return;
    setErrorMsg(null);
    setStatusMsg(null);
    setBusy(true);
    try {
      const clientsRepo = new ClientsRepository(executor);
      const quotesRepo = new QuotesRepository(executor);
      let targetClientId = assignClientId;
      if (assignMode === "new") {
        if (!assignNewName.trim()) {
          throw new Error("Introduce el nombre del cliente.");
        }
        const createdClient = await clientsRepo.create({
          name: assignNewName.trim(),
          nif: assignNewNif.trim(),
          fiscal_address: assignNewAddress.trim(),
          phone: assignNewPhone.trim(),
          email: "",
          notes: "",
        });
        targetClientId = createdClient.id;
      }
      if (!targetClientId) {
        throw new Error("Selecciona un cliente para asignar.");
      }
      await quotesRepo.assignClient(quote.id, targetClientId, { pdfPort, fileBridge });
      setAssignClientOpen(false);
      setAssignNewName("");
      setAssignNewNif("");
      setAssignNewAddress("");
      setAssignNewPhone("");
      await loadQuote();
      await onDataChanged();
      setStatusMsg("Cliente asignado al presupuesto correctamente.");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const badge = STATUS_BADGES[quote.status];
  const hasAdvance = invoices.some((i) => i.series_type === "ANT");
  const hasFinal = invoices.some((i) => i.series_type === "FAC");
  const validUntilIso = computeQuoteValidUntilIso(quote.created_at_ms, quote.validity_days);
  const isExpired =
    (quote.status === "borrador" || quote.status === "enviado") &&
    Boolean(validUntilIso && validUntilIso < getLocalTodayIso());
  const paymentMethods = parseQuotePaymentMethodsJson(quote.payment_methods_json);
  const paymentSchedule = parseQuotePaymentScheduleJson(quote.payment_schedule_json);
  const scheduleAmounts = computePaymentScheduleAmounts(quote.total_cents, paymentSchedule);
  const advancePolicy = resolveQuoteAdvancePolicy(paymentSchedule);

  const clientName = quote.client_name_snapshot || client?.name || "";
  const clientNif = quote.client_nif_snapshot || client?.nif || "";
  const clientPhone = quote.client_phone_snapshot || client?.phone || "";
  const clientAddress = quote.client_address_snapshot || client?.fiscal_address || "";

  return (
    <div
      data-testid="quote-detail-view"
      className="flex flex-1 flex-col overflow-y-auto overflow-x-hidden no-scrollbar p-4 pb-8 space-y-4 bg-surface text-xs"
    >
      {/* Barra superior */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          data-testid="back-to-quotes-btn"
          onClick={onBack}
          className="inline-flex min-h-[42px] items-center gap-1.5 rounded-full border border-outline-variant bg-surface-container-lowest px-3.5 text-[12px] font-semibold text-on-surface cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" />
          <span>Presupuestos</span>
        </button>

        <button
          type="button"
          data-testid="quote-detail-pdf-btn"
          disabled={busy}
          onClick={() =>
            void runAction(async () => {
              await documentOpener.openPdf(quote.pdf_uri, "quote", quote.id, pdfPort);
            })
          }
          className="inline-flex min-h-[42px] items-center gap-1.5 rounded-full border border-outline-variant bg-surface-container-lowest px-4 text-[12px] font-semibold text-on-surface cursor-pointer"
        >
          <FileText className="h-4 w-4 shrink-0" />
          <span>PDF</span>
        </button>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-2xl border border-coral-alert/30 bg-error-container p-3 text-xs text-on-error-container break-words"
        >
          {errorMsg}
        </div>
      )}
      {statusMsg && (
        <div
          role="status"
          className="rounded-2xl border border-outline-variant bg-success-container p-3 font-semibold text-on-success-container break-words"
        >
          {statusMsg}
        </div>
      )}

      {/* Cabecera del presupuesto */}
      <section className="rounded-[20px] border border-outline-variant bg-surface-container-lowest p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[13px] font-bold text-on-primary-container tabular-nums">
                {quote.quote_code}
              </span>
              <span
                className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase ${badge.cls}`}
              >
                {badge.label}
              </span>
              {isExpired && (
                <span
                  data-testid="quote-detail-expired-badge"
                  className="rounded-full border border-amber-300 bg-amber-100 px-2.5 py-0.5 text-[10px] font-semibold uppercase text-amber-900"
                >
                  Caducado
                </span>
              )}
            </div>
            <div className="text-[11px] text-on-surface-variant">
              Creado: <strong className="font-mono">{formatLocalDateIso(quote.created_at_ms)}</strong>
              {quote.sent_at_iso ? (
                <>
                  {" "}
                  · Enviado: <strong className="font-mono">{quote.sent_at_iso}</strong>
                </>
              ) : (
                " · Pendiente de envío"
              )}
              {quote.validity_days && (
                <>
                  {" "}
                  · Validez: <strong className="font-mono">{quote.validity_days} días</strong>
                  {validUntilIso ? ` (hasta ${validUntilIso})` : ""}
                </>
              )}
            </div>
          </div>

          <div className="shrink-0 text-right">
            <div className="text-[11px] text-on-surface-variant">Total c/IVA ({quote.vat_rate} %)</div>
            <div className="font-mono text-[18px] font-bold text-on-surface tabular-nums">
              {formatCentsEs(quote.total_cents)}
            </div>
          </div>
        </div>

        <div className="border-t border-outline-variant pt-2.5 space-y-1">
          <div className="text-[11px] font-semibold text-on-surface-variant">Título de la obra</div>
          <h2 className="break-words [overflow-wrap:anywhere] text-[15px] font-semibold text-on-surface leading-snug">
            {job ? `${job.job_code} · ${job.title}` : quote.job_id}
          </h2>
          {job && (
            <button
              type="button"
              onClick={() => onOpenJob(job.id)}
              className="text-[11px] font-semibold text-on-primary-container underline-offset-2 hover:underline cursor-pointer"
            >
              Ver ficha de obra →
            </button>
          )}
        </div>
      </section>

      {/* Datos completos del cliente */}
      <section className="rounded-[20px] border border-outline-variant bg-surface-container-lowest p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-on-surface">Cliente</h3>
          {quote.client_id ? (
            <button
              type="button"
              onClick={() => onOpenClient(quote.client_id!)}
              className="text-[11px] font-semibold text-on-primary-container hover:underline cursor-pointer"
            >
              Ver ficha cliente →
            </button>
          ) : (
            <button
              type="button"
              data-testid="quote-detail-assign-client-btn"
              onClick={() => setAssignClientOpen((v) => !v)}
              className="rounded-lg bg-primary px-2.5 py-1 text-[11px] font-semibold text-white cursor-pointer"
            >
              {assignClientOpen ? "Cerrar" : "+ Asignar cliente"}
            </button>
          )}
        </div>

        {quote.client_id || clientName ? (
          <>
            <div className="break-words [overflow-wrap:anywhere] text-[14px] font-semibold text-on-surface">
              {clientName}
            </div>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 text-on-surface-variant">
              <div className="break-words">
                <span className="font-semibold text-on-surface">Teléfono:</span>{" "}
                {clientPhone || "No indicado"}
              </div>
              <div className="break-words">
                <span className="font-semibold text-on-surface">NIF/CIF:</span>{" "}
                {clientNif || "No indicado"}
              </div>
            </div>
            <div className="break-words [overflow-wrap:anywhere] text-on-surface-variant">
              <span className="font-semibold text-on-surface">Domicilio fiscal:</span>{" "}
              {clientAddress || "No indicado"}
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-outline-variant bg-surface-container-low p-3 text-on-surface-variant">
            Presupuesto simplificado sin cliente asignado. Puedes compartir el PDF tal cual y asignar el cliente cuando vayas a facturar.
          </div>
        )}

        {assignClientOpen && (
          <form
            onSubmit={(e) => void handleAssignClientSubmit(e)}
            className="mt-2 rounded-xl border border-outline-variant bg-surface-container-low p-3 space-y-2.5"
          >
            <div className="grid grid-cols-2 gap-1 rounded-full border border-outline-variant bg-surface-container-lowest p-1">
              <button
                type="button"
                onClick={() => setAssignMode("existing")}
                className={`min-h-[34px] rounded-full text-[11px] font-semibold cursor-pointer ${
                  assignMode === "existing" ? "bg-secondary text-on-secondary" : "text-on-surface-variant"
                }`}
              >
                Cliente existente
              </button>
              <button
                type="button"
                onClick={() => setAssignMode("new")}
                className={`min-h-[34px] rounded-full text-[11px] font-semibold cursor-pointer ${
                  assignMode === "new" ? "bg-secondary text-on-secondary" : "text-on-surface-variant"
                }`}
              >
                Nuevo cliente
              </button>
            </div>

            {assignMode === "existing" ? (
              <select
                value={assignClientId}
                onChange={(e) => setAssignClientId(e.target.value)}
                data-testid="quote-detail-assign-select"
                className="min-h-[42px] w-full rounded-xl border border-outline-variant bg-white px-3 text-xs"
              >
                <option value="">-- Seleccionar cliente --</option>
                {allClients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.nif ? `(${c.nif})` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input
                  type="text"
                  required
                  placeholder="Nombre o razón social *"
                  value={assignNewName}
                  onChange={(e) => setAssignNewName(e.target.value)}
                  className="rounded-xl border border-outline-variant bg-white px-3 py-2 text-xs"
                />
                <input
                  type="text"
                  placeholder="NIF / NIE / CIF"
                  value={assignNewNif}
                  onChange={(e) => setAssignNewNif(e.target.value.toUpperCase())}
                  className="rounded-xl border border-outline-variant bg-white px-3 py-2 text-xs"
                />
                <input
                  type="tel"
                  placeholder="Teléfono"
                  value={assignNewPhone}
                  onChange={(e) => setAssignNewPhone(e.target.value)}
                  className="rounded-xl border border-outline-variant bg-white px-3 py-2 text-xs"
                />
                <input
                  type="text"
                  placeholder="Domicilio fiscal"
                  value={assignNewAddress}
                  onChange={(e) => setAssignNewAddress(e.target.value)}
                  className="rounded-xl border border-outline-variant bg-white px-3 py-2 text-xs"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              data-testid="quote-detail-assign-confirm-btn"
              className="min-h-[40px] w-full rounded-xl bg-primary text-xs font-semibold text-white cursor-pointer disabled:opacity-50"
            >
              {busy ? "Asignando..." : "Guardar cliente y actualizar PDF"}
            </button>
          </form>
        )}
      </section>

      {/* Tipo de IVA aplicable */}
      <section className="rounded-[20px] border border-outline-variant bg-surface-container-lowest px-4 py-3 flex items-center justify-between gap-2">
        <span className="font-semibold text-on-surface-variant">Tipo de IVA aplicable</span>
        <span className="rounded-full bg-terracotta-soft px-3 py-1 font-mono text-[12px] font-bold text-on-primary-container">
          {quote.vat_rate} %
        </span>
      </section>

      {/* Partidas completas */}
      <section className="rounded-[20px] border border-outline-variant bg-surface-container-lowest p-4 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-on-surface">
            Partidas ({items.length})
          </h3>
        </div>

        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-outline-variant p-3 text-center text-on-surface-variant">
            Este presupuesto no tiene partidas registradas.
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item, idx) => (
              <div
                key={item.id}
                data-testid={`quote-detail-line-${idx}`}
                className="w-full max-w-full overflow-hidden rounded-xl border border-outline-variant bg-surface-container-low p-3 space-y-1.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 break-words [overflow-wrap:anywhere] text-[13px] font-semibold text-on-surface leading-snug">
                    {item.description}
                  </div>
                  <span className="shrink-0 rounded-full bg-surface-container-lowest border border-outline-variant px-2 py-0.5 text-[10px] font-semibold text-on-surface-variant">
                    {item.category}
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-on-surface-variant">
                  <span className="font-mono tabular-nums">
                    {formatThousandthsEs(item.quantity_thousandths)} {item.unit} ×{" "}
                    {formatCentsEs(item.unit_price_cents)}
                  </span>
                  <span className="font-mono text-[13px] font-bold text-on-surface tabular-nums">
                    {formatCentsEs(item.line_subtotal_cents)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Desglose económico */}
        <div className="rounded-xl bg-surface-container p-3 space-y-1.5">
          <div className="flex justify-between text-on-surface-variant">
            <span>Base imponible</span>
            <span className="font-mono font-semibold text-on-surface tabular-nums">
              {formatCentsEs(quote.subtotal_cents)}
            </span>
          </div>
          <div className="flex justify-between text-on-surface-variant">
            <span>IVA ({quote.vat_rate} %)</span>
            <span className="font-mono font-semibold text-on-surface tabular-nums">
              {formatCentsEs(quote.vat_cents)}
            </span>
          </div>
          <div className="flex justify-between border-t border-outline-variant pt-1.5 text-[14px] font-bold text-on-surface">
            <span>Total presupuesto</span>
            <span className="font-mono tabular-nums">{formatCentsEs(quote.total_cents)}</span>
          </div>
        </div>
      </section>

      {/* Condiciones de pago y vencimientos */}
      {(paymentMethods.length > 0 || scheduleAmounts.length > 0) && (
        <section
          data-testid="quote-detail-payment-section"
          className="rounded-[20px] border border-outline-variant bg-surface-container-lowest p-4 space-y-2.5"
        >
          <h3 className="text-[13px] font-semibold text-on-surface">
            Condiciones y forma de pago
          </h3>
          {paymentMethods.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {paymentMethods.map((m) => (
                <span
                  key={m}
                  className="rounded-full border border-outline-variant bg-surface-container-low px-2.5 py-0.5 text-[11px] font-semibold text-on-surface"
                >
                  {PAYMENT_METHOD_LABELS[m] ?? m}
                </span>
              ))}
            </div>
          )}
          {paymentMethods.includes("transferencia") && emitterIban && (
            <div className="text-[11px] text-on-surface-variant">
              IBAN para transferencias: <strong className="font-mono text-on-surface">{emitterIban}</strong>
            </div>
          )}
          {scheduleAmounts.length > 0 && (
            <div className="space-y-1.5">
              {scheduleAmounts.map((step, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-2 rounded-xl bg-surface-container-low px-3 py-2"
                >
                  <span className="min-w-0 flex-1 font-medium text-on-surface">{step.label}</span>
                  <div className="flex items-center gap-2 shrink-0 font-mono tabular-nums">
                    <span className="text-[11px] text-on-surface-variant">
                      {formatPercentEs(step.percentage)}
                    </span>
                    <span className="font-bold text-on-surface">
                      {formatCentsEs(step.amount_cents)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Notas / Observaciones */}
      <section className="rounded-[20px] border border-outline-variant bg-surface-container-lowest p-4 space-y-1.5">
        <h3 className="text-[13px] font-semibold text-on-surface">Notas</h3>
        <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-on-surface-variant leading-relaxed">
          {quote.notes.trim() || "Sin notas adicionales."}
        </p>
      </section>

      {/* Facturas asociadas */}
      {invoices.length > 0 && (
        <section className="rounded-[20px] border border-outline-variant bg-surface-container-lowest p-4 space-y-2">
          <h3 className="text-[13px] font-semibold text-on-surface">
            Facturas emitidas ({invoices.length})
          </h3>
          <div className="space-y-2">
            {invoices.map((inv) => (
              <button
                key={inv.id}
                type="button"
                data-testid={`quote-detail-invoice-${inv.id}`}
                onClick={() => onOpenInvoice(inv.id)}
                className="flex w-full items-center justify-between gap-2 rounded-xl border border-outline-variant bg-surface-warm-card p-3 text-left hover:border-terracotta cursor-pointer"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[13px] font-bold text-on-surface">
                    {inv.invoice_number}
                  </div>
                  <div className="text-[11px] text-on-surface-variant">
                    {inv.issued_at_iso} · {inv.status.replace("_", " ")}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-mono text-[13px] font-bold text-on-surface tabular-nums">
                    {formatCentsEs(inv.total_cents)}
                  </div>
                  <div className="text-[10px] font-semibold text-on-primary-container">
                    Ver factura →
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Acciones del presupuesto */}
      <section
        data-testid="quote-detail-actions"
        className="rounded-[20px] border border-outline-variant bg-surface-container-lowest p-4 space-y-2.5"
      >
        <h3 className="text-[13px] font-semibold text-on-surface">Acciones del presupuesto</h3>

        <div className="grid grid-cols-2 gap-2">
          {(quote.status === "borrador" || quote.status === "enviado") && (
            <>
              <button
                type="button"
                data-testid="quote-detail-accept-btn"
                disabled={busy}
                onClick={() =>
                  void runAction(
                    async () => {
                      await new QuotesRepository(executor).acceptOrReject(quote.id, "aceptado");
                    },
                    "Presupuesto marcado como aceptado."
                  )
                }
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-emerald-free px-3 font-semibold text-white cursor-pointer disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>Aceptar</span>
              </button>
              <button
                type="button"
                data-testid="quote-detail-reject-btn"
                disabled={busy}
                onClick={() =>
                  void runAction(
                    async () => {
                      await new QuotesRepository(executor).acceptOrReject(quote.id, "rechazado");
                    },
                    "Presupuesto marcado como rechazado."
                  )
                }
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-coral-alert/30 bg-surface-container-lowest px-3 font-semibold text-coral-alert cursor-pointer disabled:opacity-50"
              >
                <XCircle className="h-4 w-4 shrink-0" />
                <span>Rechazar</span>
              </button>
            </>
          )}

          {quote.status === "borrador" && job?.status !== "cancelado" && (
            <button
              type="button"
              data-testid="quote-detail-edit-btn"
              disabled={busy}
              onClick={() => void onStartJobQuote(quote.job_id)}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-outline-variant bg-surface-container-lowest px-3 font-semibold text-on-surface cursor-pointer disabled:opacity-50"
            >
              <Pencil className="h-4 w-4 shrink-0" />
              <span>Editar presupuesto</span>
            </button>
          )}

          <button
            type="button"
            data-testid="quote-detail-open-pdf-btn"
            disabled={busy}
            onClick={() =>
              void runAction(async () => {
                await documentOpener.openPdf(quote.pdf_uri, "quote", quote.id, pdfPort);
              })
            }
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-outline-variant bg-surface-container-lowest px-3 font-semibold text-on-surface cursor-pointer disabled:opacity-50"
          >
            <FileText className="h-4 w-4 shrink-0" />
            <span>Abrir PDF</span>
          </button>

          {!quote.sent_at_iso && quote.status !== "rechazado" && (
            <button
              type="button"
              data-testid="quote-detail-mark-sent-btn"
              disabled={busy}
              onClick={() =>
                void runAction(
                  async () => {
                    await new QuotesRepository(executor).markSentManually(quote.id);
                  },
                  "Presupuesto marcado como enviado."
                )
              }
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-outline-variant bg-surface-container-lowest px-3 font-semibold text-on-surface-variant cursor-pointer disabled:opacity-50"
            >
              <Send className="h-4 w-4 shrink-0" />
              <span>Marcar enviado</span>
            </button>
          )}

          {quote.status !== "rechazado" && (
            <>
              <button
                type="button"
                data-testid="quote-detail-share-btn"
                disabled={busy}
                onClick={() =>
                  void onRunQuoteLifecycleAction({
                    action_type: "request_share_gate",
                    job_id: quote.job_id,
                    quote_id: quote.id,
                    billing_sub_intent: "share",
                  })
                }
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-outline-variant bg-terracotta-soft px-3 font-semibold text-on-primary-container cursor-pointer disabled:opacity-50"
              >
                <Share2 className="h-4 w-4 shrink-0" />
                <span>Compartir</span>
              </button>

              {!quote.client_id ? (
                <button
                  type="button"
                  onClick={() => setAssignClientOpen(true)}
                  className="col-span-2 inline-flex min-h-[44px] items-center justify-center rounded-xl border border-amber-300 bg-amber-50 px-3 text-[11px] font-semibold text-amber-900 cursor-pointer"
                >
                  Asigna un cliente arriba para poder emitir facturas (RD 1619/2012)
                </button>
              ) : (
                <>
                  {advancePolicy.allowAdvance && !hasAdvance && !hasFinal && (
                    <button
                      type="button"
                      data-testid="quote-detail-advance-btn"
                      disabled={busy}
                      onClick={() =>
                        void onRunQuoteLifecycleAction({
                          action_type: "request_advance_gate",
                          job_id: quote.job_id,
                          quote_id: quote.id,
                          billing_sub_intent: "advance_40",
                        })
                      }
                      className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-primary px-3 font-semibold text-white cursor-pointer disabled:opacity-50"
                    >
                      Anticipo {formatPercentEs(advancePolicy.advancePercent)}
                    </button>
                  )}

                  {!hasFinal && (
                    <button
                      type="button"
                      data-testid="quote-detail-invoice-btn"
                      disabled={busy}
                      onClick={() =>
                        void onRunQuoteLifecycleAction({
                          action_type: "request_invoice_gate",
                          job_id: quote.job_id,
                          quote_id: quote.id,
                          billing_sub_intent: "final_invoice",
                        })
                      }
                      className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-secondary px-3 font-semibold text-on-secondary cursor-pointer disabled:opacity-50"
                    >
                      {hasAdvance
                        ? "Factura final (resto)"
                        : !advancePolicy.allowAdvance
                          ? "Factura completa (100 %)"
                          : "Facturar"}
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </section>

      {/* Zona de borrado */}
      <section className="rounded-[20px] border border-outline-variant bg-surface-container-lowest p-4 space-y-2">
        <button
          type="button"
          data-testid="quote-detail-delete-btn"
          disabled={busy}
          onClick={() => {
            setDeleteError(null);
            setConfirmDeleteOpen(true);
          }}
          className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl border border-coral-alert/30 bg-surface-container-lowest font-semibold text-coral-alert cursor-pointer disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4 shrink-0" />
          <span>Eliminar presupuesto</span>
        </button>
        {invoices.length > 0 && (
          <p className="text-[11px] text-on-surface-variant text-center">
            Tiene {invoices.length} factura(s) asociada(s) (
            {invoices.map((i) => i.invoice_number).join(", ")}). Elimina primero las facturas si
            quieres borrar este presupuesto.
          </p>
        )}
      </section>

      <ConfirmDeleteDialog
        open={confirmDeleteOpen}
        title={`¿Eliminar presupuesto ${quote.quote_code}?`}
        description="Se eliminará el presupuesto, todas sus partidas y su PDF generado. Esta acción no se puede deshacer."
        warningNote={
          invoices.length > 0
            ? `Este presupuesto tiene ${invoices.length} factura(s) asociada(s) (${invoices.map((i) => i.invoice_number).join(", ")}). Debes eliminar primero esas facturas.`
            : null
        }
        errorMsg={deleteError}
        busy={busy}
        confirmTestId="quote-detail-confirm-delete-btn"
        registerBackHandler={registerBackHandler}
        onCancel={() => {
          if (!busy) {
            setConfirmDeleteOpen(false);
            setDeleteError(null);
          }
        }}
        onConfirm={handleDeleteQuote}
      />
    </div>
  );
}
