import { addDaysIso, compareQuarter, formatLocalDateIso } from "./dateQuarter";
import {
  QuotePaymentMethodSchema,
  QuotePaymentScheduleSchema,
} from "../contracts/schemas";
import type {
  BillingMode,
  ExpenseTicketRow,
  FiscalPiggyBankPayload,
  InvoiceRow,
  JobFiscalSummary,
  JobRow,
  LaborOnlySubMode,
  QuotePaymentInstallment,
  QuotePaymentMethod,
  QuoteRow,
  QuoteVatRate,
  ScheduleEntryRow,
  TicketVatRate,
} from "../contracts/types";

/**
 * Redondeo determinista mitad al alza sobre enteros (céntimos).
 */
export function roundHalfUpDiv(numerator: number, denominator: number): number {
  if (denominator <= 0 || !Number.isInteger(numerator) || !Number.isInteger(denominator)) {
    throw new Error("SCHEMA_VALIDATION_ERROR: operandos enteros requeridos");
  }
  const sign = numerator < 0 ? -1 : 1;
  return sign * Math.floor((Math.abs(numerator) * 2 + denominator) / (2 * denominator));
}

export function computeLineSubtotalCents(
  quantityThousandths: number,
  unitPriceCents: number
): number {
  return roundHalfUpDiv(quantityThousandths * unitPriceCents, 1000);
}

export function computeQuoteTotals(
  lines: ReadonlyArray<{ quantity_thousandths: number; unit_price_cents: number }>,
  vatRate: QuoteVatRate
): {
  lineSubtotals: number[];
  subtotalCents: number;
  vatCents: number;
  totalCents: number;
} {
  const lineSubtotals = lines.map((line) =>
    computeLineSubtotalCents(line.quantity_thousandths, line.unit_price_cents)
  );
  const subtotalCents = lineSubtotals.reduce((acc, val) => acc + val, 0);
  const vatRateThousandths = Math.round(vatRate * 1000);
  const vatCents = roundHalfUpDiv(subtotalCents * vatRateThousandths, 100_000);
  return {
    lineSubtotals,
    subtotalCents,
    vatCents,
    totalCents: subtotalCents + vatCents,
  };
}

export function computeQuoteTotalsByBillingMode(params: {
  billingMode: BillingMode;
  laborSubMode?: LaborOnlySubMode;
  lines: ReadonlyArray<{ quantity_thousandths: number; unit_price_cents: number }>;
  vatRate: QuoteVatRate;
  horasEstimadasThousandths?: number;
  tarifaHoraCents?: number | null;
  manoObraFijaCents?: number;
}): {
  itemsSubtotalCents: number;
  laborCents: number;
  subtotalCents: number;
  vatCents: number;
  totalCents: number;
} {
  const {
    billingMode,
    laborSubMode = "por_horas",
    lines,
    vatRate,
    horasEstimadasThousandths = 0,
    tarifaHoraCents = 0,
    manoObraFijaCents = 0,
  } = params;

  const safeHours = Math.max(0, Math.round(horasEstimadasThousandths));
  const safeRate = Math.max(0, Math.round(tarifaHoraCents ?? 0));
  const safeFixedLabor = Math.max(0, Math.round(manoObraFijaCents));

  const rawItemsSubtotal = lines.reduce(
    (acc, line) => acc + computeLineSubtotalCents(line.quantity_thousandths, line.unit_price_cents),
    0
  );

  let itemsSubtotalCents = 0;
  let laborCents = 0;

  switch (billingMode) {
    case "solo_partidas":
      itemsSubtotalCents = rawItemsSubtotal;
      laborCents = 0;
      break;
    case "partidas_mas_horas":
      itemsSubtotalCents = rawItemsSubtotal;
      laborCents = roundHalfUpDiv(safeHours * safeRate, 1000);
      break;
    case "partidas_mas_fijo_mano_obra":
      itemsSubtotalCents = rawItemsSubtotal;
      laborCents = safeFixedLabor;
      break;
    case "solo_mano_obra":
      itemsSubtotalCents = 0;
      laborCents =
        laborSubMode === "por_horas"
          ? roundHalfUpDiv(safeHours * safeRate, 1000)
          : safeFixedLabor;
      break;
  }

  const subtotalCents = itemsSubtotalCents + laborCents;
  const vatRateThousandths = Math.round(vatRate * 1000);
  const vatCents = roundHalfUpDiv(subtotalCents * vatRateThousandths, 100_000);

  return {
    itemsSubtotalCents,
    laborCents,
    subtotalCents,
    vatCents,
    totalCents: subtotalCents + vatCents,
  };
}

