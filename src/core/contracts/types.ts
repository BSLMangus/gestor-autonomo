import type { z } from "zod";
import type {
  ActionTypeSchema,
  ActiveWidgetEnvelopeSchema,
  BillingSubIntentSchema,
  CatalogCategorySchema,
  CatalogItemRowSchema,
  CatalogPricingModeSchema,
  ClientProfileCommitSchema,
  ClientRowSchema,
  DailyWorkLogInputSchema,
  DisambiguationCandidateSchema,
  DisambiguationChoiceSchema,
  EmitterProfileInputSchema,
  ErrorCodeSchema,
  ExpenseTicketRowSchema,
  FeedbackCorrectionRowSchema,
  Gate1QuoteCommitPayloadSchema,
  Gate1QuoteDraftPayloadSchema,
  Gate2TicketCommitPayloadSchema,
  Gate2TicketDraftPayloadSchema,
  Gate3InvoiceCommitPayloadSchema,
  Gate3InvoiceDraftPayloadSchema,
  Gate4ShareCommitPayloadSchema,
  Gate4ShareDraftPayloadSchema,
  HumanDecisionSchema,
  InferenceEngineSchema,
  InputPayloadSchema,
  InvoiceKindSchema,
  InvoiceRowSchema,
  InvoiceStatusSchema,
  JobRowSchema,
  JobStatusSchema,
  PendingCameraContextSchema,
  PendingCameraRestoreSchema,
  PendingDisambiguationSchema,
  PendingGateSchema,
  PricingSettingsInputSchema,
  QuickActionSchema,
  QuoteItemRowSchema,
  QuoteRowSchema,
  QuoteStatusSchema,
  QuoteVatRateSchema,
  RagSnippetSchema,
  ResolvedTargetSchema,
  ScheduleEntryRowSchema,
  ScheduleStatusSchema,
  SequenceRowSchema,
  SeriesTypeSchema,
  SiteLogCategorySchema,
  SiteLogInputSchema,
  TaxSettingsInputSchema,
  SiteLogRowSchema,
  SpecialistRouteSchema,
  SymmetricBackupEnvelopeSchema,
  SymmetricBackupPlaintextSchema,
  TicketVatRateSchema,
  TraceStateSchema,
  UiWidgetTypeSchema,
  WorkScheduleDefaultsSchema,
} from "./schemas";

export type JobStatus = z.infer<typeof JobStatusSchema>;
export type QuoteStatus = z.infer<typeof QuoteStatusSchema>;
export type InvoiceStatus = z.infer<typeof InvoiceStatusSchema>;
export type InvoiceKind = z.infer<typeof InvoiceKindSchema>;
export type SeriesType = z.infer<typeof SeriesTypeSchema>;
export type BillingSubIntent = z.infer<typeof BillingSubIntentSchema>;
export type SiteLogCategory = z.infer<typeof SiteLogCategorySchema>;
export type CatalogCategory = z.infer<typeof CatalogCategorySchema>;
export type CatalogPricingMode = z.infer<typeof CatalogPricingModeSchema>;
export type QuoteVatRate = z.infer<typeof QuoteVatRateSchema>;
export type TicketVatRate = z.infer<typeof TicketVatRateSchema>;
export type UiWidgetType = z.infer<typeof UiWidgetTypeSchema>;
export type PendingGate = z.infer<typeof PendingGateSchema>;
export type ActionType = z.infer<typeof ActionTypeSchema>;
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type InferenceEngine = z.infer<typeof InferenceEngineSchema>;
export type SpecialistRoute = z.infer<typeof SpecialistRouteSchema>;
export type DisambiguationChoice = z.infer<typeof DisambiguationChoiceSchema>;

export type ResolvedTarget = z.infer<typeof ResolvedTargetSchema>;
export type InputPayload = z.infer<typeof InputPayloadSchema>;
export type DisambiguationCandidate = z.infer<typeof DisambiguationCandidateSchema>;
export type PendingDisambiguation = z.infer<typeof PendingDisambiguationSchema>;
export type RagSnippet = z.infer<typeof RagSnippetSchema>;
export type QuickAction = z.infer<typeof QuickActionSchema>;

export type Gate1QuoteDraftPayload = z.infer<typeof Gate1QuoteDraftPayloadSchema>;
export type Gate2TicketDraftPayload = z.infer<typeof Gate2TicketDraftPayloadSchema>;
export type Gate3InvoiceDraftPayload = z.infer<typeof Gate3InvoiceDraftPayloadSchema>;
export type Gate4ShareDraftPayload = z.infer<typeof Gate4ShareDraftPayloadSchema>;

