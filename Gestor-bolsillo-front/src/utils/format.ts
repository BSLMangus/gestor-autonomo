import type { FiscalQuarter, WorkScheduleDefaults } from '../types/domain';

export function formatEuros(cents: number, showDecimals = true): string {
  const euros = cents / 100;
  return (
    new Intl.NumberFormat('es-ES', {
      minimumFractionDigits: showDecimals ? 2 : 0,
      maximumFractionDigits: showDecimals ? 2 : 0,
    }).format(euros) + ' €'
  );
}

export function formatSignedEuros(cents: number): string {
  const prefix = cents > 0 ? '+' : cents < 0 ? '-' : '';
  return `${prefix}${formatEuros(Math.abs(cents))}`;
}

export function formatHours(hours: number): string {
  return `${hours.toFixed(1).replace('.', ',')} h`;
}

export function formatSignedHours(hours: number): string {
  const prefix = hours > 0 ? '+' : hours < 0 ? '-' : '';
  return `${prefix}${Math.abs(hours).toFixed(1).replace('.', ',')} h`;
}

export function parseSpanishNumber(raw: string): number {
  const cleaned = raw.replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.');
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function eurosToCents(euros: number): number {
  return Math.round(euros * 100);
}

export function getInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0);
  if (parts.length === 0) return 'CL';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function parseTimeToMinutes(hhmm: string): number {
  const [hStr, mStr] = hhmm.split(':');
  const h = Number.parseInt(hStr ?? '0', 10);
  const m = Number.parseInt(mStr ?? '0', 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

export function minutesToHHMM(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(totalMinutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function calculateDailyHoursFromDefaults(defaults: WorkScheduleDefaults): {
  morningHours: number;
  afternoonHours: number;
  totalHours: number;
} {
  const morningMin = Math.max(0, parseTimeToMinutes(defaults.morning_end) - parseTimeToMinutes(defaults.morning_start));
  const afternoonMin = Math.max(0, parseTimeToMinutes(defaults.afternoon_end) - parseTimeToMinutes(defaults.afternoon_start));
  const morningHours = Math.round((morningMin / 60) * 10) / 10;
  const afternoonHours = Math.round((afternoonMin / 60) * 10) / 10;
  return {
    morningHours,
    afternoonHours,
    totalHours: Math.round((morningHours + afternoonHours) * 10) / 10,
  };
}

/** Returns ISO weekday 1 (Monday) .. 7 (Sunday) for YYYY-MM-DD */
export function getIsoWeekday(dateIso: string): number {
  const [y, m, d] = dateIso.split('-').map((n) => Number.parseInt(n, 10));
  const dt = new Date(y, (m || 1) - 1, d || 1);
  const day = dt.getDay();
  return day === 0 ? 7 : day;
}

export function listDatesInRange(startIso: string, endIso: string): string[] {
  if (!startIso || !endIso || startIso > endIso) return [];
  const [sy, sm, sd] = startIso.split('-').map((n) => Number.parseInt(n, 10));
  const [ey, em, ed] = endIso.split('-').map((n) => Number.parseInt(n, 10));
  const current = new Date(sy, (sm || 1) - 1, sd || 1);
  const end = new Date(ey, (em || 1) - 1, ed || 1);
  const result: string[] = [];
  let guard = 0;
  while (current <= end && guard < 90) {
    const y = current.getFullYear();
    const m = String(current.getMonth() + 1).padStart(2, '0');
    const d = String(current.getDate()).padStart(2, '0');
    result.push(`${y}-${m}-${d}`);
    current.setDate(current.getDate() + 1);
    guard += 1;
  }
  return result;
}

const SHORT_MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const FULL_MONTHS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];
const FULL_WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const SHORT_WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

export function formatShortDate(dateIso?: string): string {
  if (!dateIso) return 'Sin fecha';
  const [, m, d] = dateIso.split('-').map((n) => Number.parseInt(n, 10));
  return `${d} ${SHORT_MONTHS[(m || 1) - 1] ?? ''}`;
}

export function formatDateRange(startIso?: string, endIso?: string): string {
  if (!startIso && !endIso) return 'Sin fechas fijadas';
  if (startIso && !endIso) return `Desde ${formatShortDate(startIso)}`;
  if (!startIso && endIso) return `Hasta ${formatShortDate(endIso)}`;
  return `${formatShortDate(startIso)} – ${formatShortDate(endIso)}`;
}

export function formatFullDayLabel(dateIso: string): string {
  const [y, m, d] = dateIso.split('-').map((n) => Number.parseInt(n, 10));
  const dt = new Date(y, (m || 1) - 1, d || 1);
  const weekday = FULL_WEEKDAYS[dt.getDay()] ?? '';
  const monthShort = SHORT_MONTHS[(m || 1) - 1] ?? '';
  const capitalizedMonth = monthShort.charAt(0).toUpperCase() + monthShort.slice(1);
  return `${weekday} ${d} ${capitalizedMonth}`;
}

export function formatShortDayLabel(dateIso: string): string {
  const [y, m, d] = dateIso.split('-').map((n) => Number.parseInt(n, 10));
  const dt = new Date(y, (m || 1) - 1, d || 1);
  const weekday = SHORT_WEEKDAYS[dt.getDay()] ?? '';
  return `${weekday} ${d} ${SHORT_MONTHS[(m || 1) - 1] ?? ''}`;
}

export function formatMonthYear(year: number, monthIndex: number): string {
  return `${FULL_MONTHS[monthIndex] ?? ''} ${year}`;
}

export function dateToQuarter(dateIso: string): FiscalQuarter {
  const month = Number.parseInt(dateIso.split('-')[1] ?? '11', 10);
  if (month >= 7 && month <= 9) return '2026-T3';
  return '2026-T4';
}

export function computeQuoteTotals(
  lines: Array<{ quantity: number; unit_price_cents: number }>,
  vatRate: number,
): { subtotal_cents: number; vat_cents: number; total_cents: number } {
  const subtotal_cents = lines.reduce(
    (sum, line) => sum + Math.round(line.quantity * line.unit_price_cents),
    0,
  );
  const vat_cents = Math.round((subtotal_cents * vatRate) / 100);
  return {
    subtotal_cents,
    vat_cents,
    total_cents: subtotal_cents + vat_cents,
  };
}
