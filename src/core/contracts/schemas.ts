import { z } from "zod";
import { deriveFiscalQuarter, isValidIsoDate } from "../fiscal/dateQuarter";
import { validateSpanishTaxId } from "../fiscal/taxIdValidator";
import { TEXT_LIMITS } from "./textLimits";

export const JobStatusSchema = z.enum(["pendiente", "en_curso", "finalizado", "cancelado"]);
export const QuoteStatusSchema = z.enum(["borrador", "enviado", "aceptado", "rechazado"]);
export const InvoiceStatusSchema = z.enum(["pendiente_cobro", "pagado", "vencido"]);
export const InvoiceKindSchema = z.enum(["advance_40", "final", "full"]);
export const SeriesTypeSchema = z.enum(["PRE", "ANT", "FAC", "OBR", "ACT"]);
export const EspecialidadActaSchema = z.enum(["electricidad", "fontaneria", "mixta"]);
export const TipoActuacionActaSchema = z.enum([
  "obra_nueva",
  "reforma_integral",
  "modificacion_parcial",
  "reparacion_sustitucion",
]);
export const EstadoActaSchema = z.enum(["borrador", "completada", "firmada"]);
export const RedFontaneriaSchema = z.enum(["AFCH", "ACS", "Retorno", "Saneamiento"]);
export const BillingSubIntentSchema = z.enum(["advance_40", "final_invoice", "share", "overview"]);
export const SiteLogCategorySchema = z.enum(["antes", "despues", "nota"]);
export const CatalogCategorySchema = z.enum([
  "Fontanería",
  "Electricidad",
  "Albañilería",
  "Pintura",
  "General",
]);
export const CatalogPricingModeSchema = z.enum(["fixed", "hourly_plus_materials"]);
export const QuoteVatRateSchema = z.number().min(0).max(100);
export const QuoteValidityDaysSchema = z.number().int().min(1).max(365);
export const QuotePaymentMethodSchema = z.enum(["transferencia", "efectivo", "bizum", "tarjeta"]);
export const QuotePaymentInstallmentSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, "La etiqueta del pago es obligatoria")
    .max(TEXT_LIMITS.PAYMENT_LABEL),
  percentage: z.number().min(0.01, "Cada pago debe ser mayor que 0 %").max(100),
});
export const QuotePaymentScheduleSchema = z
  .array(QuotePaymentInstallmentSchema)
  .max(4, "Máximo 4 pagos fraccionados")
  .superRefine((items, ctx) => {
    if (items.length === 0) return;
    const totalBps = items.reduce((acc, item) => acc + Math.round(item.percentage * 100), 0);
    if (Math.abs(totalBps - 10_000) > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Los porcentajes del fraccionamiento deben sumar 100 %",
      });
    }
  });

export const TaxModelCodeSchema = z.enum([
  "303",
  "130",
  "131",
  "111",
  "115",
  "349",
  "309",
  "390",
  "190",
  "180",
  "347",
  "100",
  "102",
]);
export const TaxObligationStatusSchema = z.enum(["pendiente", "presentado", "no_aplica"]);
export const TicketVatRateSchema = z.union([
  z.literal(0),
  z.literal(4),
  z.literal(10),
  z.literal(21),
  z.literal("mixed"),
]);

export const UiWidgetTypeSchema = z.enum([
  "QuoteBuilderWidget",
  "FiscalPiggyBankWidget",
  "TicketOcrValidatorWidget",
  "JobLifecycleActionWidget",
  "SiteLogStampWidget",
  "ClientProfileWidget",
  "ScheduleWorkLogWidget",
]);

export const PendingGateSchema = z.enum([
  "gate_1_quote",
  "gate_2_ticket",
  "gate_3_invoice",
  "gate_4_share",
]);

export const ActionTypeSchema = z.enum([
  "free_text_or_voice",
  "scan_ticket",
  "manual_ticket_entry",
  "start_empty_quote",
  "start_job_quote",
  "start_empty_client",
  "request_invoice_gate",
  "request_advance_gate",
  "request_share_gate",
  "open_job_overview",
  "open_fiscal_piggybank",
  "open_schedule_log",
  "resolve_disambiguation",
]);

export const ErrorCodeSchema = z.enum([
  "OCR_ENGINE_ERROR",
  "PDF_BUILD_ERROR",
  "SQLITE_QUERY_ERROR",
  "SCHEMA_VALIDATION_ERROR",
  "INVALID_STATE_TRANSITION",
  "LAZY_CHUNK_LOAD_ERROR",
  "STORAGE_QUOTA_EXCEEDED",
]);

export const InferenceEngineSchema = z.enum([
  "deterministic_rule_engine",
  "mediapipe_local_llm",
  "mediapipe_fallback_deterministic",
]);

export const LlmStrategyOverrideSchema = z.enum([
  "auto",
  "force_270m",
  "force_1b",
  "force_apple_intelligence",
  "force_webgpu",
  "deterministic_only",
]);

export const AdminLlmConfigInputSchema = z.object({
  strategy_override: LlmStrategyOverrideSchema,
  android_270m_url: z.string().trim().max(2000),
  android_270m_companion_url: z.string().trim().max(2000),
  android_1b_url: z.string().trim().max(2000),
  android_1b_companion_url: z.string().trim().max(2000),
  custom_model_uri: z.string().trim().max(2000),
  max_tokens: z.number().int().min(64).max(4096),
  temperature_thousandths: z.number().int().min(0).max(2000),
  topk: z.number().int().min(1).max(100),
});

export const SpecialistRouteSchema = z.enum([
  "quote_specialist",
  "ocr_ticket_specialist",
  "fiscal_piggybank_specialist",
  "lifecycle_billing_specialist",
  "site_log_specialist",
  "schedule_specialist",
  "assistant_qa_node",
  "clarification_node",
]);

export const DisambiguationChoiceSchema = z.enum([
  "edit_existing_quote",
  "create_annex_job",
  "open_job_overview",
  "scan_ticket",
  "site_log",
]);

