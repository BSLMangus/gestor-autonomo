import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { TEXT_LIMITS } from "../../core/contracts/textLimits";
import type {
  ActaRow,
  BillingModeConfig,
  ClientRow,
  InvoiceRow,
  JobRow,
  QuoteRow,
  SqliteExecutor,
} from "../../core/contracts/types";
import { ActasRepository } from "../../core/db/repositories/actasRepo";
import { ClientsRepository } from "../../core/db/repositories/clientsRepo";
import { JobsRepository } from "../../core/db/repositories/jobsRepo";
import { SettingsRepository } from "../../core/db/repositories/settingsRepo";
import { formatCentsEs } from "../../core/fiscal/fiscalEngine";
import {
  BillingModeSelector,
  createDefaultBillingModeConfig,
  getBillingModeBadgeLabel,
} from "../jobs/BillingModeSelector";

interface ClientProfileViewProps {
  clientId: string;
  executor: SqliteExecutor;
  refreshTick: number;
  onBackToClients: () => void;
  onOpenJob: (jobId: string) => void;
  onOpenQuote: (quoteId: string) => void;
  onOpenInvoice: (invoiceId: string) => void;
  onOpenActa?: (actaId: string) => void;
  onPreviewQuote?: (quoteId: string) => void;
  onPreviewInvoice?: (invoiceId: string) => void;
  onPreviewActa?: (actaId: string) => void;
  onCreateClientActa?: (clientId: string) => Promise<void>;
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
  onOpenActa,
  onPreviewQuote,
  onPreviewInvoice,
  onPreviewActa,
  onCreateClientActa,
  onStartJobQuote,
  onOpenEditWidget,
  onDataChanged,
}: ClientProfileViewProps) {
  const [loading, setLoading] = useState(true);
  const [client, setClient] = useState<ClientRow | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [quotes, setQuotes] = useState<QuoteRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [actas, setActas] = useState<ActaRow[]>([]);

  const [newJobTitle, setNewJobTitle] = useState("");
  const [showNewJobForm, setShowNewJobForm] = useState(false);
  const [defaultHourlyRateCents, setDefaultHourlyRateCents] = useState<number>(3800);
  const [newBillingConfig, setNewBillingConfig] = useState<BillingModeConfig>(() =>
    createDefaultBillingModeConfig(3800)
  );
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadPortfolio = async () => {
    setLoading(true);
    try {
      const [portfolio, clientActas, appSettings] = await Promise.all([
        new ClientsRepository(executor).getClientPortfolio(clientId),
        new ActasRepository(executor).listByClientId(clientId),
        new SettingsRepository(executor).getAppSettings(),
      ]);
      const hourlyRate = appSettings.hourly_rate_cents ?? 3800;
      setDefaultHourlyRateCents(hourlyRate);
      if (!showNewJobForm) {
        setNewBillingConfig(createDefaultBillingModeConfig(hourlyRate));
      }
      if (!portfolio) {
        setClient(null);
        setJobs([]);
        setQuotes([]);
        setInvoices([]);
        setActas([]);
      } else {
        setClient(portfolio.client);
        setJobs(portfolio.jobs);
        setQuotes(portfolio.quotes);
        setInvoices(portfolio.invoices);
        setActas(clientActas);
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
        modalidad_cobro: newBillingConfig.modalidad_cobro,
        solo_mano_obra_submodo: newBillingConfig.solo_mano_obra_submodo,
        horas_estimadas_thousandths: newBillingConfig.horas_estimadas_thousandths,
        tarifa_hora_cents: newBillingConfig.tarifa_hora_cents,
        mano_obra_fija_cents: newBillingConfig.mano_obra_fija_cents,
      });
      setNewJobTitle("");
      setNewBillingConfig(createDefaultBillingModeConfig(defaultHourlyRateCents));
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
      <div className="flex flex-1 items-center justify-center p-6 text-xs text-[#6B6860] cotton-paper">
        Cargando ficha de cliente...
      </div>
    );
  }

  if (!client) {
    return (
      <div
        data-testid="client-not-found-view"
        className="flex flex-1 flex-col items-center justify-center p-6 text-center space-y-3 cotton-paper"
      >
        <p className="text-sm font-bold text-[#2C2621]">Cliente no encontrado</p>
        <p className="text-xs text-[#6B6860]">
          Es posible que se haya eliminado o restaurado el catálogo.
        </p>
        <button
          type="button"
          onClick={onBackToClients}
          className="min-h-11 rounded-xl bg-[#4B7094] px-4 text-xs font-bold text-[#FFFDF9] cursor-pointer"
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

  const clientParts = client.name.trim().split(/\s+/).filter(Boolean);
  const clientInitials =
    clientParts.length === 0
      ? "CL"
      : clientParts.length === 1
        ? clientParts[0]!.slice(0, 2).toUpperCase()
        : `${clientParts[0]![0] ?? ""}${clientParts[1]![0] ?? ""}`.toUpperCase();
  const tabLetter = (client.name.trim()[0] ?? "C").toUpperCase();

  return (
    <div
      data-testid="client-profile-view"
      className="flex flex-1 flex-col w-full max-w-full overflow-y-auto overflow-x-hidden no-scrollbar p-4 space-y-4 text-xs cotton-paper text-[#2C2621]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 w-full min-w-0">
        <button
          type="button"
          data-testid="back-to-clients-btn"
          onClick={onBackToClients}
          className="inline-flex min-h-[42px] items-center gap-1.5 rounded-full border border-[#E5DFD2] bg-[#FFFDF7] px-3.5 text-[12px] font-semibold text-[#2C2621] shadow-xs cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Clientes</span>
        </button>
        <button
          type="button"
          data-testid="edit-client-profile-btn"
          onClick={() => onOpenEditWidget(client)}
          className="min-h-[42px] rounded-full bg-[#4B7094] hover:bg-[#3F5F7E] px-4 text-[12px] font-semibold text-[#FFFDF9] cursor-pointer transition-colors"
        >
          Editar datos
        </button>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="paper-sheet rounded-2xl border border-[#DC2626]/30 bg-[#FAD2D8] p-3 text-[#5A121C] font-medium"
        >
          {errorMsg}
        </div>
      )}
      {statusMsg && (
        <div className="paper-sheet rounded-2xl border border-[#1E8E5A]/30 bg-[#D4EDDA] p-3 font-semibold text-[#1B3A24]">
          {statusMsg}
        </div>
      )}

      {/* Cabecera de datos fiscales estilo ficha Rolodex */}
      <section className="relative ruled-index border border-[#E5DFD2] rounded-2xl overflow-hidden flex">
        <div
          className="w-8 postit-lavender border-r border-[#E5DFD2] flex items-center justify-center shrink-0"
          aria-hidden="true"
        >
          <span className="font-mono text-[12px] font-bold text-[#4C1D95]">{tabLetter}</span>
        </div>
        <div className="flex-1 min-w-0 p-3.5 space-y-2">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full postit-peach border border-[#E5DFD2] text-[#4A2500] font-sans text-[15px] font-bold flex items-center justify-center shrink-0">
              {clientInitials}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="min-w-0 text-base font-bold text-[#2C2621] break-words [overflow-wrap:anywhere]">
                {client.name}
              </h2>
              <div className="font-mono text-[11px] text-[#6B6860] tabular-nums break-words [overflow-wrap:anywhere]">
                <span className="font-semibold text-[#2C2621]">NIF/CIF:</span>{" "}
                {client.nif || "No especificado"} ·{" "}
                <span className="font-semibold text-[#2C2621]">Tel:</span>{" "}
                {client.phone || "No especificado"}
              </div>
            </div>
          </div>
          {client.fiscal_address && (
            <div className="text-[#6B6860] break-words [overflow-wrap:anywhere]">
              <span className="font-semibold text-[#2C2621]">Dirección:</span>{" "}
              {client.fiscal_address}
            </div>
          )}
          {client.email && (
            <div className="text-[#6B6860] break-words [overflow-wrap:anywhere]">
              <span className="font-semibold text-[#2C2621]">Email:</span> {client.email}
            </div>
          )}
          {client.notes && (
            <div className="rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] p-2 text-[11px] text-[#6B6860]">
              {client.notes}
            </div>
          )}
        </div>
      </section>

      {/* Resumen económico en Post-its */}
      <div className="grid grid-cols-2 gap-3">
        <div className="postit-note postit-blue tilt-subtle-left p-3">
          <div className="text-[11px] font-semibold text-[#143552]">Presupuestado</div>
          <div className="mt-0.5 font-mono text-[15px] font-bold text-[#143552] tabular-nums">
            {formatCentsEs(totalQuotedCents)}
          </div>
        </div>
        <div className="postit-note postit-lavender tilt-subtle-right p-3">
          <div className="text-[11px] font-semibold text-[#4C1D95]">Facturado total</div>
          <div className="mt-0.5 font-mono text-[15px] font-bold text-[#4C1D95] tabular-nums">
            {formatCentsEs(totalInvoicedCents)}
          </div>
        </div>
        <div className="postit-note postit-green tilt-subtle-right p-3">
          <div className="text-[11px] font-semibold text-[#1B3A24]">Cobrado</div>
          <div className="mt-0.5 font-mono text-[15px] font-bold text-[#14532D] tabular-nums">
            {formatCentsEs(totalCollectedCents)}
          </div>
        </div>
        <div className="postit-note postit-yellow tilt-subtle-left p-3">
          <div className="text-[11px] font-semibold text-[#3E3300]">Pendiente cobro</div>
          <div className="mt-0.5 font-mono text-[15px] font-bold text-[#713F12] tabular-nums">
            {formatCentsEs(totalPendingCents)}
          </div>
        </div>
      </div>

      {/* Obras asociadas */}
      <section className="ruled-notebook rounded-2xl border border-[#E5DFD2] p-4 pl-9 space-y-2.5">
        <div
          className="absolute left-2.5 top-0 bottom-0 flex flex-col justify-around py-3 pointer-events-none"
          aria-hidden="true"
        >
          <span className="w-2.5 h-2.5 rounded-full paper-hole border shadow-inner" />
          <span className="w-2.5 h-2.5 rounded-full paper-hole border shadow-inner" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 w-full min-w-0">
          <h3 className="text-sm font-bold text-[#2C2621]">Obras asociadas ({jobs.length})</h3>
          <button
            type="button"
            data-testid="client-profile-new-job-btn"
            onClick={() => setShowNewJobForm((v) => !v)}
            className="rounded-lg bg-[#EA580C] hover:bg-[#D04B00] px-2.5 py-1 text-[11px] font-bold text-[#FFFDF9] cursor-pointer transition-colors"
          >
            + Nueva obra
          </button>
        </div>

        {showNewJobForm && (
          <form
            onSubmit={(e) => void handleCreateJobForClient(e)}
            className="w-full min-w-0 space-y-2 rounded-xl border border-[#E5DFD2] bg-[#FFD6B0]/35 p-2.5"
          >
            <div className="flex w-full min-w-0 gap-1.5">
              <input
                type="text"
                maxLength={TEXT_LIMITS.TITLE}
                value={newJobTitle}
                onChange={(e) => setNewJobTitle(e.target.value)}
                placeholder="Título de la obra (ej. Reforma baño)"
                className="min-w-0 flex-1 rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 py-1.5 text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
              />
              <button
                type="submit"
                disabled={busy}
                className="shrink-0 rounded-lg bg-[#4B7094] px-3 py-1.5 text-xs font-bold text-[#FFFDF9] cursor-pointer"
              >
                Crear
              </button>
            </div>
            <BillingModeSelector
              value={newBillingConfig}
              onChange={setNewBillingConfig}
              defaultHourlyRateCents={defaultHourlyRateCents}
              compact
              disabled={busy}
            />
          </form>
        )}

        {jobs.length === 0 ? (
          <div className="text-[#6B6860]">Este cliente aún no tiene obras registradas.</div>
        ) : (
          <div className="space-y-2">
            {jobs.map((job) => (
              <div
                key={job.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] p-2.5"
              >
                <button
                  type="button"
                  data-testid={`client-open-job-${job.id}`}
                  onClick={() => onOpenJob(job.id)}
                  className="min-w-0 flex-1 text-left cursor-pointer"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[11px] font-bold text-[#D04B00] tabular-nums">
                      {job.job_code}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        job.status === "finalizado"
                          ? "status-emerald"
                          : job.status === "en_curso"
                            ? "status-gold"
                            : job.status === "cancelado"
                              ? "status-tangerine"
                              : "status-cobalt"
                      }`}
                    >
                      {job.status}
                    </span>
                    <span className="rounded-full border border-[#E5DFD2] bg-[#F5F1E6] px-2 py-0.5 text-[10px] font-semibold text-[#3D352E]">
                      {getBillingModeBadgeLabel(job.modalidad_cobro, job.solo_mano_obra_submodo)}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate font-bold text-[#2C2621]">{job.title}</div>
                  {job.address && (
                    <div className="truncate text-[10px] text-[#6B6860]">{job.address}</div>
                  )}
                </button>
                {job.status !== "cancelado" && (
                  <button
                    type="button"
                    onClick={() => void onStartJobQuote(job.id)}
                    className="shrink-0 rounded-lg border border-[#E5DFD2] bg-[#FFD6B0] px-2.5 py-1.5 text-[11px] font-bold text-[#4A2500] cursor-pointer"
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
      <section className="ruled-notebook rounded-2xl border border-[#E5DFD2] p-4 pl-9 space-y-2">
        <div
          className="absolute left-2.5 top-0 bottom-0 flex flex-col justify-around py-3 pointer-events-none"
          aria-hidden="true"
        >
          <span className="w-2.5 h-2.5 rounded-full paper-hole border shadow-inner" />
          <span className="w-2.5 h-2.5 rounded-full paper-hole border shadow-inner" />
        </div>
        <h3 className="text-sm font-bold text-[#2C2621]">
          Presupuestos y Facturas ({quotes.length + invoices.length})
        </h3>
        <div className="space-y-1.5">
          {quotes.map((q) => {
            const shouldPreview =
              (q.status === "aceptado" || q.status === "enviado") && Boolean(onPreviewQuote);
            return (
            <button
              key={q.id}
              type="button"
              data-testid={`client-open-quote-${q.id}`}
              onClick={() => {
                if (shouldPreview) {
                  onPreviewQuote?.(q.id);
                } else {
                  onOpenQuote(q.id);
                }
              }}
              className="flex w-full items-center justify-between gap-2 rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2.5 text-left hover:border-[#EA580C] transition-colors cursor-pointer"
            >
              <div className="min-w-0 flex-1">
                <div className="font-mono font-bold text-[#2C2621] tabular-nums">
                  {q.quote_code}
                </div>
                <div className="text-[11px] text-[#6B6860]">
                  Presupuesto ·{" "}
                  <span className="font-mono font-semibold text-[#2C2621] tabular-nums">
                    {formatCentsEs(q.total_cents)}
                  </span>{" "}
                  · {q.status}
                </div>
              </div>
              <span className="shrink-0 text-[11px] font-semibold text-[#D04B00]">
                {shouldPreview ? "Vista previa →" : "Abrir →"}
              </span>
            </button>
            );
          })}
          {invoices.map((inv) => (
            <button
              key={inv.id}
              type="button"
              data-testid={`client-open-invoice-${inv.id}`}
              onClick={() => {
                if (onPreviewInvoice) {
                  onPreviewInvoice(inv.id);
                } else {
                  onOpenInvoice(inv.id);
                }
              }}
              className="flex w-full items-center justify-between gap-2 rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2.5 text-left hover:border-[#EA580C] transition-colors cursor-pointer"
            >
              <div className="min-w-0 flex-1">
                <div className="font-mono font-bold text-[#2C2621] tabular-nums">
                  {inv.invoice_number}
                </div>
                <div className="text-[11px] text-[#6B6860]">
                  Factura ·{" "}
                  <span className="font-mono font-semibold text-[#2C2621] tabular-nums">
                    {formatCentsEs(inv.total_cents)}
                  </span>{" "}
                  · {inv.status.replace("_", " ")}
                </div>
              </div>
              <span className="shrink-0 text-[11px] font-semibold text-[#D04B00]">
                {onPreviewInvoice ? "Vista previa →" : "Abrir →"}
              </span>
            </button>
          ))}
          {quotes.length === 0 && invoices.length === 0 && (
            <div className="text-[#6B6860]">Sin presupuestos ni facturas para este cliente.</div>
          )}
        </div>
      </section>

      {/* Actas de puesta en marcha */}
      <section className="ruled-notebook rounded-2xl border border-[#E5DFD2] p-4 pl-9 space-y-2.5">
        <div
          className="absolute left-2.5 top-0 bottom-0 flex flex-col justify-around py-3 pointer-events-none"
          aria-hidden="true"
        >
          <span className="w-2.5 h-2.5 rounded-full paper-hole border shadow-inner" />
          <span className="w-2.5 h-2.5 rounded-full paper-hole border shadow-inner" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 w-full min-w-0">
          <h3 className="text-sm font-bold text-[#2C2621]">
            Actas de puesta en marcha ({actas.length})
          </h3>
          {onCreateClientActa && (
            <button
              type="button"
              data-testid="client-profile-create-acta-btn"
              disabled={busy}
              onClick={() => void onCreateClientActa(client.id)}
              className="rounded-lg border border-[#E5DFD2] bg-[#FFD6B0] px-2.5 py-1 text-[11px] font-bold text-[#4A2500] cursor-pointer"
            >
              + Crear Acta
            </button>
          )}
        </div>
        <div className="space-y-1.5">
          {actas.map((acta) => {
            const shouldPreview =
              (acta.estado === "firmada" || acta.estado === "completada") && Boolean(onPreviewActa);
            return (
            <button
              key={acta.id}
              type="button"
              data-testid={`client-open-acta-${acta.id}`}
              onClick={() => {
                if (shouldPreview) {
                  onPreviewActa?.(acta.id);
                } else {
                  onOpenActa?.(acta.id);
                }
              }}
              className="flex w-full items-center justify-between gap-2 rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2.5 text-left hover:border-[#EA580C] transition-colors cursor-pointer"
            >
              <div className="min-w-0 flex-1">
                <div className="font-mono font-bold text-[#2C2621] tabular-nums">
                  {acta.codigo_acta}
                </div>
                <div className="text-[11px] text-[#6B6860]">
                  {acta.especialidad} · {acta.fecha_emision_iso} · {acta.estado}
                </div>
              </div>
              <span className="shrink-0 text-[11px] font-semibold text-[#D04B00]">
                {shouldPreview ? "Vista previa →" : "Abrir →"}
              </span>
            </button>
            );
          })}
          {actas.length === 0 && (
            <div className="text-[#6B6860]">Sin actas técnicas para este cliente.</div>
          )}
        </div>
      </section>
    </div>
  );
}
