import type {
  BillingSubIntent,
  QuoteVatRate,
  SiteLogCategory,
  SpecialistRoute,
  TicketVatRate,
} from "../../core/contracts/types";
import { deriveFiscalQuarter, getLocalTodayIso, isValidIsoDate } from "../../core/fiscal/dateQuarter";
import { normalizeSpanishText, parseEurosToCents } from "../../core/text/spanishText";

export { normalizeSpanishText, parseEurosToCents };

export interface ParsedQuoteLine {
  quantity_thousandths: number;
  unit: string;
  description: string;
  explicit_price_cents: number | null;
}

export interface ParsedTicketFields {
  supplier_name: string | null;
  supplier_nif: string | null;
  issue_date_iso: string;
  quarter: string;
  base_cents: number | null;
  vat_rate?: TicketVatRate;
  vat_cents: number | null;
  total_cents: number | null;
}

export interface ParsedClientFields {
  name: string | null;
  phone: string | null;
  nif: string | null;
  fiscal_address: string | null;
}

export interface ParsedScheduleFields {
  mode: "daily_log" | "plan_range";
  date_iso: string;
  start_date_iso: string | null;
  end_date_iso: string | null;
  delta_thousandths: number | null;
  reason: string;
  notes: string;
}

export interface DeterministicParseResult {
  intent: SpecialistRoute;
  confidence: number;
  entities: {
    client_query?: string | null;
    job_query?: string | null;
    vat_rate?: QuoteVatRate;
    quote_lines?: ParsedQuoteLine[];
    billing_sub_intent?: BillingSubIntent;
    quarter?: string;
    site_log_category?: SiteLogCategory;
    note_text?: string;
    ticket?: ParsedTicketFields;
    new_client_draft?: ParsedClientFields;
    schedule?: ParsedScheduleFields;
    is_cancel?: boolean;
  };
}

const SPANISH_NUMBERS: Record<string, number> = {
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  veinte: 20,
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  cien: 100,
  medio: 0.5,
  media: 0.5,
};

export function isCancelUtterance(raw: string): boolean {
  const norm = normalizeSpanishText(raw);
  return /^(cancelar|cancela|olvidalo|nada|dejalo|salir|anular|no importa)$/.test(norm);
}

