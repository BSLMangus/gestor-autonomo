import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { LocalInferenceAdapterImpl } from "../../agent/inference/localInferenceAdapter";
import { extractFlexibleDateRange, extractFlexibleSpanishDateIso } from "../../agent/inference/spanishFormParsers";
import type {
  ClientRow,
  ExpenseTicketRow,
  InvoiceRow,
  JobRow,
  JobScheduleDeviationSummary,
  JobStatus,
  QuoteRow,
  SiteLogRecord,
  WorkScheduleDefaults,
} from "../../core/contracts/types";
import { ClientsRepository } from "../../core/db/repositories/clientsRepo";
import { InvoicesRepository } from "../../core/db/repositories/invoicesRepo";
import { JobsRepository } from "../../core/db/repositories/jobsRepo";
import { QuotesRepository } from "../../core/db/repositories/quotesRepo";
import {
  computeDailyWorkHoursThousandths,
  ScheduleRepository,
} from "../../core/db/repositories/scheduleRepo";
import { SiteLogsRepository } from "../../core/db/repositories/siteLogsRepo";
import { TicketsRepository } from "../../core/db/repositories/ticketsRepo";
import { formatCentsEs } from "../../core/fiscal/fiscalEngine";
import type { VoiceInputAdapter } from "../../core/hardware/voiceAdapter";
import { BACK_PRIORITY } from "../../core/navigation/routes";
import type { LocalFileBridge, SqliteExecutor } from "../../core/contracts/types";
import { ConfirmDeleteDialog } from "../../ui/ConfirmDeleteDialog";
import { InlineVoiceFormTrigger } from "../../ui/ContextualVoiceDock";
import { SubDayDurationPicker } from "../calendar/SubDayDurationPicker";

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
      className="mt-1.5 max-h-36 w-full rounded-lg object-cover border border-slate-200"
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
  const [scheduleSummary, setScheduleSummary] = useState<JobScheduleDeviationSummary | null>(null);
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

    const j = await jobsRepo.getById(targetId);
    setJob(j);
    if (!j) return;

    setEditStartDate(j.start_date_iso ?? "");
    setEditEndDate(j.end_date_iso ?? "");

    const [cl, qList, iList, tRes, slList, schedSum, defaults, jobEntries] = await Promise.all([
      j.client_id ? clientsRepo.getById(j.client_id) : Promise.resolve(null),
      quotesRepo.listByJobId(j.id),
      invoicesRepo.listByJobId(j.id),
      ticketsRepo.listByQuarterOrJob({ jobId: j.id, limit: 50, offset: 0 }),
      siteLogsRepo.listByJobId(j.id),
      scheduleRepo.getJobScheduleDeviationSummary(j.id),
      scheduleRepo.getWorkScheduleDefaults(),
      scheduleRepo.listEntriesByJob(j.id),
    ]);
    setClient(cl);
    setQuotes(qList);
    setInvoices(iList);
    setTickets(tRes.items);
    setSiteLogs(slList);
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
      className="fixed inset-0 z-50 flex flex-col bg-secondary/45 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-label="Detalle de obra"
    >
      <div className="mx-auto mt-8 flex min-h-0 w-full max-w-md flex-1 flex-col rounded-t-[24px] border-t border-outline-variant bg-surface-container-lowest shadow-2xl">
        <div className="flex items-center justify-between border-b border-outline-variant px-4 py-3.5">
          <div className="min-w-0">
            <div className="font-mono text-[11px] font-semibold text-on-primary-container">
              {job?.job_code ?? jobId}
            </div>
            <h3 className="truncate text-[16px] font-semibold text-on-surface">
              {job?.title ?? "Cargando obra..."}
            </h3>
          </div>
          <button
            type="button"
            data-testid="close-job-detail-btn"
            onClick={onClose}
            className="h-10 w-10 rounded-full text-sm font-bold text-on-surface-variant hover:bg-surface-container cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-4 text-xs">
          {errorMsg && (
            <div role="alert" className="rounded-2xl border border-coral-alert/30 bg-error-container p-3 text-on-error-container">
              {errorMsg}
            </div>
          )}
          {scheduleSavedMsg && (
            <div className="rounded-2xl border border-outline-variant bg-success-container p-3 font-semibold text-on-success-container">
              {scheduleSavedMsg}
            </div>
          )}

          {job && (
            <>
              <div className="rounded-[20px] border border-outline-variant bg-surface-warm-card p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-on-surface-variant">Estado de obra:</span>
                  <span className="rounded-full bg-secondary px-2.5 py-0.5 font-semibold text-on-secondary uppercase text-[10px]">
                    {job.status}
                  </span>
                </div>
                <div className="text-on-surface">
                  Cliente:{" "}
                  {client && onOpenClient ? (
                    <button
                      type="button"
                      data-testid="job-detail-open-client-btn"
                      onClick={() => onOpenClient(client.id)}
                      className="font-semibold text-on-primary-container underline underline-offset-2 cursor-pointer"
                    >
                      {client.name} →
                    </button>
                  ) : (
                    <strong>{client?.name ?? "Sin cliente asignado"}</strong>
                  )}
                </div>
                {job.address && <div className="text-on-surface-variant">{job.address}</div>}

                {(job.status !== "cancelado" || transitionOptions.length > 0) && (
                  <div className="flex flex-wrap gap-2 pt-2">
                    {job.status !== "cancelado" && (
                      <button
                        type="button"
                        data-testid="job-detail-start-quote-btn"
                        disabled={busy}
                        onClick={() => void onStartJobQuote(job.id)}
                        className="min-h-[44px] rounded-xl bg-primary hover:bg-terracotta px-3.5 font-semibold text-white cursor-pointer"
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
                        className="min-h-[44px] rounded-xl border border-outline-variant bg-surface-container-lowest px-3 font-semibold text-on-surface hover:border-terracotta cursor-pointer"
                      >
                        Pasar a {st}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Planificación en Agenda y Calendario */}
              <div className="rounded-[20px] border border-outline-variant bg-surface-container-lowest p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-[13px] font-semibold text-on-surface">
                    Planificación y horas en calendario
                  </h4>
                  {scheduleSummary && scheduleSummary.planned_days > 0 && (
                    <span className="font-mono text-[11px] font-semibold rounded-full bg-terracotta-soft px-2.5 py-0.5 text-on-primary-container tabular-nums">
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
                    <span className="text-[11px] font-semibold text-on-surface-variant">Inicio</span>
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
                      className="min-h-[40px] rounded-xl border border-outline-variant bg-surface-container-low px-2.5 font-mono text-[12px]"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold text-on-surface-variant">Fin</span>
                    <input
                      type="date"
                      data-testid="job-detail-end-date"
                      value={editEndDate}
                      onChange={(e) => setEditEndDate(e.target.value)}
                      className="min-h-[40px] rounded-xl border border-outline-variant bg-surface-container-low px-2.5 font-mono text-[12px]"
                    />
                  </label>
                </div>

                {editStartDate && (!editEndDate || editStartDate === editEndDate) && (
                  <div className="rounded-xl border border-outline-variant bg-surface-container-low/60 p-3">
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
                  <div className="rounded-xl bg-surface-container-low px-3 py-2 flex items-center justify-between text-[11px]">
                    <span className="text-on-surface-variant">
                      Registrado ({scheduleSummary.logged_days} días):{" "}
                      <strong className="font-mono text-on-surface">
                        {(scheduleSummary.actual_hours_thousandths / 1000).toFixed(1).replace(/\.0$/, "")} h
                      </strong>
                    </span>
                    <span className="font-mono font-semibold text-on-primary-container tabular-nums">
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
                  className="min-h-[42px] w-full rounded-xl bg-secondary font-semibold text-on-secondary disabled:opacity-45 cursor-pointer"
                >
                  Planificar en calendario
                </button>
              </div>

              <div>
                <h4 className="font-bold text-slate-800 mb-1.5">Presupuestos ({quotes.length})</h4>
                <div className="space-y-2">
                  {quotes.map((q) => (
                    <button
                      key={q.id}
                      type="button"
                      data-testid={`job-quote-card-${q.id}`}
                      onClick={() => onOpenQuote(q.id)}
                      className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-terracotta transition-colors cursor-pointer"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-mono font-bold text-slate-900">{q.quote_code}</div>
                        <div className="text-[11px] text-slate-500">
                          IVA {q.vat_rate} % · Estado: <strong>{q.status}</strong>
                          {q.sent_at_iso ? ` · Enviado ${q.sent_at_iso}` : ""}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-mono font-bold text-slate-900 tabular-nums">
                          {formatCentsEs(q.total_cents)}
                        </div>
                        <div className="text-[10px] font-semibold text-on-primary-container">
                          Abrir →
                        </div>
                      </div>
                    </button>
                  ))}
                  {quotes.length === 0 && (
                    <div className="text-slate-500">Sin presupuestos emitidos aún.</div>
                  )}
                </div>
              </div>

              <div>
                <h4 className="font-bold text-slate-800 mb-1.5">Facturas ({invoices.length})</h4>
                <div className="space-y-2">
                  {invoices.map((inv) => (
                    <button
                      key={inv.id}
                      type="button"
                      data-testid={`job-invoice-${inv.id}`}
                      onClick={() => onOpenInvoice(inv.id)}
                      className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-terracotta transition-colors cursor-pointer"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-mono font-bold text-slate-900">{inv.invoice_number}</div>
                        <div className="text-[11px] text-slate-500">
                          {inv.quarter} · Estado: <strong>{inv.status.replace("_", " ")}</strong>
                          {inv.paid_at_iso ? ` (Cobrado ${inv.paid_at_iso})` : ""}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-mono font-bold text-slate-900 tabular-nums">
                          {formatCentsEs(inv.total_cents)}
                        </div>
                        <div className="text-[10px] font-semibold text-on-primary-container">
                          Abrir →
                        </div>
                      </div>
                    </button>
                  ))}
                  {invoices.length === 0 && (
                    <div className="text-slate-500">Sin facturas emitidas todavía.</div>
                  )}
                </div>
              </div>

              <div>
                <h4 className="font-bold text-slate-800 mb-1.5">Tickets de gasto ({tickets.length})</h4>
                <div className="space-y-1.5">
                  {tickets.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      data-testid={`job-ticket-${t.id}`}
                      onClick={() => onOpenTicket(t.id)}
                      className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left hover:border-terracotta transition-colors cursor-pointer"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold text-slate-900">{t.supplier_name}</div>
                        <div className="text-[11px] text-slate-500">
                          {t.issue_date_iso} · {t.quarter} · {t.category}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-bold text-slate-900">{formatCentsEs(t.total_cents)}</div>
                        <div className="text-[10px] font-semibold text-on-primary-container">
                          Abrir →
                        </div>
                      </div>
                    </button>
                  ))}
                  {tickets.length === 0 && (
                    <div className="text-slate-500">Sin tickets imputados a esta obra.</div>
                  )}
                </div>
              </div>

              <div>
                <h4 className="font-bold text-slate-800 mb-1.5">Diario de obra ({siteLogs.length})</h4>
                <div className="space-y-2">
                  {siteLogs.map((sl) => (
                    <div
                      key={sl.id}
                      className="rounded-xl border border-slate-200 bg-slate-50 p-2.5"
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                        <div className="flex items-center gap-2">
                          <span className="font-bold uppercase text-sky-800">{sl.category}</span>
                          <span>{sl.created_at_iso}</span>
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
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-coral-alert/25 bg-white text-coral-alert hover:bg-error-container cursor-pointer disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                      <p className="mt-1 text-slate-800">{sl.note_text}</p>
                      <SiteLogThumbnail
                        fileBridge={fileBridge}
                        photoUri={sl.photo_uri}
                        alt={`Foto ${sl.stamp_job_code}`}
                      />
                    </div>
                  ))}
                  {siteLogs.length === 0 && (
                    <div className="text-slate-500">Sin entradas en el diario de obra.</div>
                  )}
                </div>
              </div>
            </>
          )}
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
