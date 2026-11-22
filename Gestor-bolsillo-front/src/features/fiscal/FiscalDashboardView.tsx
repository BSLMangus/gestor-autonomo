import React, { useState } from 'react';
import { Landmark, Plus, Wallet } from 'lucide-react';
import { IMG_TICKET_RECEIPT, useAppStore } from '../../services/mockStore';
import type { FiscalQuarter } from '../../types/domain';
import { formatEuros, formatShortDate } from '../../utils/format';
import { FiscalDetailModals, type FiscalModalKind } from './FiscalDetailModals';

export function FiscalDashboardView() {
  const { state, getFiscalSummary, openOverlay } = useAppStore();
  const [quarter, setQuarter] = useState<FiscalQuarter>('2026-T4');
  const [modal, setModal] = useState<FiscalModalKind>(null);

  const summary = getFiscalSummary(quarter);

  // SVG Donut math (r=44 -> circumference = 2 * pi * 44 = 276.46)
  const C = 276.46;
  const freeDash = (summary.freePct / 100) * C;
  const expDash = (summary.expensesPct / 100) * C;
  const taxDash = (summary.taxPct / 100) * C;

  // Vertical comparative bars scaling
  const maxBarVal = Math.max(
    summary.invoicedCents,
    summary.collectedCents,
    summary.expensesTotalCents,
    summary.freeRealCents,
    1,
  );
  const barPct = (val: number) => Math.max(8, Math.round((val / maxBarVal) * 100));

  const maxJobNet = Math.max(
    ...summary.jobProfitability.map((j) => j.netCents),
    1,
  );

  return (
    <main className="px-4 pt-4 pb-8 flex flex-col gap-4">
      {/* Selector de Trimestre */}
      <section className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 bg-surface-container-lowest border border-outline-variant rounded-full p-1">
          {(['2026-T3', '2026-T4'] as const).map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setQuarter(q)}
              aria-pressed={quarter === q}
              className={`min-h-[36px] px-3.5 rounded-full font-mono text-[12px] font-semibold tabular-nums cursor-pointer transition-colors ${
                quarter === q
                  ? 'bg-secondary text-on-secondary'
                  : 'text-on-surface-variant hover:bg-surface-container'
              }`}
            >
              {q}
            </button>
          ))}
        </div>
        <span className="text-[12px] font-semibold text-on-surface-variant">
          {quarter === '2026-T4' ? 'Oct – Dic 2026' : 'Jul – Sep 2026'}
        </span>
      </section>

      {/* Dos tarjetas KPI principales */}
      <section className="grid grid-cols-2 gap-3 items-stretch">
        <button
          type="button"
          onClick={() => setModal({ type: 'tax' })}
          className="h-full text-left bg-warning-container border border-outline-variant rounded-[20px] p-4 flex flex-col justify-between gap-2 hover:border-amber-tax transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-1.5">
            <Landmark className="w-[18px] h-[18px] text-on-warning-container" />
            <span className="text-[12px] font-semibold text-on-warning-container">
              Para Hacienda
            </span>
          </div>
          <p className="font-mono text-[19px] leading-[24px] font-bold text-on-warning-container tabular-nums">
            {formatEuros(summary.taxReserveCents)}
          </p>
          <div className="flex flex-col gap-0.5 pt-1.5 border-t border-outline-variant font-mono text-[11px] text-on-warning-container tabular-nums">
            <span>IVA: {formatEuros(summary.vatToPayCents)}</span>
            <span>IRPF: {formatEuros(summary.irpfToPayCents)}</span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setModal({ type: 'free' })}
          className="h-full text-left bg-success-container border border-outline-variant rounded-[20px] p-4 flex flex-col justify-between gap-2 hover:border-emerald-free transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-1.5">
            <Wallet className="w-[18px] h-[18px] text-on-success-container" />
            <span className="text-[12px] font-semibold text-on-success-container">
              Libre Real
            </span>
          </div>
          <p className="font-mono text-[19px] leading-[24px] font-bold text-on-success-container tabular-nums">
            {formatEuros(summary.freeRealCents)}
          </p>
          <div className="flex flex-col gap-0.5 pt-1.5 border-t border-outline-variant">
            <span className="text-[11px] font-semibold text-on-success-container">
              Disponible neto
            </span>
          </div>
        </button>
      </section>

      {/* Gráfico 1: Donut SVG — Reparto de cada euro */}
      <section className="bg-surface-warm-card border border-outline-variant rounded-[20px] p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-on-surface">Reparto de cada euro</h2>
          <span className="font-mono text-[12px] text-on-surface-variant tabular-nums">
            {formatEuros(summary.collectedCents, false)} cobrados
          </span>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative w-32 h-32 shrink-0 flex items-center justify-center">
            <svg
              viewBox="0 0 120 120"
              className="w-32 h-32 -rotate-90"
              role="img"
              aria-label={`Reparto: ${summary.freePct}% beneficio, ${summary.expensesPct}% gastos, ${summary.taxPct}% impuestos`}
            >
              <circle cx="60" cy="60" r="44" fill="none" stroke="#F1F5F9" strokeWidth="16" />
              <circle
                cx="60"
                cy="60"
                r="44"
                fill="none"
                stroke="#059669"
                strokeWidth="16"
                strokeDasharray={`${freeDash} ${C}`}
                strokeDashoffset="0"
              />
              <circle
                cx="60"
                cy="60"
                r="44"
                fill="none"
                stroke="#0F172A"
                strokeWidth="16"
                strokeDasharray={`${expDash} ${C}`}
                strokeDashoffset={-freeDash}
              />
              <circle
                cx="60"
                cy="60"
                r="44"
                fill="none"
                stroke="#D97706"
                strokeWidth="16"
                strokeDasharray={`${taxDash} ${C}`}
                strokeDashoffset={-(freeDash + expDash)}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="font-mono text-[16px] font-bold text-on-surface tabular-nums">
                {summary.freePct}%
              </span>
              <span className="text-[11px] font-semibold text-on-surface-variant">Tuyo</span>
            </div>
          </div>

          <div className="flex-1 flex flex-col gap-2">
            <div className="flex items-center justify-between text-[13px]">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-free" />
                <span className="text-on-surface">Beneficio limpio</span>
              </div>
              <span className="font-mono text-[12px] font-semibold tabular-nums">
                {summary.freePct}%
              </span>
            </div>
            <div className="flex items-center justify-between text-[13px]">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-secondary" />
                <span className="text-on-surface">Gastos</span>
              </div>
              <span className="font-mono text-[12px] font-semibold tabular-nums">
                {summary.expensesPct}%
              </span>
            </div>
            <div className="flex items-center justify-between text-[13px]">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-tax" />
                <span className="text-on-surface">IVA + IRPF</span>
              </div>
              <span className="font-mono text-[12px] font-semibold tabular-nums">
                {summary.taxPct}%
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Gráfico 2: Barras verticales comparativas */}
      <section className="bg-surface-warm-card border border-outline-variant rounded-[20px] p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col gap-3">
        <h2 className="text-[15px] font-semibold text-on-surface">Resumen del trimestre</h2>

        <div className="grid grid-cols-4 gap-2 items-end pt-3 h-44">
          {[
            { label: 'Facturado', val: summary.invoicedCents, cls: 'bg-secondary', txt: 'text-on-surface' },
            { label: 'Cobrado', val: summary.collectedCents, cls: 'bg-terracotta', txt: 'text-on-surface' },
            { label: 'Gastos', val: summary.expensesTotalCents, cls: 'bg-amber-tax', txt: 'text-on-surface' },
            { label: 'Beneficio', val: summary.freeRealCents, cls: 'bg-emerald-free', txt: 'text-on-success-container' },
          ].map((bar) => (
            <div
              key={bar.label}
              className="flex flex-col items-center justify-end h-full gap-1.5"
            >
              <span className={`font-mono text-[11px] font-semibold tabular-nums ${bar.txt}`}>
                {formatEuros(bar.val, false)}
              </span>
              <div className="w-full max-w-[44px] flex-1 flex items-end">
                <div
                  className={`w-full rounded-t-lg transition-all duration-300 ${bar.cls}`}
                  style={{ height: `${barPct(bar.val)}%` }}
                />
              </div>
              <span className="text-[11px] font-semibold text-on-surface-variant">
                {bar.label}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Gráfico 3: Rentabilidad neta por obra */}
      <section className="bg-surface-warm-card border border-outline-variant rounded-[20px] p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col gap-3">
        <h2 className="text-[15px] font-semibold text-on-surface">Rentabilidad neta por obra</h2>

        {summary.jobProfitability.length === 0 ? (
          <p className="text-[13px] text-on-surface-variant">
            Sin cobros registrados aún en {quarter}.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {summary.jobProfitability.map((item, idx) => (
              <div key={item.jobId} className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] text-on-surface truncate">
                    {item.jobCode} · {item.title}
                  </span>
                  <span className="font-mono text-[12px] font-semibold text-on-success-container tabular-nums shrink-0">
                    {formatEuros(item.netCents)}
                  </span>
                </div>
                <div className="w-full h-2.5 rounded-full bg-surface-container overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      idx === 2 ? 'bg-terracotta' : 'bg-emerald-free'
                    }`}
                    style={{
                      width: `${Math.max(10, Math.round((item.netCents / maxJobNet) * 100))}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Lista de tickets deducibles */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-on-surface">
            Tickets deducibles del trimestre
          </h2>
          <button
            type="button"
            onClick={() =>
              openOverlay({
                kind: 'ticket',
                initialJobId: state.jobs[0]?.id ?? '',
                initialImageUrl: IMG_TICKET_RECEIPT,
              })
            }
            className="text-[12px] font-semibold text-on-primary-container inline-flex items-center gap-1 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Añadir ticket</span>
          </button>
        </div>

        <div className="bg-surface-warm-card border border-outline-variant rounded-[20px] divide-y divide-outline-variant shadow-[0_2px_10px_rgba(15,23,42,0.04)] overflow-hidden">
          {summary.tickets.map((ticket) => (
            <button
              key={ticket.id}
              type="button"
              onClick={() => setModal({ type: 'ticket', ticket })}
              className="w-full p-4 flex items-center justify-between gap-3 text-left hover:bg-surface-container-lowest/70 transition-colors cursor-pointer"
            >
              <div className="flex flex-col gap-1 min-w-0">
                <span className="text-[15px] font-semibold text-on-surface truncate">
                  {ticket.supplier_name}
                </span>
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded-full font-semibold text-[11px] ${
                      ticket.category === 'Gasoil furgoneta'
                        ? 'bg-secondary-container text-on-secondary-container'
                        : 'bg-terracotta-soft text-on-primary-container'
                    }`}
                  >
                    {ticket.category}
                  </span>
                  <span className="text-[11px] font-semibold text-on-surface-variant">
                    {formatShortDate(ticket.issue_date_iso)} · IVA {ticket.vat_rate}%
                  </span>
                </div>
              </div>
              <span className="font-mono text-[15px] font-semibold text-on-surface tabular-nums shrink-0">
                {formatEuros(ticket.total_cents)}
              </span>
            </button>
          ))}
        </div>
      </section>

      <FiscalDetailModals
        modal={modal}
        summary={summary}
        irpfRate={state.settings.default_irpf_rate}
        onClose={() => setModal(null)}
      />
    </main>
  );
}
