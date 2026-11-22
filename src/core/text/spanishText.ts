/**
 * Normaliza texto en español eliminando diacríticos y convirtiendo a minúsculas.
 */
export function normalizeSpanishText(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Convierte una cifra monetaria en formato español ("1.250,50" o "38,5") o estándar a céntimos enteros.
 */
export function parseEurosToCents(rawNum: string): number | null {
  const clean = rawNum.replace(/\s+/g, "");
  if (!clean) return null;
  let normalized = clean;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(clean)) {
    normalized = clean.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = clean.replace(",", ".");
  }
  const val = Number(normalized);
  if (!Number.isFinite(val) || val < 0) return null;
  return Math.round(val * 100);
}