export function normalizePhoneInput(raw: string): string {
  const cleaned = raw.replace(/[\s\-().]/g, "");
  return /^[6789]\d{8}$/.test(cleaned) ? `+34${cleaned}` : cleaned;
}

export const IsoDateSchema = z.string().refine(isValidIsoDate, "Fecha ISO inválida");
export const FiscalQuarterSchema = z.string().regex(/^\d{4}-T[1-4]$/, "Trimestre fiscal inválido");
export const ScheduleStatusSchema = z.enum(["previsto", "en_hora", "antes", "alargado"]);
export const TimeHHMMSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora HH:MM inválida");

export const WorkScheduleDefaultsSchema = z.object({
  work_days: z.array(z.number().int().min(1).max(7)).max(7),
  morning_start: TimeHHMMSchema,
  morning_end: TimeHHMMSchema,
  afternoon_start: TimeHHMMSchema,
  afternoon_end: TimeHHMMSchema,
  auto_apply_to_jobs: z.boolean(),
  updated_at_ms: z.number().int().nonnegative().optional(),
});

export const ScheduleEntryRowSchema = z.object({
  id: z.string().min(1),
  job_id: z.string().min(1).nullable(),
  date_iso: IsoDateSchema,
  planned_start: TimeHHMMSchema,
  planned_end: TimeHHMMSchema,
  planned_hours_thousandths: z.number().int().nonnegative(),
  actual_start: TimeHHMMSchema.nullable(),
  actual_end: TimeHHMMSchema.nullable(),
  actual_hours_thousandths: z.number().int().nonnegative().nullable(),
  status: ScheduleStatusSchema,
  deviation_reason: z.string().max(TEXT_LIMITS.DEVIATION_REASON),
  notes: z.string().max(TEXT_LIMITS.NOTES),
  created_at_ms: z.number().int().nonnegative(),
  updated_at_ms: z.number().int().nonnegative(),
});

export const DailyWorkLogInputSchema = z.object({
  actual_start: TimeHHMMSchema.optional(),
  actual_end: TimeHHMMSchema,
  actual_hours_thousandths: z.number().int().min(0).max(24_000),
  status: ScheduleStatusSchema,
  deviation_reason: z.string().trim().max(TEXT_LIMITS.DEVIATION_REASON).default(""),
  notes: z.string().trim().max(TEXT_LIMITS.NOTES).default(""),
  also_log_in_site_logs: z.boolean().default(false),
});

export const SpanishTaxIdSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((val) => validateSpanishTaxId(val), "NIF/NIE/CIF inválido según dígito de control");

export const E164PhoneSchema = z
  .string()
  .transform(normalizePhoneInput)
  .pipe(z.string().regex(/^\+?[1-9]\d{8,14}$/, "Teléfono inválido para WhatsApp/envío"));

export const ResolvedTargetSchema = z.object({
  client_id: z.string().min(1).optional(),
  job_id: z.string().min(1).optional(),
  quote_id: z.string().min(1).optional(),
  catalog_item_id: z.string().min(1).optional(),
  action_choice: DisambiguationChoiceSchema.optional(),
});

export const InputPayloadSchema = z.object({
  client_turn_id: z.string().min(1),
  text: z.string().max(TEXT_LIMITS.CHAT_INPUT).default(""),
  action_type: ActionTypeSchema.default("free_text_or_voice"),
  session_context: z
    .object({
      active_job_id: z.string().min(1).nullable(),
      active_quote_id: z.string().min(1).nullable(),
    })
    .optional(),
  target_ids: z
    .object({
      client_id: z.string().min(1).optional(),
      job_id: z.string().min(1).optional(),
      quote_id: z.string().min(1).optional(),
      invoice_id: z.string().min(1).optional(),
      catalog_item_id: z.string().min(1).optional(),
    })
    .optional(),
  billing_sub_intent: BillingSubIntentSchema.optional(),
  disambiguation_choice: DisambiguationChoiceSchema.optional(),
  quarter: FiscalQuarterSchema.optional(),
  raw_media_uri: z.string().min(1).max(1024).optional(),
  media_kind: z.enum(["ticket_photo", "site_photo", "voice_transcript"]).optional(),
});

export const DisambiguationCandidateSchema = z.object({
  entity_type: z.enum(["job", "client", "quote", "catalog_item", "intent_action"]),
  id: z.string().min(1),
  label: z.string().min(1).max(TEXT_LIMITS.DISAMBIGUATION_LABEL),
  subtitle: z.string().max(200).optional(),
  job_id: z.string().min(1).optional(),
  quote_id: z.string().min(1).optional(),
  client_id: z.string().min(1).optional(),
  catalog_item_id: z.string().min(1).optional(),
  action_choice: DisambiguationChoiceSchema.optional(),
});

export const PendingDisambiguationSchema = z.object({
  original_intent: SpecialistRouteSchema.nullable(),
  original_text: z.string().max(TEXT_LIMITS.CHAT_INPUT),
  raw_media_uri: z.string().max(1024).optional(),
  preserved_target: ResolvedTargetSchema.optional(),
  prompt: z.string().min(1).max(400),
  candidates: z.array(DisambiguationCandidateSchema).min(0).max(5),
  attempts: z.number().int().min(0).max(2).default(0),
});

export const SlotFillTargetSchema = z.enum([
  "quote_specialist",
  "ocr_ticket_specialist",
  "client_onboarding",
  "site_log_specialist",
]);

export const PendingSlotFillSchema = z.object({
  target_intent: SlotFillTargetSchema,
  missing_fields: z.array(z.string().min(1)).min(1),
  collected_data: z.record(z.string(), z.unknown()).default({}),
  original_text: z.string().max(TEXT_LIMITS.CHAT_INPUT),
  attempts: z.number().int().min(0).max(2).default(0),
});

