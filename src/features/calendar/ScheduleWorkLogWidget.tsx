import { CalendarCheck2, CalendarPlus, CheckCircle2, Clock, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  patchScheduleWidgetByVoice,
  type ScheduleWidgetFormState,
  type VoiceDisambiguationPayload,
} from "../../agent/voiceFormPatcher";
import { TEXT_LIMITS } from "../../core/contracts/textLimits";
import type {
  ActiveWidgetEnvelope,
  JobRow,
  ScheduleEntryRow,
  ScheduleStatus,
  WorkScheduleDefaults,
} from "../../core/contracts/types";
import { useRegisterOverlayVoice } from "../../ui/overlayVoiceContext";
import { ZoomableTextField } from "../../ui/ZoomableTextField";
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
import { SubDayDurationPicker } from "./SubDayDurationPicker";

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
  const [planStartTime, setPlanStartTime] = useState<string>(DEFAULT_SCHEDULE.morning_start);
  const [planEndTime, setPlanEndTime] = useState<string>(DEFAULT_SCHEDULE.afternoon_end);
  const [planHoursThousandths, setPlanHoursThousandths] = useState<number>(8000);
  const [actualStart, setActualStart] = useState<string>(DEFAULT_SCHEDULE.morning_start);
  const [actualEndOverride, setActualEndOverride] = useState<string | null>(null);

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
  const [undoStack, setUndoStack] = useState<ScheduleWidgetFormState[]>([]);
  const [voiceChanges, setVoiceChanges] = useState<string[]>([]);
  const [voiceWarnings, setVoiceWarnings] = useState<string[]>([]);
  const [voiceDisambig, setVoiceDisambig] = useState<VoiceDisambiguationPayload | null>(null);

  useEffect(() => {
    setMode(payload.mode);
    setSelectedJobId(payload.job_id ?? "");
    setDateIso(payload.date_iso);
    setStartDateIso(payload.start_date_iso ?? payload.date_iso);
    setEndDateIso(payload.end_date_iso ?? payload.date_iso);
    setDeltaThousandths(payload.suggested_delta_thousandths ?? 0);
    setActualEndOverride(null);
    setReason(payload.suggested_reason || DEVIATION_REASONS[0]!);
    setNotes(payload.suggested_notes || "");
    setErrorMsg(null);
    setUndoStack([]);
    setVoiceChanges([]);
    setVoiceWarnings([]);
    setVoiceDisambig(null);
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
      const targetJobId = payload.entry_id
        ? (payload.job_id ?? "")
        : payload.job_id || validJobs[0]?.id || "";
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

      const defaultEnd = schedDefaults.afternoon_end || schedDefaults.morning_end;
      const defaultHours = computeDailyWorkHoursThousandths(schedDefaults) || 8000;
      if (existingEntry) {
        setPlanStartTime(existingEntry.planned_start);
        setPlanEndTime(existingEntry.planned_end);
        setPlanHoursThousandths(existingEntry.planned_hours_thousandths);
        setActualStart(existingEntry.actual_start ?? existingEntry.planned_start);
      } else {
        setPlanStartTime(schedDefaults.morning_start);
        setPlanEndTime(defaultEnd);
        setPlanHoursThousandths(defaultHours);
        setActualStart(schedDefaults.morning_start);
      }
      setActualEndOverride(null);

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

  // Refrescar bloque previsto y resumen de obra cuando cambie obra o fecha sin machacar campos dictados
  useEffect(() => {
    let active = true;
    const syncSelection = async () => {
      const scheduleRepo = new ScheduleRepository(runtime.executor);
      const usePayloadEntry =
        Boolean(payload.entry_id) &&
        (selectedJobId || "") === (payload.job_id ?? "") &&
        dateIso === payload.date_iso;
      const [existingEntry, entriesForJob] = await Promise.all([
        usePayloadEntry && payload.entry_id
          ? scheduleRepo.getEntryById(payload.entry_id)
          : selectedJobId
            ? scheduleRepo.getEntryByJobAndDate(selectedJobId, dateIso)
            : Promise.resolve(null),
        selectedJobId ? scheduleRepo.listEntriesByJob(selectedJobId) : Promise.resolve([]),
      ]);
      if (!active) return;
      setEntry(existingEntry);
      setJobEntries(entriesForJob);
      setActualStart(
        existingEntry?.actual_start ?? existingEntry?.planned_start ?? defaults.morning_start
      );
      setActualEndOverride(null);
    };
    void syncSelection();
    return () => {
      active = false;
    };
  }, [
    runtime.executor,
    selectedJobId,
    dateIso,
    payload.entry_id,
    payload.job_id,
    payload.date_iso,
    defaults.morning_start,
  ]);

  const selectedJob = jobs.find((j) => j.id === selectedJobId) ?? null;
  const defaultPlannedThousandths = computeDailyWorkHoursThousandths(defaults) || 8000;
  const plannedThousandths = entry?.planned_hours_thousandths ?? defaultPlannedThousandths;
  const plannedStart = entry?.planned_start ?? defaults.morning_start;
  const plannedEnd = entry?.planned_end ?? (defaults.afternoon_end || defaults.morning_end);

  const applyScheduleFormState = (st: ScheduleWidgetFormState) => {
    setMode(st.mode);
    setSelectedJobId(st.selectedJobId);
    setDateIso(st.dateIso);
    setStartDateIso(st.startDateIso);
    setEndDateIso(st.endDateIso);
    setDeltaThousandths(st.deltaThousandths);
    setActualEndOverride(null);
    setReason(st.reason);
    setNotes(st.notes);
    setAlsoLogInSiteLogs(st.alsoLogInSiteLogs);
  };

  useRegisterOverlayVoice({
    enabled: !busy && !isSubmitting,
    title: mode === "plan_range" ? "Dictar planificación" : "Dictar parte de jornada",
    placeholder:
      mode === "plan_range"
        ? "Ej: Obra de Marta del 22 al 30 de este mes"
        : "Ej: Salí a las 18:30 por falta de material",
    examples: [
      "Salí 1 hora y media tarde por falta de material",
      "Hoy terminé a las 16:00 porque estaba todo listo",
      "Planificar del 22 al 30 de este mes",
    ],
    buttonLabel: "Dictar parte / agenda",
    lastChanges: voiceChanges,
    lastWarnings: voiceWarnings,
    canUndo: undoStack.length > 0,
    onUndo: () => {
      const prev = undoStack[undoStack.length - 1];
      if (!prev) return;
      setUndoStack((s) => s.slice(0, -1));
      applyScheduleFormState(prev);
      setVoiceChanges(["Último dictado deshecho"]);
      setVoiceWarnings([]);
      setVoiceDisambig(null);
    },
    disambiguation: voiceDisambig
      ? {
          prompt: voiceDisambig.prompt,
          options: voiceDisambig.options,
          onSelect: (id) => {
            const snapshot: ScheduleWidgetFormState = {
              mode,
              selectedJobId,
              dateIso,
              startDateIso,
              endDateIso,
              deltaThousandths,
              reason,
              notes,
              alsoLogInSiteLogs,
            };
            setUndoStack((s) => [...s.slice(-9), snapshot]);
            setSelectedJobId(id);
            const hit = jobs.find((j) => j.id === id);
            setVoiceChanges([hit ? `Obra: ${hit.job_code} · ${hit.title}` : "Obra seleccionada"]);
            setVoiceWarnings([]);
            setVoiceDisambig(null);
          },
          onDismiss: () => setVoiceDisambig(null),
        }
      : null,
    onTranscript: async (text) => {
      const currentSnapshot: ScheduleWidgetFormState = {
        mode,
        selectedJobId,
        dateIso,
        startDateIso,
        endDateIso,
        deltaThousandths,
        reason,
        notes,
        alsoLogInSiteLogs,
      };
      const res = await patchScheduleWidgetByVoice(currentSnapshot, plannedEnd, text, {
        executor: runtime.executor,
        inferenceAdapter: runtime.inferenceAdapter,
      });
      if (res.changed) {
        setUndoStack((s) => [...s.slice(-9), currentSnapshot]);
        applyScheduleFormState(res.nextState);
        setVoiceChanges(res.appliedChanges);
        setVoiceWarnings(res.warnings);
      } else if (!res.disambiguation) {
        setVoiceChanges([]);
        setVoiceWarnings([
          "No detecté cambios claros. Prueba: «Alargamos 1 hora por falta de material».",
        ]);
      }
      setVoiceDisambig(res.disambiguation ?? null);
    },
  });

  const effectiveActualStart = actualStart || plannedStart;
  const startShiftMin =
    parseHHMMToMinutes(effectiveActualStart) - parseHHMMToMinutes(plannedStart);
  const rawActualThousandths = Math.max(250, plannedThousandths + deltaThousandths);
  const clampedDeltaThousandths = rawActualThousandths - plannedThousandths;
  const deltaMinutes = Math.round((clampedDeltaThousandths / 1000) * 60);
  const computedActualEndMin = Math.min(
    23 * 60 + 59,
    Math.max(
      parseHHMMToMinutes(effectiveActualStart) + 15,
      parseHHMMToMinutes(plannedEnd) + deltaMinutes + startShiftMin
    )
  );
  const actualEnd = actualEndOverride ?? minutesToHHMM(computedActualEndMin);
  const actualStartMin = parseHHMMToMinutes(effectiveActualStart);
  const actualEndMin = parseHHMMToMinutes(actualEnd);
  const actualSpanValid = actualEndMin > actualStartMin;
  const actualThousandths = actualEndOverride
    ? Math.max(
        250,
        plannedThousandths +
          Math.round(
            ((actualEndMin -
              actualStartMin -
              (parseHHMMToMinutes(plannedEnd) - parseHHMMToMinutes(plannedStart))) *
              1000) /
              60
          )
      )
    : rawActualThousandths;
  const effectiveDeltaThousandths = actualThousandths - plannedThousandths;
  const impactCents = Math.round((effectiveDeltaThousandths / 1000) * hourlyRateCents);

  const computedStatus: ScheduleStatus =
    effectiveDeltaThousandths > 0
      ? "alargado"
      : effectiveDeltaThousandths < 0
        ? "antes"
        : "en_hora";

  const isSameDayRange = Boolean(startDateIso && endDateIso && startDateIso === endDateIso);
  const planSpanValid =
    !isSameDayRange || parseHHMMToMinutes(planEndTime) > parseHHMMToMinutes(planStartTime);

  const planPreview = useMemo(() => {
    if (!startDateIso || !endDateIso || endDateIso < startDateIso) {
      return { days: 0, totalThousandths: 0 };
    }
    if (startDateIso === endDateIso) {
      return {
        days: 1,
        totalThousandths: planHoursThousandths,
      };
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
  }, [startDateIso, endDateIso, defaults.work_days, defaultPlannedThousandths, planHoursThousandths]);

  const handleSaveDailyLog = async () => {
    if (!actualSpanValid) {
      setErrorMsg("La hora de salida real debe ser posterior a la de inicio real.");
      return;
    }
    setErrorMsg(null);
    setBusy(true);
    try {
      const scheduleRepo = new ScheduleRepository(runtime.executor);
      const saved = await scheduleRepo.recordDailyWorkLog(
        entry?.id ?? dateIso,
        {
          actual_start: effectiveActualStart,
          actual_end: actualEnd,
          actual_hours_thousandths: actualThousandths,
          status: computedStatus,
          deviation_reason: effectiveDeltaThousandths === 0 ? "En hora" : reason,
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
    if (!planSpanValid) {
      setErrorMsg("La hora de fin debe ser posterior a la hora de inicio.");
      return;
    }
    if (!selectedJobId && !isSameDayRange) {
      setErrorMsg("Selecciona una obra para planificar varios días en el calendario.");
      return;
    }
    setErrorMsg(null);
    setBusy(true);
    try {
      const scheduleRepo = new ScheduleRepository(runtime.executor);
      if (!selectedJobId && isSameDayRange) {
        await scheduleRepo.createSingleEntry({
          job_id: null,
          date_iso: startDateIso,
          planned_start: planStartTime,
          planned_end: planEndTime,
          planned_hours_thousandths: planHoursThousandths,
          notes: notes.trim(),
        });
        await runtime.onDataMutated?.();
        runtime.onScheduleSaved?.({
          mode: "plan_range",
          message: `Cita guardada (${formatHoursFromThousandths(planHoursThousandths)}) para el ${startDateIso}.`,
        });
      } else {
        const entries = await scheduleRepo.generateEntriesForJobDateRange(
          selectedJobId,
          startDateIso,
          endDateIso,
          isSameDayRange
            ? {
                plannedStart: planStartTime,
                plannedEnd: planEndTime,
                plannedHoursThousandths: planHoursThousandths,
                replaceSingleDayHours: true,
              }
            : undefined
        );
        await runtime.onDataMutated?.();
        runtime.onScheduleSaved?.({
          mode: "plan_range",
          message: isSameDayRange
            ? `Calendario actualizado (${formatHoursFromThousandths(planHoursThousandths)}) para ${selectedJob?.job_code ?? "la obra"}.`
            : `Calendario actualizado: ${entries.length} jornada(s) planificada(s) para ${selectedJob?.job_code ?? "la obra"}.`,
        });
      }
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
      className="clipboard-panel rounded-[24px] border border-[#E5DFD2] bg-[#FFFDF7] p-4 text-[#2C2621] font-sans space-y-4"
    >
      {/* Cabecera */}
      <div className="flex items-center justify-between gap-2 border-b border-[#E5DFD2] pb-3">
        <div>
          <span className="inline-flex items-center gap-1 rounded-full bg-[#FFD6B0] px-2.5 py-0.5 text-[11px] font-semibold text-[#4A2500]">
            <CalendarPlus className="w-3.5 h-3.5" />
            {mode === "plan_range" ? "Planificar fechas en agenda" : "Parte del día"}
          </span>
          <h3 className="mt-1 text-[16px] font-semibold text-[#2C2621]">
            {selectedJob ? `${selectedJob.job_code} · ${selectedJob.title}` : "Agenda y jornada"}
          </h3>
        </div>
        <span className="status-gold rounded-full px-2.5 py-1 font-mono font-mono-nums text-[12px] font-semibold tabular-nums">
          {formatCentsEs(hourlyRateCents)}/h
        </span>
      </div>

      {/* Selector de modo y obra */}
      <div className="grid grid-cols-2 gap-1.5 rounded-full border border-[#E5DFD2] bg-[#F5F1E6] p-1">
        <button
          type="button"
          onClick={() => setMode("daily_log")}
          className={`min-h-[38px] rounded-full text-xs font-semibold cursor-pointer transition-colors ${
            mode === "daily_log"
              ? "bg-[#4B7094] text-[#FFFDF9]"
              : "text-[#6B6860] hover:bg-[#EFECE4]"
          }`}
        >
          Parte de hoy
        </button>
        <button
          type="button"
          onClick={() => setMode("plan_range")}
          className={`min-h-[38px] rounded-full text-xs font-semibold cursor-pointer transition-colors ${
            mode === "plan_range"
              ? "bg-[#4B7094] text-[#FFFDF9]"
              : "text-[#6B6860] hover:bg-[#EFECE4]"
          }`}
        >
          Planificar rango
        </button>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[12px] font-semibold text-[#2C2621]">Obra vinculada</span>
        <select
          data-testid="schedule-widget-job-select"
          value={selectedJobId}
          onChange={(e) => setSelectedJobId(e.target.value)}
          className="min-h-[46px] rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 text-[13px] font-medium text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
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
          className="rounded-xl border border-[#DC2626]/30 bg-[#FAD2D8] p-3 text-xs font-semibold text-[#5A121C]"
        >
          {errorMsg}
        </div>
      )}

      {mode === "plan_range" ? (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold text-[#2C2621]">Fecha inicio</span>
              <input
                type="date"
                data-testid="schedule-plan-start-input"
                value={startDateIso}
                onChange={(e) => {
                  const next = e.target.value;
                  setStartDateIso(next);
                  if (!endDateIso || endDateIso === startDateIso || endDateIso < next) {
                    setEndDateIso(next);
                  }
                }}
                className="min-h-[44px] rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 font-mono tabular-nums text-[13px] text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold text-[#2C2621]">Fecha fin</span>
              <input
                type="date"
                data-testid="schedule-plan-end-input"
                value={endDateIso}
                onChange={(e) => setEndDateIso(e.target.value)}
                className="min-h-[44px] rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 font-mono tabular-nums text-[13px] text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
              />
            </label>
          </div>

          {isSameDayRange && (
            <div className="rounded-2xl border border-[#E5DFD2] bg-[#F5F1E6] p-3">
              <SubDayDurationPicker
                startTime={planStartTime}
                endTime={planEndTime}
                defaults={defaults}
                disabled={busy || isSubmitting}
                onChange={(next) => {
                  setPlanStartTime(next.startTime);
                  setPlanEndTime(next.endTime);
                  setPlanHoursThousandths(next.hoursThousandths);
                }}
              />
            </div>
          )}

          <div className="relative ruled-notebook rounded-2xl border border-[#E5DFD2] p-3.5 pl-10 flex items-start gap-2.5">
            <span className="absolute left-2.5 top-4 w-2 h-2 rounded-full paper-hole border" aria-hidden="true" />
            <CalendarCheck2 className="w-5 h-5 text-[#D04B00] shrink-0 mt-0.5" />
            <div className="text-[13px] text-[#2C2621]">
              {isSameDayRange ? (
                <>
                  Cita puntual de{" "}
                  <strong className="highlighter-yellow font-mono tabular-nums">
                    {formatHoursFromThousandths(planPreview.totalThousandths)}
                  </strong>{" "}
                  ({planStartTime} a {planEndTime}).
                </>
              ) : (
                <>
                  Se generarán{" "}
                  <strong className="font-mono tabular-nums">
                    {planPreview.days} jornadas laborables
                  </strong>{" "}
                  (
                  <strong className="highlighter-yellow font-mono tabular-nums">
                    {formatHoursFromThousandths(planPreview.totalThousandths)}
                  </strong>{" "}
                  previstas) de {defaults.morning_start} a{" "}
                  {defaults.afternoon_end || defaults.morning_end} según tu horario habitual.
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-1">
            <button
              type="button"
              disabled={busy || isSubmitting}
              onClick={() => runtime.onDismissOverlay?.()}
              className="min-h-[48px] rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] text-[#2C2621] font-semibold text-[14px] cursor-pointer hover:border-[#EA580C]"
            >
              Cancelar
            </button>
            <button
              type="button"
              data-testid="schedule-plan-save-btn"
              disabled={busy || isSubmitting || !planSpanValid || (!selectedJobId && !isSameDayRange)}
              onClick={() => void handleSavePlanRange()}
              className="col-span-2 min-h-[48px] rounded-xl bg-[#4B7094] hover:bg-[#3d5d7c] text-[#FFFDF9] font-semibold text-[14px] flex items-center justify-center gap-1.5 disabled:opacity-45 cursor-pointer shadow-xs"
            >
              <Save className="w-4 h-4" />
              <span>{isSameDayRange ? "Guardar cita en calendario" : "Generar bloques en calendario"}</span>
            </button>
          </div>
        </>
      ) : (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-[#2C2621]">Fecha del parte</span>
            <input
              type="date"
              data-testid="schedule-daily-date-input"
              value={dateIso}
              onChange={(e) => setDateIso(e.target.value)}
              className="min-h-[44px] rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 font-mono tabular-nums text-[13px] text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
            />
          </label>

          {jobEntries.length > 0 && (
            <div className="relative ruled-notebook rounded-2xl border border-[#E5DFD2] p-3 pl-10 text-[12px] text-[#2C2621]">
              <span className="absolute left-2.5 top-3.5 w-2 h-2 rounded-full paper-hole border" aria-hidden="true" />
              Planificación de obra: <strong>{jobEntries.length} días</strong> ·{" "}
              <strong className="highlighter-yellow font-mono tabular-nums">
                {formatHoursFromThousandths(totalJobPlannedThousandths)} previstas
              </strong>
            </div>
          )}

          {/* Salida prevista vs real */}
          <div className="grid grid-cols-2 gap-3">
            <div className="postit-note postit-blue p-3 flex flex-col gap-0.5 text-[#143552]">
              <span className="text-[11px] font-semibold text-[#143552]">
                Previsto ({plannedStart} – {plannedEnd})
              </span>
              <span className="font-mono font-mono-nums text-[22px] font-bold text-[#2C2621] tabular-nums">
                {plannedEnd}
              </span>
              <span className="font-mono font-mono-nums text-[12px] text-[#143552] tabular-nums">
                {formatHoursFromThousandths(plannedThousandths)}
              </span>
            </div>

            <div
              className={`postit-note p-3 flex flex-col gap-0.5 ${
                effectiveDeltaThousandths > 0
                  ? "postit-peach text-[#4A2500]"
                  : effectiveDeltaThousandths < 0
                    ? "postit-blue text-[#143552]"
                    : "postit-green text-[#1B3A24]"
              }`}
            >
              <span className="text-[11px] font-semibold">Salida real</span>
              <span
                data-testid="schedule-actual-end-display"
                className="font-mono font-mono-nums text-[22px] font-bold tabular-nums"
              >
                {actualEnd}
              </span>
              <span
                data-testid="schedule-actual-hours-display"
                className="font-mono font-mono-nums text-[12px] tabular-nums"
              >
                {formatHoursFromThousandths(actualThousandths)}
              </span>
            </div>
          </div>

          {/* Edición manual de hora inicio/fin reales */}
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-[#6B6860]">Inicio real</span>
              <input
                type="time"
                data-testid="schedule-actual-start-input"
                value={effectiveActualStart}
                onChange={(e) => {
                  const nextStart = e.target.value;
                  if (!nextStart) return;
                  const keptEnd = actualEnd;
                  setActualStart(nextStart);
                  setActualEndOverride(keptEnd);
                }}
                className="min-h-[40px] rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 font-mono tabular-nums text-[13px] text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-[#6B6860]">Salida real</span>
              <input
                type="time"
                data-testid="schedule-actual-end-input"
                value={actualEnd}
                onChange={(e) => {
                  const nextEnd = e.target.value;
                  if (!nextEnd) return;
                  setActualEndOverride(nextEnd);
                }}
                className="min-h-[40px] rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 font-mono tabular-nums text-[13px] text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
              />
            </label>
          </div>

          {/* Botones rápidos de ajuste */}
          <div className="grid grid-cols-3 gap-2">
            {QUICK_DELTAS.map((opt) => {
              const active = !actualEndOverride && deltaThousandths === opt.deltaThousandths;
              return (
                <button
                  key={opt.label}
                  type="button"
                  data-testid={`schedule-delta-${opt.deltaThousandths}`}
                  onClick={() => {
                    setActualEndOverride(null);
                    setDeltaThousandths(opt.deltaThousandths);
                  }}
                  className={`min-h-[44px] rounded-xl font-mono font-mono-nums text-[12px] font-semibold tabular-nums transition-colors cursor-pointer ${
                    active
                      ? "bg-[#FFD6B0] border-2 border-[#EA580C] text-[#4A2500] font-bold"
                      : "bg-[#FFFDF7] border border-[#E5DFD2] text-[#2C2621] hover:border-[#EA580C]"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {/* Banner dinámico impacto económico */}
          {effectiveDeltaThousandths > 0 ? (
            <div className="status-tangerine rounded-2xl p-3 flex items-center gap-2">
              <Clock className="w-5 h-5 shrink-0" />
              <span className="text-[12px] font-semibold">
                Jornada alargada {formatSignedHoursFromThousandths(effectiveDeltaThousandths)} (+
                {formatCentsEs(impactCents)} según tu tarifa/hora)
              </span>
            </div>
          ) : effectiveDeltaThousandths < 0 ? (
            <div className="status-cobalt rounded-2xl p-3 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <span className="text-[12px] font-semibold">
                Terminado {formatHoursFromThousandths(Math.abs(effectiveDeltaThousandths))} antes de lo previsto (
                {formatCentsEs(impactCents)})
              </span>
            </div>
          ) : (
            <div className="status-emerald rounded-2xl p-3 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <span className="text-[12px] font-semibold">
                Jornada cumplida según horario habitual ({formatHoursFromThousandths(plannedThousandths)})
              </span>
            </div>
          )}

          {/* Motivo de desviación y nota */}
          <div className="relative ruled-notebook rounded-2xl border border-[#E5DFD2] p-3.5 pl-10 space-y-2.5">
            <span className="absolute left-2.5 top-4 w-2 h-2 rounded-full paper-hole border" aria-hidden="true" />
            <span className="absolute left-2.5 bottom-4 w-2 h-2 rounded-full paper-hole border" aria-hidden="true" />
            <div className="text-[13px] font-semibold text-[#2C2621]">Motivo del cambio</div>
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
                        ? "bg-[#4B7094] text-[#FFFDF9]"
                        : "bg-[#EAE5D9] border border-[#E5DFD2] text-[#3D352E]"
                    }`}
                  >
                    {item}
                  </button>
                );
              })}
            </div>

            <ZoomableTextField
              as="textarea"
              multiline
              rows={2}
              maxLength={TEXT_LIMITS.NOTES}
              zoomLabel="Notas de la jornada"
              data-testid="schedule-notes-input"
              value={notes}
              onValueChange={setNotes}
              placeholder="Anota qué ocurrió en obra hoy..."
              className="w-full rounded-xl bg-[#FFFDF7] border border-[#E5DFD2] p-3 text-[13px] text-[#2C2621] placeholder:text-[#6B6860] focus:outline-none focus:border-[#EA580C]"
            />

            <label className="flex items-center gap-2.5 min-h-[46px] px-3 rounded-xl bg-[#FFF3A1] border border-[#E5DFD2] cursor-pointer">
              <input
                type="checkbox"
                data-testid="schedule-link-diary-checkbox"
                checked={alsoLogInSiteLogs}
                onChange={(e) => setAlsoLogInSiteLogs(e.target.checked)}
                className="w-4 h-4 rounded border-[#6B6860] accent-[#EA580C] shrink-0"
              />
              <span className="text-[12px] font-medium text-[#2C2621]">
                Vincular esta nota al Diario de Obra
              </span>
            </label>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-1">
            <button
              type="button"
              disabled={busy || isSubmitting}
              onClick={() => runtime.onDismissOverlay?.()}
              className="min-h-[48px] rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] text-[#2C2621] font-semibold text-[14px] cursor-pointer hover:border-[#EA580C]"
            >
              Cancelar
            </button>
            <button
              type="button"
              data-testid="schedule-daily-save-btn"
              disabled={busy || isSubmitting}
              onClick={() => void handleSaveDailyLog()}
              className="col-span-2 min-h-[48px] rounded-xl bg-[#4B7094] hover:bg-[#3d5d7c] text-[#FFFDF9] font-semibold text-[14px] flex items-center justify-center gap-1.5 disabled:opacity-45 cursor-pointer shadow-xs"
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
