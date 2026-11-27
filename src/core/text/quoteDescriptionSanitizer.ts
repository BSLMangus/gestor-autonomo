const CURRENCY_END = "(?=$|[\\s,.;:)\\]}!?/])";
const CURRENCY_TOKEN = `(?:€|eur(?:os?)?)${CURRENCY_END}`;
const NUM_CORE = "(?:\\d{1,3}(?:\\.\\d{3})+|\\d+)(?:[.,]\\d{1,2})?(?:\\s+con\\s+\\d{1,2})?";
const UNIT_SUFFIX = "(?:\\s*\\/\\s*[a-zA-Z0-9²³°áéíóúñ.%]+)?";
const PER_UNIT_SUFFIX =
  "(?:\\s*(?:c\\/u|por\\s+(?:unidad|ud|m2|m²|hora|h|metro|ml)|cada\\s+(?:uno|una|ud)))?";
const PRICE_CONNECTOR =
  "(?:[-–:|·=]+|(?:por|a|de|precio|pvp|coste|importe)(?:\\s*[:=])?)";

const PAREN_CURRENCY_RE = new RegExp(
  `[\\(\\[]\\s*(?:(?:precio|pvp|coste|importe|aprox\\.?|unos?|desde)\\s*[:=]?\\s*)?(?:(?:€\\s*|eur\\s+)(${NUM_CORE})|(${NUM_CORE})\\s*${CURRENCY_TOKEN}${UNIT_SUFFIX}${PER_UNIT_SUFFIX})(?:\\s*(?:iva\\s+(?:incl\\.?|incluido|no\\s+incl\\.?)))?\\s*[\\)\\]]`,
  "gi"
);

const QTY_X_PRICE_RE = new RegExp(
  `(?:^|\\s)(?:[-–:|·,]\\s*)?\\d+(?:[.,]\\d{1,3})?\\s*(?:ud|uds|u|m2|m²|m|ml|h|hrs|horas?|kg|l|pa|juegos?|cajas?|metros?|unidades?)?\\s*[x×*]\\s*(${NUM_CORE})\\s*${CURRENCY_TOKEN}${UNIT_SUFFIX}(?:\\s*=\\s*${NUM_CORE}\\s*${CURRENCY_TOKEN})?${CURRENCY_END}`,
  "gi"
);

const CONNECTOR_SUFFIX_CURRENCY_RE = new RegExp(
  `(?:^|\\s)${PRICE_CONNECTOR}\\s*(?:(?:€\\s*|eur\\s+)(${NUM_CORE})|(${NUM_CORE})\\s*${CURRENCY_TOKEN}${UNIT_SUFFIX}${PER_UNIT_SUFFIX})${CURRENCY_END}`,
  "gi"
);

const SUFFIX_CURRENCY_RE = new RegExp(
  `(?:^|\\s)(${NUM_CORE})\\s*${CURRENCY_TOKEN}${UNIT_SUFFIX}${PER_UNIT_SUFFIX}${CURRENCY_END}`,
  "gi"
);

const PREFIX_CURRENCY_RE = new RegExp(
  `(?:^|\\s)(?:€\\s*|eur(?:\\s+|\\s*[:=]\\s*))(${NUM_CORE})${UNIT_SUFFIX}${PER_UNIT_SUFFIX}${CURRENCY_END}`,
  "gi"
);

const BARE_TRAILING_DELIMITED_NUM_RE =
  /(?:\s+[-–:=|]\s*|[:=|]\s*|[-–]\s+)(\d{1,3}(?:\.\d{3})+|\d+(?:[.,]\d{1,2})?)\s*$/;

function parseSpanishAmountToCents(rawNum: string): number | null {
  const cleaned = rawNum.trim().toLowerCase();
  if (!cleaned) return null;

  const conMatch = /^(\d{1,3}(?:\.\d{3})+|\d+)\s+con\s+(\d{1,2})$/.exec(cleaned);
  if (conMatch) {
    const euros = Number(conMatch[1]!.replace(/\./g, ""));
    const centsPart = Number(conMatch[2]!.padEnd(2, "0"));
    if (!Number.isFinite(euros) || !Number.isFinite(centsPart)) return null;
    const total = euros * 100 + centsPart;
    return total >= 0 && total <= 100_000_000 ? total : null;
  }

  let normalized = cleaned;
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(normalized)) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (/^\d+,\d{1,2}$/.test(normalized)) {
    normalized = normalized.replace(",", ".");
  } else if (/^\d+\.\d{1,2}$/.test(normalized)) {
    // decimal with dot
  } else if (/^\d+$/.test(normalized)) {
    // integer euros
  } else {
    normalized = normalized.replace(",", ".");
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  const cents = Math.round(parsed * 100);
  return cents <= 100_000_000 ? cents : null;
}

function cleanupOrphanedFragments(text: string): string {
  let out = text
    .replace(/\(\s*\)|\[\s*\]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  let prev = "";
  while (out !== prev) {
    prev = out;
    out = out
      .replace(/^[\s\-–:|·=,]+/, "")
      .replace(/[\s\-–:|·=,]+$/, "")
      .replace(/(?:^|\s)(?:por|a|de|pvp|precio|coste|importe)\s*$/i, "")
      .replace(/\(\s*\)|\[\s*\]/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  return out;
}

export function extractPriceAndCleanDescription(raw: string): {
  description: string;
  extractedPriceCents: number | null;
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { description: "", extractedPriceCents: null };
  }

  let extractedPriceCents: number | null = null;
  const capturePrice = (numCandidate: string | undefined) => {
    if (extractedPriceCents !== null || !numCandidate) return;
    const parsed = parseSpanishAmountToCents(numCandidate);
    if (parsed !== null) {
      extractedPriceCents = parsed;
    }
  };

  let working = trimmed;

  working = working.replace(PAREN_CURRENCY_RE, (_m, p1?: string, p2?: string) => {
    capturePrice(p1 ?? p2);
    return " ";
  });

  working = working.replace(QTY_X_PRICE_RE, (_m, p1?: string) => {
    capturePrice(p1);
    return " ";
  });

  working = working.replace(CONNECTOR_SUFFIX_CURRENCY_RE, (_m, p1?: string, p2?: string) => {
    capturePrice(p1 ?? p2);
    return " ";
  });

  working = working.replace(SUFFIX_CURRENCY_RE, (_m, p1?: string) => {
    capturePrice(p1);
    return " ";
  });

  working = working.replace(PREFIX_CURRENCY_RE, (_m, p1?: string) => {
    capturePrice(p1);
    return " ";
  });

  const cleaned = cleanupOrphanedFragments(working);
  return {
    description: cleaned.length > 0 ? cleaned : trimmed,
    extractedPriceCents,
  };
}

export function sanitizeQuoteItemDescription(
  raw: string,
  opts?: { knownPricesCents?: number[] }
): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const { description } = extractPriceAndCleanDescription(trimmed);
  let working = description;

  const known = opts?.knownPricesCents?.filter((n) => Number.isFinite(n) && n >= 0) ?? [];
  if (known.length > 0) {
    const bareMatch = BARE_TRAILING_DELIMITED_NUM_RE.exec(working);
    if (bareMatch?.[1]) {
      const candidateCents = parseSpanishAmountToCents(bareMatch[1]);
      if (candidateCents !== null && known.includes(candidateCents)) {
        const stripped = cleanupOrphanedFragments(working.slice(0, bareMatch.index));
        if (stripped.length > 0) {
          working = stripped;
        }
      }
    }
  }

  return working.length > 0 ? working : trimmed;
}
