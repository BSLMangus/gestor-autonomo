import { z } from "zod";
import type {
  CatalogCategory,
  CatalogItemRow,
  CatalogPricingMode,
  ClientRow,
  Gate1QuoteDraftPayload,
  Gate2TicketDraftPayload,
  Gate3InvoiceDraftPayload,
  Gate4ShareDraftPayload,
  InferenceEngine,
  JobRow,
  QuoteVatRate,
  SiteLogCategory,
  SqliteExecutor,
  TicketVatRate,
  WorkScheduleDefaults,
} from "../core/contracts/types";
import { CatalogRepository } from "../core/db/repositories/catalogRepo";
import { ClientsRepository } from "../core/db/repositories/clientsRepo";
import { JobsRepository } from "../core/db/repositories/jobsRepo";
import { parseHHMMToMinutes } from "../core/db/repositories/scheduleRepo";
import { addDaysIso, deriveFiscalQuarter, getLocalTodayIso } from "../core/fiscal/dateQuarter";
import {
  computeInverseVat21,
  deriveRateOrMixed,
  formatCentsEs,
  roundHalfUpDiv,
} from "../core/fiscal/fiscalEngine";
import { normalizeSpanishText } from "../core/text/spanishText";
import {
  extractClientFieldsFromText,
  parseQuoteLinesAndMeta,
} from "./inference/deterministicSpanishParser";
import type { LocalInferenceAdapterImpl } from "./inference/localInferenceAdapter";
import {
  extractAddress,
  extractEmail,
  extractEurosCentsFromPhrase,
  extractFlexibleDateRange,
  extractFlexibleSpanishDateIso,
  extractNoteDirective,
  extractSpanishPhone,
  extractSpanishTaxId,
  extractSpanishTimeHHMM,
  extractSpanishTimeRanges,
  extractSpanishWeekdaysPatch,
  parseSpanishNumberToken,
} from "./inference/spanishFormParsers";

export interface VoiceDisambiguationPayload {
  prompt: string;
  entityType: "client" | "job";
  options: Array<{ id: string; label: string; subtitle?: string }>;
}

export interface VoiceFormPatchResult<T> {
  nextState: T;
  appliedChanges: string[];
  warnings: string[];
  disambiguation?: VoiceDisambiguationPayload;
  engineUsed: InferenceEngine;
  changed: boolean;
}

export interface VoicePatchDeps {
  executor: SqliteExecutor;
  inferenceAdapter?: LocalInferenceAdapterImpl;
  referenceDateIso?: string;
}

export interface QuoteBuilderFormState {
  draft: Gate1QuoteDraftPayload;
  useNewClient: boolean;
}

export interface ScheduleWidgetFormState {
  mode: "daily_log" | "plan_range";
  selectedJobId: string;
  dateIso: string;
  startDateIso: string;
  endDateIso: string;
  deltaThousandths: number;
  reason: string;
  notes: string;
  alsoLogInSiteLogs: boolean;
}

export interface CalendarAppointmentFormState {
  jobId: string;
  dateIso: string;
  start: string;
  end: string;
  notes: string;
}

export interface ClientProfileFormState {
  name: string;
  phone: string;
  nif: string;
  fiscalAddress: string;
  email: string;
  notes: string;
}

export interface SiteLogFormState {
  selectedJobId: string;
  createNewJob: boolean;
  newJobTitle: string;
  newJobAddress: string;
  category: SiteLogCategory;
  noteText: string;
}

export interface NewJobFormState {
  title: string;
  address: string;
  clientId: string;
  startDate: string;
  endDate: string;
}

export interface CatalogItemFormState {
  desc: string;
  cat: CatalogCategory;
  unit: string;
  mode: CatalogPricingMode;
  hoursInput: string;
  materialsInput: string;
  fixedPriceInput: string;
  vatInput: string;
}

const ORDINAL_INDEX: Record<string, number> = {
  "1": 0,
  primera: 0,
  primero: 0,
  "2": 1,
  segunda: 1,
  segundo: 1,
  "3": 2,
  tercera: 2,
  tercero: 2,
  "4": 3,
  cuarta: 3,
  cuarto: 3,
  "5": 4,
  quinta: 4,
  quinto: 4,
};

function computeInverseVatForRate(
  totalCents: number,
  rate: 0 | 4 | 10 | 21
): { baseCents: number; vatCents: number } {
  if (rate === 21) return computeInverseVat21(totalCents);
  if (rate === 0) return { baseCents: totalCents, vatCents: 0 };
  const baseCents = roundHalfUpDiv(totalCents * 100, 100 + rate);
  return { baseCents, vatCents: totalCents - baseCents };
}

async function resolveClientCandidates(
  executor: SqliteExecutor,
  rawQuery: string
): Promise<ClientRow[]> {
  const query = rawQuery.trim();
  if (!query) return [];
  const clientsRepo = new ClientsRepository(executor);
  const ftsMatches = await clientsRepo.searchFts5WithScore(query, 5);
  if (ftsMatches.length > 0) {
    const normQ = normalizeSpanishText(query);
    const exactFull = ftsMatches.filter((c) => normalizeSpanishText(c.name) === normQ);
    return exactFull.length === 1 ? exactFull : ftsMatches;
  }
  const all = await clientsRepo.listPaginated({ limit: 100, offset: 0 });
  const normQ = normalizeSpanishText(query);
  const tokens = normQ.split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length === 0) return [];
  return all.items.filter((c) => {
    const normName = normalizeSpanishText(c.name);
    return tokens.every((tk) => normName.includes(tk));
  });
}

async function resolveJobCandidates(
  executor: SqliteExecutor,
  rawQuery: string
): Promise<JobRow[]> {
  const query = rawQuery.trim();
  if (!query) return [];
  const jobsRepo = new JobsRepository(executor);
  const codeMatch = /\bOBR-\d{4}-\d{3,}\b/i.exec(query);
  if (codeMatch) {
    const all = await jobsRepo.listAll();
    const hit = all.find((j) => j.job_code.toUpperCase() === codeMatch[0]!.toUpperCase());
    if (hit) return [hit];
  }

  const ftsMatches = await jobsRepo.searchFts5WithScore(query, 5);
  const validFts = ftsMatches.filter((j) => j.status !== "cancelado");
  if (validFts.length > 0) {
    const normQ = normalizeSpanishText(query);
    const exact = validFts.filter((j) => normalizeSpanishText(j.title) === normQ);
    return exact.length === 1 ? exact : validFts;
  }

  // Fallback por cliente o subcadena de título
  const allJobs = (await jobsRepo.listAll()).filter((j) => j.status !== "cancelado");
  const normQ = normalizeSpanishText(query);
  const titleHits = allJobs.filter((j) => normalizeSpanishText(j.title).includes(normQ));
  if (titleHits.length > 0) return titleHits.slice(0, 5);

  const clientMatches = await resolveClientCandidates(executor, query);
  if (clientMatches.length > 0) {
    const clientIds = new Set(clientMatches.map((c) => c.id));
    return allJobs.filter((j) => j.client_id && clientIds.has(j.client_id)).slice(0, 5);
  }
  return [];
}

async function findCatalogBestMatch(
  catalogRepo: CatalogRepository,
  description: string
): Promise<CatalogItemRow | null> {
  const fts = await catalogRepo.searchFts5WithScore(description, 3);
  if (fts[0]) return fts[0];
  const all = await catalogRepo.listPaginated({ includeInactive: false, limit: 100, offset: 0 });
  const normDesc = normalizeSpanishText(description);
  const tokens = normDesc.split(/\s+/).filter((t) => t.length >= 3);
  if (tokens.length === 0) return null;
  let best: { item: CatalogItemRow; score: number } | null = null;
  for (const item of all.items) {
    const itemNorm = normalizeSpanishText(item.description);
    let hits = 0;
    for (const tk of tokens) {
      if (itemNorm.includes(tk)) hits += 1;
    }
    const score = hits / tokens.length;
    if (score >= 0.6 && (!best || score > best.score)) {
      best = { item, score };
    }
  }
  return best?.item ?? null;
}

