import {
  Ban,
  CalendarPlus,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Landmark,
  MapPin,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { LocalInferenceAdapterImpl } from "../../agent/inference/localInferenceAdapter";
import {
  patchCalendarAppointmentByVoice,
  type CalendarAppointmentFormState,
  type VoiceDisambiguationPayload,
} from "../../agent/voiceFormPatcher";
import { TEXT_LIMITS } from "../../core/contracts/textLimits";
import type {
  ActiveWidgetEnvelope,
  JobRow,
  JobScheduleDeviationSummary,
  ScheduleEntryRow,
  SqliteExecutor,
  TaxModelCode,
  TaxObligationStateRow,
  TaxObligationStatus,
  WorkScheduleDefaults,
} from "../../core/contracts/types";
import { JobsRepository } from "../../core/db/repositories/jobsRepo";
import {
  computeDailyWorkHoursThousandths,
  minutesToHHMM,
  parseHHMMToMinutes,
  ScheduleRepository,
} from "../../core/db/repositories/scheduleRepo";
import { SettingsRepository } from "../../core/db/repositories/settingsRepo";
import { TaxCalendarRepository } from "../../core/db/repositories/taxCalendarRepo";
import { getLocalTodayIso } from "../../core/fiscal/dateQuarter";
import { formatCentsEs } from "../../core/fiscal/fiscalEngine";
import {
  DEFAULT_ACTIVE_TAX_MODELS,
  TAX_MODEL_CATALOG,
  getTaxMilestonesByMonth,
  listObligationsAroundYear,
  type TaxCalendarDayMilestone,
  type TaxObligationInstance,
} from "../../core/fiscal/taxCalendarEngine";
import type { VoiceInputAdapter } from "../../core/hardware/voiceAdapter";
import type { CalendarRouteTab } from "../../core/navigation/routes";
import { ConfirmDeleteDialog } from "../../ui/ConfirmDeleteDialog";
import { InlineVoiceFormTrigger } from "../../ui/ContextualVoiceDock";
import { ZoomableTextField } from "../../ui/ZoomableTextField";
import { TaxAlertsBanner } from "../fiscal/TaxAlertsBanner";
import { SubDayDurationPicker } from "./SubDayDurationPicker";

const FALLBACK_DEFAULTS: WorkScheduleDefaults = {
  work_days: [1, 2, 3, 4, 5],
  morning_start: "08:00",
  morning_end: "14:00",
  afternoon_start: "15:00",
  afternoon_end: "17:00",
  auto_apply_to_jobs: true,
};

type CalendarMode = CalendarRouteTab;

interface CalendarScheduleViewProps {
  executor: SqliteExecutor;
  refreshTick: number;
  initialFocusDateIso?: string;
  initialTab?: CalendarRouteTab;
  todayIso?: string;
  voiceAdapter?: VoiceInputAdapter;
  inferenceAdapter?: LocalInferenceAdapterImpl;
  registerBackHandler?: (priority: number, handler: () => boolean) => () => void;
  onOpenScheduleWidget: (widget: Extract<ActiveWidgetEnvelope, { ui_widget_type: "ScheduleWorkLogWidget" }>) => void;
  onDataChanged: () => Promise<void>;
}

const MONTH_NAMES_ES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

const WEEKDAY_NAMES_ES = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
];

function formatHoursFromThousandths(thousandths: number): string {
  const hrs = thousandths / 1000;
  return `${hrs.toFixed(1).replace(/\.0$/, "").replace(".", ",")} h`;
}

function formatSignedHoursFromThousandths(thousandths: number): string {
  const sign = thousandths > 0 ? "+" : thousandths < 0 ? "-" : "";
  return `${sign}${formatHoursFromThousandths(Math.abs(thousandths))}`;
}