function parseNumberToken(token: string): number | null {
  const norm = normalizeSpanishText(token);
  if (norm in SPANISH_NUMBERS) {
    return SPANISH_NUMBERS[norm] ?? null;
  }
  const numStr = norm.replace(",", ".");
  const parsed = Number(numStr);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function detectQuarterFromText(norm: string): string | undefined {
  const explicit = /\b(20\d{2})[-\s]?t([1-4])\b/i.exec(norm);
  if (explicit) {
    return `${explicit[1]}-T${explicit[2]}`;
  }
  const shortQ = /\bt([1-4])\b/i.exec(norm);
  if (shortQ) {
    const year = getLocalTodayIso().slice(0, 4);
    return `${year}-T${shortQ[1]}`;
  }
  return undefined;
}

function extractSpanishDateIso(text: string): string | null {
  const isoMatch = /\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/.exec(text);
  if (isoMatch && isValidIsoDate(isoMatch[0])) {
    return isoMatch[0];
  }
  const esMatch = /\b(0?[1-9]|[12]\d|3[01])[/-](0?[1-9]|1[0-2])[/-](20\d{2})\b/.exec(text);
  if (esMatch) {
    const d = String(esMatch[1]).padStart(2, "0");
    const m = String(esMatch[2]).padStart(2, "0");
    const y = esMatch[3];
    const candidate = `${y}-${m}-${d}`;
    if (isValidIsoDate(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function extractTicketFieldsFromText(text: string): ParsedTicketFields {
  const todayIso = getLocalTodayIso();
  const issueDateIso = extractSpanishDateIso(text) ?? todayIso;
  const quarter = deriveFiscalQuarter(issueDateIso);

  const nifMatch = /\b([A-Z]\d{7}[0-9A-J]|\d{8}[A-Z]|[XYZ]\d{7}[A-Z])\b/i.exec(text);
  const supplierNif = nifMatch ? nifMatch[1]!.toUpperCase() : null;

  let supplierName: string | null = null;
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length > 1) {
    const firstClean = lines[0]!.trim();
    if (firstClean.length >= 2 && !/^\d/.test(firstClean)) {
      supplierName = firstClean;
    }
  } else {
    const inlineSupp =
      /(?:en|de|proveedor)\s+([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ0-9\s]{1,40}?)(?=\s+(?:por|de|el|con|nif|total|base|iva|\d)|[,.]|$)/i.exec(
        text
      );
    if (inlineSupp?.[1]) {
      supplierName = inlineSupp[1].trim();
    }
  }

  const baseMatch =
    /base(?:\s+imp(?:onible)?)?(?:\s+\d{1,2}\s*%)?[:\s]+(\d+(?:[.,]\d{1,2})?)\s*(?:€|eur)?/i.exec(
      text
    );
  const vatMatch =
    /iva(?:\s+(\d{1,2})\s*%)?[:\s]+(\d+(?:[.,]\d{1,2})?)\s*(?:€|eur)?/i.exec(text);
  const totalMatch =
    /total(?:\s+ticket)?[:\s]+(\d+(?:[.,]\d{1,2})?)\s*(?:€|eur)?/i.exec(text) ??
    /(?:por|importe)\s+(\d+(?:[.,]\d{1,2})?)\s*(?:€|eur|euros)/i.exec(text);

  const baseCents = baseMatch?.[1] ? parseEurosToCents(baseMatch[1]) : null;
  const vatCents = vatMatch?.[2] ? parseEurosToCents(vatMatch[2]) : null;
  let totalCents = totalMatch?.[1] ? parseEurosToCents(totalMatch[1]) : null;

  if (totalCents === null && baseCents !== null && vatCents !== null) {
    totalCents = baseCents + vatCents;
  }

  let vatRate: TicketVatRate | undefined;
  const rateNum = vatMatch?.[1] ? Number(vatMatch[1]) : null;
  if (rateNum === 0 || rateNum === 4 || rateNum === 10 || rateNum === 21) {
    vatRate = rateNum;
  }

  return {
    supplier_name: supplierName,
    supplier_nif: supplierNif,
    issue_date_iso: issueDateIso,
    quarter,
    base_cents: baseCents,
    vat_rate: vatRate,
    vat_cents: vatCents,
    total_cents: totalCents,
  };
}

function parseQuoteLinesAndMeta(text: string): {
  client_query: string | null;
  vat_rate: QuoteVatRate | undefined;
  lines: ParsedQuoteLine[];
} {
  const norm = normalizeSpanishText(text);

  let vatRate: QuoteVatRate | undefined;
  const explicitVatMatch = /\biva\s+(?:al\s+)?(\d+(?:[.,]\d+)?)\s*%/i.exec(norm);
  if (explicitVatMatch?.[1]) {
    const parsedVat = Number.parseFloat(explicitVatMatch[1].replace(",", "."));
    if (Number.isFinite(parsedVat) && parsedVat >= 0 && parsedVat <= 100) {
      vatRate = parsedVat;
    }
  } else if (
    /\b(10\s*%|vivienda|reforma|piso|casa|particular|bano|cocina)\b/.test(norm) &&
    !/\b(21\s*%|comunidad|local|oficina|nave)\b/.test(norm)
  ) {
    vatRate = 10;
  } else if (/\b(21\s*%|comunidad|local|oficina|nave)\b/.test(norm)) {
    vatRate = 21;
  }

  let clientQuery: string | null = null;
  let bodyText = text;
  const colonIdx = text.indexOf(":");
  if (colonIdx > 0) {
    const header = text.slice(0, colonIdx);
    const body = text.slice(colonIdx + 1);
    const clientMatch = /(?:para|cliente|a)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ0-9.\s]+)$/i.exec(header);
    if (clientMatch?.[1]) {
      clientQuery = clientMatch[1].trim();
    }
    bodyText = body;
  } else {
    const clientMatch =
      /(?:presupuesto|oferta)\s+(?:para|de|a)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ0-9.\s]{2,45}?)(?=\s*(?:[,.;]|\bcon\b|\biva\b|\bde\b\s+\d|$))/i.exec(
        text
      );
    if (clientMatch?.[1]) {
      clientQuery = clientMatch[1].trim();
      bodyText = text.slice(clientMatch.index + clientMatch[0].length);
    }
  }

  const cleanBody = bodyText
    .replace(/\biva\s+(?:al\s+)?\d+(?:[.,]\d+)?\s*%?(?:\s+vivienda|\s+general)?/gi, "")
    .trim();

  const segments = cleanBody
    .split(/[,;\n]+|\s+\by\b\s+|\s*\+\s*/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^(vivienda|general)$/i.test(s));

  const lines: ParsedQuoteLine[] = [];
  for (const seg of segments) {
    let working = seg;
    let explicitPriceCents: number | null = null;
    const priceMatch = /\s+(?:por|a)\s+(\d+(?:[.,]\d{1,2})?)\s*(?:€|eur|euros)\b/i.exec(working);
    if (priceMatch?.[1]) {
      explicitPriceCents = parseEurosToCents(priceMatch[1]);
      working = working.slice(0, priceMatch.index).trim();
    }

    let qty = 1;
    let unit = "ud";
    const qtyUnitMatch =
      /^(un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta|cuarenta|cincuenta|cien|medio|media|\d+(?:[.,]\d+)?)\s+(?:(m2|m²|ml|kg|lote|lotes|horas?|h|uds?|unidades?)\s+(?:de\s+)?)?(.+)$/i.exec(
        working
      );

    let description = working;
    if (qtyUnitMatch) {
      const parsedNum = parseNumberToken(qtyUnitMatch[1] ?? "");
      if (parsedNum !== null) {
        qty = parsedNum;
        const rawUnit = (qtyUnitMatch[2] ?? "").toLowerCase();
        if (rawUnit === "m²" || rawUnit === "m2") unit = "m2";
        else if (rawUnit === "ml") unit = "ml";
        else if (rawUnit === "kg") unit = "kg";
        else if (rawUnit.startsWith("lote")) unit = "lote";
        else if (rawUnit === "h" || rawUnit.startsWith("hora")) unit = "h";
        else unit = "ud";
        description = (qtyUnitMatch[3] ?? "").trim();
      }
    }

    if (description.length >= 2) {
      lines.push({
        quantity_thousandths: Math.max(1, Math.round(qty * 1000)),
        unit,
        description,
        explicit_price_cents: explicitPriceCents,
      });
    }
  }

  return {
    client_query: clientQuery,
    vat_rate: vatRate,
    lines,
  };
}

