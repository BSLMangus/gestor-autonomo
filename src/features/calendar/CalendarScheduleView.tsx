import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Plus,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  ActiveWidgetEnvelope,
  JobRow,
  JobScheduleDeviationSummary,
  ScheduleEntryRow,
  SqliteExecutor,
} from "../../core/contracts/types";
import { JobsRepository } from "../../core/db/repositories/jobsRepo";
import { ScheduleRepository } from "../../core/db/repositories/scheduleRepo";
import { SettingsRepository } from "../../core/db/repositories/settingsRepo";
import { getLocalTodayIso } from "../../core/fiscal/dateQuarter";
import { formatCentsEs } from "../../core/fiscal/fiscalEngine";

type CalendarMode = "month" | "week" | "jobs";

interface CalendarScheduleViewProps {
  executor: SqliteExecutor;
  refreshTick: number;
  initialFocusDateIso?: string;
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
  onOpenScheduleWidget,
  onDataChanged,
}: CalendarScheduleViewProps) {
  const todayIso = getLocalTodayIso();
  const initialDate = initialFocusDateIso ?? todayIso;
  const [initY, initM] = initialDate.split("-").map(Number);

  const [viewMode, setViewMode] = useState<CalendarMode>("month");
  const [year, setYear] = useState<number>(initY || 2026);
  const [monthIndex, setMonthIndex] = useState<number>((initM || 11) - 1);
  const [selectedDateIso, setSelectedDateIso] = useState<string>(initialDate);

  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [entries, setEntries] = useState<ScheduleEntryRow[]>([]);
  const [hourlyRateCents, setHourlyRateCents] = useState<number>(3800);
  const [jobSummaries, setJobSummaries] = useState<
    Array<{ job: JobRow; summary: JobScheduleDeviationSummary }>
  >([]);

  const [showAddModal, setShowAddModal] = useState(false);
  const [newJobId, setNewJobId] = useState("");
  const [newDate, setNewDate] = useState(initialDate);
  const [newStart, setNewStart] = useState("08:00");
  const [newEnd, setNewEnd] = useState("17:00");
  const [newNotes, setNewNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (initialFocusDateIso) {
      setSelectedDateIso(initialFocusDateIso);
      const [y, m] = initialFocusDateIso.split("-").map(Number);
      if (y && m) {
        setYear(y);
        setMonthIndex(m - 1);
      }
    }
  }, [initialFocusDateIso]);

  const loadCalendar = async () => {
    const jobsRepo = new JobsRepository(executor);
    const scheduleRepo = new ScheduleRepository(executor);
    const settingsRepo = new SettingsRepository(executor);

    const [allJobs, allEntries, settings, defaults] = await Promise.all([
      jobsRepo.listAll(),
      scheduleRepo.listAllEntries(),
      settingsRepo.getAppSettings(),
      scheduleRepo.getWorkScheduleDefaults(),
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
    setJobSummaries(summaries);
    setNewStart(defaults.morning_start);
    setNewEnd(defaults.afternoon_end || defaults.morning_end);
    if (!newJobId && activeJobs[0]) {
      setNewJobId(activeJobs[0].id);
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

  const changeMonth = (delta: number) => {
    const dt = new Date(year, monthIndex + delta, 1);
    setYear(dt.getFullYear());
    setMonthIndex(dt.getMonth());
  };

  const handleSaveAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDate) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      await new ScheduleRepository(executor).createSingleEntry({
        job_id: newJobId || null,
        date_iso: newDate,
        planned_start: newStart,
        planned_end: newEnd,
        notes: newNotes,
      });
      setSelectedDateIso(newDate);
      setNewNotes("");
      setShowAddModal(false);
      await loadCalendar();
      await onDataChanged();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
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

          <button
            type="button"
            data-testid="calendar-add-appointment-btn"
            onClick={() => {
              setNewDate(selectedDateIso);
              setShowAddModal(true);
            }}
            className="min-h-[42px] px-3.5 rounded-full bg-secondary text-on-secondary font-semibold text-[12px] inline-flex items-center gap-1 shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Añadir cita</span>
          </button>
        </div>

        {/* Toggle Mes | Semana | Lista obras */}
        <div className="grid grid-cols-3 gap-1 bg-surface-container-lowest border border-outline-variant rounded-full p-1">
          {(
            [
              { id: "month", label: "Mes" },
              { id: "week", label: "Semana" },
              { id: "jobs", label: "Lista obras" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
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
      {viewMode !== "jobs" ? (
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
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      statusDotColor
                        ? isSelected
                          ? "bg-white"
                          : statusDotColor
                        : "opacity-0"
                    }`}
                  />
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
            <div className="flex items-center justify-between pt-0.5 px-0.5">
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
            </div>
          </div>
        </section>
      ) : (
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
                const count = entries.filter((e) => e.job_id === job.id).length;
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
                      {count} días
                    </span>
                  </button>
                );
              })
          )}
        </section>
      )}

      {/* Tarjeta de Agenda del Día Seleccionado */}
      <section className="bg-surface-container-lowest border border-outline-variant rounded-[20px] p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col min-w-0">
            <span className="text-[12px] font-semibold text-on-primary-container">
              {formatFullDayLabelEs(selectedDateIso)}
              {selectedDateIso === todayIso ? " · Hoy" : ""}
            </span>
            <h3 className="text-[17px] font-semibold text-on-surface truncate">
              {primaryDayJob?.title ??
                (primaryDayEntry ? "Cita de agenda" : "Día libre sin obra asignada")}
            </h3>
          </div>
          {primaryDayJob && (
            <span className="font-mono text-[11px] text-on-surface-variant bg-surface-container px-2 py-1 rounded-lg tabular-nums shrink-0">
              {primaryDayJob.job_code}
            </span>
          )}
        </div>

        {primaryDayEntry ? (
          <>
            <div className="flex flex-col gap-2 bg-surface-container-low rounded-2xl p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-on-surface-variant" />
                  <span className="font-mono text-[15px] font-semibold text-on-surface tabular-nums">
                    {primaryDayEntry.planned_start} –{" "}
                    {primaryDayEntry.actual_end ?? primaryDayEntry.planned_end}
                  </span>
                </div>
                <span
                  className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${
                    primaryDayEntry.status === "alargado"
                      ? "bg-warning-container text-on-warning-container"
                      : primaryDayEntry.status === "antes"
                        ? "bg-info-container text-on-info-container"
                        : "bg-success-container text-on-success-container"
                  }`}
                >
                  {primaryDayEntry.actual_hours_thousandths !== null
                    ? `${formatHoursFromThousandths(primaryDayEntry.actual_hours_thousandths)} reales`
                    : `${formatHoursFromThousandths(primaryDayEntry.planned_hours_thousandths)} previstas`}
                </span>
              </div>

              {primaryDayJob?.address && (
                <div className="flex items-center gap-1.5 min-w-0 pt-1">
                  <MapPin className="w-4 h-4 text-on-surface-variant shrink-0" />
                  <span className="text-[13px] text-on-surface-variant truncate">
                    {primaryDayJob.address}
                  </span>
                </div>
              )}

              {primaryDayEntry.notes && (
                <p className="text-[12px] text-on-surface-variant pt-1 border-t border-outline-variant/60">
                  {primaryDayEntry.notes}
                </p>
              )}
            </div>

            <button
              type="button"
              data-testid="calendar-log-workday-btn"
              onClick={() =>
                onOpenScheduleWidget({
                  ui_widget_type: "ScheduleWorkLogWidget",
                  widget_payload: {
                    mode: "daily_log",
                    entry_id: primaryDayEntry.id,
                    job_id: primaryDayEntry.job_id,
                    date_iso: selectedDateIso,
                    suggested_reason: primaryDayEntry.deviation_reason,
                    suggested_notes: primaryDayEntry.notes,
                  },
                })
              }
              className="min-h-[48px] w-full px-4 rounded-xl bg-primary hover:bg-terracotta text-white font-semibold text-[14px] flex items-center justify-center gap-2 shadow-sm cursor-pointer"
            >
              <CalendarPlus className="w-[18px] h-[18px]" />
              <span>Registrar salida / Ajustar horas de hoy</span>
            </button>
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-on-surface-variant">
              No hay jornadas programadas para el {formatShortDateEs(selectedDateIso)}.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setNewDate(selectedDateIso);
                  setShowAddModal(true);
                }}
                className="min-h-[46px] rounded-xl bg-secondary text-white font-semibold text-[12px] flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Asignar obra</span>
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
            className="w-full max-w-[380px] bg-surface-container-lowest rounded-[24px] p-5 border border-outline-variant shadow-2xl flex flex-col gap-3.5"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[16px] font-semibold text-on-surface">Añadir cita en agenda</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="w-10 h-10 rounded-full hover:bg-surface-container flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold text-on-surface">Obra</span>
              <select
                value={newJobId}
                onChange={(e) => setNewJobId(e.target.value)}
                className="min-h-[44px] rounded-xl bg-surface-container-low border border-outline-variant px-3 text-[13px]"
              >
                <option value="">Sin obra específica</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.job_code} · {j.title}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold text-on-surface">Fecha</span>
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="min-h-[44px] rounded-xl bg-surface-container-low border border-outline-variant px-3 font-mono text-[13px]"
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold text-on-surface">Entrada</span>
                <input
                  type="time"
                  value={newStart}
                  onChange={(e) => setNewStart(e.target.value)}
                  className="min-h-[44px] rounded-xl bg-surface-container-low border border-outline-variant px-3 font-mono text-[13px]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold text-on-surface">Salida</span>
                <input
                  type="time"
                  value={newEnd}
                  onChange={(e) => setNewEnd(e.target.value)}
                  className="min-h-[44px] rounded-xl bg-surface-container-low border border-outline-variant px-3 font-mono text-[13px]"
                />
              </label>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold text-on-surface">Nota rápida</span>
              <input
                type="text"
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                placeholder="Ej. Visita medición o entrega de llaves"
                className="min-h-[44px] rounded-xl bg-surface-container-low border border-outline-variant px-3 text-[13px]"
              />
            </label>

            <button
              type="submit"
              disabled={busy}
              className="min-h-[48px] rounded-xl bg-primary text-white font-semibold text-[14px] disabled:opacity-50 cursor-pointer"
            >
              Guardar en calendario
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
