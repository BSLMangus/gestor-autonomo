import type {
  BillingSubIntent,
  QuoteVatRate,
  SiteLogCategory,
  SpecialistRoute,
  TicketVatRate,
} from "../../core/contracts/types";
import { deriveFiscalQuarter, getLocalTodayIso, isValidIsoDate } from "../../core/fiscal/dateQuarter";
import { normalizeSpanishText, parseEurosToCents } from "../../core/text/spanishText";
import {
  extractAddress,
  extractFlexibleDateRange,
  extractFlexibleSpanishDateIso,
  extractSpanishPhone,
  extractSpanishTaxId,
} from "./spanishFormParsers";

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

export type ConversationalKind = "capabilities_help" | "greeting" | "gratitude";
export type HelpTopic =
  | "general"
  | "quote"
  | "ticket"
  | "fiscal"
  | "client"
  | "schedule"
  | "sitelog";

export interface DeterministicParseResult {
  intent: SpecialistRoute;
  confidence: number;
  entities: {
    conversational_kind?: ConversationalKind;
    help_topic?: HelpTopic;
    client_query?: string | null;
    job_title_hint?: string | null;
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

const LEADING_GREETING_OR_FILLER_RX =
  /^(?:hola|buenas(?:\s+(?:dias|tardes|noches))?|buenos\s+dias|hey|ey|oye|oiga|mira|a\s+ver|bueno|pues|eh|perdona|perdone|disculpa|disculpe|escucha|por\s+favor|porfa|gracias)\b[\s,.:;!?¡¿-]*/i;

const TRAILING_POLITE_FILLER_RX = /[\s,.;!?-]+(?:por\s+favor|porfa|muchas\s+gracias|gracias)$/i;

export function stripLeadingGreetingsAndFillers(text: string): string {
  let working = text.trim();
  for (let i = 0; i < 5; i += 1) {
    const next = working
      .replace(LEADING_GREETING_OR_FILLER_RX, "")
      .replace(TRAILING_POLITE_FILLER_RX, "")
      .trim();
    if (next === working) break;
    working = next;
  }
  return working.replace(/^[,.;:!?¿¡-]+|[,.;!?-]+$/g, "").trim();
}

const NON_CLIENT_TOKENS_RX =
  /\b(bano|aseo|cocina|salon|techo|suelo|pared|terraza|patio|habitacion|fachada|tejado|obra|reforma|presupuesto|presupuestos|cotizacion|oferta|trabajo|trabajos|hoy|manana|ayer|lunes|martes|miercoles|jueves|viernes|sabado|domingo|vivienda|local|piso|casa|nave|oficina|impuesto|iva|cliente|algo|esto|eso|aqui|alli|favor|porfa|hacer|generar|crear|preparar|pintar|cambiar|instalar|reformar|reparar|poner|colocar|quitar|montar|arreglar|alicatar|sacar|abrir|empezar)\b/;

const NON_CLIENT_LEADING_RX =
  /^(un|una|unos|unas|el|la|los|las|este|esta|estos|estas|eso|esto|mi|tu|su|otro|otra|hacer|generar|crear|pintar|cambiar|instalar|reformar|reparar|poner|colocar|quitar|montar|arreglar|alicatar|dar)\b/;

export function isNonClientPhrase(candidate: string): boolean {
  const norm = normalizeSpanishText(candidate);
  if (norm.length < 2) return true;
  if (NON_CLIENT_TOKENS_RX.test(norm)) return true;
  if (NON_CLIENT_LEADING_RX.test(norm)) return true;
  if (/\d/.test(norm)) return true;
  return false;
}

function formatHintTitle(raw: string): string {
  const cleaned = raw.replace(/^[,.;:\s]+|[,.;:\s]+$/g, "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

const QUOTE_PREAMBLE_RX =
  /^(?:(?:me\s+gustar[ií]a|quisiera|quiero|querr[ií]a|necesito|voy\s+a|vamos\s+a|tengo\s+que|puedes|podr[ií]as|necesitar[ií]a)\s+)?(?:generar|crear|hacer|preparar|sacar|montar|abrir|empezar|iniciar|redactar|emitir|dar|armar|calcular|presupuestar|cotizar)\s+(?:un|una|el|la|otro|otra|nuevo|nueva)?\s*(?:presupuesto|cotizaci[oó]n|oferta)?\b[\s,.:;-]*/i;

const QUOTE_DIRECT_VERB_RX =
  /^(?:hazme|h[aá]zme|cr[eé]ame|gen[eé]rame|prep[aá]rame|s[aá]came|presup[uú]estame|presupu[eé]stame|cot[ií]zame|nuevo|nueva)\s+(?:un|una|el)?\s*(?:presupuesto|cotizaci[oó]n|oferta)?\b[\s,.:;-]*/i;

const QUOTE_BARE_HEADER_RX = /^(?:presupuesto|cotizaci[oó]n|oferta)\b[\s,.:;-]*/i;

export function stripQuotePreamble(text: string): string {
  let working = stripLeadingGreetingsAndFillers(text);
  for (let i = 0; i < 4; i += 1) {
    const next = stripLeadingGreetingsAndFillers(
      working
        .replace(QUOTE_PREAMBLE_RX, "")
        .replace(QUOTE_DIRECT_VERB_RX, "")
        .replace(QUOTE_BARE_HEADER_RX, "")
    );
    if (next === working) break;
    working = next;
  }
  return working.replace(/^[,.;:\s-]+|[,.;:\s-]+$/g, "").trim();
}

const GARBAGE_ONLY_WORDS_RX =
  /\b(hola|buenas|buenos|dias|tardes|noches|oye|oiga|mira|quiero|quisiera|necesito|gustaria|puedes|podrias|generar|crear|hacer|preparar|sacar|abrir|empezar|iniciar|montar|dar|hazme|creame|generame|preparame|un|una|unos|unas|el|la|los|las|otro|otra|nuevo|nueva|presupuesto|presupuestos|presupuestar|cotizar|cotizacion|oferta|por|favor|porfa|gracias|para|de|del|con|a|y|que|algo|esto|eso|aqui|cliente|obra)\b/g;

export function isGarbageQuoteSegment(segment: string): boolean {
  const norm = normalizeSpanishText(segment);
  if (norm.length < 2) return true;
  if (/^\d+$/.test(norm)) return true;
  const residual = norm.replace(GARBAGE_ONLY_WORDS_RX, " ").replace(/\s+/g, " ").trim();
  return residual.length < 2;
}

const GENERIC_TICKET_SUPPLIER_RX =
  /^(?:ticket|gasto|gastos|recibo|factura|compra|material|materiales|hola|buenas|quiero|necesito|apuntar|registrar|anadir|nuevo|nueva|un|una|el|la|algo|esto|eso)(?:\s+(?:ticket|gasto|compra|material|materiales|nuevo|nueva|un|una))?$/;

function isGenericTicketSupplier(candidate: string): boolean {
  const norm = normalizeSpanishText(candidate);
  if (norm.length < 2) return true;
  return GENERIC_TICKET_SUPPLIER_RX.test(norm);
}

export function extractSiteLogNoteFromText(text: string): string {
  let working = stripLeadingGreetingsAndFillers(text);
  working = working
    .replace(
      /^(?:(?:quiero|necesito|voy\s+a|puedes)\s+)?(?:a[ñn]adir|apuntar|guardar|subir|poner|registrar|crear|hacer|sellar)\s+(?:una?\s+)?(?:nota|entrada|foto|avance|algo)?\s*(?:en\s+el\s+|al\s+|para\s+el\s+)?(?:diario\s+de\s+obra|diario|obra)\b[\s,.:;-]*/i,
      ""
    )
    .replace(/^(?:diario\s+de\s+obra|nota\s+de\s+obra|foto\s+de\s+obra|foto\s+obra|sellar\s+foto)\b[\s,.:;-]*/i, "")
    .trim();
  working = stripLeadingGreetingsAndFillers(working);
  const norm = normalizeSpanishText(working);
  if (!norm || /^(?:nota|diario|foto|obra|algo)$/.test(norm)) {
    return "";
  }
  return working;
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
    if (firstClean.length >= 2 && !/^\d/.test(firstClean) && !isGenericTicketSupplier(firstClean)) {
      supplierName = firstClean;
    }
  } else {
    const inlineSupp =
      /(?:en|de|proveedor)\s+([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ0-9\s]{1,40}?)(?=\s+(?:por|de|el|con|nif|total|base|iva|\d)|[,.]|$)/i.exec(
        text
      );
    if (inlineSupp?.[1] && !isGenericTicketSupplier(inlineSupp[1])) {
      supplierName = inlineSupp[1].trim();
    } else {
      const cleanedLead = stripLeadingGreetingsAndFillers(text)
        .replace(
          /^(?:(?:quiero|necesito|voy\s+a)\s+)?(?:apuntar|registrar|a[ñn]adir|guardar|meter)\s+(?:un\s+)?(?:ticket|gasto|recibo|compra)\s*(?:en|de)?\s*/i,
          ""
        )
        .trim();
      const leadBeforeAmount =
        /^([A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ0-9.\s]{1,40}?)(?=\s*(?:,|;|\bpor\b|\bimporte\b|\btotal\b|\bbase\b|\biva\b|\d+(?:[.,]\d{1,2})?\s*(?:€|eur|euros)\b))/i.exec(
          cleanedLead
        );
      if (leadBeforeAmount?.[1] && !isGenericTicketSupplier(leadBeforeAmount[1])) {
        supplierName = leadBeforeAmount[1].trim();
      }
    }
  }

  const baseMatch =
    /base(?:\s+imp(?:onible)?)?(?:\s+\d{1,2}\s*%)?[:\s]+(\d+(?:[.,]\d{1,2})?)\s*(?:€|eur)?/i.exec(
      text
    );
  const vatMatch =
    /iva(?:\s+(\d{1,2})\s*%)?[:\s]+(\d+(?:[.,]\d{1,2})?)\s*(?:€|eur)?/i.exec(text);
  const totalMatch =
    /total(?:\s+ticket)?[:\s]+(\d+(?:[.,]\d{1,2})?)\s*(?:€|eur|euros)?/i.exec(text) ??
    /(?:por|importe|de)\s+(\d+(?:[.,]\d{1,2})?)\s*(?:€|eur|euros)\b/i.exec(text) ??
    /\b(\d+(?:[.,]\d{1,2})?)\s*(?:€|eur|euros)\b/i.exec(text);

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

export function parseQuoteLinesAndMeta(text: string): {
  client_query: string | null;
  job_title_hint: string | null;
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
  let jobTitleHint: string | null = null;
  let bodyText = text;
  const colonIdx = text.indexOf(":");
  if (colonIdx > 0) {
    const header = text.slice(0, colonIdx);
    const body = text.slice(colonIdx + 1);
    const clientMatch = /(?:para|cliente|a)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ0-9.\s]+)$/i.exec(header);
    if (clientMatch?.[1]) {
      const candidate = stripLeadingGreetingsAndFillers(clientMatch[1]);
      if (!isNonClientPhrase(candidate)) {
        clientQuery = candidate;
      } else if (
        /\b(bano|aseo|cocina|salon|terraza|patio|reforma|pintura|alicatado|fontaneria|electricidad|obra)\b/.test(
          normalizeSpanishText(candidate)
        )
      ) {
        const cleanHint = candidate.replace(/^(?:una?|el|la)\s+/i, "").trim();
        if (cleanHint.length >= 3) {
          jobTitleHint = formatHintTitle(cleanHint);
        }
      }
    }
    bodyText = body;
  } else {
    const preCleaned = stripLeadingGreetingsAndFillers(text);
    const clientMatch =
      /(?:presupuesto|cotizaci[oó]n|oferta)\s+(?:para|de|a)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ0-9.\s]{2,45}?)(?=\s*(?:[,.;]|\bcon\b|\biva\b|\bde\b\s+\d|$))/i.exec(
        preCleaned
      ) ??
      /^(?:para(?:\s+el|\s+la)?\s+cliente|para)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ0-9.\s]{2,45}?)(?=\s*(?:[,.;]|\bcon\b|\biva\b|\bde\b\s+\d|$))/i.exec(
        preCleaned
      );
    if (clientMatch?.[1]) {
      const candidate = stripLeadingGreetingsAndFillers(clientMatch[1]);
      if (!isNonClientPhrase(candidate)) {
        clientQuery = candidate;
      } else if (
        /\b(bano|aseo|cocina|salon|terraza|patio|reforma|pintura|alicatado|fontaneria|electricidad)\b/.test(
          normalizeSpanishText(candidate)
        )
      ) {
        const cleanHint = candidate.replace(/^(?:una?|el|la)\s+/i, "").trim();
        if (cleanHint.length >= 3) {
          jobTitleHint = formatHintTitle(cleanHint);
        }
      }
      bodyText = preCleaned.slice(clientMatch.index + clientMatch[0].length);
    }
  }

  const strippedBody = stripQuotePreamble(bodyText);
  const cleanBody = strippedBody
    .replace(/\biva\s+(?:al\s+)?\d+(?:[.,]\d+)?\s*%?(?:\s+vivienda|\s+general)?/gi, "")
    .trim();

  const segments = cleanBody
    .split(/[,;\n]+|\s+\by\b\s+|\s*\+\s*/i)
    .map((s) => stripQuotePreamble(s))
    .filter((s) => s.length > 0 && !/^(vivienda|general)$/i.test(s) && !isGarbageQuoteSegment(s));

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

    if (description.length >= 2 && !isGarbageQuoteSegment(description)) {
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
    job_title_hint: jobTitleHint,
    vat_rate: vatRate,
    lines,
  };
}

