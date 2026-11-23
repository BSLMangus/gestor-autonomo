import { useEffect, useMemo, useRef, useState } from "react";
import {
  Gate1QuoteCommitPayloadSchema,
} from "../../../core/contracts/schemas";
import type {
  ActiveWidgetEnvelope,
  CatalogCategory,
  CatalogItemRow,
  ClientRow,
  Gate1QuoteDraftPayload,
  QuoteVatRate,
} from "../../../core/contracts/types";
import { CatalogRepository } from "../../../core/db/repositories/catalogRepo";
import { ClientsRepository } from "../../../core/db/repositories/clientsRepo";
import { SettingsRepository } from "../../../core/db/repositories/settingsRepo";
import { computeQuoteTotals, formatCentsEs } from "../../../core/fiscal/fiscalEngine";
import { formatPricingBreakdown } from "../../../core/pricing/pricingEngine";
import { normalizeSpanishText } from "../../../core/text/spanishText";
import {
  centsToInitialPriceText,
  eurInputToCents,
  formatPriceInputOnBlur,
  sanitizeDecimalPriceInput,
  shouldClearPriceOnFocus,
} from "./priceInputUtils";
import type { WidgetCommonProps } from "./widgetTypes";

type QuoteWidget = Extract<ActiveWidgetEnvelope, { ui_widget_type: "QuoteBuilderWidget" }>;

const CATEGORIES: CatalogCategory[] = [
  "Fontanería",
  "Electricidad",
  "Albañilería",
  "Pintura",
  "General",
];

function stripComputedTotals(payload: QuoteWidget["widget_payload"]): Gate1QuoteDraftPayload {
  const { subtotal_cents: _s, vat_cents: _v, total_cents: _t, ...draft } = payload;
  return draft;
}

function thousandthsToQtyInput(t: number): string {
  return String(t / 1000);
}

function qtyInputToThousandths(raw: string): number {
  const normalized = raw.replace(",", ".").trim();
  const val = Number.parseFloat(normalized);
  if (!Number.isFinite(val) || val < 0) return 0;
  return Math.round(val * 1000);
}

function PriceInput({
  valueCents,
  disabled,
  testId,
  ariaLabel,
  onChangeCents,
}: {
  valueCents: number;
  disabled: boolean;
  testId: string;
  ariaLabel: string;
  onChangeCents: (cents: number) => void;
}) {
  const [text, setText] = useState<string>(() => centsToInitialPriceText(valueCents));
  const isFocusedRef = useRef(false);

  useEffect(() => {
    if (isFocusedRef.current) return;
    if (valueCents === 0) {
      if (eurInputToCents(text) !== 0) {
        setText("");
      }
      return;
    }
    if (eurInputToCents(text) !== valueCents || text.trim() === "") {
      setText((valueCents / 100).toFixed(2));
    }
  }, [valueCents, text]);

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      placeholder="0.00"
      data-testid={testId}
      aria-label={ariaLabel}
      disabled={disabled}
      value={text}
      onFocus={() => {
        isFocusedRef.current = true;
        if (shouldClearPriceOnFocus(text)) {
          setText("");
        }
      }}
      onChange={(e) => {
        const cleaned = sanitizeDecimalPriceInput(e.target.value);
        setText(cleaned);
        onChangeCents(eurInputToCents(cleaned));
      }}
      onBlur={() => {
        isFocusedRef.current = false;
        const { display, cents } = formatPriceInputOnBlur(text);
        setText(display);
        onChangeCents(cents);
      }}
      className="min-w-0 w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
    />
  );
}

