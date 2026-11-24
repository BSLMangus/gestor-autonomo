import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { TEXT_LIMITS } from "../../core/contracts/textLimits";
import type {
  ClientRow,
  InvoiceRow,
  JobRow,
  QuoteRow,
  SqliteExecutor,
} from "../../core/contracts/types";
import { ClientsRepository } from "../../core/db/repositories/clientsRepo";
import { JobsRepository } from "../../core/db/repositories/jobsRepo";
import { formatCentsEs } from "../../core/fiscal/fiscalEngine";

interface ClientProfileViewProps {
  clientId: string;
  executor: SqliteExecutor;
  refreshTick: number;
  onBackToClients: () => void;
  onOpenJob: (jobId: string) => void;
  onOpenQuote: (quoteId: string) => void;
  onOpenInvoice: (invoiceId: string) => void;
  onStartJobQuote: (jobId: string) => Promise<void>;
  onOpenEditWidget: (client: ClientRow) => void;
  onDataChanged: () => Promise<void>;
}

export function ClientProfileView({
  clientId,
  executor,
  refreshTick,
  onBackToClients,
  onOpenJob,
  onOpenQuote,
  onOpenInvoice,
  onStartJobQuote,
  onOpenEditWidget,
  onDataChanged,
}: ClientProfileViewProps) {
  const [loading, setLoading] = useState(true);
  const [client, setClient] = useState<ClientRow | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [quotes, setQuotes] = useState<QuoteRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);

  const [newJobTitle, setNewJobTitle] = useState("");
  const [showNewJobForm, setShowNewJobForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadPortfolio = async () => {
    setLoading(true);
    try {
      const portfolio = await new ClientsRepository(executor).getClientPortfolio(clientId);
      if (!portfolio) {
        setClient(null);
        setJobs([]);
        setQuotes([]);
        setInvoices([]);
      } else {
        setClient(portfolio.client);
        setJobs(portfolio.jobs);
        setQuotes(portfolio.quotes);
        setInvoices(portfolio.invoices);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setErrorMsg(null);
    setStatusMsg(null);
    void loadPortfolio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, executor, refreshTick]);

  const handleCreateJobForClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newJobTitle.trim()) {
      setErrorMsg("Escribe un título para la nueva obra.");
      return;
    }
    setErrorMsg(null);
    setStatusMsg(null);
    setBusy(true);
    try {
      const createdJob = await new JobsRepository(executor).createDirectJob({
        title: newJobTitle.trim(),
        address: client?.fiscal_address ?? "",
        client_id: clientId,
      });
      setNewJobTitle("");
      setShowNewJobForm(false);
      await loadPortfolio();
      await onDataChanged();
      setStatusMsg(`Obra ${createdJob.job_code} creada y vinculada a ${client?.name ?? "este cliente"}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading && !client) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-xs text-slate-500">
        Cargando ficha de cliente...
      </div>
    );
  }

  if (!client) {
    return (
      <div data-testid="client-not-found-view" className="flex flex-1 flex-col items-center justify-center p-6 text-center space-y-3">
        <p className="text-sm font-bold text-slate-800">Cliente no encontrado</p>
        <p className="text-xs text-slate-500">Es posible que se haya eliminado o restaurado el catálogo.</p>
        <button
          type="button"
          onClick={onBackToClients}
          className="min-h-11 rounded-xl bg-slate-900 px-4 text-xs font-bold text-white"
        >
          Volver a Clientes
        </button>
      </div>
    );
  }

  const totalQuotedCents = quotes
    .filter((q) => q.status !== "rechazado")
    .reduce((acc, q) => acc + q.total_cents, 0);
  const totalInvoicedCents = invoices.reduce((acc, i) => acc + i.total_cents, 0);
  const totalCollectedCents = invoices
    .filter((i) => i.status === "pagado")
    .reduce((acc, i) => acc + i.total_cents, 0);
  const totalPendingCents = invoices
    .filter((i) => i.status === "pendiente_cobro" || i.status === "vencido")
    .reduce((acc, i) => acc + i.total_cents, 0);

  return (
    <div
      data-testid="client-profile-view"
      className="flex flex-1 flex-col w-full max-w-full overflow-y-auto overflow-x-hidden no-scrollbar p-4 space-y-4 text-xs bg-surface"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 w-full min-w-0">
        <button
          type="button"
          data-testid="back-to-clients-btn"
          onClick={onBackToClients}
          className="inline-flex min-h-[42px] items-center gap-1.5 rounded-full border border-outline-variant bg-surface-container-lowest px-3.5 text-[12px] font-semibold text-on-surface cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Clientes</span>
        </button>
        <button
          type="button"
          data-testid="edit-client-profile-btn"
          onClick={() => onOpenEditWidget(client)}
          className="min-h-[42px] rounded-full bg-secondary px-4 text-[12px] font-semibold text-on-secondary cursor-pointer"
        >
          Editar datos
        </button>
      </div>

      {errorMsg && (
        <div role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-2.5 text-rose-800">
          {errorMsg}
        </div>
      )}
      {statusMsg && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-2.5 font-semibold text-emerald-900">
          {statusMsg}
        </div>
      )}

      {/* Cabecera de datos fiscales */}
      <section className="rounded-2xl border border-slate-200 bg-white p-3.5 space-y-1.5">
        <h2 className="min-w-0 text-base font-extrabold text-slate-900 break-words [overflow-wrap:anywhere]">
          {client.name}
        </h2>
        <div className="text-slate-600 break-words [overflow-wrap:anywhere]">
          <span className="font-semibold">NIF/CIF:</span> {client.nif || "No especificado"} ·{" "}
          <span className="font-semibold">Tel:</span> {client.phone || "No especificado"}
        </div>
        {client.fiscal_address && (
          <div className="text-slate-600 break-words [overflow-wrap:anywhere]">
            <span className="font-semibold">Dirección:</span> {client.fiscal_address}
          </div>
        )}
        {client.email && (
          <div className="text-slate-600 break-words [overflow-wrap:anywhere]">
            <span className="font-semibold">Email:</span> {client.email}
          </div>
        )}
        {client.notes && (
          <div className="rounded-xl bg-slate-50 p-2 text-[11px] text-slate-600">
            {client.notes}
          </div>
        )}
      </section>

      {/* Resumen económico */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-slate-200 bg-white p-2.5">
          <div className="text-[11px] font-medium text-slate-500">Presupuestado</div>
          <div className="mt-0.5 text-sm font-extrabold text-slate-900">
            {formatCentsEs(totalQuotedCents)}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-2.5">
          <div className="text-[11px] font-medium text-slate-500">Facturado total</div>
          <div className="mt-0.5 text-sm font-extrabold text-slate-900">
            {formatCentsEs(totalInvoicedCents)}
          </div>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-2.5">
          <div className="text-[11px] font-medium text-emerald-900">Cobrado</div>
          <div className="mt-0.5 text-sm font-extrabold text-emerald-950">
            {formatCentsEs(totalCollectedCents)}
          </div>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-2.5">
          <div className="text-[11px] font-medium text-amber-900">Pendiente cobro</div>
          <div className="mt-0.5 text-sm font-extrabold text-amber-950">
            {formatCentsEs(totalPendingCents)}
          </div>
        </div>
      </div>

      {/* Obras asociadas */}
      <section className="rounded-2xl border border-slate-200 bg-white p-3 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 w-full min-w-0">
          <h3 className="text-sm font-extrabold text-slate-900">Obras asociadas ({jobs.length})</h3>
          <button
            type="button"
            data-testid="client-profile-new-job-btn"
            onClick={() => setShowNewJobForm((v) => !v)}
            className="rounded-lg bg-orange-600 px-2.5 py-1 text-[11px] font-bold text-white"
          >
            + Nueva obra
          </button>
        </div>

        {showNewJobForm && (
          <form
            onSubmit={(e) => void handleCreateJobForClient(e)}
            className="flex w-full min-w-0 gap-1.5 rounded-xl border border-orange-200 bg-orange-50/70 p-2"
          >
            <input
              type="text"
              maxLength={TEXT_LIMITS.TITLE}
              value={newJobTitle}
              onChange={(e) => setNewJobTitle(e.target.value)}
              placeholder="Título de la obra (ej. Reforma baño)"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
            />
            <button
              type="submit"
              disabled={busy}
              className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white"
            >
              Crear
            </button>
          </form>
        )}

        {jobs.length === 0 ? (
          <div className="text-slate-500">Este cliente aún no tiene obras registradas.</div>
        ) : (
          <div className="space-y-2">
            {jobs.map((job) => (
              <div
                key={job.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-2.5"
              >
                <button
                  type="button"
                  data-testid={`client-open-job-${job.id}`}
                  onClick={() => onOpenJob(job.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="text-[11px] font-extrabold text-orange-700">
                    {job.job_code} · {job.status}
                  </div>
                  <div className="truncate font-bold text-slate-900">{job.title}</div>
                  {job.address && (
                    <div className="truncate text-[10px] text-slate-500">{job.address}</div>
                  )}
                </button>
                {job.status !== "cancelado" && (
                  <button
                    type="button"
                    onClick={() => void onStartJobQuote(job.id)}
                    className="shrink-0 rounded-lg border border-orange-300 bg-white px-2.5 py-1.5 text-[11px] font-bold text-orange-800"
                  >
                    + Presupuesto
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Presupuestos y Facturas vinculados */}
      <section className="rounded-2xl border border-slate-200 bg-white p-3 space-y-2">
        <h3 className="text-sm font-extrabold text-slate-900">
          Presupuestos y Facturas ({quotes.length + invoices.length})
        </h3>
        <div className="space-y-1.5">
          {quotes.map((q) => (
            <button
              key={q.id}
              type="button"
              data-testid={`client-open-quote-${q.id}`}
              onClick={() => onOpenQuote(q.id)}
              className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left hover:border-terracotta transition-colors cursor-pointer"
            >
              <div className="min-w-0 flex-1">
                <div className="font-mono font-bold text-slate-900">{q.quote_code}</div>
                <div className="text-[11px] text-slate-500">
                  Presupuesto · {formatCentsEs(q.total_cents)} · {q.status}
                </div>
              </div>
              <span className="shrink-0 text-[11px] font-semibold text-on-primary-container">
                Abrir →
              </span>
            </button>
          ))}
          {invoices.map((inv) => (
            <button
              key={inv.id}
              type="button"
              data-testid={`client-open-invoice-${inv.id}`}
              onClick={() => onOpenInvoice(inv.id)}
              className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left hover:border-terracotta transition-colors cursor-pointer"
            >
              <div className="min-w-0 flex-1">
                <div className="font-mono font-bold text-slate-900">{inv.invoice_number}</div>
                <div className="text-[11px] text-slate-500">
                  Factura · {formatCentsEs(inv.total_cents)} · {inv.status.replace("_", " ")}
                </div>
              </div>
              <span className="shrink-0 text-[11px] font-semibold text-on-primary-container">
                Abrir →
              </span>
            </button>
          ))}
          {quotes.length === 0 && invoices.length === 0 && (
            <div className="text-slate-500">Sin presupuestos ni facturas para este cliente.</div>
          )}
        </div>
      </section>
    </div>
  );
}