export function extractClientFieldsFromText(text: string): ParsedClientFields {
  const nifMatch = /\b([A-Z]\d{7}[0-9A-J]|\d{8}[A-Z]|[XYZ]\d{7}[A-Z])\b/i.exec(text);
  const nif = nifMatch ? nifMatch[1]!.toUpperCase() : null;

  const phoneMatch = /(?:(?:\+|00)34[\s.-]?)?([6789](?:[\s.-]?\d){8})\b/.exec(text);
  let phone: string | null = null;
  if (phoneMatch?.[1]) {
    const digits = phoneMatch[1].replace(/\D/g, "");
    if (digits.length === 9) {
      phone = `+34${digits}`;
    }
  }

  let name: string | null = null;
  const explicitName =
    /(?:nombre(?:\s+completo)?|cliente(?:\s+nuevo)?|se\s+llama)[:\s]+([^,;\n]+?)(?=(?:\s*(?:,|;|\btel[eé]fono\b|\btfno\b|\btel\b|\bm[oó]vil\b|\bnif\b|\bcif\b|\bdni\b|\+34|\b[6789]\d{8}\b)|$))/i.exec(
      text
    );
  if (explicitName?.[1]) {
    name = explicitName[1].trim();
  } else {
    let cleaned = text;
    if (nifMatch?.[0]) cleaned = cleaned.replace(nifMatch[0], " ");
    if (phoneMatch?.[0]) cleaned = cleaned.replace(phoneMatch[0], " ");
    cleaned = cleaned
      .replace(
        /\b(nuevo cliente|cliente nuevo|alta de cliente|crear cliente|registrar cliente|a[ñn]adir cliente|dar de alta|quiero crear un cliente|sin nif|nif opcional|opcional|tel[eé]fono|tfno|tel\.?|m[oó]vil|nif|cif|dni|nombre(?:\s+completo)?|y su|con el|con|su|el|la)\b/gi,
        " "
      )
      .replace(/[,:;.-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned.length >= 2 && /[a-zA-ZÁÉÍÓÚÑáéíóúñ]/.test(cleaned)) {
      name = cleaned;
    }
  }

  return {
    name: name && name.length >= 2 ? name : null,
    phone,
    nif,
    fiscal_address: null,
  };
}

function extractJobQuery(text: string): string | null {
  const codeMatch = /\bOBR-\d{4}-\d{3,}\b/i.exec(text);
  if (codeMatch) return codeMatch[0].toUpperCase();

  const refMatch =
    /(?:obra|reforma|trabajo|proyecto|de)\s+(?:de\s+|en\s+|la\s+)?([A-Za-zÁÉÍÓÚÑáéíóúñ0-9.\s]{3,45}?)(?=\s*(?:[?,.]|y\s+qu[eé]|para|con|$))/i.exec(
      text
    );
  if (refMatch?.[1]) {
    const candidate = refMatch[1].trim();
    if (!/^(esta obra|la obra|mi obra|obra)$/i.test(normalizeSpanishText(candidate))) {
      return candidate;
    }
  }
  return null;
}

const SPANISH_MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

function buildIsoIfValid(year: number, month: number, day: number): string | null {
  const candidate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isValidIsoDate(candidate) ? candidate : null;
}

function extractScheduleJobQuery(text: string): string | null {
  const codeMatch = /\bOBR-\d{4}-\d{3,}\b/i.exec(text);
  if (codeMatch) return codeMatch[0].toUpperCase();

  const refMatch =
    /(?:en\s+la\s+obra|en\s+obra|la\s+obra|obra|reforma|trabajo)\s+(?:de\s+|del\s+|en\s+|para\s+)?([A-Za-zÁÉÍÓÚÑáéíóúñ0-9.\s]{2,45}?)(?=\s*(?:[?,.]|\bdel?\s+\d|\bdesde\b|\bhasta\b|\bporque\b|\bpor\b|\bhoy\b|\bayer\b|\bpara\b|\bcon\b|$))/i.exec(
      text
    );
  if (refMatch?.[1]) {
    const candidate = refMatch[1].trim();
    if (!/^(esta|la|mi|obra|hoy|ayer)$/i.test(normalizeSpanishText(candidate))) {
      return candidate;
    }
  }
  return null;
}

function extractScheduleDateRange(text: string): {
  start_date_iso: string | null;
  end_date_iso: string | null;
} {
  const todayIso = getLocalTodayIso();
  const currentYear = Number(todayIso.slice(0, 4));
  const norm = normalizeSpanishText(text);

  // Patrón "del 22 de noviembre al 5 de diciembre [de 2026]"
  const twoMonthsMatch =
    /\b(?:del|desde\s+el)\s+(\d{1,2})\s+de\s+([a-z]+)\s+(?:al|hasta\s+el)\s+(\d{1,2})\s+de\s+([a-z]+)(?:\s+de\s+(20\d{2}))?\b/i.exec(
      norm
    );
  if (twoMonthsMatch) {
    const d1 = Number(twoMonthsMatch[1]);
    const m1 = SPANISH_MONTHS[twoMonthsMatch[2] ?? ""];
    const d2 = Number(twoMonthsMatch[3]);
    const m2 = SPANISH_MONTHS[twoMonthsMatch[4] ?? ""];
    const yr = twoMonthsMatch[5] ? Number(twoMonthsMatch[5]) : currentYear;
    if (m1 && m2) {
      const startIso = buildIsoIfValid(yr, m1, d1);
      const endYear = m2 < m1 ? yr + 1 : yr;
      const endIso = buildIsoIfValid(endYear, m2, d2);
      if (startIso && endIso) return { start_date_iso: startIso, end_date_iso: endIso };
    }
  }

  // Patrón "del 22 al 30 de noviembre [de 2026]"
  const sameMonthMatch =
    /\b(?:del|desde\s+el)\s+(\d{1,2})\s+(?:al|hasta\s+el)\s+(\d{1,2})\s+de\s+([a-z]+)(?:\s+de\s+(20\d{2}))?\b/i.exec(
      norm
    );
  if (sameMonthMatch) {
    const d1 = Number(sameMonthMatch[1]);
    const d2 = Number(sameMonthMatch[2]);
    const m = SPANISH_MONTHS[sameMonthMatch[3] ?? ""];
    const yr = sameMonthMatch[4] ? Number(sameMonthMatch[4]) : currentYear;
    if (m) {
      const startIso = buildIsoIfValid(yr, m, d1);
      const endIso = buildIsoIfValid(yr, m, d2);
      if (startIso && endIso) return { start_date_iso: startIso, end_date_iso: endIso };
    }
  }

  // Fechas explícitas ISO / dd-mm-yyyy
  const allIsoMatches = Array.from(
    text.matchAll(/\b(20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))\b/g)
  ).map((m) => m[1]!);
  if (allIsoMatches.length >= 2 && isValidIsoDate(allIsoMatches[0]!) && isValidIsoDate(allIsoMatches[1]!)) {
    return { start_date_iso: allIsoMatches[0]!, end_date_iso: allIsoMatches[1]! };
  }

  return { start_date_iso: null, end_date_iso: null };
}

