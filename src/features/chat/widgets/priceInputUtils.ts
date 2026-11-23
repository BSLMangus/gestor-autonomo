export function sanitizeDecimalPriceInput(raw: string): string {
  const normalized = raw.replace(/,/g, ".");
  let result = "";
  let hasDot = false;
  for (const ch of normalized) {
    if (ch >= "0" && ch <= "9") {
      result += ch;
    } else if (ch === "." && !hasDot) {
      result += ".";
      hasDot = true;
    }
  }
  return result;
}

export function eurInputToCents(raw: string): number {
  const cleaned = sanitizeDecimalPriceInput(raw).trim();
  if (!cleaned || cleaned === ".") return 0;
  const val = Number.parseFloat(cleaned);
  if (!Number.isFinite(val) || val < 0) return 0;
  return Math.round(val * 100);
}

export function formatPriceInputOnBlur(raw: string): { display: string; cents: number } {
  const cleaned = sanitizeDecimalPriceInput(raw).trim();
  if (!cleaned || cleaned === ".") {
    return { display: "", cents: 0 };
  }
  const num = Number.parseFloat(cleaned);
  if (!Number.isFinite(num) || num < 0) {
    return { display: "", cents: 0 };
  }
  return {
    display: num.toFixed(2),
    cents: Math.round(num * 100),
  };
}

export function shouldClearPriceOnFocus(raw: string): boolean {
  const trimmed = raw.trim();
  return trimmed === "0.00" || trimmed === "0" || trimmed === "0,00";
}

export function centsToInitialPriceText(cents: number): string {
  return cents > 0 ? (cents / 100).toFixed(2) : "";
}
