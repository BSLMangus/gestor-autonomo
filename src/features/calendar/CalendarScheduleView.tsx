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
  BillingModeConfig,
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
import {
  BillingModeSelector,
  createDefaultBillingModeConfig,
} from "../jobs/BillingModeSelector";
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
  const [quickBillingConfig, setQuickBillingConfig] = useState<BillingModeConfig>(() =>
    createDefaultBillingModeConfig(3800)
  );
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
          modalidad_cobro: quickBillingConfig.modalidad_cobro,
          solo_mano_obra_submodo: quickBillingConfig.solo_mano_obra_submodo,
          horas_estimadas_thousandths: quickBillingConfig.horas_estimadas_thousandths,
          tarifa_hora_cents: quickBillingConfig.tarifa_hora_cents,
          mano_obra_fija_cents: quickBillingConfig.mano_obra_fija_cents,
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
      setQuickBillingConfig(createDefaultBillingModeConfig(hourlyRateCents));
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
    setQuickBillingConfig(createDefaultBillingModeConfig(hourlyRateCents));
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
      className="cotton-paper flex flex-1 flex-col overflow-y-auto no-scrollbar px-4 pt-4 pb-8 gap-4 bg-[#F9F7F2] text-[#2C2621] font-sans"
    >
      {/* Cabecera del módulo: Mes y + Añadir cita */}
      <section className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2">
          {viewMode === "hacienda" ? (
            <div className="flex items-center gap-2 min-w-0">
              <span className="status-gold inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
                <Landmark className="w-4 h-4" />
              </span>
              <div className="min-w-0">
                <h2 className="text-[16px] font-semibold text-[#2C2621] truncate">
                  Calendario Fiscal AEAT
                </h2>
                <p className="text-[11px] text-[#6B6860] truncate">
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
                className="paper-cream w-10 h-10 rounded-full bg-[#FFFDF7] border border-[#E5DFD2] inline-flex items-center justify-center text-[#2C2621] cursor-pointer hover:border-[#EA580C] shadow-xs"
              >
                <ChevronLeft className="w-[18px] h-[18px]" />
              </button>
              <h2 className="text-[17px] font-semibold text-[#2C2621] px-1 min-w-[138px] text-center">
                {MONTH_NAMES_ES[monthIndex]} {year}
              </h2>
              <button
                type="button"
                onClick={() => changeMonth(1)}
                aria-label="Mes siguiente"
                className="paper-cream w-10 h-10 rounded-full bg-[#FFFDF7] border border-[#E5DFD2] inline-flex items-center justify-center text-[#2C2621] cursor-pointer hover:border-[#EA580C] shadow-xs"
              >
                <ChevronRight className="w-[18px] h-[18px]" />
              </button>
            </div>
          )}

          <button
            type="button"
            data-testid="calendar-add-appointment-btn"
            onClick={() => openAddModal(selectedDateIso)}
            className="min-h-[42px] px-3.5 rounded-full bg-[#4B7094] hover:bg-[#3d5d7c] text-[#FFFDF9] font-semibold text-[12px] inline-flex items-center gap-1 shrink-0 cursor-pointer shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>Añadir cita</span>
          </button>
        </div>

        {/* Toggle Mes | Semana | Lista obras | Hacienda */}
        <div className="paper-cream grid grid-cols-4 gap-1 bg-[#FFFDF7] border border-[#E5DFD2] rounded-full p-1 shadow-xs">
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
                  ? "bg-[#4B7094] text-[#FFFDF9]"
                  : "text-[#6B6860] hover:bg-[#EFECE4]"
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
          className="rounded-2xl border border-[#DC2626]/30 bg-[#FAD2D8] p-3 text-xs text-[#5A121C]"
        >
          {errorMsg}
        </div>
      )}

      {/* Vista de Calendario Visual (Mes o Semana) */}
      {(viewMode === "month" || viewMode === "week") && (
        <section className="relative paper-sheet paper-cream bg-[#FFFDF7] border border-[#E5DFD2] rounded-[20px] p-3.5 pt-5 flex flex-col gap-2 mt-1">
          <div className="absolute -top-2 left-6 right-6 flex justify-between pointer-events-none" aria-hidden="true">
            <span className="w-2.5 h-4 rounded-full border-2 border-[#6B6860] bg-[#F9F7F2]" />
            <span className="w-2.5 h-4 rounded-full border-2 border-[#6B6860] bg-[#F9F7F2]" />
            <span className="w-2.5 h-4 rounded-full border-2 border-[#6B6860] bg-[#F9F7F2]" />
            <span className="w-2.5 h-4 rounded-full border-2 border-[#6B6860] bg-[#F9F7F2]" />
            <span className="w-2.5 h-4 rounded-full border-2 border-[#6B6860] bg-[#F9F7F2]" />
            <span className="w-2.5 h-4 rounded-full border-2 border-[#6B6860] bg-[#F9F7F2]" />
            <span className="w-2.5 h-4 rounded-full border-2 border-[#6B6860] bg-[#F9F7F2]" />
          </div>

          <div className="grid grid-cols-7 text-center pb-1 border-b border-[#E5DFD2]">
            {["L", "M", "X", "J", "V", "S", "D"].map((d, idx) => (
              <span
                key={d}
                className={`text-[11px] font-semibold ${
                  idx >= 5 ? "text-[#6B6860]" : "text-[#6B6860]"
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
                ? "chart-tangerine"
                : dayEntries.some((e) => e.status === "antes")
                  ? "chart-cobalt"
                  : dayEntries.some((e) => e.status === "en_hora")
                    ? "chart-emerald"
                    : dayEntries.length > 0
                      ? "bg-[#EA580C]"
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
                    ? "chart-emerald"
                    : dayMilestones.some((m) => m.milestoneKind === "end")
                      ? "bg-[#DC2626]"
                      : "chart-gold";

              return (
                <button
                  key={cell.dateIso}
                  type="button"
                  data-testid={`calendar-day-${cell.dateIso}`}
                  onClick={() => setSelectedDateIso(cell.dateIso)}
                  className={`min-h-[44px] py-1 flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer ${
                    isSelected
                      ? "bg-[#EA580C] text-white rounded-xl shadow-xs"
                      : inHighlightRange
                        ? `bg-[#FFD6B0] text-[#4A2500] ${
                            isRangeStart ? "rounded-l-xl" : ""
                          } ${isRangeEnd ? "rounded-r-xl" : ""}`
                        : cell.inMonth
                          ? "text-[#2C2621] hover:bg-[#F5F1E6] rounded-lg"
                          : "text-[#6B6860]/55"
                  }`}
                >
                  <span className="font-mono font-mono-nums text-[12px] font-semibold tabular-nums">
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
                          isSelected ? "text-white" : "text-[#6B6860]"
                        }`}
                      >
                        ×{dayEntries.length}
                      </span>
                    )}
                    {taxDotColor && (
                      <span
                        aria-label="Hito fiscal AEAT"
                        className={`w-1.5 h-1.5 rounded-full ${
                          isSelected ? "bg-[#FFF3A1]" : taxDotColor
                        }`}
                      />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="pt-2 border-t border-[#E5DFD2] flex flex-col gap-1.5">
            {highlightedJob && (
              <div className="flex items-center gap-1.5 bg-[#FFD6B0] px-2.5 py-1 rounded-lg">
                <span className="w-2 h-2 rounded-full chart-tangerine shrink-0" />
                <span className="text-[11px] font-semibold text-[#4A2500] truncate">
                  {formatDateRangeEs(highlightedJob.start_date_iso, highlightedJob.end_date_iso)} ·{" "}
                  {highlightedJob.title}
                </span>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 pt-0.5 px-0.5">
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full chart-emerald" />
                <span className="text-[11px] font-semibold text-[#6B6860]">En hora</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full chart-tangerine" />
                <span className="text-[11px] font-semibold text-[#6B6860]">
                  Horas extra
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full chart-cobalt" />
                <span className="text-[11px] font-semibold text-[#6B6860]">
                  Antes de hora
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#DC2626]" />
                <span className="text-[11px] font-semibold text-[#6B6860]">
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
            <div className="paper-sheet rounded-[20px] border border-dashed border-[#E5DFD2] bg-[#FFFDF7] p-5 text-center text-[13px] text-[#6B6860]">
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
                    className="ruled-index border border-[#E5DFD2] rounded-2xl p-3.5 text-left flex items-center justify-between gap-2 hover:border-[#EA580C] cursor-pointer"
                  >
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="font-mono font-mono-nums text-[11px] text-[#D04B00] font-semibold tabular-nums">
                        {formatDateRangeEs(job.start_date_iso, job.end_date_iso)} · {job.job_code}
                      </span>
                      <span className="text-[15px] font-semibold text-[#2C2621] truncate">
                        {job.title}
                      </span>
                      {job.address && (
                        <span className="text-[12px] text-[#6B6860] truncate">
                          {job.address}
                        </span>
                      )}
                    </div>
                    <span className="font-mono font-mono-nums text-[12px] font-semibold text-[#2C2621] bg-[#F5F1E6] px-2.5 py-1 rounded-full border border-[#E5DFD2] shrink-0 tabular-nums">
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

          <div className="postit-note postit-yellow px-3.5 py-2.5 text-[11px] leading-relaxed text-[#3E3300]">
            Fechas orientativas para <strong>Territorio Común (AEAT)</strong>; festivos autonómicos
            o locales pueden trasladar vencimientos al siguiente día hábil.
          </div>

          {/* Control anual y filtros */}
          <div className="paper-sheet rounded-[20px] border border-[#E5DFD2] bg-[#FFFDF7] p-3.5 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Año anterior"
                  onClick={() => setHaciendaYear((y) => y - 1)}
                  className="w-9 h-9 rounded-full border border-[#E5DFD2] bg-[#FFFDF7] inline-flex items-center justify-center text-[#2C2621] hover:border-[#EA580C] cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="font-mono font-mono-nums text-sm font-bold px-2 tabular-nums text-[#2C2621]">
                  {haciendaYear}
                </span>
                <button
                  type="button"
                  aria-label="Año siguiente"
                  onClick={() => setHaciendaYear((y) => y + 1)}
                  className="w-9 h-9 rounded-full border border-[#E5DFD2] bg-[#FFFDF7] inline-flex items-center justify-center text-[#2C2621] hover:border-[#EA580C] cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center gap-1 rounded-full border border-[#E5DFD2] bg-[#F5F1E6] p-0.5">
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
                        ? "bg-[#4B7094] text-[#FFFDF9] shadow-xs"
                        : "text-[#6B6860]"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-bold text-[#2C2621]">
                  Modelos activos ({activeTaxModels.length}/13)
                </span>
                <span className="text-[10px] text-[#6B6860]">Pulsa para activar/desactivar</span>
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
                          ? "status-gold border-[#D97706]/50"
                          : "border-[#E5DFD2] bg-[#FFFDF7] text-[#6B6860] hover:bg-[#F5F1E6]"
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
            <div className="paper-sheet rounded-[20px] border border-dashed border-[#E5DFD2] bg-[#FFFDF7] p-5 text-center text-[13px] text-[#6B6860]">
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
                    className={`paper-sheet rounded-[18px] border p-3.5 ${
                      isPresented
                        ? "border-[#059669]/35 bg-[#D4EDDA]/35"
                        : isNotApplicable
                          ? "border-[#E5DFD2] bg-[#F5F1E6]/70 opacity-75"
                          : isOverdue
                            ? "border-[#DC2626]/35 bg-[#FAD2D8]/40"
                            : isOpenNow
                              ? "border-[#D97706]/40 bg-[#FFF3A1]/35"
                              : "border-[#E5DFD2] bg-[#FFFDF7]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded-full bg-[#4B7094] px-2 py-0.5 font-mono text-[10px] font-bold text-[#FFFDF9]">
                            {ob.meta.shortLabel}
                          </span>
                          <span className="rounded-full bg-[#EAE5D9] px-2 py-0.5 text-[10px] font-bold text-[#3D352E]">
                            {ob.periodLabel}
                          </span>
                          <span className="text-[10px] font-semibold text-[#6B6860]">
                            {ob.meta.category}
                          </span>
                        </div>
                        <h4 className="mt-1 text-[13px] font-bold text-[#2C2621]">
                          {ob.meta.title}
                        </h4>
                        <p className="mt-0.5 font-mono font-mono-nums text-[11px] text-[#6B6860] tabular-nums">
                          {ob.isSingleDueDate
                            ? `Vencimiento único: ${ob.endDateIso}`
                            : `Plazo: ${ob.startDateIso} → ${ob.endDateIso}`}
                          {ob.endDateIso !== ob.nominalEndDateIso
                            ? ` (trasladado desde ${ob.nominalEndDateIso})`
                            : ""}
                        </p>
                        {ob.debitCutoffIso && (
                          <p className="mt-0.5 text-[11px] font-semibold text-[#78350F]">
                            Domiciliación bancaria hasta {ob.debitCutoffIso}
                          </p>
                        )}
                      </div>

                      <span
                        className={`paper-stamp shrink-0 rounded-sm px-2 py-0.5 text-[10px] font-bold ${
                          isPresented
                            ? "status-emerald"
                            : isNotApplicable
                              ? "bg-[#EAE5D9] text-[#3D352E] border border-[#E5DFD2]"
                              : isOverdue
                                ? "status-tangerine"
                                : isOpenNow
                                  ? "status-gold"
                                  : "status-cobalt"
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

                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-dashed border-[#E5DFD2] pt-2">
                      <button
                        type="button"
                        disabled={isBusy || ob.status === "presentado"}
                        onClick={() => void handleSetObligationStatus(ob, "presentado")}
                        className="inline-flex items-center gap-1 rounded-lg bg-[#059669] px-2.5 py-1 text-[11px] font-bold text-white hover:bg-[#047857] disabled:opacity-45 cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Presentado
                      </button>
                      <button
                        type="button"
                        disabled={isBusy || ob.status === "pendiente"}
                        onClick={() => void handleSetObligationStatus(ob, "pendiente")}
                        className="inline-flex items-center gap-1 rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 py-1 text-[11px] font-semibold text-[#2C2621] hover:border-[#EA580C] disabled:opacity-45 cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Pendiente
                      </button>
                      <button
                        type="button"
                        disabled={isBusy || ob.status === "no_aplica"}
                        onClick={() => void handleSetObligationStatus(ob, "no_aplica")}
                        className="inline-flex items-center gap-1 rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 py-1 text-[11px] font-semibold text-[#6B6860] hover:border-[#EA580C] disabled:opacity-45 cursor-pointer"
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
      <section className="postit-note postit-yellow p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col min-w-0">
            <span className="text-[12px] font-semibold text-[#3E3300]">
              {formatFullDayLabelEs(selectedDateIso)}
              {selectedDateIso === effectiveTodayIso ? " · Hoy" : ""}
            </span>
            <h3 className="text-[17px] font-semibold text-[#2C2621] truncate">
              {selectedEntries.length > 1
                ? `${selectedEntries.length} trabajos / citas hoy`
                : primaryDayJob?.title ??
                  (primaryDayEntry ? "Cita de agenda" : "Día libre sin obra asignada")}
            </h3>
          </div>
          {selectedEntries.length <= 1 && primaryDayJob && (
            <span className="paper-cream font-mono font-mono-nums text-[11px] text-[#2C2621] bg-[#FFFDF7] border border-[#E5DFD2] px-2 py-1 rounded-lg tabular-nums shrink-0">
              {primaryDayJob.job_code}
            </span>
          )}
        </div>

        {selectedTaxMilestones.length > 0 && (
          <div className="rounded-2xl border border-[#E5DFD2] bg-[#FFFDF7]/85 p-2.5 flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#78350F]">
              <Landmark className="w-3.5 h-3.5 text-[#D97706]" />
              <span>Hitos Hacienda AEAT este día</span>
            </div>
            {selectedTaxMilestones.map((m) => (
              <div
                key={`${m.obligation.obligationKey}_${m.milestoneKind}`}
                className="flex items-center justify-between gap-2 rounded-xl bg-[#FFFDF7] px-2.5 py-1.5 border border-[#E5DFD2]"
              >
                <div className="min-w-0">
                  <span className="text-xs font-bold text-[#2C2621]">
                    {m.obligation.meta.shortLabel} ({m.obligation.periodLabel})
                  </span>
                  <span className="block text-[11px] text-[#6B6860]">
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
                    className="shrink-0 rounded-lg bg-[#059669] px-2 py-1 text-[10px] font-bold text-white hover:bg-[#047857] cursor-pointer"
                  >
                    Presentado
                  </button>
                ) : (
                  <span className="status-emerald shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold">
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
                  className="flex flex-col gap-2 bg-[#FFFDF7]/90 rounded-2xl p-3 border border-[#E5DFD2]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[13px] font-semibold text-[#2C2621] truncate">
                          {entryJob?.title ?? "Cita rápida / visita"}
                        </span>
                        {entryJob && (
                          <span className="font-mono text-[10px] text-[#6B6860] bg-[#F5F1E6] border border-[#E5DFD2] px-1.5 py-0.5 rounded-md tabular-nums">
                            {entryJob.job_code}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-[#6B6860]" />
                        <span className="font-mono font-mono-nums text-[14px] font-semibold text-[#2C2621] tabular-nums">
                          {dayEntry.planned_start} – {dayEntry.actual_end ?? dayEntry.planned_end}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span
                        className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${
                          dayEntry.status === "alargado"
                            ? "status-tangerine"
                            : dayEntry.status === "antes"
                              ? "status-cobalt"
                              : "status-emerald"
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
                        className="w-8 h-8 rounded-full border border-[#E5DFD2] bg-[#FFFDF7] text-[#DC2626] hover:bg-[#FAD2D8] inline-flex items-center justify-center cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {entryJob?.address && (
                    <div className="flex items-center gap-1.5 min-w-0">
                      <MapPin className="w-3.5 h-3.5 text-[#6B6860] shrink-0" />
                      <span className="text-[12px] text-[#6B6860] truncate">
                        {entryJob.address}
                      </span>
                    </div>
                  )}

                  {dayEntry.notes && (
                    <p className="text-[12px] text-[#6B6860] pt-1 border-t border-dashed border-[#E5DFD2]">
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
                    className="min-h-[42px] w-full px-3 rounded-xl bg-[#4B7094] hover:bg-[#3d5d7c] text-[#FFFDF9] font-semibold text-[13px] flex items-center justify-center gap-2 shadow-xs cursor-pointer"
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
              className="min-h-[42px] w-full rounded-xl border border-dashed border-[#6B6860]/50 bg-[#FFFDF7]/75 text-xs font-semibold text-[#2C2621] hover:border-[#EA580C] flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Añadir otro trabajo / visita este día</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-[#3E3300]">
              No hay jornadas programadas para el {formatShortDateEs(selectedDateIso)}.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => openAddModal(selectedDateIso)}
                className="min-h-[46px] rounded-xl bg-[#4B7094] text-[#FFFDF9] font-semibold text-[12px] flex items-center justify-center gap-1.5 cursor-pointer"
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
                className="min-h-[46px] rounded-xl bg-[#D04B00] hover:bg-[#EA580C] text-white font-semibold text-[12px] flex items-center justify-center gap-1.5 cursor-pointer"
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
      <section className="relative ruled-notebook border border-[#E5DFD2] rounded-[20px] p-4 pl-10 flex flex-col gap-3.5">
        <span className="absolute left-2.5 top-5 w-2.5 h-2.5 rounded-full paper-hole border" aria-hidden="true" />
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full paper-hole border" aria-hidden="true" />
        <span className="absolute left-2.5 bottom-5 w-2.5 h-2.5 rounded-full paper-hole border" aria-hidden="true" />
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-[#2C2621]">
            Plazos y horas: previsto vs real
          </h3>
          <span className="font-mono font-mono-nums text-[12px] text-[#6B6860] tabular-nums">
            {formatCentsEs(hourlyRateCents)}/h
          </span>
        </div>

        {jobSummaries.length === 0 ? (
          <p className="text-[13px] text-[#6B6860]">
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
                    idx > 0 ? "pt-3 border-t border-[#E5DFD2]" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-medium text-[#2C2621] truncate">
                      {job.job_code} · {job.title}
                    </span>
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 tabular-nums ${
                        isOver
                          ? "status-tangerine"
                          : isEarly
                            ? "status-cobalt"
                            : "status-emerald"
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
                      <span className="text-[11px] font-semibold text-[#6B6860] w-14">
                        Previsto
                      </span>
                      <div className="flex-1 h-2.5 rounded-full bg-[#EFECE4] border border-[#E5DFD2] overflow-hidden">
                        <div
                          className="h-full chart-cobalt rounded-full transition-all duration-300"
                          style={{ width: `${plannedPct}%` }}
                        />
                      </div>
                      <span className="font-mono font-mono-nums text-[12px] text-[#2C2621] tabular-nums w-14 text-right">
                        {formatHoursFromThousandths(summary.planned_hours_thousandths)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-[#6B6860] w-14">
                        Real
                      </span>
                      <div className="flex-1 h-2.5 rounded-full bg-[#EFECE4] border border-[#E5DFD2] overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            isOver
                              ? "chart-tangerine"
                              : isEarly
                                ? "chart-cobalt"
                                : "chart-emerald"
                          }`}
                          style={{ width: `${actualPct}%` }}
                        />
                      </div>
                      <span
                        className={`font-mono font-mono-nums text-[12px] tabular-nums w-14 text-right ${
                          isOver
                            ? "text-[#9A2D08]"
                            : isEarly
                              ? "text-[#1E3A8A]"
                              : "text-[#14532D]"
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
        <div className="fixed inset-0 z-50 bg-[#2C2621]/45 flex items-end sm:items-center justify-center p-4">
          <form
            onSubmit={(e) => void handleSaveAppointment(e)}
            className="clipboard-panel w-full max-w-[380px] max-h-[88vh] overflow-y-auto bg-[#FFFDF7] rounded-[24px] p-5 border border-[#DFD9CA] flex flex-col gap-3.5"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[16px] font-semibold text-[#2C2621]">Añadir cita o trabajo</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="w-10 h-10 rounded-full text-[#6B6860] hover:bg-[#EFECE4] flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1 bg-[#F5F1E6] border border-[#E5DFD2] rounded-full p-1">
              <button
                type="button"
                data-testid="calendar-modal-mode-sameday"
                onClick={() => setNewModalMode("same_day")}
                className={`min-h-[34px] rounded-full text-[11px] font-semibold cursor-pointer ${
                  newModalMode === "same_day"
                    ? "bg-[#4B7094] text-[#FFFDF9]"
                    : "text-[#6B6860]"
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
                    ? "bg-[#4B7094] text-[#FFFDF9]"
                    : "text-[#6B6860]"
                }`}
              >
                Varios días
              </button>
            </div>

            {errorMsg && (
              <div
                role="alert"
                className="rounded-xl border border-[#DC2626]/30 bg-[#FAD2D8] px-3 py-2 text-[12px] font-semibold text-[#5A121C]"
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
                <span className="text-[12px] font-semibold text-[#2C2621]">Obra</span>
                <button
                  type="button"
                  data-testid="calendar-quick-job-toggle"
                  onClick={() => setQuickCreateJob((v) => !v)}
                  className="text-[11px] font-semibold text-[#D04B00] underline cursor-pointer"
                >
                  {quickCreateJob ? "Elegir obra existente" : "+ Crear obra rápida"}
                </button>
              </div>
              {quickCreateJob ? (
                <div className="space-y-2.5">
                  <input
                    type="text"
                    data-testid="calendar-quick-job-title"
                    maxLength={TEXT_LIMITS.TITLE}
                    value={quickJobTitle}
                    onChange={(e) => setQuickJobTitle(e.target.value)}
                    placeholder="Título del trabajo rápido (ej. Cambio de grifo)"
                    className="min-h-[44px] w-full rounded-xl bg-[#FFFDF7] border border-[#E5DFD2] px-3 text-[13px] text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
                  />
                  <BillingModeSelector
                    compact
                    value={quickBillingConfig}
                    onChange={setQuickBillingConfig}
                    defaultHourlyRateCents={hourlyRateCents}
                    disabled={busy}
                  />
                </div>
              ) : (
                <select
                  value={newJobId}
                  onChange={(e) => setNewJobId(e.target.value)}
                  className="min-h-[44px] rounded-xl bg-[#FFFDF7] border border-[#E5DFD2] px-3 text-[13px] text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
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
                  <span className="text-[12px] font-semibold text-[#2C2621]">Fecha</span>
                  <input
                    type="date"
                    data-testid="calendar-modal-date-input"
                    value={newDate}
                    onChange={(e) => {
                      setNewDate(e.target.value);
                      setNewEndDate(e.target.value);
                    }}
                    className="min-h-[44px] rounded-xl bg-[#FFFDF7] border border-[#E5DFD2] px-3 font-mono tabular-nums text-[13px] text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
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
                    <span className="text-[12px] font-semibold text-[#2C2621]">Inicio</span>
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
                      className="min-h-[44px] rounded-xl bg-[#FFFDF7] border border-[#E5DFD2] px-2.5 font-mono tabular-nums text-[13px] text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[12px] font-semibold text-[#2C2621]">Fin</span>
                    <input
                      type="date"
                      value={newEndDate}
                      onChange={(e) => setNewEndDate(e.target.value)}
                      className="min-h-[44px] rounded-xl bg-[#FFFDF7] border border-[#E5DFD2] px-2.5 font-mono tabular-nums text-[13px] text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
                    />
                  </label>
                </div>
                <div className="rounded-xl border border-[#E5DFD2] bg-[#FFD6B0] px-3 py-2 text-[11px] font-medium text-[#4A2500]">
                  Se generarán las jornadas laborables según tu horario habitual ({scheduleDefaults.morning_start}–{scheduleDefaults.afternoon_end || scheduleDefaults.morning_end}).
                </div>
              </div>
            )}

            <div className="flex flex-col gap-1">
              <label htmlFor="cal-new-notes" className="text-[12px] font-semibold text-[#2C2621]">
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
                className="min-h-[44px] rounded-xl bg-[#FFFDF7] border border-[#E5DFD2] px-3 text-[13px] text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
              />
            </div>

            <button
              type="submit"
              data-testid="calendar-modal-submit-btn"
              disabled={busy}
              className="min-h-[48px] rounded-xl bg-[#D04B00] hover:bg-[#EA580C] text-white font-semibold text-[14px] disabled:opacity-50 cursor-pointer shadow-xs"
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
