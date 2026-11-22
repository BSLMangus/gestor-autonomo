import {
  ArrowRight,
  Bot,
  CalendarDays,
  ChevronRight,
  FileText,
  HardHat,
  PiggyBank,
  ShieldCheck,
  Sparkles,
  Tag,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { SqliteExecutor } from "../../core/contracts/types";
import { CatalogRepository } from "../../core/db/repositories/catalogRepo";
import { ChatRepository } from "../../core/db/repositories/chatRepo";
import { ClientsRepository } from "../../core/db/repositories/clientsRepo";
import { InvoicesRepository } from "../../core/db/repositories/invoicesRepo";
import { JobsRepository } from "../../core/db/repositories/jobsRepo";
import { QuotesRepository } from "../../core/db/repositories/quotesRepo";
import {
  computeDailyWorkHoursThousandths,
  getIsoWeekday,
  ScheduleRepository,
} from "../../core/db/repositories/scheduleRepo";
import { SettingsRepository } from "../../core/db/repositories/settingsRepo";
import { TicketsRepository } from "../../core/db/repositories/ticketsRepo";
import { TracesRepository } from "../../core/db/repositories/tracesRepo";
import { addDaysIso, deriveFiscalQuarter, getLocalTodayIso } from "../../core/fiscal/dateQuarter";
import { computePiggyBank, formatCentsEs } from "../../core/fiscal/fiscalEngine";
import type { AppRoute } from "../../core/navigation/routes";

interface HomeHubViewProps {
  executor: SqliteExecutor;
  refreshTick: number;
  onNavigate: (route: AppRoute) => void;
}

interface HomeMetrics {
  emitterName: string;
  hourlyRateCents: number;
  pendingConfirmationsCount: number;
  threadsCount: number;
  activeJobsCount: number;
  totalJobsCount: number;
  openQuotesCount: number;
  acceptedQuotesCount: number;
  totalQuotesCount: number;
  clientsCount: number;
  clientInitials: string[];
  catalogCount: number;
  quarterLabel: string;
  availableCashCents: number;
  untouchableTaxCents: number;
  ticketsCount: number;
  tracesCount: number;
  todayScheduleLabel: string;
  todayJobLabel: string;
  weekLoggedHours: number;
  weekPlannedHours: number;
  weekPct: number;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "CL";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

export function HomeHubView({ executor, refreshTick, onNavigate }: HomeHubViewProps) {
  const [metrics, setMetrics] = useState<HomeMetrics | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const todayIso = getLocalTodayIso();
      const quarter = deriveFiscalQuarter(todayIso);
      const weekday = getIsoWeekday(todayIso);
      const weekStartIso = addDaysIso(todayIso, -(weekday - 1));
      const weekEndIso = addDaysIso(weekStartIso, 6);

      const scheduleRepo = new ScheduleRepository(executor);
      const [
        settings,
        threads,
        jobs,
        quotesRes,
        clientsRes,
        catalogRes,
        invoices,
        tickets,
        traces,
        scheduleDefaults,
        weekEntries,
      ] = await Promise.all([
        new SettingsRepository(executor).getAppSettings(),
        new ChatRepository(executor).listThreads(),
        new JobsRepository(executor).listAll(),
        new QuotesRepository(executor).listPaginated({ limit: 100, offset: 0 }),
        new ClientsRepository(executor).listPaginated({ limit: 5, offset: 0 }),
        new CatalogRepository(executor).listPaginated({ limit: 1, offset: 0 }),
        new InvoicesRepository(executor).listAllWithoutSync(),
        new TicketsRepository(executor).listAll(),
        new TracesRepository(executor).listTraces(undefined, 20),
        scheduleRepo.getWorkScheduleDefaults(),
        scheduleRepo.listEntriesByDateRange(weekStartIso, weekEndIso),
      ]);

      const fiscal = computePiggyBank({
        quarter,
        invoices,
        tickets,
        jobs,
        irpfRate: settings.irpf_reserve_rate,
      });

      const todayEntry = weekEntries.find((e) => e.date_iso === todayIso);
      const activeJob =
        (todayEntry?.job_id ? jobs.find((j) => j.id === todayEntry.job_id) : undefined) ??
        jobs.find((j) => j.status === "en_curso") ??
        jobs[0];

      const defaultDailyThousandths = computeDailyWorkHoursThousandths(scheduleDefaults);
      const fallbackWeekPlanned = Math.max(
        1,
        (scheduleDefaults.work_days.length * defaultDailyThousandths) / 1000
      );
      const weekPlannedThousandths = weekEntries.reduce(
        (s, e) => s + e.planned_hours_thousandths,
        0
      );
      const weekLoggedThousandths = weekEntries.reduce(
        (s, e) =>
          s +
          (e.actual_hours_thousandths ??
            (e.status === "previsto" ? 0 : e.planned_hours_thousandths)),
        0
      );
      const weekPlannedHours =
        weekPlannedThousandths > 0 ? weekPlannedThousandths / 1000 : fallbackWeekPlanned;
      const weekLoggedHours = weekLoggedThousandths / 1000;
      const weekPct = Math.min(
        100,
        Math.round((weekLoggedHours / Math.max(0.1, weekPlannedHours)) * 100)
      );

      if (!active) return;
      setMetrics({
        emitterName: settings.emitter_name.trim(),
        hourlyRateCents: settings.hourly_rate_cents,
        pendingConfirmationsCount: threads.filter((t) => t.status === "interrupted").length,
        threadsCount: threads.length,
        activeJobsCount: jobs.filter((j) => j.status === "pendiente" || j.status === "en_curso")
          .length,
        totalJobsCount: jobs.length,
        openQuotesCount: quotesRes.items.filter(
          (q) => q.status === "borrador" || q.status === "enviado"
        ).length,
        acceptedQuotesCount: quotesRes.items.filter((q) => q.status === "aceptado").length,
        totalQuotesCount: quotesRes.totalCount,
        clientsCount: clientsRes.totalCount,
        clientInitials: clientsRes.items.slice(0, 3).map((c) => getInitials(c.name)),
        catalogCount: catalogRes.totalCount,
        quarterLabel: quarter,
        availableCashCents: fiscal.available_cash_cents,
        untouchableTaxCents: fiscal.untouchable_tax_cents,
        ticketsCount: tickets.length,
        tracesCount: traces.length,
        todayScheduleLabel: todayEntry
          ? `${todayEntry.planned_start}–${todayEntry.actual_end ?? todayEntry.planned_end}`
          : `${scheduleDefaults.morning_start}–${scheduleDefaults.afternoon_end}`,
        todayJobLabel: activeJob ? `${activeJob.job_code}` : "Sin obra asignada",
        weekLoggedHours,
        weekPlannedHours,
        weekPct,
      });
    };
    void load();
    return () => {
      active = false;
    };
  }, [executor, refreshTick]);

  const freePositive = Math.max(0, metrics?.availableCashCents ?? 0);
  const taxPositive = Math.max(0, metrics?.untouchableTaxCents ?? 0);
  const splitTotal = Math.max(1, freePositive + taxPositive);
  const freeRatio = metrics ? Math.round((freePositive / splitTotal) * 100) : 70;
  const taxRatio = 100 - freeRatio;

  const firstName = metrics?.emitterName ? metrics.emitterName.split(/\s+/)[0] : "Autónomo";

  return (
    <div
      data-testid="home-hub-view"
      className="flex-1 overflow-y-auto no-scrollbar px-4 pt-2 pb-8 flex flex-col gap-4 bg-surface"
    >
      {/* Saludo e indicador offline */}
      <section className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[22px] leading-[28px] font-bold tracking-[-0.35px] text-on-surface truncate">
            Hola, {firstName}
          </h2>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-container-lowest border border-outline-variant text-on-surface-variant shrink-0">
            <ShieldCheck className="w-3.5 h-3.5 text-on-success-container" aria-hidden="true" />
            <span className="text-[11px] font-semibold">100% Local · Sin nube</span>
          </span>
        </div>
        <p className="text-[13px] text-on-surface-variant truncate">
          {metrics?.emitterName || "Tu taller y reformas al día"}
        </p>
      </section>

      {/* Widget Héroe Financiero */}
      <section className="bg-surface-container-lowest border border-outline-variant rounded-[20px] p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-semibold text-on-surface-variant">
            Tu dinero hoy · {metrics?.quarterLabel ?? "Trimestre"}
          </span>
          <button
            type="button"
            onClick={() => onNavigate({ name: "fiscal" })}
            className="text-[12px] font-semibold text-on-primary-container inline-flex items-center gap-0.5 cursor-pointer hover:underline"
          >
            <span>Ver detalle</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onNavigate({ name: "fiscal" })}
            className="bg-success-container rounded-2xl p-3 flex flex-col gap-1 text-left cursor-pointer hover:opacity-95 transition-opacity"
          >
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-free" />
              <span className="text-[12px] font-semibold text-on-success-container">
                Libre real
              </span>
            </div>
            <p className="font-mono text-[18px] leading-[24px] font-bold text-on-success-container tabular-nums">
              {metrics ? formatCentsEs(metrics.availableCashCents) : "—"}
            </p>
            <span className="text-[11px] font-semibold text-on-success-container">
              Disponible
            </span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate({ name: "fiscal" })}
            className="bg-warning-container rounded-2xl p-3 flex flex-col gap-1 text-left cursor-pointer hover:opacity-95 transition-opacity"
          >
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-tax" />
              <span className="text-[12px] font-semibold text-on-warning-container">
                Hacienda
              </span>
            </div>
            <p className="font-mono text-[18px] leading-[24px] font-bold text-on-warning-container tabular-nums">
              {metrics ? formatCentsEs(metrics.untouchableTaxCents) : "—"}
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
          <div className="flex items-center justify-between font-mono text-[11px] text-on-surface-variant tabular-nums">
            <span>{freeRatio}% tuyo</span>
            <span>{taxRatio}% IVA + IRPF</span>
          </div>
        </div>
      </section>

      {/* Tarjeta Protagonista Asistente IA */}
      <button
        type="button"
        data-testid="home-card-chat"
        onClick={() => onNavigate({ name: "chat" })}
        className="w-full bg-terracotta-soft border border-outline-variant rounded-[20px] p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex items-center justify-between gap-3 text-left hover:border-terracotta transition-colors active:scale-[0.99] cursor-pointer"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-12 h-12 rounded-2xl bg-terracotta text-white flex items-center justify-center shrink-0">
            <Bot className="w-6 h-6" aria-hidden="true" />
          </div>
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-[16px] font-semibold text-on-surface">Asistente de Obra</h3>
              {metrics && metrics.pendingConfirmationsCount > 0 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary text-white font-semibold text-[11px]">
                  {metrics.pendingConfirmationsCount} por revisar
                </span>
              )}
            </div>
            <p className="text-[13px] leading-[18px] text-on-primary-container line-clamp-2">
              {metrics && metrics.pendingConfirmationsCount > 0
                ? `${metrics.pendingConfirmationsCount} propuesta(s) esperando confirmación`
                : `${metrics?.threadsCount ?? 0} conversación(es) locales · Listo para voz o texto`}
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
            data-testid="home-card-calendar"
            onClick={() => onNavigate({ name: "calendar" })}
            className="col-span-2 bg-surface-warm-card border border-outline-variant rounded-2xl p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col gap-2.5 text-left hover:border-terracotta transition-colors active:scale-[0.99] cursor-pointer"
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
                    Hoy: {metrics?.todayScheduleLabel ?? "08:00–17:00"} ·{" "}
                    {metrics?.todayJobLabel ?? "Agenda local"}
                  </p>
                </div>
              </div>
              <span className="font-mono text-[12px] font-semibold text-on-success-container tabular-nums shrink-0">
                {metrics
                  ? `${metrics.weekLoggedHours.toFixed(0)}/${metrics.weekPlannedHours.toFixed(0)} h`
                  : "0/40 h"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-surface-container overflow-hidden">
                <div
                  className="h-full bg-emerald-free rounded-full transition-all duration-300"
                  style={{ width: `${metrics?.weekPct ?? 0}%` }}
                />
              </div>
              <span className="text-[11px] font-semibold text-on-surface-variant">
                Semana al {metrics?.weekPct ?? 0}%
              </span>
            </div>
          </button>

          {/* 1. Obras */}
          <button
            type="button"
            data-testid="home-card-jobs"
            onClick={() => onNavigate({ name: "jobs" })}
            className="h-full bg-surface-warm-card border border-outline-variant rounded-2xl p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col justify-between gap-3 text-left hover:border-terracotta transition-colors active:scale-[0.99] cursor-pointer"
          >
            <div className="flex items-center justify-between w-full">
              <div className="w-10 h-10 rounded-xl bg-terracotta-soft text-on-primary-container flex items-center justify-center">
                <HardHat className="w-5 h-5" />
              </div>
              <span className="font-mono text-[12px] text-on-surface-variant tabular-nums">
                {metrics?.activeJobsCount ?? 0}/{metrics?.totalJobsCount ?? 0}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <h4 className="text-[15px] font-semibold text-on-surface">Obras</h4>
              <p className="text-[13px] text-on-surface-variant">
                {metrics?.activeJobsCount ?? 0} activas · {metrics?.totalJobsCount ?? 0} total
              </p>
            </div>
            <div className="w-full h-1.5 rounded-full bg-surface-container overflow-hidden">
              <div
                className="h-full bg-terracotta rounded-full"
                style={{
                  width: `${Math.round(
                    ((metrics?.activeJobsCount ?? 0) / Math.max(1, metrics?.totalJobsCount ?? 1)) *
                      100
                  )}%`,
                }}
              />
            </div>
          </button>

          {/* 2. Presupuestos */}
          <button
            type="button"
            data-testid="home-card-quotes"
            onClick={() => onNavigate({ name: "quotes" })}
            className="h-full bg-surface-warm-card border border-outline-variant rounded-2xl p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col justify-between gap-3 text-left hover:border-terracotta transition-colors active:scale-[0.99] cursor-pointer"
          >
            <div className="flex items-center justify-between w-full">
              <div className="w-10 h-10 rounded-xl bg-success-container text-on-success-container flex items-center justify-center">
                <FileText className="w-5 h-5" />
              </div>
              <span className="font-mono text-[12px] text-on-success-container tabular-nums">
                {metrics?.acceptedQuotesCount ?? 0}/{metrics?.totalQuotesCount ?? 0}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <h4 className="text-[15px] font-semibold text-on-surface">Presupuestos</h4>
              <p className="text-[13px] text-on-surface-variant">
                {metrics?.openQuotesCount ?? 0} abiertos · {metrics?.totalQuotesCount ?? 0} total
              </p>
            </div>
            <div className="w-full h-1.5 rounded-full bg-surface-container overflow-hidden">
              <div
                className="h-full bg-emerald-free rounded-full"
                style={{
                  width: `${Math.round(
                    ((metrics?.acceptedQuotesCount ?? 0) /
                      Math.max(1, metrics?.totalQuotesCount ?? 1)) *
                      100
                  )}%`,
                }}
              />
            </div>
          </button>

          {/* 3. Clientes */}
          <button
            type="button"
            data-testid="home-card-clients"
            onClick={() => onNavigate({ name: "clients" })}
            className="h-full bg-surface-warm-card border border-outline-variant rounded-2xl p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col justify-between gap-3 text-left hover:border-terracotta transition-colors active:scale-[0.99] cursor-pointer"
          >
            <div className="flex items-center justify-between w-full">
              <div className="w-10 h-10 rounded-xl bg-secondary-container text-secondary flex items-center justify-center">
                <Users className="w-5 h-5" />
              </div>
              <span className="font-mono text-[12px] text-on-surface-variant tabular-nums">
                {metrics?.clientsCount ?? 0}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <h4 className="text-[15px] font-semibold text-on-surface">Clientes</h4>
              <p className="text-[13px] text-on-surface-variant">
                {metrics?.clientsCount ?? 0} fichas y obras
              </p>
            </div>
            <div className="flex items-center gap-1 min-h-6">
              {(metrics?.clientInitials ?? []).map((ini, idx) => (
                <span
                  key={`${ini}-${idx}`}
                  className={`w-6 h-6 rounded-full text-[10px] font-semibold inline-flex items-center justify-center ${
                    idx === 0
                      ? "bg-secondary text-white"
                      : idx === 1
                        ? "bg-terracotta-soft text-on-primary-container"
                        : "bg-success-container text-on-success-container"
                  }`}
                >
                  {ini}
                </span>
              ))}
            </div>
          </button>

          {/* 4. Hucha Fiscal */}
          <button
            type="button"
            data-testid="home-card-fiscal"
            onClick={() => onNavigate({ name: "fiscal" })}
            className="h-full bg-surface-warm-card border border-outline-variant rounded-2xl p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col justify-between gap-3 text-left hover:border-terracotta transition-colors active:scale-[0.99] cursor-pointer"
          >
            <div className="flex items-center justify-between w-full">
              <div className="w-10 h-10 rounded-xl bg-warning-container text-on-warning-container flex items-center justify-center">
                <PiggyBank className="w-5 h-5" />
              </div>
              <span className="font-mono text-[11px] text-on-warning-container tabular-nums">
                {metrics?.quarterLabel ?? "T4"}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <h4 className="text-[15px] font-semibold text-on-surface">Hucha Fiscal</h4>
              <p className="text-[13px] text-on-surface-variant">
                {metrics
                  ? `Reserva ${formatCentsEs(metrics.untouchableTaxCents)}`
                  : "Control IVA e IRPF"}
              </p>
            </div>
            <div className="w-full h-1.5 rounded-full bg-warning-container overflow-hidden">
              <div
                className="h-full bg-amber-tax rounded-full"
                style={{ width: `${Math.max(12, Math.min(100, taxRatio))}%` }}
              />
            </div>
          </button>

          {/* 5. Personalización y Tarifario */}
          <button
            type="button"
            data-testid="home-card-pricing"
            onClick={() => onNavigate({ name: "pricing" })}
            className="h-full bg-surface-warm-card border border-outline-variant rounded-2xl p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col justify-between gap-3 text-left hover:border-terracotta transition-colors active:scale-[0.99] cursor-pointer"
          >
            <div className="flex items-center justify-between w-full">
              <div className="w-10 h-10 rounded-xl bg-surface-container text-on-surface flex items-center justify-center">
                <Tag className="w-5 h-5" />
              </div>
              <span className="font-mono text-[12px] text-on-surface tabular-nums">
                {metrics ? `${formatCentsEs(metrics.hourlyRateCents)}/h` : "—"}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <h4 className="text-[15px] font-semibold text-on-surface">
                Personalización y Tarifario
              </h4>
              <p className="text-[13px] text-on-surface-variant">
                {metrics?.catalogCount ?? 0} partidas guardadas
              </p>
            </div>
            <span className="text-[11px] font-semibold text-on-surface-variant">
              Horario y mano de obra
            </span>
          </button>

          {/* 6. Actividad */}
          <button
            type="button"
            data-testid="home-card-activity"
            onClick={() => onNavigate({ name: "activity" })}
            className="h-full bg-surface-warm-card border border-outline-variant rounded-2xl p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col justify-between gap-3 text-left hover:border-terracotta transition-colors active:scale-[0.99] cursor-pointer"
          >
            <div className="flex items-center justify-between w-full">
              <div className="w-10 h-10 rounded-xl bg-terracotta-soft text-on-primary-container flex items-center justify-center">
                <Sparkles className="w-5 h-5" />
              </div>
              <span className="font-mono text-[12px] text-on-success-container tabular-nums">
                +{metrics?.tracesCount ?? 0}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <h4 className="text-[15px] font-semibold text-on-surface">Actividad</h4>
              <p className="text-[13px] text-on-surface-variant">
                {metrics?.tracesCount ?? 0} registros y aprendizaje
              </p>
            </div>
            <span className="text-[11px] font-semibold text-on-surface-variant">
              Auditoría on-device
            </span>
          </button>
        </div>
      </section>
    </div>
  );
}