export const RagSnippetSchema = z.object({
  source_table: z.enum(["catalog_items", "clients", "jobs"]),
  record_id: z.string().min(1),
  title: z.string().min(1).max(TEXT_LIMITS.DISAMBIGUATION_LABEL),
  snippet_text: z.string().max(TEXT_LIMITS.RAG_SNIPPET),
  bm25_score: z.number(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});

export const QuickActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(80),
  action_type: ActionTypeSchema,
  payload: InputPayloadSchema.omit({ client_turn_id: true }).partial().optional(),
});

// --- DRAFT SCHEMAS (Widget y proposed_payload) ---
export const Gate1QuoteLineDraftSchema = z.object({
  catalog_item_id: z.string().min(1).nullable(),
  description: z.string().max(TEXT_LIMITS.DESCRIPTION),
  category: CatalogCategorySchema.default("General"),
  unit: z.string().min(1).max(24).default("ud"),
  quantity_thousandths: z.number().int().nonnegative().max(10_000_000),
  unit_price_cents: z.number().int().nonnegative().max(100_000_000),
  original_unit_price_cents: z.number().int().nonnegative().max(100_000_000),
  save_to_catalog: z.boolean().default(false),
});

export const Gate1QuoteDraftPayloadSchema = z.object({
  quote_id: z.string().min(1).nullable(),
  client_id: z.string().min(1).nullable(),
  new_client: z
    .object({
      name: z.string().max(TEXT_LIMITS.NAME),
      phone: z.string().max(TEXT_LIMITS.PHONE).optional(),
      nif: z.string().max(TEXT_LIMITS.TAX_ID).optional(),
      fiscal_address: z.string().max(TEXT_LIMITS.ADDRESS).optional(),
    })
    .optional(),
  job_id: z.string().min(1).nullable(),
  job_title: z.string().max(TEXT_LIMITS.TITLE),
  vat_rate: QuoteVatRateSchema,
  validity_days: QuoteValidityDaysSchema.nullable().optional(),
  payment_methods: z.array(QuotePaymentMethodSchema).max(4).optional(),
  payment_schedule: z
    .array(
      z.object({
        label: z.string().max(TEXT_LIMITS.PAYMENT_LABEL),
        percentage: z.number().min(0).max(100),
      })
    )
    .max(4)
    .optional(),
  notes: z.string().max(TEXT_LIMITS.NOTES).default(""),
  lines: z.array(Gate1QuoteLineDraftSchema).min(0),
});

export const Gate2TicketDraftPayloadSchema = z.object({
  supplier_name: z.string().max(TEXT_LIMITS.NAME).default(""),
  supplier_nif: z.string().max(TEXT_LIMITS.TAX_ID).default(""),
  issue_date_iso: IsoDateSchema,
  quarter: FiscalQuarterSchema,
  base_cents: z.number().int().nonnegative().max(100_000_000),
  vat_rate: TicketVatRateSchema.optional(),
  vat_cents: z.number().int().nonnegative().max(100_000_000),
  total_cents: z.number().int().nonnegative().max(100_000_000),
  ocr_confidence: z.number().min(0).max(100).default(0),
  job_id: z.string().min(1).nullable(),
  category: z.string().min(1).max(64).default("materiales"),
  media_uri: z.string().min(1).max(1024).nullable(),
});

export const Gate3InvoiceDraftPayloadSchema = z.object({
  sub_intent: z.enum(["advance_40", "final_invoice"]),
  quote_id: z.string().min(1),
  job_id: z.string().min(1),
  issued_at_iso: IsoDateSchema,
  due_at_iso: IsoDateSchema,
  emitter_name: z.string().max(TEXT_LIMITS.NAME).default(""),
  emitter_nif: z.string().max(TEXT_LIMITS.TAX_ID).default(""),
  emitter_fiscal_address: z.string().max(TEXT_LIMITS.ADDRESS).default(""),
  client_id: z.string().min(1),
  client_nif: z.string().max(TEXT_LIMITS.TAX_ID).default(""),
  client_fiscal_address: z.string().max(TEXT_LIMITS.ADDRESS).default(""),
  notes: z.string().max(TEXT_LIMITS.NOTES).default(""),
});

export const Gate4ShareDraftPayloadSchema = z.object({
  document_kind: z.enum(["quote", "invoice"]),
  document_id: z.string().min(1),
  channel: z.enum(["whatsapp", "share_sheet"]),
  recipient_phone: z.string().max(TEXT_LIMITS.PHONE).default(""),
  message_text: z.string().max(TEXT_LIMITS.SHARE_MESSAGE),
});

// --- COMMIT SCHEMAS ESTRICTOS ---
export const Gate1QuoteLineCommitSchema = Gate1QuoteLineDraftSchema.extend({
  description: z.string().trim().min(1).max(TEXT_LIMITS.DESCRIPTION),
  quantity_thousandths: z.number().int().positive().max(10_000_000),
  unit_price_cents: z.number().int().positive().max(100_000_000),
});

export const Gate1QuoteCommitPayloadSchema = Gate1QuoteDraftPayloadSchema.extend({
  job_title: z.string().trim().max(TEXT_LIMITS.TITLE).default(""),
  validity_days: QuoteValidityDaysSchema.nullable().optional(),
  payment_methods: z.array(QuotePaymentMethodSchema).max(4).optional(),
  payment_schedule: QuotePaymentScheduleSchema.optional(),
  new_client: z
    .object({
      name: z.string().trim().min(1).max(TEXT_LIMITS.NAME),
      phone: z.string().max(TEXT_LIMITS.PHONE).optional(),
      nif: z.union([z.literal(""), SpanishTaxIdSchema]).optional(),
      fiscal_address: z.string().max(TEXT_LIMITS.ADDRESS).optional(),
    })
    .optional(),
  lines: z.array(Gate1QuoteLineCommitSchema).min(1),
}).refine((p) => !(p.client_id !== null && p.new_client !== undefined), {
  message: "No puedes indicar client_id existente y new_client a la vez",
});

