import { addDaysIso, getLocalTodayIso, isValidIsoDate } from "../../core/fiscal/dateQuarter";
import { validateSpanishTaxId } from "../../core/fiscal/taxIdValidator";
import { normalizeSpanishText, parseEurosToCents } from "../../core/text/spanishText";

export const SPANISH_MONTHS: Record<string, number> = {
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

export const SPANISH_WEEKDAYS: Record<string, number> = {
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  sabados: 6,
  domingo: 7,
  domingos: 7,
};

export const SPANISH_NUMBERS_MAP: Record<string, number> = {
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
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veinticuatro: 24,
  veinticinco: 25,
  treinta: 30,
  cuarenta: 40,
  cuarentaycinco: 45,
  cincuenta: 50,
  sesenta: 60,
  setenta: 70,
  ochenta: 80,
  noventa: 90,
  cien: 100,
  medio: 0.5,
  media: 0.5,
};

export function parseSpanishNumberToken(token: string): number | null {
  const norm = normalizeSpanishText(token).replace(/\s+/g, "");
  if (!norm) return null;
  if (norm in SPANISH_NUMBERS_MAP) {
    return SPANISH_NUMBERS_MAP[norm] ?? null;
  }
  const numStr = norm.replace(",", ".");
  const parsed = Number(numStr);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function buildIsoIfValid(year: number, month: number, day: number): string | null {
  const candidate = `${year}-${pad2(month)}-${pad2(day)}`;
  return isValidIsoDate(candidate) ? candidate : null;
}

function getIsoWeekdayLocal(dateIso: string): number {
  const [y, m, d] = dateIso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  const jsDay = dt.getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

function shiftYearMonth(year: number, month: number, deltaMonths: number): { year: number; month: number } {
  const zeroBased = year * 12 + (month - 1) + deltaMonths;
  const nextYear = Math.floor(zeroBased / 12);
  const nextMonth = (zeroBased % 12) + 1;
  return { year: nextYear, month: nextMonth };
}

/**
 * Extrae una fecha ISO flexible desde texto en español:
 * ISO (YYYY-MM-DD), español (DD/MM/YYYY), "hoy/ayer/anteayer/mañana/pasado mañana",
 * "en/a N días", "28 de noviembre [de 2026]", "el día 25 [de este mes]", o día de semana ("este viernes", "el próximo lunes").
 */
export function extractFlexibleSpanishDateIso(
  text: string,
  referenceDateIso: string = getLocalTodayIso()
): string | null {
  const isoMatch = /\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/.exec(text);
  if (isoMatch && isValidIsoDate(isoMatch[0])) {
    return isoMatch[0];
  }

  const esMatch = /\b(0?[1-9]|[12]\d|3[01])[/-](0?[1-9]|1[0-2])[/-](20\d{2})\b/.exec(text);
  if (esMatch) {
    const candidate = buildIsoIfValid(Number(esMatch[3]), Number(esMatch[2]), Number(esMatch[1]));
    if (candidate) return candidate;
  }

  const norm = normalizeSpanishText(text);
  const refYear = Number(referenceDateIso.slice(0, 4));
  const refMonth = Number(referenceDateIso.slice(5, 7));

  if (/\bpasado\s+manana\b/.test(norm)) {
    return addDaysIso(referenceDateIso, 2);
  }
  if (/\banteayer\b/.test(norm)) {
    return addDaysIso(referenceDateIso, -2);
  }
  if (/\bayer\b/.test(norm)) {
    return addDaysIso(referenceDateIso, -1);
  }
  if (/\bhoy\b/.test(norm)) {
    return referenceDateIso;
  }

  // Distinguir "mañana" (día siguiente) de "por la mañana" / "de la mañana" / "mañanas" / "mañana de 8 a 14 y tarde..."
  const hasMorningShiftContext =
    /\b(?:por\s+la|de\s+la|en\s+la|turno\s+de|horario\s+de)\s+manana\b/.test(norm) ||
    /\bmananas\b/.test(norm) ||
    (/\bmanana\s+de\s+\d/.test(norm) && /\btardes?\b/.test(norm));
  if (/\bmanana\b/.test(norm) && !hasMorningShiftContext) {
    return addDaysIso(referenceDateIso, 1);
  }

  const relDaysMatch =
    /\b(?:dentro\s+de|en|a)\s+(\d+|un|una|dos|tres|cuatro|cinco|seis|siete|diez|quince|veinte|treinta|cuarenta\s*y\s*cinco|sesenta|noventa)\s+dias?\b/.exec(
      norm
    );
  if (relDaysMatch?.[1]) {
    const num = parseSpanishNumberToken(relDaysMatch[1]);
    if (num !== null && Number.isInteger(num) && num >= 0 && num <= 365) {
      return addDaysIso(referenceDateIso, num);
    }
  }

  const dayMonthMatch =
    /\b(?:el\s+)?(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+(?:de|del)\s+(20\d{2}))?\b/.exec(
      norm
    );
  if (dayMonthMatch) {
    const d = Number(dayMonthMatch[1]);
    const m = SPANISH_MONTHS[dayMonthMatch[2] ?? ""];
    const y = dayMonthMatch[3] ? Number(dayMonthMatch[3]) : refYear;
    if (m) {
      const candidate = buildIsoIfValid(y, m, d);
      if (candidate) return candidate;
    }
  }

  const dayOnlyMatch =
    /\b(?:para\s+el|el\s+dia|dia|el)\s+(\d{1,2})(?:\s+(de\s+este\s+mes|del\s+mes\s+que\s+viene|del\s+proximo\s+mes))?\b(?!\s*(?:%|€|eur|euros|horas?|h\b|m2|ml|kg|uds?))/.exec(
      norm
    );
  if (dayOnlyMatch?.[1]) {
    const d = Number(dayOnlyMatch[1]);
    const mod = dayOnlyMatch[2] ?? "";
    const deltaM = /mes\s+que\s+viene|proximo\s+mes/.test(mod) ? 1 : 0;
    const { year, month } = shiftYearMonth(refYear, refMonth, deltaM);
    const candidate = buildIsoIfValid(year, month, d);
    if (candidate) return candidate;
  }

  const weekdayMatch =
    /\b(?:(este|el\s+proximo|proximo|la\s+semana\s+que\s+viene|el)\s+)?(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b(?:\s+que\s+viene|\s+de\s+la\s+semana\s+que\s+viene)?/.exec(
      norm
    );
  if (weekdayMatch?.[2]) {
    const modifier = weekdayMatch[1] ?? "";
    const fullPhrase = weekdayMatch[0];
    const targetWd = SPANISH_WEEKDAYS[weekdayMatch[2]];
    if (targetWd) {
      const refWd = getIsoWeekdayLocal(referenceDateIso);
      let diff = (targetWd - refWd + 7) % 7;
      if (/proximo|que\s+viene/.test(modifier) || /que\s+viene/.test(fullPhrase)) {
        if (diff === 0 || /semana\s+que\s+viene/.test(fullPhrase)) {
          diff += 7;
        }
      }
      return addDaysIso(referenceDateIso, diff);
    }
  }

  return null;
}

/**
 * Extrae un rango de fechas flexible:
 * - "del 22 de noviembre al 5 de diciembre [de 2026]"
 * - "del 22 al 30 de noviembre [de 2026]"
 * - "del 22 al 30 de este mes" / "del 1 al 5 del mes que viene" / "del 22 al 30"
 * - "del lunes al viernes [de la semana que viene]"
 * - Dos fechas explícitas ISO o DD/MM/YYYY
 */
export function extractFlexibleDateRange(
  text: string,
  referenceDateIso: string = getLocalTodayIso()
): {
  start_date_iso: string | null;
  end_date_iso: string | null;
} {
  const refYear = Number(referenceDateIso.slice(0, 4));
  const refMonth = Number(referenceDateIso.slice(5, 7));
  const norm = normalizeSpanishText(text);

  // 1. "del 22 de noviembre al 5 de diciembre [de 2026]"
  const twoMonthsMatch =
    /\b(?:del|desde\s+el)\s+(\d{1,2})\s+de\s+([a-z]+)\s+(?:al|hasta\s+el)\s+(\d{1,2})\s+de\s+([a-z]+)(?:\s+(?:de|del)\s+(20\d{2}))?\b/.exec(
      norm
    );
  if (twoMonthsMatch) {
    const d1 = Number(twoMonthsMatch[1]);
    const m1 = SPANISH_MONTHS[twoMonthsMatch[2] ?? ""];
    const d2 = Number(twoMonthsMatch[3]);
    const m2 = SPANISH_MONTHS[twoMonthsMatch[4] ?? ""];
    const yr = twoMonthsMatch[5] ? Number(twoMonthsMatch[5]) : refYear;
    if (m1 && m2) {
      const startIso = buildIsoIfValid(yr, m1, d1);
      const endYear = m2 < m1 ? yr + 1 : yr;
      const endIso = buildIsoIfValid(endYear, m2, d2);
      if (startIso && endIso) return { start_date_iso: startIso, end_date_iso: endIso };
    }
  }

  // 2. "del 22 al 30 de noviembre [de 2026]"
  const sameMonthMatch =
    /\b(?:del|desde\s+el)\s+(\d{1,2})\s+(?:al|hasta\s+el)\s+(\d{1,2})\s+de\s+([a-z]+)(?:\s+(?:de|del)\s+(20\d{2}))?\b/.exec(
      norm
    );
  if (sameMonthMatch) {
    const d1 = Number(sameMonthMatch[1]);
    const d2 = Number(sameMonthMatch[2]);
    const m = SPANISH_MONTHS[sameMonthMatch[3] ?? ""];
    const yr = sameMonthMatch[4] ? Number(sameMonthMatch[4]) : refYear;
    if (m) {
      const startIso = buildIsoIfValid(yr, m, d1);
      const endMonthInfo = d2 < d1 ? shiftYearMonth(yr, m, 1) : { year: yr, month: m };
      const endIso = buildIsoIfValid(endMonthInfo.year, endMonthInfo.month, d2);
      if (startIso && endIso) return { start_date_iso: startIso, end_date_iso: endIso };
    }
  }

  // 3. "del 22 al 30 de este mes" / "del 1 al 5 del mes que viene" / "del 22 al 30"
  const relativeMonthRangeMatch =
    /\b(?:del|desde\s+el)\s+(\d{1,2})\s+(?:al|hasta\s+el)\s+(\d{1,2})(?:\s+(de\s+este\s+mes|del\s+mes\s+que\s+viene|del\s+proximo\s+mes|de\s+mes\s+que\s+viene))?\b(?!\s*(?:€|eur|euros|%|horas?|h\b))/.exec(
      norm
    );
  if (relativeMonthRangeMatch) {
    const d1 = Number(relativeMonthRangeMatch[1]);
    const d2 = Number(relativeMonthRangeMatch[2]);
    if (d1 >= 1 && d1 <= 31 && d2 >= 1 && d2 <= 31) {
      const mod = relativeMonthRangeMatch[3] ?? "";
      const deltaM = /mes\s+que\s+viene|proximo\s+mes/.test(mod) ? 1 : 0;
      const startYm = shiftYearMonth(refYear, refMonth, deltaM);
      const endYm = d2 < d1 ? shiftYearMonth(startYm.year, startYm.month, 1) : startYm;
      const startIso = buildIsoIfValid(startYm.year, startYm.month, d1);
      const endIso = buildIsoIfValid(endYm.year, endYm.month, d2);
      if (startIso && endIso) {
        return { start_date_iso: startIso, end_date_iso: endIso };
      }
    }
  }

  // 4. "del lunes al viernes [de la semana que viene]"
  const weekdayRangeMatch =
    /\b(?:del|desde\s+el)\s+(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\s+(?:al|hasta\s+el)\s+(lunes|martes|miercoles|jueves|viernes|sabado|domingo)(?:\s+(de\s+la\s+semana\s+que\s+viene|que\s+viene))?\b/.exec(
      norm
    );
  if (weekdayRangeMatch) {
    const wd1 = SPANISH_WEEKDAYS[weekdayRangeMatch[1] ?? ""];
    const wd2 = SPANISH_WEEKDAYS[weekdayRangeMatch[2] ?? ""];
    if (wd1 && wd2) {
      const refWd = getIsoWeekdayLocal(referenceDateIso);
      let startDiff = (wd1 - refWd + 7) % 7;
      if (weekdayRangeMatch[3]) {
        startDiff += 7;
      }
      const startIso = addDaysIso(referenceDateIso, startDiff);
      const span = (wd2 - wd1 + 7) % 7;
      const endIso = addDaysIso(startIso, span);
      return { start_date_iso: startIso, end_date_iso: endIso };
    }
  }

  // 5. Dos fechas ISO explícitas
  const allIsoMatches = Array.from(
    text.matchAll(/\b(20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))\b/g)
  ).map((m) => m[1]!);
  if (allIsoMatches.length >= 2 && isValidIsoDate(allIsoMatches[0]!) && isValidIsoDate(allIsoMatches[1]!)) {
    return { start_date_iso: allIsoMatches[0]!, end_date_iso: allIsoMatches[1]! };
  }

  // 6. Dos fechas DD/MM/YYYY explícitas
  const allEsMatches = Array.from(
    text.matchAll(/\b(0?[1-9]|[12]\d|3[01])[/-](0?[1-9]|1[0-2])[/-](20\d{2})\b/g)
  )
    .map((m) => buildIsoIfValid(Number(m[3]), Number(m[2]), Number(m[1])))
    .filter((v): v is string => v !== null);
  if (allEsMatches.length >= 2) {
    return { start_date_iso: allEsMatches[0]!, end_date_iso: allEsMatches[1]! };
  }

  return { start_date_iso: null, end_date_iso: null };
}

function toHHMM(hours: number, mins: number): string | null {
  if (!Number.isInteger(hours) || !Number.isInteger(mins)) return null;
  if (hours < 0 || hours > 23 || mins < 0 || mins > 59) return null;
  return `${pad2(hours)}:${pad2(mins)}`;
}

/**
 * Convierte una expresión horaria española ("8", "08:30", "8 y media", "2 y cuarto", "18:00")
 * a HH:MM, aplicando heurística opcional de mañana/tarde.
 */
export function extractSpanishTimeHHMM(
  rawExpr: string,
  hint?: "morning" | "afternoon"
): string | null {
  const norm = normalizeSpanishText(rawExpr)
    .replace(/\b(?:a\s+las|las|a)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!norm) return null;

  const isAfternoonExplicit = /\b(?:de\s+la\s+tarde|por\s+la\s+tarde|pm)\b/.test(norm);
  const isMorningExplicit = /\b(?:de\s+la\s+manana|por\s+la\s+manana|am)\b/.test(norm);
  const clean = norm
    .replace(/\b(?:de\s+la\s+tarde|por\s+la\s+tarde|de\s+la\s+manana|por\s+la\s+manana|am|pm|en\s+punto)\b/g, "")
    .trim();

  // HH:MM o H.MM
  const colonMatch = /^(\d{1,2})[:.](\d{2})$/.exec(clean);
  if (colonMatch) {
    let h = Number(colonMatch[1]);
    const m = Number(colonMatch[2]);
    if ((isAfternoonExplicit || hint === "afternoon") && h >= 1 && h <= 11) {
      h += 12;
    }
    return toHHMM(h, m);
  }

  // "8 y media" / "8 y cuarto" / "5 menos cuarto" / "8"
  const wordMatch = /^(\d{1,2}|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)(?:\s+(y\s+media|y\s+cuarto|menos\s+cuarto))?$/.exec(
    clean
  );
  if (wordMatch) {
    let h = parseSpanishNumberToken(wordMatch[1] ?? "");
    if (h === null || !Number.isInteger(h)) return null;
    let m = 0;
    const frac = wordMatch[2] ?? "";
    if (frac === "y media") m = 30;
    else if (frac === "y cuarto") m = 15;
    else if (frac === "menos cuarto") {
      h = h === 1 ? 12 : h - 1;
      m = 45;
    }
    if ((isAfternoonExplicit || (hint === "afternoon" && !isMorningExplicit)) && h >= 1 && h <= 11) {
      h += 12;
    }
    return toHHMM(h, m);
  }

  return null;
}

const TIME_ATOM_RX =
  "(?:\\d{1,2}[:.]\\d{2}|(?:\\d{1,2}|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)(?:\\s+(?:y\\s+media|y\\s+cuarto|menos\\s+cuarto|en\\s+punto))?)(?:\\s+(?:de\\s+la\\s+(?:manana|tarde)|por\\s+la\\s+(?:manana|tarde)|am|pm))?";

function parseTimePair(
  startRaw: string,
  endRaw: string,
  hint?: "morning" | "afternoon"
): { start: string; end: string } | null {
  const start = extractSpanishTimeHHMM(startRaw, hint);
  let end = extractSpanishTimeHHMM(endRaw, hint);
  if (!start || !end) return null;

  const startMin = Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5));
  let endMin = Number(end.slice(0, 2)) * 60 + Number(end.slice(3, 5));

  // Ej: "de 8 a 2" -> end=02:00 < start=08:00 -> end=14:00
  if (endMin <= startMin && Number(end.slice(0, 2)) >= 1 && Number(end.slice(0, 2)) <= 11) {
    const shifted = toHHMM(Number(end.slice(0, 2)) + 12, Number(end.slice(3, 5)));
    if (shifted) {
      end = shifted;
      endMin = Number(end.slice(0, 2)) * 60 + Number(end.slice(3, 5));
    }
  }
  if (endMin < startMin) return null;
  return { start, end };
}

export interface ExtractedTimeRanges {
  morning?: { start: string; end: string };
  afternoon?: { start: string; end: string };
  continuous?: { start: string; end: string };
  singleRange?: { start: string; end: string };
  explicitStart?: string;
  explicitEnd?: string;
  noAfternoon: boolean;
}

/**
 * Extrae franjas horarias de mañana/tarde, jornada continua, o entrada/salida desde español natural.
 */
export function extractSpanishTimeRanges(text: string): ExtractedTimeRanges {
  const norm = normalizeSpanishText(text);
  const result: ExtractedTimeRanges = {
    noAfternoon: /\b(?:sin\s+tardes?|solo\s+mananas?|jornada\s+continua|horario\s+continuo)\b/.test(norm),
  };

  // Jornada continua explícita: "jornada continua de 8 a 15"
  const contRx = new RegExp(
    `\\b(?:jornada\\s+continua|horario\\s+continuo)\\s+(?:de\\s+)?(${TIME_ATOM_RX})\\s+a\\s+(${TIME_ATOM_RX})`,
    "i"
  );
  const contMatch = contRx.exec(norm);
  if (contMatch) {
    const pair = parseTimePair(contMatch[1]!, contMatch[2]!, "morning");
    if (pair) {
      result.continuous = pair;
      return result;
    }
  }

  // Mañana explícita: "mañanas de 8 a 14" / "por la mañana de 8:30 a 13:30"
  const morningRx = new RegExp(
    `\\b(?:por\\s+la\\s+)?mananas?\\s+(?:de\\s+)?(${TIME_ATOM_RX})\\s+a\\s+(${TIME_ATOM_RX})`,
    "i"
  );
  const morningMatch = morningRx.exec(norm);
  if (morningMatch) {
    const pair = parseTimePair(morningMatch[1]!, morningMatch[2]!, "morning");
    if (pair) result.morning = pair;
  }

  // Tarde explícita: "tardes de 3 a 6" / "por la tarde de 15 a 18"
  const afternoonRx = new RegExp(
    `\\b(?:por\\s+la\\s+)?tardes?\\s+(?:de\\s+)?(${TIME_ATOM_RX})\\s+a\\s+(${TIME_ATOM_RX})`,
    "i"
  );
  const afternoonMatch = afternoonRx.exec(norm);
  if (afternoonMatch) {
    const pair = parseTimePair(afternoonMatch[1]!, afternoonMatch[2]!, "afternoon");
    if (pair) result.afternoon = pair;
  }

  // Dos rangos seguidos sin etiqueta "mañana/tarde": "de 8 a 14 y de 15 a 18"
  if (!result.morning && !result.afternoon) {
    const rangeRx = new RegExp(
      `\\bde\\s+(?:las\\s+)?(${TIME_ATOM_RX})\\s+a\\s+(?:las\\s+)?(${TIME_ATOM_RX})`,
      "gi"
    );
    const matches = Array.from(norm.matchAll(rangeRx));
    if (matches.length >= 2) {
      const p1 = parseTimePair(matches[0]![1]!, matches[0]![2]!, "morning");
      const p2 = parseTimePair(matches[1]![1]!, matches[1]![2]!, "afternoon");
      if (p1) result.morning = p1;
      if (p2) result.afternoon = p2;
    } else if (matches.length === 1) {
      const p1 = parseTimePair(matches[0]![1]!, matches[0]![2]!);
      if (p1) {
        if (result.noAfternoon) {
          result.continuous = p1;
        } else {
          result.singleRange = p1;
        }
      }
    }
  }

  const startRx = new RegExp(
    `\\b(?:entrada|empezar|entro|empiezo|inicio)\\s+(?:a\\s+las\\s+|a\\s+)?(${TIME_ATOM_RX})`,
    "i"
  );
  const startMatch = startRx.exec(norm);
  if (startMatch?.[1]) {
    const parsed = extractSpanishTimeHHMM(startMatch[1]);
    if (parsed) result.explicitStart = parsed;
  }

  const endRx = new RegExp(
    `\\b(?:salida|salgo|sali|salimos|terminar|termino|termine|acabar|acabo|acabe|fin)\\s+(?:a\\s+las\\s+|a\\s+)?(${TIME_ATOM_RX})`,
    "i"
  );
  const endMatch = endRx.exec(norm);
  if (endMatch?.[1]) {
    const parsed = extractSpanishTimeHHMM(endMatch[1], "afternoon");
    if (parsed) result.explicitEnd = parsed;
  }

  return result;
}

/**
 * Interpreta días laborables en español ("de lunes a viernes", "de lunes a sábado",
 * "añade los sábados", "quita los viernes", "lunes, miércoles y viernes").
 */
export function extractSpanishWeekdaysPatch(
  text: string,
  currentDays: number[]
): number[] | null {
  const norm = normalizeSpanishText(text);

  if (/\btodos\s+los\s+dias\b/.test(norm)) {
    return [1, 2, 3, 4, 5, 6, 7];
  }

  // Rango explícito: "de lunes a viernes" / "lunes a sábado"
  const rangeMatch =
    /\b(?:de\s+)?(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\s+a\s+(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.exec(
      norm
    );
  if (rangeMatch) {
    const d1 = SPANISH_WEEKDAYS[rangeMatch[1] ?? ""];
    const d2 = SPANISH_WEEKDAYS[rangeMatch[2] ?? ""];
    if (d1 && d2) {
      const days: number[] = [];
      let cur = d1;
      for (let i = 0; i < 7; i += 1) {
        days.push(cur);
        if (cur === d2) break;
        cur = (cur % 7) + 1;
      }
      return Array.from(new Set(days)).sort((a, b) => a - b);
    }
  }

  const dayRxGlobal = /\b(lunes|martes|miercoles|jueves|viernes|sabados?|domingos?)\b/g;

  // Modificadores incrementales ("añade los sábados", "quita los viernes", "sin domingos")
  const addClause =
    /\b(?:anade|anadir|agrega|agregar|incluye|incluir|activar|activa|trabajar\s+tambien|con)\s+(?:los?\s+|el\s+)?([^.;]+?)(?=(?:\s*(?:,|;|\by\s+de\b|\bmananas?\b|\btardes?\b|\bjornada\b|\bquita\b|\bsin\b)|$))/i.exec(
      norm
    );
  const removeClause =
    /\b(?:quita|quitar|elimina|eliminar|desactiva|desactivar|sin|no\s+trabaj(?:o|amos)\s+(?:los?\s+)?)(?:los?\s+|el\s+)?([^.;]+?)(?=(?:\s*(?:,|;|\by\s+de\b|\bmananas?\b|\btardes?\b|\bjornada\b|\banade\b)|$))/i.exec(
      norm
    );

  if (addClause || removeClause) {
    const next = new Set(currentDays);
    let touched = false;
    if (addClause?.[1]) {
      for (const m of addClause[1].matchAll(dayRxGlobal)) {
        const wd = SPANISH_WEEKDAYS[m[1] ?? ""];
        if (wd) {
          next.add(wd);
          touched = true;
        }
      }
    }
    if (removeClause?.[1]) {
      for (const m of removeClause[1].matchAll(dayRxGlobal)) {
        const wd = SPANISH_WEEKDAYS[m[1] ?? ""];
        if (wd) {
          next.delete(wd);
          touched = true;
        }
      }
    }
    if (touched && next.size > 0) {
      return Array.from(next).sort((a, b) => a - b);
    }
  }

  // Lista explícita de días (sin verbos de rango/añadir/quitar)
  const explicitDays = new Set<number>();
  for (const m of norm.matchAll(dayRxGlobal)) {
    const wd = SPANISH_WEEKDAYS[m[1] ?? ""];
    if (wd) explicitDays.add(wd);
  }
  if (explicitDays.size > 0) {
    return Array.from(explicitDays).sort((a, b) => a - b);
  }

  return null;
}

/**
 * Extrae NIF/NIE/CIF tolerando espacios o guiones procedentes de STT ("12345678 Z", "B-85296341").
 */
export function extractSpanishTaxId(
  text: string
): { value: string; isValid: boolean } | null {
  const rx =
    /\b([A-Z][\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?[0-9A-J]|\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?[A-Z])\b/i;
  const match = rx.exec(text);
  if (!match?.[1]) return null;
  const cleaned = match[1].replace(/[\s-]+/g, "").toUpperCase();
  if (cleaned.length !== 9) return null;
  return {
    value: cleaned,
    isValid: validateSpanishTaxId(cleaned),
  };
}

/**
 * Extrae un teléfono español en formato E.164 (+34XXXXXXXXX).
 */
export function extractSpanishPhone(text: string): string | null {
  const match = /(?:(?:\+|00)\s*34[\s.-]?)?([6789](?:[\s.-]?\d){8})\b/.exec(text);
  if (!match?.[1]) return null;
  const digits = match[1].replace(/\D/g, "");
  return digits.length === 9 ? `+34${digits}` : null;
}

/**
 * Extrae correo electrónico escrito o dictado ("laura arroba gmail punto com").
 */
export function extractEmail(text: string): string | null {
  const direct = /\b([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/i.exec(text);
  if (direct?.[1]) {
    return direct[1].toLowerCase();
  }

  const spoken =
    /\b([a-z0-9._-]+(?:\s+punto\s+[a-z0-9._-]+)*)\s+arroba\s+([a-z0-9-]+(?:\s+punto\s+[a-z]{2,})+)\b/i.exec(
      normalizeSpanishText(text)
    );
  if (spoken?.[1] && spoken[2]) {
    const local = spoken[1].replace(/\s+punto\s+/g, ".").replace(/\s+/g, "");
    const domain = spoken[2].replace(/\s+punto\s+/g, ".").replace(/\s+/g, "");
    const candidate = `${local}@${domain}`;
    if (/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(candidate)) {
      return candidate;
    }
  }
  return null;
}

const STOP_FIELD_LOOKAHEAD =
  "(?=\\s*(?:;|\\n|,?\\s*(?:\\btel[eé]fono\\b|\\btfno\\b|\\btel\\b|\\bm[oó]vil\\b|\\bnif\\b|\\bcif\\b|\\bdni\\b|\\bnie\\b|\\bemail\\b|\\bcorreo\\b|\\biva\\b|\\bnotas?\\b|\\bvencimiento\\b|\\bemisi[oó]n\\b|\\bfactura\\b|\\bcliente\\b|\\bemisor\\b|\\bdel\\s+\\d+\\s+al\\b|\\bpara\\b|\\+34|\\b[6789]\\d{8}\\b)|$))";

/**
 * Extrae domicilio fiscal o dirección de obra deteniéndose ante el siguiente campo dictado.
 */
export function extractAddress(text: string): string | null {
  const explicitRx = new RegExp(
    `(?:domicilio\\s+fiscal|direcci[oó]n(?:\\s+fiscal|\\s+de\\s+la\\s+obra)?|domicilio|ubicaci[oó]n)\\s*(?:es|:|\\s+en)?\\s+([^\\n]{4,550}?)${STOP_FIELD_LOOKAHEAD}`,
    "i"
  );
  const explicit = explicitRx.exec(text);
  if (explicit?.[1]) {
    const val = explicit[1].trim().replace(/[,;.\s]+$/, "");
    if (val.length >= 4) return val;
  }

  const streetRx = new RegExp(
    `\\b((?:calle|c\\/|avenida|avda\\.?|av\\.?|plaza|pza\\.?|paseo|ronda|camino|carretera|traves[ií]a)\\s+[^\\n]{3,500}?)${STOP_FIELD_LOOKAHEAD}`,
    "i"
  );
  const street = streetRx.exec(text);
  if (street?.[1]) {
    const val = street[1].trim().replace(/[,;.\s]+$/, "");
    if (val.length >= 5) return val;
  }

  return null;
}

/**
 * Extrae directivas de notas ("añade en notas ...", "nota: ...", "observaciones: ...").
 */
export function extractNoteDirective(
  text: string
): { mode: "append" | "replace"; text: string } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const appendMatch =
    /(?:a[ñn]ad(?:e|ir)|agreg(?:a|ar)|pon(?:er)?)\s+(?:en\s+)?(?:las?\s+)?(?:notas?|observaciones?)\s*(?:que|:)?\s*(.+)$/i.exec(
      trimmed
    );
  if (appendMatch?.[1]) {
    const content = appendMatch[1].trim().replace(/^["«]|["»]$/g, "");
    if (content) return { mode: "append", text: content };
  }

  const replaceMatch =
    /(?:^|[.;,]\s*)(?:notas?|observaciones?|apunta(?:r)?(?:\s+en\s+notas?)?)\s*(?::|\s+que)\s*(.+)$/i.exec(
      trimmed
    );
  if (replaceMatch?.[1]) {
    const content = replaceMatch[1].trim().replace(/^["«]|["»]$/g, "");
    if (content) return { mode: "replace", text: content };
  }

  return null;
}

/**
 * Convierte expresiones monetarias españolas ("120,50 €", "45 con 50 euros", "300 eur") a céntimos.
 */
export function extractEurosCentsFromPhrase(phrase: string): number | null {
  const spokenCents =
    /\b(\d+)\s+con\s+(\d{1,2})\s*(?:€|eur|euros)?\b/i.exec(phrase);
  if (spokenCents?.[1] && spokenCents[2]) {
    const eur = Number(spokenCents[1]);
    const centsPart = Number(spokenCents[2].padEnd(2, "0").slice(0, 2));
    if (Number.isFinite(eur) && Number.isFinite(centsPart)) {
      return eur * 100 + centsPart;
    }
  }
  const numMatch = /(\d+(?:\.\d{3})*(?:[.,]\d{1,2})?)\s*(?:€|eur|euros)?/i.exec(phrase);
  if (numMatch?.[1]) {
    return parseEurosToCents(numMatch[1]);
  }
  return null;
}
