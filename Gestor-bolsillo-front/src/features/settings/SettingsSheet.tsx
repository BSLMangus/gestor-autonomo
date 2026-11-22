import React, { useState } from 'react';
import { Download, RotateCcw, Save, Tag } from 'lucide-react';
import { useAppStore } from '../../services/mockStore';
import {
  calculateDailyHoursFromDefaults,
  eurosToCents,
  formatHours,
  parseSpanishNumber,
} from '../../utils/format';

const WEEKDAY_BUTTONS = [
  { id: 1, label: 'L' },
  { id: 2, label: 'M' },
  { id: 3, label: 'X' },
  { id: 4, label: 'J' },
  { id: 5, label: 'V' },
  { id: 6, label: 'S' },
  { id: 7, label: 'D' },
];

export function SettingsSheet() {
  const {
    state,
    updateSettings,
    updateWorkScheduleDefaults,
    resetDemoData,
    pushToast,
  } = useAppStore();

  const [hourlyStr, setHourlyStr] = useState(
    (state.settings.hourly_rate_cents / 100).toFixed(2).replace('.', ','),
  );
  const [ownerName, setOwnerName] = useState(state.settings.owner_name);
  const [businessName, setBusinessName] = useState(state.settings.business_name);
  const [nif, setNif] = useState(state.settings.nif);
  const [fiscalAddress, setFiscalAddress] = useState(state.settings.fiscal_address);
  const [iban, setIban] = useState(state.settings.iban);
  const [defaultVat, setDefaultVat] = useState(state.settings.default_vat_rate);
  const [defaultIrpf, setDefaultIrpf] = useState(state.settings.default_irpf_rate);
  const [nextQuoteSeq, setNextQuoteSeq] = useState(state.settings.next_quote_seq);
  const [nextInvoiceSeq, setNextInvoiceSeq] = useState(state.settings.next_invoice_seq);

  const schedule = state.workScheduleDefaults;
  const dailySummary = calculateDailyHoursFromDefaults(schedule);

  const toggleWorkDay = (dayId: number) => {
    const exists = schedule.work_days.includes(dayId);
    const nextDays = exists
      ? schedule.work_days.filter((d) => d !== dayId)
      : [...schedule.work_days, dayId].sort((a, b) => a - b);
    updateWorkScheduleDefaults({ ...schedule, work_days: nextDays });
  };

  const handleSaveAll = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettings({
      hourly_rate_cents: Math.max(100, eurosToCents(parseSpanishNumber(hourlyStr))),
      owner_name: ownerName.trim() || state.settings.owner_name,
      business_name: businessName.trim() || state.settings.business_name,
      nif: nif.trim() || state.settings.nif,
      fiscal_address: fiscalAddress.trim() || state.settings.fiscal_address,
      iban: iban.trim() || state.settings.iban,
      default_vat_rate: defaultVat,
      default_irpf_rate: defaultIrpf,
      next_quote_seq: Math.max(1, nextQuoteSeq),
      next_invoice_seq: Math.max(1, nextInvoiceSeq),
    });
  };

  const handleExportBackup = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `copia-obralocal-2026.json`;
    a.click();
    URL.revokeObjectURL(url);
    pushToast('Copia de seguridad descargada en tu dispositivo');
  };

  return (
    <main className="px-4 pt-4 pb-8 flex flex-col gap-4">
      <form onSubmit={handleSaveAll} className="flex flex-col gap-4">
        {/* Tarifa base por hora */}
        <section className="bg-surface-container-lowest border border-outline-variant rounded-[20px] p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-on-surface">
              Personalización y Tarifario
            </h2>
            <Tag className="w-5 h-5 text-on-primary-container" />
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-on-surface">
              Tarifa Base por Hora (€/hora)
            </span>
            <div className="relative flex items-center">
              <input
                type="text"
                value={hourlyStr}
                onChange={(e) => setHourlyStr(e.target.value)}
                className="min-h-[48px] w-full rounded-xl bg-surface-container-low border border-outline-variant px-3 pr-16 font-mono text-[16px] font-semibold text-on-surface tabular-nums focus:outline-none focus:border-terracotta"
              />
              <span className="font-mono text-[12px] text-on-surface-variant absolute right-3">
                €/hora
              </span>
            </div>
            <span className="text-[11px] font-semibold text-on-surface-variant">
              Se usa para calcular presupuestos y desviaciones de jornada.
            </span>
          </label>
        </section>

        {/* Mi Horario Habitual */}
        <section className="bg-surface-container-lowest border border-outline-variant rounded-[20px] p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-on-surface">
              Mi Horario Habitual de Trabajo
            </h2>
            <span className="font-mono text-[11px] font-semibold text-on-success-container bg-success-container px-2.5 py-0.5 rounded-full tabular-nums">
              {formatHours(dailySummary.totalHours)}/día
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-on-surface">
              Días laborables habituales
            </span>
            <div className="grid grid-cols-7 gap-1.5">
              {WEEKDAY_BUTTONS.map((day) => {
                const active = schedule.work_days.includes(day.id);
                return (
                  <button
                    key={day.id}
                    type="button"
                    onClick={() => toggleWorkDay(day.id)}
                    aria-pressed={active}
                    className={`min-h-[44px] rounded-xl font-semibold text-[12px] cursor-pointer ${
                      active
                        ? 'bg-secondary text-on-secondary'
                        : 'bg-surface-container-low border border-outline-variant text-on-surface-variant'
                    }`}
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between bg-surface-container-low rounded-2xl p-3">
              <div className="flex flex-col">
                <span className="text-[12px] font-semibold text-on-surface">Mañana</span>
                <span className="text-[11px] text-on-surface-variant">
                  {formatHours(dailySummary.morningHours)}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="time"
                  value={schedule.morning_start}
                  onChange={(e) =>
                    updateWorkScheduleDefaults({ ...schedule, morning_start: e.target.value })
                  }
                  className="min-h-[42px] px-2 rounded-xl bg-surface-container-lowest border border-outline-variant font-mono text-[12px] tabular-nums"
                />
                <span className="text-outline">–</span>
                <input
                  type="time"
                  value={schedule.morning_end}
                  onChange={(e) =>
                    updateWorkScheduleDefaults({ ...schedule, morning_end: e.target.value })
                  }
                  className="min-h-[42px] px-2 rounded-xl bg-surface-container-lowest border border-outline-variant font-mono text-[12px] tabular-nums"
                />
              </div>
            </div>

            <div className="flex items-center justify-between bg-surface-container-low rounded-2xl p-3">
              <div className="flex flex-col">
                <span className="text-[12px] font-semibold text-on-surface">Tarde</span>
                <span className="text-[11px] text-on-surface-variant">
                  {formatHours(dailySummary.afternoonHours)}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="time"
                  value={schedule.afternoon_start}
                  onChange={(e) =>
                    updateWorkScheduleDefaults({ ...schedule, afternoon_start: e.target.value })
                  }
                  className="min-h-[42px] px-2 rounded-xl bg-surface-container-lowest border border-outline-variant font-mono text-[12px] tabular-nums"
                />
                <span className="text-outline">–</span>
                <input
                  type="time"
                  value={schedule.afternoon_end}
                  onChange={(e) =>
                    updateWorkScheduleDefaults({ ...schedule, afternoon_end: e.target.value })
                  }
                  className="min-h-[42px] px-2 rounded-xl bg-surface-container-lowest border border-outline-variant font-mono text-[12px] tabular-nums"
                />
              </div>
            </div>
          </div>

          <label className="flex items-center justify-between gap-3 min-h-[48px] px-3 py-2 rounded-xl bg-terracotta-soft border border-outline-variant cursor-pointer">
            <span className="text-[13px] text-on-primary-container">
              Aplicar automáticamente este horario al crear una obra con fechas
            </span>
            <input
              type="checkbox"
              checked={schedule.auto_apply_to_jobs}
              onChange={(e) =>
                updateWorkScheduleDefaults({
                  ...schedule,
                  auto_apply_to_jobs: e.target.checked,
                })
              }
              className="w-5 h-5 rounded border-outline accent-terracotta shrink-0"
            />
          </label>
        </section>

        {/* Datos fiscales del emisor */}
        <section className="bg-surface-container-lowest border border-outline-variant rounded-[20px] p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-on-surface">Datos del autónomo</h2>
            <span className="px-2.5 py-0.5 rounded-full bg-success-container text-on-success-container font-semibold text-[11px]">
              100% Local
            </span>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-on-surface-variant">
              Nombre comercial
            </span>
            <input
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              className="min-h-[44px] rounded-xl bg-surface-container-low border border-outline-variant px-3 text-[14px]"
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-on-surface-variant">Titular</span>
              <input
                type="text"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                className="min-h-[44px] rounded-xl bg-surface-container-low border border-outline-variant px-3 text-[13px]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-on-surface-variant">NIF</span>
              <input
                type="text"
                value={nif}
                onChange={(e) => setNif(e.target.value)}
                className="min-h-[44px] rounded-xl bg-surface-container-low border border-outline-variant px-3 font-mono text-[13px]"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-on-surface-variant">
              Dirección fiscal
            </span>
            <input
              type="text"
              value={fiscalAddress}
              onChange={(e) => setFiscalAddress(e.target.value)}
              className="min-h-[44px] rounded-xl bg-surface-container-low border border-outline-variant px-3 text-[13px]"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-on-surface-variant">
              IBAN para cobros en facturas
            </span>
            <input
              type="text"
              value={iban}
              onChange={(e) => setIban(e.target.value)}
              className="min-h-[44px] rounded-xl bg-surface-container-low border border-outline-variant px-3 font-mono text-[12px]"
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-on-surface-variant">
                IVA por defecto
              </span>
              <select
                value={defaultVat}
                onChange={(e) => setDefaultVat(Number(e.target.value))}
                className="min-h-[44px] rounded-xl bg-surface-container-low border border-outline-variant px-3 font-mono text-[13px]"
              >
                <option value={10}>10% Vivienda</option>
                <option value={21}>21% General</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-on-surface-variant">
                Reserva IRPF (%)
              </span>
              <input
                type="number"
                min={0}
                max={45}
                value={defaultIrpf}
                onChange={(e) => setDefaultIrpf(Number(e.target.value) || 0)}
                className="min-h-[44px] rounded-xl bg-surface-container-low border border-outline-variant px-3 font-mono text-[13px]"
              />
            </label>
          </div>

          {/* Numeración correlativa */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-outline-variant">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-on-surface-variant">
                Próx. Presupuesto
              </span>
              <input
                type="number"
                min={1}
                value={nextQuoteSeq}
                onChange={(e) => setNextQuoteSeq(Number(e.target.value) || 1)}
                className="min-h-[44px] rounded-xl bg-surface-container-low border border-outline-variant px-3 font-mono text-[13px]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-on-surface-variant">
                Próx. Factura FAC
              </span>
              <input
                type="number"
                min={1}
                value={nextInvoiceSeq}
                onChange={(e) => setNextInvoiceSeq(Number(e.target.value) || 1)}
                className="min-h-[44px] rounded-xl bg-surface-container-low border border-outline-variant px-3 font-mono text-[13px]"
              />
            </label>
          </div>
        </section>

        <button
          type="submit"
          className="min-h-[48px] w-full rounded-xl bg-primary hover:bg-terracotta text-white font-semibold text-[14px] flex items-center justify-center gap-2 shadow-sm cursor-pointer"
        >
          <Save className="w-5 h-5" />
          <span>Guardar ajustes</span>
        </button>
      </form>

      {/* Copias de seguridad y reinicio demo */}
      <section className="bg-surface-warm-card border border-outline-variant rounded-[20px] p-4 flex flex-col gap-2.5">
        <h3 className="text-[14px] font-semibold text-on-surface">
          Copias de seguridad y datos guardados
        </h3>
        <p className="text-[12px] text-on-surface-variant">
          Tus cambios se guardan automáticamente en este navegador. Puedes descargar una copia o
          volver a los datos iniciales de demostración.
        </p>
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            type="button"
            onClick={handleExportBackup}
            className="min-h-[44px] px-3 rounded-xl bg-surface-container-lowest border border-outline-variant text-on-surface font-semibold text-[12px] flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Exportar copia</span>
          </button>
          <button
            type="button"
            onClick={resetDemoData}
            className="min-h-[44px] px-3 rounded-xl bg-error-container text-on-error-container font-semibold text-[12px] flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Reiniciar demo</span>
          </button>
        </div>
      </section>
    </main>
  );
}
