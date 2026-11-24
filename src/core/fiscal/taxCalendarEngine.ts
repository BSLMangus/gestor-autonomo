import type {
  TaxModelCode,
  TaxObligationStateRow,
  TaxObligationStatus,
} from "../contracts/types";
import { addDaysIso } from "./dateQuarter";

export const DEFAULT_ACTIVE_TAX_MODELS: TaxModelCode[] = ["303", "130", "390", "347", "100"];

export type TaxModelCategory = "IVA" | "IRPF" | "Retenciones" | "Informativa" | "Renta";
export type TaxModelFrequency = "quarterly" | "annual" | "single";

export interface TaxModelMeta {
  code: TaxModelCode;
  shortLabel: string;
  title: string;
  category: TaxModelCategory;
  frequency: TaxModelFrequency;
  description: string;
}

export const TAX_MODEL_CATALOG: readonly TaxModelMeta[] = [
  {
    code: "303",
    shortLabel: "Mod. 303",
    title: "Autoliquidación trimestral de IVA",
    category: "IVA",
    frequency: "quarterly",
    description: "Diferencia entre IVA repercutido en facturas y soportado en gastos.",
  },
  {
    code: "130",
    shortLabel: "Mod. 130",
    title: "Pago fraccionado IRPF (Estimación Directa)",
    category: "IRPF",
    frequency: "quarterly",
    description: "Adelanto trimestral del IRPF sobre el beneficio neto acumulado.",
  },
  {
    code: "131",
    shortLabel: "Mod. 131",
    title: "Pago fraccionado IRPF (Módulos)",
    category: "IRPF",
    frequency: "quarterly",
    description: "Para autónomos acogidos al régimen de estimación objetiva.",
  },
  {
    code: "111",
    shortLabel: "Mod. 111",
    title: "Retenciones e ingresos a cuenta (trabajo/profesionales)",
    category: "Retenciones",
    frequency: "quarterly",
    description: "Si recibes facturas de otros profesionales con IRPF retenido o tienes nóminas.",
  },
  {
    code: "115",
    shortLabel: "Mod. 115",
    title: "Retenciones por alquiler de local/inmueble urbano",
    category: "Retenciones",
    frequency: "quarterly",
    description: "Si alquilas un local, nave u oficina sujeta a retención.",
  },
  {
    code: "349",
    shortLabel: "Mod. 349",
    title: "Declaración recapitulativa de operaciones intracomunitarias",
    category: "Informativa",
    frequency: "quarterly",
    description: "Compras o ventas de bienes/servicios con empresas de otros países de la UE.",
  },
  {
    code: "309",
    shortLabel: "Mod. 309",
    title: "Declaración-liquidación no periódica de IVA",
    category: "IVA",
    frequency: "quarterly",
    description: "Autoliquidación puntual de IVA para sujetos en recargo de equivalencia u operaciones concretas.",
  },
  {
    code: "390",
    shortLabel: "Mod. 390",
    title: "Resumen anual de IVA",
    category: "IVA",
    frequency: "annual",
    description: "Resumen informativo anual de todas las autoliquidaciones de IVA del ejercicio.",
  },
  {
    code: "190",
    shortLabel: "Mod. 190",
    title: "Resumen anual de retenciones e ingresos a cuenta",
    category: "Retenciones",
    frequency: "annual",
    description: "Resumen informativo anual vinculado al Modelo 111.",
  },
  {
    code: "180",
    shortLabel: "Mod. 180",
    title: "Resumen anual de retenciones por alquileres",
    category: "Retenciones",
    frequency: "annual",
    description: "Resumen informativo anual vinculado al Modelo 115.",
  },
  {
    code: "347",
    shortLabel: "Mod. 347",
    title: "Operaciones con terceros (> 3.005,06 €)",
    category: "Informativa",
    frequency: "annual",
    description: "Clientes o proveedores con los que se superen 3.005,06 € anuales.",
  },
  {
    code: "100",
    shortLabel: "Mod. 100",
    title: "Declaración anual de la Renta (IRPF)",
    category: "Renta",
    frequency: "annual",
    description: "Campaña anual del IRPF del ejercicio anterior.",
  },
  {
    code: "102",
    shortLabel: "Mod. 102",
    title: "Segundo plazo Renta (fraccionamiento 40 %)",
    category: "Renta",
    frequency: "single",
    description: "Vencimiento único del segundo pago si fraccionaste la Renta positiva.",
  },
] as const;

