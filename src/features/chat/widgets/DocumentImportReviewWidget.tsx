import { useMemo, useState } from "react";
import { TEXT_LIMITS } from "../../../core/contracts/textLimits";
import type {
  CatalogCategory,
  CatalogPricingMode,
  DocumentImportExtractedItem,
  DocumentImportReviewDraft,
  QuoteVatRate,
  SqliteExecutor,
} from "../../../core/contracts/types";
import { formatCentsEs } from "../../../core/fiscal/fiscalEngine";
import {
  computeCatalogUnitPriceCents,
  formatPricingBreakdown,
} from "../../../core/pricing/pricingEngine";
import { commitImportedCatalogAndConfig } from "../../pricing/documentImportPipeline";
import { ZoomableTextField } from "../../../ui/ZoomableTextField";

const CATEGORIES: CatalogCategory[] = [
  "Fontanería",
  "Electricidad",
  "Albañilería",
  "Pintura",
  "General",
];

function centsToEurInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

function eurInputToCents(raw: string): number {
  const val = Number.parseFloat(raw.replace(",", ".").trim());
  if (!Number.isFinite(val) || val < 0) return 0;
  return Math.round(val * 100);
}

function thousandthsToInput(t: number): string {
  return String(t / 1000);
}

function hoursInputToThousandths(raw: string): number {
  const val = Number.parseFloat(raw.replace(",", ".").trim());
  if (!Number.isFinite(val) || val < 0) return 0;
  return Math.round(val * 1000);
}