function parseScheduleIntent(text: string, norm: string): ParsedScheduleFields | null {
  const todayIso = getLocalTodayIso();
  const explicitDate = extractSpanishDateIso(text) ?? todayIso;
  const dateRange = extractScheduleDateRange(text);

  const isPlanRange =
    /\b(planifica|planificar|programa|programar|agenda|agendar|calendario)\b/.test(norm) &&
    (dateRange.start_date_iso !== null || /\b(del\s+\d+\s+al\s+\d+|semana|fechas)\b/.test(norm));

  if (isPlanRange) {
    return {
      mode: "plan_range",
      date_iso: dateRange.start_date_iso ?? explicitDate,
      start_date_iso: dateRange.start_date_iso ?? explicitDate,
      end_date_iso: dateRange.end_date_iso ?? dateRange.start_date_iso ?? explicitDate,
      delta_thousandths: null,
      reason: "",
      notes: text.trim(),
    };
  }

  const isDailyLog =
    /\b(parte del dia|parte de jornada|parte de hoy|registrar salida|ajustar horas|horas extra|en hora)\b/.test(
      norm
    ) ||
    (/\b(termine|terminamos|acabe|acabamos|sali|salimos|alargo|alargamos|echamos|estuvimos|trabaje|jornada)\b/.test(
      norm
    ) &&
      /\b(antes|mas|extra|horas?|minutos?|min|tarde|pronto|hora)\b/.test(norm));

  if (!isDailyLog) {
    return null;
  }

  // Calcular delta en milésimas
  let magnitudeThousandths = 0;
  const halfHourMatch =
    /\b(\d+(?:[.,]\d+)?|un|una|uno|dos|tres|cuatro|cinco|seis)\s+horas?\s+y\s+media\b/i.exec(
      norm
    );
  const hoursMatch =
    /\b(\d+(?:[.,]\d+)?|un|una|uno|dos|tres|cuatro|cinco|seis|media)\s*(?:h|horas?)\b/i.exec(
      norm
    );
  const minsMatch = /\b(\d+)\s*(?:m|min|minutos?)\b/i.exec(norm);

  if (halfHourMatch?.[1]) {
    const base = parseNumberToken(halfHourMatch[1]) ?? 1;
    magnitudeThousandths = Math.round((base + 0.5) * 1000);
  } else if (hoursMatch?.[1]) {
    const base = parseNumberToken(hoursMatch[1]) ?? 1;
    magnitudeThousandths = Math.round(base * 1000);
  } else if (minsMatch?.[1]) {
    const mins = Number(minsMatch[1]);
    if (Number.isFinite(mins) && mins > 0) {
      magnitudeThousandths = Math.round((mins * 1000) / 60);
    }
  }

  let deltaThousandths = 0;
  if (/\b(antes|pronto|menos)\b/.test(norm) && magnitudeThousandths > 0) {
    deltaThousandths = -magnitudeThousandths;
  } else if (
    /\b(alarg|extra|mas|tarde|despues)\b/.test(norm) &&
    magnitudeThousandths > 0
  ) {
    deltaThousandths = magnitudeThousandths;
  } else if (/\ben hora\b/.test(norm)) {
    deltaThousandths = 0;
  } else if (magnitudeThousandths > 0) {
    deltaThousandths = magnitudeThousandths;
  }

  let reason = "";
  if (/\bfalta de material|sin material|material\b/.test(norm)) {
    reason = "Falta de material";
  } else if (/\bampliacion|cliente pidio|cambio del cliente\b/.test(norm)) {
    reason = "Ampliación del cliente";
  } else if (/\bimprevisto|averia|roza|tuberia|roto\b/.test(norm)) {
    reason = "Imprevisto en instalación";
  } else if (deltaThousandths < 0 || /\btodo listo|rapido|antes\b/.test(norm)) {
    reason = "Más rápido de lo previsto";
  } else if (deltaThousandths === 0) {
    reason = "En hora";
  } else {
    reason = "Imprevisto en instalación";
  }

  const becauseMatch = /\b(?:porque|por|ya que)\s+(.+)$/i.exec(text.trim());
  const notes = becauseMatch?.[1]?.trim() ? becauseMatch[1].trim() : text.trim();

  return {
    mode: "daily_log",
    date_iso: explicitDate,
    start_date_iso: null,
    end_date_iso: null,
    delta_thousandths: deltaThousandths,
    reason,
    notes,
  };
}