export const Gate2TicketCommitPayloadSchema = Gate2TicketDraftPayloadSchema.extend({
  supplier_name: z.string().trim().min(1).max(TEXT_LIMITS.NAME),
  supplier_nif: z.union([z.literal(""), SpanishTaxIdSchema]).default(""),
  total_cents: z.number().int().positive().max(100_000_000),
}).superRefine((t, ctx) => {
  if (t.quarter !== deriveFiscalQuarter(t.issue_date_iso)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Trimestre incoherente con issue_date_iso" });
  }
  if (Math.abs(t.base_cents + t.vat_cents - t.total_cents) > 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Descuadre base + IVA vs total > 2 céntimos",
    });
  }
});

export const Gate3InvoiceCommitPayloadSchema = Gate3InvoiceDraftPayloadSchema.extend({
  emitter_name: z.string().trim().min(1).max(TEXT_LIMITS.NAME),
  emitter_nif: SpanishTaxIdSchema,
  emitter_fiscal_address: z.string().trim().min(5).max(TEXT_LIMITS.ADDRESS),
  client_nif: SpanishTaxIdSchema,
  client_fiscal_address: z.string().trim().min(5).max(TEXT_LIMITS.ADDRESS),
}).refine((inv) => inv.due_at_iso >= inv.issued_at_iso, {
  message: "due_at_iso no puede ser anterior a issued_at_iso",
});

export const Gate4ShareCommitPayloadSchema = Gate4ShareDraftPayloadSchema.extend({
  recipient_phone: z.union([z.literal(""), E164PhoneSchema]).default(""),
  message_text: z.string().trim().min(1).max(TEXT_LIMITS.SHARE_MESSAGE),
}).refine((s) => s.channel !== "whatsapp" || s.recipient_phone.length > 0, {
  message: "El canal WhatsApp exige teléfono destino válido",
});

// --- ENVELOPE WIDGETS A2UI ---
export const ActiveWidgetEnvelopeSchema = z.discriminatedUnion("ui_widget_type", [
  z.object({
    ui_widget_type: z.literal("QuoteBuilderWidget"),
    widget_payload: Gate1QuoteDraftPayloadSchema.extend({
      subtotal_cents: z.number().int().nonnegative(),
      vat_cents: z.number().int().nonnegative(),
      total_cents: z.number().int().nonnegative(),
    }),
  }),
  z.object({
    ui_widget_type: z.literal("TicketOcrValidatorWidget"),
    widget_payload: Gate2TicketDraftPayloadSchema.extend({
      ocr_fallback_reason: ErrorCodeSchema.nullable(),
    }),
  }),
  z.object({
    ui_widget_type: z.literal("FiscalPiggyBankWidget"),
    widget_payload: z.object({
      quarter: FiscalQuarterSchema,
      cobrado_mismo_trimestre_cents: z.number().int().nonnegative(),
      cobros_trimestres_anteriores_cents: z.number().int().nonnegative(),
      pendiente_cobro_trimestre_cents: z.number().int().nonnegative(),
      pendiente_cobro_anteriores_cents: z.number().int().nonnegative(),
      iva_repercutido_cents: z.number().int().nonnegative(),
      iva_soportado_cents: z.number().int().nonnegative(),
      iva_to_reserve_cents: z.number().int().nonnegative(),
      iva_to_compensate_cents: z.number().int().nonnegative(),
      irpf_20_cents: z.number().int().nonnegative(),
      irpf_rate: z.number().min(0).max(100).optional(),
      untouchable_tax_cents: z.number().int().nonnegative(),
      available_cash_cents: z.number().int(),
      selected_job_profit_cents: z.number().int().nullable(),
      job_profits: z.array(
        z.object({
          job_id: z.string().min(1),
          job_code: z.string().min(1),
          job_title: z.string().min(1),
          net_profit_cents: z.number().int(),
        })
      ),
    }),
  }),
  z.object({
    ui_widget_type: z.literal("JobLifecycleActionWidget"),
    widget_payload: z.object({
      job_id: z.string().min(1),
      quote_id: z.string().min(1).nullable(),
      invoice_id: z.string().min(1).nullable(),
      mode: z.enum(["overview", "preview_gate_3", "preview_gate_4", "ready_to_share"]),
      pdf_uri: z.string().nullable(),
      gate_3_draft: Gate3InvoiceDraftPayloadSchema.optional(),
      gate_4_draft: Gate4ShareDraftPayloadSchema.optional(),
    }),
  }),
  z.object({
    ui_widget_type: z.literal("SiteLogStampWidget"),
    widget_payload: z.object({
      candidate_job_id: z.string().min(1).nullable(),
      category: SiteLogCategorySchema,
      note_text: z.string().max(TEXT_LIMITS.NOTES),
      raw_media_uri: z.string().nullable(),
      stamp_preview_meta: z.object({
        job_code: z.string().nullable(),
        client_name: z.string().nullable(),
        timestamp_iso: z.string(),
      }),
    }),
  }),
  z.object({
    ui_widget_type: z.literal("ClientProfileWidget"),
    widget_payload: z.object({
      client_id: z.string().min(1).nullable(),
      name: z.string().max(TEXT_LIMITS.NAME),
      phone: z.string().max(TEXT_LIMITS.PHONE).default(""),
      nif: z.string().max(TEXT_LIMITS.TAX_ID).default(""),
      fiscal_address: z.string().max(TEXT_LIMITS.ADDRESS).default(""),
      email: z.string().max(TEXT_LIMITS.EMAIL).default(""),
      notes: z.string().max(TEXT_LIMITS.NOTES).default(""),
      validation_hint: z.string().max(300).nullable().optional(),
    }),
  }),
  z.object({
    ui_widget_type: z.literal("ScheduleWorkLogWidget"),
    widget_payload: z.object({
      mode: z.enum(["daily_log", "plan_range"]).default("daily_log"),
      entry_id: z.string().min(1).nullable(),
      job_id: z.string().min(1).nullable(),
      date_iso: IsoDateSchema,
      start_date_iso: IsoDateSchema.nullable().optional(),
      end_date_iso: IsoDateSchema.nullable().optional(),
      suggested_delta_thousandths: z.number().int().nullable().optional(),
      suggested_reason: z.string().max(TEXT_LIMITS.DEVIATION_REASON).default(""),
      suggested_notes: z.string().max(TEXT_LIMITS.NOTES).default(""),
    }),
  }),
]);