export function DocumentImportReviewWidget(props: {
  initialDraft: DocumentImportReviewDraft;
  currentHourlyRateCents: number;
  executor: SqliteExecutor;
  onCommitted: (result: {
    savedCount: number;
    appliedHourlyRateCents: number | null;
    appliedTaxDefaults: boolean;
  }) => Promise<void> | void;
  onCancel: () => void;
}) {
  const { initialDraft, currentHourlyRateCents, executor, onCommitted, onCancel } = props;

  const [draft, setDraft] = useState<DocumentImportReviewDraft>(initialDraft);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const effectiveHourlyRate = useMemo(() => {
    if (draft.apply_hourly_rate && draft.inferred_hourly_rate_cents !== null) {
      return draft.inferred_hourly_rate_cents;
    }
    return currentHourlyRateCents;
  }, [draft.apply_hourly_rate, draft.inferred_hourly_rate_cents, currentHourlyRateCents]);

  const updateItem = (idx: number, patch: Partial<DocumentImportExtractedItem>) => {
    setDraft((prev) => ({
      ...prev,
      items: prev.items.map((item, i) => {
        if (i !== idx) return item;
        const next: DocumentImportExtractedItem = { ...item, ...patch };
        if (next.pricing_mode === "hourly_plus_materials") {
          next.unit_price_cents = computeCatalogUnitPriceCents({
            pricing_mode: "hourly_plus_materials",
            estimated_hours_thousandths: next.estimated_hours_thousandths,
            materials_cents: next.materials_cents,
            hourly_rate_cents: effectiveHourlyRate,
            fixed_price_cents: next.unit_price_cents,
          });
        }
        return next;
      }),
    }));
  };

  const handleAddManualItem = () => {
    setDraft((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        {
          temp_id: `imp_manual_${crypto.randomUUID().slice(0, 6)}`,
          selected: true,
          description: "",
          category: "General",
          unit: "ud",
          pricing_mode: "fixed",
          estimated_hours_thousandths: 0,
          materials_cents: 0,
          unit_price_cents: 0,
          default_vat_rate: prev.detected_vat_rate ?? 21,
          existing_match_id: null,
          source_file_name: "Manual",
        },
      ],
    }));
  };

  const handleConfirm = async () => {
    setErrorMsg(null);
    setBusy(true);
    try {
      const prepared: DocumentImportReviewDraft = {
        ...draft,
        items: draft.items.map((it) => ({
          ...it,
          unit_price_cents: computeCatalogUnitPriceCents({
            pricing_mode: it.pricing_mode,
            estimated_hours_thousandths: it.estimated_hours_thousandths,
            materials_cents: it.materials_cents,
            hourly_rate_cents: effectiveHourlyRate,
            fixed_price_cents: it.unit_price_cents,
          }),
        })),
      };
      const result = await commitImportedCatalogAndConfig(executor, prepared);
      await onCommitted(result);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const selectedCount = draft.items.filter((i) => i.selected).length;

  return (
    <section
      data-testid="document-import-review-widget"
      className="paper-sheet rounded-2xl border border-[#E5DFD2] bg-[#FFFDF7] p-4 text-[#2C2621] font-sans space-y-4"
    >
      <div className="border-b border-[#E5DFD2] pb-2.5 flex items-start justify-between gap-2">
        <div>
          <span className="inline-flex items-center rounded-sm paper-stamp status-tangerine px-2.5 py-0.5 text-[11px] font-semibold">
            Revisión de Importación IA Local
          </span>
          <h3 className="mt-1.5 text-base font-bold text-[#2C2621]">
            Partidas y tarifas extraídas ({draft.items.length})
          </h3>
          <div className="mt-0.5 text-[11px] text-[#6B6860]">
            Documentos:{" "}
            {draft.source_files.map((f) => `${f.name} (${f.pages_processed} p.)`).join(" · ") ||
              "Análisis local"}
          </div>
        </div>
      </div>

      {draft.warnings.length > 0 && (
        <div className="rounded-xl border border-[#D97706]/35 bg-[#FFF3A1] p-2.5 text-xs text-[#3E3300] space-y-1">
          {draft.warnings.map((w, idx) => (
            <div key={idx}>{w}</div>
          ))}
        </div>
      )}

      {draft.detected_services.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold text-[#6B6860]">Servicios detectados:</span>
          {draft.detected_services.map((srv) => (
            <span
              key={srv}
              className="rounded-full status-cobalt px-2.5 py-0.5 text-[11px] font-semibold"
            >
              {srv}
            </span>
          ))}
        </div>
      )}

      {/* Tarifa base €/h e impuestos detectados */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <div className="ruled-index rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-[#2C2621]">Tarifa base (€/hora)</span>
            <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#2C2621] cursor-pointer">
              <input
                type="checkbox"
                data-testid="import-apply-hourly-toggle"
                checked={draft.apply_hourly_rate}
                disabled={busy}
                onChange={(e) =>
                  setDraft((p) => ({
                    ...p,
                    apply_hourly_rate: e.target.checked,
                    inferred_hourly_rate_cents:
                      p.inferred_hourly_rate_cents ?? currentHourlyRateCents,
                  }))
                }
                className="h-4 w-4 rounded border-[#E5DFD2] text-[#EA580C]"
              />
              Aplicar a mi perfil
            </label>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.5"
              min="1"
              aria-label="Tarifa por hora inferida (€)"
              data-testid="import-hourly-rate-input"
              disabled={busy}
              value={centsToEurInput(draft.inferred_hourly_rate_cents ?? currentHourlyRateCents)}
              onChange={(e) =>
                setDraft((p) => ({
                  ...p,
                  inferred_hourly_rate_cents: eurInputToCents(e.target.value) || 100,
                }))
              }
              className="w-28 rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 py-1.5 text-sm font-bold font-mono-nums tabular-nums text-[#2C2621]"
            />
            <span className="text-xs font-semibold text-[#6B6860]">€/hora</span>
          </div>
        </div>

        <div className="ruled-index rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-[#2C2621]">IVA / IRPF detectado</span>
            <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#2C2621] cursor-pointer">
              <input
                type="checkbox"
                data-testid="import-apply-tax-toggle"
                checked={draft.apply_tax_defaults}
                disabled={busy}
                onChange={(e) =>
                  setDraft((p) => ({
                    ...p,
                    apply_tax_defaults: e.target.checked,
                  }))
                }
                className="h-4 w-4 rounded border-[#E5DFD2] text-[#EA580C]"
              />
              Actualizar por defecto
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-[#6B6860]" htmlFor="imp-vat">
                IVA (%)
              </label>
              <input
                id="imp-vat"
                type="number"
                step="1"
                min="0"
                max="100"
                disabled={busy}
                value={draft.detected_vat_rate ?? 21}
                onChange={(e) => {
                  const v = Number.parseFloat(e.target.value);
                  if (Number.isFinite(v)) {
                    setDraft((p) => ({
                      ...p,
                      detected_vat_rate: Math.max(0, Math.min(100, v)) as QuoteVatRate,
                    }));
                  }
                }}
                className="mt-0.5 w-full rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] px-2 py-1 text-xs font-semibold font-mono-nums tabular-nums text-[#2C2621]"
              />
            </div>
            <div>
              <label className="block text-[10px] text-[#6B6860]" htmlFor="imp-irpf">
                IRPF (%)
              </label>
              <input
                id="imp-irpf"
                type="number"
                step="1"
                min="0"
                max="100"
                disabled={busy}
                value={draft.detected_irpf_rate ?? 20}
                onChange={(e) => {
                  const v = Number.parseFloat(e.target.value);
                  if (Number.isFinite(v)) {
                    setDraft((p) => ({
                      ...p,
                      detected_irpf_rate: Math.max(0, Math.min(100, v)),
                    }));
                  }
                }}
                className="mt-0.5 w-full rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] px-2 py-1 text-xs font-semibold font-mono-nums tabular-nums text-[#2C2621]"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Partidas extraídas editables */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-[#2C2621]">
            Partidas ({selectedCount} de {draft.items.length} seleccionadas)
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={handleAddManualItem}
            className="rounded-lg bg-[#4B7094] px-2.5 py-1 text-xs font-semibold text-[#FFFDF9]"
          >
            + Añadir fila
          </button>
        </div>

        <div className="space-y-2">
          {draft.items.map((item, idx) => {
            const livePriceCents = computeCatalogUnitPriceCents({
              pricing_mode: item.pricing_mode,
              estimated_hours_thousandths: item.estimated_hours_thousandths,
              materials_cents: item.materials_cents,
              hourly_rate_cents: effectiveHourlyRate,
              fixed_price_cents: item.unit_price_cents,
            });
            return (
              <div
                key={item.temp_id}
                data-testid={`import-item-row-${idx}`}
                className={`rounded-xl border p-2.5 space-y-2 ${
                  item.selected
                    ? "ruled-index border-[#E5DFD2] bg-[#FFFDF7]"
                    : "border-[#E5DFD2] bg-[#F5F1E6]/70 opacity-65"
                }`}
              >
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    aria-label={`Seleccionar partida ${idx + 1}`}
                    checked={item.selected}
                    disabled={busy}
                    onChange={(e) => updateItem(idx, { selected: e.target.checked })}
                    className="mt-1.5 h-4 w-4 rounded border-[#E5DFD2] text-[#EA580C]"
                  />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex gap-1.5 items-center">
                      <ZoomableTextField
                        as="input"
                        multiline={false}
                        maxLength={TEXT_LIMITS.DESCRIPTION}
                        zoomLabel={`Descripción de la partida ${idx + 1}`}
                        aria-label={`Descripción extraída ${idx + 1}`}
                        disabled={busy}
                        value={item.description}
                        onValueChange={(next) => updateItem(idx, { description: next })}
                        placeholder="Descripción de la partida *"
                        className="flex-1 rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 py-1.5 text-xs font-semibold text-[#2C2621]"
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          setDraft((p) => ({
                            ...p,
                            items: p.items.filter((_, i) => i !== idx),
                          }))
                        }
                        className="rounded-lg px-2 py-1 text-[11px] font-semibold text-[#9A2D08]"
                      >
                        Quitar
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      {item.existing_match_id && (
                        <span className="rounded-md status-cobalt px-1.5 py-0.5 font-semibold">
                          Actualiza partida existente
                        </span>
                      )}
                      <select
                        aria-label={`Categoría ${idx + 1}`}
                        disabled={busy}
                        value={item.category}
                        onChange={(e) =>
                          updateItem(idx, { category: e.target.value as CatalogCategory })
                        }
                        className="rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] px-2 py-1 text-[11px] text-[#2C2621]"
                      >
                        {CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        aria-label={`Unidad ${idx + 1}`}
                        disabled={busy}
                        value={item.unit}
                        onChange={(e) => updateItem(idx, { unit: e.target.value || "ud" })}
                        className="w-14 rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] px-2 py-1 text-[11px] text-[#2C2621]"
                      />
                      <select
                        aria-label={`Modo cálculo ${idx + 1}`}
                        disabled={busy}
                        value={item.pricing_mode}
                        onChange={(e) =>
                          updateItem(idx, {
                            pricing_mode: e.target.value as CatalogPricingMode,
                          })
                        }
                        className="rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] px-2 py-1 text-[11px] text-[#2C2621]"
                      >
                        <option value="fixed">Importe fijo</option>
                        <option value="hourly_plus_materials">Horas × Tarifa + Mat.</option>
                      </select>
                      <div className="flex items-center gap-1">
                        <span className="text-[#6B6860]">IVA</span>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          aria-label={`IVA partida ${idx + 1}`}
                          disabled={busy}
                          value={item.default_vat_rate}
                          onChange={(e) => {
                            const v = Number.parseFloat(e.target.value);
                            if (Number.isFinite(v)) {
                              updateItem(idx, {
                                default_vat_rate: Math.max(0, Math.min(100, v)) as QuoteVatRate,
                              });
                            }
                          }}
                          className="w-14 rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] px-1.5 py-1 text-[11px] font-mono-nums text-[#2C2621]"
                        />
                        <span className="text-[#6B6860]">%</span>
                      </div>
                    </div>

                    {item.pricing_mode === "hourly_plus_materials" ? (
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <label className="block text-[10px] text-[#6B6860]">Horas est.</label>
                          <input
                            type="number"
                            step="0.25"
                            min="0"
                            disabled={busy}
                            value={thousandthsToInput(item.estimated_hours_thousandths)}
                            onChange={(e) =>
                              updateItem(idx, {
                                estimated_hours_thousandths: hoursInputToThousandths(e.target.value),
                              })
                            }
                            className="mt-0.5 w-full rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] px-2 py-1 text-xs font-mono-nums text-[#2C2621]"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-[#6B6860]">Materiales (€)</label>
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            disabled={busy}
                            value={centsToEurInput(item.materials_cents)}
                            onChange={(e) =>
                              updateItem(idx, { materials_cents: eurInputToCents(e.target.value) })
                            }
                            className="mt-0.5 w-full rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] px-2 py-1 text-xs font-mono-nums text-[#2C2621]"
                          />
                        </div>
                        <div className="flex flex-col justify-end text-right">
                          <span className="text-[10px] text-[#6B6860]">Total calculado</span>
                          <span className="font-bold font-mono-nums tabular-nums text-[#2C2621]">
                            {formatCentsEs(livePriceCents)}/{item.unit}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-1.5">
                          <label className="text-[11px] text-[#6B6860]">Precio (€):</label>
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            disabled={busy}
                            value={centsToEurInput(item.unit_price_cents)}
                            onChange={(e) =>
                              updateItem(idx, { unit_price_cents: eurInputToCents(e.target.value) })
                            }
                            className="w-24 rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] px-2 py-1 text-xs font-bold font-mono-nums tabular-nums text-[#2C2621]"
                          />
                        </div>
                        <span className="text-[11px] font-mono-nums text-[#6B6860]">
                          {formatPricingBreakdown({
                            pricing_mode: item.pricing_mode,
                            estimated_hours_thousandths: item.estimated_hours_thousandths,
                            materials_cents: item.materials_cents,
                            hourly_rate_cents: effectiveHourlyRate,
                            unit_price_cents: livePriceCents,
                          })}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-xl border border-[#DC2626]/30 bg-[#FAD2D8] p-2.5 text-xs font-medium text-[#5A121C]"
        >
          {errorMsg}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          data-testid="import-widget-cancel-btn"
          disabled={busy}
          onClick={onCancel}
          className="min-h-12 rounded-xl border border-[#DC2626]/40 bg-[#FFFDF7] px-4 text-xs font-bold text-[#9A2D08]"
        >
          Cancelar
        </button>
        <button
          type="button"
          data-testid="import-widget-save-btn"
          disabled={busy}
          onClick={() => void handleConfirm()}
          className="min-h-12 flex-1 rounded-xl bg-[#EA580C] hover:bg-[#D04B00] px-4 text-sm font-bold text-white shadow-sm disabled:opacity-50"
        >
          {busy ? "Guardando tarifario..." : "Confirmar e importar"}
        </button>
      </div>
    </section>
  );
}