export function computeAdvanceByPercent(
  quoteSubtotalCents: number,
  vatRate: QuoteVatRate,
  percent: number
): {
  baseCents: number;
  vatCents: number;
  totalCents: number;
} {
  const bps = Math.max(0, Math.round(percent * 100));
  const baseCents = roundHalfUpDiv(quoteSubtotalCents * bps, 10_000);
  const vatRateThousandths = Math.round(vatRate * 1000);
  const vatCents = roundHalfUpDiv(baseCents * vatRateThousandths, 100_000);
  return {
    baseCents,
    vatCents,
    totalCents: baseCents + vatCents,
  };
}

export function computeAdvance40(
  quoteSubtotalCents: number,
  vatRate: QuoteVatRate
): {
  baseCents: number;
  vatCents: number;
  totalCents: number;
} {
  return computeAdvanceByPercent(quoteSubtotalCents, vatRate, 40);
}

export function computePaymentScheduleAmounts(
  totalCents: number,
  schedule: ReadonlyArray<{ label: string; percentage: number }>
): Array<{ label: string; percentage: number; amount_cents: number }> {
  if (schedule.length === 0) return [];
  const safeTotal = Math.max(0, Math.round(totalCents));
  let prevCumCents = 0;
  let cumBps = 0;
  return schedule.map((item, idx) => {
    cumBps += Math.max(0, Math.round(item.percentage * 100));
    const isLast = idx === schedule.length - 1;
    const clampedCumBps = Math.min(10_000, cumBps);
    const cumCents = isLast ? safeTotal : roundHalfUpDiv(safeTotal * clampedCumBps, 10_000);
    const amountCents = Math.max(0, cumCents - prevCumCents);
    prevCumCents = cumCents;
    return {
      label: item.label,
      percentage: item.percentage,
      amount_cents: amountCents,
    };
  });
}