export const ClientProfileCommitSchema = z.object({
  client_id: z.string().min(1).nullable().optional(),
  name: z.string().trim().min(1, "El nombre del cliente es obligatorio").max(TEXT_LIMITS.NAME),
  phone: z.string().trim().max(TEXT_LIMITS.PHONE).default(""),
  nif: z.union([z.literal(""), SpanishTaxIdSchema]).default(""),
  fiscal_address: z.string().trim().max(TEXT_LIMITS.ADDRESS).default(""),
  email: z.string().trim().max(TEXT_LIMITS.EMAIL).default(""),
  notes: z.string().trim().max(TEXT_LIMITS.NOTES).default(""),
});

// --- HUMAN DECISION (Command({ resume })) ---
export const HumanDecisionSchema = z
  .discriminatedUnion("gate_id", [
    z.object({
      gate_id: z.literal("gate_1_quote"),
      action: z.enum(["approve", "edit", "reject"]),
      edited_payload: Gate1QuoteCommitPayloadSchema.optional(),
      rejection_reason: z.string().max(300).optional(),
      client_validated_at_ms: z.number().int().nonnegative(),
    }),
    z.object({
      gate_id: z.literal("gate_2_ticket"),
      action: z.enum(["approve", "edit", "reject"]),
      edited_payload: Gate2TicketCommitPayloadSchema.optional(),
      rejection_reason: z.string().max(300).optional(),
      client_validated_at_ms: z.number().int().nonnegative(),
    }),
    z.object({
      gate_id: z.literal("gate_3_invoice"),
      action: z.enum(["approve", "edit", "reject"]),
      edited_payload: Gate3InvoiceCommitPayloadSchema.optional(),
      rejection_reason: z.string().max(300).optional(),
      client_validated_at_ms: z.number().int().nonnegative(),
    }),
    z.object({
      gate_id: z.literal("gate_4_share"),
      action: z.enum(["approve", "edit", "reject"]),
      edited_payload: Gate4ShareCommitPayloadSchema.optional(),
      rejection_reason: z.string().max(300).optional(),
      client_validated_at_ms: z.number().int().nonnegative(),
    }),
  ])
  .superRefine((d, ctx) => {
    if (d.action === "edit" && d.edited_payload === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "edited_payload obligatorio en action === 'edit'",
      });
    }
    if ((d.action === "approve" || d.action === "reject") && d.edited_payload !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "edited_payload prohibido cuando action es 'approve' o 'reject'",
      });
    }
  });

export const TraceStateSchema = z.object({
  turn_id: z.string(),
  trace_id: z.string(),
  parent_trace_id: z.string().nullable(),
  started_at_ms: z.number().int().nonnegative(),
  node_sequence: z.array(z.string()),
  inference_engine: InferenceEngineSchema,
  rag_hit_count: z.number().int().nonnegative(),
  error_code: ErrorCodeSchema.nullable(),
  rejection_reason: z.string().max(300).nullable(),
  cloud_cost_eur: z.literal(0),
});

// --- BRIDGE & BACKUP SCHEMAS (docs/03_CONTRATOS_API_Y_SEED.json) ---
export const PendingCameraContextSchema = z.object({
  source: z.enum(["chat", "scan_ticket", "site_log", "global_camera", "acta_photo"]),
  thread_id: z.string().min(1).nullable(),
  active_job_id: z.string().min(1).nullable(),
  acta_id: z.string().min(1).nullable().optional(),
  started_at_ms: z.number().int().nonnegative(),
});

export const PendingCameraRestoreSchema = z.object({
  media_uri: z.string().min(1),
  context: PendingCameraContextSchema,
});

export const TaxSettingsInputSchema = z.object({
  default_vat_rate: z.number().min(0).max(100),
  irpf_reserve_rate: z.number().min(0).max(100),
});

export const PricingSettingsInputSchema = z.object({
  hourly_rate_cents: z.number().int().min(100).max(1_000_000),
});

export const QuoteDefaultsInputSchema = z.object({
  default_quote_validity_days: QuoteValidityDaysSchema,
  default_payment_methods: z.array(QuotePaymentMethodSchema).max(4),
  default_payment_schedule: QuotePaymentScheduleSchema,
});

export const EmitterProfileInputSchema = z.object({
  emitter_name: z.string().trim().max(TEXT_LIMITS.NAME),
  emitter_nif: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === "" || validateSpanishTaxId(v), "NIF/NIE/CIF inválido según dígito de control"),
  emitter_fiscal_address: z.string().trim().max(TEXT_LIMITS.ADDRESS),
  emitter_phone: z.string().trim().max(TEXT_LIMITS.PHONE),
  emitter_iban: z
    .string()
    .trim()
    .max(42)
    .transform((v) => v.replace(/\s+/g, "").toUpperCase())
    .optional()
    .default(""),
  emitter_logo_data_url: z
    .string()
    .max(450_000)
    .refine(
      (v) =>
        v.startsWith("data:image/png;base64,") ||
        v.startsWith("data:image/jpeg;base64,") ||
        v.startsWith("data:image/webp;base64,"),
      "Formato de logotipo inválido (usa PNG, JPG o WebP)"
    )
    .nullable()
    .optional(),
});

