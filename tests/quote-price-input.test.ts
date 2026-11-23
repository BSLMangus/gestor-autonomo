import { describe, expect, it } from "vitest";
import { computeQuoteTotals } from "../src/core/fiscal/fiscalEngine";
import {
  centsToInitialPriceText,
  eurInputToCents,
  formatPriceInputOnBlur,
  sanitizeDecimalPriceInput,
  shouldClearPriceOnFocus,
} from "../src/features/chat/widgets/priceInputUtils";

describe("QuoteBuilderWidget PriceInput helpers", () => {
  it("normaliza comas, elimina caracteres no numéricos y permite un único separador decimal", () => {
    expect(sanitizeDecimalPriceInput("")).toBe("");
    expect(sanitizeDecimalPriceInput("45")).toBe("45");
    expect(sanitizeDecimalPriceInput("45.50")).toBe("45.50");
    expect(sanitizeDecimalPriceInput("120,75")).toBe("120.75");
    expect(sanitizeDecimalPriceInput("12.3.4")).toBe("12.34");
    expect(sanitizeDecimalPriceInput("12,3,4")).toBe("12.34");
    expect(sanitizeDecimalPriceInput("abc12,5€")).toBe("12.5");
    expect(sanitizeDecimalPriceInput(".")).toBe(".");
    expect(sanitizeDecimalPriceInput(",")).toBe(".");
  });

  it("permite introducir dígitos unitarios (1-9) sin redondear a 0.01 ni bloquear la escritura", () => {
    for (const digit of ["1", "2", "3", "4", "5", "6", "7", "8", "9"]) {
      expect(sanitizeDecimalPriceInput(digit)).toBe(digit);
      expect(eurInputToCents(digit)).toBe(Number(digit) * 100);
    }
  });

  it("formatea en onBlur con toFixed(2) si es válido o limpia a vacío con 0 céntimos", () => {
    expect(formatPriceInputOnBlur("45")).toEqual({ display: "45.00", cents: 4500 });
    expect(formatPriceInputOnBlur("45.50")).toEqual({ display: "45.50", cents: 4550 });
    expect(formatPriceInputOnBlur("120,75")).toEqual({ display: "120.75", cents: 12075 });
    expect(formatPriceInputOnBlur("0")).toEqual({ display: "0.00", cents: 0 });
    expect(formatPriceInputOnBlur("")).toEqual({ display: "", cents: 0 });
    expect(formatPriceInputOnBlur(".")).toEqual({ display: "", cents: 0 });
    expect(formatPriceInputOnBlur("abc")).toEqual({ display: "", cents: 0 });
  });

  it("limpia valores cero en onFocus e inicializa vacío cuando el precio es 0", () => {
    expect(shouldClearPriceOnFocus("0.00")).toBe(true);
    expect(shouldClearPriceOnFocus("0")).toBe(true);
    expect(shouldClearPriceOnFocus("0,00")).toBe(true);
    expect(shouldClearPriceOnFocus("10.00")).toBe(false);
    expect(shouldClearPriceOnFocus("")).toBe(false);

    expect(centsToInitialPriceText(0)).toBe("");
    expect(centsToInitialPriceText(4550)).toBe("45.50");
  });

  it("mantiene el cálculo exacto de subtotales y totales del presupuesto", () => {
    const totals = computeQuoteTotals(
      [
        { quantity_thousandths: 1000, unit_price_cents: eurInputToCents("45") },
        { quantity_thousandths: 2000, unit_price_cents: eurInputToCents("45.50") },
        { quantity_thousandths: 1000, unit_price_cents: eurInputToCents("120,75") },
      ],
      10
    );
    expect(totals).toEqual({
      lineSubtotals: [4500, 9100, 12075],
      subtotalCents: 25675,
      vatCents: 2568,
      totalCents: 28243,
    });
  });
});