function findMatchingQuoteLineIndex(
  lines: Gate1QuoteDraftPayload["lines"],
  query: string
): number {
  const normQ = normalizeSpanishText(query);
  if (!normQ) return -1;
  const ordIdx = ORDINAL_INDEX[normQ];
  if (ordIdx !== undefined && ordIdx >= 0 && ordIdx < lines.length) {
    return ordIdx;
  }
  if (/\bultima?\b/.test(normQ) && lines.length > 0) {
    return lines.length - 1;
  }

  let bestIdx = -1;
  let bestScore = 0;
  const qTokens = normQ
    .replace(/^(?:el|la|los|las|de|del)\s+/i, "")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  if (qTokens.length === 0) return -1;

  lines.forEach((line, idx) => {
    const lineNorm = normalizeSpanishText(line.description);
    if (lineNorm.includes(qTokens.join(" "))) {
      bestIdx = idx;
      bestScore = 10;
      return;
    }
    let hits = 0;
    for (const tk of qTokens) {
      if (lineNorm.includes(tk)) hits += 1;
    }
    const score = hits / qTokens.length;
    if (score >= 0.5 && score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  });
  return bestIdx;
}

function stripConsumedSlice(source: string, match: RegExpExecArray | null): string {
  if (!match) return source;
  return `${source.slice(0, match.index)} ${source.slice(match.index + match[0].length)}`.trim();
}

function extractExplicitQuoteVat(text: string): QuoteVatRate | undefined {
  const norm = normalizeSpanishText(text);
  if (/\bsin\s+iva\b|\biva\s+(?:al\s+|del?\s+)?0\s*%?/.test(norm)) return 0;
  const m = /\biva\s+(?:al\s+|del?\s+)?(\d+(?:[.,]\d+)?)\s*%?/.exec(norm);
  if (m?.[1]) {
    const val = Number.parseFloat(m[1].replace(",", "."));
    if (Number.isFinite(val) && val >= 0 && val <= 100) return val;
  }
  if (/\biva\s+reducido\b/.test(norm)) return 10;
  if (/\biva\s+general\b/.test(norm)) return 21;
  return undefined;
}

function extractQuotedJobTitle(text: string): { title: string; remaining: string } | null {
  const rx =
    /(?:^|[.;,]\s*)(?:t[ií]tulo(?:\s+de\s+(?:la\s+)?obra)?|nombre\s+de\s+(?:la\s+)?obra|concepto\s+(?:de\s+)?obra)\s*(?:es|:)?\s*([^,;\n]+?)(?=(?:\s*(?:,|;|\bcliente\b|\bpara\b|\biva\b|\ba[ñn]ad|\bpon|\bnotas?|$)))/i;
  const m = rx.exec(text);
  if (!m?.[1]) return null;
  const val = m[1].trim();
  if (val.length < 2) return null;
  return { title: val, remaining: stripConsumedSlice(text, m) };
}

function isNonClientNoun(candidate: string): boolean {
  const norm = normalizeSpanishText(candidate);
  if (
    /\b(bano|aseo|cocina|techo|suelo|pared|salon|terraza|patio|habitacion|obra|reforma|presupuesto|hoy|manana|ayer|vivienda|local|piso|casa|nave|oficina|impuesto|iva)\b/.test(
      norm
    )
  ) {
    return true;
  }
  return /^(un|una|el|la|los|las|este|esta|eso|esto)\b/.test(norm);
}

/**
 * 1. Patcher incremental para Presupuestos (QuoteBuilderWidget).
 */
export async function patchQuoteDraftByVoice(
  currentState: QuoteBuilderFormState,
  transcript: string,
  deps: VoicePatchDeps
): Promise<VoiceFormPatchResult<QuoteBuilderFormState>> {
  const trimmed = transcript.trim();
  if (!trimmed) {
    return { nextState: currentState, appliedChanges: [], warnings: [], engineUsed: "deterministic_rule_engine", changed: false };
  }

  const nextDraft: Gate1QuoteDraftPayload = {
    ...currentState.draft,
    lines: currentState.draft.lines.map((l) => ({ ...l })),
    ...(currentState.draft.new_client ? { new_client: { ...currentState.draft.new_client } } : {}),
  };
  let nextUseNewClient = currentState.useNewClient;
  const appliedChanges: string[] = [];
  const warnings: string[] = [];
  let disambiguation: VoiceDisambiguationPayload | undefined;
  let working = trimmed;

  // A. Notas
  const noteDir = extractNoteDirective(working);
  if (noteDir) {
    nextDraft.notes =
      noteDir.mode === "append" && nextDraft.notes.trim()
        ? `${nextDraft.notes.trim()}\n${noteDir.text}`
        : noteDir.text;
    appliedChanges.push(noteDir.mode === "append" ? "Nota añadida" : "Notas actualizadas");
    working = working.replace(
      /(?:a[ñn]ad(?:e|ir)|agreg(?:a|ar)|pon(?:er)?)\s+(?:en\s+)?(?:las?\s+)?(?:notas?|observaciones?)\s*(?:que|:)?\s*.+$/i,
      ""
    ).replace(
      /(?:^|[.;,]\s*)(?:notas?|observaciones?|apunta(?:r)?(?:\s+en\s+notas?)?)\s*(?::|\s+que)\s*.+$/i,
      ""
    ).trim();
  }

  // B. Título explícito
  const titleExtract = extractQuotedJobTitle(working);
  if (titleExtract) {
    nextDraft.job_title = titleExtract.title;
    working = titleExtract.remaining;
    appliedChanges.push(`Título: ${titleExtract.title}`);
  }

  // C. IVA explícito
  const explicitVat = extractExplicitQuoteVat(working);
  if (explicitVat !== undefined) {
    nextDraft.vat_rate = explicitVat;
    working = working
      .replace(/\b(?:con\s+)?iva\s+(?:al\s+|del?\s+)?(?:\d+(?:[.,]\d+)?\s*%?|reducido|general)\b/gi, " ")
      .replace(/\bsin\s+iva\b/gi, " ")
      .trim();
    appliedChanges.push(`IVA: ${explicitVat} %`);
  }

  // D. Cliente (nuevo cliente explícito, subcampos si ya está en nuevo cliente, o cliente existente)
  const newClientMatch =
    /\b(?:nuevo\s+cliente|cliente\s+nuevo|crear\s+cliente|alta\s+cliente)[:\s]+([^.;\n]+?)(?=(?:\s*(?:;|\biva\b|\ba[ñn]ad(?:e|ir)\b|\bpon(?:er)?\s+\d|\bquita\b|\belimina\b|\bborra\b|$)))/i.exec(
      working
    );
  if (newClientMatch?.[1]) {
    const parsedNew = extractClientFieldsFromText(newClientMatch[1]);
    nextUseNewClient = true;
    nextDraft.client_id = null;
    const prevNew = nextDraft.new_client ?? { name: "" };
    nextDraft.new_client = {
      ...prevNew,
      ...(parsedNew.name ? { name: parsedNew.name } : {}),
      ...(parsedNew.phone ? { phone: parsedNew.phone } : {}),
      ...(parsedNew.nif ? { nif: parsedNew.nif } : {}),
      ...(parsedNew.fiscal_address ? { fiscal_address: parsedNew.fiscal_address } : {}),
    };
    working = stripConsumedSlice(working, newClientMatch);
    appliedChanges.push(
      `Nuevo cliente${nextDraft.new_client.name ? `: ${nextDraft.new_client.name}` : ""}`
    );
  } else {
    const clientClauseRx =
      /\b(?:para\s+(?:el\s+|la\s+)?cliente|cliente(?:\s+es)?|para)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ0-9.\s]{1,45}?)(?=\s*(?:[,;:.]|(?:\bcon\b|\btel[eé]fono\b|\bm[oó]vil\b|\bnif\b|\bcif\b|\bdni\b|\bdomicilio\b|\bdirecci[oó]n\b|\biva\b|\ba[ñn]ad|\bpon|\bquita|\belimina|\bborra|\bt[ií]tulo|\bnotas?)|$))/i;
    const clientClause = clientClauseRx.exec(working);
    if (clientClause?.[1]) {
      const candidateQuery = clientClause[1].trim();
      const isExplicitClientKeyword = /\bcliente\b/i.test(clientClause[0]);
      if (isExplicitClientKeyword || !isNonClientNoun(candidateQuery)) {
        const matches = await resolveClientCandidates(deps.executor, candidateQuery);
        if (matches.length === 1) {
          nextUseNewClient = false;
          nextDraft.client_id = matches[0]!.id;
          nextDraft.new_client = undefined;
          if (!nextDraft.job_title.trim()) {
            nextDraft.job_title = `Presupuesto trabajos ${matches[0]!.name}`;
          }
          appliedChanges.push(`Cliente: ${matches[0]!.name}`);
          working = stripConsumedSlice(working, clientClause);
        } else if (matches.length >= 2) {
          disambiguation = {
            prompt: `He encontrado ${matches.length} clientes para "${candidateQuery}". Elige uno:`,
            entityType: "client",
            options: matches.slice(0, 5).map((c) => ({
              id: c.id,
              label: c.name,
              subtitle: c.phone || c.fiscal_address || undefined,
            })),
          };
          working = stripConsumedSlice(working, clientClause);
        } else {
          // No existe en BBDD -> activar nuevo cliente y conservar subcampos de contacto dictados
          const extra = extractClientFieldsFromText(working);
          nextUseNewClient = true;
          nextDraft.client_id = null;
          nextDraft.new_client = {
            ...(nextDraft.new_client ?? { name: "" }),
            name: candidateQuery,
            ...(extra.phone ? { phone: extra.phone } : {}),
            ...(extra.nif ? { nif: extra.nif } : {}),
            ...(extra.fiscal_address ? { fiscal_address: extra.fiscal_address } : {}),
          };
          appliedChanges.push(`Nuevo cliente: ${candidateQuery}`);
          working = stripConsumedSlice(working, clientClause);
        }
      }
    }
  }

  // Si estamos en modo nuevo cliente, fusionar teléfono/NIF/dirección sueltos
  if (nextUseNewClient) {
    const subPhone = extractSpanishPhone(working);
    const subTax = extractSpanishTaxId(working);
    const subAddr = extractAddress(working);
    if (subPhone || subTax || subAddr) {
      const prevNew = nextDraft.new_client ?? { name: "" };
      nextDraft.new_client = {
        ...prevNew,
        ...(subPhone ? { phone: subPhone } : {}),
        ...(subTax ? { nif: subTax.value } : {}),
        ...(subAddr ? { fiscal_address: subAddr } : {}),
      };
      if (subPhone) {
        working = working.replace(/(?:tel[eé]fono|m[oó]vil|tfno)?\s*(?:(?:\+|00)\s*34[\s.-]?)?[6789](?:[\s.-]?\d){8}\b/gi, " ");
        appliedChanges.push(`Teléfono cliente: ${subPhone}`);
      }
      if (subTax) {
        if (!subTax.isValid) {
          warnings.push(`El NIF/CIF «${subTax.value}» no supera el dígito de control.`);
        }
        working = working.replace(/\b(?:nif|cif|dni|nie)?[:\s]*([A-Z][\s-]?(?:\d[\s-]?){7}[0-9A-J]|(?:\d[\s-]?){8}[A-Z])\b/gi, " ");
        appliedChanges.push(`NIF cliente: ${subTax.value}`);
      }
      if (subAddr) {
        working = working.replace(subAddr, " ").replace(/\b(?:domicilio\s+fiscal|direcci[oó]n(?:\s+fiscal)?|domicilio)\s*(?:es|:)?/gi, " ");
        appliedChanges.push("Dirección cliente actualizada");
      }
      working = working.trim();
    }
  }

  // E. Eliminar partida
  const removeRx =
    /\b(?:quita|quitar|elimina|eliminar|borra|borrar)\s+(?:la\s+)?(?:([uú]ltima)\s+(?:partida|l[ií]nea)|(?:partida|l[ií]nea)\s+(\d+|primera|segunda|tercera|cuarta|quinta)|([^,;.\n]+))/i;
  const removeMatch = removeRx.exec(working);
  if (removeMatch) {
    const query = removeMatch[1] ?? removeMatch[2] ?? removeMatch[3] ?? "";
    const idx = findMatchingQuoteLineIndex(nextDraft.lines, query);
    if (idx >= 0) {
      const removed = nextDraft.lines[idx]!;
      nextDraft.lines = nextDraft.lines.filter((_, i) => i !== idx);
      appliedChanges.push(`Partida eliminada: ${removed.description || `#${idx + 1}`}`);
    } else {
      warnings.push(`No encontré ninguna partida que coincida con "${query.trim()}" para quitarla.`);
    }
    working = stripConsumedSlice(working, removeMatch);
  }

  // F. Modificar precio o cantidad de partida existente
  const editPriceByLineNumRx =
    /\b(?:cambia|cambiar|pon|poner|modifica|modificar|actualiza)\s+(?:el\s+precio\s+de\s+)?(?:la\s+)?(?:partida|l[ií]nea)\s+(\d+|primera|segunda|tercera|cuarta|quinta)\s+(?:a|por)\s+(\d+(?:[.,]\d{1,2})?(?:\s+con\s+\d{1,2})?)\s*(?:€|eur|euros)?\b/i;
  const editPriceByNameRx =
    /\b(?:cambia|cambiar|pon|poner|modifica|modificar|sube|baja)\s+(?:el\s+)?precio\s+(?:de(?:l|\s+la)?\s+)?([^,;.\n]+?)\s+(?:a|por)\s+(\d+(?:[.,]\d{1,2})?(?:\s+con\s+\d{1,2})?)\s*(?:€|eur|euros)?\b/i;
  const editLinePriceDirectRx =
    /\b(?:pon|cambia)\s+(?:el|la)?\s*([^,;.\n]{3,45}?)\s+a\s+(\d+(?:[.,]\d{1,2})?(?:\s+con\s+\d{1,2})?)\s*(?:€|eur|euros)\b/i;

  const priceEditMatch =
    editPriceByLineNumRx.exec(working) ??
    editPriceByNameRx.exec(working) ??
    editLinePriceDirectRx.exec(working);
  const priceTargetLooksLikeNewQty =
    priceEditMatch &&
    priceEditMatch === null
      ? false
      : Boolean(
          priceEditMatch &&
            !/\bprecio\b|\b(?:partida|l[ií]nea)\s+(?:\d+|primera|segunda|tercera)/i.test(
              priceEditMatch[0]
            ) &&
            /^(?:\d+|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+/i.test(
              priceEditMatch[1]!.trim()
            )
        );
  if (priceEditMatch && !priceTargetLooksLikeNewQty) {
    const targetQuery = priceEditMatch[1]!;
    const cents = extractEurosCentsFromPhrase(priceEditMatch[2]!);
    const idx = findMatchingQuoteLineIndex(nextDraft.lines, targetQuery);
    if (idx >= 0 && cents !== null && cents > 0) {
      const targetLine = nextDraft.lines[idx]!;
      nextDraft.lines[idx] = {
        ...targetLine,
        unit_price_cents: cents,
      };
      appliedChanges.push(`Precio ${targetLine.description || `#${idx + 1}`}: ${formatCentsEs(cents)}`);
      working = stripConsumedSlice(working, priceEditMatch);
    }
  }

  const editQtyRx =
    /\b(?:cambia|cambiar|pon|poner|modifica)\s+(?:la\s+)?cantidad\s+(?:de(?:l|\s+la)?\s+)?([^,;.\n]+?)\s+(?:a|en)\s+(\d+(?:[.,]\d+)?|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|quince|veinte|medio|media)\b(?:\s*(?:m2|m²|ml|kg|h|horas?|uds?|unidades?))?/i;
  const editQtyInExistingRx =
    /\b(?:cambia|pon)\s+(\d+(?:[.,]\d+)?|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|quince|veinte)\s+(?:(?:m2|m²|ml|kg|h|horas?|uds?|unidades?)\s+)?(?:en|para)\s+(?:el|la)?\s*([^,;.\n]+)/i;
  const qtyMatch = editQtyRx.exec(working) ?? editQtyInExistingRx.exec(working);
  if (qtyMatch) {
    const isSecond = editQtyInExistingRx.test(qtyMatch[0]);
    const rawQty = isSecond ? qtyMatch[1]! : qtyMatch[2]!;
    const targetQuery = isSecond ? qtyMatch[2]! : qtyMatch[1]!;
    const qtyNum = parseSpanishNumberToken(rawQty);
    const idx = findMatchingQuoteLineIndex(nextDraft.lines, targetQuery);
    if (idx >= 0 && qtyNum !== null && qtyNum > 0) {
      const targetLine = nextDraft.lines[idx]!;
      nextDraft.lines[idx] = {
        ...targetLine,
        quantity_thousandths: Math.max(1, Math.round(qtyNum * 1000)),
      };
      appliedChanges.push(`Cantidad ${targetLine.description || `#${idx + 1}`}: ${qtyNum}`);
      working = stripConsumedSlice(working, qtyMatch);
    }
  }

  // G. Añadir nuevas partidas desde el remanente
  const hasExplicitLineCue =
    /\b(?:a[ñn]ad(?:e|ir)|agreg(?:a|ar)|incluy(?:e|ir)|met(?:e|er)|pon(?:er)?|partidas?|l[ií]neas?|conceptos?)\b|:/.test(
      normalizeSpanishText(working)
    );
  const cleanedRemainder = working
    .replace(/^(?:[,.;:\s]+|(?:y\s+)?(?:a[ñn]ade|a[ñn]adir|agrega|agregar|incluye|incluir|mete|meter|pon|poner|tambi[eé]n|adem[aá]s)\s+)+/i, "")
    .replace(/^[,.;:\s]+|[,.;:\s]+$/g, "")
    .trim();

  if (
    cleanedRemainder.length >= 3 &&
    !/^(?:cliente|para|con|y|tambien|ademas|presupuesto|sin\s+cambios)$/i.test(
      normalizeSpanishText(cleanedRemainder)
    )
  ) {
    const parsedMeta = parseQuoteLinesAndMeta(cleanedRemainder);
    if (parsedMeta.lines.length > 0) {
      const catalogRepo = new CatalogRepository(deps.executor);
      const additions: Gate1QuoteDraftPayload["lines"] = [];

      for (const parsedLine of parsedMeta.lines) {
        const cleanDesc = parsedLine.description
          .replace(/^(?:a[ñn]ade|a[ñn]adir|agrega|pon|incluye)\s+/i, "")
          .trim();
        if (cleanDesc.length < 2) continue;

        const catalogHit = await findCatalogBestMatch(catalogRepo, cleanDesc);
        const hasQtyOrPrice =
          parsedLine.quantity_thousandths !== 1000 ||
          parsedLine.explicit_price_cents !== null ||
          /^(?:\d+|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|medio|media)\b/i.test(
            normalizeSpanishText(cleanedRemainder)
          );
        if (!hasExplicitLineCue && !hasQtyOrPrice && !catalogHit) {
          continue;
        }
        if (catalogHit) {
          additions.push({
            catalog_item_id: catalogHit.id,
            description: catalogHit.description,
            category: catalogHit.category,
            unit: catalogHit.unit,
            quantity_thousandths: parsedLine.quantity_thousandths,
            unit_price_cents: parsedLine.explicit_price_cents ?? catalogHit.unit_price_cents,
            original_unit_price_cents: catalogHit.unit_price_cents,
            save_to_catalog: false,
          });
        } else {
          additions.push({
            catalog_item_id: null,
            description: cleanDesc,
            category: "General",
            unit: parsedLine.unit,
            quantity_thousandths: parsedLine.quantity_thousandths,
            unit_price_cents: parsedLine.explicit_price_cents ?? 0,
            original_unit_price_cents: 0,
            save_to_catalog: true,
          });
        }
      }

      if (additions.length > 0) {
        const onlyEmptyPlaceholder =
          nextDraft.lines.length === 1 &&
          !nextDraft.lines[0]!.description.trim() &&
          nextDraft.lines[0]!.unit_price_cents === 0;
        nextDraft.lines = onlyEmptyPlaceholder ? additions : [...nextDraft.lines, ...additions];
        appliedChanges.push(
          additions.length === 1
            ? `+1 partida (${additions[0]!.description})`
            : `+${additions.length} partidas añadidas`
        );
      }
    }
  }

  // Fallback opcional con LLM local si determinista no detectó cambios
  let engineUsed: InferenceEngine = "deterministic_rule_engine";
  if (appliedChanges.length === 0 && !disambiguation && deps.inferenceAdapter?.hasLlmRunner()) {
    const llmPatchSchema = z.object({
      job_title: z.string().max(180).optional(),
      vat_rate: z.number().min(0).max(100).optional(),
      notes: z.string().max(1000).optional(),
    });
    const llmRes = await deps.inferenceAdapter.extractFormPatch({
      formKind: "Presupuesto (Gate 1)",
      currentSnapshot: {
        job_title: nextDraft.job_title,
        vat_rate: nextDraft.vat_rate,
        notes: nextDraft.notes,
        lines_count: nextDraft.lines.length,
      },
      transcript: trimmed,
      fieldSpec: "{ job_title?: string, vat_rate?: number, notes?: string }",
      schema: llmPatchSchema,
    });
    if (llmRes) {
      engineUsed = llmRes.engine_used;
      if (llmRes.patch.job_title) {
        nextDraft.job_title = llmRes.patch.job_title;
        appliedChanges.push(`Título: ${llmRes.patch.job_title}`);
      }
      if (llmRes.patch.vat_rate !== undefined) {
        nextDraft.vat_rate = llmRes.patch.vat_rate;
        appliedChanges.push(`IVA: ${llmRes.patch.vat_rate} %`);
      }
      if (llmRes.patch.notes) {
        nextDraft.notes = llmRes.patch.notes;
        appliedChanges.push("Notas actualizadas");
      }
    }
  }

  return {
    nextState: { draft: nextDraft, useNewClient: nextUseNewClient },
    appliedChanges,
    warnings,
    disambiguation,
    engineUsed,
    changed: appliedChanges.length > 0 || warnings.length > 0,
  };
}

/**
 * 2. Patcher incremental para Emisión de Factura (Gate 3).
 */
export async function patchInvoiceGate3ByVoice(
  draft: Gate3InvoiceDraftPayload,
  transcript: string,
  deps: VoicePatchDeps
): Promise<VoiceFormPatchResult<Gate3InvoiceDraftPayload>> {
  const trimmed = transcript.trim();
  const refDate = deps.referenceDateIso ?? getLocalTodayIso();
  if (!trimmed) {
    return { nextState: draft, appliedChanges: [], warnings: [], engineUsed: "deterministic_rule_engine", changed: false };
  }

  const next: Gate3InvoiceDraftPayload = { ...draft };
  const appliedChanges: string[] = [];
  const warnings: string[] = [];
  let working = trimmed;

  // Notas
  const noteDir = extractNoteDirective(working);
  if (noteDir) {
    next.notes =
      noteDir.mode === "append" && next.notes.trim()
        ? `${next.notes.trim()}\n${noteDir.text}`
        : noteDir.text;
    appliedChanges.push("Notas de factura actualizadas");
    working = working.replace(
      /(?:a[ñn]ad(?:e|ir)|agreg(?:a|ar)|pon(?:er)?)\s+(?:en\s+)?(?:las?\s+)?(?:notas?|observaciones?)\s*(?:que|:)?\s*.+$/i,
      ""
    ).replace(
      /(?:^|[.;,]\s*)(?:notas?|observaciones?|apunta(?:r)?(?:\s+en\s+notas?)?)\s*(?::|\s+que)\s*.+$/i,
      ""
    ).trim();
  }

  // Fecha emisión
  const issuedClause =
    /\b(?:fecha\s+(?:de\s+)?emisi[oó]n|emisi[oó]n|emitir(?:\s+el)?)\s*(?:el|para\s+el|:)?\s*([^,;\n]+?)(?=(?:\s*(?:,|;|\bvencimiento\b|\bvence\b|\bnif\b|\bdni\b|\bcif\b|\bdomicilio\b|\bdirecci[oó]n\b|\bnotas?\b|$)))/i.exec(
      working
    );
  if (issuedClause?.[1]) {
    const parsedDate = extractFlexibleSpanishDateIso(issuedClause[1], refDate);
    if (parsedDate) {
      next.issued_at_iso = parsedDate;
      if (next.due_at_iso < parsedDate) {
        next.due_at_iso = addDaysIso(parsedDate, 30);
      }
      appliedChanges.push(`Emisión: ${parsedDate}`);
      working = stripConsumedSlice(working, issuedClause);
    }
  }

  // Vencimiento (fecha exacta o "a N días")
  const dueClause =
    /\b(?:fecha\s+(?:de\s+)?vencimiento|vencimiento|vence)\s*(?:el|en|a|:)?\s*([^,;\n]+?)(?=(?:\s*(?:,|;|\bemisi[oó]n\b|\bnif\b|\bdni\b|\bcif\b|\bdomicilio\b|\bdirecci[oó]n\b|\bnotas?\b|$)))/i.exec(
      working
    );
  if (dueClause?.[1]) {
    const relDays =
      /\b(?:a\s+|en\s+)?(\d+|quince|veinte|treinta|cuarenta\s*y\s*cinco|sesenta|noventa)\s+d[ií]as?\b/i.exec(
        normalizeSpanishText(dueClause[1])
      );
    if (relDays?.[1]) {
      const daysNum = parseSpanishNumberToken(relDays[1]);
      if (daysNum !== null && Number.isInteger(daysNum)) {
        next.due_at_iso = addDaysIso(next.issued_at_iso, daysNum);
        appliedChanges.push(`Vencimiento: ${next.due_at_iso}`);
        working = stripConsumedSlice(working, dueClause);
      }
    } else {
      const parsedDue = extractFlexibleSpanishDateIso(dueClause[1], next.issued_at_iso);
      if (parsedDue) {
        if (parsedDue < next.issued_at_iso) {
          warnings.push("El vencimiento no puede ser anterior a la fecha de emisión.");
        } else {
          next.due_at_iso = parsedDue;
          appliedChanges.push(`Vencimiento: ${parsedDue}`);
        }
        working = stripConsumedSlice(working, dueClause);
      }
    }
  }

  // Emisor vs Cliente: detectar segmentos etiquetados
  const emitterNifClause =
    /\b(?:mi\s+(?:nif|cif|dni)|(?:nif|cif|dni)\s+(?:del?\s+)?emisor)\s*(?:es|:)?\s*([A-Z0-9\s-]{8,14})/i.exec(
      working
    );
  if (emitterNifClause?.[1]) {
    const tax = extractSpanishTaxId(emitterNifClause[1]);
    if (tax) {
      next.emitter_nif = tax.value;
      if (!tax.isValid) warnings.push(`El NIF emisor «${tax.value}» no supera el dígito de control.`);
      appliedChanges.push(`NIF emisor: ${tax.value}`);
      working = stripConsumedSlice(working, emitterNifClause);
    }
  }

  const emitterAddrClause =
    /\b(?:mi\s+(?:domicilio|direcci[oó]n)|(?:domicilio(?:\s+fiscal)?|direcci[oó]n(?:\s+fiscal)?)\s+(?:del?\s+)?emisor)\s*(?:es|:)?\s*([^\n,;]+)/i.exec(
      working
    );
  if (emitterAddrClause?.[1]) {
    next.emitter_fiscal_address = emitterAddrClause[1].trim();
    appliedChanges.push("Domicilio emisor actualizado");
    working = stripConsumedSlice(working, emitterAddrClause);
  }

  const emitterNameClause =
    /\b(?:nombre(?:\s+del)?\s+emisor|raz[oó]n\s+social\s+(?:del?\s+)?emisor)\s*(?:es|:)?\s*([^\n,;]+)/i.exec(
      working
    );
  if (emitterNameClause?.[1]) {
    next.emitter_name = emitterNameClause[1].trim();
    appliedChanges.push(`Emisor: ${next.emitter_name}`);
    working = stripConsumedSlice(working, emitterNameClause);
  }

  // NIF/Dirección del cliente (por defecto si no dijo "emisor")
  const clientTax = extractSpanishTaxId(working);
  if (clientTax) {
    next.client_nif = clientTax.value;
    if (!clientTax.isValid) {
      warnings.push(`El NIF/DNI «${clientTax.value}» no supera el dígito de control.`);
    }
    appliedChanges.push(`NIF cliente: ${clientTax.value}`);
  }

  const clientAddr = extractAddress(working.replace(/\bdel?\s+cliente\b/gi, " "));
  if (clientAddr) {
    next.client_fiscal_address = clientAddr;
    appliedChanges.push("Domicilio cliente actualizado");
  }

  let engineUsed: InferenceEngine = "deterministic_rule_engine";
  if (appliedChanges.length === 0 && deps.inferenceAdapter?.hasLlmRunner()) {
    const schema = z.object({
      client_nif: z.string().max(24).optional(),
      client_fiscal_address: z.string().max(240).optional(),
      notes: z.string().max(1000).optional(),
    });
    const llmRes = await deps.inferenceAdapter.extractFormPatch({
      formKind: "Emisión de Factura (Gate 3)",
      currentSnapshot: {
        issued_at_iso: next.issued_at_iso,
        due_at_iso: next.due_at_iso,
        client_nif: next.client_nif,
        client_fiscal_address: next.client_fiscal_address,
      },
      transcript: trimmed,
      fieldSpec: "{ client_nif?: string, client_fiscal_address?: string, notes?: string }",
      schema,
    });
    if (llmRes) {
      engineUsed = llmRes.engine_used;
      if (llmRes.patch.client_nif) {
        next.client_nif = llmRes.patch.client_nif.toUpperCase();
        appliedChanges.push(`NIF cliente: ${next.client_nif}`);
      }
      if (llmRes.patch.client_fiscal_address) {
        next.client_fiscal_address = llmRes.patch.client_fiscal_address;
        appliedChanges.push("Domicilio cliente actualizado");
      }
      if (llmRes.patch.notes) {
        next.notes = llmRes.patch.notes;
        appliedChanges.push("Notas actualizadas");
      }
    }
  }

  return {
    nextState: next,
    appliedChanges,
    warnings,
    engineUsed,
    changed: appliedChanges.length > 0 || warnings.length > 0,
  };
}

/**
 * 3. Patcher incremental para Compartir Documento (Gate 4).
 */
export async function patchShareGate4ByVoice(
  draft: Gate4ShareDraftPayload,
  transcript: string,
  deps: VoicePatchDeps
): Promise<VoiceFormPatchResult<Gate4ShareDraftPayload>> {
  const trimmed = transcript.trim();
  if (!trimmed) {
    return { nextState: draft, appliedChanges: [], warnings: [], engineUsed: "deterministic_rule_engine", changed: false };
  }
  const norm = normalizeSpanishText(trimmed);
  const next: Gate4ShareDraftPayload = { ...draft };
  const appliedChanges: string[] = [];

  let explicitShareSheet = false;
  if (/\b(otras\s+apps?|hoja\s+de\s+compartir|compartir\s+normal|por\s+correo|por\s+email|sin\s+whatsapp)\b/.test(norm)) {
    next.channel = "share_sheet";
    explicitShareSheet = true;
    appliedChanges.push("Canal: Otras apps / Compartir");
  } else if (/\bwhatsapp\b/.test(norm)) {
    next.channel = "whatsapp";
    appliedChanges.push("Canal: WhatsApp");
  }

  const phone = extractSpanishPhone(trimmed);
  if (phone) {
    next.recipient_phone = phone;
    if (!explicitShareSheet) next.channel = "whatsapp";
    appliedChanges.push(`Teléfono: ${phone}`);
  }

  const appendMsgMatch =
    /\b(?:a[ñn]ad(?:e|ir)|agrega)\s+(?:al\s+mensaje|al\s+texto)\s*(?:que|:)?\s*(.+)$/i.exec(trimmed);
  const replaceMsgMatch =
    /\b(?:mensaje|texto|dile\s+que|escribe(?:\s+que)?)\s*(?::|\s+que)?\s*(.+)$/i.exec(trimmed);

  if (appendMsgMatch?.[1]) {
    const addition = appendMsgMatch[1].trim();
    next.message_text = next.message_text.trim()
      ? `${next.message_text.trim()} ${addition}`
      : addition;
    appliedChanges.push("Texto añadido al mensaje");
  } else if (replaceMsgMatch?.[1]) {
    const body = replaceMsgMatch[1].trim();
    if (body.length >= 2) {
      next.message_text = body;
      appliedChanges.push("Mensaje actualizado");
    }
  } else if (appliedChanges.length === 0) {
    // Si solo dictó una frase libre dentro de Gate 4 sin especificar canal/teléfono, úsala como mensaje
    next.message_text = trimmed;
    appliedChanges.push("Mensaje actualizado");
  }

  void deps;
  return {
    nextState: next,
    appliedChanges,
    warnings: [],
    engineUsed: "deterministic_rule_engine",
    changed: appliedChanges.length > 0,
  };
}

/**
 * 4. Patcher incremental para Agenda y Parte Diario (ScheduleWorkLogWidget).
 */
export async function patchScheduleWidgetByVoice(
  current: ScheduleWidgetFormState,
  plannedEndHHMM: string,
  transcript: string,
  deps: VoicePatchDeps
): Promise<VoiceFormPatchResult<ScheduleWidgetFormState>> {
  const trimmed = transcript.trim();
  const refDate = deps.referenceDateIso ?? getLocalTodayIso();
  if (!trimmed) {
    return { nextState: current, appliedChanges: [], warnings: [], engineUsed: "deterministic_rule_engine", changed: false };
  }

  const norm = normalizeSpanishText(trimmed);
  const next: ScheduleWidgetFormState = { ...current };
  const appliedChanges: string[] = [];
  const warnings: string[] = [];
  let disambiguation: VoiceDisambiguationPayload | undefined;

  // A. Obra vinculada
  if (/\b(?:sin\s+obra|agenda\s+general|ninguna\s+obra)\b/.test(norm)) {
    next.selectedJobId = "";
    appliedChanges.push("Sin obra vinculada");
  } else {
    const codeMatch = /\bOBR-\d{4}-\d{3,}\b/i.exec(trimmed);
    const jobClause =
      /\b(?:en\s+la\s+obra|para\s+la\s+obra|obra)\s+(?:de\s+|del\s+|en\s+)?([A-Za-zÁÉÍÓÚÑáéíóúñ0-9.\s-]{2,45}?)(?=\s*(?:[,.;]|\bdel?\s+\d|\bdesde\b|\bhasta\b|\bhoy\b|\bayer\b|\bmanana\b|\bporque\b|\bpor\b|\btermine\b|\bsali\b|\balarg|\bhoras?\b|$))/i.exec(
        trimmed
      );
    const query = codeMatch?.[0] ?? jobClause?.[1]?.trim() ?? null;
    if (query && !/^(esta|la|mi|obra)$/i.test(normalizeSpanishText(query))) {
      const hits = await resolveJobCandidates(deps.executor, query);
      if (hits.length === 1) {
        next.selectedJobId = hits[0]!.id;
        appliedChanges.push(`Obra: ${hits[0]!.job_code} · ${hits[0]!.title}`);
      } else if (hits.length >= 2) {
        disambiguation = {
          prompt: `Encontré ${hits.length} obras para "${query}". Selecciona una:`,
          entityType: "job",
          options: hits.slice(0, 5).map((j) => ({
            id: j.id,
            label: `${j.job_code} · ${j.title}`,
            subtitle: j.address || j.status,
          })),
        };
      } else {
        warnings.push(`No encontré ninguna obra que coincida con "${query}".`);
      }
    }
  }

  // B. Rango de fechas -> cambia a plan_range
  const range = extractFlexibleDateRange(trimmed, refDate);
  if (range.start_date_iso && range.end_date_iso) {
    next.mode = "plan_range";
    next.startDateIso = range.start_date_iso;
    next.endDateIso = range.end_date_iso;
    appliedChanges.push(`Rango: ${range.start_date_iso} → ${range.end_date_iso}`);
  } else if (/\b(?:planificar|planifica|rango\s+de\s+fechas|modo\s+planificar)\b/.test(norm)) {
    next.mode = "plan_range";
    appliedChanges.push("Modo: Planificar rango");
  } else if (/\b(?:parte\s+de\s+hoy|parte\s+diario|modo\s+parte)\b/.test(norm)) {
    next.mode = "daily_log";
    appliedChanges.push("Modo: Parte de hoy");
  }

  // Fechas individuales dentro de plan_range o daily_log
  if (!range.start_date_iso) {
    const startOnly =
      /\b(?:fecha\s+(?:de\s+)?inicio|empieza|empezamos|desde\s+el)\s*(?:el|:)?\s*([^,;\n]+?)(?=(?:\s*(?:,|;|\bfin\b|\bhasta\b|$)))/i.exec(
        trimmed
      );
    const endOnly =
      /\b(?:fecha\s+(?:de\s+)?fin|termina|acabamos|hasta\s+el)\s*(?:el|:)?\s*([^,;\n]+?)(?=(?:\s*(?:,|;|$)))/i.exec(
        trimmed
      );
    if (startOnly?.[1]) {
      const s = extractFlexibleSpanishDateIso(startOnly[1], refDate);
      if (s) {
        next.mode = "plan_range";
        next.startDateIso = s;
        appliedChanges.push(`Inicio: ${s}`);
      }
    }
    if (endOnly?.[1]) {
      const e = extractFlexibleSpanishDateIso(endOnly[1], next.startDateIso || refDate);
      if (e) {
        next.mode = "plan_range";
        next.endDateIso = e;
        appliedChanges.push(`Fin: ${e}`);
      }
    }
    if (!startOnly && !endOnly) {
      const singleDate = extractFlexibleSpanishDateIso(trimmed, refDate);
      if (singleDate && next.mode === "daily_log") {
        next.dateIso = singleDate;
        appliedChanges.push(`Fecha parte: ${singleDate}`);
      }
    }
  }

  // C. Desviación horaria en parte diario: hora exacta de salida OR delta relativo
  const exitTimeMatch =
    /\b(?:sal[ií]|salimos|termin[eé]|terminamos|acab[eé]|acabamos|salida)\s+a\s+las\s+([^\n,;]+?)(?=(?:\s*(?:,|;|\bporque\b|\bpor\b|\bya\s+que\b|$)))/i.exec(
      trimmed
    );
  let deltaDetected = false;
  if (exitTimeMatch?.[1]) {
    const exitHHMM = extractSpanishTimeHHMM(exitTimeMatch[1], "afternoon");
    if (exitHHMM) {
      const plannedMin = parseHHMMToMinutes(plannedEndHHMM);
      const exitMin = parseHHMMToMinutes(exitHHMM);
      next.mode = "daily_log";
      next.deltaThousandths = Math.round(((exitMin - plannedMin) * 1000) / 60);
      deltaDetected = true;
      appliedChanges.push(`Salida real: ${exitHHMM}`);
    }
  }

  if (!deltaDetected) {
    let magnitude = 0;
    const halfHour =
      /\b(\d+(?:[.,]\d+)?|un|una|uno|dos|tres|cuatro|cinco|seis)\s+horas?\s+y\s+media\b/i.exec(
        norm
      );
    const hours =
      /\b(\d+(?:[.,]\d+)?|un|una|uno|dos|tres|cuatro|cinco|seis|media)\s*(?:h|horas?)\b/i.exec(
        norm
      );
    const mins = /\b(\d+|quince|veinte|treinta|cuarenta\s*y\s*cinco)\s*(?:m|min|minutos?)\b/i.exec(
      norm
    );

    if (halfHour?.[1]) {
      const b = parseSpanishNumberToken(halfHour[1]) ?? 1;
      magnitude = Math.round((b + 0.5) * 1000);
    } else if (hours?.[1]) {
      const b = parseSpanishNumberToken(hours[1]) ?? 1;
      magnitude = Math.round(b * 1000);
    } else if (mins?.[1]) {
      const m = parseSpanishNumberToken(mins[1]) ?? 0;
      if (m > 0) magnitude = Math.round((m * 1000) / 60);
    }

    if (magnitude > 0) {
      next.mode = "daily_log";
      next.deltaThousandths = /\b(antes|pronto|menos)\b/.test(norm) ? -magnitude : magnitude;
      deltaDetected = true;
      const hrsStr = `${next.deltaThousandths > 0 ? "+" : ""}${(next.deltaThousandths / 1000)
        .toFixed(1)
        .replace(/\.0$/, "")} h`;
      appliedChanges.push(`Desviación: ${hrsStr}`);
    } else if (/\ben\s+hora\b|\bpuntual\b/.test(norm)) {
      next.mode = "daily_log";
      next.deltaThousandths = 0;
      next.reason = "En hora";
      deltaDetected = true;
      appliedChanges.push("Jornada en hora");
    }
  }

  // D. Motivo de desviación
  if (/\bfalta\s+de\s+material|sin\s+material|material\b/.test(norm)) {
    next.reason = "Falta de material";
    appliedChanges.push("Motivo: Falta de material");
  } else if (/\bampliaci[oó]n|cliente\s+pidi[oó]|cambio\s+del\s+cliente|extra\s+del\s+cliente\b/.test(norm)) {
    next.reason = "Ampliación del cliente";
    appliedChanges.push("Motivo: Ampliación del cliente");
  } else if (/\bimprevisto|aver[ií]a|roza|tuber[ií]a|roto|atasco\b/.test(norm)) {
    next.reason = "Imprevisto en instalación";
    appliedChanges.push("Motivo: Imprevisto en instalación");
  } else if (/\bm[aá]s\s+r[aá]pido|todo\s+listo|adelant/i.test(norm) || next.deltaThousandths < 0) {
    if (deltaDetected || /\bm[aá]s\s+r[aá]pido|todo\s+listo\b/.test(norm)) {
      next.reason = "Más rápido de lo previsto";
    }
  }

  // E. Vinculación al diario de obra
  if (/\b(?:no\s+vincular|sin\s+diario|no\s+guardar\s+en\s+diario)\b/.test(norm)) {
    next.alsoLogInSiteLogs = false;
    appliedChanges.push("Sin vincular al diario");
  } else if (/\bvincular\s+(?:al\s+)?diario|guardar\s+en\s+diario\b/.test(norm)) {
    next.alsoLogInSiteLogs = true;
    appliedChanges.push("Vincular al diario");
  }

  // F. Notas
  const noteDir = extractNoteDirective(trimmed);
  if (noteDir) {
    next.notes =
      noteDir.mode === "append" && next.notes.trim()
        ? `${next.notes.trim()} · ${noteDir.text}`
        : noteDir.text;
    appliedChanges.push("Nota actualizada");
  } else {
    const becauseMatch = /\b(?:porque|ya\s+que|debido\s+a)\s+(.+)$/i.exec(trimmed);
    if (becauseMatch?.[1]) {
      next.notes = becauseMatch[1].trim();
      appliedChanges.push("Nota actualizada");
    } else if (appliedChanges.length === 0 && !disambiguation) {
      next.notes = next.notes.trim() ? `${next.notes.trim()} · ${trimmed}` : trimmed;
      appliedChanges.push("Nota añadida");
    }
  }

  return {
    nextState: next,
    appliedChanges,
    warnings,
    disambiguation,
    engineUsed: "deterministic_rule_engine",
    changed: appliedChanges.length > 0 || warnings.length > 0,
  };
}

/**
 * 5. Patcher incremental para modal "Añadir cita en agenda" (CalendarScheduleView).
 */
export async function patchCalendarAppointmentByVoice(
  current: CalendarAppointmentFormState,
  transcript: string,
  deps: VoicePatchDeps
): Promise<VoiceFormPatchResult<CalendarAppointmentFormState>> {
  const trimmed = transcript.trim();
  const refDate = deps.referenceDateIso ?? getLocalTodayIso();
  if (!trimmed) {
    return { nextState: current, appliedChanges: [], warnings: [], engineUsed: "deterministic_rule_engine", changed: false };
  }

  const norm = normalizeSpanishText(trimmed);
  const next: CalendarAppointmentFormState = { ...current };
  const appliedChanges: string[] = [];
  const warnings: string[] = [];
  let disambiguation: VoiceDisambiguationPayload | undefined;
  let working = trimmed;

  // A. Obra
  if (/\b(?:sin\s+obra|ninguna\s+obra|cita\s+general)\b/.test(norm)) {
    next.jobId = "";
    appliedChanges.push("Sin obra específica");
  } else {
    const codeMatch = /\bOBR-\d{4}-\d{3,}\b/i.exec(working);
    const jobClause =
      /\b(?:obra|en\s+la\s+obra|para\s+la\s+obra|reforma)\s+(?:de\s+|del\s+|en\s+)?([A-Za-zÁÉÍÓÚÑáéíóúñ0-9.\s-]{2,45}?)(?=\s*(?:[,.;]|\bhoy\b|\bmanana\b|\bel\s+\d|\bde\s+\d|\bentrada\b|\bsalida\b|\bnota\b|$))/i.exec(
        working
      );
    const query = codeMatch?.[0] ?? jobClause?.[1]?.trim() ?? null;
    if (query && !/^(esta|la|mi|obra)$/i.test(normalizeSpanishText(query))) {
      const hits = await resolveJobCandidates(deps.executor, query);
      if (hits.length === 1) {
        next.jobId = hits[0]!.id;
        appliedChanges.push(`Obra: ${hits[0]!.job_code}`);
      } else if (hits.length >= 2) {
        disambiguation = {
          prompt: `Encontré ${hits.length} obras para "${query}". Elige una:`,
          entityType: "job",
          options: hits.slice(0, 5).map((j) => ({
            id: j.id,
            label: `${j.job_code} · ${j.title}`,
            subtitle: j.address || j.status,
          })),
        };
      } else {
        warnings.push(`No encontré obra para "${query}".`);
      }
      if (jobClause) working = stripConsumedSlice(working, jobClause);
    }
  }

  // B. Fecha
  const parsedDate = extractFlexibleSpanishDateIso(trimmed, refDate);
  if (parsedDate) {
    next.dateIso = parsedDate;
    appliedChanges.push(`Fecha: ${parsedDate}`);
  }

  // C. Horas
  const times = extractSpanishTimeRanges(trimmed);
  const range = times.singleRange ?? times.continuous ?? times.morning ?? times.afternoon;
  if (range) {
    next.start = range.start;
    next.end = range.end;
    appliedChanges.push(`Horario: ${range.start}–${range.end}`);
  } else {
    if (times.explicitStart) {
      next.start = times.explicitStart;
      appliedChanges.push(`Entrada: ${times.explicitStart}`);
    }
    if (times.explicitEnd) {
      next.end = times.explicitEnd;
      appliedChanges.push(`Salida: ${times.explicitEnd}`);
    }
  }

  // D. Nota rápida
  const noteDir = extractNoteDirective(trimmed);
  if (noteDir) {
    next.notes =
      noteDir.mode === "append" && next.notes.trim()
        ? `${next.notes.trim()} · ${noteDir.text}`
        : noteDir.text;
    appliedChanges.push("Nota actualizada");
  } else if (appliedChanges.length === 0 && !disambiguation) {
    next.notes = working;
    appliedChanges.push("Nota actualizada");
  }

  return {
    nextState: next,
    appliedChanges,
    warnings,
    disambiguation,
    engineUsed: "deterministic_rule_engine",
    changed: appliedChanges.length > 0 || warnings.length > 0,
  };
}

/**
 * 6. Patcher incremental para "Mi Horario Habitual de Trabajo" (WorkScheduleDefaults).
 */
export async function patchWorkScheduleDefaultsByVoice(
  current: WorkScheduleDefaults,
  transcript: string,
  deps: VoicePatchDeps
): Promise<VoiceFormPatchResult<WorkScheduleDefaults>> {
  const trimmed = transcript.trim();
  if (!trimmed) {
    return { nextState: current, appliedChanges: [], warnings: [], engineUsed: "deterministic_rule_engine", changed: false };
  }

  const norm = normalizeSpanishText(trimmed);
  const next: WorkScheduleDefaults = {
    ...current,
    work_days: [...current.work_days],
  };
  const appliedChanges: string[] = [];

  const nextDays = extractSpanishWeekdaysPatch(trimmed, current.work_days);
  if (nextDays && nextDays.length > 0) {
    next.work_days = nextDays;
    appliedChanges.push(`Días laborables (${nextDays.length} días/sem)`);
  }

  const times = extractSpanishTimeRanges(trimmed);
  if (times.continuous) {
    next.morning_start = times.continuous.start;
    next.morning_end = times.continuous.end;
    next.afternoon_start = times.continuous.end;
    next.afternoon_end = times.continuous.end;
    appliedChanges.push(`Jornada continua ${times.continuous.start}–${times.continuous.end}`);
  } else {
    if (times.morning) {
      next.morning_start = times.morning.start;
      next.morning_end = times.morning.end;
      appliedChanges.push(`Mañana ${times.morning.start}–${times.morning.end}`);
    }
    if (times.afternoon) {
      next.afternoon_start = times.afternoon.start;
      next.afternoon_end = times.afternoon.end;
      appliedChanges.push(`Tarde ${times.afternoon.start}–${times.afternoon.end}`);
    } else if (times.noAfternoon) {
      next.afternoon_start = next.morning_end;
      next.afternoon_end = next.morning_end;
      appliedChanges.push("Sin turno de tarde");
    }
    if (!times.morning && !times.afternoon && times.singleRange) {
      next.morning_start = times.singleRange.start;
      next.morning_end = times.singleRange.end;
      appliedChanges.push(`Horario ${times.singleRange.start}–${times.singleRange.end}`);
    }
    if (times.explicitStart) {
      next.morning_start = times.explicitStart;
      appliedChanges.push(`Entrada ${times.explicitStart}`);
    }
    if (times.explicitEnd) {
      if (next.afternoon_end === next.afternoon_start) {
        next.morning_end = times.explicitEnd;
        next.afternoon_start = times.explicitEnd;
        next.afternoon_end = times.explicitEnd;
      } else {
        next.afternoon_end = times.explicitEnd;
      }
      appliedChanges.push(`Salida ${times.explicitEnd}`);
    }
  }

  if (/\b(?:no\s+aplicar\s+autom[aá]ticamente|desactivar\s+aplicaci[oó]n)\b/.test(norm)) {
    next.auto_apply_to_jobs = false;
    appliedChanges.push("Auto-aplicar desactivado");
  } else if (/\b(?:aplicar\s+autom[aá]ticamente|activar\s+aplicaci[oó]n)\b/.test(norm)) {
    next.auto_apply_to_jobs = true;
    appliedChanges.push("Auto-aplicar activado");
  }

  void deps;
  return {
    nextState: next,
    appliedChanges,
    warnings: [],
    engineUsed: "deterministic_rule_engine",
    changed: appliedChanges.length > 0,
  };
}

/**
 * 7. Patcher incremental para Tickets de Gasto (TicketOcrValidatorWidget & TicketDetailView).
 */
export async function patchTicketDraftByVoice(
  draft: Gate2TicketDraftPayload,
  transcript: string,
  deps: VoicePatchDeps
): Promise<VoiceFormPatchResult<Gate2TicketDraftPayload>> {
  const trimmed = transcript.trim();
  const refDate = deps.referenceDateIso ?? getLocalTodayIso();
  if (!trimmed) {
    return { nextState: draft, appliedChanges: [], warnings: [], engineUsed: "deterministic_rule_engine", changed: false };
  }

  const norm = normalizeSpanishText(trimmed);
  const next: Gate2TicketDraftPayload = { ...draft };
  const appliedChanges: string[] = [];
  const warnings: string[] = [];
  let disambiguation: VoiceDisambiguationPayload | undefined;

  // A. Proveedor
  const suppMatch =
    /\b(?:proveedor|tienda|comercio|en|de)\s+([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ0-9.\s&-]{1,45}?)(?=\s*(?:[,.;]|\bnif\b|\bcif\b|\bdni\b|\bbase\b|\biva\b|\btotal\b|\bimporte\b|\bpor\b|\bde\s+\d|\bobr-|\bpara\s+la\s+obra|\bcategor[ií]a\b|\bhoy\b|\bayer\b|\d+(?:[.,]\d{1,2})?\s*(?:€|eur|euros)|$))/i.exec(
      trimmed
    ) ??
    /\b((?:ferreter[ií]a|almac[eé]n|suministros|bricolaje)\s+[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ0-9.\s&-]{1,40}?)(?=\s*(?:[,.;]|\bnif\b|\bcif\b|\bdni\b|\bbase\b|\biva\b|\btotal\b|\bimporte\b|\bpor\b|\bde\s+\d|\bobr-|\bpara\s+la\s+obra|\bcategor[ií]a\b|\bhoy\b|\bayer\b|\d+(?:[.,]\d{1,2})?\s*(?:€|eur|euros)|$))/i.exec(
      trimmed
    );
  if (suppMatch?.[1]) {
    const cleanSupp = suppMatch[1].trim();
    if (!/^(la\s+obra|obra|materiales|herramientas|transporte)$/i.test(normalizeSpanishText(cleanSupp))) {
      next.supplier_name = cleanSupp;
      appliedChanges.push(`Proveedor: ${cleanSupp}`);
    }
  }

  // B. NIF proveedor
  const tax = extractSpanishTaxId(trimmed);
  if (tax) {
    next.supplier_nif = tax.value;
    if (!tax.isValid) {
      warnings.push(`El NIF/CIF «${tax.value}» no supera el dígito de control.`);
    }
    appliedChanges.push(`NIF: ${tax.value}`);
  }

  // C. Fecha y trimestre
  const parsedDate = extractFlexibleSpanishDateIso(trimmed, refDate);
  if (parsedDate) {
    next.issue_date_iso = parsedDate;
    next.quarter = deriveFiscalQuarter(parsedDate);
    appliedChanges.push(`Fecha: ${parsedDate} (${next.quarter})`);
  }

  // D. Categoría
  let nextCat: string | null = null;
  if (/\bherramientas?\b|\btaladro\b|\bbroca\b|\bsierra\b/.test(norm)) nextCat = "herramientas";
  else if (/\btransporte\b|\bgasolina\b|\bdiesel\b|\bcombustible\b|\bpeaje\b|\bparking\b/.test(norm))
    nextCat = "transporte";
  else if (/\bsubcontrata\b/.test(norm)) nextCat = "subcontrata";
  else if (/\bmateriales?\b/.test(norm)) nextCat = "materiales";
  else if (/\botros\b/.test(norm)) nextCat = "otros";
  if (nextCat) {
    next.category = nextCat;
    appliedChanges.push(`Categoría: ${nextCat}`);
  }

  // E. Obra vinculada
  if (/\b(?:gasto\s+general|sin\s+obra|empresa)\b/.test(norm)) {
    next.job_id = null;
    appliedChanges.push("Gasto general (sin obra)");
  } else {
    const codeMatch = /\bOBR-\d{4}-\d{3,}\b/i.exec(trimmed);
    const jobClause =
      /\b(?:para\s+(?:la\s+)?obra|en\s+(?:la\s+)?obra|obra)\s+(?:de\s+|del\s+)?([A-Za-zÁÉÍÓÚÑáéíóúñ0-9.\s-]{2,45}?)(?=\s*(?:[,.;]|\bbase\b|\biva\b|\btotal\b|\bpor\b|\bnif\b|$))/i.exec(
        trimmed
      );
    const query = codeMatch?.[0] ?? jobClause?.[1]?.trim() ?? null;
    if (query) {
      const hits = await resolveJobCandidates(deps.executor, query);
      if (hits.length === 1) {
        next.job_id = hits[0]!.id;
        appliedChanges.push(`Obra: ${hits[0]!.job_code}`);
      } else if (hits.length >= 2) {
        disambiguation = {
          prompt: `Encontré ${hits.length} obras para "${query}". ¿A cuál corresponde el ticket?`,
          entityType: "job",
          options: hits.slice(0, 5).map((j) => ({
            id: j.id,
            label: `${j.job_code} · ${j.title}`,
            subtitle: j.address || j.status,
          })),
        };
      }
    }
  }

  // F. Tipo de IVA e importes
  let explicitVatRate: TicketVatRate | undefined;
  if (/\biva\s+mixt[oa]\b|\bmixto\b/.test(norm)) {
    explicitVatRate = "mixed";
  } else if (/\bsin\s+iva\b|\biva\s+(?:al\s+)?0\s*%?/.test(norm)) {
    explicitVatRate = 0;
  } else {
    const rateM = /\biva\s+(?:al\s+|del?\s+)?(21|10|4|0)\s*%?/.exec(norm);
    if (rateM?.[1]) {
      explicitVatRate = Number(rateM[1]) as TicketVatRate;
    }
  }
  if (explicitVatRate !== undefined) {
    next.vat_rate = explicitVatRate;
    appliedChanges.push(`Tipo IVA: ${explicitVatRate === "mixed" ? "Mixto" : `${explicitVatRate}%`}`);
  }

  const baseM = /\bbase(?:\s+imponible)?(?:\s+de)?[:\s]+(\d+(?:[.,]\d{1,2})?(?:\s+con\s+\d{1,2})?)\s*(?:€|eur|euros)?/i.exec(trimmed);
  const vatM = /\biva(?:\s+\d{1,2}\s*%)?(?:\s+de)?[:\s]+(\d+(?:[.,]\d{1,2})?(?:\s+con\s+\d{1,2})?)\s*(?:€|eur|euros)?/i.exec(trimmed);
  const totalM =
    /\btotal(?:\s+ticket)?(?:\s+de)?[:\s]+(\d+(?:[.,]\d{1,2})?(?:\s+con\s+\d{1,2})?)\s*(?:€|eur|euros)?/i.exec(trimmed) ??
    /\b(?:por|importe(?:\s+de)?)\s+(\d+(?:[.,]\d{1,2})?(?:\s+con\s+\d{1,2})?)\s*(?:€|eur|euros)\b/i.exec(trimmed) ??
    (!baseM && !vatM
      ? /\b(\d+(?:[.,]\d{1,2})?(?:\s+con\s+\d{1,2})?)\s*(?:€|eur|euros)\b/i.exec(trimmed)
      : null);

  const parsedBase = baseM?.[1] ? extractEurosCentsFromPhrase(baseM[1]) : null;
  const parsedVat = vatM?.[1] ? extractEurosCentsFromPhrase(vatM[1]) : null;
  const parsedTotal = totalM?.[1] ? extractEurosCentsFromPhrase(totalM[1]) : null;

  if (parsedBase !== null || parsedVat !== null || parsedTotal !== null) {
    if (parsedBase !== null) next.base_cents = parsedBase;
    if (parsedVat !== null) next.vat_cents = parsedVat;
    if (parsedTotal !== null) next.total_cents = parsedTotal;

    if (parsedBase !== null && parsedVat !== null && parsedTotal === null) {
      next.total_cents = parsedBase + parsedVat;
      next.vat_rate = explicitVatRate ?? deriveRateOrMixed(parsedBase, parsedVat);
    } else if (parsedTotal !== null && parsedBase === null && parsedVat === null) {
      const rateForInverse =
        typeof next.vat_rate === "number" ? next.vat_rate : 21;
      const inv = computeInverseVatForRate(parsedTotal, rateForInverse);
      next.base_cents = inv.baseCents;
      next.vat_cents = inv.vatCents;
      next.vat_rate = rateForInverse;
    } else if (parsedBase !== null && parsedTotal !== null && parsedVat === null) {
      next.vat_cents = Math.max(0, parsedTotal - parsedBase);
    } else if (parsedVat !== null && parsedTotal !== null && parsedBase === null) {
      next.base_cents = Math.max(0, parsedTotal - parsedVat);
    }
    appliedChanges.push(`Total: ${formatCentsEs(next.total_cents)}`);
  } else if (typeof explicitVatRate === "number" && next.total_cents > 0) {
    const inv = computeInverseVatForRate(next.total_cents, explicitVatRate);
    next.base_cents = inv.baseCents;
    next.vat_cents = inv.vatCents;
    appliedChanges.push("Desglose recalculado");
  }

  return {
    nextState: next,
    appliedChanges,
    warnings,
    disambiguation,
    engineUsed: "deterministic_rule_engine",
    changed: appliedChanges.length > 0 || warnings.length > 0,
  };
}

/**
 * 8. Patcher incremental para Ficha de Cliente (ClientProfileWidget).
 */
export async function patchClientProfileByVoice(
  current: ClientProfileFormState,
  transcript: string,
  deps: VoicePatchDeps
): Promise<VoiceFormPatchResult<ClientProfileFormState>> {
  const trimmed = transcript.trim();
  if (!trimmed) {
    return { nextState: current, appliedChanges: [], warnings: [], engineUsed: "deterministic_rule_engine", changed: false };
  }

  const next: ClientProfileFormState = { ...current };
  const appliedChanges: string[] = [];
  const warnings: string[] = [];

  const noteDir = extractNoteDirective(trimmed);
  if (noteDir) {
    next.notes =
      noteDir.mode === "append" && next.notes.trim()
        ? `${next.notes.trim()}\n${noteDir.text}`
        : noteDir.text;
    appliedChanges.push("Notas actualizadas");
  }

  const email = extractEmail(trimmed);
  if (email) {
    next.email = email;
    appliedChanges.push(`Email: ${email}`);
  }

  const phone = extractSpanishPhone(trimmed);
  if (phone) {
    next.phone = phone;
    appliedChanges.push(`Teléfono: ${phone}`);
  }

  const tax = extractSpanishTaxId(trimmed);
  if (tax) {
    next.nif = tax.value;
    if (!tax.isValid) {
      warnings.push(`El NIF/NIE/CIF «${tax.value}» no supera el dígito de control.`);
    }
    appliedChanges.push(`NIF: ${tax.value}`);
  }

  const address = extractAddress(trimmed);
  if (address) {
    next.fiscalAddress = address;
    appliedChanges.push("Domicilio actualizado");
  }

  const explicitName =
    /\b(?:nombre(?:\s+completo)?|raz[oó]n\s+social|se\s+llama)[:\s]+([^,;\n]+?)(?=(?:\s*(?:,|;|\btel[eé]fono\b|\btfno\b|\btel\b|\bm[oó]vil\b|\bnif\b|\bcif\b|\bdni\b|\bdomicilio\b|\bdirecci[oó]n\b|\bcorreo\b|\bemail\b|\bnotas?\b|\+34|\b[6789]\d{8}\b)|$))/i.exec(
      trimmed
    );
  if (explicitName?.[1]) {
    next.name = explicitName[1].trim();
    appliedChanges.push(`Nombre: ${next.name}`);
  } else if (appliedChanges.length === 0) {
    const fallback = extractClientFieldsFromText(trimmed);
    if (fallback.name) {
      next.name = fallback.name;
      appliedChanges.push(`Nombre: ${fallback.name}`);
    }
  }

  let engineUsed: InferenceEngine = "deterministic_rule_engine";
  if (appliedChanges.length === 0 && deps.inferenceAdapter?.hasLlmRunner()) {
    const schema = z.object({
      name: z.string().max(160).optional(),
      phone: z.string().max(32).optional(),
      nif: z.string().max(24).optional(),
      fiscalAddress: z.string().max(240).optional(),
      email: z.string().max(160).optional(),
      notes: z.string().max(1000).optional(),
    });
    const llmRes = await deps.inferenceAdapter.extractFormPatch({
      formKind: "Ficha de Cliente",
      currentSnapshot: { ...next },
      transcript: trimmed,
      fieldSpec: "{ name?, phone?, nif?, fiscalAddress?, email?, notes? }",
      schema,
    });
    if (llmRes) {
      engineUsed = llmRes.engine_used;
      Object.assign(next, llmRes.patch);
      appliedChanges.push("Ficha actualizada");
    }
  }

  return {
    nextState: next,
    appliedChanges,
    warnings,
    engineUsed,
    changed: appliedChanges.length > 0 || warnings.length > 0,
  };
}

/**
 * 9. Patcher incremental para Diario de Obra (SiteLogStampWidget).
 */
export async function patchSiteLogByVoice(
  current: SiteLogFormState,
  transcript: string,
  deps: VoicePatchDeps
): Promise<VoiceFormPatchResult<SiteLogFormState>> {
  const trimmed = transcript.trim();
  if (!trimmed) {
    return { nextState: current, appliedChanges: [], warnings: [], engineUsed: "deterministic_rule_engine", changed: false };
  }

  const norm = normalizeSpanishText(trimmed);
  const next: SiteLogFormState = { ...current };
  const appliedChanges: string[] = [];
  const warnings: string[] = [];
  let disambiguation: VoiceDisambiguationPayload | undefined;
  let working = trimmed;

  // Categoría
  if (/\b(?:categor[ií]a\s+)?(?:antes|previo|inicio)\b/.test(norm)) {
    next.category = "antes";
    appliedChanges.push("Categoría: antes");
  } else if (/\b(?:categor[ií]a\s+)?(?:despu[eé]s|acabado|terminado|final)\b/.test(norm)) {
    next.category = "despues";
    appliedChanges.push("Categoría: después");
  } else if (/\b(?:categor[ií]a\s+)?nota(?:\s+t[eé]cnica)?\b/.test(norm) && !/^nota\s*:/i.test(norm)) {
    next.category = "nota";
    appliedChanges.push("Categoría: nota");
  }

  // Nueva obra rápida
  const newJobMatch =
    /\b(?:nueva\s+obra|crear\s+obra)\s*(?::|\s+)?([^,;\n]+?)(?=(?:\s*(?:,|;|\bnota\b|\bdirecci[oó]n\b|\bcategor[ií]a\b|$)))/i.exec(
      working
    );
  if (newJobMatch?.[1]) {
    next.createNewJob = true;
    next.newJobTitle = newJobMatch[1].trim();
    appliedChanges.push(`Nueva obra: ${next.newJobTitle}`);
    working = stripConsumedSlice(working, newJobMatch);
  } else {
    const codeMatch = /\bOBR-\d{4}-\d{3,}\b/i.exec(working);
    const jobMatch =
      /\b(?:en\s+(?:la\s+)?obra|para\s+(?:la\s+)?obra|obra)\s+(?:de\s+|del\s+)?([A-Za-zÁÉÍÓÚÑáéíóúñ0-9.\s-]{2,45}?)(?=\s*(?:[,.;]|\bnota\b|\bantes\b|\bdespu[eé]s\b|$))/i.exec(
        working
      );
    const query = codeMatch?.[0] ?? jobMatch?.[1]?.trim() ?? null;
    if (query) {
      const hits = await resolveJobCandidates(deps.executor, query);
      if (hits.length === 1) {
        next.createNewJob = false;
        next.selectedJobId = hits[0]!.id;
        appliedChanges.push(`Obra: ${hits[0]!.job_code}`);
      } else if (hits.length >= 2) {
        disambiguation = {
          prompt: `Encontré ${hits.length} obras para "${query}". Elige una:`,
          entityType: "job",
          options: hits.slice(0, 5).map((j) => ({
            id: j.id,
            label: `${j.job_code} · ${j.title}`,
            subtitle: j.address || j.status,
          })),
        };
      }
      if (jobMatch) working = stripConsumedSlice(working, jobMatch);
    }
  }

  if (next.createNewJob) {
    const addr = extractAddress(working);
    if (addr) {
      next.newJobAddress = addr;
      working = working.replace(addr, "").trim();
      appliedChanges.push("Dirección de obra actualizada");
    }
  }

  const noteDir = extractNoteDirective(working);
  if (noteDir) {
    next.noteText =
      noteDir.mode === "append" && next.noteText.trim()
        ? `${next.noteText.trim()}\n${noteDir.text}`
        : noteDir.text;
    appliedChanges.push("Nota actualizada");
  } else {
    const leftover = working
      .replace(/\b(?:categor[ií]a\s+(?:antes|despu[eé]s|nota)|antes|despu[eé]s)\b/gi, " ")
      .replace(/^[,.;:\s]+|[,.;:\s]+$/g, "")
      .trim();
    if (leftover.length >= 3) {
      next.noteText = next.noteText.trim() ? `${next.noteText.trim()}\n${leftover}` : leftover;
      appliedChanges.push("Nota añadida");
    }
  }

  return {
    nextState: next,
    appliedChanges,
    warnings,
    disambiguation,
    engineUsed: "deterministic_rule_engine",
    changed: appliedChanges.length > 0 || warnings.length > 0,
  };
}

/**
 * 10. Patcher incremental para "+ Nueva obra" y fechas de obra.
 */
export async function patchNewJobByVoice(
  current: NewJobFormState,
  transcript: string,
  deps: VoicePatchDeps
): Promise<VoiceFormPatchResult<NewJobFormState>> {
  const trimmed = transcript.trim();
  const refDate = deps.referenceDateIso ?? getLocalTodayIso();
  if (!trimmed) {
    return { nextState: current, appliedChanges: [], warnings: [], engineUsed: "deterministic_rule_engine", changed: false };
  }

  const next: NewJobFormState = { ...current };
  const appliedChanges: string[] = [];
  const warnings: string[] = [];
  let disambiguation: VoiceDisambiguationPayload | undefined;
  let working = trimmed;

  // Rango de fechas o fechas individuales
  const range = extractFlexibleDateRange(working, refDate);
  if (range.start_date_iso && range.end_date_iso) {
    next.startDate = range.start_date_iso;
    next.endDate = range.end_date_iso;
    appliedChanges.push(`Fechas: ${range.start_date_iso} → ${range.end_date_iso}`);
  } else {
    const startClause = /\b(?:inicio|empieza|desde)\s*(?:el|:)?\s*([^,;\n]+?)(?=(?:\s*(?:,|;|\bfin\b|\bhasta\b|$)))/i.exec(working);
    const endClause = /\b(?:fin|termina|hasta)\s*(?:el|:)?\s*([^,;\n]+?)(?=(?:\s*(?:,|;|$)))/i.exec(working);
    if (startClause?.[1]) {
      const s = extractFlexibleSpanishDateIso(startClause[1], refDate);
      if (s) {
        next.startDate = s;
        appliedChanges.push(`Inicio: ${s}`);
      }
    }
    if (endClause?.[1]) {
      const e = extractFlexibleSpanishDateIso(endClause[1], next.startDate || refDate);
      if (e) {
        next.endDate = e;
        appliedChanges.push(`Fin: ${e}`);
      }
    }
  }

  // Dirección
  const addr = extractAddress(working);
  if (addr) {
    next.address = addr;
    working = working.replace(addr, "").replace(/\b(?:direcci[oó]n|ubicaci[oó]n|domicilio)\s*(?:es|:)?/gi, " ").trim();
    appliedChanges.push("Dirección actualizada");
  }

  // Cliente
  const clientClause =
    /\b(?:para\s+(?:el\s+|la\s+)?cliente|cliente(?:\s+es)?|para)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ0-9.\s]{1,45}?)(?=\s*(?:,|;|\.|\bdirecci[oó]n\b|\bdel\b|\bdesde\b|\binicio\b|\bt[ií]tulo\b|$))/i.exec(
      working
    );
  if (clientClause?.[1] && !isNonClientNoun(clientClause[1].trim())) {
    const hits = await resolveClientCandidates(deps.executor, clientClause[1].trim());
    if (hits.length === 1) {
      next.clientId = hits[0]!.id;
      appliedChanges.push(`Cliente: ${hits[0]!.name}`);
      working = stripConsumedSlice(working, clientClause);
    } else if (hits.length >= 2) {
      disambiguation = {
        prompt: `Hay ${hits.length} clientes para "${clientClause[1].trim()}". Elige uno:`,
        entityType: "client",
        options: hits.slice(0, 5).map((c) => ({
          id: c.id,
          label: c.name,
          subtitle: c.phone || c.fiscal_address || undefined,
        })),
      };
      working = stripConsumedSlice(working, clientClause);
    } else {
      warnings.push(`No existe el cliente "${clientClause[1].trim()}". Créalo primero o déjalo sin cliente.`);
    }
  }

  // Título
  const titleExtract = extractQuotedJobTitle(working);
  if (titleExtract) {
    next.title = titleExtract.title;
    appliedChanges.push(`Título: ${titleExtract.title}`);
  } else if (appliedChanges.length === 0 && !disambiguation && !next.title.trim()) {
    next.title = trimmed;
    appliedChanges.push(`Título: ${trimmed}`);
  }

  return {
    nextState: next,
    appliedChanges,
    warnings,
    disambiguation,
    engineUsed: "deterministic_rule_engine",
    changed: appliedChanges.length > 0 || warnings.length > 0,
  };
}

/**
 * 11. Patcher incremental para "+ Nueva partida / Editar partida" del Tarifario.
 */
export async function patchCatalogItemByVoice(
  current: CatalogItemFormState,
  transcript: string,
  deps: VoicePatchDeps
): Promise<VoiceFormPatchResult<CatalogItemFormState>> {
  const trimmed = transcript.trim();
  if (!trimmed) {
    return { nextState: current, appliedChanges: [], warnings: [], engineUsed: "deterministic_rule_engine", changed: false };
  }

  const norm = normalizeSpanishText(trimmed);
  const next: CatalogItemFormState = { ...current };
  const appliedChanges: string[] = [];
  const working = trimmed;

  // Categoría
  const catMap: Array<[RegExp, CatalogCategory]> = [
    [/\bfontaner[ií]a\b/, "Fontanería"],
    [/\belectricidad\b/, "Electricidad"],
    [/\balba[ñn]iler[ií]a\b/, "Albañilería"],
    [/\bpintura\b/, "Pintura"],
    [/\bcategor[ií]a\s+general\b/, "General"],
  ];
  for (const [rx, cat] of catMap) {
    if (rx.test(norm)) {
      next.cat = cat;
      appliedChanges.push(`Categoría: ${cat}`);
      break;
    }
  }

  // Unidad
  const unitMatch = /\b(?:unidad|por|en)\s+(m2|m²|ml|kg|lote|h|horas?|ud|unidades?)\b/i.exec(norm);
  if (unitMatch?.[1]) {
    const rawU = unitMatch[1];
    next.unit =
      rawU === "m²" || rawU === "m2"
        ? "m2"
        : rawU.startsWith("hora") || rawU === "h"
          ? "h"
          : rawU.startsWith("unidad") || rawU === "ud"
            ? "ud"
            : rawU;
    appliedChanges.push(`Unidad: ${next.unit}`);
  }

  // IVA
  const explicitVat = extractExplicitQuoteVat(trimmed);
  if (explicitVat !== undefined) {
    next.vatInput = String(explicitVat);
    appliedChanges.push(`IVA: ${explicitVat} %`);
  }

  // Modo horas + materiales vs importe fijo
  const hoursMatch =
    /\b(\d+(?:[.,]\d+)?|un|una|uno|dos|tres|cuatro|cinco|seis|media)\s*(?:horas?|h)\b/i.exec(norm);
  const matMatch =
    /\bmaterial(?:es)?(?:\s+de)?[:\s]+(\d+(?:[.,]\d{1,2})?(?:\s+con\s+\d{1,2})?)\s*(?:€|eur|euros)?/i.exec(
      trimmed
    );
  const fixedMatch =
    /\b(?:precio(?:\s+fijo)?|importe(?:\s+fijo)?|a)\s*(?::|\s+de)?\s*(\d+(?:[.,]\d{1,2})?(?:\s+con\s+\d{1,2})?)\s*(?:€|eur|euros)\b/i.exec(
      trimmed
    );

  if (/\b(?:importe\s+fijo|precio\s+fijo)\b/.test(norm) || (fixedMatch && !hoursMatch && !matMatch)) {
    next.mode = "fixed";
    if (fixedMatch?.[1]) {
      const cents = extractEurosCentsFromPhrase(fixedMatch[1]);
      if (cents !== null && cents > 0) {
        next.fixedPriceInput = (cents / 100).toFixed(2);
        appliedChanges.push(`Precio fijo: ${formatCentsEs(cents)}`);
      }
    }
  } else {
    if (hoursMatch?.[1]) {
      const h = parseSpanishNumberToken(hoursMatch[1]);
      if (h !== null && h >= 0) {
        next.mode = "hourly_plus_materials";
        next.hoursInput = String(h);
        appliedChanges.push(`Duración: ${h} h`);
      }
    }
    if (matMatch?.[1]) {
      const cents = extractEurosCentsFromPhrase(matMatch[1]);
      if (cents !== null && cents >= 0) {
        next.mode = "hourly_plus_materials";
        next.materialsInput = (cents / 100).toFixed(2);
        appliedChanges.push(`Materiales: ${formatCentsEs(cents)}`);
      }
    }
  }

  // Descripción
  const descMatch =
    /\b(?:descripci[oó]n|partida|nombre)\s*(?:es|:)?\s*([^,;\n]+?)(?=(?:\s*(?:,|;|\bcategor[ií]a\b|\bunidad\b|\biva\b|\bmaterial|\bprecio\b|\bimporte\b|\d+\s*(?:h|horas?|€|eur)|$)))/i.exec(
      working
    );
  if (descMatch?.[1]) {
    next.desc = descMatch[1].trim();
    appliedChanges.push(`Descripción: ${next.desc}`);
  } else if (!next.desc.trim() && appliedChanges.length === 0) {
    next.desc = trimmed;
    appliedChanges.push(`Descripción: ${trimmed}`);
  }

  void deps;
  return {
    nextState: next,
    appliedChanges,
    warnings: [],
    engineUsed: "deterministic_rule_engine",
    changed: appliedChanges.length > 0,
  };
}