export function parseQuoteSlotReply(
  text: string,
  missingFields: string[],
  collected: Record<string, unknown>
): {
  client_query: string | null;
  job_title_hint: string | null;
  vat_rate: QuoteVatRate | undefined;
  quote_lines: ParsedQuoteLine[];
} {
  const parsed = parseQuoteLinesAndMeta(text);
  let clientQuery =
    parsed.client_query ??
    (typeof collected.client_query === "string" ? collected.client_query : null);
  const jobTitleHint =
    parsed.job_title_hint ??
    (typeof collected.job_title_hint === "string" ? collected.job_title_hint : null);
  const vatRate =
    parsed.vat_rate ?? (typeof collected.vat_rate === "number" ? collected.vat_rate : undefined);
  let lines = parsed.lines;

  const cleaned = stripQuotePreamble(text);
  const normCleaned = normalizeSpanishText(cleaned);
  const wordCount = normCleaned.split(/\s+/).filter(Boolean).length;
  const looksLikeWorkLine =
    /\d/.test(normCleaned) ||
    /\b(termo|grifo|alicatado|pintura|ducha|plato|luz|puntos?|cuadro|llave|cable|tuberia|m2|ml|kg|horas?|euros?|€|desmontaje|instalacion|reparacion|reforma|bano|cocina|suelo|pared|techo|griferia|inodoro|lavabo)\b/.test(
      normCleaned
    );

  if (
    missingFields.includes("client") &&
    !parsed.client_query &&
    !looksLikeWorkLine &&
    wordCount >= 1 &&
    wordCount <= 4 &&
    !isNonClientPhrase(cleaned) &&
    /[a-zA-ZÁÉÍÓÚÑáéíóúñ]{2}/.test(cleaned)
  ) {
    clientQuery = cleaned;
    lines = [];
  }

  const prevLines = Array.isArray(collected.quote_lines)
    ? (collected.quote_lines as ParsedQuoteLine[])
    : [];

  return {
    client_query: clientQuery,
    job_title_hint: jobTitleHint,
    vat_rate: vatRate,
    quote_lines: lines.length > 0 ? lines : prevLines,
  };
}

