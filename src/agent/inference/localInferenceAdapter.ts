import { z } from "zod";
import { SpecialistRouteSchema } from "../../core/contracts/schemas";
import type {
  InferenceEngine,
  PendingDisambiguation,
  RagSnippet,
  SpecialistRoute,
} from "../../core/contracts/types";
import type { LocalInferenceAdapter } from "../ports";
import { DeterministicSpanishParser } from "./deterministicSpanishParser";

const LlmClassificationOutputSchema = z.object({
  intent: SpecialistRouteSchema,
  confidence: z.number().min(0).max(1),
  entities: z.record(z.string(), z.unknown()).default({}),
});

export type LlmRunner = (prompt: string) => Promise<string>;

const LLM_TIMEOUT_MS = 3000;

export class LocalInferenceAdapterImpl implements LocalInferenceAdapter {
  private readonly parser = new DeterministicSpanishParser();
  private llmRunner?: LlmRunner;

  constructor(llmRunner?: LlmRunner) {
    this.llmRunner = llmRunner;
  }

  setLlmRunner(runner?: LlmRunner): void {
    this.llmRunner = runner;
  }

  hasLlmRunner(): boolean {
    return typeof this.llmRunner === "function";
  }

  async classifyAndExtract(params: {
    text: string;
    activeJobId: string | null;
    activeQuoteId: string | null;
    pendingDisambiguation: PendingDisambiguation | null;
    catalogCandidates: RagSnippet[];
  }): Promise<{
    intent: SpecialistRoute;
    confidence: number;
    engine_used: InferenceEngine;
    entities: Record<string, unknown>;
  }> {
    const det = this.parser.parse(params.text);

    if (det.confidence >= 0.7 || !this.llmRunner) {
      return {
        intent: det.intent,
        confidence: det.confidence,
        engine_used: "deterministic_rule_engine",
        entities: det.entities,
      };
    }

    const prompt = [
      "Eres un clasificador estricto de intenciones para Gestor Autónomo.",
      "Responde únicamente JSON válido con { intent, confidence, entities }.",
      "Intents válidos: quote_specialist, ocr_ticket_specialist, fiscal_piggybank_specialist, lifecycle_billing_specialist, site_log_specialist, schedule_specialist, assistant_qa_node, clarification_node.",
      `active_job_id=${params.activeJobId ?? "null"} active_quote_id=${params.activeQuoteId ?? "null"}`,
      `Texto usuario: ${JSON.stringify(params.text)}`,
    ].join("\n");

    try {
      const runner = this.llmRunner;
      const rawResponse = await Promise.race<string>([
        runner(prompt),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error("LLM_TIMEOUT")), LLM_TIMEOUT_MS)
        ),
      ]);
      const jsonMatch = /\{[\s\S]*\}/.exec(rawResponse);
      const parsed = LlmClassificationOutputSchema.parse(
        JSON.parse(jsonMatch ? jsonMatch[0] : rawResponse)
      );
      return {
        intent: parsed.intent,
        confidence: parsed.confidence,
        engine_used: "mediapipe_local_llm",
        entities: { ...det.entities, ...parsed.entities },
      };
    } catch {
      return {
        intent: det.intent,
        confidence: det.confidence,
        engine_used: "mediapipe_fallback_deterministic",
        entities: det.entities,
      };
    }
  }

  async generateConversationalReply(params: {
    text: string;
    recentMessages?: Array<{ role: "user" | "assistant"; content: string }>;
    activeJobTitle?: string | null;
  }): Promise<{ reply: string; engine_used: InferenceEngine } | null> {
    if (!this.llmRunner || !params.text.trim()) {
      return null;
    }

    const historyLines = (params.recentMessages ?? [])
      .slice(-4)
      .map((m) => `${m.role === "user" ? "Usuario" : "Asistente"}: ${m.content}`)
      .join("\n");

    const prompt = [
      "Eres el asistente de Gestor Autónomo para autónomos de reformas y oficios en España.",
      "Capacidades reales de la app: 1) Presupuestos con PDF y envío por WhatsApp, 2) Registro de tickets y gastos (cámara OCR o dictado), 3) Hucha Fiscal (IVA/IRPF trimestral), 4) Alta y gestión de clientes, 5) Agenda y partes de jornada, 6) Diario de obra con fotos selladas y emisión de facturas.",
      "Responde en español, de forma breve, clara y práctica (máximo 3 frases).",
      "Si el usuario no dio suficientes datos para crear un presupuesto, ticket o cliente, pídele exactamente los datos que faltan con un ejemplo corto.",
      "No inventes importes, facturas, precios ni datos que no estén en el contexto.",
      params.activeJobTitle ? `Obra activa: ${params.activeJobTitle}` : "",
      historyLines ? `Historial reciente:\n${historyLines}` : "",
      `Mensaje del usuario: ${params.text}`,
    ]
      .filter(Boolean)
      .join("\n");

    try {
      const runner = this.llmRunner;
      const rawReply = await Promise.race<string>([
        runner(prompt),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error("LLM_TIMEOUT")), LLM_TIMEOUT_MS)
        ),
      ]);
      const cleaned = rawReply.trim();
      if (!cleaned) return null;
      return {
        reply: cleaned,
        engine_used: "mediapipe_local_llm",
      };
    } catch {
      return null;
    }
  }

  async extractFormPatch<T>(params: {
    formKind: string;
    currentSnapshot: Record<string, unknown>;
    transcript: string;
    fieldSpec: string;
    schema: z.ZodType<T>;
  }): Promise<{ patch: T; engine_used: InferenceEngine } | null> {
    if (!this.llmRunner || !params.transcript.trim()) {
      return null;
    }

    const prompt = [
      `Eres un extractor estricto JSON para el formulario "${params.formKind}" de Gestor Autónomo.`,
      "Devuelve ÚNICAMENTE un objeto JSON válido con solo los campos que el usuario menciona o modifica en su dictado.",
      "No incluyas campos no mencionados ni inventes valores.",
      `Campos permitidos: ${params.fieldSpec}`,
      `Estado actual: ${JSON.stringify(params.currentSnapshot)}`,
      `Dictado del usuario: ${JSON.stringify(params.transcript.trim())}`,
    ].join("\n");

    try {
      const runner = this.llmRunner;
      const rawResponse = await Promise.race<string>([
        runner(prompt),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error("LLM_TIMEOUT")), LLM_TIMEOUT_MS)
        ),
      ]);
      const jsonMatch = /\{[\s\S]*\}/.exec(rawResponse);
      if (!jsonMatch) return null;
      const parsed = params.schema.safeParse(JSON.parse(jsonMatch[0]));
      if (!parsed.success) return null;
      return {
        patch: parsed.data,
        engine_used: "mediapipe_local_llm",
      };
    } catch {
      return null;
    }
  }
}
