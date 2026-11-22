import { ArrowLeft, Pencil, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  ExpenseTicketRow,
  JobRow,
  LocalFileBridge,
  SqliteExecutor,
  TicketVatRate,
} from "../../core/contracts/types";
import { JobsRepository } from "../../core/db/repositories/jobsRepo";
import { TicketsRepository } from "../../core/db/repositories/ticketsRepo";
import { deriveFiscalQuarter, isValidIsoDate } from "../../core/fiscal/dateQuarter";
import { computeInverseVat21, formatCentsEs } from "../../core/fiscal/fiscalEngine";

interface TicketDetailViewProps {
  ticketId: string;
  executor: SqliteExecutor;
  fileBridge: LocalFileBridge;
  refreshTick: number;
  onBack: () => void;
  onOpenJob: (jobId: string) => void;
  onDataChanged: () => Promise<void>;
}

const TICKET_CATEGORIES = ["materiales", "herramientas", "transporte", "subcontrata", "otros"];
const VAT_OPTIONS: TicketVatRate[] = [21, 10, 4, 0, "mixed"];

function centsToEur(cents: number): string {
  return (cents / 100).toFixed(2);
}

function eurToCents(raw: string): number {
  const parsed = Number.parseFloat(raw.replace(",", ".").trim());
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100);
}

