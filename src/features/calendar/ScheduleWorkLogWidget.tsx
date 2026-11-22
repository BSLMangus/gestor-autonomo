import { CalendarCheck2, CalendarPlus, CheckCircle2, Clock, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  ActiveWidgetEnvelope,
  JobRow,
  ScheduleEntryRow,
  ScheduleStatus,
  WorkScheduleDefaults,
} from "../../core/contracts/types";
import { JobsRepository } from "../../core/db/repositories/jobsRepo";
import {
  computeDailyWorkHoursThousandths,
  getIsoWeekday,
  minutesToHHMM,
  parseHHMMToMinutes,
  ScheduleRepository,
} from "../../core/db/repositories/scheduleRepo";
import { SettingsRepository } from "../../core/db/repositories/settingsRepo";
import { addDaysIso } from "../../core/fiscal/dateQuarter";
import { formatCentsEs } from "../../core/fiscal/fiscalEngine";
import type { WidgetCommonProps } from "../chat/widgets/widgetTypes";

type ScheduleWidget = Extract<ActiveWidgetEnvelope, { ui_widget_type: "ScheduleWorkLogWidget" }>;

const DEVIATION_REASONS = [
  "Imprevisto en instalación",
  "Falta de material",
  "Más rápido de lo previsto",
  "Ampliación del cliente",
];

const QUICK_DELTAS = [
  { label: "-1,5 h", deltaThousandths: -1500 },
  { label: "-30 m", deltaThousandths: -500 },
  { label: "En hora", deltaThousandths: 0 },
  { label: "+30 m", deltaThousandths: 500 },
  { label: "+1 h", deltaThousandths: 1000 },
  { label: "+2 h", deltaThousandths: 2000 },
];

const DEFAULT_SCHEDULE: WorkScheduleDefaults = {
  work_days: [1, 2, 3, 4, 5],
  morning_start: "08:00",
  morning_end: "14:00",
  afternoon_start: "15:00",
  afternoon_end: "17:00",
  auto_apply_to_jobs: true,
};

function formatHoursFromThousandths(thousandths: number): string {
  const hrs = thousandths / 1000;
  return `${hrs.toFixed(1).replace(/\.0$/, "").replace(".", ",")} h`;
}

function formatSignedHoursFromThousandths(thousandths: number): string {
  const sign = thousandths > 0 ? "+" : thousandths < 0 ? "-" : "";
  return `${sign}${formatHoursFromThousandths(Math.abs(thousandths))}`;
}

