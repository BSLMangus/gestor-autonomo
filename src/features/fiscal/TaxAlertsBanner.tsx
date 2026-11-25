import { AlertTriangle, Calendar, CheckCircle2, Landmark, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { SqliteExecutor } from "../../core/contracts/types";
import { SettingsRepository } from "../../core/db/repositories/settingsRepo";
import { TaxCalendarRepository } from "../../core/db/repositories/taxCalendarRepo";
import { getLocalTodayIso } from "../../core/fiscal/dateQuarter";
import {
  computeTaxAlertsForDate,
  DEFAULT_ACTIVE_TAX_MODELS,
  type TaxAlertItem,
  type TaxAlertUrgency,
} from "../../core/fiscal/taxCalendarEngine";

interface TaxAlertsBannerProps {
  executor: SqliteExecutor;
  refreshTick?: number;
  todayIso?: string;
  maxVisible?: number;
  onOpenTaxCalendar?: (focusDateIso?: string) => void;
  onTaxStateChanged?: () => void | Promise<void>;
}

function urgencyContainerClass(urgency: TaxAlertUrgency): string {
  switch (urgency) {
    case "critical":
      return "paper-sheet border-[#DC2626]/30 bg-[#FAD2D8]/55 text-[#5A121C]";
    case "warning":
      return "paper-sheet border-[#D97706]/35 bg-[#FFF3A1]/75 text-[#3E3300]";
    case "info":
    default:
      return "paper-sheet border-[#4B7094]/30 bg-[#CBE4F9]/65 text-[#143552]";
  }
}

function urgencyBadgeClass(urgency: TaxAlertUrgency): string {
  switch (urgency) {
    case "critical":
      return "status-tangerine";
    case "warning":
      return "status-mustard";
    case "info":
    default:
      return "status-cobalt";
  }
}

export function TaxAlertsBanner({
  executor,
  refreshTick = 0,
  todayIso,
  maxVisible = 3,
  onOpenTaxCalendar,
  onTaxStateChanged,
}: TaxAlertsBannerProps) {
  const effectiveTodayIso = todayIso ?? getLocalTodayIso();
  const [alerts, setAlerts] = useState<TaxAlertItem[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [localReloadTick, setLocalReloadTick] = useState(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const settingsRepo = new SettingsRepository(executor);
        const taxRepo = new TaxCalendarRepository(executor);
        const [settings, statesMap, dismissals] = await Promise.all([
          settingsRepo.getAppSettingsOrNull(),
          taxRepo.listAllStates(),
          taxRepo.listDismissedAlertKeys(),
        ]);
        if (!active) return;
        const activeModels = settings?.active_tax_models ?? DEFAULT_ACTIVE_TAX_MODELS;
        const computed = computeTaxAlertsForDate(
          effectiveTodayIso,
          activeModels,
          statesMap,
          dismissals,
          { includeOverdue: true }
        );
        setAlerts(computed);
      } catch {
        if (active) setAlerts([]);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [executor, refreshTick, localReloadTick, effectiveTodayIso]);

  if (alerts.length === 0) {
    return null;
  }

  const visibleAlerts = alerts.slice(0, maxVisible);
  const remainingCount = alerts.length - visibleAlerts.length;
  const topUrgency: TaxAlertUrgency = alerts[0]?.urgency ?? "info";

  const handleMarkPresented = async (alert: TaxAlertItem) => {
    setBusyKey(alert.alertKey);
    try {
      const repo = new TaxCalendarRepository(executor);
      await repo.setObligationStatus({
        obligation_key: alert.obligation.obligationKey,
        model_code: alert.obligation.modelCode,
        fiscal_year: alert.obligation.fiscalYear,
        period_code: alert.obligation.periodCode,
        status: "presentado",
        presented_at_iso: effectiveTodayIso,
      });
      setLocalReloadTick((t) => t + 1);
      await onTaxStateChanged?.();
    } finally {
      setBusyKey(null);
    }
  };

  const handleDismiss = async (alert: TaxAlertItem) => {
    setBusyKey(alert.alertKey);
    try {
      const repo = new TaxCalendarRepository(executor);
      await repo.dismissAlert(alert.alertKey);
      setLocalReloadTick((t) => t + 1);
      await onTaxStateChanged?.();
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <section
      aria-label="Avisos fiscales AEAT"
      className={`rounded-2xl border p-3.5 ${urgencyContainerClass(topUrgency)}`}
    >
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] text-[#2C2621] shadow-xs">
            {topUrgency === "critical" ? (
              <AlertTriangle className="h-4 w-4 text-[#DC2626]" />
            ) : (
              <Landmark className="h-4 w-4 text-[#D97706]" />
            )}
          </span>
          <div className="min-w-0">
            <h3 className="text-xs font-bold uppercase tracking-wide text-[#2C2621]">
              Hacienda · {alerts.length} {alerts.length === 1 ? "aviso activo" : "avisos activos"}
            </h3>
            <p className="text-[11px] opacity-85 truncate">
              Recordatorios AEAT según tus modelos configurados
            </p>
          </div>
        </div>
        {onOpenTaxCalendar && (
          <button
            type="button"
            onClick={() => onOpenTaxCalendar(visibleAlerts[0]?.obligation.endDateIso)}
            className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 py-1.5 text-[11px] font-bold text-[#2C2621] hover:bg-[#F5F1E6] cursor-pointer"
          >
            <Calendar className="h-3.5 w-3.5" />
            Ver en Hacienda
          </button>
        )}
      </div>

      <div className="space-y-2">
        {visibleAlerts.map((alert) => {
          const isBusy = busyKey === alert.alertKey;
          return (
            <div
              key={alert.alertKey}
              className="rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] p-2.5 text-[#2C2621]"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] font-bold ${urgencyBadgeClass(alert.urgency)}`}
                    >
                      {alert.obligation.meta.shortLabel} · {alert.obligation.periodLabel}
                    </span>
                    <span className="text-[10px] font-semibold text-[#6B6860]">
                      {alert.obligation.meta.category}
                    </span>
                  </div>
                  <p className="text-xs font-bold leading-snug text-[#2C2621]">
                    {alert.headline}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[#6B6860]">{alert.detail}</p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void handleMarkPresented(alert)}
                    className="inline-flex items-center gap-1 rounded-lg bg-[#1E8E5A] px-2.5 py-1.5 text-[11px] font-bold text-[#FFFDF9] hover:bg-[#059669] disabled:opacity-50 cursor-pointer"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Presentado
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    aria-label={`Descartar aviso ${alert.obligation.meta.shortLabel}`}
                    title="Descartar aviso"
                    onClick={() => void handleDismiss(alert)}
                    className="inline-flex items-center justify-center rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] p-1.5 text-[#6B6860] hover:bg-[#F5F1E6] hover:text-[#2C2621] disabled:opacity-50 cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {remainingCount > 0 && onOpenTaxCalendar && (
        <button
          type="button"
          onClick={() => onOpenTaxCalendar()}
          className="mt-2 text-[11px] font-bold underline underline-offset-2 opacity-90 hover:opacity-100 cursor-pointer"
        >
          Ver {remainingCount} {remainingCount === 1 ? "aviso más" : "avisos más"} en Calendario Hacienda →
        </button>
      )}
    </section>
  );
}
