import type {
  CatalogCategory,
  CatalogItemRow,
  CatalogPricingMode,
  QuoteVatRate,
} from "../contracts/types";
import { normalizeSpanishText } from "../text/spanishText";
import { computeCatalogUnitPriceCents } from "./pricingEngine";

export interface PredefinedCatalogTemplate {
  template_id: string;
  description: string;
  category: CatalogCategory;
  unit: string;
  pricing_mode: CatalogPricingMode;
  estimated_hours_thousandths: number;
  materials_cents: number;
  fixed_unit_price_cents: number;
  default_vat_rate: QuoteVatRate;
  aliases?: string[];
}

export const PREDEFINED_CATALOG_TEMPLATES: ReadonlyArray<PredefinedCatalogTemplate> = [
  {
    template_id: "tpl_cambio_grifo",
    description: "Cambio e instalación de grifo monomando (incluye latiguillos)",
    category: "Fontanería",
    unit: "ud",
    pricing_mode: "hourly_plus_materials",
    estimated_hours_thousandths: 1000,
    materials_cents: 5100,
    fixed_unit_price_cents: 8900,
    default_vat_rate: 10,
    aliases: ["grifo monomando cocina cano alto extraible", "cambio de grifo"],
  },
  {
    template_id: "tpl_instalacion_termo",
    description: "Instalación completa de termo eléctrico 80L (conexión y vaciado)",
    category: "Fontanería",
    unit: "ud",
    pricing_mode: "hourly_plus_materials",
    estimated_hours_thousandths: 3000,
    materials_cents: 26500,
    fixed_unit_price_cents: 37900,
    default_vat_rate: 10,
    aliases: ["termo electrico 80l vertical bajo consumo", "instalacion de termo"],
  },
  {
    template_id: "tpl_llave_escuadra",
    description: "Sustitución de llave de escuadra cromada 1/2-3/8 con teflón",
    category: "Fontanería",
    unit: "ud",
    pricing_mode: "hourly_plus_materials",
    estimated_hours_thousandths: 500,
    materials_cents: 650,
    fixed_unit_price_cents: 2550,
    default_vat_rate: 10,
    aliases: ["llave de escuadra cromada 1/2-3/8 con teflon"],
  },
  {
    template_id: "tpl_revision_cuadro",
    description: "Revisión y adecuación de cuadro eléctrico ICP+IGA+PIAs",
    category: "Electricidad",
    unit: "ud",
    pricing_mode: "hourly_plus_materials",
    estimated_hours_thousandths: 2500,
    materials_cents: 15000,
    fixed_unit_price_cents: 24500,
    default_vat_rate: 21,
    aliases: ["cuadro electrico vivienda/comunidad 18 modulos icp+iga+pias", "revision cuadro electrico"],
  },
  {
    template_id: "tpl_punto_luz",
    description: "Punto de luz conmutado completo con mecanismo y cableado",
    category: "Electricidad",
    unit: "ud",
    pricing_mode: "hourly_plus_materials",
    estimated_hours_thousandths: 1000,
    materials_cents: 1400,
    fixed_unit_price_cents: 5200,
    default_vat_rate: 21,
    aliases: ["punto de luz conmutado completo y mecanismo"],
  },
  {
    template_id: "tpl_boletin_cie",
    description: "Certificado de Instalación Eléctrica (Boletín CIE) y tramitación",
    category: "Electricidad",
    unit: "ud",
    pricing_mode: "fixed",
    estimated_hours_thousandths: 0,
    materials_cents: 0,
    fixed_unit_price_cents: 18000,
    default_vat_rate: 21,
    aliases: ["certificado instalacion electrica (boletin cie)"],
  },
  {
    template_id: "tpl_pintura_m2",
    description: "Pintura plástica mate lavable 2 manos (material + mano de obra)",
    category: "Pintura",
    unit: "m2",
    pricing_mode: "hourly_plus_materials",
    estimated_hours_thousandths: 250,
    materials_cents: 300,
    fixed_unit_price_cents: 1250,
    default_vat_rate: 10,
  },
  {
    template_id: "tpl_alicatado_m2",
    description: "Alicatado porcelánico rectificado por m² (incluye cemento cola)",
    category: "Albañilería",
    unit: "m2",
    pricing_mode: "hourly_plus_materials",
    estimated_hours_thousandths: 750,
    materials_cents: 950,
    fixed_unit_price_cents: 3800,
    default_vat_rate: 10,
    aliases: ["alicatado porcelanico rectificado (incluye cemento cola)"],
  },
  {
    template_id: "tpl_desescombro",
    description: "Desescombro, carga en sacos y tasa de punto limpio autorizado",
    category: "Albañilería",
    unit: "lote",
    pricing_mode: "hourly_plus_materials",
    estimated_hours_thousandths: 1500,
    materials_cents: 3800,
    fixed_unit_price_cents: 9500,
    default_vat_rate: 21,
    aliases: ["desescombro, sacos y tasa punto limpio autorizado"],
  },
  {
    template_id: "tpl_plato_ducha",
    description: "Instalación de plato de ducha resina antideslizante + válvula",
    category: "Albañilería",
    unit: "ud",
    pricing_mode: "hourly_plus_materials",
    estimated_hours_thousandths: 4000,
    materials_cents: 25800,
    fixed_unit_price_cents: 41000,
    default_vat_rate: 10,
    aliases: ["plato de ducha resina carga mineral antideslizante 120x80"],
  },
  {
    template_id: "tpl_desplazamiento",
    description: "Desplazamiento, diagnóstico técnico o salida de urgencia en obra",
    category: "General",
    unit: "ud",
    pricing_mode: "fixed",
    estimated_hours_thousandths: 0,
    materials_cents: 0,
    fixed_unit_price_cents: 4500,
    default_vat_rate: 21,
    aliases: ["desplazamiento y diagnostico tecnico en obra", "desplazamiento urgencia"],
  },
];

export function computeTemplatePreviewPriceCents(
  template: PredefinedCatalogTemplate,
  hourlyRateCents: number
): number {
  return computeCatalogUnitPriceCents({
    pricing_mode: template.pricing_mode,
    estimated_hours_thousandths: template.estimated_hours_thousandths,
    materials_cents: template.materials_cents,
    hourly_rate_cents: hourlyRateCents,
    fixed_price_cents: template.fixed_unit_price_cents,
  });
}

export function findMatchingCatalogItemForTemplate(
  template: PredefinedCatalogTemplate,
  catalogItems: ReadonlyArray<CatalogItemRow>
): CatalogItemRow | null {
  const normTpl = normalizeSpanishText(template.description);
  const normAliases = (template.aliases ?? []).map(normalizeSpanishText);

  for (const item of catalogItems) {
    if (item.id === template.template_id) {
      return item;
    }
    const normDesc = normalizeSpanishText(item.description);
    if (normDesc === normTpl || normAliases.includes(normDesc)) {
      return item;
    }
  }
  return null;
}