export function TicketDetailView({
  ticketId,
  executor,
  fileBridge,
  refreshTick,
  onBack,
  onOpenJob,
  onDataChanged,
}: TicketDetailViewProps) {
  const [loading, setLoading] = useState(true);
  const [ticket, setTicket] = useState<ExpenseTicketRow | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [supplierName, setSupplierName] = useState("");
  const [supplierNif, setSupplierNif] = useState("");
  const [issueDateIso, setIssueDateIso] = useState("");
  const [category, setCategory] = useState("materiales");
  const [jobId, setJobId] = useState<string | null>(null);
  const [vatRate, setVatRate] = useState<TicketVatRate>(21);
  const [baseCents, setBaseCents] = useState(0);
  const [vatCents, setVatCents] = useState(0);
  const [totalCents, setTotalCents] = useState(0);

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const hydrateForm = (t: ExpenseTicketRow) => {
    setSupplierName(t.supplier_name);
    setSupplierNif(t.supplier_nif);
    setIssueDateIso(t.issue_date_iso);
    setCategory(t.category);
    setJobId(t.job_id);
    setVatRate(
      t.vat_rate_label === "mixed"
        ? "mixed"
        : (Number(t.vat_rate_label) as TicketVatRate)
    );
    setBaseCents(t.base_cents);
    setVatCents(t.vat_cents);
    setTotalCents(t.total_cents);
  };

  const loadTicket = async () => {
    setLoading(true);
    try {
      const [t, jobList] = await Promise.all([
        new TicketsRepository(executor).getById(ticketId),
        new JobsRepository(executor).listAll(),
      ]);
      setTicket(t);
      setJobs(jobList.filter((j) => j.status !== "cancelado"));
      if (t) hydrateForm(t);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setEditing(false);
    setConfirmDelete(false);
    setErrorMsg(null);
    setStatusMsg(null);
    void loadTicket();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId, executor, refreshTick]);

  useEffect(() => {
    let active = true;
    let revoker: (() => void) | null = null;
    if (!ticket?.image_uri) {
      setPhotoUrl(null);
      return;
    }
    fileBridge
      .resolveDisplayUrl(ticket.image_uri)
      .then((res) => {
        if (!active) {
          res?.revoke();
          return;
        }
        revoker = res?.revoke ?? null;
        setPhotoUrl(res?.url ?? null);
      })
      .catch(() => {
        if (active) setPhotoUrl(null);
      });
    return () => {
      active = false;
      revoker?.();
    };
  }, [fileBridge, ticket?.image_uri]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticket) return;
    setErrorMsg(null);
    setStatusMsg(null);
    setBusy(true);
    try {
      const updated = await new TicketsRepository(executor).updateWithin2Cents(ticket.id, {
        supplier_name: supplierName,
        supplier_nif: supplierNif,
        issue_date_iso: issueDateIso,
        category,
        job_id: jobId,
        vat_rate: vatRate,
        base_cents: baseCents,
        vat_cents: vatCents,
        total_cents: totalCents,
      });
      setTicket(updated);
      hydrateForm(updated);
      setEditing(false);
      await onDataChanged();
      setStatusMsg("Ticket actualizado correctamente.");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!ticket) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      await new TicketsRepository(executor).delete(ticket.id, fileBridge);
      await onDataChanged();
      onBack();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  if (loading && !ticket) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-xs text-on-surface-variant">
        Cargando detalle de ticket...
      </div>
    );
  }

  if (!ticket) {
    return (
      <div
        data-testid="ticket-not-found-view"
        className="flex flex-1 flex-col items-center justify-center p-6 text-center space-y-3"
      >
        <p className="text-sm font-bold text-on-surface">Ticket no encontrado</p>
        <button
          type="button"
          onClick={onBack}
          className="min-h-11 rounded-xl bg-secondary px-4 text-xs font-semibold text-on-secondary cursor-pointer"
        >
          Volver
        </button>
      </div>
    );
  }

  const linkedJob = ticket.job_id ? jobs.find((j) => j.id === ticket.job_id) ?? null : null;
  const computedQuarter = isValidIsoDate(issueDateIso)
    ? deriveFiscalQuarter(issueDateIso)
    : ticket.quarter;
  const diffCents = Math.abs(baseCents + vatCents - totalCents);

  return (
    <div
      data-testid="ticket-detail-view"
      className="flex flex-1 flex-col overflow-y-auto overflow-x-hidden no-scrollbar p-4 pb-8 space-y-4 bg-surface text-xs"
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          data-testid="back-from-ticket-btn"
          onClick={onBack}
          className="inline-flex min-h-[42px] items-center gap-1.5 rounded-full border border-outline-variant bg-surface-container-lowest px-3.5 text-[12px] font-semibold text-on-surface cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" />
          <span>Volver</span>
        </button>

        {!editing && (
          <button
            type="button"
            data-testid="ticket-detail-edit-btn"
            onClick={() => {
              hydrateForm(ticket);
              setEditing(true);
            }}
            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-full bg-secondary px-4 text-[12px] font-semibold text-on-secondary cursor-pointer"
          >
            <Pencil className="h-4 w-4 shrink-0" />
            <span>Editar ticket</span>
          </button>
        )}
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

      {photoUrl && (
        <div className="rounded-[20px] border border-outline-variant bg-surface-container-lowest p-3">
          <div className="mb-1.5 text-[11px] font-semibold text-on-surface-variant">
            Imagen del ticket
          </div>
          <img
            src={photoUrl}
            alt={`Ticket ${ticket.supplier_name}`}
            className="max-h-56 w-full rounded-xl object-contain bg-surface-container-low"
          />
        </div>
      )}

      {!editing ? (
        <>
          <section className="rounded-[20px] border border-outline-variant bg-surface-container-lowest p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1 space-y-1">
                <span className="inline-flex rounded-full bg-warning-container px-2.5 py-0.5 text-[10px] font-semibold uppercase text-on-warning-container">
                  {ticket.category}
                </span>
                <h2 className="break-words [overflow-wrap:anywhere] text-[16px] font-bold text-on-surface">
                  {ticket.supplier_name}
                </h2>
                <div className="text-[11px] text-on-surface-variant">
                  NIF/CIF: <strong>{ticket.supplier_nif || "No especificado"}</strong>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[11px] text-on-surface-variant">Total ticket</div>
                <div className="font-mono text-[18px] font-bold text-on-surface tabular-nums">
                  {formatCentsEs(ticket.total_cents)}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-1">
              <div className="rounded-xl border border-outline-variant bg-surface-container-low p-2.5">
                <div className="text-[10px] text-on-surface-variant">Base imponible</div>
                <div className="font-mono text-[13px] font-bold text-on-surface tabular-nums">
                  {formatCentsEs(ticket.base_cents)}
                </div>
              </div>
              <div className="rounded-xl border border-outline-variant bg-success-container p-2.5">
                <div className="text-[10px] text-on-success-container">
                  IVA (
                  {ticket.vat_rate_label === "mixed" ? "Mixto" : `${ticket.vat_rate_label} %`})
                </div>
                <div className="font-mono text-[13px] font-bold text-on-success-container tabular-nums">
                  {formatCentsEs(ticket.vat_cents)}
                </div>
              </div>
              <div className="rounded-xl bg-secondary p-2.5 text-on-secondary">
                <div className="text-[10px] opacity-80">Total pagado</div>
                <div className="font-mono text-[13px] font-bold tabular-nums">
                  {formatCentsEs(ticket.total_cents)}
                </div>
              </div>
            </div>

            <div className="space-y-1.5 border-t border-outline-variant pt-3 text-on-surface-variant">
              <div className="flex justify-between gap-2">
                <span>Fecha del ticket</span>
                <span className="font-mono font-semibold text-on-surface">
                  {ticket.issue_date_iso}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span>Trimestre fiscal</span>
                <span className="font-mono font-semibold text-on-surface">{ticket.quarter}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span>Origen lectura</span>
                <span className="font-semibold text-on-surface">
                  {ticket.ocr_confidence > 0
                    ? `OCR ${ticket.ocr_confidence} %`
                    : "Entrada manual"}
                </span>
              </div>
              <div className="flex items-start justify-between gap-2">
                <span className="shrink-0">Obra vinculada</span>
                {linkedJob ? (
                  <button
                    type="button"
                    onClick={() => onOpenJob(linkedJob.id)}
                    className="text-right font-semibold text-on-primary-container hover:underline break-words cursor-pointer"
                  >
                    {linkedJob.job_code} · {linkedJob.title} →
                  </button>
                ) : (
                  <span className="text-right font-semibold text-on-surface">
                    Gasto general de empresa
                  </span>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-[20px] border border-outline-variant bg-surface-container-lowest p-4 space-y-2">
            {!confirmDelete ? (
              <button
                type="button"
                data-testid="ticket-detail-delete-btn"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl border border-coral-alert/30 bg-surface-container-lowest font-semibold text-coral-alert cursor-pointer"
              >
                <Trash2 className="h-4 w-4" />
                <span>Eliminar ticket</span>
              </button>
            ) : (
              <div className="space-y-2">
                <div className="font-semibold text-coral-alert text-center">
                  ¿Seguro que quieres eliminar este ticket de tu Hucha Fiscal?
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="min-h-[42px] flex-1 rounded-xl border border-outline-variant font-semibold text-on-surface cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    data-testid="ticket-detail-confirm-delete-btn"
                    disabled={busy}
                    onClick={() => void handleDelete()}
                    className="min-h-[42px] flex-1 rounded-xl bg-coral-alert font-semibold text-white cursor-pointer"
                  >
                    Sí, eliminar
                  </button>
                </div>
              </div>
            )}
          </section>
        </>
      ) : (
        <form
          data-testid="ticket-detail-edit-form"
          onSubmit={(e) => void handleSave(e)}
          className="rounded-[20px] border border-outline-variant bg-surface-container-lowest p-4 space-y-3"
        >
          <div className="text-[14px] font-bold text-on-surface">Editar ticket de gasto</div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label className="block text-[11px] font-semibold text-on-surface-variant" htmlFor="td-supplier">
                Proveedor *
              </label>
              <input
                id="td-supplier"
                data-testid="ticket-detail-supplier-input"
                type="text"
                disabled={busy}
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                className="mt-1 w-full rounded-xl border border-outline-variant px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-on-surface-variant" htmlFor="td-nif">
                NIF/CIF proveedor
              </label>
              <input
                id="td-nif"
                type="text"
                disabled={busy}
                value={supplierNif}
                onChange={(e) => setSupplierNif(e.target.value.toUpperCase())}
                className="mt-1 w-full rounded-xl border border-outline-variant px-3 py-2 text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-semibold text-on-surface-variant" htmlFor="td-date">
                Fecha ticket
              </label>
              <input
                id="td-date"
                type="date"
                disabled={busy}
                value={issueDateIso}
                onChange={(e) => setIssueDateIso(e.target.value)}
                className="mt-1 w-full rounded-xl border border-outline-variant px-2.5 py-2 text-xs"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-on-surface-variant" htmlFor="td-cat">
                Categoría
              </label>
              <select
                id="td-cat"
                disabled={busy}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-1 w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-2.5 py-2 text-xs"
              >
                {TICKET_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-on-surface-variant" htmlFor="td-job">
              Obra vinculada
            </label>
            <select
              id="td-job"
              disabled={busy}
              value={jobId ?? ""}
              onChange={(e) => setJobId(e.target.value || null)}
              className="mt-1 w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2 text-xs"
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
              <label className="block text-[11px] font-semibold text-on-surface-variant" htmlFor="td-base">
                Base (€)
              </label>
              <input
                id="td-base"
                data-testid="ticket-detail-base-input"
                type="number"
                step="0.01"
                min="0"
                disabled={busy}
                value={centsToEur(baseCents)}
                onChange={(e) => setBaseCents(eurToCents(e.target.value))}
                className="mt-1 w-full rounded-xl border border-outline-variant px-2.5 py-2 text-xs"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-on-surface-variant" htmlFor="td-vat">
                IVA (€)
              </label>
              <input
                id="td-vat"
                data-testid="ticket-detail-vat-input"
                type="number"
                step="0.01"
                min="0"
                disabled={busy}
                value={centsToEur(vatCents)}
                onChange={(e) => setVatCents(eurToCents(e.target.value))}
                className="mt-1 w-full rounded-xl border border-outline-variant px-2.5 py-2 text-xs"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-on-surface-variant" htmlFor="td-total">
                Total (€)
              </label>
              <input
                id="td-total"
                data-testid="ticket-detail-total-input"
                type="number"
                step="0.01"
                min="0"
                disabled={busy}
                value={centsToEur(totalCents)}
                onChange={(e) => setTotalCents(eurToCents(e.target.value))}
                className="mt-1 w-full rounded-xl border border-outline-variant px-2.5 py-2 text-xs font-bold"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1">
              {VAT_OPTIONS.map((rate) => (
                <button
                  key={String(rate)}
                  type="button"
                  disabled={busy}
                  onClick={() => setVatRate(rate)}
                  className={`rounded-lg px-2 py-1 text-[11px] font-semibold cursor-pointer ${
                    vatRate === rate
                      ? "bg-secondary text-on-secondary"
                      : "bg-surface-container text-on-surface-variant"
                  }`}
                >
                  {rate === "mixed" ? "Mixto" : `${rate}%`}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={busy || totalCents <= 0}
              onClick={() => {
                const inv = computeInverseVat21(totalCents);
                setVatRate(21);
                setBaseCents(inv.baseCents);
                setVatCents(inv.vatCents);
              }}
              className="rounded-lg border border-outline-variant bg-terracotta-soft px-2.5 py-1 text-[11px] font-semibold text-on-primary-container cursor-pointer"
            >
              Desglose inverso 21 %
            </button>
          </div>

          <div className="text-[11px] text-on-surface-variant">
            Trimestre: <strong>{computedQuarter}</strong> · Diferencia:{" "}
            <strong className={diffCents > 2 ? "text-coral-alert" : "text-emerald-free"}>
              {formatCentsEs(diffCents)}
            </strong>{" "}
            (máx. ±0,02 €)
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                hydrateForm(ticket);
                setEditing(false);
              }}
              className="min-h-[44px] rounded-xl border border-outline-variant px-4 font-semibold text-on-surface cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              data-testid="ticket-detail-save-btn"
              disabled={busy}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 font-semibold text-white cursor-pointer disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              <span>{busy ? "Guardando..." : "Guardar cambios"}</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