export const InstallerActaProfileInputSchema = z.object({
  emitter_email: z
    .string()
    .trim()
    .max(TEXT_LIMITS.EMAIL)
    .refine(
      (v) => v === "" || z.string().email().safeParse(v).success,
      "Correo electrónico inválido"
    )
    .optional()
    .default(""),
  emitter_registry_number: z.string().trim().max(TEXT_LIMITS.SHORT_LABEL).optional().default(""),
  emitter_tech_name: z.string().trim().max(TEXT_LIMITS.NAME).optional().default(""),
  emitter_tech_dni: z
    .string()
    .trim()
    .toUpperCase()
    .max(TEXT_LIMITS.TAX_ID)
    .refine(
      (v) => v === "" || validateSpanishTaxId(v),
      "DNI/NIE/NIF inválido según dígito de control"
    )
    .optional()
    .default(""),
  emitter_installer_card: z.string().trim().max(TEXT_LIMITS.SHORT_LABEL).optional().default(""),
  default_acta_warranty_months: z.number().int().min(1).max(120).optional().default(24),
  emitter_signature_data_url: z
    .string()
    .max(450_000)
    .refine(
      (v) =>
        v.startsWith("data:image/png;base64,") ||
        v.startsWith("data:image/jpeg;base64,") ||
        v.startsWith("data:image/webp;base64,"),
      "Formato de firma inválido (usa PNG, JPG o WebP)"
    )
    .nullable()
    .optional(),
  emitter_name: z.string().trim().max(TEXT_LIMITS.NAME).optional(),
  emitter_nif: z
    .string()
    .trim()
    .toUpperCase()
    .refine(
      (v) => v === "" || validateSpanishTaxId(v),
      "NIF/NIE/CIF inválido según dígito de control"
    )
    .optional(),
  emitter_fiscal_address: z.string().trim().max(TEXT_LIMITS.ADDRESS).optional(),
  emitter_phone: z.string().trim().max(TEXT_LIMITS.PHONE).optional(),
});

export const RegisterAccountInputSchema = z.object({
  display_name: z
    .string()
    .trim()
    .min(1, "Introduce tu nombre o nombre comercial")
    .max(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Introduce un correo electrónico válido")
    .max(160),
  password: z
    .string()
    .min(6, "La contraseña debe tener al menos 6 caracteres")
    .max(128),
});

export const LoginAccountInputSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Introduce un correo electrónico válido")
    .max(160),
  password: z.string().min(1, "Introduce tu contraseña").max(128),
});

export const SiteLogInputSchema = z
  .object({
    job_id: z.string().min(1).nullable(),
    new_job: z
      .object({
        title: z.string().trim().min(1).max(TEXT_LIMITS.TITLE),
        address: z.string().max(TEXT_LIMITS.ADDRESS).optional().default(""),
      })
      .optional(),
    category: SiteLogCategorySchema,
    note_text: z.string().max(TEXT_LIMITS.NOTES).default(""),
    raw_media_uri: z.string().min(1).max(1024).nullable(),
  })
  .superRefine((val, ctx) => {
    const hasJob = val.job_id !== null;
    const hasNewJob = val.new_job !== undefined;
    if (hasJob === hasNewJob) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Debe indicar job_id existente o new_job (XOR)",
      });
    }
    if (val.note_text.trim().length === 0 && val.raw_media_uri === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "El diario requiere una nota o una fotografía",
      });
    }
  });

export const SequenceRowSchema = z.object({
  series_type: SeriesTypeSchema,
  fiscal_year: z.number().int().min(2020).max(2100),
  last_seq: z.number().int().nonnegative(),
  updated_at_ms: z.number().int().nonnegative(),
});

export const ClientRowSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  nif: z.string(),
  fiscal_address: z.string(),
  phone: z.string(),
  email: z.string(),
  notes: z.string(),
  created_at_ms: z.number().int().nonnegative(),
  updated_at_ms: z.number().int().nonnegative(),
});

export const CatalogItemRowSchema = z.object({
  id: z.string().min(1),
  description: z.string().trim().min(1),
  category: CatalogCategorySchema,
  unit: z.string().trim().min(1),
  unit_price_cents: z.number().int().positive(),
  pricing_mode: CatalogPricingModeSchema.default("fixed"),
  estimated_hours_thousandths: z.number().int().nonnegative().default(0),
  materials_cents: z.number().int().nonnegative().default(0),
  default_vat_rate: QuoteVatRateSchema,
  active: z.union([z.literal(0), z.literal(1)]),
  created_at_ms: z.number().int().nonnegative(),
  updated_at_ms: z.number().int().nonnegative(),
});

export const JobRowSchema = z.object({
  id: z.string().min(1),
  job_code: z.string().min(1),
  client_id: z.string().min(1).nullable(),
  title: z.string().trim().min(1),
  address: z.string(),
  status: JobStatusSchema,
  start_date_iso: IsoDateSchema.nullable().optional().default(null),
  end_date_iso: IsoDateSchema.nullable().optional().default(null),
  created_at_iso: IsoDateSchema,
  created_at_ms: z.number().int().nonnegative(),
  updated_at_ms: z.number().int().nonnegative(),
});

export const QuoteRowSchema = z.object({
  id: z.string().min(1),
  quote_code: z.string().min(1),
  job_id: z.string().min(1),
  client_id: z.string().min(1).nullable(),
  client_name_snapshot: z.string(),
  client_nif_snapshot: z.string(),
  client_address_snapshot: z.string(),
  client_phone_snapshot: z.string(),
  vat_rate: QuoteVatRateSchema,
  subtotal_cents: z.number().int().nonnegative(),
  vat_cents: z.number().int().nonnegative(),
  total_cents: z.number().int().nonnegative(),
  status: QuoteStatusSchema,
  validity_days: QuoteValidityDaysSchema.nullable().optional().default(null),
  payment_methods_json: z.string().optional().default("[]"),
  payment_schedule_json: z.string().optional().default("[]"),
  notes: z.string(),
  pdf_uri: z.string().nullable(),
  sent_at_iso: IsoDateSchema.nullable(),
  created_at_ms: z.number().int().nonnegative(),
  updated_at_ms: z.number().int().nonnegative(),
});

export const QuoteItemRowSchema = z.object({
  id: z.string().min(1),
  quote_id: z.string().min(1),
  line_order: z.number().int().nonnegative(),
  catalog_item_id: z.string().min(1).nullable(),
  description: z.string().trim().min(1),
  category: CatalogCategorySchema,
  unit: z.string().trim().min(1),
  quantity_thousandths: z.number().int().positive(),
  unit_price_cents: z.number().int().positive(),
  line_subtotal_cents: z.number().int().nonnegative(),
});

