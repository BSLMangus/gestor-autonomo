import React from 'react';
import {
  ArrowRight,
  Bot,
  CalendarDays,
  ChevronRight,
  FileText,
  HardHat,
  PiggyBank,
  PlusCircle,
  ShieldCheck,
  Sparkles,
  Tag,
  Users,
} from 'lucide-react';
import { TODAY_ISO, useAppStore } from '../../services/mockStore';
import { formatEuros, getInitials } from '../../utils/format';

export function HomeHubView() {
  const {
    state,
    navigate,
    getFiscalSummary,
    getPendingProposalCount,
    getJobById,
    pushToast,
  } = useAppStore();

  const fiscal = getFiscalSummary('2026-T4');
  const pendingCount = getPendingProposalCount();

  const splitTotal = Math.max(1, fiscal.freeRealCents + fiscal.taxReserveCents);
  const freeRatio = Math.round((fiscal.freeRealCents / splitTotal) * 100);
  const taxRatio = 100 - freeRatio;

  const activeJobs = state.jobs.filter((j) => j.status === 'en_curso');
  const openQuotes = state.quotes.filter(
    (q) => q.status === 'borrador' || q.status === 'enviado',
  );
  const acceptedQuotes = state.quotes.filter(
    (q) => q.status === 'aceptado' || q.status === 'facturado',
  );

  // Today's schedule entry
  const todayEntry = state.scheduleEntries.find((e) => e.date_iso === TODAY_ISO);
  const todayJob = todayEntry ? getJobById(todayEntry.job_id) : activeJobs[0];

  // Current week hours (Nov 22–28)
  const weekEntries = state.scheduleEntries.filter(
    (e) => e.date_iso >= '2026-11-22' && e.date_iso <= '2026-11-28',
  );
  const weekPlanned = weekEntries.reduce((s, e) => s + e.planned_hours, 0) || 40;
  const weekLogged = weekEntries.reduce(
    (s, e) => s + (e.actual_hours ?? (e.status === 'previsto' ? 0 : e.planned_hours)),
    0,
  );
  const weekPct = Math.min(100, Math.round((weekLogged / Math.max(1, weekPlanned)) * 100));

  const firstName = state.settings.owner_name.split(' ')[0] || 'Carlos';

  return (
    <main className="px-4 pt-4 pb-8 flex flex-col gap-4">
      {/* Saludo e indicador offline */}
      <section className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[24px] leading-[30px] font-bold tracking-[-0.35px] text-on-surface">
            Hola, {firstName}
          </h2>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-container-lowest border border-outline-variant text-on-surface-variant shrink-0">
            <ShieldCheck className="w-3.5 h-3.5 text-on-success-container" aria-hidden="true" />
            <span className="text-[11px] font-semibold">100% Local · Sin nube</span>
          </span>
        </div>
        <p className="text-[14px] text-on-surface-variant">{state.settings.business_name}</p>
      </section>

      {/* Widget Héroe Financiero */}
      <section className="bg-surface-container-lowest border border-outline-variant rounded-[20px] p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-semibold text-on-surface-variant">
            Tu dinero hoy · 2026-T4
          </span>
          <button
            type="button"
            onClick={() => navigate('#/hucha')}
            className="text-[12px] font-semibold text-on-primary-container inline-flex items-center gap-0.5 cursor-pointer hover:underline"
          >
            <span>Ver detalle</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => navigate('#/hucha')}
            className="bg-success-container rounded-2xl p-3 flex flex-col gap-1 text-left cursor-pointer hover:opacity-95 transition-opacity"
          >
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-free" />
              <span className="text-[12px] font-semibold text-on-success-container">
                Libre real
              </span>
            </div>
            <p className="font-mono text-[19px] leading-[24px] font-bold text-on-success-container tabular-nums">
              {formatEuros(fiscal.freeRealCents)}
            </p>
            <span className="text-[11px] font-semibold text-on-success-container">
              Disponible
            </span>
          </button>

          <button
            type="button"
            onClick={() => navigate('#/hucha')}
            className="bg-warning-container rounded-2xl p-3 flex flex-col gap-1 text-left cursor-pointer hover:opacity-95 transition-opacity"
          >
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-tax" />
              <span className="text-[12px] font-semibold text-on-warning-container">
                Hacienda
              </span>
            </div>
            <p className="font-mono text-[19px] leading-[24px] font-bold text-on-warning-container tabular-nums">
              {formatEuros(fiscal.taxReserveCents)}
            </p>
            <span className="text-[11px] font-semibold text-on-warning-container">
              Intocable
            </span>
          </button>
        </div>

        {/* Barra visual de proporción */}
        <div className="flex flex-col gap-1">
          <div className="w-full h-3 rounded-full bg-surface-container overflow-hidden flex">
            <div
              className="h-full bg-emerald-free transition-all duration-300"
              style={{ width: `${freeRatio}%` }}
            />
            <div
              className="h-full bg-amber-tax border-l-2 border-surface-container-lowest transition-all duration-300"
              style={{ width: `${taxRatio}%` }}
            />
          </div>
          <div className="flex items-center justify-between font-mono text-[12px] text-on-surface-variant tabular-nums">
            <span>{freeRatio}% tuyo</span>
            <span>{taxRatio}% IVA + IRPF</span>
          </div>
        </div>
      </section>

      {/* Tarjeta Protagonista Asistente IA */}
      <button
        type="button"
        onClick={() => navigate('#/asistente')}
        className="w-full bg-terracotta-soft border border-outline-variant rounded-[20px] p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex items-center justify-between gap-3 text-left hover:border-terracotta transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-12 h-12 rounded-2xl bg-terracotta text-white flex items-center justify-center shrink-0">
            <Bot className="w-6 h-6" aria-hidden="true" />
          </div>
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-[16px] font-semibold text-on-surface">Asistente de Obra</h3>
              {pendingCount > 0 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary text-white font-semibold text-[11px]">
                  {pendingCount} por revisar
                </span>
              )}
            </div>
            <p className="text-[13px] leading-[18px] text-on-primary-container line-clamp-2">
              {pendingCount > 0
                ? 'Tienes propuestas preparadas tras tu último dictado de voz'
                : 'Listo para preparar presupuestos, partes o leer tickets'}
            </p>
          </div>
        </div>
        <ArrowRight className="w-5 h-5 text-on-primary-container shrink-0" />
      </button>

      {/* Grid Modular de Herramientas */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-[16px] font-semibold text-on-surface">Tus herramientas</h3>
          <span className="text-[12px] font-semibold text-on-surface-variant">
            7 módulos activos
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 items-stretch">
          {/* 0. Agenda y Calendario (ancho completo) */}
          <button
            type="button"
            onClick={() => navigate('#/calendario')}
            className="col-span-2 bg-surface-warm-card border border-outline-variant rounded-2xl p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col gap-2.5 text-left hover:border-terracotta transition-colors cursor-pointer"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-terracotta-soft text-on-primary-container flex items-center justify-center shrink-0">
                  <CalendarDays className="w-5 h-5" />
                </div>
                <div className="flex flex-col gap-0.5 min-w-0">
                  <h4 className="text-[15px] font-semibold text-on-surface">
                    Agenda y Calendario
                  </h4>
                  <p className="text-[13px] text-on-surface-variant truncate">
                    Hoy: {todayEntry ? `${todayEntry.planned_start}–${todayEntry.actual_end ?? todayEntry.planned_end}` : '08:00–17:00'} · {todayJob?.job_code ?? 'OBR-2026-001'}
                  </p>
                </div>
              </div>
              <span className="font-mono text-[12px] font-semibold text-on-success-container tabular-nums shrink-0">
                {weekLogged.toFixed(0)}/{weekPlanned.toFixed(0)} h
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-surface-container overflow-hidden">
                <div
                  className="h-full bg-emerald-free rounded-full transition-all duration-300"
                  style={{ width: `${weekPct}%` }}
                />
              </div>
              <span className="text-[11px] font-semibold text-on-surface-variant">
                Semana al {weekPct}%
              </span>
            </div>
          </button>

          {/* 1. Obras */}
          <button
            type="button"
            onClick={() => navigate('#/obras')}
            className="h-full bg-surface-warm-card border border-outline-variant rounded-2xl p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col justify-between gap-3 text-left hover:border-terracotta transition-colors cursor-pointer"
          >
            <div className="flex items-center justify-between w-full">
              <div className="w-10 h-10 rounded-xl bg-terracotta-soft text-on-primary-container flex items-center justify-center">
                <HardHat className="w-5 h-5" />
              </div>
              <span className="font-mono text-[12px] text-on-surface-variant tabular-nums">
                {activeJobs.length}/{state.jobs.length}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <h4 className="text-[15px] font-semibold text-on-surface">Obras</h4>
              <p className="text-[13px] text-on-surface-variant">
                {activeJobs.length} activas ahora
              </p>
            </div>
            <div className="w-full h-1.5 rounded-full bg-surface-container overflow-hidden">
              <div
                className="h-full bg-terracotta rounded-full"
                style={{
                  width: `${Math.round((activeJobs.length / Math.max(1, state.jobs.length)) * 100)}%`,
                }}
              />
            </div>
          </button>

          {/* 2. Presupuestos */}
          <button
            type="button"
            onClick={() => navigate('#/presupuestos')}
            className="h-full bg-surface-warm-card border border-outline-variant rounded-2xl p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col justify-between gap-3 text-left hover:border-terracotta transition-colors cursor-pointer"
          >
            <div className="flex items-center justify-between w-full">
              <div className="w-10 h-10 rounded-xl bg-success-container text-on-success-container flex items-center justify-center">
                <FileText className="w-5 h-5" />
              </div>
              <span className="font-mono text-[12px] text-on-success-container tabular-nums">
                {acceptedQuotes.length}/{state.quotes.length}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <h4 className="text-[15px] font-semibold text-on-surface">Presupuestos</h4>
              <p className="text-[13px] text-on-surface-variant">
                {openQuotes.length} abiertos · {acceptedQuotes.length} acept.
              </p>
            </div>
            <div className="w-full h-1.5 rounded-full bg-surface-container overflow-hidden">
              <div
                className="h-full bg-emerald-free rounded-full"
                style={{
                  width: `${Math.round((acceptedQuotes.length / Math.max(1, state.quotes.length)) * 100)}%`,
                }}
              />
            </div>
          </button>

          {/* 3. Clientes */}
          <button
            type="button"
            onClick={() => navigate('#/clientes')}
            className="h-full bg-surface-warm-card border border-outline-variant rounded-2xl p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col justify-between gap-3 text-left hover:border-terracotta transition-colors cursor-pointer"
          >
            <div className="flex items-center justify-between w-full">
              <div className="w-10 h-10 rounded-xl bg-secondary-container text-secondary flex items-center justify-center">
                <Users className="w-5 h-5" />
              </div>
              <span className="font-mono text-[12px] text-on-surface-variant tabular-nums">
                {state.clients.length}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <h4 className="text-[15px] font-semibold text-on-surface">Clientes</h4>
              <p className="text-[13px] text-on-surface-variant">
                {state.clients.length} fichas vinculadas
              </p>
            </div>
            <div className="flex items-center gap-1">
              {state.clients.slice(0, 3).map((c, idx) => (
                <span
                  key={c.id}
                  className={`w-6 h-6 rounded-full text-[10px] font-semibold inline-flex items-center justify-center ${
                    idx === 0
                      ? 'bg-secondary text-white'
                      : idx === 1
                        ? 'bg-terracotta-soft text-on-primary-container'
                        : 'bg-success-container text-on-success-container'
                  }`}
                >
                  {getInitials(c.name)}
                </span>
              ))}
            </div>
          </button>

          {/* 4. Hucha Fiscal */}
          <button
            type="button"
            onClick={() => navigate('#/hucha')}
            className="h-full bg-surface-warm-card border border-outline-variant rounded-2xl p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col justify-between gap-3 text-left hover:border-terracotta transition-colors cursor-pointer"
          >
            <div className="flex items-center justify-between w-full">
              <div className="w-10 h-10 rounded-xl bg-warning-container text-on-warning-container flex items-center justify-center">
                <PiggyBank className="w-5 h-5" />
              </div>
              <span className="font-mono text-[12px] text-on-warning-container tabular-nums">
                2026-T4
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <h4 className="text-[15px] font-semibold text-on-surface">Hucha Fiscal</h4>
              <p className="text-[13px] text-on-surface-variant">
                {fiscal.tickets.length} tickets deducibles
              </p>
            </div>
            <div className="w-full h-1.5 rounded-full bg-warning-container overflow-hidden">
              <div className="h-full bg-amber-tax rounded-full" style={{ width: '72%' }} />
            </div>
          </button>

          {/* 5. Tarifario */}
          <button
            type="button"
            onClick={() => navigate('#/tarifario')}
            className="h-full bg-surface-warm-card border border-outline-variant rounded-2xl p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col justify-between gap-3 text-left hover:border-terracotta transition-colors cursor-pointer"
          >
            <div className="flex items-center justify-between w-full">
              <div className="w-10 h-10 rounded-xl bg-surface-container text-on-surface flex items-center justify-center">
                <Tag className="w-5 h-5" />
              </div>
              <span className="font-mono text-[12px] text-on-surface tabular-nums">
                {formatEuros(state.settings.hourly_rate_cents, false)}/h
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <h4 className="text-[15px] font-semibold text-on-surface">Tarifario</h4>
              <p className="text-[13px] text-on-surface-variant">
                {state.pricingCatalog.length} partidas guardadas
              </p>
            </div>
            <span className="text-[11px] font-semibold text-on-surface-variant">
              Mano de obra vigente
            </span>
          </button>

          {/* 6. Actividad */}
          <button
            type="button"
            onClick={() => navigate('#/actividad')}
            className="h-full bg-surface-warm-card border border-outline-variant rounded-2xl p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col justify-between gap-3 text-left hover:border-terracotta transition-colors cursor-pointer"
          >
            <div className="flex items-center justify-between w-full">
              <div className="w-10 h-10 rounded-xl bg-terracotta-soft text-on-primary-container flex items-center justify-center">
                <Sparkles className="w-5 h-5" />
              </div>
              <span className="font-mono text-[12px] text-on-success-container tabular-nums">
                +{state.activities.length}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <h4 className="text-[15px] font-semibold text-on-surface">Actividad</h4>
              <p className="text-[13px] text-on-surface-variant">Precios aprendidos</p>
            </div>
            <span className="text-[11px] font-semibold text-on-surface-variant">
              {state.activities[0]?.timestamp_label ?? 'Reciente'}
            </span>
          </button>
        </div>

        {/* Espacio extensible */}
        <button
          type="button"
          onClick={() =>
            pushToast('Próximamente podrás activar Proveedores y Certificados de obra', 'info')
          }
          className="border border-dashed border-outline-variant rounded-2xl p-3 flex items-center gap-2 bg-surface-container-low text-left cursor-pointer hover:border-terracotta transition-colors"
        >
          <PlusCircle className="w-5 h-5 text-outline shrink-0" />
          <span className="text-[13px] text-on-surface-variant">
            Añadir herramienta (Partes de trabajo, Proveedores…)
          </span>
        </button>
      </section>
    </main>
  );
}