export const TAX_MODEL_META_BY_CODE = new Map<TaxModelCode, TaxModelMeta>(
  TAX_MODEL_CATALOG.map((m) => [m.code, m])
);

export interface TaxObligationInstance {
  obligationKey: string;
  modelCode: TaxModelCode;
  meta: TaxModelMeta;
  fiscalYear: number;
  periodCode: string;
  periodLabel: string;
  startDateIso: string;
  nominalEndDateIso: string;
  endDateIso: string;
  debitCutoffIso: string | null;
  isSingleDueDate: boolean;
  status: TaxObligationStatus;
  stateRow?: TaxObligationStateRow;
}

export type TaxAlertKind = "start_upcoming" | "start_today" | "end_upcoming" | "end_today" | "overdue";
export type TaxAlertUrgency = "info" | "warning" | "critical";

export interface TaxAlertItem {
  alertKey: string;
  obligation: TaxObligationInstance;
  kind: TaxAlertKind;
  urgency: TaxAlertUrgency;
  daysUntilTarget: number;
  daysRemainingToEnd: number;
  triggerDateIso: string;
  headline: string;
  detail: string;
}

export interface GroupedTaxNotificationDay {
  triggerDateIso: string;
  urgency: TaxAlertUrgency;
  title: string;
  body: string;
  alerts: TaxAlertItem[];
}

export function diffDaysIso(fromIso: string, toIso: string): number {
  const [y1, m1, d1] = fromIso.split("-").map(Number);
  const [y2, m2, d2] = toIso.split("-").map(Number);
  const ms1 = Date.UTC(y1!, m1! - 1, d1!);
  const ms2 = Date.UTC(y2!, m2! - 1, d2!);
  return Math.round((ms2 - ms1) / 86_400_000);
}

/**
 * Calcula Domingo de Resurrección mediante algoritmo gregoriano anónimo (Computus).
 */
