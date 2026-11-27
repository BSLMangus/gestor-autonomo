import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { LocalInferenceAdapterImpl } from "../../agent/inference/localInferenceAdapter";
import { extractFlexibleDateRange, extractFlexibleSpanishDateIso } from "../../agent/inference/spanishFormParsers";
import type {
  ActaRow,
  BillingModeConfig,
  ClientRow,
  ExpenseTicketRow,
  InvoiceRow,
  JobRow,
  JobScheduleDeviationSummary,
  JobStatus,
  QuoteRow,
  ScheduleEntryRow,
  SiteLogRecord,
  WorkScheduleDefaults,
} from "../../core/contracts/types";
import { ActasRepository } from "../../core/db/repositories/actasRepo";
import { ClientsRepository } from "../../core/db/repositories/clientsRepo";
import { InvoicesRepository } from "../../core/db/repositories/invoicesRepo";
import { JobsRepository } from "../../core/db/repositories/jobsRepo";
import { QuotesRepository } from "../../core/db/repositories/quotesRepo";
import {
  computeDailyWorkHoursThousandths,
  ScheduleRepository,
} from "../../core/db/repositories/scheduleRepo";
import { SettingsRepository } from "../../core/db/repositories/settingsRepo";
import { SiteLogsRepository } from "../../core/db/repositories/siteLogsRepo";
import { TicketsRepository } from "../../core/db/repositories/ticketsRepo";
import { computeJobBillingProfitability, formatCentsEs } from "../../core/fiscal/fiscalEngine";
import type { VoiceInputAdapter } from "../../core/hardware/voiceAdapter";
import { BACK_PRIORITY } from "../../core/navigation/routes";
import type { LocalFileBridge, SqliteExecutor } from "../../core/contracts/types";
import { ConfirmDeleteDialog } from "../../ui/ConfirmDeleteDialog";
import { InlineVoiceFormTrigger } from "../../ui/ContextualVoiceDock";
import { SubDayDurationPicker } from "../calendar/SubDayDurationPicker";
import {
  BillingModeSelector,
  createDefaultBillingModeConfig,
  getBillingModeBadgeLabel,
} from "../jobs/BillingModeSelector";

const FALLBACK_SCHEDULE_DEFAULTS: WorkScheduleDefaults = {
  work_days: [1, 2, 3, 4, 5],
  morning_start: "08:00",
  morning_end: "14:00",
  afternoon_start: "15:00",
  afternoon_end: "17:00",
  auto_apply_to_jobs: true,
};

interface JobDetailDrawerProps {
  jobId: string | null;
  executor: SqliteExecutor;
  fileBridge: LocalFileBridge;
  voiceAdapter?: VoiceInputAdapter;
  inferenceAdapter?: LocalInferenceAdapterImpl;
  onClose: () => void;
  onOpenClient?: (clientId: string) => void;
  onOpenQuote: (quoteId: string) => void;
  onOpenInvoice: (invoiceId: string) => void;
  onOpenTicket: (ticketId: string) => void;
  onOpenActa?: (actaId: string) => void;
  onPreviewQuote?: (quoteId: string) => void;
  onPreviewInvoice?: (invoiceId: string) => void;
  onPreviewActa?: (actaId: string) => void;
  onCreateJobActa?: (jobId: string, clientId: string | null) => Promise<void>;
  onStartJobQuote: (jobId: string) => Promise<void>;
  onDataChanged: () => Promise<void>;
  registerBackHandler?: (priority: number, handler: () => boolean) => () => void;
}

function SiteLogThumbnail({
  fileBridge,
  photoUri,
  alt,
}: {
  fileBridge: LocalFileBridge;
  photoUri: string | null;
  alt: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let revoker: (() => void) | null = null;
    let active = true;
    if (!photoUri) {
      setUrl(null);
      return;
    }
    fileBridge
      .resolveDisplayUrl(photoUri)
      .then((res) => {
        if (!active) {
          res?.revoke();
          return;
        }
        revoker = res?.revoke ?? null;
        setUrl(res?.url ?? null);
      })
      .catch(() => {
        if (active) setUrl(null);
      });
    return () => {
      active = false;
      revoker?.();
    };
  }, [fileBridge, photoUri]);

  if (!url) return null;
  return (
    <img
      src={url}
      alt={alt}
      className="mt-1.5 max-h-36 w-full rounded-lg object-cover border border-[#E5DFD2]"
    />
  );
}

