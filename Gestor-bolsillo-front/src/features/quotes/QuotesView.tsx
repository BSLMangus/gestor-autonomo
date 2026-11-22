import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  FilePlus2,
  FileText,
  Percent,
  Receipt,
  Share2,
} from 'lucide-react';
import { useAppStore } from '../../services/mockStore';
import { formatEuros } from '../../utils/format';

type DocsTab = 'todos' | 'por_cobrar' | 'presupuestos' | 'facturas';

export function QuotesView() {
  const {
    state,
    openOverlay,
    openPrintableDoc,
    updateQuoteStatus,
    markInvoicePaid,
    getClientById,
    pushToast,
  } = useAppStore();

  const [tab, setTab] = useState<DocsTab>('todos');

  const t4Invoices = useMemo(
    () => state.invoices.filter((i) => i.quarter === '2026-T4'),
    [state.invoices],
  );
  const collectedT4 = t4Invoices
    .filter((i) => i.status === 'pagado')
    .reduce((s, i) => s + i.total_cents, 0);
  const pendingT4 = t4Invoices
    .filter((i) => i.status !== 'pagado')
    .reduce((s, i) => s + i.total_cents, 0);
  const pendingCount = state.invoices.filter((i) => i.status !== 'pagado').length;

  const visibleInvoices = useMemo(() => {
    if (tab === 'presupuestos') return [];
    if (tab === 'por_cobrar') return state.invoices.filter((i) => i.status !== 'pagado');
    return state.invoices;
  }, [state.invoices, tab]);

  const visibleQuotes = useMemo(() => {
    if (tab === 'facturas' || tab === 'por_cobrar') return [];
    return state.quotes;
  }, [state.quotes, tab]);

  const handleShareQuote = async (code: string, clientName: string, totalCents: number) => {
    const msg = `Hola ${clientName}, te envío el presupuesto ${code} por importe de ${formatEuros(totalCents)} (IVA incluido).`;
    try {
      await navigator.clipboard.writeText(msg);
      pushToast(`Enlace de ${code} copiado para enviar por WhatsApp`);
    } catch {
      pushToast(`Presupuesto ${code} listo para compartir`);
    }
  };

  return (
    <main className="px-4 pt-4 pb-8 flex flex-col gap-4">
      {/* Tabs de filtro */}
      <div className="grid grid-cols-4 gap-1 bg-surface-container-lowest border border-outline-variant rounded-full p-1">
        {(
          [
            { id: 'todos', label: `Todos` },
            { id: 'por_cobrar', label: `Cobrar (${pendingCount})` },
            { id: 'presupuestos', label: `Presup.` },
            { id: 'facturas', label: `Facturas` },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            aria-pressed={tab === item.id}
            className={`min-h-[38px] rounded-full font-semibold text-[11px] cursor-pointer transition-colors ${
              tab === item.id
                ? 'bg-secondary text-on-secondary'
                : 'text-on-surface-variant hover:bg-surface-container'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Mini resumen de cobros */}
      <section className="grid grid-cols-2 gap-2.5">
        <div className="bg-success-container border border-outline-variant rounded-2xl p-3 flex flex-col gap-0.5">
          <span className="text-[11px] font-semibold text-on-success-container">Cobrado T4</span>
          <span className="font-mono text-[16px] font-bold text-on-success-container tabular-nums">
            {formatEuros(collectedT4)}
          </span>
        </div>
        <div className="bg-error-container border border-outline-variant rounded-2xl p-3 flex flex-col gap-0.5">
          <span className="text-[11px] font-semibold text-on-error-container">
            Vencido / Pendiente
          </span>
          <span className="font-mono text-[16px] font-bold text-on-error-container tabular-nums">
            {formatEuros(pendingT4)}
          </span>
        </div>
      </section>

      {/* CTA Nuevo presupuesto */}
      <button
        type="button"
        onClick={() => openOverlay({ kind: 'quote' })}
        className="min-h-[48px] w-full rounded-xl bg-primary hover:bg-terracotta text-white font-semibold text-[14px] flex items-center justify-center gap-2 shadow-sm cursor-pointer"
      >
        <FilePlus2 className="w-5 h-5" />
        <span>Nuevo presupuesto</span>
      </button>

      {/* Facturas (vencidas y pendientes primero) */}
      <section className="flex flex-col gap-3">
        {visibleInvoices.map((inv) => {
          const client = getClientById(inv.client_id);
          const isOverdue = inv.status === 'vencido';
          const isPaid = inv.status === 'pagado';

          return (
            <article
              key={inv.id}
              className="bg-surface-warm-card border border-outline-variant rounded-[20px] p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col gap-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[12px] text-on-surface-variant tabular-nums">
                  {inv.invoice_number}
                </span>
                <span
                  className={`px-2.5 py-0.5 rounded-full font-semibold text-[11px] ${
                    isOverdue
                      ? 'bg-error-container text-on-error-container'
                      : isPaid
                        ? 'bg-success-container text-on-success-container'
                        : 'bg-warning-container text-on-warning-container'
                  }`}
                >
                  {isOverdue ? 'Vencida · 6 días' : isPaid ? 'Cobrada' : 'Pendiente cobro'}
                </span>
              </div>

              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col gap-0.5 min-w-0">
                  <h2 className="text-[15px] font-semibold text-on-surface truncate">
                    {client?.name ?? 'Cliente'}
                  </h2>
                  <p className="text-[13px] text-on-surface-variant truncate">{inv.concept}</p>
                </div>
                <span
                  className={`font-mono text-[16px] font-bold tabular-nums shrink-0 ${
                    isPaid ? 'text-on-success-container' : 'text-on-surface'
                  }`}
                >
                  {formatEuros(inv.total_cents)}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-outline-variant flex-wrap">
                <button
                  type="button"
                  onClick={() => openPrintableDoc({ kind: 'invoice', id: inv.id })}
                  className="text-[12px] font-semibold text-on-surface-variant hover:text-on-surface inline-flex items-center gap-1 cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Ver PDF</span>
                </button>

                <div className="flex items-center gap-3">
                  {!isPaid && (
                    <button
                      type="button"
                      onClick={() =>
                        pushToast(
                          `Recordatorio preparado para ${client?.name ?? 'el cliente'} (${inv.invoice_number})`,
                          'info',
                        )
                      }
                      className="text-[12px] font-semibold text-on-error-container cursor-pointer"
                    >
                      Enviar recordatorio
                    </button>
                  )}
                  {!isPaid && (
                    <button
                      type="button"
                      onClick={() => markInvoicePaid(inv.id)}
                      className="text-[12px] font-semibold text-on-success-container inline-flex items-center gap-1 cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Marcar cobrada</span>
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}

        {/* Presupuestos */}
        {visibleQuotes.map((quote) => {
          const client = getClientById(quote.client_id);
          const badgeConfig: Record<string, { label: string; cls: string }> = {
            borrador: {
              label: 'Borrador IA',
              cls: 'bg-terracotta-soft text-on-primary-container',
            },
            enviado: {
              label: 'Enviado',
              cls: 'bg-info-container text-on-info-container',
            },
            aceptado: {
              label: 'Aceptado',
              cls: 'bg-success-container text-on-success-container',
            },
            rechazado: {
              label: 'Rechazado',
              cls: 'bg-error-container text-on-error-container',
            },
            facturado: {
              label: 'Facturado',
              cls: 'bg-surface-container text-on-surface',
            },
          };
          const badge = badgeConfig[quote.status] ?? badgeConfig.borrador;

          return (
            <article
              key={quote.id}
              className="bg-surface-warm-card border border-outline-variant rounded-[20px] p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col gap-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[12px] text-on-surface-variant tabular-nums">
                  {quote.quote_code}
                </span>
                <span className={`px-2.5 py-0.5 rounded-full font-semibold text-[11px] ${badge.cls}`}>
                  {badge.label}
                </span>
              </div>

              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col gap-0.5 min-w-0">
                  <h2 className="text-[15px] font-semibold text-on-surface truncate">
                    {client?.name ?? 'Cliente'}
                  </h2>
                  <p className="text-[13px] text-on-surface-variant truncate">{quote.title}</p>
                </div>
                <span className="font-mono text-[16px] font-bold text-on-surface tabular-nums shrink-0">
                  {formatEuros(quote.total_cents)}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-outline-variant flex-wrap">
                <span className="text-[11px] font-semibold text-on-surface-variant">
                  IVA {quote.vat_rate}% {quote.vat_rate === 10 ? 'vivienda' : 'general'}
                </span>

                <div className="flex items-center gap-2.5 flex-wrap justify-end">
                  <button
                    type="button"
                    onClick={() => openPrintableDoc({ kind: 'quote', id: quote.id })}
                    className="text-[12px] font-semibold text-on-surface-variant hover:text-on-surface cursor-pointer"
                  >
                    PDF
                  </button>

                  {(quote.status === 'borrador' || quote.status === 'enviado') && (
                    <>
                      <button
                        type="button"
                        onClick={() => updateQuoteStatus(quote.id, 'rechazado')}
                        className="text-[12px] font-semibold text-on-error-container cursor-pointer"
                      >
                        Rechazar
                      </button>
                      <button
                        type="button"
                        onClick={() => openOverlay({ kind: 'quote', quoteId: quote.id })}
                        className="text-[12px] font-semibold text-on-primary-container cursor-pointer"
                      >
                        Revisar y aprobar
                      </button>
                    </>
                  )}

                  {quote.status === 'aceptado' && (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          handleShareQuote(quote.quote_code, client?.name ?? '', quote.total_cents)
                        }
                        className="text-[12px] font-semibold text-on-surface-variant inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          openOverlay({ kind: 'invoice', quoteId: quote.id, mode: 'anticipo' })
                        }
                        className="text-[12px] font-semibold text-on-warning-container inline-flex items-center gap-0.5 cursor-pointer"
                      >
                        <Percent className="w-3.5 h-3.5" />
                        <span>Anticipo 40%</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          openOverlay({ kind: 'invoice', quoteId: quote.id, mode: 'completa' })
                        }
                        className="text-[12px] font-semibold text-on-primary-container inline-flex items-center gap-0.5 cursor-pointer"
                      >
                        <Receipt className="w-3.5 h-3.5" />
                        <span>Facturar</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
