import React, { useEffect, useRef, useState } from 'react';
import {
  AudioLines,
  Camera,
  CheckCircle2,
  Clock,
  FileCheck2,
  FileText,
  PiggyBank,
  Plus,
  ReceiptText,
  Save,
  ScanLine,
  ShieldCheck,
  Trash2,
  Upload,
  User,
  UserPlus,
  X,
} from 'lucide-react';
import {
  IMG_PLUMBING_PIPE,
  IMG_SHOWER_TILING,
  IMG_TICKET_RECEIPT,
  TODAY_ISO,
  useAppStore,
} from '../../services/mockStore';
import type { ExpenseCategory, PricingUnit, QuoteLine } from '../../types/domain';
import {
  calculateDailyHoursFromDefaults,
  computeQuoteTotals,
  eurosToCents,
  formatDateRange,
  formatEuros,
  formatHours,
  formatShortDate,
  formatSignedEuros,
  formatSignedHours,
  minutesToHHMM,
  parseSpanishNumber,
  parseTimeToMinutes,
} from '../../utils/format';

export function GenerativeWidgetOverlay() {
  const { overlay, closeOverlay } = useAppStore();
  if (!overlay) return null;

  return (
    <div className="absolute inset-0 z-50 bg-surface flex flex-col overflow-hidden">
      {overlay.kind === 'quote' && <QuoteBuilderOverlay />}
      {overlay.kind === 'invoice' && <InvoiceEmissionOverlay />}
      {overlay.kind === 'ticket' && <TicketScannerOverlay />}
      {overlay.kind === 'photo' && <JobPhotoOverlay />}
      {overlay.kind === 'schedule' && <ScheduleLogOverlay />}
    </div>
  );
}

/* ============================================================================
 * 1. CONSTRUCTOR DE PRESUPUESTO (GENERATIVE UI)
 * ==========================================================================*/