export type Gate1QuoteCommitPayload = z.infer<typeof Gate1QuoteCommitPayloadSchema>;
export type Gate2TicketCommitPayload = z.infer<typeof Gate2TicketCommitPayloadSchema>;
export type Gate3InvoiceCommitPayload = z.infer<typeof Gate3InvoiceCommitPayloadSchema>;
export type Gate4ShareCommitPayload = z.infer<typeof Gate4ShareCommitPayloadSchema>;

export type ActiveWidgetEnvelope = z.infer<typeof ActiveWidgetEnvelopeSchema>;
export type HumanDecision = z.infer<typeof HumanDecisionSchema>;
export type TraceState = z.infer<typeof TraceStateSchema>;

export type PendingCameraContext = z.infer<typeof PendingCameraContextSchema>;
export type PendingCameraRestore = z.infer<typeof PendingCameraRestoreSchema>;
export type EmitterProfileInput = z.input<typeof EmitterProfileInputSchema>;
export type TaxSettingsInput = z.infer<typeof TaxSettingsInputSchema>;
export type PricingSettingsInput = z.infer<typeof PricingSettingsInputSchema>;
export type ClientProfileCommitInput = z.infer<typeof ClientProfileCommitSchema>;
export type SiteLogInput = z.infer<typeof SiteLogInputSchema>;

export interface LocalAccountRecord {
  id: string;
  email: string;
  display_name: string;
  onboarding_completed: boolean;
  created_at_ms: number;
  updated_at_ms: number;
}

export type SequenceRow = z.infer<typeof SequenceRowSchema>;
export type ClientRow = z.infer<typeof ClientRowSchema>;
export type CatalogItemRow = z.infer<typeof CatalogItemRowSchema>;
export type JobRow = z.infer<typeof JobRowSchema>;
export type QuoteRow = z.infer<typeof QuoteRowSchema>;
export type QuoteItemRow = z.infer<typeof QuoteItemRowSchema>;
export type InvoiceRow = z.infer<typeof InvoiceRowSchema>;
export type ExpenseTicketRow = z.infer<typeof ExpenseTicketRowSchema>;
export type SiteLogRow = z.infer<typeof SiteLogRowSchema>;
export type FeedbackCorrectionRow = z.infer<typeof FeedbackCorrectionRowSchema>;
export type ScheduleStatus = z.infer<typeof ScheduleStatusSchema>;
export type WorkScheduleDefaults = z.infer<typeof WorkScheduleDefaultsSchema>;
export type ScheduleEntryRow = z.infer<typeof ScheduleEntryRowSchema>;
export type DailyWorkLogInput = z.infer<typeof DailyWorkLogInputSchema>;

export interface JobScheduleDeviationSummary {
  job_id: string;
  planned_days: number;
  logged_days: number;
  planned_hours_thousandths: number;
  logged_planned_hours_thousandths: number;
  actual_hours_thousandths: number;
  deviation_hours_thousandths: number;
  hourly_rate_cents: number;
  economic_impact_cents: number;
}

export type SymmetricBackupPlaintext = z.infer<typeof SymmetricBackupPlaintextSchema>;
export type SymmetricBackupEnvelope = z.infer<typeof SymmetricBackupEnvelopeSchema>;

export type FiscalPiggyBankPayload = Extract<
  ActiveWidgetEnvelope,
  { ui_widget_type: "FiscalPiggyBankWidget" }
>["widget_payload"];

export type InterruptPayload =
  | {
      gate_id: "gate_1_quote";
      title: string;
      summary_es: string;
      requires_fiscal_lock: false;
      proposed_payload: Gate1QuoteDraftPayload;
      ui_widget_type: "QuoteBuilderWidget";
    }
  | {
      gate_id: "gate_2_ticket";
      title: string;
      summary_es: string;
      requires_fiscal_lock: false;
      proposed_payload: Gate2TicketDraftPayload;
      ui_widget_type: "TicketOcrValidatorWidget";
    }
  | {
      gate_id: "gate_3_invoice";
      title: string;
      summary_es: string;
      requires_fiscal_lock: true;
      proposed_payload: Gate3InvoiceDraftPayload;
      ui_widget_type: "JobLifecycleActionWidget";
    }
  | {
      gate_id: "gate_4_share";
      title: string;
      summary_es: string;
      requires_fiscal_lock: false;
      proposed_payload: Gate4ShareDraftPayload;
      ui_widget_type: "JobLifecycleActionWidget";
    };