export function ScheduleWorkLogWidget({ widget, runtime, isSubmitting }: WidgetCommonProps) {
  const payload = (widget as ScheduleWidget).widget_payload;
  const payloadKey = useMemo(() => JSON.stringify(payload), [payload]);

  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [defaults, setDefaults] = useState<WorkScheduleDefaults>(DEFAULT_SCHEDULE);
  const [hourlyRateCents, setHourlyRateCents] = useState(3800);
  const [entry, setEntry] = useState<ScheduleEntryRow | null>(null);
  const [jobEntries, setJobEntries] = useState<ScheduleEntryRow[]>([]);

  const [mode, setMode] = useState<"daily_log" | "plan_range">(payload.mode);
  const [selectedJobId, setSelectedJobId] = useState<string>(payload.job_id ?? "");
  const [dateIso, setDateIso] = useState<string>(payload.date_iso);
  const [startDateIso, setStartDateIso] = useState<string>(
    payload.start_date_iso ?? payload.date_iso
  );
  const [endDateIso, setEndDateIso] = useState<string>(payload.end_date_iso ?? payload.date_iso);

  const [deltaThousandths, setDeltaThousandths] = useState<number>(
    payload.suggested_delta_thousandths ?? 0
  );
  const [reason, setReason] = useState<string>(
    payload.suggested_reason || DEVIATION_REASONS[0]!
  );
  const [notes, setNotes] = useState<string>(payload.suggested_notes || "");
  const [alsoLogInSiteLogs, setAlsoLogInSiteLogs] = useState<boolean>(true);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setMode(payload.mode);
    setSelectedJobId(payload.job_id ?? "");
    setDateIso(payload.date_iso);
    setStartDateIso(payload.start_date_iso ?? payload.date_iso);
    setEndDateIso(payload.end_date_iso ?? payload.date_iso);
    setDeltaThousandths(payload.suggested_delta_thousandths ?? 0);
    setReason(payload.suggested_reason || DEVIATION_REASONS[0]!);
    setNotes(payload.suggested_notes || "");
    setErrorMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payloadKey]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const jobsRepo = new JobsRepository(runtime.executor);
      const scheduleRepo = new ScheduleRepository(runtime.executor);
      const settingsRepo = new SettingsRepository(runtime.executor);
      const [allJobs, schedDefaults, settings] = await Promise.all([
        jobsRepo.listAll(),
        scheduleRepo.getWorkScheduleDefaults(),
        settingsRepo.getAppSettings(),
      ]);
      const validJobs = allJobs.filter((j) => j.status !== "cancelado");
      const targetJobId = payload.job_id || validJobs[0]?.id || "";
      const [existingEntry, entriesForJob] = await Promise.all([
        payload.entry_id
          ? scheduleRepo.getEntryById(payload.entry_id)
          : targetJobId
            ? scheduleRepo.getEntryByJobAndDate(targetJobId, payload.date_iso)
            : Promise.resolve(null),
        targetJobId ? scheduleRepo.listEntriesByJob(targetJobId) : Promise.resolve([]),
      ]);
      if (!active) return;
      setJobs(validJobs);
      if (!selectedJobId && targetJobId) {
        setSelectedJobId(targetJobId);
      }
      setDefaults(schedDefaults);
      setHourlyRateCents(settings.hourly_rate_cents);
      setEntry(existingEntry);
      setJobEntries(entriesForJob);

      if (existingEntry && payload.suggested_delta_thousandths == null) {
        if (existingEntry.actual_hours_thousandths !== null) {
          setDeltaThousandths(
            existingEntry.actual_hours_thousandths - existingEntry.planned_hours_thousandths
          );
        }
        if (existingEntry.deviation_reason) setReason(existingEntry.deviation_reason);
        if (existingEntry.notes && !payload.suggested_notes) setNotes(existingEntry.notes);
      }
    };
    void load();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime.executor, payloadKey]);

  const selectedJob = jobs.find((j) => j.id === selectedJobId) ?? null;
  const defaultPlannedThousandths = computeDailyWorkHoursThousandths(defaults) || 8000;
  const plannedThousandths = entry?.planned_hours_thousandths ?? defaultPlannedThousandths;
  const plannedStart = entry?.planned_start ?? defaults.morning_start;
  const plannedEnd = entry?.planned_end ?? (defaults.afternoon_end || defaults.morning_end);

  const actualThousandths = Math.max(500, plannedThousandths + deltaThousandths);
  const deltaMinutes = Math.round((deltaThousandths / 1000) * 60);
  const actualEnd = minutesToHHMM(parseHHMMToMinutes(plannedEnd) + deltaMinutes);
  const impactCents = Math.round((deltaThousandths / 1000) * hourlyRateCents);

  const computedStatus: ScheduleStatus =
    deltaThousandths > 0 ? "alargado" : deltaThousandths < 0 ? "antes" : "en_hora";

  const planPreview = useMemo(() => {
    if (!startDateIso || !endDateIso || endDateIso < startDateIso) {
      return { days: 0, totalThousandths: 0 };
    }
    const workSet = new Set(defaults.work_days.length > 0 ? defaults.work_days : [1, 2, 3, 4, 5]);
    let cursor = startDateIso;
    let count = 0;
    let safety = 0;
    while (cursor <= endDateIso && safety < 366) {
      if (workSet.has(getIsoWeekday(cursor))) {
        count += 1;
      }
      cursor = addDaysIso(cursor, 1);
      safety += 1;
    }
    return {
      days: count,
      totalThousandths: count * defaultPlannedThousandths,
    };
  }, [startDateIso, endDateIso, defaults.work_days, defaultPlannedThousandths]);

  const handleSaveDailyLog = async () => {
    setErrorMsg(null);
    setBusy(true);
    try {
      const scheduleRepo = new ScheduleRepository(runtime.executor);
      const saved = await scheduleRepo.recordDailyWorkLog(
        entry?.id ?? dateIso,
        {
          actual_start: plannedStart,
          actual_end: actualEnd,
          actual_hours_thousandths: actualThousandths,
          status: computedStatus,
          deviation_reason: deltaThousandths === 0 ? "En hora" : reason,
          notes: notes.trim(),
          also_log_in_site_logs: alsoLogInSiteLogs,
        },
        { jobId: selectedJobId || null }
      );
      await runtime.onDataMutated?.();
      runtime.onScheduleSaved?.({
        mode: "daily_log",
        message: `Parte guardado (${formatHoursFromThousandths(saved.actual_hours_thousandths ?? actualThousandths)}) para ${selectedJob?.job_code ?? saved.date_iso}.`,
      });
      runtime.onDismissOverlay?.();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSavePlanRange = async () => {
    if (!selectedJobId) {
      setErrorMsg("Selecciona una obra para planificar en el calendario.");
      return;
    }
    setErrorMsg(null);
    setBusy(true);
    try {
      const scheduleRepo = new ScheduleRepository(runtime.executor);
      const entries = await scheduleRepo.generateEntriesForJobDateRange(
        selectedJobId,
        startDateIso,
        endDateIso
      );
      await runtime.onDataMutated?.();
      runtime.onScheduleSaved?.({
        mode: "plan_range",
        message: `Calendario actualizado: ${entries.length} jornada(s) planificada(s) para ${selectedJob?.job_code ?? "la obra"}.`,
      });
      runtime.onDismissOverlay?.();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const totalJobPlannedThousandths = jobEntries.reduce(
    (s, e) => s + e.planned_hours_thousandths,
    0
  );

  return (
    <section
      data-testid="schedule-worklog-widget"
      className="rounded-[24px] border border-outline-variant bg-surface-container-lowest p-4 shadow-sm text-on-surface space-y-4"
    >
      {/* Cabecera */}
      <div className="flex items-center justify-between gap-2 border-b border-outline-variant pb-3">
        <div>
          <span className="inline-flex items-center gap-1 rounded-full bg-terracotta-soft px-2.5 py-0.5 text-[11px] font-semibold text-on-primary-container">
            <CalendarPlus className="w-3.5 h-3.5" />
            {mode === "plan_range" ? "Planificar fechas en agenda" : "Parte del día"}
          </span>
          <h3 className="mt-1 text-[16px] font-semibold text-on-surface">
            {selectedJob ? `${selectedJob.job_code} · ${selectedJob.title}` : "Agenda y jornada"}
          </h3>
        </div>
        <span className="rounded-full bg-surface-container px-2.5 py-1 font-mono text-[12px] font-semibold text-on-surface tabular-nums">
          {formatCentsEs(hourlyRateCents)}/h
        </span>
      </div>

      {/* Selector de modo y obra */}
      <div className="grid grid-cols-2 gap-1.5 rounded-full border border-outline-variant bg-surface-container-low p-1">
        <button
          type="button"
          onClick={() => setMode("daily_log")}
          className={`min-h-[38px] rounded-full text-xs font-semibold cursor-pointer ${
            mode === "daily_log"
              ? "bg-secondary text-on-secondary"
              : "text-on-surface-variant"
          }`}
        >
          Parte de hoy
        </button>
        <button
          type="button"
          onClick={() => setMode("plan_range")}
          className={`min-h-[38px] rounded-full text-xs font-semibold cursor-pointer ${
            mode === "plan_range"
              ? "bg-secondary text-on-secondary"
              : "text-on-surface-variant"
          }`}
        >
          Planificar rango
        </button>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[12px] font-semibold text-on-surface">Obra vinculada</span>
        <select
          data-testid="schedule-widget-job-select"
          value={selectedJobId}
          onChange={(e) => setSelectedJobId(e.target.value)}
          className="min-h-[46px] rounded-xl border border-outline-variant bg-surface-container-low px-3 text-[13px] font-medium"
        >
          <option value="">Sin obra específica (agenda general)</option>
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {j.job_code} · {j.title}
            </option>
          ))}
        </select>
      </label>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-xl border border-coral-alert/30 bg-error-container p-3 text-xs font-semibold text-on-error-container"
        >
          {errorMsg}
        </div>
      )}

      {mode === "plan_range" ? (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold text-on-surface">Fecha inicio</span>
              <input
                type="date"
                data-testid="schedule-plan-start-input"
                value={startDateIso}
                onChange={(e) => setStartDateIso(e.target.value)}
                className="min-h-[44px] rounded-xl border border-outline-variant bg-surface-container-low px-3 font-mono text-[13px]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold text-on-surface">Fecha fin</span>
              <input
                type="date"
                data-testid="schedule-plan-end-input"
                value={endDateIso}
                onChange={(e) => setEndDateIso(e.target.value)}
                className="min-h-[44px] rounded-xl border border-outline-variant bg-surface-container-low px-3 font-mono text-[13px]"
              />
            </label>
          </div>

          <div className="rounded-2xl border border-outline-variant bg-terracotta-soft p-3.5 flex items-start gap-2.5">
            <CalendarCheck2 className="w-5 h-5 text-on-primary-container shrink-0 mt-0.5" />
            <div className="text-[13px] text-on-primary-container">
              Se generarán{" "}
              <strong className="font-mono tabular-nums">{planPreview.days} jornadas laborables</strong>{" "}
              (
              <strong className="font-mono tabular-nums">
                {formatHoursFromThousandths(planPreview.totalThousandths)}
              </strong>{" "}
              previstas) de {defaults.morning_start} a{" "}
              {defaults.afternoon_end || defaults.morning_end} según tu horario habitual.
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-1">
            <button
              type="button"
              disabled={busy || isSubmitting}
              onClick={() => runtime.onDismissOverlay?.()}
              className="min-h-[48px] rounded-xl bg-surface-container text-on-surface font-semibold text-[14px] cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              data-testid="schedule-plan-save-btn"
              disabled={busy || isSubmitting || !selectedJobId}
              onClick={() => void handleSavePlanRange()}
              className="col-span-2 min-h-[48px] rounded-xl bg-primary hover:bg-terracotta text-white font-semibold text-[14px] flex items-center justify-center gap-1.5 disabled:opacity-45 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>Generar bloques en calendario</span>
            </button>
          </div>
        </>
      ) : (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-on-surface">Fecha del parte</span>
            <input
              type="date"
              data-testid="schedule-daily-date-input"
              value={dateIso}
              onChange={(e) => setDateIso(e.target.value)}
              className="min-h-[44px] rounded-xl border border-outline-variant bg-surface-container-low px-3 font-mono text-[13px]"
            />
          </label>

          {jobEntries.length > 0 && (
            <div className="rounded-2xl border border-outline-variant bg-surface-warm-card p-3 text-[12px] text-on-surface">
              Planificación de obra: <strong>{jobEntries.length} días</strong> ·{" "}
              <strong className="font-mono tabular-nums">
                {formatHoursFromThousandths(totalJobPlannedThousandths)} previstas
              </strong>
            </div>
          )}

          {/* Salida prevista vs real */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-surface-container-low rounded-2xl p-3 flex flex-col gap-0.5">
              <span className="text-[11px] font-semibold text-on-surface-variant">
                Salida prevista
              </span>
              <span className="font-mono text-[22px] font-bold text-on-surface tabular-nums">
                {plannedEnd}
              </span>
              <span className="font-mono text-[12px] text-on-surface-variant tabular-nums">
                {formatHoursFromThousandths(plannedThousandths)}
              </span>
            </div>

            <div
              className={`rounded-2xl p-3 border border-outline-variant flex flex-col gap-0.5 ${
                deltaThousandths > 0
                  ? "bg-warning-container text-on-warning-container"
                  : deltaThousandths < 0
                    ? "bg-info-container text-on-info-container"
                    : "bg-success-container text-on-success-container"
              }`}
            >
              <span className="text-[11px] font-semibold">Salida real</span>
              <span
                data-testid="schedule-actual-end-display"
                className="font-mono text-[22px] font-bold tabular-nums"
              >
                {actualEnd}
              </span>
              <span
                data-testid="schedule-actual-hours-display"
                className="font-mono text-[12px] tabular-nums"
              >
                {formatHoursFromThousandths(actualThousandths)}
              </span>
            </div>
          </div>

          {/* Botones rápidos de ajuste */}
          <div className="grid grid-cols-3 gap-2">
            {QUICK_DELTAS.map((opt) => {
              const active = deltaThousandths === opt.deltaThousandths;
              return (
                <button
                  key={opt.label}
                  type="button"
                  data-testid={`schedule-delta-${opt.deltaThousandths}`}
                  onClick={() => setDeltaThousandths(opt.deltaThousandths)}
                  className={`min-h-[44px] rounded-xl font-mono text-[12px] font-semibold tabular-nums transition-colors cursor-pointer ${
                    active
                      ? "bg-terracotta-soft border-2 border-terracotta text-on-primary-container"
                      : "bg-surface-container-low border border-outline-variant text-on-surface hover:border-terracotta"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {/* Banner dinámico impacto económico */}
          {deltaThousandths > 0 ? (
            <div className="rounded-2xl bg-warning-container border border-outline-variant p-3 flex items-center gap-2">
              <Clock className="w-5 h-5 text-on-warning-container shrink-0" />
              <span className="text-[12px] font-semibold text-on-warning-container">
                Jornada alargada {formatSignedHoursFromThousandths(deltaThousandths)} (+
                {formatCentsEs(impactCents)} según tu tarifa/hora)
              </span>
            </div>
          ) : deltaThousandths < 0 ? (
            <div className="rounded-2xl bg-info-container border border-outline-variant p-3 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-on-info-container shrink-0" />
              <span className="text-[12px] font-semibold text-on-info-container">
                Terminado {formatHoursFromThousandths(Math.abs(deltaThousandths))} antes de lo previsto (
                {formatCentsEs(impactCents)})
              </span>
            </div>
          ) : (
            <div className="rounded-2xl bg-success-container border border-outline-variant p-3 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-on-success-container shrink-0" />
              <span className="text-[12px] font-semibold text-on-success-container">
                Jornada cumplida según horario habitual ({formatHoursFromThousandths(plannedThousandths)})
              </span>
            </div>
          )}

          {/* Motivo de desviación y nota */}
          <div className="space-y-2.5">
            <div className="text-[13px] font-semibold text-on-surface">Motivo del cambio</div>
            <div className="flex flex-wrap gap-1.5">
              {DEVIATION_REASONS.map((item) => {
                const selected = reason === item;
                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setReason(item)}
                    aria-pressed={selected}
                    className={`min-h-[38px] px-3 rounded-full text-[12px] font-semibold cursor-pointer transition-colors ${
                      selected
                        ? "bg-terracotta-soft border border-terracotta text-on-primary-container"
                        : "bg-surface-container-low border border-outline-variant text-on-surface"
                    }`}
                  >
                    {item}
                  </button>
                );
              })}
            </div>

            <textarea
              rows={2}
              data-testid="schedule-notes-input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anota qué ocurrió en obra hoy..."
              className="w-full rounded-xl bg-surface-container-low border border-outline-variant p-3 text-[13px] text-on-surface focus:outline-none focus:border-terracotta"
            />

            <label className="flex items-center gap-2.5 min-h-[46px] px-3 rounded-xl bg-surface-container-low cursor-pointer">
              <input
                type="checkbox"
                data-testid="schedule-link-diary-checkbox"
                checked={alsoLogInSiteLogs}
                onChange={(e) => setAlsoLogInSiteLogs(e.target.checked)}
                className="w-4 h-4 rounded border-outline accent-terracotta shrink-0"
              />
              <span className="text-[12px] font-medium text-on-surface">
                Vincular esta nota al Diario de Obra
              </span>
            </label>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-1">
            <button
              type="button"
              disabled={busy || isSubmitting}
              onClick={() => runtime.onDismissOverlay?.()}
              className="min-h-[48px] rounded-xl bg-surface-container text-on-surface font-semibold text-[14px] cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              data-testid="schedule-daily-save-btn"
              disabled={busy || isSubmitting}
              onClick={() => void handleSaveDailyLog()}
              className="col-span-2 min-h-[48px] rounded-xl bg-primary hover:bg-terracotta text-white font-semibold text-[14px] flex items-center justify-center gap-1.5 disabled:opacity-45 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>Guardar parte del día</span>
            </button>
          </div>
        </>
      )}
    </section>
  );
}
