import React, { useMemo, useState } from 'react';
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Plus,
  X,
} from 'lucide-react';
import { TODAY_ISO, useAppStore } from '../../services/mockStore';
import {
  formatDateRange,
  formatEuros,
  formatFullDayLabel,
  formatHours,
  formatMonthYear,
  formatShortDate,
  formatSignedEuros,
  formatSignedHours,
} from '../../utils/format';

type CalendarMode = 'month' | 'week' | 'jobs';

function buildMonthGrid(year: number, monthIndex: number): Array<{ dateIso: string; day: number; inMonth: boolean }> {
  const firstDay = new Date(year, monthIndex, 1);
  const startOffset = (firstDay.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const prevMonthDays = new Date(year, monthIndex, 0).getDate();

  const cells: Array<{ dateIso: string; day: number; inMonth: boolean }> = [];

  for (let i = startOffset - 1; i >= 0; i -= 1) {
    const d = prevMonthDays - i;
    const prevDate = new Date(year, monthIndex - 1, d);
    const iso = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ dateIso: iso, day: d, inMonth: false });
  }

  for (let d = 1; d <= daysInMonth; d += 1) {
    const iso = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ dateIso: iso, day: d, inMonth: true });
  }

  const remaining = (7 - (cells.length % 7)) % 7;
  for (let d = 1; d <= remaining; d += 1) {
    const nextDate = new Date(year, monthIndex + 1, d);
    const iso = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ dateIso: iso, day: d, inMonth: false });
  }

  return cells;
}

