import { describe, expect, it } from "vitest";
import { BrowserAsyncLocalStorage } from "../src/agent/asyncLocalStoragePolyfill";
import {
  DeterministicSpanishParser,
  extractTicketFieldsFromText,
} from "../src/agent/inference/deterministicSpanishParser";
import { LocalInferenceAdapterImpl } from "../src/agent/inference/localInferenceAdapter";
import { isTicketWithinTolerance } from "../src/core/fiscal/fiscalEngine";

describe("DeterministicSpanishParser, LocalInferenceAdapter y BrowserAsyncLocalStorage", () => {
  const parser = new DeterministicSpanishParser();

  it("clasifica intenciones y extrae entidades en < 150 ms", () => {
    const t0 = performance.now();

    const quoteRes = parser.parse(
      "Presupuesto para Javier García: 1 termo eléctrico 80L, dos llaves de escuadra y desmontaje de termo por 45 euros, IVA 10% vivienda."
    );
    expect(quoteRes.intent).toBe("quote_specialist");
    expect(quoteRes.confidence).toBeGreaterThanOrEqual(0.85);
    expect(quoteRes.entities.client_query).toBe("Javier García");
    expect(quoteRes.entities.vat_rate).toBe(10);
    expect(quoteRes.entities.quote_lines?.length).toBe(3);
    expect(quoteRes.entities.quote_lines?.[1]?.quantity_thousandths).toBe(2000);
    expect(quoteRes.entities.quote_lines?.[2]?.explicit_price_cents).toBe(4500);

    const qaRes = parser.parse("¿Cuánto llevo gastado en esta obra?");
    expect(qaRes.intent).toBe("assistant_qa_node");

    const fiscalRes = parser.parse("Enséñame la hucha fiscal del 2026-T4");
    expect(fiscalRes.intent).toBe("fiscal_piggybank_specialist");
    expect(fiscalRes.entities.quarter).toBe("2026-T4");

    const advRes = parser.parse("Solicitar anticipo del 40% para Alcalá 142");
    expect(advRes.intent).toBe("lifecycle_billing_specialist");
    expect(advRes.entities.billing_sub_intent).toBe("advance_40");

    const facRes = parser.parse("Emitir factura final de la obra OBR-2026-003");
    expect(facRes.intent).toBe("lifecycle_billing_specialist");
    expect(facRes.entities.billing_sub_intent).toBe("final_invoice");
    expect(facRes.entities.job_query).toBe("OBR-2026-003");

    const shareRes = parser.parse("Enviar presupuesto por WhatsApp");
    expect(shareRes.intent).toBe("lifecycle_billing_specialist");
    expect(shareRes.entities.billing_sub_intent).toBe("share");

    const slRes = parser.parse("Añadir acabado despues en el diario de obra");
    expect(slRes.intent).toBe("site_log_specialist");
    expect(slRes.entities.site_log_category).toBe("despues");

    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(150);
  });

  it("extrae campos de tickets térmicos y valida tolerancia ± 2 céntimos", () => {
    const raw = [
      "OBRAMAT MADRID NORTE SL",
      "NIF B85296341",
      "FECHA 16/11/2026",
      "BASE IMP 21%: 124,50 EUR",
      "IVA 21%: 26,14 EUR",
      "TOTAL TICKET: 150,65 EUR",
    ].join("\n");

    const parsed = extractTicketFieldsFromText(raw);
    expect(parsed.supplier_name).toBe("OBRAMAT MADRID NORTE SL");
    expect(parsed.supplier_nif).toBe("B85296341");
    expect(parsed.issue_date_iso).toBe("2026-11-16");
    expect(parsed.quarter).toBe("2026-T4");
    expect(parsed.base_cents).toBe(12450);
    expect(parsed.vat_cents).toBe(2614);
    expect(parsed.total_cents).toBe(15065);
    expect(isTicketWithinTolerance(parsed.base_cents!, parsed.vat_cents!, parsed.total_cents!)).toBe(
      true
    );
  });

  it("LocalInferenceAdapter usa determinista por defecto y hace fallback si llmRunner devuelve JSON inválido", async () => {
    let called = 0;
    const adapter = new LocalInferenceAdapterImpl(async () => {
      called += 1;
      return "{bad json";
    });

    // Alta confianza -> NO llama al LLM opcional
    const highConf = await adapter.classifyAndExtract({
      text: "Enséñame la hucha fiscal",
      activeJobId: null,
      activeQuoteId: null,
      pendingDisambiguation: null,
      catalogCandidates: [],
    });
    expect(called).toBe(0);
    expect(highConf.engine_used).toBe("deterministic_rule_engine");

    // Baja confianza -> consulta LLM y cae a mediapipe_fallback_deterministic
    const lowConf = await adapter.classifyAndExtract({
      text: "hola qué tal",
      activeJobId: null,
      activeQuoteId: null,
      pendingDisambiguation: null,
      catalogCandidates: [],
    });
    expect(called).toBe(1);
    expect(lowConf.engine_used).toBe("mediapipe_fallback_deterministic");
    expect(lowConf.intent).toBe("clarification_node");

    // LLM válido -> retorna mediapipe_local_llm
    adapter.setLlmRunner(async () =>
      JSON.stringify({
        intent: "fiscal_piggybank_specialist",
        confidence: 0.84,
        entities: { quarter: "2026-T4" },
      })
    );
    const llmOk = await adapter.classifyAndExtract({
      text: "hola qué tal",
      activeJobId: null,
      activeQuoteId: null,
      pendingDisambiguation: null,
      catalogCandidates: [],
    });
    expect(llmOk.engine_used).toBe("mediapipe_local_llm");
    expect(llmOk.intent).toBe("fiscal_piggybank_specialist");
  });

  it("BrowserAsyncLocalStorage preserva contexto a través de await y lo limpia al finalizar", async () => {
    const als = new BrowserAsyncLocalStorage<{ req: string }>();
    expect(als.getStore()).toBeUndefined();

    const out = await als.run({ req: "outer" }, async () => {
      expect(als.getStore()?.req).toBe("outer");
      await new Promise((r) => setTimeout(r, 5));
      expect(als.getStore()?.req).toBe("outer");
      const inner = als.run({ req: "inner" }, () => als.getStore()?.req);
      expect(inner).toBe("inner");
      expect(als.getStore()?.req).toBe("outer");
      return "done";
    });
    expect(out).toBe("done");
    expect(als.getStore()).toBeUndefined();
  });

  it("extrae IVA decimal/personalizado cuando es explícito, lo deja undefined si no se indica y soporta generateConversationalReply", async () => {
    const customVat = parser.parse("Presupuesto para Marta Ruiz: 2 metros cableado, IVA 10,5%");
    expect(customVat.entities.vat_rate).toBe(10.5);
    expect(customVat.entities.quote_lines?.length).toBe(1);

    const unspecifiedVat = parser.parse("Presupuesto para Marta Ruiz: 1 caldera");
    expect(unspecifiedVat.entities.vat_rate).toBeUndefined();

    const noLlm = new LocalInferenceAdapterImpl();
    expect(await noLlm.generateConversationalReply({ text: "Buenos días" })).toBeNull();

    const withLlm = new LocalInferenceAdapterImpl(async () => "Buenos días, ¿en qué obra te ayudo?");
    const reply = await withLlm.generateConversationalReply({ text: "Buenos días" });
    expect(reply).toEqual({
      reply: "Buenos días, ¿en qué obra te ayudo?",
      engine_used: "mediapipe_local_llm",
    });

    const failingLlm = new LocalInferenceAdapterImpl(async () => {
      throw new Error("boom");
    });
    expect(await failingLlm.generateConversationalReply({ text: "Buenos días" })).toBeNull();
  });
});
