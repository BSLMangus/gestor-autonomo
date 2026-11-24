import type { z } from "zod";
import type {
  QuotePaymentInstallment,
  QuotePaymentMethod,
} from "../contracts/types";
import type {
  ActiveWidgetEnvelopeSchema,
  ErrorCodeSchema,
  Gate1QuoteDraftPayloadSchema,
  Gate2TicketDraftPayloadSchema,
  InferenceEngineSchema,
  PendingDisambiguationSchema,
  PendingGateSchema,
  RagSnippetSchema,
  SpecialistRouteSchema,
} from "../contracts/schemas";

export interface OcrPort {
  extractTicketText(
    imageBuffer: Uint8Array,
    mimeType: "image/jpeg" | "image/png"
  ): Promise<{
    rawText: string;
    parsed: {
      supplierName: string | null;
      supplierNif: string | null;
      issueDateIso: string | null;
      vatRate?: 0 | 4 | 10 | 21 | "mixed";
      baseCents: number | null;
      vatCents: number | null;
      totalCents: number | null;
    };
    confidence: number;
  }>;
  extractRawTextBatch(
    images: Array<{
      bytes: Uint8Array;
      mimeType: "image/jpeg" | "image/png" | "image/webp";
    }>
  ): Promise<Array<{ rawText: string; confidence: number }>>;
}

export interface PdfQuoteDocumentInput {
  kind: "quote";
  quoteCode: string;
  issuedDateIso: string;
  validityDays?: number | null;
  validUntilIso?: string | null;
  emitter: {
    name: string;
    nif: string;
    fiscalAddress: string;
    phone: string;
    iban?: string;
    logoDataUrl?: string | null;
  };
  client: { name: string; nif: string; fiscalAddress: string; phone: string };
  jobTitle: string;
  vatRate: number;
  subtotalCents: number;
  vatCents: number;
  totalCents: number;
  paymentMethods?: QuotePaymentMethod[];
  paymentSchedule?: QuotePaymentInstallment[];
  notes: string;
  lines: Array<{
    description: string;
    unit: string;
    quantityThousandths: number;
    unitPriceCents: number;
    lineSubtotalCents: number;
  }>;
}

export interface PdfInvoiceDocumentInput {
  kind: "invoice";
  invoiceNumber: string;
  invoiceKind: "advance_40" | "final" | "full";
  advancePercent?: number;
  issuedAtIso: string;
  dueAtIso: string;
  emitter: {
    name: string;
    nif: string;
    fiscalAddress: string;
    phone: string;
    iban?: string;
    logoDataUrl?: string | null;
  };
  client: { name: string; nif: string; fiscalAddress: string; phone: string };
  jobCode: string;
  jobTitle: string;
  quoteCode: string;
  vatRate: number;
  baseCents: number;
  vatCents: number;
  totalCents: number;
  advanceDeductedBaseCents: number;
  advanceDeductedVatCents: number;
  notes: string;
}

export type PdfBuildInput = PdfQuoteDocumentInput | PdfInvoiceDocumentInput;

export interface PdfPort {
  buildDocumentPdf(input: PdfBuildInput): Promise<{ pdfBytes: Uint8Array; fileName: string }>;
}

export interface WatermarkPort {
  compressAndStamp(params: {
    imageBytes: Uint8Array;
    mimeType: "image/jpeg" | "image/png";
    stamp: { jobCode: string; clientName: string; timestampIso: string };
  }): Promise<{ jpegBytes: Uint8Array; mimeType: "image/jpeg" }>;
}

export interface LocalInferenceAdapter {
  classifyAndExtract(params: {
    text: string;
    activeJobId: string | null;
    activeQuoteId: string | null;
    pendingDisambiguation: z.infer<typeof PendingDisambiguationSchema> | null;
    catalogCandidates: Array<z.infer<typeof RagSnippetSchema>>;
  }): Promise<{
    intent: z.infer<typeof SpecialistRouteSchema>;
    confidence: number;
    engine_used: z.infer<typeof InferenceEngineSchema>;
    entities: Record<string, unknown>;
  }>;
  generateConversationalReply?(params: {
    text: string;
    recentMessages?: Array<{ role: "user" | "assistant"; content: string }>;
    activeJobTitle?: string | null;
  }): Promise<{ reply: string; engine_used: z.infer<typeof InferenceEngineSchema> } | null>;
}

export interface TraceRecorder {
  recordTrace(trace: {
    trace_id: string;
    parent_trace_id: string | null;
    thread_id: string;
    turn_id: string;
    turn_phase: "complete" | "pre_interrupt" | "post_resume";
    routed_intent: string | null;
    node_sequence: string[];
    inference_engine: z.infer<typeof InferenceEngineSchema>;
    latency_ms: number;
    rag_snippets: Array<z.infer<typeof RagSnippetSchema>>;
    validated_widget: z.infer<typeof ActiveWidgetEnvelopeSchema> | null;
    hitl_gate_id: z.infer<typeof PendingGateSchema> | null;
    hitl_outcome: "pending" | "approved" | "edited" | "rejected" | null;
    rejection_reason: string | null;
    error_code: z.infer<typeof ErrorCodeSchema> | null;
    cloud_cost_eur: 0;
    created_at_ms: number;
  }): Promise<void>;
}

export interface SeedOverrides {
  traceIdOverride?: string;
  quoteFixtureOverride?: {
    summary_es: string;
    proposed_payload: z.infer<typeof Gate1QuoteDraftPayloadSchema>;
  };
  ocrFixtureOverride?: {
    summary_es?: string;
    rawText: string;
    parsed: {
      supplierName: string | null;
      supplierNif: string | null;
      issueDateIso: string | null;
      vatRate?: 0 | 4 | 10 | 21 | "mixed";
      baseCents: number | null;
      vatCents: number | null;
      totalCents: number | null;
    };
    confidence: number;
  };
  recoveredDraftOverride?: {
    pending_gate: "gate_1_quote" | "gate_2_ticket";
    summary_es: string;
    proposed_payload:
      | z.infer<typeof Gate1QuoteDraftPayloadSchema>
      | z.infer<typeof Gate2TicketDraftPayloadSchema>;
  };
}
