import { Tag } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { formatCentsEs } from "../../core/fiscal/fiscalEngine";
import { BACK_PRIORITY } from "../../core/navigation/routes";
import type { PredefinedCatalogTemplate } from "../../core/pricing/predefinedCatalog";

export interface ActivateCatalogItemModalProps {
  open: boolean;
  template: PredefinedCatalogTemplate | null;
  defaultPriceCents: number;
  busy?: boolean;
  registerBackHandler?: (priority: number, handler: () => boolean) => () => void;
  onCancel: () => void;
  onConfirm: (customUnitPriceCents: number) => void | Promise<void>;
}

export function ActivateCatalogItemModal({
  open,
  template,
  defaultPriceCents,
  busy = false,
  registerBackHandler,
  onCancel,
  onConfirm,
}: ActivateCatalogItemModalProps) {
  const titleId = useId();
  const descId = useId();
  const inputId = useId();

  const [priceInput, setPriceInput] = useState(() => (defaultPriceCents / 100).toFixed(2));
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !template) return;
    setPriceInput((defaultPriceCents / 100).toFixed(2));
    setValidationError(null);
  }, [open, template, defaultPriceCents]);

  useEffect(() => {
    if (!open || !registerBackHandler) return;
    return registerBackHandler(BACK_PRIORITY.MODAL_SECONDARY + 10, () => {
      if (!busy) {
        onCancel();
      }
      return true;
    });
  }, [open, busy, registerBackHandler, onCancel]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && !busy) {
        ev.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, busy, onCancel]);

  if (!open || !template) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const normalized = priceInput.replace(",", ".").trim();
    const parsed = Number.parseFloat(normalized);
    const cents = Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
    if (!Number.isFinite(parsed) || cents <= 0) {
      setValidationError("Introduce un precio válido mayor que 0,00 €.");
      return;
    }
    setValidationError(null);
    void onConfirm(cents);
  };

  return (
    <div
      data-testid="activate-catalog-item-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[#2C2621]/45 p-4 backdrop-blur-[1px]"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) {
          onCancel();
        }
      }}
    >
      <form
        noValidate
        onSubmit={handleSubmit}
        className="clipboard-panel w-full max-w-sm rounded-[24px] border border-[#DFD9CA] bg-[#FFFDF7] p-5 space-y-3.5 text-xs"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#CBE4F9] text-[#143552]">
            <Tag className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <h3
              id={titleId}
              className="text-[15px] font-bold leading-snug text-[#2C2621]"
            >
              Activar partida
            </h3>
            <p
              id={descId}
              className="text-xs leading-relaxed text-[#6B6860] break-words [overflow-wrap:anywhere]"
            >
              {template.description}
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor={inputId}
            className="block text-[12px] font-semibold text-[#2C2621]"
          >
            ¿Cuál es tu precio para esta partida?
          </label>
          <div className="flex items-center gap-2 rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] px-3 py-2 focus-within:border-[#EA580C]">
            <input
              id={inputId}
              type="number"
              step="0.01"
              min="0.01"
              inputMode="decimal"
              data-testid="activate-modal-price-input"
              disabled={busy}
              value={priceInput}
              onChange={(e) => {
                setPriceInput(e.target.value);
                if (validationError) setValidationError(null);
              }}
              className="w-full min-w-0 bg-transparent font-mono font-mono-nums text-[16px] font-bold text-[#2C2621] tabular-nums focus:outline-none"
            />
            <span className="shrink-0 font-mono text-sm font-bold text-[#6B6860]">€</span>
          </div>
          <p className="text-[11px] leading-relaxed text-[#6B6860]">
            Precio por defecto: {formatCentsEs(defaultPriceCents)} / {template.unit} (puedes modificarlo ahora)
          </p>
        </div>

        {validationError && (
          <div
            role="alert"
            className="rounded-xl border border-[#DC2626]/30 bg-[#FAD2D8] p-2.5 text-[11px] leading-relaxed text-[#5A121C] break-words"
          >
            {validationError}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            data-testid="activate-modal-cancel-btn"
            disabled={busy}
            onClick={onCancel}
            className="min-h-[44px] flex-1 rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] px-3 text-xs font-semibold text-[#2C2621] hover:bg-[#EFECE4] cursor-pointer disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            data-testid="activate-modal-confirm-btn"
            disabled={busy}
            className="min-h-[44px] flex-1 rounded-xl bg-[#4B7094] hover:bg-[#3d5d7c] px-3 text-xs font-semibold text-[#FFFDF9] cursor-pointer disabled:opacity-50"
          >
            {busy ? "Activando..." : "Activar partida"}
          </button>
        </div>
      </form>
    </div>
  );
}