function formatShortDateEs(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${Number(d)} ${MONTH_NAMES_ES[Number(m) - 1]?.slice(0, 3).toLowerCase() ?? m}`;
}

function formatDateRangeEs(start?: string | null, end?: string | null): string {
  if (!start) return "Sin fechas";
  if (!end || start === end) return formatShortDateEs(start);
  return `${formatShortDateEs(start)} – ${formatShortDateEs(end)}`;
}

function formatFullDayLabelEs(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayName = WEEKDAY_NAMES_ES[dt.getUTCDay()] ?? "";
  const monthName = MONTH_NAMES_ES[m - 1]?.toLowerCase() ?? "";
  return `${dayName}, ${d} de ${monthName}`;
}

function buildMonthGrid(
  year: number,
  monthIndex: number
): Array<{ dateIso: string; day: number; inMonth: boolean }> {
  const firstDay = new Date(year, monthIndex, 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const prevMonthDays = new Date(year, monthIndex, 0).getDate();

  const cells: Array<{ dateIso: string; day: number; inMonth: boolean }> = [];

  for (let i = startOffset - 1; i >= 0; i -= 1) {
    const d = prevMonthDays - i;
    const prevDate = new Date(year, monthIndex - 1, d);
    const iso = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(d).padStart(2, "0")}`;
    cells.push({ dateIso: iso, day: d, inMonth: false });
  }

  for (let d = 1; d <= daysInMonth; d += 1) {
    const iso = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ dateIso: iso, day: d, inMonth: true });
  }

  const remaining = (7 - (cells.length % 7)) % 7;
  for (let d = 1; d <= remaining; d += 1) {
    const nextDate = new Date(year, monthIndex + 1, d);
    const iso = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(d).padStart(2, "0")}`;
    cells.push({ dateIso: iso, day: d, inMonth: false });
  }

  return cells;
}

export function CalendarScheduleView({
  executor,
  refreshTick,
  initialFocusDateIso,
  initialTab,
  todayIso: todayIsoProp,
  voiceAdapter,
  inferenceAdapter,
  registerBackHandler,
  onOpenScheduleWidget,
  onDataChanged,
}: CalendarScheduleViewProps) {
  const effectiveTodayIso = todayIsoProp ?? getLocalTodayIso();
  const initialDate = initialFocusDateIso ?? effectiveTodayIso;
  const [initY, initM] = initialDate.split("-").map(Number);

  const [viewMode, setViewMode] = useState<CalendarMode>(initialTab ?? "month");
  const [year, setYear] = useState<number>(initY || 2026);
  const [monthIndex, setMonthIndex] = useState<number>((initM || 11) - 1);
  const [selectedDateIso, setSelectedDateIso] = useState<string>(initialDate);
  const [haciendaYear, setHaciendaYear] = useState<number>(
    initY || Number(effectiveTodayIso.slice(0, 4)) || 2026
  );
  const [haciendaFilter, setHaciendaFilter] = useState<"all" | "pendiente" | "presentado">("all");
  const [activeTaxModels, setActiveTaxModels] = useState<TaxModelCode[]>(DEFAULT_ACTIVE_TAX_MODELS);
  const [taxStatesMap, setTaxStatesMap] = useState<Map<string, TaxObligationStateRow>>(
    () => new Map()
  );
  const [taxBusyKey, setTaxBusyKey] = useState<string | null>(null);

  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [entries, setEntries] = useState<ScheduleEntryRow[]>([]);
  const [hourlyRateCents, setHourlyRateCents] = useState<number>(3800);
  const [jobSummaries, setJobSummaries] = useState<
    Array<{ job: JobRow; summary: JobScheduleDeviationSummary }>
  >([]);

  const [showAddModal, setShowAddModal] = useState(false);
  const [scheduleDefaults, setScheduleDefaults] =
    useState<WorkScheduleDefaults>(FALLBACK_DEFAULTS);
  const [newModalMode, setNewModalMode] = useState<"same_day" | "multi_day">("same_day");
  const [newJobId, setNewJobId] = useState("");
  const [quickCreateJob, setQuickCreateJob] = useState(false);
  const [quickJobTitle, setQuickJobTitle] = useState("");
  const [newDate, setNewDate] = useState(initialDate);
  const [newEndDate, setNewEndDate] = useState(initialDate);
  const [newStart, setNewStart] = useState("08:00");
  const [newEnd, setNewEnd] = useState("10:00");
  const [newDurationThousandths, setNewDurationThousandths] = useState(2000);
  const [newNotes, setNewNotes] = useState("");
  const [deleteEntryTarget, setDeleteEntryTarget] = useState<ScheduleEntryRow | null>(null);
  const [deleteEntryBusy, setDeleteEntryBusy] = useState(false);
  const [deleteEntryError, setDeleteEntryError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [apptUndoStack, setApptUndoStack] = useState<CalendarAppointmentFormState[]>([]);
  const [apptVoiceChanges, setApptVoiceChanges] = useState<string[]>([]);
  const [apptVoiceWarnings, setApptVoiceWarnings] = useState<string[]>([]);
  const [apptVoiceDisambig, setApptVoiceDisambig] =
    useState<VoiceDisambiguationPayload | null>(null);

  useEffect(() => {
    if (initialTab) {
      setViewMode(initialTab);
    }
  }, [initialTab]);

  useEffect(() => {
    if (initialFocusDateIso) {
      setSelectedDateIso(initialFocusDateIso);
      const [y, m] = initialFocusDateIso.split("-").map(Number);
      if (y && m) {
        setYear(y);
        setMonthIndex(m - 1);
        setHaciendaYear(y);
      }
    }
  }, [initialFocusDateIso]);

  const loadCalendar = async () => {
    const jobsRepo = new JobsRepository(executor);
    const scheduleRepo = new ScheduleRepository(executor);
    const settingsRepo = new SettingsRepository(executor);
    const taxRepo = new TaxCalendarRepository(executor);

    const [allJobs, allEntries, settings, defaults, loadedTaxStates] = await Promise.all([
      jobsRepo.listAll(),
      scheduleRepo.listAllEntries(),
      settingsRepo.getAppSettings(),
      scheduleRepo.getWorkScheduleDefaults(),
      taxRepo.listAllStates(),
    ]);

    const activeJobs = allJobs.filter((j) => j.status !== "cancelado");
    const entryJobIds = new Set(allEntries.map((e) => e.job_id).filter(Boolean));
    const statsJobs = activeJobs.filter(
      (j) => j.status === "en_curso" || entryJobIds.has(j.id)
    );
    const summaries = await Promise.all(
      statsJobs.map(async (job) => ({
        job,
        summary: await scheduleRepo.getJobScheduleDeviationSummary(job.id),
      }))
    );

    setJobs(activeJobs);
    setEntries(allEntries);
    setHourlyRateCents(settings.hourly_rate_cents);
    setActiveTaxModels(settings.active_tax_models);
    setTaxStatesMap(loadedTaxStates);
    setJobSummaries(summaries);
    setScheduleDefaults(defaults);
    if (!showAddModal) {
      setNewStart(defaults.morning_start);
      setNewEnd(defaults.afternoon_end || defaults.morning_end);
      setNewDurationThousandths(computeDailyWorkHoursThousandths(defaults) || 8000);
      if (!newJobId && activeJobs[0]) {
        setNewJobId(activeJobs[0].id);
      }
    }
  };

  useEffect(() => {
    void loadCalendar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executor, refreshTick]);

  const monthCells = useMemo(() => buildMonthGrid(year, monthIndex), [year, monthIndex]);
  const displayedCells = useMemo(() => {
    if (viewMode === "month") return monthCells;
    const idx = monthCells.findIndex((c) => c.dateIso === selectedDateIso);
    const rowStart = idx >= 0 ? Math.floor(idx / 7) * 7 : 0;
    return monthCells.slice(rowStart, rowStart + 7);
  }, [monthCells, viewMode, selectedDateIso]);

  const entriesByDate = useMemo(() => {
    const map = new Map<string, ScheduleEntryRow[]>();
    for (const e of entries) {
      const list = map.get(e.date_iso) ?? [];
      list.push(e);
      map.set(e.date_iso, list);
    }
    return map;
  }, [entries]);

  const jobsById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);
  const selectedEntries = entriesByDate.get(selectedDateIso) ?? [];
  const primaryDayEntry = selectedEntries[0] ?? null;
  const primaryDayJob = primaryDayEntry?.job_id ? jobsById.get(primaryDayEntry.job_id) ?? null : null;

  const highlightedJob = useMemo(() => {
    if (primaryDayJob?.start_date_iso && primaryDayJob.end_date_iso) {
      return primaryDayJob;
    }
    return jobs.find((j) => j.start_date_iso && j.end_date_iso) ?? null;
  }, [primaryDayJob, jobs]);

  const taxMilestonesByDate = useMemo(() => {
    const combined = new Map<string, TaxCalendarDayMilestone[]>();
    const seenMonths = new Set<string>();
    const candidateIsos = displayedCells.map((c) => c.dateIso);
    if (selectedDateIso) {
      candidateIsos.push(selectedDateIso);
    }
    for (const iso of candidateIsos) {
      const ym = iso.slice(0, 7);
      if (seenMonths.has(ym)) continue;
      seenMonths.add(ym);
      const [cy, cm] = ym.split("-").map(Number);
      if (!cy || !cm) continue;
      const monthMap = getTaxMilestonesByMonth(cy, cm - 1, activeTaxModels, taxStatesMap);
      for (const [mIso, list] of monthMap.entries()) {
        const existing = combined.get(mIso);
        if (existing) {
          existing.push(...list);
        } else {
          combined.set(mIso, [...list]);
        }
      }
    }
    return combined;
  }, [displayedCells, selectedDateIso, activeTaxModels, taxStatesMap]);

  const selectedTaxMilestones = taxMilestonesByDate.get(selectedDateIso) ?? [];

  const haciendaObligations = useMemo(() => {
    const all = listObligationsAroundYear(haciendaYear, activeTaxModels, taxStatesMap);
    const forYear = all.filter((ob) => ob.endDateIso.startsWith(`${haciendaYear}-`));
    if (haciendaFilter === "pendiente") {
      return forYear.filter((ob) => ob.status === "pendiente");
    }
    if (haciendaFilter === "presentado") {
      return forYear.filter((ob) => ob.status === "presentado");
    }
    return forYear;
  }, [haciendaYear, activeTaxModels, taxStatesMap, haciendaFilter]);

  const handleSetObligationStatus = async (
    ob: TaxObligationInstance,
    status: TaxObligationStatus
  ) => {
    setTaxBusyKey(ob.obligationKey);
    try {
      await new TaxCalendarRepository(executor).setObligationStatus({
        obligation_key: ob.obligationKey,
        model_code: ob.modelCode,
        fiscal_year: ob.fiscalYear,
        period_code: ob.periodCode,
        status,
        presented_at_iso: status === "presentado" ? effectiveTodayIso : null,
      });
      await loadCalendar();
      await onDataChanged();
    } finally {
      setTaxBusyKey(null);
    }
  };

  const handleToggleTaxModel = async (code: TaxModelCode) => {
    const next = activeTaxModels.includes(code)
      ? activeTaxModels.filter((c) => c !== code)
      : [...activeTaxModels, code];
    await new SettingsRepository(executor).updateActiveTaxModels(next);
    await loadCalendar();
    await onDataChanged();
  };

  const changeMonth = (delta: number) => {
    const dt = new Date(year, monthIndex + delta, 1);
    setYear(dt.getFullYear());
    setMonthIndex(dt.getMonth());
  };

  const handleSaveAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDate) return;
    setErrorMsg(null);
    if (quickCreateJob && !quickJobTitle.trim()) {
      setErrorMsg("Escribe el título de la nueva obra.");
      return;
    }
    if (newModalMode === "same_day") {
      if (parseHHMMToMinutes(newEnd) <= parseHHMMToMinutes(newStart)) {
        setErrorMsg("La hora de salida debe ser posterior a la hora de entrada.");
        return;
      }
    } else {
      if (!newEndDate || newEndDate < newDate) {
        setErrorMsg("La fecha fin debe ser igual o posterior a la fecha de inicio.");
        return;
      }
      if (!quickCreateJob && !newJobId) {
        setErrorMsg("Selecciona una obra existente o activa '+ Crear obra rápida' para varios días.");
        return;
      }
    }

    setBusy(true);
    try {
      const jobsRepo = new JobsRepository(executor);
      const scheduleRepo = new ScheduleRepository(executor);
      let targetJobId: string | null = newJobId || null;

      if (quickCreateJob) {
        const createdJob = await jobsRepo.createDirectJob({
          title: quickJobTitle.trim(),
          start_date_iso: newDate,
          end_date_iso: newModalMode === "multi_day" ? newEndDate : newDate,
        });
        targetJobId = createdJob.id;
      }

      if (newModalMode === "same_day") {
        await scheduleRepo.createSingleEntry({
          job_id: targetJobId,
          date_iso: newDate,
          planned_start: newStart,
          planned_end: newEnd,
          planned_hours_thousandths: newDurationThousandths,
          notes: newNotes,
        });
      } else if (targetJobId) {
        await scheduleRepo.generateEntriesForJobDateRange(targetJobId, newDate, newEndDate);
      }

      setSelectedDateIso(newDate);
      setNewNotes("");
      setQuickCreateJob(false);
      setQuickJobTitle("");
      setShowAddModal(false);
      await loadCalendar();
      await onDataChanged();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const openAddModal = (dateIso: string) => {
    setErrorMsg(null);
    setNewModalMode("same_day");
    setNewDate(dateIso);
    setNewEndDate(dateIso);
    setNewStart(scheduleDefaults.morning_start);
    const twoHoursLaterMin = Math.min(
      23 * 60 + 59,
      parseHHMMToMinutes(scheduleDefaults.morning_start) + 120
    );
    setNewEnd(minutesToHHMM(twoHoursLaterMin));
    setNewDurationThousandths(2000);
    setQuickCreateJob(false);
    setQuickJobTitle("");
    setShowAddModal(true);
  };

  const handleConfirmDeleteEntry = async () => {
    if (!deleteEntryTarget) return;
    setDeleteEntryError(null);
    setDeleteEntryBusy(true);
    try {
      await new ScheduleRepository(executor).deleteEntry(deleteEntryTarget.id);
      setDeleteEntryTarget(null);
      await loadCalendar();
      await onDataChanged();
    } catch (err) {
      setDeleteEntryError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleteEntryBusy(false);
    }
  };

  return (
    <div
      data-testid="calendar-schedule-view"
      className="flex flex-1 flex-col overflow-y-auto no-scrollbar px-4 pt-4 pb-8 gap-4 bg-surface"
    >
      {/* Cabecera del módulo: Mes y + Añadir cita */}
      <section className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2">
          {viewMode === "hacienda" ? (
            <div className="flex items-center gap-2 min-w-0">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-900">
                <Landmark className="w-4 h-4" />
              </span>
              <div className="min-w-0">
                <h2 className="text-[16px] font-semibold text-on-surface truncate">
                  Calendario Fiscal AEAT
                </h2>
                <p className="text-[11px] text-on-surface-variant truncate">
                  {activeTaxModels.length} modelos activos · Territorio Común
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => changeMonth(-1)}
                aria-label="Mes anterior"
                className="w-10 h-10 rounded-full bg-surface-container-lowest border border-outline-variant inline-flex items-center justify-center text-on-surface cursor-pointer hover:border-terracotta"
              >
                <ChevronLeft className="w-[18px] h-[18px]" />
              </button>
              <h2 className="text-[17px] font-semibold text-on-surface px-1 min-w-[138px] text-center">
                {MONTH_NAMES_ES[monthIndex]} {year}
              </h2>
              <button
                type="button"
                onClick={() => changeMonth(1)}
                aria-label="Mes siguiente"
                className="w-10 h-10 rounded-full bg-surface-container-lowest border border-outline-variant inline-flex items-center justify-center text-on-surface cursor-pointer hover:border-terracotta"
              >
                <ChevronRight className="w-[18px] h-[18px]" />
              </button>
            </div>
          )}

          <button
            type="button"
            data-testid="calendar-add-appointment-btn"
            onClick={() => openAddModal(selectedDateIso)}
            className="min-h-[42px] px-3.5 rounded-full bg-secondary text-on-secondary font-semibold text-[12px] inline-flex items-center gap-1 shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Añadir cita</span>
          </button>
        </div>

        {/* Toggle Mes | Semana | Lista obras | Hacienda */}
        <div className="grid grid-cols-4 gap-1 bg-surface-container-lowest border border-outline-variant rounded-full p-1">
          {(
            [
              { id: "month", label: "Mes" },
              { id: "week", label: "Semana" },
              { id: "jobs", label: "Obras" },
              { id: "hacienda", label: "Hacienda" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              data-testid={tab.id === "hacienda" ? "calendar-tab-hacienda" : `calendar-tab-${tab.id}`}
              onClick={() => setViewMode(tab.id)}
              aria-pressed={viewMode === tab.id}
              className={`min-h-[38px] rounded-full font-semibold text-[12px] cursor-pointer transition-colors ${
                viewMode === tab.id
                  ? "bg-terracotta-soft text-on-primary-container"
                  : "text-on-surface-variant hover:bg-surface-container"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-2xl border border-coral-alert/30 bg-error-container p-3 text-xs text-on-error-container"
        >
          {errorMsg}
        </div>
      )}

      {/* Vista de Calendario Visual (Mes o Semana) */}
      {(viewMode === "month" || viewMode === "week") && (
        <section className="bg-surface-container-lowest border border-outline-variant rounded-[20px] p-3.5 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col gap-2">
          <div className="grid grid-cols-7 text-center pb-1 border-b border-outline-variant">
            {["L", "M", "X", "J", "V", "S", "D"].map((d, idx) => (
              <span
                key={d}
                className={`text-[11px] font-semibold ${
                  idx >= 5 ? "text-outline" : "text-on-surface-variant"
                }`}
              >
                {d}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-y-1 text-center">
            {displayedCells.map((cell) => {
              const dayEntries = entriesByDate.get(cell.dateIso) ?? [];
              const dayMilestones = taxMilestonesByDate.get(cell.dateIso) ?? [];
              const isSelected = cell.dateIso === selectedDateIso;
              const inHighlightRange =
                highlightedJob?.start_date_iso &&
                highlightedJob?.end_date_iso &&
                cell.dateIso >= highlightedJob.start_date_iso &&
                cell.dateIso <= highlightedJob.end_date_iso;
              const isRangeStart = highlightedJob?.start_date_iso === cell.dateIso;
              const isRangeEnd = highlightedJob?.end_date_iso === cell.dateIso;

              const statusDotColor = dayEntries.some((e) => e.status === "alargado")
                ? "bg-amber-tax"
                : dayEntries.some((e) => e.status === "antes")
                  ? "bg-info"
                  : dayEntries.some((e) => e.status === "en_hora")
                    ? "bg-emerald-free"
                    : dayEntries.length > 0
                      ? "bg-terracotta"
                      : "";

              const allTaxDone =
                dayMilestones.length > 0 &&
                dayMilestones.every(
                  (m) =>
                    m.obligation.status === "presentado" || m.obligation.status === "no_aplica"
                );
              const taxDotColor =
                dayMilestones.length === 0
                  ? ""
                  : allTaxDone
                    ? "bg-emerald-600"
                    : dayMilestones.some((m) => m.milestoneKind === "end")
                      ? "bg-rose-600"
                      : "bg-amber-500";

              return (
                <button
                  key={cell.dateIso}
                  type="button"
                  data-testid={`calendar-day-${cell.dateIso}`}
                  onClick={() => setSelectedDateIso(cell.dateIso)}
                  className={`min-h-[44px] py-1 flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer ${
                    isSelected
                      ? "bg-terracotta text-white rounded-xl shadow-xs"
                      : inHighlightRange
                        ? `bg-terracotta-soft text-on-primary-container ${
                            isRangeStart ? "rounded-l-xl" : ""
                          } ${isRangeEnd ? "rounded-r-xl" : ""}`
                        : cell.inMonth
                          ? "text-on-surface hover:bg-surface-container-low rounded-lg"
                          : "text-outline/60"
                  }`}
                >
                  <span className="font-mono text-[12px] font-semibold tabular-nums">
                    {cell.day}
                  </span>
                  <div className="flex items-center justify-center gap-0.5 min-h-[10px]">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        statusDotColor
                          ? isSelected
                            ? "bg-white"
                            : statusDotColor
                          : "opacity-0"
                      }`}
                    />
                    {dayEntries.length > 1 && (
                      <span
                        className={`text-[9px] font-mono font-bold leading-none ${
                          isSelected ? "text-white" : "text-on-surface-variant"
                        }`}
                      >
                        ×{dayEntries.length}
                      </span>
                    )}
                    {taxDotColor && (
                      <span
                        aria-label="Hito fiscal AEAT"
                        className={`w-1.5 h-1.5 rounded-full ${
                          isSelected ? "bg-amber-200" : taxDotColor
                        }`}
                      />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="pt-2 border-t border-outline-variant flex flex-col gap-1.5">
            {highlightedJob && (
              <div className="flex items-center gap-1.5 bg-terracotta-soft px-2.5 py-1 rounded-lg">
                <span className="w-2 h-2 rounded-full bg-terracotta shrink-0" />
                <span className="text-[11px] font-semibold text-on-primary-container truncate">
                  {formatDateRangeEs(highlightedJob.start_date_iso, highlightedJob.end_date_iso)} ·{" "}
                  {highlightedJob.title}
                </span>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 pt-0.5 px-0.5">
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-free" />
                <span className="text-[11px] font-semibold text-on-surface-variant">En hora</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-tax" />
                <span className="text-[11px] font-semibold text-on-surface-variant">
                  Horas extra
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-info" />
                <span className="text-[11px] font-semibold text-on-surface-variant">
                  Antes de hora
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-rose-600" />
                <span className="text-[11px] font-semibold text-on-surface-variant">
                  Hacienda
                </span>
              </div>
            </div>
          </div>
        </section>
      )}

      {viewMode === "jobs" && (
        /* Vista Lista de obras con fechas */
        <section className="flex flex-col gap-2.5">
          {jobs.filter((j) => j.start_date_iso).length === 0 ? (
            <div className="rounded-[20px] border border-dashed border-outline-variant bg-surface-container-lowest p-5 text-center text-[13px] text-on-surface-variant">
              Aún no hay obras con fechas planificadas. Abre una obra o créala con fecha de inicio y fin.
            </div>
          ) : (
            jobs
              .filter((j) => j.start_date_iso)
              .map((job) => {
                const jobEntriesForJob = entries.filter((e) => e.job_id === job.id);
                const distinctDays = new Set(jobEntriesForJob.map((e) => e.date_iso)).size;
                const totalPlannedThousandths = jobEntriesForJob.reduce(
                  (acc, e) => acc + e.planned_hours_thousandths,
                  0
                );
                const isSubDayJob =
                  distinctDays <= 1 &&
                  (!job.end_date_iso || job.start_date_iso === job.end_date_iso) &&
                  jobEntriesForJob.length >= 1;
                return (
                  <button
                    key={job.id}
                    type="button"
                    onClick={() => {
                      if (job.start_date_iso) setSelectedDateIso(job.start_date_iso);
                      setViewMode("month");
                    }}
                    className="bg-surface-warm-card border border-outline-variant rounded-2xl p-3.5 text-left flex items-center justify-between gap-2 hover:border-terracotta cursor-pointer"
                  >
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="font-mono text-[11px] text-on-primary-container font-semibold">
                        {formatDateRangeEs(job.start_date_iso, job.end_date_iso)} · {job.job_code}
                      </span>
                      <span className="text-[15px] font-semibold text-on-surface truncate">
                        {job.title}
                      </span>
                      {job.address && (
                        <span className="text-[12px] text-on-surface-variant truncate">
                          {job.address}
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-[12px] font-semibold text-on-surface bg-surface-container-lowest px-2.5 py-1 rounded-full border border-outline-variant shrink-0">
                      {isSubDayJob
                        ? formatHoursFromThousandths(totalPlannedThousandths)
                        : `${distinctDays} días`}
                    </span>
                  </button>
                );
              })
          )}
        </section>
      )}

      {viewMode === "hacienda" && (
        <section className="flex flex-col gap-3" data-testid="calendar-hacienda-view">
          <TaxAlertsBanner
            executor={executor}
            refreshTick={refreshTick}
            todayIso={effectiveTodayIso}
            maxVisible={6}
            onTaxStateChanged={async () => {
              await loadCalendar();
              await onDataChanged();
            }}
          />

          <div className="rounded-2xl border border-amber-200 bg-amber-50/90 px-3.5 py-2.5 text-[11px] leading-relaxed text-amber-950">
            Fechas orientativas para <strong>Territorio Común (AEAT)</strong>; festivos autonómicos
            o locales pueden trasladar vencimientos al siguiente día hábil.
          </div>

          {/* Control anual y filtros */}
          <div className="rounded-[20px] border border-outline-variant bg-surface-container-lowest p-3.5 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Año anterior"
                  onClick={() => setHaciendaYear((y) => y - 1)}
                  className="w-9 h-9 rounded-full border border-outline-variant bg-white inline-flex items-center justify-center text-slate-700 hover:border-terracotta cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="font-mono text-sm font-bold px-2 tabular-nums">
                  {haciendaYear}
                </span>
                <button
                  type="button"
                  aria-label="Año siguiente"
                  onClick={() => setHaciendaYear((y) => y + 1)}
                  className="w-9 h-9 rounded-full border border-outline-variant bg-white inline-flex items-center justify-center text-slate-700 hover:border-terracotta cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center gap-1 rounded-full bg-surface-container p-0.5">
                {(
                  [
                    { id: "all", label: "Todos" },
                    { id: "pendiente", label: "Pendientes" },
                    { id: "presentado", label: "Presentados" },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setHaciendaFilter(f.id)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold cursor-pointer ${
                      haciendaFilter === f.id
                        ? "bg-white text-slate-900 shadow-xs"
                        : "text-on-surface-variant"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-700">
                  Modelos activos ({activeTaxModels.length}/13)
                </span>
                <span className="text-[10px] text-slate-500">Pulsa para activar/desactivar</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {TAX_MODEL_CATALOG.map((m) => {
                  const active = activeTaxModels.includes(m.code);
                  return (
                    <button
                      key={m.code}
                      type="button"
                      onClick={() => void handleToggleTaxModel(m.code)}
                      aria-pressed={active}
                      title={m.title}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-bold cursor-pointer transition-colors ${
                        active
                          ? "border-amber-500 bg-amber-100 text-amber-950"
                          : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                      }`}
                    >
                      Mod. {m.code}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Lista cronológica de obligaciones */}
          {haciendaObligations.length === 0 ? (
            <div className="rounded-[20px] border border-dashed border-outline-variant bg-surface-container-lowest p-5 text-center text-[13px] text-on-surface-variant">
              No hay obligaciones fiscales para mostrar con los filtros actuales.
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {haciendaObligations.map((ob) => {
                const isBusy = taxBusyKey === ob.obligationKey;
                const isPresented = ob.status === "presentado";
                const isNotApplicable = ob.status === "no_aplica";
                const isOverdue = ob.status === "pendiente" && ob.endDateIso < effectiveTodayIso;
                const isOpenNow =
                  ob.status === "pendiente" &&
                  effectiveTodayIso >= ob.startDateIso &&
                  effectiveTodayIso <= ob.endDateIso;

                return (
                  <div
                    key={ob.obligationKey}
                    data-testid={`tax-obligation-${ob.obligationKey}`}
                    className={`rounded-[18px] border p-3.5 shadow-xs ${
                      isPresented
                        ? "border-emerald-200 bg-emerald-50/40"
                        : isNotApplicable
                          ? "border-slate-200 bg-slate-50/70 opacity-75"
                          : isOverdue
                            ? "border-rose-300 bg-rose-50/70"
                            : isOpenNow
                              ? "border-amber-300 bg-amber-50/60"
                              : "border-outline-variant bg-surface-container-lowest"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded-full bg-slate-900 px-2 py-0.5 font-mono text-[10px] font-bold text-white">
                            {ob.meta.shortLabel}
                          </span>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                            {ob.periodLabel}
                          </span>
                          <span className="text-[10px] font-semibold text-slate-500">
                            {ob.meta.category}
                          </span>
                        </div>
                        <h4 className="mt-1 text-[13px] font-bold text-slate-900">
                          {ob.meta.title}
                        </h4>
                        <p className="mt-0.5 font-mono text-[11px] text-slate-700">
                          {ob.isSingleDueDate
                            ? `Vencimiento único: ${ob.endDateIso}`
                            : `Plazo: ${ob.startDateIso} → ${ob.endDateIso}`}
                          {ob.endDateIso !== ob.nominalEndDateIso
                            ? ` (trasladado desde ${ob.nominalEndDateIso})`
                            : ""}
                        </p>
                        {ob.debitCutoffIso && (
                          <p className="mt-0.5 text-[11px] font-semibold text-amber-800">
                            Domiciliación bancaria hasta {ob.debitCutoffIso}
                          </p>
                        )}
                      </div>

                      <span
                        className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-extrabold ${
                          isPresented
                            ? "bg-emerald-600 text-white"
                            : isNotApplicable
                              ? "bg-slate-400 text-white"
                              : isOverdue
                                ? "bg-rose-600 text-white"
                                : isOpenNow
                                  ? "bg-amber-600 text-white"
                                  : "bg-slate-200 text-slate-800"
                        }`}
                      >
                        {isPresented
                          ? "Presentado"
                          : isNotApplicable
                            ? "No aplica"
                            : isOverdue
                              ? "Vencido"
                              : isOpenNow
                                ? "En plazo"
                                : "Pendiente"}
                      </span>
                    </div>

                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-black/5 pt-2">
                      <button
                        type="button"
                        disabled={isBusy || ob.status === "presentado"}
                        onClick={() => void handleSetObligationStatus(ob, "presentado")}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-emerald-700 disabled:opacity-45 cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Presentado
                      </button>
                      <button
                        type="button"
                        disabled={isBusy || ob.status === "pendiente"}
                        onClick={() => void handleSetObligationStatus(ob, "pendiente")}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-45 cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Pendiente
                      </button>
                      <button
                        type="button"
                        disabled={isBusy || ob.status === "no_aplica"}
                        onClick={() => void handleSetObligationStatus(ob, "no_aplica")}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-45 cursor-pointer"
                      >
                        <Ban className="w-3 h-3" />
                        No aplica
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Tarjeta de Agenda del Día Seleccionado */}
      {viewMode !== "hacienda" && (
      <section className="bg-surface-container-lowest border border-outline-variant rounded-[20px] p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col min-w-0">
            <span className="text-[12px] font-semibold text-on-primary-container">
              {formatFullDayLabelEs(selectedDateIso)}
              {selectedDateIso === effectiveTodayIso ? " · Hoy" : ""}
            </span>
            <h3 className="text-[17px] font-semibold text-on-surface truncate">
              {selectedEntries.length > 1
                ? `${selectedEntries.length} trabajos / citas hoy`
                : primaryDayJob?.title ??
                  (primaryDayEntry ? "Cita de agenda" : "Día libre sin obra asignada")}
            </h3>
          </div>
          {selectedEntries.length <= 1 && primaryDayJob && (
            <span className="font-mono text-[11px] text-on-surface-variant bg-surface-container px-2 py-1 rounded-lg tabular-nums shrink-0">
              {primaryDayJob.job_code}
            </span>
          )}
        </div>

        {selectedTaxMilestones.length > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/75 p-2.5 flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5 text-[11px] font-extrabold text-amber-950">
              <Landmark className="w-3.5 h-3.5 text-amber-700" />
              <span>Hitos Hacienda AEAT este día</span>
            </div>
            {selectedTaxMilestones.map((m) => (
              <div
                key={`${m.obligation.obligationKey}_${m.milestoneKind}`}
                className="flex items-center justify-between gap-2 rounded-xl bg-white/90 px-2.5 py-1.5 border border-amber-200/70"
              >
                <div className="min-w-0">
                  <span className="text-xs font-bold text-slate-900">
                    {m.obligation.meta.shortLabel} ({m.obligation.periodLabel})
                  </span>
                  <span className="block text-[11px] text-slate-600">
                    {m.milestoneKind === "start"
                      ? "Apertura de plazo de presentación"
                      : m.milestoneKind === "debit"
                        ? "Fin domiciliación bancaria"
                        : "Último día de presentación"}
                  </span>
                </div>
                {m.obligation.status === "pendiente" ? (
                  <button
                    type="button"
                    disabled={taxBusyKey === m.obligation.obligationKey}
                    onClick={() => void handleSetObligationStatus(m.obligation, "presentado")}
                    className="shrink-0 rounded-lg bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-emerald-700 cursor-pointer"
                  >
                    Presentado
                  </button>
                ) : (
                  <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                    {m.obligation.status === "presentado" ? "Presentado" : "No aplica"}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {selectedEntries.length > 0 ? (
          <div className="flex flex-col gap-2.5">
            {selectedEntries.map((dayEntry, idx) => {
              const entryJob = dayEntry.job_id ? jobsById.get(dayEntry.job_id) ?? null : null;
              return (
                <div
                  key={dayEntry.id}
                  data-testid={`calendar-day-entry-${dayEntry.id}`}
                  className="flex flex-col gap-2 bg-surface-container-low rounded-2xl p-3 border border-outline-variant/60"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[13px] font-semibold text-on-surface truncate">
                          {entryJob?.title ?? "Cita rápida / visita"}
                        </span>
                        {entryJob && (
                          <span className="font-mono text-[10px] text-on-surface-variant bg-surface-container px-1.5 py-0.5 rounded-md">
                            {entryJob.job_code}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-on-surface-variant" />
                        <span className="font-mono text-[14px] font-semibold text-on-surface tabular-nums">
                          {dayEntry.planned_start} – {dayEntry.actual_end ?? dayEntry.planned_end}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span
                        className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${
                          dayEntry.status === "alargado"
                            ? "bg-warning-container text-on-warning-container"
                            : dayEntry.status === "antes"
                              ? "bg-info-container text-on-info-container"
                              : "bg-success-container text-on-success-container"
                        }`}
                      >
                        {dayEntry.actual_hours_thousandths !== null
                          ? `${formatHoursFromThousandths(dayEntry.actual_hours_thousandths)} reales`
                          : `${formatHoursFromThousandths(dayEntry.planned_hours_thousandths)} previstas`}
                      </span>
                      <button
                        type="button"
                        aria-label="Eliminar cita del calendario"
                        data-testid={`calendar-delete-entry-${dayEntry.id}`}
                        onClick={() => {
                          setDeleteEntryError(null);
                          setDeleteEntryTarget(dayEntry);
                        }}
                        className="w-8 h-8 rounded-full border border-outline-variant bg-surface-container-lowest text-rose-700 hover:bg-rose-50 inline-flex items-center justify-center cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {entryJob?.address && (
                    <div className="flex items-center gap-1.5 min-w-0">
                      <MapPin className="w-3.5 h-3.5 text-on-surface-variant shrink-0" />
                      <span className="text-[12px] text-on-surface-variant truncate">
                        {entryJob.address}
                      </span>
                    </div>
                  )}

                  {dayEntry.notes && (
                    <p className="text-[12px] text-on-surface-variant pt-1 border-t border-outline-variant/60">
                      {dayEntry.notes}
                    </p>
                  )}

                  <button
                    type="button"
                    data-testid={idx === 0 ? "calendar-log-workday-btn" : `calendar-log-workday-btn-${idx}`}
                    onClick={() =>
                      onOpenScheduleWidget({
                        ui_widget_type: "ScheduleWorkLogWidget",
                        widget_payload: {
                          mode: "daily_log",
                          entry_id: dayEntry.id,
                          job_id: dayEntry.job_id,
                          date_iso: selectedDateIso,
                          suggested_reason: dayEntry.deviation_reason,
                          suggested_notes: dayEntry.notes,
                        },
                      })
                    }
                    className="min-h-[42px] w-full px-3 rounded-xl bg-primary hover:bg-terracotta text-white font-semibold text-[13px] flex items-center justify-center gap-2 shadow-xs cursor-pointer"
                  >
                    <CalendarPlus className="w-4 h-4" />
                    <span>Registrar salida / Ajustar horas</span>
                  </button>
                </div>
              );
            })}

            <button
              type="button"
              data-testid="calendar-add-another-btn"
              onClick={() => openAddModal(selectedDateIso)}
              className="min-h-[42px] w-full rounded-xl border border-dashed border-outline-variant text-xs font-semibold text-on-surface hover:border-terracotta flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Añadir otro trabajo / visita este día</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-on-surface-variant">
              No hay jornadas programadas para el {formatShortDateEs(selectedDateIso)}.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => openAddModal(selectedDateIso)}
                className="min-h-[46px] rounded-xl bg-secondary text-white font-semibold text-[12px] flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Cita / trabajo</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  onOpenScheduleWidget({
                    ui_widget_type: "ScheduleWorkLogWidget",
                    widget_payload: {
                      mode: "daily_log",
                      entry_id: null,
                      job_id: jobs[0]?.id ?? null,
                      date_iso: selectedDateIso,
                      suggested_reason: "",
                      suggested_notes: "",
                    },
                  })
                }
                className="min-h-[46px] rounded-xl bg-primary text-white font-semibold text-[12px] flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <CalendarPlus className="w-4 h-4" />
                <span>Registrar parte</span>
              </button>
            </div>
          </div>
        )}
      </section>
      )}

      {/* Gráfica Visual de Desviación de Plazos y Horas */}
      <section className="bg-surface-container-lowest border border-outline-variant rounded-[20px] p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col gap-3.5">
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-on-surface">
            Plazos y horas: previsto vs real
          </h3>
          <span className="font-mono text-[12px] text-on-surface-variant tabular-nums">
            {formatCentsEs(hourlyRateCents)}/h
          </span>
        </div>

        {jobSummaries.length === 0 ? (
          <p className="text-[13px] text-on-surface-variant">
            Crea o planifica una obra con fechas para comparar las horas previstas frente a las reales.
          </p>
        ) : (
          <div className="flex flex-col gap-3.5">
            {jobSummaries.map(({ job, summary }, idx) => {
              const plannedHrs = summary.planned_hours_thousandths || 8000;
              const actualHrs = summary.actual_hours_thousandths;
              const maxBar = Math.max(plannedHrs, actualHrs, 1);
              const plannedPct = Math.round((plannedHrs / maxBar) * 100);
              const actualPct = Math.round((actualHrs / maxBar) * 100);
              const isOver = summary.deviation_hours_thousandths > 50;
              const isEarly = summary.deviation_hours_thousandths < -50;

              return (
                <div
                  key={job.id}
                  className={`flex flex-col gap-1.5 ${
                    idx > 0 ? "pt-3 border-t border-outline-variant" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-medium text-on-surface truncate">
                      {job.job_code} · {job.title}
                    </span>
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 tabular-nums ${
                        isOver
                          ? "bg-warning-container text-on-warning-container"
                          : isEarly
                            ? "bg-info-container text-on-info-container"
                            : "bg-success-container text-on-success-container"
                      }`}
                    >
                      {isOver || isEarly
                        ? `${formatSignedHoursFromThousandths(summary.deviation_hours_thousandths)} (${
                            summary.economic_impact_cents >= 0 ? "+" : ""
                          }${formatCentsEs(summary.economic_impact_cents)})`
                        : "En plazo"}
                    </span>
                  </div>

                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-on-surface-variant w-14">
                        Previsto
                      </span>
                      <div className="flex-1 h-2 rounded-full bg-surface-container overflow-hidden">
                        <div
                          className="h-full bg-secondary rounded-full transition-all duration-300"
                          style={{ width: `${plannedPct}%` }}
                        />
                      </div>
                      <span className="font-mono text-[12px] text-on-surface tabular-nums w-14 text-right">
                        {formatHoursFromThousandths(summary.planned_hours_thousandths)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-on-surface-variant w-14">
                        Real
                      </span>
                      <div className="flex-1 h-2 rounded-full bg-surface-container overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            isOver
                              ? "bg-amber-tax"
                              : isEarly
                                ? "bg-info"
                                : "bg-emerald-free"
                          }`}
                          style={{ width: `${actualPct}%` }}
                        />
                      </div>
                      <span
                        className={`font-mono text-[12px] tabular-nums w-14 text-right ${
                          isOver
                            ? "text-on-warning-container"
                            : isEarly
                              ? "text-on-info-container"
                              : "text-on-success-container"
                        }`}
                      >
                        {formatHoursFromThousandths(summary.actual_hours_thousandths)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Modal Añadir cita */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-secondary/45 flex items-end sm:items-center justify-center p-4">
          <form
            onSubmit={(e) => void handleSaveAppointment(e)}
            className="w-full max-w-[380px] max-h-[88vh] overflow-y-auto bg-surface-container-lowest rounded-[24px] p-5 border border-outline-variant shadow-2xl flex flex-col gap-3.5"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[16px] font-semibold text-on-surface">Añadir cita o trabajo</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="w-10 h-10 rounded-full hover:bg-surface-container flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1 bg-surface-container-low border border-outline-variant rounded-full p-1">
              <button
                type="button"
                data-testid="calendar-modal-mode-sameday"
                onClick={() => setNewModalMode("same_day")}
                className={`min-h-[34px] rounded-full text-[11px] font-semibold cursor-pointer ${
                  newModalMode === "same_day"
                    ? "bg-secondary text-on-secondary"
                    : "text-on-surface-variant"
                }`}
              >
                Mismo día / horas
              </button>
              <button
                type="button"
                data-testid="calendar-modal-mode-multiday"
                onClick={() => setNewModalMode("multi_day")}
                className={`min-h-[34px] rounded-full text-[11px] font-semibold cursor-pointer ${
                  newModalMode === "multi_day"
                    ? "bg-secondary text-on-secondary"
                    : "text-on-surface-variant"
                }`}
              >
                Varios días
              </button>
            </div>

            {errorMsg && (
              <div
                role="alert"
                className="rounded-xl border border-coral-alert/30 bg-error-container px-3 py-2 text-[12px] font-semibold text-on-error-container"
              >
                {errorMsg}
              </div>
            )}

            <InlineVoiceFormTrigger
              voiceAdapter={voiceAdapter}
              registerBackHandler={registerBackHandler}
              testId="calendar-modal-voice-btn"
              title="Dictar cita en agenda"
              placeholder="Ej: Mañana de 9 a 13:30 en obra de Marta, visita medición"
              examples={[
                "Mañana de 9 a 13:30, visita medición",
                "El viernes de 10:00 a 12:00 en obra de Juan",
              ]}
              buttonLabel="Dictar cita"
              disabled={busy}
              lastChanges={apptVoiceChanges}
              lastWarnings={apptVoiceWarnings}
              canUndo={apptUndoStack.length > 0}
              onUndo={() => {
                const prev = apptUndoStack[apptUndoStack.length - 1];
                if (!prev) return;
                setApptUndoStack((s) => s.slice(0, -1));
                setNewJobId(prev.jobId);
                setNewDate(prev.dateIso);
                setNewStart(prev.start);
                setNewEnd(prev.end);
                setNewNotes(prev.notes);
                setApptVoiceChanges(["Último dictado deshecho"]);
                setApptVoiceWarnings([]);
                setApptVoiceDisambig(null);
              }}
              disambiguation={
                apptVoiceDisambig
                  ? {
                      prompt: apptVoiceDisambig.prompt,
                      options: apptVoiceDisambig.options,
                      onSelect: (id) => {
                        const snap: CalendarAppointmentFormState = {
                          jobId: newJobId,
                          dateIso: newDate,
                          start: newStart,
                          end: newEnd,
                          notes: newNotes,
                        };
                        setApptUndoStack((s) => [...s.slice(-9), snap]);
                        setNewJobId(id);
                        const hit = jobs.find((j) => j.id === id);
                        setApptVoiceChanges([hit ? `Obra: ${hit.job_code}` : "Obra seleccionada"]);
                        setApptVoiceWarnings([]);
                        setApptVoiceDisambig(null);
                      },
                      onDismiss: () => setApptVoiceDisambig(null),
                    }
                  : null
              }
              onTranscript={async (text) => {
                const snap: CalendarAppointmentFormState = {
                  jobId: newJobId,
                  dateIso: newDate,
                  start: newStart,
                  end: newEnd,
                  notes: newNotes,
                };
                const res = await patchCalendarAppointmentByVoice(snap, text, {
                  executor,
                  inferenceAdapter,
                });
                if (res.changed) {
                  setApptUndoStack((s) => [...s.slice(-9), snap]);
                  setNewJobId(res.nextState.jobId);
                  setNewDate(res.nextState.dateIso);
                  setNewStart(res.nextState.start);
                  setNewEnd(res.nextState.end);
                  setNewNotes(res.nextState.notes);
                  setApptVoiceChanges(res.appliedChanges);
                  setApptVoiceWarnings(res.warnings);
                } else if (!res.disambiguation) {
                  setApptVoiceChanges([]);
                  setApptVoiceWarnings(["No detecté fecha, hora ni nota en el dictado."]);
                }
                setApptVoiceDisambig(res.disambiguation ?? null);
              }}
            />

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-semibold text-on-surface">Obra</span>
                <button
                  type="button"
                  data-testid="calendar-quick-job-toggle"
                  onClick={() => setQuickCreateJob((v) => !v)}
                  className="text-[11px] font-semibold text-on-primary-container underline cursor-pointer"
                >
                  {quickCreateJob ? "Elegir obra existente" : "+ Crear obra rápida"}
                </button>
              </div>
              {quickCreateJob ? (
                <input
                  type="text"
                  data-testid="calendar-quick-job-title"
                  maxLength={TEXT_LIMITS.TITLE}
                  value={quickJobTitle}
                  onChange={(e) => setQuickJobTitle(e.target.value)}
                  placeholder="Título del trabajo rápido (ej. Cambio de grifo)"
                  className="min-h-[44px] rounded-xl bg-surface-container-low border border-outline-variant px-3 text-[13px]"
                />
              ) : (
                <select
                  value={newJobId}
                  onChange={(e) => setNewJobId(e.target.value)}
                  className="min-h-[44px] rounded-xl bg-surface-container-low border border-outline-variant px-3 text-[13px]"
                >
                  <option value="">Sin obra específica (visita puntual)</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.job_code} · {j.title}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {newModalMode === "same_day" ? (
              <>
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold text-on-surface">Fecha</span>
                  <input
                    type="date"
                    data-testid="calendar-modal-date-input"
                    value={newDate}
                    onChange={(e) => {
                      setNewDate(e.target.value);
                      setNewEndDate(e.target.value);
                    }}
                    className="min-h-[44px] rounded-xl bg-surface-container-low border border-outline-variant px-3 font-mono text-[13px]"
                  />
                </label>

                <SubDayDurationPicker
                  startTime={newStart}
                  endTime={newEnd}
                  defaults={scheduleDefaults}
                  disabled={busy}
                  onChange={(next) => {
                    setNewStart(next.startTime);
                    setNewEnd(next.endTime);
                    setNewDurationThousandths(next.hoursThousandths);
                  }}
                />
              </>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[12px] font-semibold text-on-surface">Inicio</span>
                    <input
                      type="date"
                      value={newDate}
                      onChange={(e) => {
                        const next = e.target.value;
                        setNewDate(next);
                        if (!newEndDate || newEndDate < next) {
                          setNewEndDate(next);
                        }
                      }}
                      className="min-h-[44px] rounded-xl bg-surface-container-low border border-outline-variant px-2.5 font-mono text-[13px]"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[12px] font-semibold text-on-surface">Fin</span>
                    <input
                      type="date"
                      value={newEndDate}
                      onChange={(e) => setNewEndDate(e.target.value)}
                      className="min-h-[44px] rounded-xl bg-surface-container-low border border-outline-variant px-2.5 font-mono text-[13px]"
                    />
                  </label>
                </div>
                <div className="rounded-xl border border-outline-variant bg-terracotta-soft px-3 py-2 text-[11px] font-medium text-on-primary-container">
                  Se generarán las jornadas laborables según tu horario habitual ({scheduleDefaults.morning_start}–{scheduleDefaults.afternoon_end || scheduleDefaults.morning_end}).
                </div>
              </div>
            )}

            <div className="flex flex-col gap-1">
              <label htmlFor="cal-new-notes" className="text-[12px] font-semibold text-on-surface">
                Nota rápida
              </label>
              <ZoomableTextField
                id="cal-new-notes"
                as="input"
                multiline={false}
                maxLength={TEXT_LIMITS.NOTES}
                zoomLabel="Nota de la cita"
                value={newNotes}
                onValueChange={setNewNotes}
                placeholder="Ej. Visita medición o entrega de llaves"
                className="min-h-[44px] rounded-xl bg-surface-container-low border border-outline-variant px-3 text-[13px]"
              />
            </div>

            <button
              type="submit"
              data-testid="calendar-modal-submit-btn"
              disabled={busy}
              className="min-h-[48px] rounded-xl bg-primary text-white font-semibold text-[14px] disabled:opacity-50 cursor-pointer"
            >
              Guardar en calendario
            </button>
          </form>
        </div>
      )}

      <ConfirmDeleteDialog
        open={Boolean(deleteEntryTarget)}
        title="Eliminar cita del calendario"
        description={
          deleteEntryTarget
            ? `¿Seguro que quieres quitar del calendario la cita del ${deleteEntryTarget.date_iso} (${deleteEntryTarget.planned_start}–${deleteEntryTarget.planned_end})?`
            : ""
        }
        confirmLabel="Eliminar cita"
        busy={deleteEntryBusy}
        errorMsg={deleteEntryError}
        onCancel={() => {
          if (!deleteEntryBusy) {
            setDeleteEntryTarget(null);
            setDeleteEntryError(null);
          }
        }}
        onConfirm={() => void handleConfirmDeleteEntry()}
      />
    </div>
  );
}