export const InvoiceRowSchema = z.object({
  id: z.string().min(1),
  invoice_number: z.string().min(1),
  series_type: z.enum(["ANT", "FAC"]),
  fiscal_year: z.number().int().min(2020).max(2100),
  kind: InvoiceKindSchema,
  job_id: z.string().min(1),
  quote_id: z.string().min(1),
  client_id: z.string().min(1),
  emitter_nif_snapshot: z.string().min(5),
  emitter_name_snapshot: z.string(),
  emitter_address_snapshot: z.string(),
  client_name_snapshot: z.string().trim().min(1),
  client_nif_snapshot: z.string().min(5),
  client_address_snapshot: z.string().min(5),
  client_phone_snapshot: z.string(),
  issued_at_iso: IsoDateSchema,
  due_at_iso: IsoDateSchema,
  quarter: FiscalQuarterSchema,
  paid_at_iso: IsoDateSchema.nullable(),
  paid_quarter: FiscalQuarterSchema.nullable(),
  sent_at_iso: IsoDateSchema.nullable(),
  vat_rate: QuoteVatRateSchema,
  base_cents: z.number().int().nonnegative(),
  vat_cents: z.number().int().nonnegative(),
  total_cents: z.number().int().nonnegative(),
  advance_deducted_base_cents: z.number().int().nonnegative(),
  advance_deducted_vat_cents: z.number().int().nonnegative(),
  advance_invoice_id: z.string().min(1).nullable(),
  status: InvoiceStatusSchema,
  notes: z.string(),
  pdf_uri: z.string().nullable(),
  created_at_ms: z.number().int().nonnegative(),
  updated_at_ms: z.number().int().nonnegative(),
});

export const ExpenseTicketRowSchema = z.object({
  id: z.string().min(1),
  job_id: z.string().min(1).nullable(),
  supplier_name: z.string().trim().min(1),
  supplier_nif: z.string(),
  issue_date_iso: IsoDateSchema,
  quarter: FiscalQuarterSchema,
  category: z.string().trim().min(1),
  vat_rate_label: z.enum(["0", "4", "10", "21", "mixed"]),
  base_cents: z.number().int().nonnegative(),
  vat_cents: z.number().int().nonnegative(),
  total_cents: z.number().int().positive(),
  ocr_confidence: z.number().min(0).max(100),
  image_uri: z.string().nullable(),
  created_at_ms: z.number().int().nonnegative(),
  updated_at_ms: z.number().int().nonnegative(),
});

export const SiteLogRowSchema = z.object({
  id: z.string().min(1),
  job_id: z.string().min(1),
  category: SiteLogCategorySchema,
  note_text: z.string(),
  photo_uri: z.string().nullable(),
  stamp_job_code: z.string().min(1),
  stamp_client_name: z.string(),
  created_at_iso: IsoDateSchema,
  created_at_ms: z.number().int().nonnegative(),
});

export const FeedbackCorrectionRowSchema = z.object({
  id: z.string().min(1),
  catalog_item_id: z.string().min(1),
  quote_id: z.string().min(1).nullable(),
  old_unit_price_cents: z.number().int().nonnegative(),
  new_unit_price_cents: z.number().int().positive(),
  created_at_ms: z.number().int().nonnegative(),
});

export const TaxObligationStateRowSchema = z.object({
  obligation_key: z.string().min(1),
  model_code: TaxModelCodeSchema,
  fiscal_year: z.number().int().min(2020).max(2100),
  period_code: z.string().min(1),
  status: TaxObligationStatusSchema,
  presented_at_iso: IsoDateSchema.nullable(),
  notes: z.string(),
  updated_at_ms: z.number().int().nonnegative(),
});

export const TaxAlertDismissalRowSchema = z.object({
  alert_key: z.string().min(1),
  dismissed_at_ms: z.number().int().nonnegative(),
});

export const CircuitoElectricoSchema = z.object({
  nombre: z.string().max(TEXT_LIMITS.SHORT_LABEL),
  calibre_a: z.number().nonnegative(),
  seccion_mm2: z.number().nonnegative(),
});

export const FotoAnexoActaSchema = z.object({
  id: z.string().min(1),
  uri: z.string().min(1).max(1024),
  pie_foto: z.string().max(TEXT_LIMITS.SHORT_LABEL),
  timestamp: z.string().min(1),
});

export const MemoriaElectricidadActaSchema = z.object({
  tension_nominal: z.enum(["230V Monofásica", "400V Trifásica"]),
  iga_amperios: z.number().nonnegative(),
  protector_sobretensiones: z.boolean(),
  diferencial_calibre: z.string().max(TEXT_LIMITS.SHORT_LABEL),
  circuitos: z.array(CircuitoElectricoSchema),
  receptores_conectados: z.string().max(TEXT_LIMITS.DESCRIPTION),
});

export const MemoriaFontaneriaActaSchema = z.object({
  redes_intervenidas: z.array(RedFontaneriaSchema),
  material_tuberias: z.string().max(TEXT_LIMITS.TITLE),
  diametros_mm: z.string().max(TEXT_LIMITS.TITLE),
  ubicacion_llaves_corte: z.string().max(TEXT_LIMITS.DESCRIPTION),
  equipos_sanitarios: z.string().max(TEXT_LIMITS.DESCRIPTION),
});

export const PruebasElectricidadActaSchema = z.object({
  inspeccion_visual_bornes_etiquetado: z.boolean(),
  continuidad_proteccion_equipotencial: z.boolean(),
  resistencia_aislamiento_mohm: z.number().nonnegative().nullable(),
  resistencia_tierra_ohm: z.number().nonnegative().nullable(),
  disparo_diferencial_ms: z.number().nonnegative().nullable(),
  tension_comprobada_v: z.number().nonnegative().nullable(),
  resultado_apto: z.boolean(),
});