export function parseQuotePaymentMethodsJson(
  raw: string | null | undefined
): QuotePaymentMethod[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: QuotePaymentMethod[] = [];
    for (const item of parsed) {
      const check = QuotePaymentMethodSchema.safeParse(item);
      if (check.success && !out.includes(check.data)) {
        out.push(check.data);
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function parseQuotePaymentScheduleJson(
  raw: string | null | undefined
): QuotePaymentInstallment[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const check = QuotePaymentScheduleSchema.safeParse(parsed);
    return check.success ? check.data : [];
  } catch {
    return [];
  }
}

export type QuoteAdvancePolicy =
  | { allowAdvance: true; advancePercent: number; mode: "default_40" }
  | { allowAdvance: false; advancePercent: 100; mode: "single_payment" }
  | { allowAdvance: true; advancePercent: number; mode: "first_installment"; firstLabel: string };

export function resolveQuoteAdvancePolicy(
  schedule: ReadonlyArray<QuotePaymentInstallment>
): QuoteAdvancePolicy {
  if (schedule.length === 0) {
    return { allowAdvance: true, advancePercent: 40, mode: "default_40" };
  }
  if (schedule.length === 1) {
    return { allowAdvance: false, advancePercent: 100, mode: "single_payment" };
  }
  const first = schedule[0]!;
  return {
    allowAdvance: true,
    advancePercent: first.percentage,
    mode: "first_installment",
    firstLabel: first.label,
  };
}

export function deriveInvoiceAdvancePercent(
  invoice: Pick<InvoiceRow, "kind" | "base_cents">,
  quote?: Pick<QuoteRow, "subtotal_cents" | "vat_rate" | "payment_schedule_json"> | null
): number {
  if (invoice.kind !== "advance_40") return 100;
  if (quote) {
    const policy = resolveQuoteAdvancePolicy(
      parseQuotePaymentScheduleJson(quote.payment_schedule_json)
    );
    if (policy.allowAdvance) {
      const expected = computeAdvanceByPercent(
        quote.subtotal_cents,
        quote.vat_rate,
        policy.advancePercent
      );
      if (expected.baseCents === invoice.base_cents) {
        return policy.advancePercent;
      }
    }
    if (quote.subtotal_cents > 0) {
      return Math.round((invoice.base_cents * 10_000) / quote.subtotal_cents) / 100;
    }
  }
  return 40;
}

export function formatPercentEs(percent: number): string {
  const rounded = Math.round(percent * 100) / 100;
  return `${String(rounded).replace(".", ",")} %`;
}

export function computeQuoteValidUntilIso(
  createdAtMs: number,
  validityDays: number | null | undefined
): string | null {
  if (validityDays === null || validityDays === undefined) return null;
  const days = Math.trunc(validityDays);
  if (!Number.isFinite(days) || days < 1) return null;
  const issuedIso = formatLocalDateIso(createdAtMs);
  return addDaysIso(issuedIso, days);
}

export function computeFinalInvoiceFromQuoteAndAdvance(
  quoteSubtotalCents: number,
  quoteVatCents: number,
  advanceBaseCents: number,
  advanceVatCents: number
): {
  baseCents: number;
  vatCents: number;
  totalCents: number;
} {
  const baseCents = quoteSubtotalCents - advanceBaseCents;
  const vatCents = quoteVatCents - advanceVatCents;
  if (baseCents < 0 || vatCents < 0) {
    throw new Error("INVALID_STATE_TRANSITION: El anticipo excede el importe del presupuesto");
  }
  return {
    baseCents,
    vatCents,
    totalCents: baseCents + vatCents,
  };
}

export function computeInverseVat21(totalCents: number): {
  baseCents: number;
  vatCents: number;
} {
  const baseCents = roundHalfUpDiv(totalCents * 100, 121);
  return {
    baseCents,
    vatCents: totalCents - baseCents,
  };
}

export function isTicketWithinTolerance(
  baseCents: number,
  vatCents: number,
  totalCents: number
): boolean {
  return Math.abs(baseCents + vatCents - totalCents) <= 2;
}

export function deriveRateOrMixed(baseCents: number, vatCents: number): TicketVatRate {
  if (baseCents === 0) {
    return vatCents === 0 ? 0 : "mixed";
  }
  const candidates: Array<0 | 4 | 10 | 21> = [0, 4, 10, 21];
  for (const rate of candidates) {
    const expectedVat = roundHalfUpDiv(baseCents * rate, 100);
    if (Math.abs(expectedVat - vatCents) <= 2) {
      return rate;
    }
  }
  return "mixed";
}

export function computePiggyBank(params: {
  quarter: string;
  invoices: ReadonlyArray<InvoiceRow>;
  tickets: ReadonlyArray<ExpenseTicketRow>;
  jobs: ReadonlyArray<JobRow>;
  selectedJobId?: string | null;
  irpfRate?: number;
}): FiscalPiggyBankPayload {
  const { quarter, invoices, tickets, jobs, selectedJobId = null, irpfRate } = params;

  let ivaRepercutidoCents = 0;
  let baseFacturadaQuarterCents = 0;
  let cobradoMismoTrimestreCents = 0;
  let cobrosTrimestresAnterioresCents = 0;
  let pendienteCobroTrimestreCents = 0;
  let pendienteCobroAnterioresCents = 0;

  for (const inv of invoices) {
    const qCmp = compareQuarter(inv.quarter, quarter);
    if (qCmp === 0) {
      ivaRepercutidoCents += inv.vat_cents;
      baseFacturadaQuarterCents += inv.base_cents;

      if (inv.status === "pagado" && inv.paid_quarter === quarter) {
        cobradoMismoTrimestreCents += inv.total_cents;
      } else if (inv.status === "pendiente_cobro" || inv.status === "vencido") {
        pendienteCobroTrimestreCents += inv.total_cents;
      }
    } else if (qCmp < 0) {
      if (inv.status === "pagado" && inv.paid_quarter === quarter) {
        cobrosTrimestresAnterioresCents += inv.total_cents;
      } else if (inv.status === "pendiente_cobro" || inv.status === "vencido") {
        pendienteCobroAnterioresCents += inv.total_cents;
      }
    }
  }

  let ivaSoportadoCents = 0;
  let baseTicketsQuarterCents = 0;
  let totalTicketsQuarterCents = 0;

  for (const tkt of tickets) {
    if (tkt.quarter === quarter) {
      ivaSoportadoCents += tkt.vat_cents;
      baseTicketsQuarterCents += tkt.base_cents;
      totalTicketsQuarterCents += tkt.total_cents;
    }
  }

  const ivaToReserveCents = Math.max(0, ivaRepercutidoCents - ivaSoportadoCents);
  const ivaToCompensateCents = Math.max(0, ivaSoportadoCents - ivaRepercutidoCents);
  const netYieldCents = Math.max(0, baseFacturadaQuarterCents - baseTicketsQuarterCents);
  const effectiveIrpfRate = irpfRate ?? 20;
  const irpfRateThousandths = Math.round(effectiveIrpfRate * 1000);
  const irpf20Cents = roundHalfUpDiv(netYieldCents * irpfRateThousandths, 100_000);
  const untouchableTaxCents = ivaToReserveCents + irpf20Cents;
  const availableCashCents =
    cobradoMismoTrimestreCents - totalTicketsQuarterCents - untouchableTaxCents;

  const jobProfits: FiscalPiggyBankPayload["job_profits"] = [];
  let selectedJobProfitCents: number | null = null;

  for (const job of jobs) {
    if (job.status === "cancelado") continue;

    const jobInvoices = invoices.filter((inv) => inv.job_id === job.id);
    const jobTickets = tickets.filter((tkt) => tkt.job_id === job.id);

    const hasActivityInQuarter =
      jobInvoices.some((inv) => inv.quarter === quarter) ||
      jobTickets.some((tkt) => tkt.quarter === quarter);
    const isActiveJob = job.status === "pendiente" || job.status === "en_curso";

    const invoicedBaseTotal = jobInvoices.reduce((sum, inv) => sum + inv.base_cents, 0);
    const ticketsBaseTotal = jobTickets.reduce((sum, tkt) => sum + tkt.base_cents, 0);
    const netProfitCents = invoicedBaseTotal - ticketsBaseTotal;

    if (job.id === selectedJobId) {
      selectedJobProfitCents = netProfitCents;
    }

    if (isActiveJob || hasActivityInQuarter) {
      jobProfits.push({
        job_id: job.id,
        job_code: job.job_code,
        job_title: job.title,
        net_profit_cents: netProfitCents,
      });
    }
  }

  return {
    quarter,
    cobrado_mismo_trimestre_cents: cobradoMismoTrimestreCents,
    cobros_trimestres_anteriores_cents: cobrosTrimestresAnterioresCents,
    pendiente_cobro_trimestre_cents: pendienteCobroTrimestreCents,
    pendiente_cobro_anteriores_cents: pendienteCobroAnterioresCents,
    iva_repercutido_cents: ivaRepercutidoCents,
    iva_soportado_cents: ivaSoportadoCents,
    iva_to_reserve_cents: ivaToReserveCents,
    iva_to_compensate_cents: ivaToCompensateCents,
    irpf_20_cents: irpf20Cents,
    ...(irpfRate !== undefined ? { irpf_rate: effectiveIrpfRate } : {}),
    untouchable_tax_cents: untouchableTaxCents,
    available_cash_cents: availableCashCents,
    selected_job_profit_cents: selectedJobProfitCents,
    job_profits: jobProfits,
  };
}

export function computeJobSummary(params: {
  job: JobRow;
  activeQuote: QuoteRow | null;
  invoices: ReadonlyArray<InvoiceRow>;
  tickets: ReadonlyArray<ExpenseTicketRow>;
}): JobFiscalSummary {
  const { job, activeQuote, invoices, tickets } = params;
  const invoicedBase = invoices.reduce((acc, inv) => acc + inv.base_cents, 0);
  const collectedGross = invoices
    .filter((inv) => inv.status === "pagado")
    .reduce((acc, inv) => acc + inv.total_cents, 0);
  const pendingGross = invoices
    .filter((inv) => inv.status === "pendiente_cobro" || inv.status === "vencido")
    .reduce((acc, inv) => acc + inv.total_cents, 0);
  const ticketsBase = tickets.reduce((acc, t) => acc + t.base_cents, 0);
  const ticketsGross = tickets.reduce((acc, t) => acc + t.total_cents, 0);

  return {
    job_id: job.id,
    job_code: job.job_code,
    quoted_base_cents: activeQuote?.subtotal_cents ?? 0,
    invoiced_base_cents: invoicedBase,
    collected_gross_cents: collectedGross,
    pending_invoice_gross_cents: pendingGross,
    tickets_base_cents: ticketsBase,
    tickets_gross_cents: ticketsGross,
    net_profit_cents: invoicedBase - ticketsBase,
    has_advance_40: invoices.some((inv) => inv.series_type === "ANT"),
    has_final_invoice: invoices.some((inv) => inv.series_type === "FAC"),
  };
}

export interface JobBillingProfitability {
  jobId: string;
  billingMode: BillingMode;
  laborSubMode: LaborOnlySubMode;
  quotedBaseCents: number;
  quotedItemsCents: number;
  quotedLaborCents: number;
  invoicedBaseCents: number;
  ticketsBaseCents: number;
  netProfitCents: number;
  budgetedHoursThousandths: number;
  loggedHoursThousandths: number;
  hasUnexpectedMaterialTickets: boolean;
}

export function computeJobBillingProfitability(params: {
  jobs: ReadonlyArray<JobRow>;
  quotes: ReadonlyArray<QuoteRow>;
  invoices: ReadonlyArray<InvoiceRow>;
  tickets: ReadonlyArray<ExpenseTicketRow>;
  scheduleEntries?: ReadonlyArray<ScheduleEntryRow>;
}): JobBillingProfitability[] {
  const { jobs, quotes, invoices, tickets, scheduleEntries = [] } = params;

  return jobs.map((job) => {
    const activeQuote =
      quotes.find((q) => q.job_id === job.id && q.status !== "rechazado") ?? null;
    const billingMode: BillingMode =
      activeQuote?.modalidad_cobro ?? job.modalidad_cobro ?? "solo_partidas";
    const laborSubMode: LaborOnlySubMode =
      activeQuote?.solo_mano_obra_submodo ?? job.solo_mano_obra_submodo ?? "por_horas";

    const rawBudgetedHours =
      activeQuote?.horas_estimadas_thousandths ?? job.horas_estimadas_thousandths ?? 0;
    const hourlyRateCents = activeQuote?.tarifa_hora_cents ?? job.tarifa_hora_cents ?? 0;
    const fixedLaborCents = activeQuote?.mano_obra_fija_cents ?? job.mano_obra_fija_cents ?? 0;

    const usesHourlyBudget =
      billingMode === "partidas_mas_horas" ||
      (billingMode === "solo_mano_obra" && laborSubMode === "por_horas");
    const budgetedHoursThousandths = usesHourlyBudget ? Math.max(0, rawBudgetedHours) : 0;

    const quotedBaseCents = activeQuote?.subtotal_cents ?? 0;
    let quotedLaborCents = 0;
    let quotedItemsCents = 0;

    if (activeQuote) {
      if (billingMode === "solo_partidas") {
        quotedLaborCents = 0;
        quotedItemsCents = quotedBaseCents;
      } else if (billingMode === "partidas_mas_horas") {
        quotedLaborCents = roundHalfUpDiv(
          budgetedHoursThousandths * Math.max(0, hourlyRateCents ?? 0),
          1000
        );
        quotedItemsCents = Math.max(0, quotedBaseCents - quotedLaborCents);
      } else if (billingMode === "partidas_mas_fijo_mano_obra") {
        quotedLaborCents = Math.max(0, fixedLaborCents);
        quotedItemsCents = Math.max(0, quotedBaseCents - quotedLaborCents);
      } else {
        quotedItemsCents = 0;
        quotedLaborCents = quotedBaseCents;
      }
    }

    const jobInvoices = invoices.filter((inv) => inv.job_id === job.id);
    const jobTickets = tickets.filter((tkt) => tkt.job_id === job.id);
    const jobSchedule = scheduleEntries.filter((se) => se.job_id === job.id);

    const invoicedBaseCents = jobInvoices.reduce((sum, inv) => sum + inv.base_cents, 0);
    const ticketsBaseCents = jobTickets.reduce((sum, tkt) => sum + tkt.base_cents, 0);
    const loggedHoursThousandths = jobSchedule.reduce(
      (sum, se) => sum + (se.actual_hours_thousandths ?? 0),
      0
    );
    const hasUnexpectedMaterialTickets =
      billingMode === "solo_mano_obra" &&
      jobTickets.some((tkt) => tkt.category.trim().toLowerCase().includes("material"));

    return {
      jobId: job.id,
      billingMode,
      laborSubMode,
      quotedBaseCents,
      quotedItemsCents,
      quotedLaborCents,
      invoicedBaseCents,
      ticketsBaseCents,
      netProfitCents: invoicedBaseCents - ticketsBaseCents,
      budgetedHoursThousandths,
      loggedHoursThousandths,
      hasUnexpectedMaterialTickets,
    };
  });
}

export function formatCentsEs(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100);
  const rem = String(abs % 100).padStart(2, "0");
  const eurosFormatted = euros.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${eurosFormatted},${rem} €`;
}