export class DeterministicSpanishParser {
  parse(text: string): DeterministicParseResult {
    const trimmed = text.trim();
    if (!trimmed) {
      return { intent: "clarification_node", confidence: 0.2, entities: {} };
    }
    const norm = normalizeSpanishText(trimmed);

    if (isCancelUtterance(trimmed)) {
      return {
        intent: "assistant_qa_node",
        confidence: 0.99,
        entities: { is_cancel: true },
      };
    }

    // 1. Visual Hucha Fiscal vs Factual QA
    const asksPiggyBank =
      /\b(hucha fiscal|ensename la hucha|ver hucha|ver la hucha|resumen fiscal|modelo 303|modelo 130|saldo disponible real|dinero intocable)\b/.test(
        norm
      );
    if (asksPiggyBank) {
      return {
        intent: "fiscal_piggybank_specialist",
        confidence: 0.93,
        entities: {
          quarter: detectQuarterFromText(norm),
        },
      };
    }

    // 1b. Alta conversacional de cliente
    if (
      /\b(nuevo cliente|cliente nuevo|alta de cliente|crear cliente|registrar cliente|anadir cliente|dar de alta cliente)\b/.test(
        norm
      ) &&
      !/\b(presupuesto|ticket|gasto|factura)\b/.test(norm)
    ) {
      return {
        intent: "assistant_qa_node",
        confidence: 0.92,
        entities: {
          new_client_draft: extractClientFieldsFromText(trimmed),
        },
      };
    }

    // 2. Consultas factuales de solo lectura (assistant_qa_node)
    const asksFactualQa =
      /^(cuant[oa]s?|que|cual(?:es)?|dime|hay|tengo|falta|llevo|hemos|cuanto)\b/.test(norm) ||
      /\b(cuanto llevo gastado|falta por cobrar|pendiente de cobro|facturas pendientes|cuanto debo|precio de|a cuanto tengo)\b/.test(
        norm
      );
    if (asksFactualQa && !/\b(presupuesto para|hazme un presupuesto|crea presupuesto)\b/.test(norm)) {
      return {
        intent: "assistant_qa_node",
        confidence: 0.9,
        entities: {
          job_query: extractJobQuery(trimmed),
          quarter: detectQuarterFromText(norm),
        },
      };
    }

    // 3. Diario de Obra (site_log_specialist)
    if (
      /\b(diario|foto de obra|foto obra|sellar foto|nota de obra|antes y despues)\b/.test(norm)
    ) {
      let category: SiteLogCategory = "nota";
      if (/\b(antes|previo|inicio)\b/.test(norm)) category = "antes";
      else if (/\b(despues|acabado|terminado|final)\b/.test(norm)) category = "despues";
      return {
        intent: "site_log_specialist",
        confidence: 0.89,
        entities: {
          job_query: extractJobQuery(trimmed),
          site_log_category: category,
          note_text: trimmed,
        },
      };
    }

    // 3b. Agenda, Planificación de Fechas y Partes de Jornada (schedule_specialist)
    const scheduleParsed = parseScheduleIntent(trimmed, norm);
    if (scheduleParsed) {
      return {
        intent: "schedule_specialist",
        confidence: 0.91,
        entities: {
          job_query: extractScheduleJobQuery(trimmed) ?? extractJobQuery(trimmed),
          schedule: scheduleParsed,
        },
      };
    }

    // 4. Facturación / Anticipo / Envío (lifecycle_billing_specialist)
    const wantsShare = /\b(whatsapp|enviar|envia|mandar|manda|compartir|comparte|reenviar)\b/.test(
      norm
    );
    const wantsAdvance = /\b(anticipo|adelanto|40\s*%|a cuenta)\b/.test(norm);
    const wantsFinalInvoice =
      /\b(factura final|facturar|emitir factura|emite la factura|haz la factura|generar factura|pasar a factura)\b/.test(
        norm
      );
    const wantsOverview = /\b(resumen de obra|estado de la obra|ver expediente|abrir obra)\b/.test(
      norm
    );

    if (wantsAdvance || wantsFinalInvoice || (wantsShare && !/\bticket\b/.test(norm)) || wantsOverview) {
      let subIntent: BillingSubIntent = "overview";
      if (wantsAdvance) subIntent = "advance_40";
      else if (wantsFinalInvoice) subIntent = "final_invoice";
      else if (wantsShare) subIntent = "share";

      return {
        intent: "lifecycle_billing_specialist",
        confidence: 0.9,
        entities: {
          billing_sub_intent: subIntent,
          job_query: extractJobQuery(trimmed),
        },
      };
    }

    // 5. Gastos / Ticket OCR (ocr_ticket_specialist)
    if (
      /\b(ticket|gasto|recibo|ferreteria|obramat|leroy|bricomart|apunta gasto|anade gasto|compra de material)\b/.test(
        norm
      )
    ) {
      return {
        intent: "ocr_ticket_specialist",
        confidence: 0.88,
        entities: {
          job_query: extractJobQuery(trimmed),
          ticket: extractTicketFieldsFromText(trimmed),
        },
      };
    }

    // 6. Presupuestos (quote_specialist)
    if (
      /\b(presupuesto|presupuestar|presupuestame|cotizar|cotizacion|oferta)\b/.test(norm) ||
      (/\b(termo|grifo|alicatado|pintura|cuadro electrico|plato de ducha|punto de luz|llave)\b/.test(
        norm
      ) &&
        /\d/.test(norm))
    ) {
      const parsed = parseQuoteLinesAndMeta(trimmed);
      return {
        intent: "quote_specialist",
        confidence: 0.91,
        entities: {
          client_query: parsed.client_query,
          vat_rate: parsed.vat_rate,
          quote_lines: parsed.lines,
        },
      };
    }

    const maybeClient = extractClientFieldsFromText(trimmed);
    if (maybeClient.name && maybeClient.phone) {
      return {
        intent: "assistant_qa_node",
        confidence: 0.85,
        entities: {
          new_client_draft: maybeClient,
        },
      };
    }

    return {
      intent: "clarification_node",
      confidence: 0.35,
      entities: {},
    };
  }
}