export function JobDetailDrawer({
  jobId,
  executor,
  fileBridge,
  voiceAdapter,
  inferenceAdapter: _inferenceAdapter,
  onClose,
  onOpenClient,
  onOpenQuote,
  onOpenInvoice,
  onOpenTicket,
  onOpenActa,
  onPreviewQuote,
  onPreviewInvoice,
  onPreviewActa,
  onCreateJobActa,
  onStartJobQuote,
  onDataChanged,
  registerBackHandler,
}: JobDetailDrawerProps) {
  const [job, setJob] = useState<JobRow | null>(null);
  const [client, setClient] = useState<ClientRow | null>(null);
  const [quotes, setQuotes] = useState<QuoteRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [tickets, setTickets] = useState<ExpenseTicketRow[]>([]);
  const [siteLogs, setSiteLogs] = useState<SiteLogRecord[]>([]);
  const [actas, setActas] = useState<ActaRow[]>([]);
  const [scheduleEntries, setScheduleEntries] = useState<ScheduleEntryRow[]>([]);
  const [scheduleSummary, setScheduleSummary] = useState<JobScheduleDeviationSummary | null>(null);
  const [defaultHourlyRateCents, setDefaultHourlyRateCents] = useState<number>(3800);
  const [billingConfigDraft, setBillingConfigDraft] = useState<BillingModeConfig>(() =>
    createDefaultBillingModeConfig(3800)
  );
  const [editingBillingConfig, setEditingBillingConfig] = useState(false);
  const [billingSavedMsg, setBillingSavedMsg] = useState<string | null>(null);
  const [editStartDate, setEditStartDate] = useState("");
  const [editEndDate, setEditEndDate] = useState("");
  const [scheduleDefaults, setScheduleDefaults] =
    useState<WorkScheduleDefaults>(FALLBACK_SCHEDULE_DEFAULTS);
  const [planStartTime, setPlanStartTime] = useState(FALLBACK_SCHEDULE_DEFAULTS.morning_start);
  const [planEndTime, setPlanEndTime] = useState(FALLBACK_SCHEDULE_DEFAULTS.afternoon_end);
  const [planHoursThousandths, setPlanHoursThousandths] = useState<number>(8000);
  const [datesUndoStack, setDatesUndoStack] = useState<Array<{ start: string; end: string }>>([]);
  const [datesVoiceChanges, setDatesVoiceChanges] = useState<string[]>([]);
  const [datesVoiceWarnings, setDatesVoiceWarnings] = useState<string[]>([]);
  const [scheduleSavedMsg, setScheduleSavedMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteSiteLogTarget, setDeleteSiteLogTarget] = useState<SiteLogRecord | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const reload = async (targetId: string) => {
    const jobsRepo = new JobsRepository(executor);
    const quotesRepo = new QuotesRepository(executor);
    const invoicesRepo = new InvoicesRepository(executor);
    const ticketsRepo = new TicketsRepository(executor);
    const siteLogsRepo = new SiteLogsRepository(executor);
    const clientsRepo = new ClientsRepository(executor);
    const scheduleRepo = new ScheduleRepository(executor);
    const settingsRepo = new SettingsRepository(executor);
    const actasRepo = new ActasRepository(executor);

    const j = await jobsRepo.getById(targetId);
    setJob(j);
    if (!j) return;

    setEditStartDate(j.start_date_iso ?? "");
    setEditEndDate(j.end_date_iso ?? "");

    const [cl, qList, iList, tRes, slList, schedSum, defaults, jobEntries, jobActas, appSettings] = await Promise.all([
      j.client_id ? clientsRepo.getById(j.client_id) : Promise.resolve(null),
      quotesRepo.listByJobId(j.id),
      invoicesRepo.listByJobId(j.id),
      ticketsRepo.listByQuarterOrJob({ jobId: j.id, limit: 50, offset: 0 }),
      siteLogsRepo.listByJobId(j.id),
      scheduleRepo.getJobScheduleDeviationSummary(j.id),
      scheduleRepo.getWorkScheduleDefaults(),
      scheduleRepo.listEntriesByJob(j.id),
      actasRepo.listByJobId(j.id),
      settingsRepo.getAppSettings(),
    ]);
    const hourlyRate = appSettings.hourly_rate_cents ?? 3800;
    setDefaultHourlyRateCents(hourlyRate);
    setBillingConfigDraft({
      modalidad_cobro: j.modalidad_cobro ?? "solo_partidas",
      solo_mano_obra_submodo: j.solo_mano_obra_submodo ?? "por_horas",
      horas_estimadas_thousandths: j.horas_estimadas_thousandths ?? 0,
      tarifa_hora_cents: j.tarifa_hora_cents ?? hourlyRate,
      mano_obra_fija_cents: j.mano_obra_fija_cents ?? 0,
    });
    setClient(cl);
    setQuotes(qList);
    setInvoices(iList);
    setTickets(tRes.items);
    setSiteLogs(slList);
    setActas(jobActas);
    setScheduleEntries(jobEntries);
    setScheduleSummary(schedSum);
    setScheduleDefaults(defaults);
    if (jobEntries.length === 1 && j.start_date_iso && j.start_date_iso === (j.end_date_iso ?? j.start_date_iso)) {
      setPlanStartTime(jobEntries[0]!.planned_start);
      setPlanEndTime(jobEntries[0]!.planned_end);
      setPlanHoursThousandths(jobEntries[0]!.planned_hours_thousandths);
    } else {
      setPlanStartTime(defaults.morning_start);
      setPlanEndTime(defaults.afternoon_end || defaults.morning_end);
      setPlanHoursThousandths(computeDailyWorkHoursThousandths(defaults) || 8000);
    }
  };

  useEffect(() => {
    if (!jobId) return;
    setErrorMsg(null);
    setBillingSavedMsg(null);
    setEditingBillingConfig(false);
    setDeleteSiteLogTarget(null);
    setDeleteError(null);
    void reload(jobId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, executor]);

  const handleConfirmDeleteSiteLog = async () => {
    if (!deleteSiteLogTarget || !jobId) return;
    setDeleteError(null);
    setBusy(true);
    try {
      await new SiteLogsRepository(executor).delete(deleteSiteLogTarget.id, fileBridge);
      setDeleteSiteLogTarget(null);
      await reload(jobId);
      await onDataChanged();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!jobId || !registerBackHandler) return;
    return registerBackHandler(BACK_PRIORITY.MODAL_SECONDARY, () => {
      onClose();
      return true;
    });
  }, [jobId, onClose, registerBackHandler]);

  if (!jobId) return null;

  const runAction = async (fn: () => Promise<void>) => {
    setErrorMsg(null);
    setBusy(true);
    try {
      await fn();
      if (jobId) await reload(jobId);
      await onDataChanged();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const transitionOptions: JobStatus[] =
    job?.status === "pendiente"
      ? ["en_curso", "cancelado"]
      : job?.status === "en_curso"
        ? ["finalizado", "cancelado"]
        : [];

  return (
    <div
      data-testid="job-detail-drawer"
      className="fixed inset-0 z-50 flex flex-col bg-[#2C2621]/45 backdrop-blur-[1px] font-sans text-[#2C2621]"
      role="dialog"
      aria-modal="true"
      aria-label="Detalle de obra"
    >
      <div className="clipboard-panel mx-auto mt-8 flex min-h-0 w-full max-w-md flex-1 flex-col rounded-t-[24px] border-t border-[#E5DFD2] bg-[#FFFDF7] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#E5DFD2] bg-[#F5F1E6] rounded-t-[24px] px-4 py-3.5">
          <div className="min-w-0">
            <div className="font-mono font-mono-nums text-[11px] font-semibold text-[#4A2500] tabular-nums">
              {job?.job_code ?? jobId}
            </div>
            <h3 className="truncate text-[16px] font-semibold text-[#2C2621]">
              {job?.title ?? "Cargando obra..."}
            </h3>
          </div>
          <button
            type="button"
            data-testid="close-job-detail-btn"
            onClick={onClose}
            className="h-10 w-10 rounded-full text-sm font-bold text-[#6B6860] hover:bg-[#EFECE4] cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="cotton-paper flex-1 overflow-y-auto no-scrollbar bg-[#F9F7F2] p-4 space-y-4 text-xs">
          {errorMsg && (
            <div role="alert" className="rounded-2xl border border-[#DC2626]/30 bg-[#FAD2D8] p-3 text-[#5A121C]">
              {errorMsg}
            </div>
          )}
          {scheduleSavedMsg && (
            <div className="rounded-2xl border border-[#059669]/30 bg-[#D4EDDA] p-3 font-semibold text-[#1B3A24]">
              {scheduleSavedMsg}
            </div>
          )}

          {job && (() => {
            const hasIssuedInvoices = invoices.length > 0;
            const profitability = computeJobBillingProfitability({
              jobs: [job],
              quotes,
              invoices,
              tickets,
              scheduleEntries,
            })[0];
            const showProfitability =
              Boolean(profitability) &&
              (quotes.length > 0 || invoices.length > 0 || tickets.length > 0);
            const formatHoursLabel = (thousandths: number) =>
              `${(thousandths / 1000).toFixed(1).replace(/\.0$/, "").replace(".", ",")} h`;

            return (
            <>
              <div className="postit-note postit-blue p-4 space-y-2.5 text-[#143552]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-[#143552]">Estado de obra:</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      data-testid={`job-detail-billing-badge-${job.id}`}
                      className="rounded-full border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 py-0.5 text-[10px] font-semibold text-[#3D352E]"
                    >
                      {getBillingModeBadgeLabel(job.modalidad_cobro, job.solo_mano_obra_submodo)}
                    </span>
                    <span
                      className={`paper-stamp rounded px-2.5 py-0.5 font-semibold uppercase text-[10px] ${
                        job.status === "en_curso"
                          ? "status-emerald"
                          : job.status === "finalizado"
                            ? "status-cobalt"
                            : job.status === "cancelado"
                              ? "status-tangerine"
                              : "status-gold"
                      }`}
                    >
                      {job.status}
                    </span>
                  </div>
                </div>
                <div className="text-[#2C2621]">
                  Cliente:{" "}
                  {client && onOpenClient ? (
                    <button
                      type="button"
                      data-testid="job-detail-open-client-btn"
                      onClick={() => onOpenClient(client.id)}
                      className="font-semibold text-[#143552] underline underline-offset-2 cursor-pointer"
                    >
                      {client.name} →
                    </button>
                  ) : (
                    <strong>{client?.name ?? "Sin cliente asignado"}</strong>
                  )}
                </div>
                {job.address && <div className="text-[#143552]/90">{job.address}</div>}

                {(job.status !== "cancelado" || transitionOptions.length > 0) && (
                  <div className="flex flex-wrap gap-2 pt-2">
                    {job.status !== "cancelado" && (
                      <button
                        type="button"
                        data-testid="job-detail-start-quote-btn"
                        disabled={busy}
                        onClick={() => void onStartJobQuote(job.id)}
                        className="min-h-[44px] rounded-xl bg-[#D04B00] hover:bg-[#EA580C] px-3.5 font-semibold text-white cursor-pointer shadow-xs"
                      >
                        + Presupuesto en chat
                      </button>
                    )}

                    {transitionOptions.map((st) => (
                      <button
                        key={st}
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void runAction(async () => {
                            await new JobsRepository(executor).transitionStatus(job.id, st);
                          })
                        }
                        className="min-h-[44px] rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 font-semibold text-[#2C2621] hover:border-[#EA580C] cursor-pointer"
                      >
                        Pasar a {st}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Modalidad de cobro */}
              <div className="paper-sheet rounded-[20px] border border-[#E5DFD2] bg-[#FFFDF7] p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-[13px] font-semibold text-[#2C2621]">
                    Modalidad de cobro
                  </h4>
                  {!hasIssuedInvoices && (
                    <button
                      type="button"
                      data-testid="job-detail-edit-billing-btn"
                      disabled={busy}
                      onClick={() => {
                        setBillingSavedMsg(null);
                        setEditingBillingConfig((v) => !v);
                      }}
                      className="rounded-lg border border-[#E5DFD2] bg-[#F5F1E6] px-2.5 py-1 text-[11px] font-semibold text-[#2C2621] hover:border-[#EA580C] cursor-pointer"
                    >
                      {editingBillingConfig ? "Cerrar" : "Editar modalidad"}
                    </button>
                  )}
                </div>

                {billingSavedMsg && (
                  <div className="rounded-xl border border-[#059669]/30 bg-[#D4EDDA] px-3 py-2 text-[11px] font-semibold text-[#1B3A24]">
                    {billingSavedMsg}
                  </div>
                )}

                {hasIssuedInvoices ? (
                  <div
                    data-testid="job-detail-billing-locked"
                    className="rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] px-3 py-2 text-[11px] text-[#6B6860]"
                  >
                    <span className="font-semibold text-[#2C2621]">
                      {getBillingModeBadgeLabel(job.modalidad_cobro, job.solo_mano_obra_submodo)}
                    </span>{" "}
                    · Modalidad bloqueada porque la obra ya tiene facturas emitidas.
                  </div>
                ) : editingBillingConfig ? (
                  <div className="space-y-2.5">
                    <BillingModeSelector
                      value={billingConfigDraft}
                      onChange={setBillingConfigDraft}
                      defaultHourlyRateCents={defaultHourlyRateCents}
                      compact
                      disabled={busy}
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setEditingBillingConfig(false)}
                        className="min-h-[40px] rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 font-semibold text-[#6B6860] cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        data-testid="job-detail-save-billing-btn"
                        disabled={busy}
                        onClick={() =>
                          void runAction(async () => {
                            await new JobsRepository(executor).updateBillingConfig(
                              job.id,
                              billingConfigDraft
                            );
                            setEditingBillingConfig(false);
                            setBillingSavedMsg("Modalidad de cobro actualizada.");
                          })
                        }
                        className="min-h-[40px] flex-1 rounded-xl bg-[#4B7094] font-semibold text-[#FFFDF9] cursor-pointer disabled:opacity-50"
                      >
                        Guardar modalidad
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] px-3 py-2 text-[11px] text-[#6B6860]">
                    Configuración actual:{" "}
                    <strong className="text-[#2C2621]">
                      {getBillingModeBadgeLabel(job.modalidad_cobro, job.solo_mano_obra_submodo)}
                    </strong>
                    {job.horas_estimadas_thousandths > 0 &&
                      (job.modalidad_cobro === "partidas_mas_horas" ||
                        (job.modalidad_cobro === "solo_mano_obra" &&
                          job.solo_mano_obra_submodo === "por_horas")) &&
                      ` · ${formatHoursLabel(job.horas_estimadas_thousandths)} × ${formatCentsEs(
                        job.tarifa_hora_cents ?? defaultHourlyRateCents
                      )}/h`}
                    {job.mano_obra_fija_cents > 0 &&
                      (job.modalidad_cobro === "partidas_mas_fijo_mano_obra" ||
                        (job.modalidad_cobro === "solo_mano_obra" &&
                          job.solo_mano_obra_submodo === "precio_cerrado")) &&
                      ` · Fijo MO ${formatCentsEs(job.mano_obra_fija_cents)}`}
                  </div>
                )}
              </div>

              {/* Resumen de rentabilidad: Mano de obra vs Partidas/Gastos */}
              {showProfitability && profitability && (
                <div
                  data-testid="job-detail-profitability-summary"
                  className="paper-sheet rounded-[20px] border border-[#E5DFD2] bg-[#FFFDF7] p-4 space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-[13px] font-semibold text-[#2C2621]">
                      Rentabilidad (Mano de obra vs Partidas/Gastos)
                    </h4>
                    <span
                      className={`font-mono font-mono-nums text-[12px] font-bold tabular-nums ${
                        profitability.netProfitCents >= 0 ? "text-[#14532D]" : "text-[#9A2D08]"
                      }`}
                    >
                      Neto {formatCentsEs(profitability.netProfitCents)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div className="rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] p-2.5">
                      <div className="text-[#6B6860]">Mano de obra (presup.)</div>
                      <div className="font-mono font-mono-nums font-bold text-[#2C2621] tabular-nums">
                        {formatCentsEs(profitability.quotedLaborCents)}
                      </div>
                    </div>
                    <div className="rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] p-2.5">
                      <div className="text-[#6B6860]">Partidas / Mat. (presup.)</div>
                      <div className="font-mono font-mono-nums font-bold text-[#2C2621] tabular-nums">
                        {formatCentsEs(profitability.quotedItemsCents)}
                      </div>
                    </div>
                    <div className="rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] p-2.5">
                      <div className="text-[#6B6860]">Facturado (base)</div>
                      <div className="font-mono font-mono-nums font-bold text-[#14532D] tabular-nums">
                        {formatCentsEs(profitability.invoicedBaseCents)}
                      </div>
                    </div>
                    <div className="rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] p-2.5">
                      <div className="text-[#6B6860]">Gastos tickets (base)</div>
                      <div className="font-mono font-mono-nums font-bold text-[#9A2D08] tabular-nums">
                        {formatCentsEs(profitability.ticketsBaseCents)}
                      </div>
                    </div>
                  </div>

                  {(profitability.budgetedHoursThousandths > 0 ||
                    profitability.loggedHoursThousandths > 0) && (
                    <div className="flex items-center justify-between rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] px-3 py-1.5 text-[11px]">
                      <span className="text-[#6B6860]">Horas mano de obra</span>
                      <span className="font-mono font-mono-nums font-semibold text-[#2C2621] tabular-nums">
                        {formatHoursLabel(profitability.budgetedHoursThousandths)} est. ·{" "}
                        {formatHoursLabel(profitability.loggedHoursThousandths)} reg.
                      </span>
                    </div>
                  )}

                  {profitability.hasUnexpectedMaterialTickets && (
                    <div
                      data-testid="job-detail-unexpected-material-alert"
                      className="rounded-xl border border-[#D97706]/40 bg-[#FFF3A1]/70 px-3 py-2 text-[11px] font-semibold text-[#3E3300]"
                    >
                      Aviso: hay tickets de materiales imputados en una obra configurada como «Solo mano de obra».
                    </div>
                  )}
                </div>
              )}

              {/* Planificación en Agenda y Calendario */}
              <div className="paper-sheet rounded-[20px] border border-[#E5DFD2] bg-[#FFFDF7] p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-[13px] font-semibold text-[#2C2621]">
                    Planificación y horas en calendario
                  </h4>
                  {scheduleSummary && scheduleSummary.planned_days > 0 && (
                    <span className="font-mono font-mono-nums text-[11px] font-semibold rounded-full status-tangerine px-2.5 py-0.5 tabular-nums">
                      {scheduleSummary.planned_days} días · {(scheduleSummary.planned_hours_thousandths / 1000).toFixed(1).replace(/\.0$/, "")} h
                    </span>
                  )}
                </div>

                <InlineVoiceFormTrigger
                  voiceAdapter={voiceAdapter}
                  registerBackHandler={registerBackHandler}
                  testId="job-detail-dates-voice-btn"
                  title="Dictar fechas de la obra"
                  placeholder="Ej: Del 24 al 30 de este mes"
                  examples={[
                    "Del 24 al 30 de este mes",
                    "Inicio el lunes y fin el viernes",
                  ]}
                  buttonLabel="Dictar fechas"
                  disabled={busy}
                  lastChanges={datesVoiceChanges}
                  lastWarnings={datesVoiceWarnings}
                  canUndo={datesUndoStack.length > 0}
                  onUndo={() => {
                    const prev = datesUndoStack[datesUndoStack.length - 1];
                    if (!prev) return;
                    setDatesUndoStack((s) => s.slice(0, -1));
                    setEditStartDate(prev.start);
                    setEditEndDate(prev.end);
                    setDatesVoiceChanges(["Último dictado deshecho"]);
                    setDatesVoiceWarnings([]);
                  }}
                  onTranscript={(text) => {
                    const snap = { start: editStartDate, end: editEndDate };
                    const range = extractFlexibleDateRange(text);
                    if (range.start_date_iso && range.end_date_iso) {
                      setDatesUndoStack((s) => [...s.slice(-9), snap]);
                      setEditStartDate(range.start_date_iso);
                      setEditEndDate(range.end_date_iso);
                      setDatesVoiceChanges([`Fechas: ${range.start_date_iso} → ${range.end_date_iso}`]);
                      setDatesVoiceWarnings([]);
                      return;
                    }
                    const single = extractFlexibleSpanishDateIso(text);
                    if (single) {
                      setDatesUndoStack((s) => [...s.slice(-9), snap]);
                      if (/\bfin\b|\bhasta\b/.test(text.toLowerCase())) {
                        setEditEndDate(single);
                        setDatesVoiceChanges([`Fin: ${single}`]);
                      } else {
                        setEditStartDate(single);
                        setDatesVoiceChanges([`Inicio: ${single}`]);
                      }
                      setDatesVoiceWarnings([]);
                    } else {
                      setDatesVoiceChanges([]);
                      setDatesVoiceWarnings(["Di un rango como «del 24 al 30 de este mes»."]);
                    }
                  }}
                />

                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold text-[#6B6860]">Inicio</span>
                    <input
                      type="date"
                      data-testid="job-detail-start-date"
                      value={editStartDate}
                      onChange={(e) => {
                        const next = e.target.value;
                        setEditStartDate(next);
                        if (!editEndDate || editEndDate === editStartDate || (next && editEndDate < next)) {
                          setEditEndDate(next);
                        }
                      }}
                      className="min-h-[40px] rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 font-mono tabular-nums text-[12px] text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold text-[#6B6860]">Fin</span>
                    <input
                      type="date"
                      data-testid="job-detail-end-date"
                      value={editEndDate}
                      onChange={(e) => setEditEndDate(e.target.value)}
                      className="min-h-[40px] rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 font-mono tabular-nums text-[12px] text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
                    />
                  </label>
                </div>

                {editStartDate && (!editEndDate || editStartDate === editEndDate) && (
                  <div className="rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] p-3">
                    <SubDayDurationPicker
                      startTime={planStartTime}
                      endTime={planEndTime}
                      defaults={scheduleDefaults}
                      disabled={busy}
                      onChange={(next) => {
                        setPlanStartTime(next.startTime);
                        setPlanEndTime(next.endTime);
                        setPlanHoursThousandths(next.hoursThousandths);
                      }}
                    />
                  </div>
                )}

                {scheduleSummary && scheduleSummary.logged_days > 0 && (
                  <div className="rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] px-3 py-2 flex items-center justify-between text-[11px]">
                    <span className="text-[#6B6860]">
                      Registrado ({scheduleSummary.logged_days} días):{" "}
                      <strong className="font-mono tabular-nums text-[#2C2621]">
                        {(scheduleSummary.actual_hours_thousandths / 1000).toFixed(1).replace(/\.0$/, "")} h
                      </strong>
                    </span>
                    <span className="font-mono font-mono-nums font-semibold text-[#4A2500] tabular-nums">
                      Desv. {scheduleSummary.deviation_hours_thousandths >= 0 ? "+" : ""}
                      {(scheduleSummary.deviation_hours_thousandths / 1000).toFixed(1).replace(/\.0$/, "")} h (
                      {scheduleSummary.economic_impact_cents >= 0 ? "+" : ""}
                      {formatCentsEs(scheduleSummary.economic_impact_cents)})
                    </span>
                  </div>
                )}

                <button
                  type="button"
                  data-testid="job-detail-plan-calendar-btn"
                  disabled={busy || !editStartDate}
                  onClick={() =>
                    void runAction(async () => {
                      setScheduleSavedMsg(null);
                      const effectiveEnd = editEndDate || editStartDate;
                      const isSameDay = editStartDate === effectiveEnd;
                      const entries = await new ScheduleRepository(
                        executor
                      ).generateEntriesForJobDateRange(
                        job.id,
                        editStartDate,
                        effectiveEnd,
                        isSameDay
                          ? {
                              plannedStart: planStartTime,
                              plannedEnd: planEndTime,
                              plannedHoursThousandths: planHoursThousandths,
                              replaceSingleDayHours: true,
                            }
                          : undefined
                      );
                      setScheduleSavedMsg(
                        isSameDay
                          ? `Agenda actualizada (${(planHoursThousandths / 1000).toFixed(1).replace(/\.0$/, "").replace(".", ",")} h el ${editStartDate}).`
                          : `Agenda actualizada: ${entries.length} día(s) planificado(s) según horario habitual.`
                      );
                    })
                  }
                  className="min-h-[42px] w-full rounded-xl bg-[#4B7094] font-semibold text-[#FFFDF9] disabled:opacity-45 cursor-pointer shadow-xs"
                >
                  Planificar en calendario
                </button>
              </div>

              <div>
                <h4 className="font-semibold text-[#2C2621] mb-1.5">Presupuestos ({quotes.length})</h4>
                <div className="space-y-2">
                  {quotes.map((q) => {
                    const shouldPreview =
                      (q.status === "aceptado" || q.status === "enviado") && Boolean(onPreviewQuote);
                    return (
                    <button
                      key={q.id}
                      type="button"
                      data-testid={`job-quote-card-${q.id}`}
                      onClick={() => {
                        if (shouldPreview) {
                          onPreviewQuote?.(q.id);
                        } else {
                          onOpenQuote(q.id);
                        }
                      }}
                      className="paper-sheet flex w-full items-center justify-between gap-2 rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] p-3 text-left hover:border-[#EA580C] transition-colors cursor-pointer"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-mono font-mono-nums font-bold text-[#2C2621] tabular-nums">{q.quote_code}</div>
                        <div className="text-[11px] text-[#6B6860]">
                          IVA {q.vat_rate} % · Estado: <strong>{q.status}</strong>
                          {q.sent_at_iso ? ` · Enviado ${q.sent_at_iso}` : ""}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-mono font-mono-nums font-bold text-[#2C2621] tabular-nums">
                          {formatCentsEs(q.total_cents)}
                        </div>
                        <div className="text-[10px] font-semibold text-[#D04B00]">
                          {shouldPreview ? "Vista previa →" : "Abrir →"}
                        </div>
                      </div>
                    </button>
                    );
                  })}
                  {quotes.length === 0 && (
                    <div className="text-[#6B6860]">Sin presupuestos emitidos aún.</div>
                  )}
                </div>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <h4 className="font-semibold text-[#2C2621]">
                    Actas de puesta en marcha ({actas.length})
                  </h4>
                  {onCreateJobActa && (
                    <button
                      type="button"
                      data-testid="job-detail-create-acta-btn"
                      disabled={busy}
                      onClick={() => void onCreateJobActa(job.id, job.client_id)}
                      className="rounded-lg border border-[#EA580C]/40 bg-[#FFD6B0] px-2.5 py-1 text-[11px] font-bold text-[#4A2500] cursor-pointer"
                    >
                      + Crear Acta
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {actas.map((a) => {
                    const shouldPreview =
                      (a.estado === "firmada" || a.estado === "completada") && Boolean(onPreviewActa);
                    return (
                    <button
                      key={a.id}
                      type="button"
                      data-testid={`job-acta-${a.id}`}
                      onClick={() => {
                        if (shouldPreview) {
                          onPreviewActa?.(a.id);
                        } else {
                          onOpenActa?.(a.id);
                        }
                      }}
                      className="paper-sheet flex w-full items-center justify-between gap-2 rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] p-3 text-left hover:border-[#EA580C] transition-colors cursor-pointer"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-mono font-mono-nums font-bold text-[#2C2621] tabular-nums">{a.codigo_acta}</div>
                        <div className="text-[11px] text-[#6B6860]">
                          {a.especialidad} · {a.fecha_emision_iso} · <strong>{a.estado}</strong>
                        </div>
                      </div>
                      <div className="shrink-0 text-[10px] font-semibold text-[#D04B00]">
                        {shouldPreview ? "Vista previa →" : "Abrir →"}
                      </div>
                    </button>
                    );
                  })}
                  {actas.length === 0 && (
                    <div className="text-[#6B6860]">Sin actas técnicas emitidas para esta obra.</div>
                  )}
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-[#2C2621] mb-1.5">Facturas ({invoices.length})</h4>
                <div className="space-y-2">
                  {invoices.map((inv) => (
                    <button
                      key={inv.id}
                      type="button"
                      data-testid={`job-invoice-${inv.id}`}
                      onClick={() => {
                        if (onPreviewInvoice) {
                          onPreviewInvoice(inv.id);
                        } else {
                          onOpenInvoice(inv.id);
                        }
                      }}
                      className="paper-sheet flex w-full items-center justify-between gap-2 rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] p-3 text-left hover:border-[#EA580C] transition-colors cursor-pointer"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-mono font-mono-nums font-bold text-[#2C2621] tabular-nums">{inv.invoice_number}</div>
                        <div className="text-[11px] text-[#6B6860]">
                          {inv.quarter} · Estado: <strong>{inv.status.replace("_", " ")}</strong>
                          {inv.paid_at_iso ? ` (Cobrado ${inv.paid_at_iso})` : ""}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-mono font-mono-nums font-bold text-[#2C2621] tabular-nums">
                          {formatCentsEs(inv.total_cents)}
                        </div>
                        <div className="text-[10px] font-semibold text-[#D04B00]">
                          {onPreviewInvoice ? "Vista previa →" : "Abrir →"}
                        </div>
                      </div>
                    </button>
                  ))}
                  {invoices.length === 0 && (
                    <div className="text-[#6B6860]">Sin facturas emitidas todavía.</div>
                  )}
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-[#2C2621] mb-1.5">Tickets de gasto ({tickets.length})</h4>
                <div className="space-y-2.5 pt-1">
                  {tickets.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      data-testid={`job-ticket-${t.id}`}
                      onClick={() => onOpenTicket(t.id)}
                      className="receipt-slip flex w-full items-center justify-between gap-2 border-x border-[#E5DFD2] px-3 py-2.5 text-left hover:border-[#EA580C] transition-colors cursor-pointer"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold text-[#2C2621]">{t.supplier_name}</div>
                        <div className="text-[11px] text-[#6B6860]">
                          {t.issue_date_iso} · {t.quarter} · {t.category}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-mono font-mono-nums font-bold text-[#2C2621] tabular-nums">{formatCentsEs(t.total_cents)}</div>
                        <div className="text-[10px] font-semibold text-[#D04B00]">
                          Abrir →
                        </div>
                      </div>
                    </button>
                  ))}
                  {tickets.length === 0 && (
                    <div className="text-[#6B6860]">Sin tickets imputados a esta obra.</div>
                  )}
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-[#2C2621] mb-1.5">Diario de obra ({siteLogs.length})</h4>
                <div className="space-y-2">
                  {siteLogs.map((sl) => (
                    <div
                      key={sl.id}
                      className="relative ruled-notebook rounded-xl border border-[#E5DFD2] p-3 pl-10"
                    >
                      <span className="absolute left-2.5 top-3.5 w-2 h-2 rounded-full paper-hole border" aria-hidden="true" />
                      <span className="absolute left-2.5 bottom-3.5 w-2 h-2 rounded-full paper-hole border" aria-hidden="true" />
                      <div className="flex items-center justify-between gap-2 text-[11px] text-[#6B6860]">
                        <div className="flex items-center gap-2">
                          <span className="status-cobalt rounded-full px-2 py-0.5 text-[10px] font-bold uppercase">{sl.category}</span>
                          <span className="font-mono tabular-nums">{sl.created_at_iso}</span>
                        </div>
                        <button
                          type="button"
                          data-testid={`site-log-delete-${sl.id}`}
                          aria-label="Eliminar entrada del diario de obra"
                          disabled={busy}
                          onClick={() => {
                            setDeleteError(null);
                            setDeleteSiteLogTarget(sl);
                          }}
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#DC2626]/25 bg-[#FFFDF7] text-[#DC2626] hover:bg-[#FAD2D8] cursor-pointer disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                      <p className="mt-1 text-[#2C2621]">{sl.note_text}</p>
                      <SiteLogThumbnail
                        fileBridge={fileBridge}
                        photoUri={sl.photo_uri}
                        alt={`Foto ${sl.stamp_job_code}`}
                      />
                    </div>
                  ))}
                  {siteLogs.length === 0 && (
                    <div className="text-[#6B6860]">Sin entradas en el diario de obra.</div>
                  )}
                </div>
              </div>
            </>
            );
          })()}
        </div>
      </div>

      <ConfirmDeleteDialog
        open={deleteSiteLogTarget !== null}
        title="¿Eliminar entrada del diario de obra?"
        description="Se eliminará esta nota y su foto sellada asociada. Esta acción no se puede deshacer."
        errorMsg={deleteError}
        busy={busy}
        confirmTestId="site-log-confirm-delete-btn"
        registerBackHandler={registerBackHandler}
        onCancel={() => {
          if (!busy) {
            setDeleteSiteLogTarget(null);
            setDeleteError(null);
          }
        }}
        onConfirm={handleConfirmDeleteSiteLog}
      />
    </div>
  );
}
