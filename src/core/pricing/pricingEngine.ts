import type { CatalogPricingMode } from "../contracts/types";
import { formatCentsEs, roundHalfUpDiv } from "../fiscal/fiscalEngine";

export interface PricingComputationInput {
  pricing_mode: CatalogPricingMode;
  estimated_hours_thousandths: number;
  materials_cents: number;
  hourly_rate_cents: number;
  fixed_price_cents: number;
}

/**
 * Calcula el precio unitario efectivo en céntimos enteros según el modo de tarificación.
 */
export function computeCatalogUnitPriceCents(params: PricingComputationInput): number {
  if (params.pricing_mode === "hourly_plus_materials") {
    const laborCents = roundHalfUpDiv(
      Math.max(0, Math.round(params.estimated_hours_thousandths)) *
        Math.max(0, Math.round(params.hourly_rate_cents)),
      1000
    );
    return laborCents + Math.max(0, Math.round(params.materials_cents));
  }
  return Math.max(0, Math.round(params.fixed_price_cents));
}

export function formatHoursEs(estimatedHoursThousandths: number): string {
  const hours = estimatedHoursThousandths / 1000;
  return Number.isInteger(hours)
    ? `${hours}`
    : hours.toFixed(2).replace(/0+$/, "").replace(/\.$/, "").replace(".", ",");
}

/**
 * Genera una descripción legible del desglose de tarifa para tarjetas del tarifario y presupuestos.
 */
export function formatPricingBreakdown(params: {
  pricing_mode: CatalogPricingMode;
  estimated_hours_thousandths: number;
  materials_cents: number;
  hourly_rate_cents: number;
  unit_price_cents: number;
}): string {
  if (params.pricing_mode !== "hourly_plus_materials") {
    return `Precio fijo: ${formatCentsEs(params.unit_price_cents)}`;
  }
  const hoursLabel = `${formatHoursEs(params.estimated_hours_thousandths)} h × ${formatCentsEs(params.hourly_rate_cents)}/h`;
  if (params.materials_cents > 0) {
    return `${hoursLabel} + ${formatCentsEs(params.materials_cents)} mat. = ${formatCentsEs(params.unit_price_cents)}`;
  }
  return `${hoursLabel} = ${formatCentsEs(params.unit_price_cents)}`;
}
