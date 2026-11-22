import { describe, expect, it } from "vitest";
import contractsAndSeed from "../docs/03_CONTRATOS_API_Y_SEED.json";
import {
  computeAdvance40,
  computeFinalInvoiceFromQuoteAndAdvance,
  computeInverseVat21,
  computeLineSubtotalCents,
  computePiggyBank,
  computeQuoteTotals,
  formatCentsEs,
  isTicketWithinTolerance,
  roundHalfUpDiv,
} from "../src/core/fiscal/fiscalEngine";
import { validateSpanishTaxId } from "../src/core/fiscal/taxIdValidator";
import {
  addDaysIso,
  deriveFiscalQuarter,
  formatLocalDateIso,
  getLocalTodayIso,
  isValidIsoDate,
} from "../src/core/fiscal/dateQuarter";
import type { ExpenseTicketRow, InvoiceRow, JobRow } from "../src/core/contracts/types";

describe("FiscalEngine, NIF/NIE/CIF y Calendario Local", () => {
  it("aplica roundHalfUpDiv determinista en céntimos enteros", () => {
    expect(roundHalfUpDiv(1, 2)).toBe(1);
    expect(roundHalfUpDiv(3, 2)).toBe(2);
    expect(roundHalfUpDiv(-3, 2)).toBe(-2);
    expect(roundHalfUpDiv(1500 * 333, 1000)).toBe(500);
    expect(() => roundHalfUpDiv(10.5, 2)).toThrow(/SCHEMA_VALIDATION_ERROR/);
    expect(() => roundHalfUpDiv(10, 0)).toThrow(/SCHEMA_VALIDATION_ERROR/);
  });

  it("reproduce exactamente onDeviceEvalFixtures.fiscalCases", () => {
    // eval_fiscal_adv_40_10
    const adv = computeAdvance40(150700, 10);
    expect(adv).toEqual({ baseCents: 60280, vatCents: 6028, totalCents: 66308 });
    const quoteVat10 = roundHalfUpDiv(150700 * 10, 100);
    const fin = computeFinalInvoiceFromQuoteAndAdvance(
      150700,
      quoteVat10,
      adv.baseCents,
      adv.vatCents
    );
    expect(fin).toEqual({ baseCents: 90420, vatCents: 9042, totalCents: 99462 });
    expect(adv.totalCents + fin.totalCents).toBe(165770);

    // eval_fiscal_half_up
    const lineBase = computeLineSubtotalCents(1500, 333);
    expect(lineBase).toBe(500);
    const quote = computeQuoteTotals(
      [{ quantity_thousandths: 1500, unit_price_cents: 333 }],
      21
    );
    expect(quote).toEqual({
      lineSubtotals: [500],
      subtotalCents: 500,
      vatCents: 105,
      totalCents: 605,
    });

    // eval_ocr_tolerance_2_cents
    expect(isTicketWithinTolerance(12450, 2614, 15065)).toBe(true);
    expect(isTicketWithinTolerance(12450, 2614, 15067)).toBe(false);
  });

  it("calcula desglose inverso 21 % desde total", () => {
    const inv = computeInverseVat21(12100);
    expect(inv).toEqual({ baseCents: 10000, vatCents: 2100 });

    const invOdd = computeInverseVat21(15065);
    expect(invOdd.baseCents + invOdd.vatCents).toBe(15065);
    expect(invOdd.baseCents).toBe(12450);
    expect(invOdd.vatCents).toBe(2615);
  });

  it("calcula Hucha Fiscal 2026-T4 idéntica a seedData y cubre casos borde IVA a compensar / déficit", () => {
    const seed = contractsAndSeed.seedData;
    const expected = seed.seedThreads[3]!.messages[3]!.widget_json!.widget_payload as Record<
      string,
      unknown
    >;

    const piggy = computePiggyBank({
      quarter: "2026-T4",
      invoices: seed.invoices as InvoiceRow[],
      tickets: seed.expense_tickets as ExpenseTicketRow[],
      jobs: seed.jobs as JobRow[],
      selectedJobId: "job_02",
    });

    expect(piggy).toEqual(expected);
    expect(formatCentsEs(piggy.untouchable_tax_cents)).toBe("375,18 €");

    // Caso borde: IVA soportado > repercutido + rendimiento negativo -> IVA=0, IRPF=0, saldo negativo
    const edgePiggy = computePiggyBank({
      quarter: "2026-T1",
      invoices: [
        {
          ...(seed.invoices[0] as InvoiceRow),
          id: "inv_edge",
          quarter: "2026-T1",
          issued_at_iso: "2026-01-10",
          due_at_iso: "2026-02-10",
          paid_at_iso: null,
          paid_quarter: null,
          status: "pendiente_cobro",
          base_cents: 40000,
          vat_cents: 8000,
          total_cents: 48000,
        },
      ],
      tickets: [
        {
          ...(seed.expense_tickets[0] as ExpenseTicketRow),
          id: "tkt_edge",
          quarter: "2026-T1",
          issue_date_iso: "2026-01-15",
          base_cents: 75000,
          vat_cents: 15500,
          total_cents: 90500,
        },
      ],
      jobs: seed.jobs as JobRow[],
    });

    expect(edgePiggy.iva_to_reserve_cents).toBe(0);
    expect(edgePiggy.iva_to_compensate_cents).toBe(7500);
    expect(edgePiggy.irpf_20_cents).toBe(0);
    expect(edgePiggy.untouchable_tax_cents).toBe(0);
    expect(edgePiggy.available_cash_cents).toBe(-90500);
  });

  it("valida dígito de control NIF, NIE y CIF españoles (incluyendo todos los del seed)", () => {
    expect(validateSpanishTaxId("12345678Z")).toBe(true);
    expect(validateSpanishTaxId("45891234R")).toBe(true);
    expect(validateSpanishTaxId("39481205A")).toBe(true);
    expect(validateSpanishTaxId("H84321090")).toBe(true);
    expect(validateSpanishTaxId("B63459820")).toBe(true);
    expect(validateSpanishTaxId("B87654323")).toBe(true);
    expect(validateSpanishTaxId("B74125899")).toBe(true);
    expect(validateSpanishTaxId("B85296341")).toBe(true);
    expect(validateSpanishTaxId("X1234567L")).toBe(true);

    expect(validateSpanishTaxId("12345678A")).toBe(false);
    expect(validateSpanishTaxId("H8432109J")).toBe(false);
    expect(validateSpanishTaxId("INVALID")).toBe(false);
  });

  it("calcula fechas en calendario local y trimestres sin desfase UTC", () => {
    expect(isValidIsoDate("2026-11-18")).toBe(true);
    expect(isValidIsoDate("2026-02-29")).toBe(false);
    expect(deriveFiscalQuarter("2026-01-01")).toBe("2026-T1");
    expect(deriveFiscalQuarter("2026-11-18")).toBe("2026-T4");
    expect(addDaysIso("2026-11-18", 30)).toBe("2026-12-18");

    const localSample = new Date(2026, 10, 18, 0, 30, 0).getTime();
    expect(formatLocalDateIso(localSample)).toBe("2026-11-18");
    expect(getLocalTodayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("soporta tipos de IVA personalizados/decimales (0 %, 4 %, 10,5 %) e IRPF configurable en Hucha Fiscal", () => {
    const q0 = computeQuoteTotals([{ quantity_thousandths: 1000, unit_price_cents: 10000 }], 0);
    expect(q0).toEqual({ lineSubtotals: [10000], subtotalCents: 10000, vatCents: 0, totalCents: 10000 });

    const q4 = computeQuoteTotals([{ quantity_thousandths: 1000, unit_price_cents: 10000 }], 4);
    expect(q4).toEqual({ lineSubtotals: [10000], subtotalCents: 10000, vatCents: 400, totalCents: 10400 });

    const qDec = computeQuoteTotals([{ quantity_thousandths: 1000, unit_price_cents: 10000 }], 10.5);
    expect(qDec).toEqual({ lineSubtotals: [10000], subtotalCents: 10000, vatCents: 1050, totalCents: 11050 });

    const advDec = computeAdvance40(10000, 10.5);
    expect(advDec).toEqual({ baseCents: 4000, vatCents: 420, totalCents: 4420 });

    const seed = contractsAndSeed.seedData;
    const piggyCustomIrpf = computePiggyBank({
      quarter: "2026-T1",
      invoices: [
        {
          ...(seed.invoices[0] as InvoiceRow),
          id: "inv_irpf_custom",
          quarter: "2026-T1",
          issued_at_iso: "2026-01-10",
          due_at_iso: "2026-02-10",
          paid_at_iso: "2026-01-15",
          paid_quarter: "2026-T1",
          status: "pagado",
          base_cents: 100000,
          vat_cents: 21000,
          total_cents: 121000,
        },
      ],
      tickets: [
        {
          ...(seed.expense_tickets[0] as ExpenseTicketRow),
          id: "tkt_irpf_custom",
          quarter: "2026-T1",
          issue_date_iso: "2026-01-12",
          base_cents: 20000,
          vat_cents: 4200,
          total_cents: 24200,
        },
      ],
      jobs: seed.jobs as JobRow[],
      irpfRate: 15,
    });
    expect(piggyCustomIrpf.irpf_rate).toBe(15);
    expect(piggyCustomIrpf.iva_to_reserve_cents).toBe(16800);
    expect(piggyCustomIrpf.irpf_20_cents).toBe(12000); // 15 % de (100000 - 20000)
    expect(piggyCustomIrpf.untouchable_tax_cents).toBe(28800);
  });
});