export function extractClientFieldsFromText(text: string): ParsedClientFields {
  const taxMatch = extractSpanishTaxId(text);
  const nif = taxMatch ? taxMatch.value : null;

  const phone = extractSpanishPhone(text);
  const fiscalAddress = extractAddress(text);

  let name: string | null = null;
  const explicitName =
    /(?:nombre(?:\s+completo)?|cliente(?:\s+nuevo)?|se\s+llama)[:\s]+([^,;\n]+?)(?=(?:\s*(?:,|;|\btel[eé]fono\b|\btfno\b|\btel\b|\bm[oó]vil\b|\bnif\b|\bcif\b|\bdni\b|\bdomicilio\b|\bdirecci[oó]n\b|\bcorreo\b|\bemail\b|\+34|\b[6789]\d{8}\b)|$))/i.exec(
      text
    );
  if (explicitName?.[1]) {
    name = explicitName[1].trim();
  } else {
    let cleaned = stripLeadingGreetingsAndFillers(text);
    if (taxMatch?.value) {
      cleaned = cleaned.replace(
        /\b([A-Z][\s-]?(?:\d[\s-]?){7}[0-9A-J]|(?:\d[\s-]?){8}[A-Z])\b/i,
        " "
      );
    }
    if (phone) {
      cleaned = cleaned.replace(/(?:(?:\+|00)\s*34[\s.-]?)?[6789](?:[\s.-]?\d){8}\b/, " ");
    }
    if (fiscalAddress) {
      cleaned = cleaned.replace(fiscalAddress, " ");
    }
    cleaned = cleaned
      .replace(
        /\b(nuevo cliente|cliente nuevo|alta de cliente|crear cliente|registrar cliente|a[ñn]adir cliente|dar de alta(?:\s+a)?(?:\s+un|\s+una)?(?:\s+cliente)?|quiero\s+(?:crear|registrar|a[ñn]adir|dar\s+de\s+alta)(?:\s+a)?(?:\s+un|\s+una)?(?:\s+cliente)?|necesito\s+(?:crear|registrar|a[ñn]adir|dar\s+de\s+alta)(?:\s+a)?(?:\s+un|\s+una)?(?:\s+cliente)?|un cliente|una cliente|cliente|quiero|necesito|por favor|porfa|hola|buenas|sin nif|nif opcional|opcional|tel[eé]fono|tfno|tel\.?|m[oó]vil|nif|cif|dni|domicilio\s+fiscal|direcci[oó]n(?:\s+fiscal)?|nombre(?:\s+completo)?|y su|con el|con|su|el|la)\b/gi,
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
    fiscal_address: fiscalAddress,
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

function parseScheduleIntent(text: string, norm: string): ParsedScheduleFields | null {
  const todayIso = getLocalTodayIso();
  const explicitDate = extractFlexibleSpanishDateIso(text, todayIso) ?? extractSpanishDateIso(text) ?? todayIso;
  const dateRange = extractFlexibleDateRange(text, todayIso);

  const isPlanRange =
    /\b(planifica|planificar|programa|programar|agenda|agendar|calendario)\b/.test(norm) &&
    (dateRange.start_date_iso !== null ||
      /\b(del\s+\d+\s+al\s+\d+|semana|fechas|obra|calendario|planificar)\b/.test(norm));

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
    /\b(parte del dia|parte de jornada|parte de hoy|nuevo parte|abrir parte|registrar parte|registrar salida|registrar horas|ajustar horas|horas extra|en hora)\b/.test(
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

function detectHelpTopic(norm: string): HelpTopic {
  if (/\b(presupuesto|presupuestos|presupuestar|cotizar|cotizacion)\b/.test(norm)) return "quote";
  if (/\b(ticket|tickets|gasto|gastos|ocr|recibo)\b/.test(norm)) return "ticket";
  if (/\b(hucha|fiscal|iva|irpf|hacienda|trimestre|impuestos?|303|130)\b/.test(norm)) return "fiscal";
  if (/\b(cliente|clientes)\b/.test(norm)) return "client";
  if (/\b(agenda|calendario|horario|parte|jornada|horas)\b/.test(norm)) return "schedule";
  if (/\b(diario|foto|fotos|sellar)\b/.test(norm)) return "sitelog";
  return "general";
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

    // 0a. Preguntas sobre capacidades y ayuda de la app
    const asksHelpOrCapabilities =
      /\b(que puedes hacer|que puedo hacer|que sabes hacer|que haces|que hace esta app|que hace la app|para que sirves|para que sirve|como funciona|como se usa|ayuda|necesito ayuda|que opciones hay|dime que puedes hacer|dime que puedo hacer|ejemplos de uso|como hago un|como creo un|como registro un|como apunto un|como emito una|como funciona esto)\b/.test(
        norm
      );
    if (asksHelpOrCapabilities) {
      return {
        intent: "assistant_qa_node",
        confidence: 0.96,
        entities: {
          conversational_kind: "capabilities_help",
          help_topic: detectHelpTopic(norm),
        },
      };
    }

    // 0b. Saludos y agradecimientos puros (confianza < 0.7 para respetar flujo LLM opcional en clasificación y tests)
    const strippedConv = norm.replace(/[¿?¡!.,;:]+/g, " ").replace(/\s+/g, " ").trim();
    if (
      /^(hola|buenas|buenos dias|buenas tardes|buenas noches|hey|ey|que tal|hola que tal|hola buenos dias|hola buenas tardes|hola buenas noches|buenas que tal|estas ahi|hola asistente)$/.test(
        strippedConv
      )
    ) {
      return {
        intent: "clarification_node",
        confidence: 0.45,
        entities: { conversational_kind: "greeting" },
      };
    }
    if (
      /^(gracias|muchas gracias|mil gracias|perfecto|genial|estupendo|vale gracias|ok gracias|de acuerdo|entendido|adios|hasta luego|chao)$/.test(
        strippedConv
      )
    ) {
      return {
        intent: "clarification_node",
        confidence: 0.45,
        entities: { conversational_kind: "gratitude" },
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
      /\b(nuevo cliente|cliente nuevo|alta de cliente|crear(?: un)? cliente|registrar(?: un)? cliente|anadir(?: un)? cliente|dar de alta(?: a)?(?: un| una)? cliente)\b/.test(
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
    const mentionsBusinessQueryNoun =
      /\b(obra|obras|trabajo|trabajos|gastad|gasto|gastos|cobrad|cobrar|pendient|vencid|factura|facturas|facturado|precio|tarifa|tarifario|ticket|tickets|cliente|clientes|presupuesto|presupuestos|debo|debe|hucha|horas)\b/.test(
        norm
      );
    const asksFactualQa =
      (/\b(cuant[oa]s?|que|cual(?:es)?|dime|hay|tengo|falta|llevo|hemos)\b/.test(norm) &&
        mentionsBusinessQueryNoun) ||
      /\b(cuanto llevo gastado|falta por cobrar|pendiente de cobro|facturas pendientes|cuanto debo|precio de|a cuanto tengo)\b/.test(
        norm
      );
    if (
      asksFactualQa &&
      !/\b(presupuesto para|hazme un presupuesto|crea presupuesto|generar un presupuesto|hacer un presupuesto|quiero un presupuesto|nuevo presupuesto)\b/.test(
        norm
      ) &&
      !/\b(apuntar|registrar|anadir|nuevo)\s+(?:un\s+)?(gasto|ticket)\b/.test(norm)
    ) {
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
          note_text: extractSiteLogNoteFromText(trimmed),
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
      /\b(ticket|gasto|recibo|ferreteria|obramat|leroy|bricomart|apunta gasto|apuntar(?: un)? gasto|anade gasto|anadir(?: un)? gasto|registrar(?: un)? (?:gasto|ticket)|nuevo (?:gasto|ticket)|compra de material)\b/.test(
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
          job_title_hint: parsed.job_title_hint,
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
