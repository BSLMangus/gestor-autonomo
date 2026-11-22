import type { ActiveWidgetEnvelope } from "../../../core/contracts/types";
import { formatCentsEs } from "../../../core/fiscal/fiscalEngine";
import type { WidgetCommonProps } from "./widgetTypes";

type FiscalWidget = Extract<ActiveWidgetEnvelope, { ui_widget_type: "FiscalPiggyBankWidget" }>;

export function FiscalPiggyBankWidget({ widget, runtime }: WidgetCommonProps) {
  const fp = (widget as FiscalWidget).widget_payload;

  return (
    <section
      data-testid="fiscal-piggybank-widget"
      className="mt-2 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm text-slate-900 space-y-3"
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
        <div>
          <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-900">
            Hucha Fiscal · {fp.quarter}
          </span>
          <h3 className="mt-1 text-sm font-bold text-slate-900">
            Reserva trimestral y liquidez real
          </h3>
        </div>
        <button
          type="button"
          onClick={() => {
            runtime.onDismissOverlay?.();
            runtime.onNavigateRoute?.({ name: "fiscal" });
          }}
          className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-700"
        >
          Ver panel
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-2.5">
          <div className="text-[11px] font-medium text-amber-900">Para Hacienda (Intocable)</div>
          <div data-testid="piggy-untouchable" className="mt-0.5 text-base font-extrabold text-amber-950">
            {formatCentsEs(fp.untouchable_tax_cents)}
          </div>
          <div className="mt-1 text-[10px] text-amber-800">
            IVA {formatCentsEs(fp.iva_to_reserve_cents)} + IRPF {fp.irpf_rate ?? 20} % ({formatCentsEs(fp.irpf_20_cents)})
          </div>
        </div>

        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-2.5">
          <div className="text-[11px] font-medium text-emerald-900">Libre real disponible</div>
          <div data-testid="piggy-available" className="mt-0.5 text-base font-extrabold text-emerald-950">
            {formatCentsEs(fp.available_cash_cents)}
          </div>
          <div className="mt-1 text-[10px] text-emerald-800">
            Cobrado {fp.quarter}: {formatCentsEs(fp.cobrado_mismo_trimestre_cents)}
          </div>
        </div>
      </div>

      <div className="rounded-xl bg-slate-50 p-2.5 text-xs space-y-1">
        <div className="flex justify-between text-slate-600">
          <span>IVA repercutido ({fp.quarter})</span>
          <span className="font-semibold text-slate-900">{formatCentsEs(fp.iva_repercutido_cents)}</span>
        </div>
        <div className="flex justify-between text-slate-600">
          <span>IVA soportado deducible</span>
          <span className="font-semibold text-slate-900">{formatCentsEs(fp.iva_soportado_cents)}</span>
        </div>
        {fp.iva_to_compensate_cents > 0 && (
          <div className="flex justify-between text-emerald-700">
            <span>IVA a compensar</span>
            <span className="font-semibold">{formatCentsEs(fp.iva_to_compensate_cents)}</span>
          </div>
        )}
        <div className="flex justify-between text-slate-600">
          <span>Pendiente cobro en {fp.quarter}</span>
          <span className="font-semibold text-slate-900">
            {formatCentsEs(fp.pendiente_cobro_trimestre_cents)}
          </span>
        </div>
        {fp.cobros_trimestres_anteriores_cents > 0 && (
          <div className="flex justify-between text-slate-500">
            <span>Cobrado de trimestres previos (caja)</span>
            <span>{formatCentsEs(fp.cobros_trimestres_anteriores_cents)}</span>
          </div>
        )}
      </div>

      {fp.job_profits.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-slate-700 mb-1.5">
            Beneficio neto acumulado por obra
          </div>
          <div className="space-y-1">
            {fp.job_profits.map((jp) => (
              <div
                key={jp.job_id}
                className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/80 px-2.5 py-1.5 text-xs"
              >
                <span className="truncate font-medium text-slate-800">
                  {jp.job_code} · {jp.job_title}
                </span>
                <span
                  className={`ml-2 font-bold ${
                    jp.net_profit_cents >= 0 ? "text-emerald-700" : "text-rose-700"
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
