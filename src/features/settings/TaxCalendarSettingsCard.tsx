import { Bell, BellRing, Check, Landmark, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  AppSettingsRecord,
  SqliteExecutor,
  TaxModelCode,
} from "../../core/contracts/types";
import { SettingsRepository } from "../../core/db/repositories/settingsRepo";
import {
  DEFAULT_ACTIVE_TAX_MODELS,
  TAX_MODEL_CATALOG,
} from "../../core/fiscal/taxCalendarEngine";
import {
  getTaxNotificationPermissionStatus,
  requestTaxNotificationPermission,
  syncTaxLocalNotifications,
  type TaxNotificationPermissionState,
} from "../../core/fiscal/taxLocalNotifications";

interface TaxCalendarSettingsCardProps {
  executor: SqliteExecutor;
  settings: AppSettingsRecord | null;
  onSettingsUpdated: (updated: AppSettingsRecord) => void | Promise<void>;
}

export function TaxCalendarSettingsCard({
  executor,
  settings,
  onSettingsUpdated,
}: TaxCalendarSettingsCardProps) {
  const [activeModels, setActiveModels] = useState<TaxModelCode[]>(
    () => settings?.active_tax_models ?? DEFAULT_ACTIVE_TAX_MODELS
  );
  const [busyModel, setBusyModel] = useState<TaxModelCode | null>(null);
  const [permStatus, setPermStatus] =
    useState<TaxNotificationPermissionState>("unsupported");
  const [notifBusy, setNotifBusy] = useState(false);
  const [notifFeedback, setNotifFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (settings?.active_tax_models) {
      setActiveModels(settings.active_tax_models);
    }
  }, [settings]);

  useEffect(() => {
    let active = true;
    void getTaxNotificationPermissionStatus()
      .then((status) => {
        if (active) setPermStatus(status);
      })
      .catch(() => {
        if (active) setPermStatus("unsupported");
      });
    return () => {
      active = false;
    };
  }, []);

  const handleToggleModel = async (code: TaxModelCode) => {
    setBusyModel(code);
    setNotifFeedback(null);
    const nextModels = activeModels.includes(code)
      ? activeModels.filter((m) => m !== code)
      : [...activeModels, code];
    setActiveModels(nextModels);
    try {
      const repo = new SettingsRepository(executor);
      const updated = await repo.updateActiveTaxModels(nextModels);
      await onSettingsUpdated(updated);
      const res = await syncTaxLocalNotifications(executor).catch(() => null);
      if (res && res.scheduled > 0) {
        setNotifFeedback(`Agenda actualizada: ${res.scheduled} recordatorios programados.`);
      }
    } finally {
      setBusyModel(null);
    }
  };

  const handleEnableNotifications = async () => {
    setNotifBusy(true);
    setNotifFeedback(null);
    try {
      const nextPerm = await requestTaxNotificationPermission();
      setPermStatus(nextPerm);
      if (nextPerm === "granted") {
        const res = await syncTaxLocalNotifications(executor);
        setNotifFeedback(
          res.scheduled > 0
            ? `Permiso concedido. ${res.scheduled} días con avisos programados a las 09:00.`
            : "Permiso concedido. Sin avisos próximos pendientes en los próximos 60 días."
        );
      } else {
        setNotifFeedback(
          "Permiso denegado en el sistema. Puedes activarlo en Ajustes del teléfono > Notificaciones."
        );
      }
    } finally {
      setNotifBusy(false);
    }
  };

  const handleResyncNotifications = async () => {
    setNotifBusy(true);
    setNotifFeedback(null);
    try {
      const res = await syncTaxLocalNotifications(executor);
      setNotifFeedback(
        res.skippedReason === "permission_not_granted"
          ? "Activa primero el permiso de notificaciones en Android."
          : res.skippedReason === "not_native"
            ? "Los avisos locales push solo se programan en la app Android."
            : `Resincronizado: ${res.scheduled} días programados a las 09:00.`
      );
    } finally {
      setNotifBusy(false);
    }
  };

  return (
    <div
      data-testid="settings-tax-calendar-card"
      className="paper-sheet rounded-2xl border border-[#E5DFD2] bg-[#FFFDF7] p-3.5 space-y-3 font-sans"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl status-gold">
          <Landmark className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-[#2C2621]">
            Calendario fiscal AEAT y avisos
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-[#6B6860]">
            Elige los modelos que presentas. Verás alertas anticipadas en Inicio, Hucha y Calendario.
          </p>
        </div>
      </div>

      <div className="postit-note postit-yellow border border-[#D97706]/30 px-3 py-2 text-[11px] leading-snug text-[#3E3300]">
        Fechas orientativas para <strong>Territorio Común (AEAT)</strong>; festivos autonómicos o
        locales pueden trasladar vencimientos al siguiente día hábil.
      </div>

      {/* Selector de 13 modelos AEAT */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-bold text-[#2C2621]">
            Modelos incluidos (<span className="font-mono-nums">{activeModels.length}/13</span>)
          </span>
          <span className="text-[#6B6860]">Toca para activar o quitar</span>
        </div>
        <div className="grid grid-cols-1 gap-1.5">
          {TAX_MODEL_CATALOG.map((meta) => {
            const isSelected = activeModels.includes(meta.code);
            return (
              <button
                key={meta.code}
                type="button"
                data-testid={`settings-tax-model-toggle-${meta.code}`}
                disabled={busyModel === meta.code}
                aria-pressed={isSelected}
                onClick={() => void handleToggleModel(meta.code)}
                className={`flex items-start justify-between gap-2 rounded-xl border px-2.5 py-2 text-left transition-colors cursor-pointer ${
                  isSelected
                    ? "border-[#D97706] bg-[#FFF3A1]/55"
                    : "border-[#E5DFD2] bg-[#FFFDF7] hover:bg-[#F5F1E6]"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono tabular-nums text-[11px] font-bold text-[#2C2621]">
                      {meta.shortLabel}
                    </span>
                    <span className="rounded-full bg-[#EFECE4] px-2 py-0.5 text-[10px] font-semibold text-[#6B6860] border border-[#E5DFD2]">
                      {meta.category}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] font-semibold text-[#2C2621]">
                    {meta.title}
                  </div>
                  <div className="text-[10px] text-[#6B6860] leading-snug">{meta.description}</div>
                </div>
                <span
                  className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                    isSelected
                      ? "border-[#EA580C] bg-[#EA580C] text-white"
                      : "border-[#E5DFD2] bg-[#FFFDF7] text-transparent"
                  }`}
                >
                  <Check className="h-3 w-3" />
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Cadencia de recordatorios */}
      <div className="rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] px-2.5 py-2 text-[11px] text-[#6B6860] space-y-0.5">
        <div className="font-bold text-[#2C2621]">Cadencia automática de avisos:</div>
        <p>• Apertura de plazo: 14 días antes, 7 días antes y el día de inicio.</p>
        <p>• Cierre / límite AEAT: 14 días antes, 7 días antes y cada día los últimos 3 días.</p>
      </div>

      {/* Panel de notificaciones locales Android */}
      <div className="rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] p-2.5 space-y-2">
        {permStatus === "unsupported" ? (
          <div className="flex items-center gap-2 text-[11px] text-[#6B6860]">
            <Bell className="h-4 w-4 shrink-0 text-[#6B6860]" />
            <span>
              En navegador web ves los avisos dentro de Inicio, Hucha y Calendario. En la app
              Android además recibirás notificaciones push locales a las 09:00.
            </span>
          </div>
        ) : permStatus === "granted" ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#1B3A24]">
              <BellRing className="h-4 w-4 text-[#059669]" />
              <span>Avisos activos en Android (09:00)</span>
            </div>
            <button
              type="button"
              data-testid="settings-tax-resync-notif-btn"
              disabled={notifBusy}
              onClick={() => void handleResyncNotifications()}
              className="inline-flex items-center gap-1 rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 py-1.5 text-[11px] font-bold text-[#2C2621] hover:bg-[#EFECE4] disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Resincronizar avisos
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] text-[#2C2621] min-w-0 flex-1">
              Activa los avisos en Android para recibir recordatorios a las 09:00 aunque no abras la app.
            </div>
            <button
              type="button"
              data-testid="settings-tax-enable-notif-btn"
              disabled={notifBusy}
              onClick={() => void handleEnableNotifications()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#EA580C] hover:bg-[#D04B00] px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50 cursor-pointer"
            >
              <BellRing className="h-3.5 w-3.5" />
              Activar avisos en el móvil
            </button>
          </div>
        )}

        {notifFeedback && (
          <p className="text-[11px] font-semibold text-[#2C2621]">{notifFeedback}</p>
        )}
      </div>
    </div>
  );
}