export function computeEasterSundayIso(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function getSpanishNationalHolidays(year: number): Set<string> {
  const y = String(year).padStart(4, "0");
  const goodFriday = addDaysIso(computeEasterSundayIso(year), -2);
  return new Set([
    `${y}-01-01`,
    `${y}-01-06`,
    goodFriday,
    `${y}-05-01`,
    `${y}-08-15`,
    `${y}-10-12`,
    `${y}-11-01`,
    `${y}-12-06`,
    `${y}-12-08`,
    `${y}-12-25`,
  ]);
}

export function isNonBusinessDay(iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return false;
  const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return true;
  return getSpanishNationalHolidays(y).has(iso);
}

export function shiftToNextBusinessDay(iso: string): string {
  let cursor = iso;
  let guard = 0;
  while (isNonBusinessDay(cursor) && guard < 14) {
    cursor = addDaysIso(cursor, 1);
    guard += 1;
  }
  return cursor;
}

function lastDayOfFebIso(year: number): string {
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return `${String(year).padStart(4, "0")}-02-${isLeap ? "29" : "28"}`;
}

function makeObligation(params: {
  modelCode: TaxModelCode;
  fiscalYear: number;
  periodCode: string;
  periodLabel: string;
  startDateIso: string;
  nominalEndDateIso: string;
  nominalDebitCutoffIso?: string | null;
  isSingleDueDate?: boolean;
  statesMap?: ReadonlyMap<string, TaxObligationStateRow>;
}): TaxObligationInstance {
  const key = `${params.modelCode}_${params.fiscalYear}_${params.periodCode}`;
  const stateRow = params.statesMap?.get(key);
  const meta = TAX_MODEL_META_BY_CODE.get(params.modelCode)!;
  return {
    obligationKey: key,
    modelCode: params.modelCode,
    meta,
    fiscalYear: params.fiscalYear,
    periodCode: params.periodCode,
    periodLabel: params.periodLabel,
    startDateIso: params.startDateIso,
    nominalEndDateIso: params.nominalEndDateIso,
    endDateIso: shiftToNextBusinessDay(params.nominalEndDateIso),
    debitCutoffIso: params.nominalDebitCutoffIso
      ? shiftToNextBusinessDay(params.nominalDebitCutoffIso)
      : null,
    isSingleDueDate: Boolean(params.isSingleDueDate),
    status: stateRow?.status ?? "pendiente",
    stateRow,
  };
}

export function generateTaxObligationsForYear(
  fiscalYear: number,
  activeModels: ReadonlyArray<TaxModelCode>,
  statesMap?: ReadonlyMap<string, TaxObligationStateRow>
): TaxObligationInstance[] {
  const activeSet = new Set(activeModels);
  const out: TaxObligationInstance[] = [];
  const nextYear = fiscalYear + 1;

  const quarterlyModels: TaxModelCode[] = ["303", "130", "131", "111", "115", "349", "309"];
  for (const model of quarterlyModels) {
    if (!activeSet.has(model)) continue;
    const hasDebit = model !== "349";
    out.push(
      makeObligation({
        modelCode: model,
        fiscalYear,
        periodCode: "T1",
        periodLabel: `1T ${fiscalYear}`,
        startDateIso: `${fiscalYear}-04-01`,
        nominalEndDateIso: `${fiscalYear}-04-20`,
        nominalDebitCutoffIso: hasDebit ? `${fiscalYear}-04-15` : null,
        statesMap,
      }),
      makeObligation({
        modelCode: model,
        fiscalYear,
        periodCode: "T2",
        periodLabel: `2T ${fiscalYear}`,
        startDateIso: `${fiscalYear}-07-01`,
        nominalEndDateIso: `${fiscalYear}-07-20`,
        nominalDebitCutoffIso: hasDebit ? `${fiscalYear}-07-15` : null,
        statesMap,
      }),
      makeObligation({
        modelCode: model,
        fiscalYear,
        periodCode: "T3",
        periodLabel: `3T ${fiscalYear}`,
        startDateIso: `${fiscalYear}-10-01`,
        nominalEndDateIso: `${fiscalYear}-10-20`,
        nominalDebitCutoffIso: hasDebit ? `${fiscalYear}-10-15` : null,
        statesMap,
      })
    );

    const isEarlyJanModel = model === "111" || model === "115";
    out.push(
      makeObligation({
        modelCode: model,
        fiscalYear,
        periodCode: "T4",
        periodLabel: `4T ${fiscalYear}`,
        startDateIso: `${nextYear}-01-01`,
        nominalEndDateIso: isEarlyJanModel ? `${nextYear}-01-20` : `${nextYear}-01-30`,
        nominalDebitCutoffIso: hasDebit
          ? isEarlyJanModel
            ? `${nextYear}-01-15`
            : `${nextYear}-01-25`
          : null,
        statesMap,
      })
    );
  }

  if (activeSet.has("390")) {
    out.push(
      makeObligation({
        modelCode: "390",
        fiscalYear,
        periodCode: "ANUAL",
        periodLabel: `Resumen anual ${fiscalYear}`,
        startDateIso: `${nextYear}-01-01`,
        nominalEndDateIso: `${nextYear}-01-30`,
        nominalDebitCutoffIso: null,
        statesMap,
      })
    );
  }

  for (const model of ["190", "180"] as const) {
    if (!activeSet.has(model)) continue;
    out.push(
      makeObligation({
        modelCode: model,
        fiscalYear,
        periodCode: "ANUAL",
        periodLabel: `Resumen anual ${fiscalYear}`,
        startDateIso: `${nextYear}-01-01`,
        nominalEndDateIso: `${nextYear}-01-31`,
        nominalDebitCutoffIso: null,
        statesMap,
      })
    );
  }

  if (activeSet.has("347")) {
    out.push(
      makeObligation({
        modelCode: "347",
        fiscalYear,
        periodCode: "ANUAL",
        periodLabel: `Anual ${fiscalYear}`,
        startDateIso: `${nextYear}-02-01`,
        nominalEndDateIso: lastDayOfFebIso(nextYear),
        nominalDebitCutoffIso: null,
        statesMap,
      })
    );
  }

  if (activeSet.has("100")) {
    const startRenta =
      fiscalYear === 2025 ? "2026-04-08" : shiftToNextBusinessDay(`${nextYear}-04-02`);
    out.push(
      makeObligation({
        modelCode: "100",
        fiscalYear,
        periodCode: "ANUAL",
        periodLabel: `Renta ${fiscalYear}`,
        startDateIso: startRenta,
        nominalEndDateIso: `${nextYear}-06-30`,
        nominalDebitCutoffIso: `${nextYear}-06-25`,
        statesMap,
      })
    );
  }

  if (activeSet.has("102")) {
    const shiftedDue = shiftToNextBusinessDay(`${nextYear}-11-05`);
    out.push(
      makeObligation({
        modelCode: "102",
        fiscalYear,
        periodCode: "PLAZO2",
        periodLabel: `2º plazo Renta ${fiscalYear}`,
        startDateIso: shiftedDue,
        nominalEndDateIso: `${nextYear}-11-05`,
        nominalDebitCutoffIso: `${nextYear}-11-02`,
        isSingleDueDate: true,
        statesMap,
      })
    );
  }

  return out;
}

export function listObligationsAroundYear(
  centerYear: number,
  activeModels: ReadonlyArray<TaxModelCode>,
  statesMap?: ReadonlyMap<string, TaxObligationStateRow>
): TaxObligationInstance[] {
  const byKey = new Map<string, TaxObligationInstance>();
  for (const y of [centerYear - 1, centerYear, centerYear + 1]) {
    for (const ob of generateTaxObligationsForYear(y, activeModels, statesMap)) {
      byKey.set(ob.obligationKey, ob);
    }
  }
  return Array.from(byKey.values()).sort((a, b) =>
    a.endDateIso === b.endDateIso
      ? a.obligationKey.localeCompare(b.obligationKey)
      : a.endDateIso.localeCompare(b.endDateIso)
  );
}

const START_OFFSET_DAYS = new Set([14, 7, 0]);
const END_OFFSET_DAYS = new Set([14, 7, 3, 2, 1, 0]);

export function computeTaxAlertsForDate(
  dateIso: string,
  activeModels: ReadonlyArray<TaxModelCode>,
  statesMap?: ReadonlyMap<string, TaxObligationStateRow>,
  dismissalsSet?: ReadonlySet<string>,
  opts?: { includeOverdue?: boolean }
): TaxAlertItem[] {
  const [y] = dateIso.split("-").map(Number);
  const year = y || 2026;
  const includeOverdue = opts?.includeOverdue ?? true;
  const obligations = listObligationsAroundYear(year, activeModels, statesMap);
  const alerts: TaxAlertItem[] = [];

  for (const ob of obligations) {
    if (ob.status === "presentado" || ob.status === "no_aplica") continue;

    const daysToEnd = diffDaysIso(dateIso, ob.endDateIso);
    const daysToStart = diffDaysIso(dateIso, ob.startDateIso);

    if (includeOverdue && daysToEnd < 0 && Math.abs(daysToEnd) <= 30) {
      const overdueDays = Math.abs(daysToEnd);
      const alertKey = `${ob.obligationKey}_overdue`;
      if (!dismissalsSet?.has(alertKey)) {
        alerts.push({
          alertKey,
          obligation: ob,
          kind: "overdue",
          urgency: "critical",
          daysUntilTarget: daysToEnd,
          daysRemainingToEnd: daysToEnd,
          triggerDateIso: dateIso,
          headline: `${ob.meta.shortLabel} (${ob.periodLabel}) vencido hace ${overdueDays} ${overdueDays === 1 ? "día" : "días"}`,
          detail: `Plazo finalizado el ${ob.endDateIso}. Márcalo presentado o revisa tu situación con AEAT.`,
        });
      }
      continue;
    }

    if (END_OFFSET_DAYS.has(daysToEnd)) {
      const alertKey = `${ob.obligationKey}_end_${daysToEnd}`;
      if (!dismissalsSet?.has(alertKey)) {
        const isToday = daysToEnd === 0;
        const urgency: TaxAlertUrgency = daysToEnd <= 3 ? "critical" : "warning";
        alerts.push({
          alertKey,
          obligation: ob,
          kind: isToday ? "end_today" : "end_upcoming",
          urgency,
          daysUntilTarget: daysToEnd,
          daysRemainingToEnd: daysToEnd,
          triggerDateIso: dateIso,
          headline: isToday
            ? `ÚLTIMO DÍA: ${ob.meta.shortLabel} (${ob.periodLabel})`
            : `Faltan ${daysToEnd} ${daysToEnd === 1 ? "día" : "días"} para cierre del ${ob.meta.shortLabel} (${ob.periodLabel})`,
          detail: `Límite ${ob.endDateIso}${ob.debitCutoffIso ? ` · Domiciliación hasta ${ob.debitCutoffIso}` : ""}`,
        });
      }
    }

    if (!ob.isSingleDueDate && START_OFFSET_DAYS.has(daysToStart)) {
      // No duplicar inicio si ya estamos dentro de aviso de fin en el mismo día (ej. plazos muy cortos)
      const alertKey = `${ob.obligationKey}_start_${daysToStart}`;
      if (!dismissalsSet?.has(alertKey)) {
        const isToday = daysToStart === 0;
        alerts.push({
          alertKey,
          obligation: ob,
          kind: isToday ? "start_today" : "start_upcoming",
          urgency: isToday ? "warning" : "info",
          daysUntilTarget: daysToStart,
          daysRemainingToEnd: daysToEnd,
          triggerDateIso: dateIso,
          headline: isToday
            ? `Abre plazo hoy: ${ob.meta.shortLabel} (${ob.periodLabel})`
            : `En ${daysToStart} días abre ${ob.meta.shortLabel} (${ob.periodLabel})`,
          detail: `Ventana del ${ob.startDateIso} al ${ob.endDateIso}`,
        });
      }
    }
  }

  const rankUrgency: Record<TaxAlertUrgency, number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };
  return alerts.sort((a, b) => {
    const r = rankUrgency[a.urgency] - rankUrgency[b.urgency];
    if (r !== 0) return r;
    return a.daysRemainingToEnd - b.daysRemainingToEnd;
  });
}