export type LlmStrategyOverride =
  | "auto"
  | "force_270m"
  | "force_1b"
  | "force_apple_intelligence"
  | "force_webgpu"
  | "deterministic_only";

export interface AdminLlmConfigRecord {
  id: 1;
  strategy_override: LlmStrategyOverride;
  android_270m_url: string;
  android_270m_companion_url: string;
  android_1b_url: string;
  android_1b_companion_url: string;
  custom_model_uri: string;
  max_tokens: number;
  temperature_thousandths: number;
  topk: number;
  updated_at_ms: number;
}

export interface AdminLlmConfigInput {
  strategy_override: LlmStrategyOverride;
  android_270m_url: string;
  android_270m_companion_url: string;
  android_1b_url: string;
  android_1b_companion_url: string;
  custom_model_uri: string;
  max_tokens: number;
  temperature_thousandths: number;
  topk: number;
}

export interface AppSettingsRecord {
  id: 1;
  emitter_name: string;
  emitter_nif: string;
  emitter_fiscal_address: string;
  emitter_phone: string;
  emitter_iban: string;
  emitter_logo_data_url: string | null;
  active_account_id: string | null;
  last_active_thread_id: string | null;
  pending_camera_context: PendingCameraContext | null;
  llm_enabled: boolean;
  llm_model_uri: string | null;
  default_vat_rate: number;
  irpf_reserve_rate: number;
  hourly_rate_cents: number;
  boot_mode: "demo" | "clean";
  updated_at_ms: number;
}

export interface DocumentImportExtractedItem {
  temp_id: string;
  selected: boolean;
  description: string;
  category: CatalogCategory;
  unit: string;
  pricing_mode: CatalogPricingMode;
  estimated_hours_thousandths: number;
  materials_cents: number;
  unit_price_cents: number;
  default_vat_rate: QuoteVatRate;
  existing_match_id: string | null;
  source_file_name: string;
}

export interface DocumentImportReviewDraft {
  source_files: Array<{
    name: string;
    kind: "pdf" | "image" | "text";
    pages_processed: number;
    extracted_chars: number;
  }>;
  inferred_hourly_rate_cents: number | null;
  apply_hourly_rate: boolean;
  detected_vat_rate: QuoteVatRate | null;
  detected_irpf_rate: number | null;
  apply_tax_defaults: boolean;
  detected_services: string[];
  items: DocumentImportExtractedItem[];
  warnings: string[];
}