export function QuoteBuilderWidget({
  widget,
  isActiveGate,
  activePendingGate,
  isSubmitting,
  runtime,
  onResumeDecision,
}: WidgetCommonProps) {
  const quoteWidget = widget as QuoteWidget;
  const initialDraft = useMemo(
    () => stripComputedTotals(quoteWidget.widget_payload),
    [quoteWidget]
  );
  const initialJson = useMemo(() => JSON.stringify(initialDraft), [initialDraft]);

  const [draft, setDraft] = useState<Gate1QuoteDraftPayload>(initialDraft);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogItemRow[]>([]);
  const [hourlyRateCents, setHourlyRateCents] = useState(3800);
  const [showCatalogPicker, setShowCatalogPicker] = useState(false);
  const [catalogFilter, setCatalogFilter] = useState("");
  const [useNewClient, setUseNewClient] = useState<boolean>(
    Boolean(initialDraft.new_client && !initialDraft.client_id)
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(initialDraft);
    setUseNewClient(Boolean(initialDraft.new_client && !initialDraft.client_id));
    setValidationError(null);
    setShowCatalogPicker(false);
    setCatalogFilter("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJson]);

  useEffect(() => {
    let active = true;
    Promise.all([
      new ClientsRepository(runtime.executor).listPaginated({ limit: 100, offset: 0 }),
      new CatalogRepository(runtime.executor).listPaginated({ limit: 100, offset: 0 }),
      new SettingsRepository(runtime.executor).getAppSettings(),
    ])
      .then(([clRes, catRes, settingsRes]) => {
        if (!active) return;
        setClients(clRes.items);
        setCatalogItems(catRes.items);
        setHourlyRateCents(settingsRes.hourly_rate_cents);
      })
      .catch(() => {
        // ignore secondary load error
      });
    return () => {
      active = false;
    };
  }, [runtime.executor]);

  const canAct = isActiveGate && activePendingGate === "gate_1_quote";
  const totals = useMemo(
    () => computeQuoteTotals(draft.lines, draft.vat_rate),
    [draft.lines, draft.vat_rate]
  );

  const isDirty = useMemo(() => JSON.stringify(draft) !== initialJson, [draft, initialJson]);

  const updateLine = (
    idx: number,
    patch: Partial<Gate1QuoteDraftPayload["lines"][number]>
  ) => {
    setDraft((prev) => ({
      ...prev,
      lines: prev.lines.map((line, i) => (i === idx ? { ...line, ...patch } : line)),
    }));
  };

  const addEmptyLine = () => {
    setDraft((prev) => ({
      ...prev,
      lines: [
        ...prev.lines,
        {
          catalog_item_id: null,
          description: "",
          category: "General",
          unit: "ud",
          quantity_thousandths: 1000,
          unit_price_cents: 0,
          original_unit_price_cents: 0,
          save_to_catalog: false,
        },
      ],
    }));
  };

  const removeLine = (idx: number) => {
    setDraft((prev) => ({
      ...prev,
      lines: prev.lines.filter((_, i) => i !== idx),
    }));
  };

  const addLineFromCatalog = (item: CatalogItemRow) => {
    const newLine: Gate1QuoteDraftPayload["lines"][number] = {
      catalog_item_id: item.id,
      description: item.description,
      category: item.category,
      unit: item.unit,
      quantity_thousandths: 1000,
      unit_price_cents: item.unit_price_cents,
      original_unit_price_cents: item.unit_price_cents,
      save_to_catalog: false,
    };
    setDraft((prev) => {
      const onlyPlaceholder =
        prev.lines.length === 1 &&
        !prev.lines[0]!.description.trim() &&
        prev.lines[0]!.unit_price_cents === 0;
      return {
        ...prev,
        lines: onlyPlaceholder ? [newLine] : [...prev.lines, newLine],
      };
    });
    setShowCatalogPicker(false);
    setCatalogFilter("");
  };

  const filteredCatalog = useMemo(() => {
    const q = normalizeSpanishText(catalogFilter);
    if (!q) return catalogItems;
    return catalogItems.filter((c) =>
      normalizeSpanishText(`${c.description} ${c.category}`).includes(q)
    );
  }, [catalogItems, catalogFilter]);

  const handleConfirm = async () => {
    setValidationError(null);
    const parsed = Gate1QuoteCommitPayloadSchema.safeParse(draft);
    if (!parsed.success) {
      setValidationError(
        parsed.error.issues.map((iss) => iss.message).join(" · ")
      );
      return;
    }

    if (isDirty) {
      await onResumeDecision({
        gate_id: "gate_1_quote",
        action: "edit",
        edited_payload: parsed.data,
        client_validated_at_ms: Date.now(),
      });
    } else {
      await onResumeDecision({
        gate_id: "gate_1_quote",
        action: "approve",
        client_validated_at_ms: Date.now(),
      });
    }
  };

  const handleReject = async () => {
    setValidationError(null);
    await onResumeDecision({
      gate_id: "gate_1_quote",
      action: "reject",
      rejection_reason: "Rechazado por el usuario",
      client_validated_at_ms: Date.now(),
    });
  };

  return (
    <section
      data-testid="quote-builder-widget"
      className="mt-2 w-full max-w-full overflow-x-hidden rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm text-slate-900"
    >
      <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2.5">
        <div className="min-w-0 flex-1">
          <span className="inline-flex items-center rounded-full bg-orange-100 px-2.5 py-0.5 text-[11px] font-semibold text-orange-800">
            {canAct ? "Revisión de presupuesto" : "Presupuesto"}
          </span>
          <h3 className="mt-1 break-words [overflow-wrap:anywhere] text-sm font-bold text-slate-900">
            {draft.job_title || "Nuevo presupuesto"}
          </h3>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[11px] text-slate-500">Total c/IVA ({draft.vat_rate} %)</div>
          <div data-testid="quote-total-display" className="text-base font-extrabold text-slate-900 tabular-nums">
            {formatCentsEs(totals.totalCents)}
          </div>
        </div>
      </div>

      <div className="mt-3 space-y-3">
        <div>
          <label className="block text-xs font-semibold text-slate-700" htmlFor="qb-job-title">
            Título de la obra
          </label>
          <input
            id="qb-job-title"
            data-testid="quote-job-title-input"
            type="text"
            disabled={!canAct || isSubmitting}
            value={draft.job_title}
            onChange={(e) => setDraft((p) => ({ ...p, job_title: e.target.value }))}
            placeholder="Ej: Cambio termo eléctrico 80L"
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
          />
        </div>

        <div className="rounded-xl bg-slate-50 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-700">Cliente</span>
            {canAct && (
              <div className="flex gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setUseNewClient(false);
                    setDraft((p) => ({ ...p, new_client: undefined }));
                  }}
                  className={`rounded-lg px-2.5 py-1 font-medium ${
                    !useNewClient
                      ? "bg-slate-900 text-white"
                      : "bg-white text-slate-700 border border-slate-200"
                  }`}
                >
                  Existente
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUseNewClient(true);
                    setDraft((p) => ({
                      ...p,
                      client_id: null,
                      new_client: p.new_client ?? { name: "", phone: "", nif: "", fiscal_address: "" },
                    }));
                  }}
                  className={`rounded-lg px-2.5 py-1 font-medium ${
                    useNewClient
                      ? "bg-slate-900 text-white"
                      : "bg-white text-slate-700 border border-slate-200"
                  }`}
                >
                  Nuevo cliente
                </button>
              </div>
            )}
          </div>

          {!useNewClient ? (
            <select
              aria-label="Seleccionar cliente existente"
              data-testid="quote-client-select"
              disabled={!canAct || isSubmitting}
              value={draft.client_id ?? ""}
              onChange={(e) =>
                setDraft((p) => ({
                  ...p,
                  client_id: e.target.value || null,
                  new_client: undefined,
                }))
              }
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100"
            >
              <option value="">-- Seleccionar cliente --</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.phone ? `(${c.phone})` : ""}
                </option>
              ))}
            </select>
          ) : (
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                type="text"
                disabled={!canAct || isSubmitting}
                placeholder="Nombre completo *"
                value={draft.new_client?.name ?? ""}
                onChange={(e) =>
                  setDraft((p) => ({
                    ...p,
                    client_id: null,
                    new_client: { ...(p.new_client ?? { name: "" }), name: e.target.value },
                  }))
                }
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
              />
              <input
                type="tel"
                disabled={!canAct || isSubmitting}
                placeholder="Teléfono (+34...)"
                value={draft.new_client?.phone ?? ""}
                onChange={(e) =>
                  setDraft((p) => ({
                    ...p,
                    client_id: null,
                    new_client: { ...(p.new_client ?? { name: "" }), phone: e.target.value },
                  }))
                }
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
              />
              <input
                type="text"
                disabled={!canAct || isSubmitting}
                placeholder="NIF/CIF (opcional)"
                value={draft.new_client?.nif ?? ""}
                onChange={(e) =>
                  setDraft((p) => ({
                    ...p,
                    client_id: null,
                    new_client: { ...(p.new_client ?? { name: "" }), nif: e.target.value },
                  }))
                }
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
              />
              <input
                type="text"
                disabled={!canAct || isSubmitting}
                placeholder="Domicilio fiscal"
                value={draft.new_client?.fiscal_address ?? ""}
                onChange={(e) =>
                  setDraft((p) => ({
                    ...p,
                    client_id: null,
                    new_client: {
                      ...(p.new_client ?? { name: "" }),
                      fiscal_address: e.target.value,
                    },
                  }))
                }
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-700">Tipo de IVA aplicable</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {([10, 21] as QuoteVatRate[]).map((rate) => (
              <button
                key={rate}
                type="button"
                data-testid={`quote-vat-${rate}`}
                disabled={!canAct || isSubmitting}
                onClick={() => setDraft((p) => ({ ...p, vat_rate: rate }))}
                className={`min-h-9 rounded-xl px-3 text-xs font-bold ${
                  draft.vat_rate === rate
                    ? "bg-orange-600 text-white"
                    : "bg-slate-100 text-slate-700"
                }`}
              >
                {rate} %
              </button>
            ))}
            <div className="flex items-center rounded-xl border border-slate-300 bg-white px-2">
              <input
                type="number"
                step="0.5"
                min="0"
                max="100"
                aria-label="IVA personalizado (%)"
                data-testid="quote-vat-custom-input"
                disabled={!canAct || isSubmitting}
                value={draft.vat_rate}
                onChange={(e) => {
                  const val = Number.parseFloat(e.target.value.replace(",", "."));
                  if (Number.isFinite(val)) {
                    setDraft((p) => ({
                      ...p,
                      vat_rate: Math.max(0, Math.min(100, val)),
                    }));
                  }
                }}
                className="w-12 py-1.5 text-right text-xs font-bold text-slate-900 focus:outline-none disabled:bg-transparent"
              />
              <span className="text-xs font-bold text-slate-500">%</span>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-700">
              Partidas ({draft.lines.length})
            </span>
            {canAct && (
              <div className="flex items-center gap-1.5">
                {catalogItems.length > 0 && (
                  <button
                    type="button"
                    data-testid="quote-catalog-picker-btn"
                    disabled={isSubmitting}
                    onClick={() => setShowCatalogPicker((v) => !v)}
                    className="rounded-lg border border-orange-300 bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-800"
                  >
                    + Desde tarifario
                  </button>
                )}
                <button
                  type="button"
                  data-testid="quote-add-line"
                  disabled={isSubmitting}
                  onClick={addEmptyLine}
                  className="rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white"
                >
                  + Añadir partida
                </button>
              </div>
            )}
          </div>

          {canAct && showCatalogPicker && (
            <div className="rounded-xl border border-orange-200 bg-orange-50/70 p-2.5 space-y-2">
              <input
                type="search"
                value={catalogFilter}
                onChange={(e) => setCatalogFilter(e.target.value)}
                placeholder="Buscar en tarifario local..."
                className="w-full rounded-lg border border-orange-200 bg-white px-2.5 py-1.5 text-xs"
              />
              <div className="max-h-44 overflow-y-auto space-y-1">
                {filteredCatalog.length === 0 ? (
                  <div className="text-center text-[11px] text-slate-500 py-2">
                    Sin partidas coincidentes
                  </div>
                ) : (
                  filteredCatalog.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => addLineFromCatalog(item)}
                      className="w-full max-w-full overflow-hidden flex items-center justify-between gap-2 rounded-lg border border-orange-100 bg-white px-2.5 py-1.5 text-left text-xs hover:bg-orange-50"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="line-clamp-2 break-words [overflow-wrap:anywhere] font-semibold text-slate-900">
                          {item.description}
                        </div>
                        <div className="break-words text-[10px] text-slate-500">
                          {item.category} ·{" "}
                          {formatPricingBreakdown({
                            pricing_mode: item.pricing_mode,
                            estimated_hours_thousandths: item.estimated_hours_thousandths,
                            materials_cents: item.materials_cents,
                            hourly_rate_cents: hourlyRateCents,
                            unit_price_cents: item.unit_price_cents,
                          })}
                        </div>
                      </div>
                      <span className="shrink-0 font-bold text-orange-700">
                        {formatCentsEs(item.unit_price_cents)}/{item.unit}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {draft.lines.map((line, idx) => {
            const lineSubtotal = totals.lineSubtotals[idx] ?? 0;
            const priceChanged =
              line.catalog_item_id !== null &&
              line.unit_price_cents !== line.original_unit_price_cents;

            return (
              <div
                key={`${line.catalog_item_id ?? "custom"}_${idx}`}
                data-testid={`quote-line-${idx}`}
                className="w-full max-w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50/70 p-2.5 space-y-2"
              >
                <div className="flex min-w-0 gap-2 items-start">
                  <textarea
                    rows={2}
                    aria-label={`Descripción partida ${idx + 1}`}
                    disabled={!canAct || isSubmitting}
                    value={line.description}
                    onChange={(e) => updateLine(idx, { description: e.target.value })}
                    placeholder="Descripción de trabajo o material"
                    className="min-w-0 flex-1 resize-none rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium break-words"
                  />
                  {canAct && draft.lines.length > 1 && (
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => removeLine(idx)}
                      className="shrink-0 rounded-lg px-2 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                    >
                      Quitar
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-4 gap-1.5 items-center text-xs">
                  <div className="min-w-0">
                    <label className="block text-[10px] text-slate-500">Cant.</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      aria-label={`Cantidad partida ${idx + 1}`}
                      disabled={!canAct || isSubmitting}
                      value={thousandthsToQtyInput(line.quantity_thousandths)}
                      onChange={(e) =>
                        updateLine(idx, {
                          quantity_thousandths: qtyInputToThousandths(e.target.value),
                        })
                      }
                      className="min-w-0 w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
                    />
                  </div>
                  <div className="min-w-0">
                    <label className="block text-[10px] text-slate-500">Ud</label>
                    <input
                      type="text"
                      aria-label={`Unidad partida ${idx + 1}`}
                      disabled={!canAct || isSubmitting}
                      value={line.unit}
                      onChange={(e) => updateLine(idx, { unit: e.target.value || "ud" })}
                      className="min-w-0 w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
                    />
                  </div>
                  <div className="min-w-0">
                    <label className="block text-[10px] text-slate-500">Precio (€)</label>
                    <PriceInput
                      valueCents={line.unit_price_cents}
                      disabled={!canAct || isSubmitting}
                      testId={`quote-line-price-${idx}`}
                      ariaLabel={`Precio euros partida ${idx + 1}`}
                      onChangeCents={(cents) =>
                        updateLine(idx, {
                          unit_price_cents: cents,
                        })
                      }
                    />
                  </div>
                  <div className="min-w-0 text-right">
                    <div className="text-[10px] text-slate-500">Subtotal</div>
                    <div className="truncate font-bold text-slate-900 tabular-nums">{formatCentsEs(lineSubtotal)}</div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <select
                    aria-label={`Categoría partida ${idx + 1}`}
                    disabled={!canAct || isSubmitting}
                    value={line.category}
                    onChange={(e) =>
                      updateLine(idx, { category: e.target.value as CatalogCategory })
                    }
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px]"
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>

                  <label className="min-w-0 inline-flex items-center gap-1.5 text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      data-testid={`quote-line-save-catalog-${idx}`}
                      disabled={!canAct || isSubmitting}
                      checked={line.save_to_catalog}
                      onChange={(e) => updateLine(idx, { save_to_catalog: e.target.checked })}
                      className="h-4 w-4 shrink-0 rounded border-slate-300 text-orange-600"
                    />
                    <span className="break-words leading-tight">
                      {priceChanged
                        ? `Guardar nuevo precio (${formatCentsEs(line.original_unit_price_cents)} → ${formatCentsEs(line.unit_price_cents)})`
                        : "Guardar en tarifario"}
                    </span>
                  </label>
                </div>
              </div>
            );
          })}
        </div>

        <div className="rounded-xl bg-slate-100 p-2.5 text-xs space-y-1">
          <div className="flex justify-between text-slate-600">
            <span>Base imponible</span>
            <span className="font-semibold text-slate-900">{formatCentsEs(totals.subtotalCents)}</span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>IVA ({draft.vat_rate} %)</span>
            <span className="font-semibold text-slate-900">{formatCentsEs(totals.vatCents)}</span>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-1 text-sm font-extrabold text-slate-900">
            <span>Total presupuesto</span>
            <span>{formatCentsEs(totals.totalCents)}</span>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700" htmlFor="qb-notes">
            Notas
          </label>
          <textarea
            id="qb-notes"
            rows={2}
            disabled={!canAct || isSubmitting}
            value={draft.notes}
            onChange={(e) => setDraft((p) => ({ ...p, notes: e.target.value }))}
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-1.5 text-xs disabled:bg-slate-50"
          />
        </div>

        {validationError && (
          <div
            role="alert"
            className="rounded-xl border border-rose-300 bg-rose-50 p-2.5 text-xs font-medium text-rose-800"
          >
            {validationError}
          </div>
        )}

        {canAct && (
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              data-testid="quote-reject-btn"
              disabled={isSubmitting}
              onClick={() => void handleReject()}
              className="min-h-12 rounded-xl border border-rose-300 bg-white px-4 text-xs font-bold text-rose-700"
            >
              Rechazar
            </button>
            <button
              type="button"
              data-testid="quote-approve-btn"
              disabled={isSubmitting}
              onClick={handleConfirm}
              className="min-h-12 flex-1 rounded-xl bg-orange-600 px-4 text-sm font-bold text-white shadow-sm active:bg-orange-700 disabled:opacity-50"
            >
              {isSubmitting
                ? "Guardando PDF..."
                : isDirty
                  ? "Guardar edición y crear PDF"
                  : "Aprobar y generar PDF"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