export function CalendarScheduleView() {
  const {
    state,
    openOverlay,
    addScheduleAppointment,
    getJobById,
    pushToast,
  } = useAppStore();

  const [viewMode, setViewMode] = useState<CalendarMode>('month');
  const [year, setYear] = useState(2026);
  const [monthIndex, setMonthIndex] = useState(10); // Noviembre = 10
  const [selectedDateIso, setSelectedDateIso] = useState(TODAY_ISO);

  // Modal Añadir cita
  const [showAddModal, setShowAddModal] = useState(false);
  const [newJobId, setNewJobId] = useState(state.jobs[0]?.id ?? '');
  const [newDate, setNewDate] = useState(TODAY_ISO);
  const [newStart, setNewStart] = useState('08:00');
  const [newEnd, setNewEnd] = useState('17:00');
  const [newNotes, setNewNotes] = useState('');

  const monthCells = useMemo(() => buildMonthGrid(year, monthIndex), [year, monthIndex]);

  // Visible cells: full month or week containing selectedDateIso
  const displayedCells = useMemo(() => {
    if (viewMode === 'month') {
      // Show weeks starting from row containing Nov 16 if in Nov 2026? Show full month neatly!
      return monthCells;
    }
    const idx = monthCells.findIndex((c) => c.dateIso === selectedDateIso);
    const rowStart = idx >= 0 ? Math.floor(idx / 7) * 7 : 0;
    return monthCells.slice(rowStart, rowStart + 7);
  }, [monthCells, viewMode, selectedDateIso]);

  const entriesByDate = useMemo(() => {
    const map = new Map<string, typeof state.scheduleEntries>();
    for (const entry of state.scheduleEntries) {
      const list = map.get(entry.date_iso) ?? [];
      list.push(entry);
      map.set(entry.date_iso, list);
    }
    return map;
  }, [state.scheduleEntries]);

  const selectedEntries = entriesByDate.get(selectedDateIso) ?? [];
  const primaryDayEntry = selectedEntries[0];
  const primaryDayJob = primaryDayEntry ? getJobById(primaryDayEntry.job_id) : undefined;

  // Highlighted job range (active job with dates covering selected date or OBR-2026-001)
  const highlightedJob = useMemo(() => {
    if (primaryDayJob && primaryDayJob.start_date_iso && primaryDayJob.end_date_iso) {
      return primaryDayJob;
    }
    return (
      state.jobs.find((j) => j.id === 'job-001') ??
      state.jobs.find((j) => j.start_date_iso && j.end_date_iso)
    );
  }, [primaryDayJob, state.jobs]);

  // Deviation chart stats per job
  const jobHourStats = useMemo(() => {
    return state.jobs
      .filter((j) => j.status === 'en_curso' || state.scheduleEntries.some((e) => e.job_id === j.id))
      .map((job) => {
        const jobEntries = state.scheduleEntries.filter((e) => e.job_id === job.id);
        const plannedHours =
          jobEntries.reduce((s, e) => s + e.planned_hours, 0) || job.estimated_hours || 8;
        const actualLoggedHours = jobEntries.reduce(
          (s, e) => s + (e.actual_hours ?? 0),
          0,
        );
        const loggedPlannedHours = jobEntries
          .filter((e) => e.actual_hours !== undefined)
          .reduce((s, e) => s + e.planned_hours, 0);
        const deviationHours = Math.round((actualLoggedHours - loggedPlannedHours) * 10) / 10;
        const impactCents = Math.round(deviationHours * state.settings.hourly_rate_cents);
        return {
          job,
          plannedHours,
          actualLoggedHours,
          deviationHours,
          impactCents,
          daysCount: jobEntries.length,
        };
      });
  }, [state.jobs, state.scheduleEntries, state.settings.hourly_rate_cents]);

  const changeMonth = (delta: number) => {
    const dt = new Date(year, monthIndex + delta, 1);
    setYear(dt.getFullYear());
    setMonthIndex(dt.getMonth());
  };

  const handleSaveAppointment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newJobId || !newDate) return;
    addScheduleAppointment(newJobId, newDate, newStart, newEnd, newNotes);
    setSelectedDateIso(newDate);
    setShowAddModal(false);
    setNewNotes('');
  };

  return (
    <main className="px-4 pt-4 pb-8 flex flex-col gap-4">
      {/* Cabecera del módulo: Mes y + Añadir cita */}
      <section className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => changeMonth(-1)}
              aria-label="Mes anterior"
              className="w-9 h-9 rounded-full bg-surface-container-lowest border border-outline-variant inline-flex items-center justify-center text-on-surface cursor-pointer hover:border-terracotta"
            >
              <ChevronLeft className="w-[18px] h-[18px]" />
            </button>
            <h2 className="text-[17px] font-semibold text-on-surface px-1 min-w-[136px] text-center">
              {formatMonthYear(year, monthIndex)}
            </h2>
            <button
              type="button"
              onClick={() => changeMonth(1)}
              aria-label="Mes siguiente"
              className="w-9 h-9 rounded-full bg-surface-container-lowest border border-outline-variant inline-flex items-center justify-center text-on-surface cursor-pointer hover:border-terracotta"
            >
              <ChevronRight className="w-[18px] h-[18px]" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              setNewDate(selectedDateIso);
              setShowAddModal(true);
            }}
            className="min-h-[40px] px-3 rounded-full bg-secondary text-on-secondary font-semibold text-[12px] inline-flex items-center gap-1 shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Añadir cita</span>
          </button>
        </div>

        {/* Toggle Mes | Semana | Lista obras */}
        <div className="grid grid-cols-3 gap-1 bg-surface-container-lowest border border-outline-variant rounded-full p-1">
          {(
            [
              { id: 'month', label: 'Mes' },
              { id: 'week', label: 'Semana' },
              { id: 'jobs', label: 'Lista obras' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setViewMode(tab.id)}
              aria-pressed={viewMode === tab.id}
              className={`min-h-[36px] rounded-full font-semibold text-[12px] cursor-pointer transition-colors ${
                viewMode === tab.id
                  ? 'bg-terracotta-soft text-on-primary-container'
                  : 'text-on-surface-variant hover:bg-surface-container'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {/* Vista de Calendario Visual (Mes o Semana) */}
      {viewMode !== 'jobs' ? (
        <section className="bg-surface-container-lowest border border-outline-variant rounded-[20px] p-3 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col gap-2">
          <div className="grid grid-cols-7 text-center pb-1 border-b border-outline-variant">
            {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d, idx) => (
              <span
                key={d}
                className={`text-[11px] font-semibold ${
                  idx >= 5 ? 'text-outline' : 'text-on-surface-variant'
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

              const statusDotColor = dayEntries.some((e) => e.status === 'alargado')
                ? 'bg-amber-tax'
                : dayEntries.some((e) => e.status === 'antes')
                  ? 'bg-info'
                  : dayEntries.some((e) => e.status === 'en_hora')
                    ? 'bg-emerald-free'
                    : dayEntries.length > 0
                      ? 'bg-terracotta'
                      : '';

              return (
                <button
                  key={cell.dateIso}
                  type="button"
                  onClick={() => setSelectedDateIso(cell.dateIso)}
                  className={`min-h-[42px] py-1 flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-terracotta text-white rounded-xl shadow-xs'
                      : inHighlightRange
                        ? `bg-terracotta-soft text-on-primary-container ${
                            isRangeStart ? 'rounded-l-xl' : ''
                          } ${isRangeEnd ? 'rounded-r-xl' : ''}`
                        : cell.inMonth
                          ? 'text-on-surface hover:bg-surface-container-low rounded-lg'
                          : 'text-outline/60'
                  }`}
                >
                  <span className="font-mono text-[12px] font-semibold tabular-nums">
                    {cell.day}
                  </span>
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      statusDotColor
                        ? isSelected
                          ? 'bg-white'
                          : statusDotColor
                        : 'opacity-0'
                    }`}
                  />
                </button>
              );
            })}
          </div>

          {/* Rango activo + Leyenda */}
          <div className="pt-2 border-t border-outline-variant flex flex-col gap-1.5">
            {highlightedJob && (
              <div className="flex items-center gap-1.5 bg-terracotta-soft px-2.5 py-1 rounded-lg">
                <span className="w-2 h-2 rounded-full bg-terracotta shrink-0" />
                <span className="text-[11px] font-semibold text-on-primary-container truncate">
                  {formatDateRange(highlightedJob.start_date_iso, highlightedJob.end_date_iso)} ·{' '}
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
        /* Vista Lista de obras por fechas */
        <section className="flex flex-col gap-2.5">
          {state.jobs
            .filter((j) => j.start_date_iso)
            .map((job) => {
              const count = state.scheduleEntries.filter((e) => e.job_id === job.id).length;
              return (
                <button
                  key={job.id}
                  type="button"
                  onClick={() => {
                    if (job.start_date_iso) setSelectedDateIso(job.start_date_iso);
                    setViewMode('month');
                  }}
                  className="bg-surface-warm-card border border-outline-variant rounded-2xl p-3.5 text-left flex items-center justify-between gap-2 hover:border-terracotta cursor-pointer"
                >
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="font-mono text-[11px] text-on-primary-container font-semibold">
                      {formatDateRange(job.start_date_iso, job.end_date_iso)} · {job.job_code}
                    </span>
                    <span className="text-[15px] font-semibold text-on-surface truncate">
                      {job.title}
                    </span>
                    <span className="text-[12px] text-on-surface-variant truncate">
                      {job.address}
                    </span>
                  </div>
                  <span className="font-mono text-[12px] font-semibold text-on-surface bg-surface-container-lowest px-2.5 py-1 rounded-full border border-outline-variant shrink-0">
                    {count} días
                  </span>
                </button>
              );
            })}
        </section>
      )}

      {/* Tarjeta de Agenda del Día Seleccionado */}
      <section className="bg-surface-container-lowest border border-outline-variant rounded-[20px] p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col min-w-0">
            <span className="text-[12px] font-semibold text-on-primary-container">
              {formatFullDayLabel(selectedDateIso)}
              {selectedDateIso === TODAY_ISO ? ' · Hoy' : ''}
            </span>
            <h3 className="text-[17px] font-semibold text-on-surface truncate">
              {primaryDayJob?.title ?? 'Día libre sin obra asignada'}
            </h3>
          </div>
          {primaryDayJob && (
            <span className="font-mono text-[11px] text-on-surface-variant bg-surface-container px-2 py-1 rounded-lg tabular-nums shrink-0">
              {primaryDayJob.job_code}
            </span>
          )}
        </div>

        {primaryDayEntry && primaryDayJob ? (
          <>
            <div className="flex flex-col gap-2 bg-surface-container-low rounded-2xl p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-on-surface-variant" />
                  <span className="font-mono text-[15px] font-semibold text-on-surface tabular-nums">
                    {primaryDayEntry.planned_start} –{' '}
                    {primaryDayEntry.actual_end ?? primaryDayEntry.planned_end}
                  </span>
                </div>
                <span
                  className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${
                    primaryDayEntry.status === 'alargado'
                      ? 'bg-warning-container text-on-warning-container'
                      : primaryDayEntry.status === 'antes'
                        ? 'bg-info-container text-on-info-container'
                        : 'bg-success-container text-on-success-container'
                  }`}
                >
                  {primaryDayEntry.actual_hours !== undefined
                    ? `${formatHours(primaryDayEntry.actual_hours)} reales`
                    : `${formatHours(primaryDayEntry.planned_hours)} previstas`}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <MapPin className="w-4 h-4 text-on-surface-variant shrink-0" />
                  <span className="text-[13px] text-on-surface-variant truncate">
                    {primaryDayJob.address}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => pushToast(`Ruta lista hacia ${primaryDayJob.address}`, 'info')}
                  className="text-[12px] font-semibold text-on-primary-container shrink-0 cursor-pointer"
                >
                  Cómo llegar
                </button>
              </div>

              {primaryDayEntry.notes && (
                <p className="text-[12px] text-on-surface-variant pt-1 border-t border-outline-variant/60">
                  {primaryDayEntry.notes}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() =>
                openOverlay({
                  kind: 'schedule',
                  entryId: primaryDayEntry.id,
                  jobId: primaryDayJob.id,
                  dateIso: selectedDateIso,
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
              No hay jornadas programadas para el {formatShortDate(selectedDateIso)}.
            </p>
            <button
              type="button"
              onClick={() => {
                setNewDate(selectedDateIso);
                setShowAddModal(true);
              }}
              className="min-h-[44px] w-full rounded-xl bg-secondary text-white font-semibold text-[13px] flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Asignar una obra a este día</span>
            </button>
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
            {formatEuros(state.settings.hourly_rate_cents, false)}/h
          </span>
        </div>

        <div className="flex flex-col gap-3.5">
          {jobHourStats.map((stat, idx) => {
            const maxBar = Math.max(stat.plannedHours, stat.actualLoggedHours, 1);
            const plannedPct = Math.round((stat.plannedHours / maxBar) * 100);
            const actualPct = Math.round((stat.actualLoggedHours / maxBar) * 100);
            const isOver = stat.deviationHours > 0.05;
            const isEarly = stat.deviationHours < -0.05;

            return (
              <div
                key={stat.job.id}
                className={`flex flex-col gap-1.5 ${
                  idx > 0 ? 'pt-3 border-t border-outline-variant' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-on-surface truncate">
                    {stat.job.job_code} · {stat.job.title}
                  </span>
                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 tabular-nums ${
                      isOver
                        ? 'bg-warning-container text-on-warning-container'
                        : isEarly
                          ? 'bg-info-container text-on-info-container'
                          : 'bg-success-container text-on-success-container'
                    }`}
                  >
                    {isOver
                      ? `${formatSignedHours(stat.deviationHours)} (${formatSignedEuros(stat.impactCents)})`
                      : isEarly
                        ? `${formatSignedHours(stat.deviationHours)} (${formatSignedEuros(stat.impactCents)})`
                        : 'En plazo'}
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
                      {formatHours(stat.plannedHours)}
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
                            ? 'bg-amber-tax'
                            : isEarly
                              ? 'bg-info'
                              : 'bg-emerald-free'
                        }`}
                        style={{ width: `${actualPct}%` }}
                      />
                    </div>
                    <span
                      className={`font-mono text-[12px] tabular-nums w-14 text-right ${
                        isOver
                          ? 'text-on-warning-container'
                          : isEarly
                            ? 'text-on-info-container'
                            : 'text-on-success-container'
                      }`}
                    >
                      {formatHours(stat.actualLoggedHours)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Modal Añadir cita */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-secondary/45 flex items-end sm:items-center justify-center p-4">
          <form
            onSubmit={handleSaveAppointment}
            className="w-full max-w-[380px] bg-surface-container-lowest rounded-[24px] p-5 border border-outline-variant shadow-2xl flex flex-col gap-3.5"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[16px] font-semibold text-on-surface">Añadir cita en agenda</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="w-9 h-9 rounded-full hover:bg-surface-container flex items-center justify-center cursor-pointer"
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
                {state.jobs.map((j) => (
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
              className="min-h-[48px] rounded-xl bg-primary text-white font-semibold text-[14px] cursor-pointer"
            >
              Guardar en calendario
            </button>
          </form>
        </div>
      )}
    </main>
  );
}