export function computeUpcomingGroupedAlerts(
  fromIso: string,
  horizonDays = 60,
  activeModels: ReadonlyArray<TaxModelCode>,
  statesMap?: ReadonlyMap<string, TaxObligationStateRow>,
  dismissalsSet?: ReadonlySet<string>
): GroupedTaxNotificationDay[] {
  const days: GroupedTaxNotificationDay[] = [];
  const safeHorizon = Math.max(0, Math.min(90, horizonDays));

  for (let offset = 0; offset <= safeHorizon; offset += 1) {
    const targetIso = addDaysIso(fromIso, offset);
    const items = computeTaxAlertsForDate(targetIso, activeModels, statesMap, dismissalsSet, {
      includeOverdue: false,
    });
    if (items.length === 0) continue;

    const topUrgency: TaxAlertUrgency = items.some((a) => a.urgency === "critical")
      ? "critical"
      : items.some((a) => a.urgency === "warning")
        ? "warning"
        : "info";

    const first = items[0]!;
    const title =
      items.length === 1
        ? first.headline
        : `${items.length} avisos fiscales Hacienda (${first.obligation.meta.shortLabel} y más)`;
    const body =
      items.length === 1
        ? first.detail
        : items.map((a) => `• ${a.headline}`).join("\n");

    days.push({
      triggerDateIso: targetIso,
      urgency: topUrgency,
      title,
      body,
      alerts: items,
    });
  }

  return days;
}