function QuoteBuilderOverlay() {
  const {
    state,
    overlay,
    closeOverlay,
    saveQuote,
    updateQuoteStatus,
    createClient,
    openPrintableDoc,
    markChatCardResolved,
    pushToast,
  } = useAppStore();

  const existingQuote =
    overlay?.kind === 'quote' && overlay.quoteId
      ? state.quotes.find((q) => q.id === overlay.quoteId)
      : undefined;

  const [clientId, setClientId] = useState<string>(
    existingQuote?.client_id ??
      (overlay?.kind === 'quote' ? overlay.initialClientId : undefined) ??
      state.clients[0]?.id ??
      '',
  );
  const [showNewClient, setShowNewClient] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientNif, setNewClientNif] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');

  const [title, setTitle] = useState<string>(
    existingQuote?.title ??
      (overlay?.kind === 'quote' ? overlay.initialTitle : undefined) ??
      'Reforma baño principal',
  );
  const [vatMode, setVatMode] = useState<'10' | '21' | 'custom'>(() => {
    const rate = existingQuote?.vat_rate ?? state.settings.default_vat_rate;
    if (rate === 10) return '10';
    if (rate === 21) return '21';
    return 'custom';
  });
  const [customVat, setCustomVat] = useState<string>(
    String(existingQuote?.vat_rate ?? 4),
  );
  const [lines, setLines] = useState<QuoteLine[]>(() => {
    if (existingQuote) return existingQuote.lines.map((l) => ({ ...l }));
    if (overlay?.kind === 'quote' && overlay.initialLines && overlay.initialLines.length > 0) {
      return overlay.initialLines.map((l) => ({ ...l }));
    }
    return [
      {
        id: `ql-init-1`,
        description: 'Alicatado pared porcelánico',
        quantity: 12,
        unit: 'm2',
        unit_price_cents: 4200,
        save_to_catalog: true,
        trade_category: 'Albañilería',
      },
      {
        id: `ql-init-2`,
        description: 'Mano de obra fontanería y montaje',
        quantity: 8,
        unit: 'h',
        unit_price_cents: state.settings.hourly_rate_cents,
        save_to_catalog: false,
        trade_category: 'Fontanería',
      },
    ];
  });

  const [showCatalogPicker, setShowCatalogPicker] = useState(false);

  const activeVatRate =
    vatMode === '10' ? 10 : vatMode === '21' ? 21 : Math.max(0, Math.min(50, parseSpanishNumber(customVat)));

  const totals = computeQuoteTotals(lines, activeVatRate);
  const voiceNote =
    existingQuote?.voice_note ?? (overlay?.kind === 'quote' ? overlay.voiceNote : undefined);
  const displayCode =
    existingQuote?.quote_code ?? `PRE-2026-${String(state.settings.next_quote_seq).padStart(3, '0')}`;

  const updateLine = (id: string, patch: Partial<QuoteLine>) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const removeLine = (id: string) => {
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const addEmptyLine = () => {
    setLines((prev) => [
      ...prev,
      {
        id: `ql-${Date.now()}`,
        description: '',
        quantity: 1,
        unit: 'ud',
        unit_price_cents: state.settings.hourly_rate_cents,
        save_to_catalog: false,
        trade_category: 'General',
      },
    ]);
  };

  const addFromCatalog = (catId: string) => {
    const item = state.pricingCatalog.find((c) => c.id === catId);
    if (!item) return;
    setLines((prev) => [
      ...prev,
      {
        id: `ql-cat-${Date.now()}`,
        description: item.name,
        quantity: 1,
        unit: item.unit,
        unit_price_cents: item.unit_price_cents,
        save_to_catalog: false,
        trade_category: item.category,
      },
    ]);
    setShowCatalogPicker(false);
  };

  const handleCreateQuickClient = () => {
    if (!newClientName.trim()) return;
    const created = createClient({
      name: newClientName.trim(),
      nif: newClientNif.trim() || 'Pendiente NIF',
      fiscal_address: 'Madrid',
      phone: newClientPhone.trim() || '600 000 000',
      email: '',
      notes: 'Creado desde constructor de presupuesto.',
    });
    setClientId(created.id);
    setShowNewClient(false);
    setNewClientName('');
    setNewClientNif('');
    setNewClientPhone('');
  };

  const handleReject = () => {
    if (existingQuote) {
      updateQuoteStatus(existingQuote.id, 'rechazado');
    } else {
      pushToast('Borrador descartado', 'info');
    }
    if (overlay?.kind === 'quote' && overlay.chatCardRef) {
      markChatCardResolved(overlay.chatCardRef.conversationId, overlay.chatCardRef.cardId);
    }
    closeOverlay();
  };

  const handleApproveAndPdf = () => {
    const validLines = lines.filter((l) => l.description.trim().length > 0 && l.quantity > 0);
    if (validLines.length === 0) {
      pushToast('Añade al menos una partida con concepto y cantidad', 'warning');
      return;
    }
    const saved = saveQuote({
      id: existingQuote?.id,
      client_id: clientId || state.clients[0]?.id || '',
      job_id: overlay?.kind === 'quote' ? overlay.initialJobId : existingQuote?.job_id,
      title,
      vat_rate: activeVatRate,
      lines: validLines,
      status: 'aceptado',
      voice_note: voiceNote,
      chatCardRef: overlay?.kind === 'quote' ? overlay.chatCardRef : undefined,
    });
    closeOverlay();
    openPrintableDoc({ kind: 'quote', id: saved.id });
  };

  return (
    <>
      <header className="shrink-0 h-[56px] bg-surface border-b border-outline-variant px-4 flex items-center justify-between">
        <button
          type="button"
          onClick={closeOverlay}
          aria-label="Cerrar constructor"
          className="w-12 h-12 -ml-2 rounded-full text-on-surface inline-flex items-center justify-center hover:bg-surface-container cursor-pointer"
        >
          <X className="w-6 h-6" />
        </button>

        <div className="flex flex-col items-center">
          <h1 className="text-[16px] leading-[22px] font-semibold text-on-surface">
            Revisar presupuesto
          </h1>
          <span className="font-mono text-[12px] text-on-surface-variant tabular-nums">
            {displayCode}
          </span>
        </div>

        <span className="px-2.5 py-1 rounded-full bg-terracotta-soft text-on-primary-container font-semibold text-[11px]">
          Borrador IA
        </span>
      </header>

      <div className="flex-1 overflow-y-auto no-scrollbar px-4 pt-4 pb-6 flex flex-col gap-4">
        {voiceNote && (
          <div className="bg-terracotta-soft border border-outline-variant rounded-2xl p-3 flex items-start gap-2.5">
            <AudioLines className="w-5 h-5 text-on-primary-container shrink-0 mt-0.5" />
            <p className="text-[13px] leading-[19px] text-on-primary-container">
              Preparado a partir de tu nota de voz: «{voiceNote}»
            </p>
          </div>
        )}

        {/* Cliente, título e IVA */}
        <section className="bg-surface-container-lowest border border-outline-variant rounded-[20px] p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-on-surface">Cliente</span>
            <div className="grid grid-cols-2 gap-2">
              <div className="relative flex items-center">
                <User className="w-4 h-4 text-white absolute left-3 pointer-events-none" />
                <select
                  value={clientId}
                  onChange={(e) => {
                    setClientId(e.target.value);
                    setShowNewClient(false);
                  }}
                  aria-label="Seleccionar cliente"
                  className="min-h-[48px] w-full pl-9 pr-3 rounded-xl bg-secondary text-on-secondary font-semibold text-[13px] appearance-none focus:outline-none cursor-pointer"
                >
                  {state.clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => setShowNewClient((v) => !v)}
                className={`min-h-[48px] px-3 rounded-xl border font-semibold text-[13px] flex items-center justify-center gap-1.5 cursor-pointer ${
                  showNewClient
                    ? 'bg-terracotta-soft border-terracotta text-on-primary-container'
                    : 'bg-surface-container-low border-outline-variant text-on-surface'
                }`}
              >
                <UserPlus className="w-4 h-4" />
                <span>Nuevo cliente</span>
              </button>
            </div>

            {showNewClient && (
              <div className="mt-2 p-3 rounded-xl bg-surface-container-low border border-outline-variant flex flex-col gap-2">
                <input
                  type="text"
                  placeholder="Nombre o razón social"
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  className="min-h-[42px] rounded-lg bg-surface-container-lowest border border-outline-variant px-3 text-[13px]"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="NIF / CIF"
                    value={newClientNif}
                    onChange={(e) => setNewClientNif(e.target.value)}
                    className="min-h-[42px] rounded-lg bg-surface-container-lowest border border-outline-variant px-3 font-mono text-[12px]"
                  />
                  <input
                    type="tel"
                    placeholder="Teléfono"
                    value={newClientPhone}
                    onChange={(e) => setNewClientPhone(e.target.value)}
                    className="min-h-[42px] rounded-lg bg-surface-container-lowest border border-outline-variant px-3 font-mono text-[12px]"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleCreateQuickClient}
                  className="min-h-[40px] rounded-lg bg-secondary text-white font-semibold text-[13px] cursor-pointer"
                >
                  Guardar y seleccionar cliente
                </button>
              </div>
            )}
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-on-surface">Título de la obra</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="min-h-[48px] w-full rounded-xl bg-surface-container-low border border-outline-variant px-3 text-[14px] text-on-surface focus:outline-none focus:border-terracotta focus:ring-1 focus:ring-terracotta"
            />
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-on-surface">
              Tipo de IVA aplicable
            </span>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setVatMode('10')}
                aria-pressed={vatMode === '10'}
                className={`min-h-[48px] px-2 rounded-xl font-semibold text-[12px] text-center cursor-pointer transition-colors ${
                  vatMode === '10'
                    ? 'bg-terracotta-soft border-2 border-terracotta text-on-primary-container'
                    : 'bg-surface-container-low border border-outline-variant text-on-surface'
                }`}
              >
                10% Vivienda
              </button>
              <button
                type="button"
                onClick={() => setVatMode('21')}
                aria-pressed={vatMode === '21'}
                className={`min-h-[48px] px-2 rounded-xl font-semibold text-[12px] text-center cursor-pointer transition-colors ${
                  vatMode === '21'
                    ? 'bg-terracotta-soft border-2 border-terracotta text-on-primary-container'
                    : 'bg-surface-container-low border border-outline-variant text-on-surface'
                }`}
              >
                21% General
              </button>
              <button
                type="button"
                onClick={() => setVatMode('custom')}
                aria-pressed={vatMode === 'custom'}
                className={`min-h-[48px] px-2 rounded-xl font-semibold text-[12px] text-center cursor-pointer transition-colors ${
                  vatMode === 'custom'
                    ? 'bg-terracotta-soft border-2 border-terracotta text-on-primary-container'
                    : 'bg-surface-container-low border border-outline-variant text-on-surface'
                }`}
              >
                Otro %
              </button>
            </div>
            {vatMode === 'custom' && (
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={customVat}
                  onChange={(e) => setCustomVat(e.target.value)}
                  className="min-h-[44px] w-28 rounded-xl bg-surface-container-low border border-outline-variant px-3 font-mono text-[14px] tabular-nums"
                />
                <span className="text-[13px] text-on-surface-variant">
                  % de IVA personalizado (ej. 0% exento o 4%)
                </span>
              </div>
            )}
          </div>
        </section>

        {/* Partidas editables */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[16px] font-semibold text-on-surface">
              Partidas del presupuesto
            </h2>
            <span className="text-[12px] font-semibold text-on-surface-variant">
              {lines.length} {lines.length === 1 ? 'concepto' : 'conceptos'}
            </span>
          </div>

          {lines.map((line) => {
            const lineSubtotal = Math.round(line.quantity * line.unit_price_cents);
            return (
              <article
                key={line.id}
                className="bg-surface-container-lowest border border-outline-variant rounded-[20px] p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <input
                    type="text"
                    value={line.description}
                    onChange={(e) => updateLine(line.id, { description: e.target.value })}
                    placeholder="Descripción de la partida..."
                    className="flex-1 text-[15px] font-semibold text-on-surface bg-transparent border-b border-transparent focus:border-terracotta focus:outline-none pb-0.5"
                  />
                  <button
                    type="button"
                    onClick={() => removeLine(line.id)}
                    aria-label="Eliminar partida"
                    className="text-outline hover:text-coral-alert p-1.5 cursor-pointer"
                  >
                    <Trash2 className="w-[18px] h-[18px]" />
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold text-on-surface-variant">
                      Cantidad
                    </span>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={line.quantity}
                      onChange={(e) =>
                        updateLine(line.id, {
                          quantity: Math.max(0, Number.parseFloat(e.target.value) || 0),
                        })
                      }
                      className="min-h-[46px] w-full rounded-xl bg-surface-container-low border border-outline-variant px-2.5 font-mono text-[15px] font-semibold text-on-surface tabular-nums focus:outline-none focus:border-terracotta"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold text-on-surface-variant">
                      Unidad
                    </span>
                    <select
                      value={line.unit}
                      onChange={(e) =>
                        updateLine(line.id, { unit: e.target.value as PricingUnit })
                      }
                      className="min-h-[46px] w-full rounded-xl bg-surface-container-low border border-outline-variant px-2 font-semibold text-[13px] text-on-surface"
                    >
                      <option value="m2">m2</option>
                      <option value="ud">ud</option>
                      <option value="h">h</option>
                      <option value="ml">ml</option>
                      <option value="pa">pa</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold text-on-surface-variant">
                      Precio ud. (€)
                    </span>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={(line.unit_price_cents / 100).toFixed(2)}
                      onChange={(e) =>
                        updateLine(line.id, {
                          unit_price_cents: eurosToCents(
                            Math.max(0, Number.parseFloat(e.target.value) || 0),
                          ),
                        })
                      }
                      className="min-h-[46px] w-full rounded-xl bg-surface-container-low border border-outline-variant px-2.5 font-mono text-[15px] font-semibold text-on-surface tabular-nums focus:outline-none focus:border-terracotta"
                    />
                  </label>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-outline-variant">
                  <span className="text-[12px] font-semibold text-on-surface-variant">
                    Subtotal partida
                  </span>
                  <span className="font-mono text-[15px] font-semibold text-on-surface tabular-nums">
                    {formatEuros(lineSubtotal)}
                  </span>
                </div>

                <label className="flex items-center gap-2.5 min-h-[44px] px-3 rounded-xl bg-surface-container-low cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(line.save_to_catalog)}
                    onChange={(e) =>
                      updateLine(line.id, { save_to_catalog: e.target.checked })
                    }
                    className="w-4 h-4 rounded border-outline accent-terracotta shrink-0"
                  />
                  <span className="text-[13px] text-on-surface">
                    Guardar este precio en mi tarifario para la próxima vez
                  </span>
                </label>
              </article>
            );
          })}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={addEmptyLine}
              className="min-h-[46px] rounded-xl bg-surface-container-lowest border border-outline-variant text-on-surface font-semibold text-[13px] flex items-center justify-center gap-1.5 hover:border-terracotta cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Nueva partida</span>
            </button>
            <button
              type="button"
              onClick={() => setShowCatalogPicker((v) => !v)}
              className="min-h-[46px] rounded-xl bg-surface-warm-card border border-outline-variant text-on-primary-container font-semibold text-[13px] flex items-center justify-center gap-1.5 hover:border-terracotta cursor-pointer"
            >
              <FileText className="w-4 h-4" />
              <span>Desde tarifario</span>
            </button>
          </div>

          {showCatalogPicker && (
            <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-3 flex flex-col gap-2">
              <span className="text-[12px] font-semibold text-on-surface-variant">
                Elige una partida de tu tarifario:
              </span>
              {state.pricingCatalog.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => addFromCatalog(item.id)}
                  className="min-h-[44px] px-3 py-2 rounded-xl bg-surface-container-low hover:bg-terracotta-soft flex items-center justify-between text-left cursor-pointer"
                >
                  <span className="text-[13px] font-medium text-on-surface truncate pr-2">
                    {item.name}
                  </span>
                  <span className="font-mono text-[12px] font-semibold text-on-primary-container tabular-nums shrink-0">
                    {formatEuros(item.unit_price_cents)}/{item.unit}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Footer fijo con totales en tiempo real */}
      <footer className="shrink-0 bg-surface-container-lowest border-t border-outline-variant p-4 shadow-[0_-4px_16px_rgba(15,23,42,0.06)] flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-on-surface-variant">Base Imponible</span>
            <span className="font-mono text-[14px] font-semibold text-on-surface tabular-nums">
              {formatEuros(totals.subtotal_cents)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-on-surface-variant">
              IVA ({activeVatRate}%{activeVatRate === 10 ? ' Vivienda' : activeVatRate === 21 ? ' General' : ''})
            </span>
            <span className="font-mono text-[14px] font-semibold text-on-surface tabular-nums">
              {formatEuros(totals.vat_cents)}
            </span>
          </div>
          <div className="flex items-center justify-between pt-1.5 border-t border-outline-variant">
            <span className="text-[15px] font-semibold text-on-surface">Total</span>
            <span className="font-mono text-[22px] font-bold text-on-primary-container tabular-nums">
              {formatEuros(totals.total_cents)}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={handleReject}
            className="min-h-[48px] px-3 rounded-xl bg-error-container text-on-error-container font-semibold text-[14px] flex items-center justify-center cursor-pointer"
          >
            Rechazar
          </button>
          <button
            type="button"
            onClick={handleApproveAndPdf}
            className="col-span-2 min-h-[48px] px-4 rounded-xl bg-primary hover:bg-terracotta text-white font-semibold text-[14px] flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
          >
            <FileCheck2 className="w-5 h-5" />
            <span>Aprobar y generar PDF</span>
          </button>
        </div>
      </footer>
    </>
  );
}

/* ============================================================================
 * 2. REVISIÓN Y EMISIÓN DE FACTURA / ANTICIPO 40%
 * ==========================================================================*/
function InvoiceEmissionOverlay() {
  const {
    state,
    overlay,
    closeOverlay,
    emitInvoiceFromQuote,
    openPrintableDoc,
    getClientById,
  } = useAppStore();

  const quote =
    overlay?.kind === 'invoice'
      ? state.quotes.find((q) => q.id === overlay.quoteId)
      : undefined;

  const [mode, setMode] = useState<'anticipo' | 'completa'>(
    overlay?.kind === 'invoice' ? overlay.mode : 'completa',
  );
  const [concept, setConcept] = useState<string>(() => {
    if (!quote) return '';
    return overlay?.kind === 'invoice' && overlay.mode === 'anticipo'
      ? `Anticipo 40% · ${quote.title}`
      : quote.title;
  });

  useEffect(() => {
    if (!quote) return;
    setConcept(mode === 'anticipo' ? `Anticipo 40% · ${quote.title}` : quote.title);
  }, [mode, quote]);

  if (!quote) {
    closeOverlay();
    return null;
  }

  const client = getClientById(quote.client_id);
  const factor = mode === 'anticipo' ? 0.4 : 1;
  const baseCents = Math.round(quote.subtotal_cents * factor);
  const vatCents = Math.round((baseCents * quote.vat_rate) / 100);
  const totalCents = baseCents + vatCents;
  const nextNumber =
    mode === 'anticipo'
      ? `ANT-2026-${String(state.settings.next_anticipo_seq).padStart(3, '0')}`
      : `FAC-2026-${String(state.settings.next_invoice_seq).padStart(3, '0')}`;

  const handleConfirm = () => {
    const emitted = emitInvoiceFromQuote(quote.id, mode, concept);
    closeOverlay();
    if (emitted) {
      openPrintableDoc({ kind: 'invoice', id: emitted.id });
    }
  };

  return (
    <>
      <header className="shrink-0 h-[56px] bg-surface border-b border-outline-variant px-4 flex items-center justify-between">
        <button
          type="button"
          onClick={closeOverlay}
          aria-label="Cerrar emisión de factura"
          className="w-12 h-12 -ml-2 rounded-full text-on-surface inline-flex items-center justify-center hover:bg-surface-container cursor-pointer"
        >
          <X className="w-6 h-6" />
        </button>
        <div className="flex flex-col items-center">
          <h1 className="text-[16px] font-semibold text-on-surface">Revisar factura</h1>
          <span className="font-mono text-[12px] text-on-surface-variant tabular-nums">
            {nextNumber}
          </span>
        </div>
        <span className="px-2.5 py-1 rounded-full bg-success-container text-on-success-container font-semibold text-[11px]">
          Serie {mode === 'anticipo' ? 'ANT' : 'FAC'}
        </span>
      </header>

      <div className="flex-1 overflow-y-auto no-scrollbar px-4 pt-4 pb-6 flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-1 bg-surface-container-lowest border border-outline-variant rounded-full p-1">
          <button
            type="button"
            onClick={() => setMode('anticipo')}
            className={`min-h-[40px] rounded-full text-[13px] font-semibold cursor-pointer ${
              mode === 'anticipo'
                ? 'bg-terracotta-soft text-on-primary-container'
                : 'text-on-surface-variant'
            }`}
          >
            Anticipo 40%
          </button>
          <button
            type="button"
            onClick={() => setMode('completa')}
            className={`min-h-[40px] rounded-full text-[13px] font-semibold cursor-pointer ${
              mode === 'completa'
                ? 'bg-terracotta-soft text-on-primary-container'
                : 'text-on-surface-variant'
            }`}
          >
            Factura completa
          </button>
        </div>

        <section className="bg-surface-warm-card border border-outline-variant rounded-[20px] p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold text-on-surface-variant">
              Cliente destinatario
            </span>
            <span className="font-mono text-[12px] text-on-surface-variant tabular-nums">
              {client?.nif}
            </span>
          </div>
          <p className="text-[16px] font-semibold text-on-surface">{client?.name}</p>
          <p className="text-[13px] text-on-surface-variant">{client?.fiscal_address}</p>

          <label className="flex flex-col gap-1 pt-2 border-t border-outline-variant">
            <span className="text-[12px] font-semibold text-on-surface">
              Concepto en factura
            </span>
            <input
              type="text"
              value={concept}
              onChange={(e) => setConcept(e.target.value)}
              className="min-h-[46px] rounded-xl bg-surface-container-lowest border border-outline-variant px-3 text-[14px] text-on-surface"
            />
          </label>
        </section>

        <section className="bg-surface-container-lowest border border-outline-variant rounded-[20px] p-4 flex flex-col gap-2">
          <span className="text-[12px] font-semibold text-on-surface-variant">
            Origen: {quote.quote_code} ({formatEuros(quote.total_cents)})
          </span>
          <div className="flex justify-between text-[14px]">
            <span className="text-on-surface-variant">Base imponible</span>
            <span className="font-mono font-semibold tabular-nums">{formatEuros(baseCents)}</span>
          </div>
          <div className="flex justify-between text-[14px]">
            <span className="text-on-surface-variant">IVA ({quote.vat_rate}%)</span>
            <span className="font-mono font-semibold tabular-nums">{formatEuros(vatCents)}</span>
          </div>
          <div className="flex justify-between pt-2 border-t border-outline-variant items-baseline">
            <span className="text-[15px] font-semibold text-on-surface">Total factura</span>
            <span className="font-mono text-[22px] font-bold text-on-primary-container tabular-nums">
              {formatEuros(totalCents)}
            </span>
          </div>
        </section>
      </div>

      <footer className="shrink-0 bg-surface-container-lowest border-t border-outline-variant p-4 grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={closeOverlay}
          className="min-h-[48px] rounded-xl bg-surface-container text-on-surface font-semibold text-[14px] cursor-pointer"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          className="col-span-2 min-h-[48px] rounded-xl bg-primary text-white font-semibold text-[14px] flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
        >
          <FileCheck2 className="w-5 h-5" />
          <span>Emitir y ver PDF</span>
        </button>
      </footer>
    </>
  );
}

/* ============================================================================
 * 3. ESCÁNER DE TICKETS DE GASTO (GENERATIVE UI)
 * ==========================================================================*/
const SAMPLE_TICKETS: Array<{
  label: string;
  supplier: string;
  category: ExpenseCategory;
  totalEuros: string;
  vat: number;
}> = [
  { label: 'Saneamientos 66 €', supplier: 'Saneamientos García S.L.', category: 'Material', totalEuros: '66.00', vat: 21 },
  { label: 'Repsol 89,50 €', supplier: 'E.S. Repsol M-30', category: 'Gasoil furgoneta', totalEuros: '89.50', vat: 21 },
  { label: 'Leroy Merlin 145 €', supplier: 'Leroy Merlin Norte', category: 'Herramienta', totalEuros: '145.00', vat: 21 },
];

function TicketScannerOverlay() {
  const { state, overlay, closeOverlay, openOverlay, addExpenseTicket } = useAppStore();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const init = overlay?.kind === 'ticket' ? overlay : undefined;
  const [supplier, setSupplier] = useState(init?.initialSupplier ?? 'Saneamientos García S.L.');
  const [category, setCategory] = useState<ExpenseCategory>(init?.initialCategory ?? 'Material');
  const [jobId, setJobId] = useState(init?.initialJobId ?? state.jobs[0]?.id ?? '');
  const [totalStr, setTotalStr] = useState(
    ((init?.initialTotalCents ?? 6600) / 100).toFixed(2),
  );
  const [vatRate, setVatRate] = useState<number>(init?.initialVatRate ?? 21);
  const [imageUrl, setImageUrl] = useState<string>(init?.initialImageUrl ?? IMG_TICKET_RECEIPT);
  const [imgFailed, setImgFailed] = useState(false);

  const totalCents = Math.max(0, eurosToCents(parseSpanishNumber(totalStr)));
  const baseCents = Math.round(totalCents / (1 + vatRate / 100));
  const vatCents = totalCents - baseCents;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImageUrl(reader.result);
        setImgFailed(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    addExpenseTicket({
      job_id: jobId,
      supplier_name: supplier,
      issue_date_iso: TODAY_ISO,
      category,
      vat_rate: vatRate,
      total_cents: totalCents,
      image_url: imageUrl,
      chatCardRef: init?.chatCardRef,
    });
    closeOverlay();
  };

  return (
    <>
      <header className="shrink-0 h-[56px] bg-surface border-b border-outline-variant px-4 flex items-center justify-between">
        <button
          type="button"
          onClick={closeOverlay}
          aria-label="Cerrar escáner"
          className="w-12 h-12 -ml-2 rounded-full text-on-surface inline-flex items-center justify-center hover:bg-surface-container cursor-pointer"
        >
          <X className="w-6 h-6" />
        </button>
        <h1 className="text-[16px] font-semibold text-on-surface">Escanear Ticket o Foto</h1>
        <span className="w-12" />
      </header>

      <div className="flex-1 overflow-y-auto no-scrollbar px-4 pt-4 pb-6 flex flex-col gap-4">
        {/* Selector de modo */}
        <div className="grid grid-cols-2 gap-1 bg-surface-container-lowest border border-outline-variant rounded-full p-1">
          <button
            type="button"
            aria-pressed="true"
            className="min-h-[40px] rounded-full bg-terracotta-soft text-on-primary-container font-semibold text-[12px] inline-flex items-center justify-center gap-1.5"
          >
            <ReceiptText className="w-4 h-4" />
            <span>Ticket de gasto</span>
          </button>
          <button
            type="button"
            onClick={() =>
              openOverlay({
                kind: 'photo',
                initialJobId: jobId || state.jobs[0]?.id,
                initialCaption: 'Avance de obra sellado',
                initialImageUrl: IMG_PLUMBING_PIPE,
              })
            }
            className="min-h-[40px] rounded-full text-on-surface-variant font-semibold text-[12px] inline-flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Camera className="w-4 h-4" />
            <span>Foto de obra</span>
          </button>
        </div>

        {/* Visor de captura + subir foto */}
        <div className="relative rounded-[20px] overflow-hidden border border-outline-variant shadow-[0_2px_10px_rgba(15,23,42,0.04)] bg-surface-warm-card">
          {!imgFailed ? (
            <img
              src={imageUrl}
              alt="Ticket capturado para lectura local"
              referrerPolicy="no-referrer"
              onError={() => setImgFailed(true)}
              className="w-full h-44 object-cover"
            />
          ) : (
            <div className="w-full h-44 flex flex-col items-center justify-center gap-2 text-on-surface-variant">
              <ReceiptText className="w-10 h-10" />
              <span className="text-[13px] font-semibold">Vista previa del ticket</span>
            </div>
          )}

          <div className="px-3 py-2 bg-secondary text-on-secondary flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <ScanLine className="w-4 h-4" />
              <span className="text-[11px] font-semibold">Lectura local completada</span>
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-[11px] font-semibold bg-white/15 hover:bg-white/25 px-2.5 py-1 rounded-full inline-flex items-center gap-1 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Subir foto</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>
        </div>

        {/* Ejemplos de un toque */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {SAMPLE_TICKETS.map((sample) => (
            <button
              key={sample.label}
              type="button"
              onClick={() => {
                setSupplier(sample.supplier);
                setCategory(sample.category);
                setTotalStr(sample.totalEuros);
                setVatRate(sample.vat);
              }}
              className="min-h-[34px] px-3 rounded-full bg-surface-container-lowest border border-outline-variant hover:border-terracotta text-[11px] font-semibold text-on-surface shrink-0 cursor-pointer"
            >
              {sample.label}
            </button>
          ))}
        </div>

        {/* Formulario de revisión */}
        <section className="bg-surface-warm-card border border-outline-variant rounded-[20px] p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[16px] font-semibold text-on-surface">Datos del ticket</h2>
            <span className="px-2.5 py-0.5 rounded-full bg-success-container text-on-success-container font-semibold text-[11px]">
              Deducible 2026-T4
            </span>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-on-surface-variant">Proveedor</span>
            <input
              type="text"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              className="min-h-[46px] w-full rounded-xl bg-surface-container-lowest border border-outline-variant px-3 text-[14px] text-on-surface"
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-on-surface-variant">Categoría</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                className="min-h-[46px] w-full rounded-xl bg-surface-container-lowest border border-outline-variant px-2.5 text-[13px] font-semibold text-on-surface"
              >
                <option value="Material">Material</option>
                <option value="Herramienta">Herramienta</option>
                <option value="Gasoil furgoneta">Gasoil furgoneta</option>
                <option value="Subcontrata">Subcontrata</option>
                <option value="Otros">Otros</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-on-surface-variant">
                Vincular a obra
              </span>
              <select
                value={jobId}
                onChange={(e) => setJobId(e.target.value)}
                className="min-h-[46px] w-full rounded-xl bg-surface-container-lowest border border-outline-variant px-2.5 font-mono text-[12px] text-on-surface"
              >
                <option value="">Sin obra (general)</option>
                {state.jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.job_code}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-on-surface-variant">
                Total ticket (€)
              </span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={totalStr}
                onChange={(e) => setTotalStr(e.target.value)}
                className="min-h-[46px] w-full rounded-xl bg-surface-container-lowest border border-outline-variant px-3 font-mono text-[15px] font-bold text-on-surface tabular-nums"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-on-surface-variant">IVA (%)</span>
              <select
                value={vatRate}
                onChange={(e) => setVatRate(Number(e.target.value))}
                className="min-h-[46px] w-full rounded-xl bg-surface-container-lowest border border-outline-variant px-3 font-mono text-[14px] text-on-surface"
              >
                <option value={21}>21%</option>
                <option value={10}>10%</option>
                <option value={4}>4%</option>
              </select>
            </label>
          </div>

          <div className="flex flex-col gap-1 pt-2 border-t border-outline-variant">
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-on-surface-variant">Base imponible</span>
              <span className="font-mono font-semibold text-on-surface tabular-nums">
                {formatEuros(baseCents)}
              </span>
            </div>
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-on-surface-variant">IVA deducible ({vatRate}%)</span>
              <span className="font-mono font-semibold text-on-success-container tabular-nums">
                {formatEuros(vatCents)}
              </span>
            </div>
            <div className="flex items-center justify-between pt-1.5 border-t border-outline-variant">
              <span className="text-[15px] font-semibold text-on-surface">Total ticket</span>
              <span className="font-mono text-[22px] font-bold text-on-surface tabular-nums">
                {formatEuros(totalCents)}
              </span>
            </div>
          </div>
        </section>
      </div>

      <footer className="shrink-0 bg-surface-container-lowest border-t border-outline-variant p-4 grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="min-h-[48px] px-3 rounded-xl bg-surface-container text-on-surface font-semibold text-[14px] flex items-center justify-center cursor-pointer"
        >
          Repetir
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={totalCents <= 0}
          className="col-span-2 min-h-[48px] px-4 rounded-xl bg-primary text-white font-semibold text-[14px] flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-40 cursor-pointer"
        >
          <PiggyBank className="w-5 h-5" />
          <span>Guardar en Hucha Fiscal</span>
        </button>
      </footer>
    </>
  );
}

/* ============================================================================
 * 4. FOTO SELLADA DE DIARIO DE OBRA
 * ==========================================================================*/
function JobPhotoOverlay() {
  const { state, overlay, closeOverlay, openOverlay, addJobPhoto } = useAppStore();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const init = overlay?.kind === 'photo' ? overlay : undefined;
  const [jobId, setJobId] = useState(init?.initialJobId ?? state.jobs[0]?.id ?? '');
  const [caption, setCaption] = useState(
    init?.initialCaption ?? 'Comprobación de tubería sin fugas antes de tapar roza',
  );
  const [imageUrl, setImageUrl] = useState(init?.initialImageUrl ?? IMG_PLUMBING_PIPE);

  const selectedJob = state.jobs.find((j) => j.id === jobId);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setImageUrl(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    if (!jobId) return;
    addJobPhoto({
      job_id: jobId,
      caption,
      image_url: imageUrl,
      location_label: selectedJob?.address,
    });
    closeOverlay();
  };

  return (
    <>
      <header className="shrink-0 h-[56px] bg-surface border-b border-outline-variant px-4 flex items-center justify-between">
        <button
          type="button"
          onClick={closeOverlay}
          aria-label="Cerrar cámara de obra"
          className="w-12 h-12 -ml-2 rounded-full text-on-surface inline-flex items-center justify-center hover:bg-surface-container cursor-pointer"
        >
          <X className="w-6 h-6" />
        </button>
        <h1 className="text-[16px] font-semibold text-on-surface">Sellar Foto de Obra</h1>
        <span className="w-12" />
      </header>

      <div className="flex-1 overflow-y-auto no-scrollbar px-4 pt-4 pb-6 flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-1 bg-surface-container-lowest border border-outline-variant rounded-full p-1">
          <button
            type="button"
            onClick={() =>
              openOverlay({
                kind: 'ticket',
                initialJobId: jobId,
                initialImageUrl: IMG_TICKET_RECEIPT,
              })
            }
            className="min-h-[40px] rounded-full text-on-surface-variant font-semibold text-[12px] inline-flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <ReceiptText className="w-4 h-4" />
            <span>Ticket de gasto</span>
          </button>
          <button
            type="button"
            aria-pressed="true"
            className="min-h-[40px] rounded-full bg-terracotta-soft text-on-primary-container font-semibold text-[12px] inline-flex items-center justify-center gap-1.5"
          >
            <Camera className="w-4 h-4" />
            <span>Foto de obra</span>
          </button>
        </div>

        <div className="relative rounded-[20px] overflow-hidden border border-outline-variant">
          <img
            src={imageUrl}
            alt="Foto de obra para diario"
            referrerPolicy="no-referrer"
            className="w-full h-52 object-cover"
          />
          <div className="px-3 py-2 bg-secondary text-white flex items-center justify-between">
            <span className="font-mono text-[11px] tabular-nums">
              23 nov 2026 · {selectedJob?.job_code ?? 'OBRA'}
            </span>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-[11px] font-semibold bg-white/15 px-2.5 py-1 rounded-full inline-flex items-center gap-1 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Cambiar foto</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setImageUrl(IMG_PLUMBING_PIPE);
              setCaption('Roza abierta y codo PVC probado sin fugas');
            }}
            className="flex-1 min-h-[38px] rounded-full bg-surface-container-lowest border border-outline-variant text-[12px] font-semibold cursor-pointer"
          >
            Ejemplo: Desagüe
          </button>
          <button
            type="button"
            onClick={() => {
              setImageUrl(IMG_SHOWER_TILING);
              setCaption('Alicatado porcelánico nivelado en zona ducha');
            }}
            className="flex-1 min-h-[38px] rounded-full bg-surface-container-lowest border border-outline-variant text-[12px] font-semibold cursor-pointer"
          >
            Ejemplo: Alicatado
          </button>
        </div>

        <section className="bg-surface-warm-card border border-outline-variant rounded-[20px] p-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-on-surface">Obra vinculada</span>
            <select
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
              className="min-h-[46px] rounded-xl bg-surface-container-lowest border border-outline-variant px-3 text-[14px] text-on-surface"
            >
              {state.jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.job_code} · {j.title}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-on-surface">
              Descripción para el Diario de Obra
            </span>
            <textarea
              rows={2}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              className="w-full rounded-xl bg-surface-container-lowest border border-outline-variant p-3 text-[14px] text-on-surface"
            />
          </label>
        </section>
      </div>

      <footer className="shrink-0 bg-surface-container-lowest border-t border-outline-variant p-4 grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={closeOverlay}
          className="min-h-[48px] rounded-xl bg-surface-container text-on-surface font-semibold text-[14px] cursor-pointer"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="col-span-2 min-h-[48px] rounded-xl bg-primary text-white font-semibold text-[14px] flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
        >
          <ShieldCheck className="w-5 h-5" />
          <span>Sellar foto en obra</span>
        </button>
      </footer>
    </>
  );
}

