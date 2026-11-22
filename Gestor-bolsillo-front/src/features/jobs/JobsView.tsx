import React, { useMemo, useState } from 'react';
import { Building2, CalendarCheck2, X } from 'lucide-react';
import { useAppStore } from '../../services/mockStore';
import type { JobStatus } from '../../types/domain';
import {
  calculateDailyHoursFromDefaults,
  formatDateRange,
  formatEuros,
  formatSignedEuros,
  formatSignedHours,
  getIsoWeekday,
  listDatesInRange,
} from '../../utils/format';
import { JobDetailDrawer } from './JobDetailDrawer';

type JobFilter = 'en_curso' | 'todas' | 'finalizado' | 'pendiente';

export function JobsView() {
  const { state, createJob, getClientById, navigate } = useAppStore();

  const [filter, setFilter] = useState<JobFilter>('en_curso');
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Create form state
  const [clientId, setClientId] = useState(state.clients[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [address, setAddress] = useState('');
  const [status, setStatus] = useState<JobStatus>('en_curso');
  const [startDate, setStartDate] = useState('2026-11-24');
  const [endDate, setEndDate] = useState('2026-11-30');

  const counts = useMemo(
    () => ({
      en_curso: state.jobs.filter((j) => j.status === 'en_curso').length,
      todas: state.jobs.length,
      finalizado: state.jobs.filter((j) => j.status === 'finalizado').length,
      pendiente: state.jobs.filter((j) => j.status === 'pendiente').length,
    }),
    [state.jobs],
  );

  const filteredJobs = useMemo(() => {
    if (filter === 'todas') return state.jobs;
    return state.jobs.filter((j) => j.status === filter);
  }, [state.jobs, filter]);

  // Preview of auto-generated calendar work days
  const plannedPreview = useMemo(() => {
    if (!startDate || !endDate || !state.workScheduleDefaults.auto_apply_to_jobs) {
      return { days: 0, hours: 0 };
    }
    const dates = listDatesInRange(startDate, endDate).filter((iso) =>
      state.workScheduleDefaults.work_days.includes(getIsoWeekday(iso)),
    );
    const daily = calculateDailyHoursFromDefaults(state.workScheduleDefaults);
    return {
      days: dates.length,
      hours: Math.round(dates.length * (daily.totalHours || 8) * 10) / 10,
    };
  }, [startDate, endDate, state.workScheduleDefaults]);

  const handleCreateJob = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const selectedClient = getClientById(clientId);
    const { job } = createJob({
      client_id: clientId || state.clients[0]?.id || '',
      title: title.trim(),
      address: address.trim() || selectedClient?.fiscal_address || 'Madrid',
      status,
      start_date_iso: startDate || undefined,
      end_date_iso: endDate || undefined,
    });
    setShowCreateModal(false);
    setTitle('');
    setAddress('');
    setSelectedJobId(job.id);
  };

  return (
    <div className="relative min-h-full">
      <main className="px-4 pt-4 pb-8 flex flex-col gap-4">
        {/* Filtros por estado */}
        <section className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {(
            [
              { id: 'en_curso', label: `En curso (${counts.en_curso})` },
              { id: 'todas', label: `Todas (${counts.todas})` },
              { id: 'finalizado', label: `Cerradas (${counts.finalizado})` },
              { id: 'pendiente', label: `Pendientes (${counts.pendiente})` },
            ] as const
          ).map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => setFilter(chip.id)}
              aria-pressed={filter === chip.id}
              className={`min-h-[40px] px-3.5 rounded-full font-semibold text-[12px] shrink-0 cursor-pointer transition-colors ${
                filter === chip.id
                  ? 'bg-secondary text-on-secondary'
                  : 'bg-surface-container-lowest border border-outline-variant text-on-surface-variant'
              }`}
            >
              {chip.label}
            </button>
          ))}
        </section>

        {/* Lista de obras */}
        <section className="flex flex-col gap-3">
          {filteredJobs.map((job) => {
            const client = getClientById(job.client_id);
            const entries = state.scheduleEntries.filter((e) => e.job_id === job.id);
            const plannedHours =
              entries.reduce((s, e) => s + e.planned_hours, 0) || job.estimated_hours || 16;
            const actualLogged = entries.reduce((s, e) => s + (e.actual_hours ?? 0), 0);
            const loggedPlanned = entries
              .filter((e) => e.actual_hours !== undefined)
              .reduce((s, e) => s + e.planned_hours, 0);
            const deviation = Math.round((actualLogged - loggedPlanned) * 10) / 10;
            const impactCents = Math.round(deviation * state.settings.hourly_rate_cents);

            const photosCount = state.jobPhotos.filter((p) => p.job_id === job.id).length;
            const diaryCount = state.jobDiaryEntries.filter((d) => d.job_id === job.id).length;
            const quote = state.quotes.find((q) => q.job_id === job.id);
            const invoiceSum = state.invoices
              .filter((i) => i.job_id === job.id)
              .reduce((s, i) => s + i.total_cents, 0);
            const displayAmount = quote?.total_cents ?? invoiceSum;

            const pct = Math.min(100, Math.round((actualLogged / Math.max(1, plannedHours)) * 100));
            const isOver = deviation > 0.05;

            return (
              <button
                key={job.id}
                type="button"
                onClick={() => setSelectedJobId(job.id)}
                className="w-full text-left bg-surface-warm-card border border-outline-variant rounded-[20px] p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col gap-3 hover:border-terracotta transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[12px] text-on-surface-variant tabular-nums">
                    {job.job_code}
                  </span>
                  <span
                    className={`px-2.5 py-0.5 rounded-full font-semibold text-[11px] tabular-nums ${
                      isOver
                        ? 'bg-warning-container text-on-warning-container'
                        : job.status === 'finalizado'
                          ? 'bg-surface-container text-on-surface-variant'
                          : 'bg-success-container text-on-success-container'
                    }`}
                  >
                    {isOver
                      ? `${formatSignedHours(deviation)} extra (${formatSignedEuros(impactCents)})`
                      : job.status === 'finalizado'
                        ? 'Finalizada'
                        : job.status === 'pendiente'
                          ? 'Pendiente'
                          : 'En plazo'}
                  </span>
                </div>

                <div className="flex flex-col gap-0.5">
                  <h2 className="text-[16px] font-semibold text-on-surface">{job.title}</h2>
                  <p className="text-[13px] text-on-surface-variant">
                    {client?.name ? `${client.name} · ` : ''}
                    {job.address}
                    {job.start_date_iso ? ` · ${formatDateRange(job.start_date_iso, job.end_date_iso)}` : ''}
                  </p>
                </div>

                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-on-surface-variant">
                      {isOver ? 'Horas reales vs previstas' : 'Jornadas y horas'}
                    </span>
                    <span
                      className={`font-mono text-[12px] tabular-nums ${
                        isOver ? 'text-on-warning-container font-semibold' : 'text-on-surface'
                      }`}
                    >
                      {actualLogged.toFixed(1).replace('.0', '').replace('.', ',')} /{' '}
                      {plannedHours.toFixed(0)} h
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-surface-container overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        isOver ? 'bg-amber-tax' : 'bg-emerald-free'
                      }`}
                      style={{ width: `${Math.max(8, pct)}%` }}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-outline-variant">
                  <span className="text-[11px] font-semibold text-on-surface-variant">
                    {diaryCount} partes · {photosCount} fotos
                  </span>
                  <span className="font-mono text-[15px] font-semibold text-on-surface tabular-nums">
                    {formatEuros(displayAmount)}
                  </span>
                </div>
              </button>
            );
          })}
        </section>

        {/* Botón nueva obra */}
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="min-h-[48px] w-full px-5 rounded-xl bg-primary hover:bg-terracotta text-white font-semibold text-[14px] flex items-center justify-center gap-2 shadow-sm cursor-pointer"
        >
          <Building2 className="w-5 h-5" />
          <span>Nueva obra</span>
        </button>
      </main>

      {/* Cajón lateral/fullscreen de detalle */}
      <JobDetailDrawer jobId={selectedJobId} onClose={() => setSelectedJobId(null)} />

      {/* Modal crear obra con autogeneración en calendario */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-secondary/45 flex items-end sm:items-center justify-center p-4">
          <form
            onSubmit={handleCreateJob}
            className="w-full max-w-[385px] bg-surface-container-lowest rounded-[24px] p-5 border border-outline-variant shadow-2xl flex flex-col gap-3.5 max-h-[85dvh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[16px] font-semibold text-on-surface">Nueva obra</h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="w-9 h-9 rounded-full hover:bg-surface-container flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold text-on-surface">Cliente</span>
              <select
                value={clientId}
                onChange={(e) => {
                  setClientId(e.target.value);
                  const cli = getClientById(e.target.value);
                  if (cli && !address) setAddress(cli.fiscal_address);
                }}
                className="min-h-[44px] rounded-xl bg-surface-container-low border border-outline-variant px-3 text-[13px]"
              >
                {state.clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold text-on-surface">Título de la obra</span>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ej. Reforma cocina integral"
                className="min-h-[44px] rounded-xl bg-surface-container-low border border-outline-variant px-3 text-[14px]"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold text-on-surface">Dirección de obra</span>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="C/ Serrano 45, 3º · Madrid"
                className="min-h-[44px] rounded-xl bg-surface-container-low border border-outline-variant px-3 text-[14px]"
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold text-on-surface">Inicio (opcional)</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="min-h-[44px] rounded-xl bg-surface-container-low border border-outline-variant px-2.5 font-mono text-[12px]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold text-on-surface">Fin (opcional)</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="min-h-[44px] rounded-xl bg-surface-container-low border border-outline-variant px-2.5 font-mono text-[12px]"
                />
              </label>
            </div>

            {plannedPreview.days > 0 && (
              <div className="bg-terracotta-soft border border-outline-variant rounded-xl p-3 flex items-start gap-2">
                <CalendarCheck2 className="w-4 h-4 text-on-primary-container shrink-0 mt-0.5" />
                <p className="text-[12px] text-on-primary-container">
                  Se generarán automáticamente <strong>{plannedPreview.days} jornadas</strong> (
                  <strong className="font-mono tabular-nums">{plannedPreview.hours} h</strong>) en
                  tu Calendario usando tu horario habitual.
                </p>
              </div>
            )}

            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold text-on-surface">Estado inicial</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as JobStatus)}
                className="min-h-[44px] rounded-xl bg-surface-container-low border border-outline-variant px-3 text-[13px]"
              >
                <option value="en_curso">En curso</option>
                <option value="pendiente">Pendiente</option>
              </select>
            </label>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => navigate('#/tarifario')}
                className="min-h-[44px] rounded-xl bg-surface-container text-on-surface font-semibold text-[12px] cursor-pointer"
              >
                Ajustar horario
              </button>
              <button
                type="submit"
                className="min-h-[44px] rounded-xl bg-primary text-white font-semibold text-[13px] cursor-pointer"
              >
                Crear obra
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
