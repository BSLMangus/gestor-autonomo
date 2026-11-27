import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseQuoteLinesAndMeta } from "../src/agent/inference/deterministicSpanishParser";
import { LocalInferenceAdapterImpl } from "../src/agent/inference/localInferenceAdapter";
import {
  patchCatalogItemByVoice,
  patchQuoteDraftByVoice,
  type CatalogItemFormState,
  type QuoteBuilderFormState,
} from "../src/agent/voiceFormPatcher";
import { NodeBetterSqliteExecutor } from "../src/core/db/nodeSqliteExecutor";
import { initializeSchema } from "../src/core/db/sqliteExecutor";
import {
  extractPriceAndCleanDescription,
  sanitizeQuoteItemDescription,
} from "../src/core/text/quoteDescriptionSanitizer";
import { parseCatalogAndRatesFromText } from "../src/features/pricing/documentImportPipeline";

describe("Sanitización de descripciones de partidas y precios embebidos", () => {
  describe("extractPriceAndCleanDescription & sanitizeQuoteItemDescription", () => {
    it("extrae importes con euro pegado, espacios, decimales con coma/punto y conectores españoles", () => {
      expect(extractPriceAndCleanDescription("Pintar salón por 120,50 euros")).toEqual({
        description: "Pintar salón",
        extractedPriceCents: 12050,
      });

      expect(extractPriceAndCleanDescription("1 termo a 350 €")).toEqual({
        description: "1 termo",
        extractedPriceCents: 35000,
      });

      expect(extractPriceAndCleanDescription("Cambio grifo por 89€")).toEqual({
        description: "Cambio grifo",
        extractedPriceCents: 8900,
      });

      expect(extractPriceAndCleanDescription("Instalación cuadro eléctrico - € 450,00")).toEqual({
        description: "Instalación cuadro eléctrico",
        extractedPriceCents: 45000,
      });

      expect(extractPriceAndCleanDescription("Sustitución llave de paso: 1.250,75 EUR")).toEqual({
        description: "Sustitución llave de paso",
        extractedPriceCents: 125075,
      });

      expect(extractPriceAndCleanDescription("Desatasco tubería 65 con 50 €")).toEqual({
        description: "Desatasco tubería",
        extractedPriceCents: 6550,
      });
    });

    it("elimina precios entre paréntesis o corchetes y sufijos cantidad × precio unitario", () => {
      expect(extractPriceAndCleanDescription("Alicatado baño (45 €/m2)")).toEqual({
        description: "Alicatado baño",
        extractedPriceCents: 4500,
      });

      expect(extractPriceAndCleanDescription("Pintar techo [PVP: 120,00 EUR IVA incl.]")).toEqual({
        description: "Pintar techo",
        extractedPriceCents: 12000,
      });

      expect(extractPriceAndCleanDescription("Cambio grifo 2 ud x 89,00 € = 178,00 €")).toEqual({
        description: "Cambio grifo",
        extractedPriceCents: 8900,
      });

      expect(extractPriceAndCleanDescription("2 ud Cambio grifo 89,00 € 178,00 €")).toEqual({
        description: "2 ud Cambio grifo",
        extractedPriceCents: 8900,
      });
    });

    it("elimina importes sin símbolo de moneda solo cuando coinciden con knownPricesCents y delimitador", () => {
      expect(
        sanitizeQuoteItemDescription("Cambio grifo - 89,00", { knownPricesCents: [8900] })
      ).toBe("Cambio grifo");

      expect(
        sanitizeQuoteItemDescription("Cambio grifo: 120", { knownPricesCents: [8900] })
      ).toBe("Cambio grifo: 120");
    });

    it("preserva intactas todas las especificaciones técnicas con números y medidas", () => {
      const technicalSpecs = [
        "Cable 2.5mm",
        "Cable 3x2,5mm²",
        "Radiador 6 elementos",
        "Tubo 20mm",
        "Caja 10x10",
        "IP65",
        "230V",
        "Termo 80L",
        "1/2-3/8",
        "18 módulos",
        "2 manos",
        "120x80",
      ];

      for (const spec of technicalSpecs) {
        expect(sanitizeQuoteItemDescription(spec)).toBe(spec);
        expect(extractPriceAndCleanDescription(spec)).toEqual({
          description: spec,
          extractedPriceCents: null,
        });
      }

      // Incluso cuando van acompañadas de un precio, la especificación técnica sobrevive intacta
      expect(extractPriceAndCleanDescription("Cable 3x2,5mm² por 45,50€")).toEqual({
        description: "Cable 3x2,5mm²",
        extractedPriceCents: 4550,
      });
      expect(extractPriceAndCleanDescription("Termo 80L (350 €)")).toEqual({
        description: "Termo 80L",
        extractedPriceCents: 35000,
      });
      expect(extractPriceAndCleanDescription("Mampara ducha 120x80 por 290€")).toEqual({
        description: "Mampara ducha 120x80",
        extractedPriceCents: 29000,
      });
      expect(extractPriceAndCleanDescription("Cuadro 18 módulos IP65 230V - 180 €")).toEqual({
        description: "Cuadro 18 módulos IP65 230V",
        extractedPriceCents: 18000,
      });
    });
  });

  describe("parseQuoteLinesAndMeta", () => {
    it("no parte comas decimales entre dígitos y delega la extracción de precio y limpieza", () => {
      const res = parseQuoteLinesAndMeta(
        "Presupuesto para Laura: Pintar salón por 120,50 euros, 1 termo a 350 €, Cambio grifo por 89€"
      );

      expect(res.client_query).toBe("Laura");
      expect(res.lines).toEqual([
        {
          quantity_thousandths: 1000,
          unit: "ud",
          description: "Pintar salón",
          explicit_price_cents: 12050,
        },
        {
          quantity_thousandths: 1000,
          unit: "ud",
          description: "termo",
          explicit_price_cents: 35000,
        },
        {
          quantity_thousandths: 1000,
          unit: "ud",
          description: "Cambio grifo",
          explicit_price_cents: 8900,
        },
      ]);
    });

    it("limpia líneas OCR multicolumna y precios entre paréntesis conservando especificaciones técnicas", () => {
      const multiCol = parseQuoteLinesAndMeta("2 ud Cambio grifo 89,00 € 178,00 €");
      expect(multiCol.lines).toEqual([
        {
          quantity_thousandths: 2000,
          unit: "ud",
          description: "Cambio grifo",
          explicit_price_cents: 8900,
        },
      ]);

      const paren = parseQuoteLinesAndMeta(
        "Presupuesto: 3 m2 Alicatado baño (45 €/m2); Cable 3x2,5mm² por 42,50€; Caja 10x10 IP65 (15€)"
      );
      expect(paren.lines).toEqual([
        {
          quantity_thousandths: 3000,
          unit: "m2",
          description: "Alicatado baño",
          explicit_price_cents: 4500,
        },
        {
          quantity_thousandths: 1000,
          unit: "ud",
          description: "Cable 3x2,5mm²",
          explicit_price_cents: 4250,
        },
        {
          quantity_thousandths: 1000,
          unit: "ud",
          description: "Caja 10x10 IP65",
          explicit_price_cents: 1500,
        },
      ]);
    });
  });

  describe("Integración en LocalInferenceAdapter, VoiceFormPatcher y DocumentImportPipeline", () => {
    let executor: NodeBetterSqliteExecutor;

    beforeEach(async () => {
      executor = new NodeBetterSqliteExecutor(":memory:");
      await initializeSchema(executor);
    });

    afterEach(async () => {
      await executor.close();
    });

    it("LocalInferenceAdapter incluye instrucción anti-precios en el prompt y sanitiza quote_lines del LLM", async () => {
      let capturedPrompt = "";
      const adapter = new LocalInferenceAdapterImpl(async (prompt) => {
        capturedPrompt = prompt;
        return JSON.stringify({
          intent: "quote_specialist",
          confidence: 0.9,
          entities: {
            quote_lines: [
              {
                quantity_thousandths: 1000,
                unit: "ud",
                description: "Instalación termo 80L (350 €)",
                explicit_price_cents: 35000,
              },
              {
                quantity_thousandths: 2000,
                unit: "ud",
                description: "Cambio grifo - 89,00",
                explicit_price_cents: 8900,
              },
            ],
          },
        });
      });

      const res = await adapter.classifyAndExtract({
        text: "hola a ver qué hacemos con lo de ayer",
        activeJobId: null,
        activeQuoteId: null,
        pendingDisambiguation: null,
        catalogCandidates: [],
      });

      expect(capturedPrompt).toContain(
        "En quote_lines[].description incluye ÚNICAMENTE el concepto limpio de la tarea o partida; NUNCA incluyas precios, importes ni símbolos € o EUR."
      );
      expect(res.entities.quote_lines).toEqual([
        {
          quantity_thousandths: 1000,
          unit: "ud",
          description: "Instalación termo 80L",
          explicit_price_cents: 35000,
        },
        {
          quantity_thousandths: 2000,
          unit: "ud",
          description: "Cambio grifo",
          explicit_price_cents: 8900,
        },
      ]);
    });

    it("VoiceFormPatcher soporta € pegado y limpia descripciones en presupuesto y tarifario", async () => {
      const initialQuote: QuoteBuilderFormState = {
        draft: {
          quote_id: null,
          client_id: null,
          job_id: null,
          job_title: "",
          vat_rate: 21,
          notes: "",
          lines: [],
        },
        useNewClient: false,
      };

      const qRes1 = await patchQuoteDraftByVoice(
        initialQuote,
        "Añade Pintar salón por 120,50€ y Cambio grifo (89€)",
        { executor }
      );
      expect(qRes1.changed).toBe(true);
      expect(qRes1.nextState.draft.lines).toHaveLength(2);
      expect(qRes1.nextState.draft.lines[0]?.description).toBe("Pintar salón");
      expect(qRes1.nextState.draft.lines[0]?.unit_price_cents).toBe(12050);
      expect(qRes1.nextState.draft.lines[1]?.description).toBe("Cambio grifo");
      expect(qRes1.nextState.draft.lines[1]?.unit_price_cents).toBe(8900);

      const qRes2 = await patchQuoteDraftByVoice(
        qRes1.nextState,
        "Pon el grifo a 95€",
        { executor }
      );
      expect(qRes2.changed).toBe(true);
      expect(qRes2.nextState.draft.lines[1]?.unit_price_cents).toBe(9500);
      expect(qRes2.nextState.draft.lines[1]?.description).toBe("Cambio grifo");

      const initialCatalog: CatalogItemFormState = {
        desc: "",
        cat: "General",
        unit: "ud",
        mode: "hourly_plus_materials",
        hoursInput: "1",
        materialsInput: "0.00",
        fixedPriceInput: "38.00",
        vatInput: "21",
      };

      const cRes = await patchCatalogItemByVoice(
        initialCatalog,
        "Descripción Cambio grifo (89€), precio fijo a 89€",
        { executor }
      );
      expect(cRes.changed).toBe(true);
      expect(cRes.nextState.desc).toBe("Cambio grifo");
      expect(cRes.nextState.fixedPriceInput).toBe("89.00");

      const cResSpec = await patchCatalogItemByVoice(
        initialCatalog,
        "Descripción Cable 3x2,5mm², precio fijo a 12,50€",
        { executor }
      );
      expect(cResSpec.changed).toBe(true);
      expect(cResSpec.nextState.desc).toBe("Cable 3x2,5mm²");
      expect(cResSpec.nextState.fixedPriceInput).toBe("12.50");
    });

    it("DocumentImportPipeline sanitiza descripciones CSV/TSV y tablas PDF/OCR multicolumna", () => {
      const draft = parseCatalogAndRatesFromText({
        documents: [
          {
            fileName: "tarifa_2026.pdf",
            rawText: [
              "2 ud Cambio grifo 89,00 € 178,00 €",
              "Cable 3x2,5mm² (45 €);ml;45,00 €;21%",
              "Termo 80L - 350,00 €",
            ].join("\n"),
          },
        ],
        currentHourlyRateCents: 3800,
        existingCatalog: [],
      });

      expect(draft.items).toHaveLength(3);
      expect(draft.items[0]?.description).toBe("Cambio grifo");
      expect(draft.items[0]?.unit_price_cents).toBe(8900);
      expect(draft.items[1]?.description).toBe("Cable 3x2,5mm²");
      expect(draft.items[1]?.unit_price_cents).toBe(4500);
      expect(draft.items[2]?.description).toBe("Termo 80L");
      expect(draft.items[2]?.unit_price_cents).toBe(35000);
    });
  });
});
