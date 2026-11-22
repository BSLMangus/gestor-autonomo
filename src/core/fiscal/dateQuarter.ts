/**
 * Calendario local del dispositivo y utilidades de trimestre fiscal español ({YYYY}-T{Q}).
 * Nunca utiliza UTC (.toISOString()) para evitar saltos de día entre 00:00 y 01:59 en España.
 */

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatLocalDateIso(ms: number): string {
  const dt = new Date(ms);
  const y = dt.getFullYear();
  const m = dt.getMonth() + 1;
  const d = dt.getDate();
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

export function formatLocalDateTimeIso(ms: number): string {
  const dt = new Date(ms);
  const y = dt.getFullYear();
  const m = dt.getMonth() + 1;
  const d = dt.getDate();
  const hh = dt.getHours();
  const mm = dt.getMinutes();
  const ss = dt.getSeconds();
  return `${y}-${pad2(m)}-${pad2(d)}T${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
}

export function getLocalTodayIso(): string {
  return formatLocalDateIso(Date.now());
}

export function isValidIsoDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return false;
  }
  const parts = iso.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) {
    return false;
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function deriveFiscalQuarter(iso: string): string {
  if (!isValidIsoDate(iso)) {
    throw new Error(`SCHEMA_VALIDATION_ERROR: Fecha ISO inválida '${iso}'`);
  }
  const parts = iso.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const q = Math.floor((m - 1) / 3) + 1;
  return `${y}-T${q}`;
}

export function addDaysIso(iso: string, days: number): string {
  if (!isValidIsoDate(iso) || !Number.isInteger(days)) {
    throw new Error(`SCHEMA_VALIDATION_ERROR: Parámetros de fecha inválidos '${iso}', ${days}`);
  }
  const parts = iso.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export function getFiscalYearFromIso(iso: string): number {
  if (!isValidIsoDate(iso)) {
    throw new Error(`SCHEMA_VALIDATION_ERROR: Fecha ISO inválida '${iso}'`);
  }
  return Number(iso.slice(0, 4));
}

export function compareQuarter(a: string, b: string): number {
  const matchA = /^(\d{4})-T([1-4])$/.exec(a);
  const matchB = /^(\d{4})-T([1-4])$/.exec(b);
  if (!matchA || !matchB) {
    throw new Error(`SCHEMA_VALIDATION_ERROR: Trimestre inválido '${a}' vs '${b}'`);
  }
  const numA = Number(matchA[1]) * 4 + Number(matchA[2]);
  const numB = Number(matchB[1]) * 4 + Number(matchB[2]);
  return numA - numB;
}
