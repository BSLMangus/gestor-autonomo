import React from 'react';
import { Download, Printer, Share2, X } from 'lucide-react';
import { useAppStore } from '../../services/mockStore';
import { formatEuros, formatShortDate } from '../../utils/format';

export function PrintableDocumentModal() {
  const { state, printableDoc, closePrintableDoc, getClientById, pushToast } = useAppStore();
  if (!printableDoc) return null;

  const isQuote = printableDoc.kind === 'quote';
  const quote = isQuote ? state.quotes.find((q) => q.id === printableDoc.id) : undefined;
  const invoice = !isQuote ? state.invoices.find((i) => i.id === printableDoc.id) : undefined;

  if (!quote && !invoice) return null;

  const client = getClientById((quote?.client_id ?? invoice?.client_id) || '');
  const docCode = quote?.quote_code ?? invoice?.invoice_number ?? '';
  const docLabel = isQuote
    ? 'PRESUPUESTO'
    : invoice?.series_type === 'ANT'
      ? 'FACTURA DE ANTICIPO (40%)'
      : 'FACTURA';

  const baseCents = quote?.subtotal_cents ?? invoice?.base_cents ?? 0;
  const vatCents = quote?.vat_cents ?? invoice?.vat_cents ?? 0;
  const totalCents = quote?.total_cents ?? invoice?.total_cents ?? 0;
  const vatRate = quote?.vat_rate ?? invoice?.vat_rate ?? 21;
  const issueDate = quote?.created_at_iso ?? invoice?.issued_at_iso ?? '2026-11-23';

  const handleDownloadHtml = () => {
    const htmlDoc = `<!doctype html>
<html lang="es"><head><meta charset="utf-8" /><title>${docCode} - ${state.settings.business_name}</title>
<style>body{font-family:Inter,system-ui,sans-serif;color:#0F172A;max-width:720px;margin:32px auto;padding:24px;}
.row{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;}
table{width:100%;border-collapse:collapse;margin:24px 0;}th,td{border-bottom:1px solid #E2E8F0;padding:10px 6px;text-align:left;}
.num{text-align:right;font-variant-numeric:tabular-nums;font-family:monospace;}</style></head>
<body>
<div class="row"><div><strong>${state.settings.business_name}</strong><br/>${state.settings.owner_name} · NIF ${state.settings.nif}<br/>${state.settings.fiscal_address}</div>
<div style="text-align:right"><strong>${docLabel}</strong><br/>${docCode}<br/>Fecha: ${issueDate}</div></div>
<hr style="margin:20px 0;border:none;border-top:1px solid #E2E8F0;" />
<div><strong>Cliente:</strong> ${client?.name ?? ''} (${client?.nif ?? ''})<br/>${client?.fiscal_address ?? ''}</div>
<table><thead><tr><th>Concepto</th><th class="num">Importe</th></tr></thead><tbody>
${
  quote
    ? quote.lines
        .map(
          (l) =>
            `<tr><td>${l.description} (${l.quantity} ${l.unit} × ${formatEuros(l.unit_price_cents)})</td><td class="num">${formatEuros(Math.round(l.quantity * l.unit_price_cents))}</td></tr>`,
        )
        .join('')
    : `<tr><td>${invoice?.concept ?? ''}</td><td class="num">${formatEuros(baseCents)}</td></tr>`
}
</tbody></table>
<div style="max-width:280px;margin-left:auto">
<div class="row"><span>Base imponible</span><span class="num">${formatEuros(baseCents)}</span></div>
<div class="row"><span>IVA (${vatRate}%)</span><span class="num">${formatEuros(vatCents)}</span></div>
<div class="row" style="font-size:18px;font-weight:700;margin-top:8px;padding-top:8px;border-top:2px solid #0F172A"><span>TOTAL</span><span class="num">${formatEuros(totalCents)}</span></div>
</div>
<p style="margin-top:32px;font-size:12px;color:#475569">IBAN para transferencia: ${state.settings.iban}</p>
</body></html>`;
    const blob = new Blob([htmlDoc], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${docCode}.html`;
    a.click();
    URL.revokeObjectURL(url);
    pushToast(`${docCode} descargado listo para enviar`);
  };

  const handleShare = async () => {
    const summary = `${docLabel} ${docCode} · ${state.settings.business_name}\nCliente: ${client?.name ?? ''}\nTotal: ${formatEuros(totalCents)} (IVA ${vatRate}% incluido)`;
    try {
      await navigator.clipboard.writeText(summary);
      pushToast('Resumen copiado al portapapeles para enviar por WhatsApp');
    } catch {
      pushToast('Documento listo para compartir');
    }
  };

  return (
    <div className="absolute inset-0 z-[60] bg-surface flex flex-col overflow-hidden">
      <header className="shrink-0 h-[56px] bg-surface border-b border-outline-variant px-4 flex items-center justify-between">
        <button
          type="button"
          onClick={closePrintableDoc}
          aria-label="Cerrar vista previa PDF"
          className="w-12 h-12 -ml-2 rounded-full text-on-surface inline-flex items-center justify-center hover:bg-surface-container cursor-pointer"
        >
          <X className="w-6 h-6" />
        </button>
        <div className="flex flex-col items-center">
          <h2 className="text-[15px] font-semibold text-on-surface">Vista previa PDF</h2>
          <span className="font-mono text-[12px] text-on-surface-variant tabular-nums">
            {docCode}
          </span>
        </div>
        <button
          type="button"
          onClick={handleShare}
          aria-label="Compartir documento"
          className="w-12 h-12 -mr-2 rounded-full text-on-primary-container inline-flex items-center justify-center hover:bg-terracotta-soft cursor-pointer"
        >
          <Share2 className="w-5 h-5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto no-scrollbar p-4">
        <article
          id="printable-document-sheet"
          className="bg-white border border-outline-variant rounded-2xl p-5 shadow-sm flex flex-col gap-4"
        >
          {/* Emisor y cabecera documento */}
          <div className="flex items-start justify-between gap-3 border-b border-outline-variant pb-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] font-bold tracking-wide text-on-primary-container">
                {docLabel}
              </span>
              <h3 className="text-[16px] font-bold text-on-surface">
                {state.settings.business_name}
              </h3>
              <p className="text-[12px] text-on-surface-variant">
                {state.settings.owner_name} · NIF {state.settings.nif}
              </p>
              <p className="text-[11px] text-on-surface-variant">
                {state.settings.fiscal_address}
              </p>
            </div>
            <div className="text-right shrink-0">
              <span className="font-mono text-[13px] font-bold text-on-surface tabular-nums block">
                {docCode}
              </span>
              <span className="font-mono text-[11px] text-on-surface-variant tabular-nums">
                {formatShortDate(issueDate)} 2026
              </span>
            </div>
          </div>

          {/* Datos del cliente */}
          <div className="bg-surface-container-low rounded-xl p-3 flex flex-col gap-0.5">
            <span className="text-[11px] font-semibold text-on-surface-variant">Cliente</span>
            <span className="text-[14px] font-semibold text-on-surface">
              {client?.name ?? 'Cliente'}
            </span>
            <span className="font-mono text-[11px] text-on-surface-variant tabular-nums">
              NIF {client?.nif} · Tel. {client?.phone}
            </span>
            <span className="text-[12px] text-on-surface-variant">
              {client?.fiscal_address}
            </span>
          </div>

          {/* Desglose de partidas */}
          <div className="flex flex-col gap-2">
            <div className="flex justify-between text-[11px] font-semibold text-on-surface-variant border-b border-outline-variant pb-1">
              <span>Concepto</span>
              <span>Importe</span>
            </div>

            {quote ? (
              quote.lines.map((line) => (
                <div
                  key={line.id}
                  className="flex items-start justify-between gap-3 py-1.5 border-b border-outline-variant/60 text-[13px]"
                >
                  <div className="flex flex-col">
                    <span className="font-medium text-on-surface">{line.description}</span>
                    <span className="font-mono text-[11px] text-on-surface-variant tabular-nums">
                      {line.quantity} {line.unit} × {formatEuros(line.unit_price_cents)}
                    </span>
                  </div>
                  <span className="font-mono font-semibold text-on-surface tabular-nums shrink-0">
                    {formatEuros(Math.round(line.quantity * line.unit_price_cents))}
                  </span>
                </div>
              ))
            ) : (
              <div className="flex items-start justify-between gap-3 py-2 border-b border-outline-variant/60 text-[13px]">
                <span className="font-medium text-on-surface">{invoice?.concept}</span>
                <span className="font-mono font-semibold text-on-surface tabular-nums shrink-0">
                  {formatEuros(baseCents)}
                </span>
              </div>
            )}
          </div>

          {/* Totales */}
          <div className="flex flex-col gap-1 pt-2">
            <div className="flex justify-between text-[13px]">
              <span className="text-on-surface-variant">Base imponible</span>
              <span className="font-mono font-semibold text-on-surface tabular-nums">
                {formatEuros(baseCents)}
              </span>
            </div>
            <div className="flex justify-between text-[13px]">
              <span className="text-on-surface-variant">IVA ({vatRate}%)</span>
              <span className="font-mono font-semibold text-on-surface tabular-nums">
                {formatEuros(vatCents)}
              </span>
            </div>
            <div className="flex justify-between items-baseline pt-2 mt-1 border-t-2 border-secondary">
              <span className="text-[15px] font-bold text-on-surface">TOTAL</span>
              <span className="font-mono text-[20px] font-bold text-on-primary-container tabular-nums">
                {formatEuros(totalCents)}
              </span>
            </div>
          </div>

          {/* IBAN y pie */}
          <div className="pt-3 border-t border-outline-variant text-[11px] text-on-surface-variant flex flex-col gap-1">
            <span>
              Transferencia bancaria: <strong className="font-mono text-on-surface">{state.settings.iban}</strong>
            </span>
            <span>
              {isQuote
                ? 'Validez de este presupuesto: 30 días naturales.'
                : `Vencimiento de pago: ${formatShortDate(invoice?.due_at_iso)} 2026.`}
            </span>
          </div>
        </article>
      </div>

      <footer className="shrink-0 bg-surface-container-lowest border-t border-outline-variant p-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={handleDownloadHtml}
          className="min-h-[48px] px-3 rounded-xl bg-surface-container text-on-surface font-semibold text-[13px] flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <Download className="w-4 h-4" />
          <span>Descargar archivo</span>
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="min-h-[48px] px-3 rounded-xl bg-primary text-white font-semibold text-[13px] flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
        >
          <Printer className="w-4 h-4" />
          <span>Imprimir / PDF</span>
        </button>
      </footer>
    </div>
  );
}