export interface ChatThreadRecord {
  thread_id: string;
  title: string;
  status: "idle" | "running" | "interrupted" | "error";
  active_job_id: string | null;
  active_quote_id: string | null;
  pending_gate: PendingGate | null;
  last_node: string | null;
  is_seed: boolean;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface ChatMessageRecord {
  id: string;
  thread_id: string;
  client_turn_id: string | null;
  role: "user" | "assistant" | "system";
  content: string;
  widget_json: ActiveWidgetEnvelope | null;
  quick_actions_json: QuickAction[] | null;
  trace_id: string | null;
  created_at_ms: number;
}

export interface TurnExecutionResult {
  thread_id: string;
  trace_id: string;
  checkpoint_status: "idle" | "interrupted";
  active_interrupt: InterruptPayload | null;
  active_widget: ActiveWidgetEnvelope | null;
  quick_actions: QuickAction[] | null;
  assistant_message: ChatMessageRecord | null;
  active_job_id: string | null;
  active_quote_id: string | null;
  error_code: ErrorCode | null;
}

export interface RecoveredDraft {
  id: string;
  thread_id: string;
  original_schema_version: string;
  pending_gate: "gate_1_quote" | "gate_2_ticket";
  widget_json: Extract<
    ActiveWidgetEnvelope,
    { ui_widget_type: "QuoteBuilderWidget" | "TicketOcrValidatorWidget" }
  >;
  active_job_id: string | null;
  active_quote_id: string | null;
  dismissed: boolean;
  recovered_at_ms: number;
}

export interface JobFiscalSummary {
  job_id: string;
  job_code: string;
  quoted_base_cents: number;
  invoiced_base_cents: number;
  collected_gross_cents: number;
  pending_invoice_gross_cents: number;
  tickets_base_cents: number;
  tickets_gross_cents: number;
  net_profit_cents: number;
  has_advance_40: boolean;
  has_final_invoice: boolean;
}

export type CameraCaptureResult =
  | { status: "ok"; media_uri: string }
  | { status: "cancelled" }
  | { status: "permission_denied" }
  | { status: "error"; reason: string };

export interface SiteLogRecord {
  id: string;
  job_id: string;
  category: SiteLogCategory;
  note_text: string;
  photo_uri: string | null;
  stamp_job_code: string;
  stamp_client_name: string;
  created_at_iso: string;
  created_at_ms: number;
}

export interface AgentTraceRecord {
  trace_id: string;
  parent_trace_id: string | null;
  thread_id: string;
  turn_id: string;
  turn_phase: "complete" | "pre_interrupt" | "post_resume";
  routed_intent: string | null;
  node_sequence: string[];
  inference_engine: InferenceEngine;
  latency_ms: number;
  rag_snippets: RagSnippet[];
  validated_widget: ActiveWidgetEnvelope | null;
  hitl_gate_id: PendingGate | null;
  hitl_outcome: "pending" | "approved" | "edited" | "rejected" | null;
  rejection_reason: string | null;
  error_code: ErrorCode | null;
  cloud_cost_eur: 0;
  created_at_ms: number;
}

export interface FeedbackCorrectionRecord {
  id: string;
  catalog_item_id: string;
  item_description: string;
  quote_id: string | null;
  old_unit_price_cents: number;
  new_unit_price_cents: number;
  created_at_ms: number;
}

export interface EvalCaseResult {
  id: string;
  category: "fiscal" | "rag" | "zod" | "graph";
  passed: boolean;
  details: string;
}

export interface EvalSuiteReport {
  executed_at_ms: number;
  total_cases: number;
  passed: number;
  failed: number;
  duration_ms: number;
  cloud_cost_eur: 0;
  results: EvalCaseResult[];
}

export type LocalStreamEvent =
  | {
      event: "turn_started";
      payload: { thread_id: string; turn_id: string; client_turn_id: string; started_at_ms: number };
    }
  | {
      event: "node_entered";
      payload: {
        thread_id: string;
        turn_id: string;
        node:
          | SpecialistRoute
          | "intent_router"
          | "a2ui_dispatcher"
          | "quote_commit"
          | "ocr_commit"
          | "lifecycle_commit";
      };
    }
  | {
      event: "rag_hits";
      payload: { thread_id: string; turn_id: string; snippets: RagSnippet[] };
    }
  | {
      event: "hitl_interrupt";
      payload: {
        thread_id: string;
        turn_id: string;
        interruptPayload: InterruptPayload;
        trace_id: string;
      };
    }
  | {
      event: "widget_ready";
      payload: {
        thread_id: string;
        turn_id: string;
        active_widget: ActiveWidgetEnvelope | null;
        quick_actions: QuickAction[] | null;
      };
    }
  | {
      event: "turn_completed";
      payload: {
        thread_id: string;
        turn_id: string;
        trace_id: string;
        latency_ms: number;
        cloud_cost_eur: 0;
      };
    }
  | {
      event: "turn_error";
      payload: {
        thread_id: string;
        turn_id: string;
        error_code: ErrorCode;
        message_es: string;
        recoverable: boolean;
      };
    };

export interface SqliteExecutor {
  query<T extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowid?: number }>;
  inTransaction<T>(fn: (tx: Pick<SqliteExecutor, "query" | "run">) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface LocalFileBridge {
  saveTempMedia(bytes: Uint8Array, ext: "jpg" | "png"): Promise<string>;
  commitMedia(tempUri: string, folder: "tickets" | "sitelogs"): Promise<string | null>;
  rollbackCommittedMedia(committedUri: string, restoreTempUri?: string): Promise<void>;
  deleteCommittedMedia(uri: string | null): Promise<void>;
  resolveDisplayUrl(uri: string | null): Promise<{ url: string; revoke: () => void } | null>;
  savePdf(bytes: Uint8Array, fileName: string): Promise<string>;
  deletePdf(uri: string | null): Promise<void>;
  toShareableNativeUri(uri: string): Promise<string>;
  readAsFile(uri: string, fileName: string, mimeType: string): Promise<File>;
  deleteIfTemp(uri: string | null): Promise<void>;
  sweepOrphanTempFiles(activeInterruptUris: Set<string>, maxAgeMs: number): Promise<number>;
}

export interface MemoryCoordinator {
  registerLlmReleaser(fn: () => Promise<void>): void;
  acquireHeavyTask(task: "ocr" | "pdf" | "llm"): Promise<() => Promise<void>>;
  releaseLlmIfLoaded(): Promise<void>;
}