export const PruebasFontaneriaActaSchema = z.object({
  presion_prueba_bar: z.number().nonnegative().nullable(),
  duracion_prueba_min: z.number().nonnegative().nullable(),
  estanqueidad_sin_fugas: z.boolean(),
  presion_servicio_bar: z.number().nonnegative().nullable(),
  comprobacion_desagues_valvulas: z.boolean(),
  temperatura_consigna_acs_c: z.number().nonnegative().nullable().optional(),
  resultado_apto: z.boolean(),
});

export const ActaPuestaEnMarchaDataSchema = z.object({
  titulo_documento: z.string().max(TEXT_LIMITS.TITLE),
  codigo_acta: z.string().min(1).max(40),
  fecha_emision: IsoDateSchema,
  especialidad: EspecialidadActaSchema,
  tipo_actuacion: TipoActuacionActaSchema,
  alcance_ubicacion: z.string().max(TEXT_LIMITS.DESCRIPTION),
  instalador: z.object({
    nombre_razon_social: z.string().max(TEXT_LIMITS.NAME),
    nif_cif: z.string().max(TEXT_LIMITS.TAX_ID),
    domicilio_fiscal: z.string().max(TEXT_LIMITS.ADDRESS),
    telefono: z.string().max(TEXT_LIMITS.PHONE),
    email: z.string().max(TEXT_LIMITS.EMAIL),
    num_registro_empresa: z.string().max(TEXT_LIMITS.SHORT_LABEL).optional(),
    tecnico_nombre: z.string().max(TEXT_LIMITS.NAME),
    tecnico_dni: z.string().max(TEXT_LIMITS.TAX_ID),
    num_carne_instalador: z.string().max(TEXT_LIMITS.SHORT_LABEL).optional(),
  }),
  cliente: z.object({
    nombre_razon_social: z.string().max(TEXT_LIMITS.NAME),
    nif_cif: z.string().max(TEXT_LIMITS.TAX_ID),
    direccion_emplazamiento: z.string().max(TEXT_LIMITS.ADDRESS),
    telefono: z.string().max(TEXT_LIMITS.PHONE).optional(),
    email: z.string().max(TEXT_LIMITS.EMAIL).optional(),
  }),
  memoria_electricidad: MemoriaElectricidadActaSchema.optional(),
  memoria_fontaneria: MemoriaFontaneriaActaSchema.optional(),
  pruebas_electricidad: PruebasElectricidadActaSchema.optional(),
  pruebas_fontaneria: PruebasFontaneriaActaSchema.optional(),
  fotos: z.array(FotoAnexoActaSchema).max(4),
  instrucciones_mantenimiento: z.string().max(TEXT_LIMITS.NOTES),
  plazo_garantia_meses: z.number().int().min(1).max(120),
  clausula_conformidad: z.string().max(TEXT_LIMITS.NOTES),
  clausula_recepcion_cliente: z.string().max(TEXT_LIMITS.NOTES),
});

export const ActaRowSchema = z.object({
  id: z.string().min(1),
  codigo_acta: z.string().min(1),
  job_id: z.string().min(1).nullable(),
  quote_id: z.string().min(1).nullable(),
  client_id: z.string().min(1).nullable(),
  especialidad: EspecialidadActaSchema,
  tipo_actuacion: TipoActuacionActaSchema,
  estado: EstadoActaSchema,
  fecha_emision_iso: IsoDateSchema,
  datos_json: z.string().min(2),
  firma_cliente_base64: z.string().nullable(),
  firma_instalador_base64: z.string().nullable(),
  pdf_uri: z.string().nullable(),
  created_at_ms: z.number().int().nonnegative(),
  updated_at_ms: z.number().int().nonnegative(),
});

export const SymmetricBackupPlaintextSchema = z.object({
  app_settings_emitter: EmitterProfileInputSchema,
  app_settings_installer_acta: InstallerActaProfileInputSchema.optional(),
  app_settings_tax: TaxSettingsInputSchema.optional(),
  app_settings_pricing: PricingSettingsInputSchema.optional(),
  app_settings_quote_defaults: QuoteDefaultsInputSchema.optional(),
  app_settings_tax_models: z.array(TaxModelCodeSchema).optional(),
  work_schedule_defaults: WorkScheduleDefaultsSchema.optional(),
  sequences: z.array(SequenceRowSchema),
  clients: z.array(ClientRowSchema),
  catalog_items: z.array(CatalogItemRowSchema),
  jobs: z.array(JobRowSchema),
  quotes: z.array(QuoteRowSchema),
  quote_items: z.array(QuoteItemRowSchema),
  invoices: z.array(InvoiceRowSchema),
  expense_tickets: z.array(ExpenseTicketRowSchema),
  site_logs: z.array(SiteLogRowSchema),
  feedback_corrections: z.array(FeedbackCorrectionRowSchema),
  schedule_entries: z.array(ScheduleEntryRowSchema).optional(),
  tax_obligation_states: z.array(TaxObligationStateRowSchema).optional(),
  tax_alert_dismissals: z.array(TaxAlertDismissalRowSchema).optional(),
  actas_puesta_en_marcha: z.array(ActaRowSchema).optional(),
});

export const SymmetricBackupEnvelopeSchema = z.discriminatedUnion("encrypted", [
  z.object({
    version: z.literal("1.0.0"),
    format: z.literal("obralocal-backup-v1"),
    encrypted: z.literal(true),
    kdf: z.literal("PBKDF2-SHA256"),
    cipher: z.literal("AES-256-GCM"),
    iterations: z.literal(210000),
    salt_b64: z.string().min(1),
    iv_b64: z.string().min(1),
    ciphertext_b64: z.string().min(1),
  }),
  z.object({
    version: z.literal("1.0.0"),
    format: z.literal("obralocal-backup-v1"),
    encrypted: z.literal(false),
    kdf: z.null(),
    cipher: z.null(),
    iterations: z.null(),
    salt_b64: z.null(),
    iv_b64: z.null(),
    payload: SymmetricBackupPlaintextSchema,
  }),
]);