export interface TaxCalendarDayMilestone {
  dateIso: string;
  milestoneKind: "start" | "debit" | "end";
  obligation: TaxObligationInstance;
}

export function getTaxMilestonesByMonth(
  year: number,
  monthIndex0Based: number,
  activeModels: ReadonlyArray<TaxModelCode>,
  statesMap?: ReadonlyMap<string, TaxObligationStateRow>
): Map<string, TaxCalendarDayMilestone[]> {
  const prefix = `${String(year).padStart(4, "0")}-${String(monthIndex0Based + 1).padStart(2, "0")}-`;
  const obligations = listObligationsAroundYear(year, activeModels, statesMap);
  const byDate = new Map<string, TaxCalendarDayMilestone[]>();

  const push = (iso: string | null, kind: TaxCalendarDayMilestone["milestoneKind"], ob: TaxObligationInstance) => {
    if (!iso || !iso.startsWith(prefix)) return;
    const list = byDate.get(iso) ?? [];
    list.push({ dateIso: iso, milestoneKind: kind, obligation: ob });
    byDate.set(iso, list);
  };

  for (const ob of obligations) {
    if (!ob.isSingleDueDate) {
      push(ob.startDateIso, "start", ob);
    }
    push(ob.debitCutoffIso, "debit", ob);
    push(ob.endDateIso, "end", ob);
  }

  return byDate;
}