/* ============================================================================
 * 5. PARTE DE JORNADA (CALENDARIO / DESVIACIONES)
 * ==========================================================================*/
const DEVIATION_REASONS = [
  'Imprevisto en instalación',
  'Falta de material',
  'Más rápido de lo previsto',
  'Ampliación del cliente',
];

const QUICK_DELTAS = [
  { label: '-1,5 h', delta: -1.5 },
  { label: '-30 m', delta: -0.5 },
  { label: 'En hora', delta: 0 },
  { label: '+30 m', delta: 0.5 },
  { label: '+1 h', delta: 1 },
  { label: '+2 h', delta: 2 },
];

function ScheduleLogOverlay() {
  const { state, overlay, closeOverlay, saveScheduleLog } = useAppStore();
  const init = overlay?.kind === 'schedule' ? overlay : undefined;

  const existingEntry = state.scheduleEntries.find(
    (e) =>
      (init?.entryId && e.id === init.entryId) ||
      (init && e.job_id === init.jobId && e.date_iso === init.dateIso),
  );
  const job = state.jobs.find((j) => j.id === (init?.jobId ?? existingEntry?.job_id));
  const dailyDefaults = calculateDailyHoursFromDefaults(state.workScheduleDefaults);

  const plannedHours = existingEntry?.planned_hours ?? (dailyDefaults.totalHours || 8);
  const plannedEnd = existingEntry?.planned_end ?? state.workScheduleDefaults.afternoon_end;
  const initialDelta =
    init?.initialDeltaHours !== undefined
      ? init.initialDeltaHours
      : existingEntry?.actual_hours !== undefined
        ? Math.round((existingEntry.actual_hours - plannedHours) * 10) / 10
        : 2;

  const [delta, setDelta] = useState<number>(initialDelta);
  const [reason, setReason] = useState<string>(
    init?.initialReason ?? existingEntry?.deviation_reason ?? 'Imprevisto en instalación',
  );
  const [notes, setNotes] = useState<string>(
    init?.initialNotes ??
      existingEntry?.notes ??
      'Tuvimos que sustituir el codo de desagüe antiguo tras abrir la roza.',
  );
  const [linkToDiary, setLinkToDiary] = useState<boolean>(true);

  const actualHours = Math.max(1, Math.round((plannedHours + delta) * 10) / 10);
  const actualEnd = minutesToHHMM(parseTimeToMinutes(plannedEnd) + Math.round(delta * 60));
  const impactCents = Math.round(delta * state.settings.hourly_rate_cents);

  const jobDaysCount = state.scheduleEntries.filter((e) => e.job_id === job?.id).length;
  const totalPlannedJobHours = state.scheduleEntries
    .filter((e) => e.job_id === job?.id)
    .reduce((s, e) => s + e.planned_hours, 0);

  const handleSave = () => {
    if (!init) return;
    saveScheduleLog({
      entryId: existingEntry?.id,
      jobId: init.jobId,
      dateIso: init.dateIso,
      actualHours,
      actualEnd,
      deviationReason: delta === 0 ? 'En hora' : reason,
      notes,
      linkToDiary,
      chatCardRef: init.chatCardRef,
    });
    closeOverlay();
  };

  return (
    <>
      <header className="shrink-0 h-[56px] bg-surface border-b border-outline-variant px-4 flex items-center justify-between">
        <button
          type="button"
          onClick={closeOverlay}
          aria-label="Cerrar parte"
          className="w-12 h-12 -ml-2 rounded-full text-on-surface inline-flex items-center justify-center hover:bg-surface-container cursor-pointer"
        >
          <X className="w-6 h-6" />
        </button>

        <div className="flex flex-col items-center">
          <h1 className="text-[16px] font-semibold text-on-surface">Parte del día</h1>
          <span className="font-mono text-[12px] text-on-surface-variant tabular-nums">
            {job?.job_code ?? 'OBRA'} · {formatShortDate(init?.dateIso)}
          </span>
        </div>

        <span className="px-2.5 py-1 rounded-full bg-surface-container text-on-surface font-mono text-[12px] tabular-nums">
          {formatEuros(state.settings.hourly_rate_cents, false)}/h
        </span>
      </header>

      <div className="flex-1 overflow-y-auto no-scrollbar px-4 pt-4 pb-6 flex flex-col gap-4">
        {/* Planificación de obra */}
        <section className="bg-surface-container-lowest border border-outline-variant rounded-[20px] p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold text-on-surface-variant">
              Planificación: {formatDateRange(job?.start_date_iso, job?.end_date_iso)}
            </span>
            <span className="text-[12px] font-semibold text-on-primary-container">
              {job?.title}
            </span>
          </div>
          <p className="text-[14px] text-on-surface">
            {jobDaysCount || 1} días laborables × {plannedHours.toFixed(0)}h habituales ={' '}
            <strong className="font-mono tabular-nums">
              {totalPlannedJobHours || plannedHours} horas previstas
            </strong>
          </p>
        </section>

        {/* Hora prevista vs real */}
        <section className="bg-surface-container-lowest border border-outline-variant rounded-[20px] p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-surface-container-low rounded-2xl p-3 flex flex-col gap-0.5">
              <span className="text-[11px] font-semibold text-on-surface-variant">
                Salida prevista
              </span>
              <span className="font-mono text-[24px] font-bold text-on-surface tabular-nums">
                {plannedEnd}
              </span>
              <span className="font-mono text-[12px] text-on-surface-variant tabular-nums">
                {formatHours(plannedHours)}
              </span>
            </div>

            <div
              className={`rounded-2xl p-3 border border-outline-variant flex flex-col gap-0.5 ${
                delta > 0
                  ? 'bg-warning-container text-on-warning-container'
                  : delta < 0
                    ? 'bg-info-container text-on-info-container'
                    : 'bg-success-container text-on-success-container'
              }`}
            >
              <span className="text-[11px] font-semibold">Salida real</span>
              <span className="font-mono text-[24px] font-bold tabular-nums">
                {actualEnd}
              </span>
              <span className="font-mono text-[12px] tabular-nums">
                {formatHours(actualHours)}
              </span>
            </div>
          </div>

          {/* Botones rápidos de ajuste */}
          <div className="grid grid-cols-3 gap-2">
            {QUICK_DELTAS.map((opt) => {
              const active = Math.abs(delta - opt.delta) < 0.01;
              return (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setDelta(opt.delta)}
                  className={`min-h-[44px] rounded-xl font-mono text-[12px] font-semibold tabular-nums transition-colors cursor-pointer ${
                    active
                      ? 'bg-terracotta-soft border-2 border-terracotta text-on-primary-container'
                      : 'bg-surface-container-low border border-outline-variant text-on-surface hover:border-terracotta'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {/* Banner dinámico */}
          {delta > 0 ? (
            <div className="rounded-2xl bg-warning-container border border-outline-variant p-3 flex items-center gap-2">
              <Clock className="w-5 h-5 text-on-warning-container shrink-0" />
              <span className="text-[12px] font-semibold text-on-warning-container">
                Jornada alargada {formatSignedHours(delta)} ({formatSignedEuros(impactCents)} según tu tarifa/hora)
              </span>
            </div>
          ) : delta < 0 ? (
            <div className="rounded-2xl bg-info-container border border-outline-variant p-3 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-on-info-container shrink-0" />
              <span className="text-[12px] font-semibold text-on-info-container">
                Terminado {formatHours(Math.abs(delta))} antes de lo previsto ({formatSignedEuros(impactCents)})
              </span>
            </div>
          ) : (
            <div className="rounded-2xl bg-success-container border border-outline-variant p-3 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-on-success-container shrink-0" />
              <span className="text-[12px] font-semibold text-on-success-container">
                Jornada cumplida según horario habitual ({formatHours(plannedHours)})
              </span>
            </div>
          )}
        </section>

        {/* Motivo y nota */}
        <section className="bg-surface-container-lowest border border-outline-variant rounded-[20px] p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col gap-3">
          <h2 className="text-[15px] font-semibold text-on-surface">Motivo del cambio</h2>

          <div className="flex flex-wrap gap-1.5">
            {DEVIATION_REASONS.map((item) => {
              const selected = reason === item;
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => setReason(item)}
                  aria-pressed={selected}
                  className={`min-h-[38px] px-3 rounded-full text-[12px] font-semibold cursor-pointer transition-colors ${
                    selected
                      ? 'bg-terracotta-soft border border-terracotta text-on-primary-container'
                      : 'bg-surface-container-low border border-outline-variant text-on-surface'
                  }`}
                >
                  {item}
                </button>
              );
            })}
          </div>

          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anota qué ocurrió en obra hoy..."
            className="w-full rounded-xl bg-surface-container-low border border-outline-variant p-3 text-[14px] text-on-surface focus:outline-none focus:border-terracotta"
          />

          <label className="flex items-center gap-2.5 min-h-[46px] px-3 rounded-xl bg-surface-container-low cursor-pointer">
            <input
              type="checkbox"
              checked={linkToDiary}
              onChange={(e) => setLinkToDiary(e.target.checked)}
              className="w-4 h-4 rounded border-outline accent-terracotta shrink-0"
            />
            <span className="text-[13px] text-on-surface">
              Vincular esta nota al Diario de Obra
            </span>
          </label>
        </section>
      </div>

      <footer className="shrink-0 bg-surface-container-lowest border-t border-outline-variant p-4 grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={closeOverlay}
          className="min-h-[48px] rounded-xl bg-surface-container text-on-surface font-semibold text-[14px] cursor-pointer"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="col-span-2 min-h-[48px] rounded-xl bg-primary text-white font-semibold text-[14px] flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
        >
          <Save className="w-5 h-5" />
          <span>Guardar parte del día</span>
        </button>
      </footer>
    </>
  );
}
