import type { ActiveWidgetEnvelope } from "../../../core/contracts/types";
import { formatCentsEs } from "../../../core/fiscal/fiscalEngine";
import type { WidgetCommonProps } from "./widgetTypes";

type FiscalWidget = Extract<ActiveWidgetEnvelope, { ui_widget_type: "FiscalPiggyBankWidget" }>;

export function FiscalPiggyBankWidget({ widget, runtime }: WidgetCommonProps) {
  const fp = (widget as FiscalWidget).widget_payload;

  return (
    <section
      data-testid="fiscal-piggybank-widget"
      className="mt-2 paper-sheet rounded-2xl border border-[#E5DFD2] bg-[#FFFDF7] p-3.5 text-[#2C2621] font-sans space-y-3"
    >
      <div className="flex items-center justify-between gap-2 border-b border-[#E5DFD2] pb-2">
        <div>
          <span className="inline-flex items-center rounded-full status-emerald px-2.5 py-0.5 text-[11px] font-semibold">
            Hucha Fiscal · {fp.quarter}
          </span>
          <h3 className="mt-1 text-sm font-bold text-[#2C2621]">
            Reserva trimestral y liquidez real
          </h3>
        </div>
        <button
          type="button"
          onClick={() => {
            runtime.onDismissOverlay?.();
            runtime.onNavigateRoute?.({ name: "fiscal" });
          }}
          className="rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] px-2.5 py-1.5 text-xs font-semibold text-[#2C2621] hover:bg-[#EFECE4]"
        >
          Ver panel
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2.5 pt-2">
        <div className="postit-note postit-yellow pt-4 p-2.5">
          <span className="washi-tape washi-amber" aria-hidden="true" />
          <div className="text-[11px] font-semibold text-[#3E3300]">Para Hacienda (Intocable)</div>
          <div
            data-testid="piggy-untouchable"
            className="mt-0.5 text-base font-extrabold font-mono-nums tabular-nums text-[#3E3300]"
          >
            {formatCentsEs(fp.untouchable_tax_cents)}
          </div>
          <div className="mt-1 text-[10px] font-mono-nums tabular-nums text-[#3E3300]">
            IVA {formatCentsEs(fp.iva_to_reserve_cents)} + IRPF {fp.irpf_rate ?? 20} % ({formatCentsEs(fp.irpf_20_cents)})
          </div>
        </div>

        <div className="postit-note postit-green pt-4 p-2.5">
          <span className="washi-tape washi-green" aria-hidden="true" />
          <div className="text-[11px] font-semibold text-[#1B3A24]">Libre real disponible</div>
          <div
            data-testid="piggy-available"
            className="mt-0.5 text-base font-extrabold font-mono-nums tabular-nums text-[#1B3A24]"
          >
            {formatCentsEs(fp.available_cash_cents)}
          </div>
          <div className="mt-1 text-[10px] font-mono-nums tabular-nums text-[#1B3A24]">
            Cobrado {fp.quarter}: {formatCentsEs(fp.cobrado_mismo_trimestre_cents)}
          </div>
        </div>
      </div>

      <div className="ruled-index rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] p-2.5 text-xs space-y-1.5">
        <div className="flex justify-between text-[#6B6860]">
          <span>IVA repercutido ({fp.quarter})</span>
          <span className="font-semibold font-mono-nums tabular-nums text-[#2B6CB0]">
            {formatCentsEs(fp.iva_repercutido_cents)}
          </span>
        </div>
        <div className="flex justify-between text-[#6B6860]">
          <span>IVA soportado deducible</span>
          <span className="font-semibold font-mono-nums tabular-nums text-[#1E8E5A]">
            {formatCentsEs(fp.iva_soportado_cents)}
          </span>
        </div>
        {fp.iva_to_compensate_cents > 0 && (
          <div className="flex justify-between text-[#1E8E5A]">
            <span>IVA a compensar</span>
            <span className="font-semibold font-mono-nums tabular-nums">
              {formatCentsEs(fp.iva_to_compensate_cents)}
            </span>
          </div>
        )}
        <div className="flex justify-between text-[#6B6860]">
          <span>Pendiente cobro en {fp.quarter}</span>
          <span className="font-semibold font-mono-nums tabular-nums text-[#D99B26]">
            {formatCentsEs(fp.pendiente_cobro_trimestre_cents)}
          </span>
        </div>
        {fp.cobros_trimestres_anteriores_cents > 0 && (
          <div className="flex justify-between text-[#6B6860]">
            <span>Cobrado de trimestres previos (caja)</span>
            <span className="font-mono-nums tabular-nums text-[#8B5CF6]">
              {formatCentsEs(fp.cobros_trimestres_anteriores_cents)}
            </span>
          </div>
        )}
      </div>

      {fp.job_profits.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-[#2C2621] mb-1.5">
            Beneficio neto acumulado por obra
          </div>
          <div className="space-y-1">
            {fp.job_profits.map((jp) => (
              <div
                key={jp.job_id}
                className="flex items-center justify-between rounded-lg border border-[#E5DFD2] bg-[#F5F1E6] px-2.5 py-1.5 text-xs"
              >
                <span className="truncate font-medium text-[#2C2621]">
                  <span className="font-mono-nums">{jp.job_code}</span> · {jp.job_title}
                </span>
                <span
                  className={`ml-2 font-bold font-mono-nums tabular-nums ${
                    jp.net_profit_cents >= 0 ? "text-[#1E8E5A]" : "text-[#E85D2A]"
                  }`}
                >
                  {formatCentsEs(jp.net_profit_cents)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
