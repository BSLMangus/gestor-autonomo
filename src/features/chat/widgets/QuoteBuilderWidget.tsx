import { ChevronDown, ChevronUp, Eye, Info, Paperclip, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  patchQuoteDraftByVoice,
  type QuoteBuilderFormState,
  type VoiceDisambiguationPayload,
} from "../../../agent/voiceFormPatcher";
import {
  Gate1QuoteCommitPayloadSchema,
} from "../../../core/contracts/schemas";
import { TEXT_LIMITS } from "../../../core/contracts/textLimits";
import { useRegisterOverlayVoice } from "../../../ui/overlayVoiceContext";
import { ZoomableTextField } from "../../../ui/ZoomableTextField";
import type {
  ActiveWidgetEnvelope,
  AppSettingsRecord,
  BillingMode,
  BillingModeConfig,
  CatalogCategory,
  CatalogItemRow,
  ClientRow,
  Gate1QuoteDraftPayload,
  LaborOnlySubMode,
  QuoteAttachment,
  QuoteDurationUnit,
  QuoteVatRate,
} from "../../../core/contracts/types";
import { CatalogRepository } from "../../../core/db/repositories/catalogRepo";
import { ClientsRepository } from "../../../core/db/repositories/clientsRepo";
import { SettingsRepository } from "../../../core/db/repositories/settingsRepo";
import { getLocalTodayIso } from "../../../core/fiscal/dateQuarter";
import {
  computeLineSubtotalCents,
  computeQuoteTotalsByBillingMode,
  computeQuoteValidUntilIso,
  formatCentsEs,
} from "../../../core/fiscal/fiscalEngine";
import type { PdfQuoteDocumentInput } from "../../../core/ports/mediaPorts";
import { formatPricingBreakdown } from "../../../core/pricing/pricingEngine";
import { sanitizeQuoteItemDescription } from "../../../core/text/quoteDescriptionSanitizer";
import { normalizeSpanishText } from "../../../core/text/spanishText";
import { BillingModeSelector } from "../../jobs/BillingModeSelector";
import {
  centsToInitialPriceText,
  eurInputToCents,
  formatPriceInputOnBlur,
  sanitizeDecimalPriceInput,
  shouldClearPriceOnFocus,
} from "./priceInputUtils";
import {
  extractQuoteAttachment,
  formatAttachmentSummaryForNotes,
} from "../../quotes/quoteAttachmentExtractor";
import {
  isScheduleSumValid,
  QuotePaymentValidityEditor,
} from "../../quotes/QuotePaymentValidityEditor";
import type { WidgetCommonProps } from "./widgetTypes";

type QuoteWidget = Extract<ActiveWidgetEnvelope, { ui_widget_type: "QuoteBuilderWidget" }>;

const CATEGORIES: CatalogCategory[] = [
  "Fontanería",
  "Electricidad",
  "Albañilería",
  "Pintura",
  "General",
];

function stripComputedTotals(payload: QuoteWidget["widget_payload"]): Gate1QuoteDraftPayload {
  const { subtotal_cents: _s, vat_cents: _v, total_cents: _t, ...draft } = payload;
  return draft;
}

function thousandthsToQtyInput(t: number): string {
  return String(t / 1000);
}

function qtyInputToThousandths(raw: string): number {
  const normalized = raw.replace(",", ".").trim();
  const val = Number.parseFloat(normalized);
  if (!Number.isFinite(val) || val < 0) return 0;
  return Math.round(val * 1000);
}

function PriceInput({
  valueCents,
  disabled,
  testId,
  ariaLabel,
  onChangeCents,
}: {
  valueCents: number;
  disabled: boolean;
  testId: string;
  ariaLabel: string;
  onChangeCents: (cents: number) => void;
}) {
  const [text, setText] = useState<string>(() => centsToInitialPriceText(valueCents));
  const isFocusedRef = useRef(false);

  useEffect(() => {
    if (isFocusedRef.current) return;
    if (valueCents === 0) {
      if (eurInputToCents(text) !== 0) {
        setText("");
      }
      return;
    }
    if (eurInputToCents(text) !== valueCents || text.trim() === "") {
      setText((valueCents / 100).toFixed(2));
    }
  }, [valueCents, text]);

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      placeholder="0.00"
      data-testid={testId}
      aria-label={ariaLabel}
      disabled={disabled}
      value={text}
      onFocus={() => {
        isFocusedRef.current = true;
        if (shouldClearPriceOnFocus(text)) {
          setText("");
        }
      }}
      onChange={(e) => {
        const cleaned = sanitizeDecimalPriceInput(e.target.value);
        setText(cleaned);
        onChangeCents(eurInputToCents(cleaned));
      }}
      onBlur={() => {
        isFocusedRef.current = false;
        const { display, cents } = formatPriceInputOnBlur(text);
        setText(display);
        onChangeCents(cents);
      }}
      className="min-w-0 w-full rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] px-2 py-1 text-xs font-mono-nums tabular-nums text-[#2C2621] disabled:bg-[#F5F1E6]"
    />
  );
}

export function QuoteBuilderWidget({
  widget,
  isActiveGate,
  activePendingGate,
  isSubmitting,
  runtime,
  onResumeDecision,
}: WidgetCommonProps) {
  const quoteWidget = widget as QuoteWidget;
  const initialDraft = useMemo(
    () => stripComputedTotals(quoteWidget.widget_payload),
    [quoteWidget]
  );
  const initialJson = useMemo(() => JSON.stringify(initialDraft), [initialDraft]);

  const [draft, setDraft] = useState<Gate1QuoteDraftPayload>(initialDraft);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogItemRow[]>([]);
  const [hourlyRateCents, setHourlyRateCents] = useState(3800);
  const [defaultSettings, setDefaultSettings] = useState<AppSettingsRecord | null>(null);
  const [showCatalogPicker, setShowCatalogPicker] = useState(false);
  const [showDocumentConditions, setShowDocumentConditions] = useState(false);
  const [showPaymentOptions, setShowPaymentOptions] = useState(false);
  const [extractingAttachment, setExtractingAttachment] = useState(false);
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const [catalogFilter, setCatalogFilter] = useState("");
  const [useNewClient, setUseNewClient] = useState<boolean>(
    Boolean(initialDraft.new_client && !initialDraft.client_id)
  );
  const [clientSelectorMode, setClientSelectorMode] = useState<"none" | "existing" | "new">(
    initialDraft.new_client && !initialDraft.client_id
      ? "new"
      : initialDraft.client_id
        ? "existing"
        : "none"
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const [voiceUndoStack, setVoiceUndoStack] = useState<QuoteBuilderFormState[]>([]);
  const [voiceChanges, setVoiceChanges] = useState<string[]>([]);
  const [voiceWarnings, setVoiceWarnings] = useState<string[]>([]);
  const [voiceDisambig, setVoiceDisambig] = useState<VoiceDisambiguationPayload | null>(null);

  useEffect(() => {
    setDraft(initialDraft);
    const nextNew = Boolean(initialDraft.new_client && !initialDraft.client_id);
    setUseNewClient(nextNew);
    setClientSelectorMode(nextNew ? "new" : initialDraft.client_id ? "existing" : "none");
    setValidationError(null);
    setShowCatalogPicker(false);
    setAttachmentNotice(null);
    setCatalogFilter("");
    setVoiceUndoStack([]);
    setVoiceChanges([]);
    setVoiceWarnings([]);
    setVoiceDisambig(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJson]);

  useEffect(() => {
    let active = true;
    Promise.all([
      new ClientsRepository(runtime.executor).listPaginated({ limit: 100, offset: 0 }),
      new CatalogRepository(runtime.executor).listPaginated({ limit: 100, offset: 0 }),
      new SettingsRepository(runtime.executor).getAppSettings(),
    ])
      .then(([clRes, catRes, settingsRes]) => {
        if (!active) return;
        setClients(clRes.items);
        setCatalogItems(catRes.items);
        setHourlyRateCents(settingsRes.hourly_rate_cents);
        setDefaultSettings(settingsRes);
      })
      .catch(() => {
        // ignore secondary load error
      });
    return () => {
      active = false;
    };
  }, [runtime.executor]);

  const canAct = isActiveGate && activePendingGate === "gate_1_quote";

  useRegisterOverlayVoice({
    enabled: canAct && !isSubmitting,
    title: "Dictar datos del presupuesto",
    placeholder: "Ej: Para Marta, añade 1 plato de ducha y cambia el IVA al 10%",
    examples: [
      "Para Marta Ruiz, título Reforma de baño",
      "Añade 1 plato de ducha y 12 m2 de alicatado",
      "Cambia el IVA al 10 % y añade en notas garantía 2 años",
    ],
    buttonLabel: "Dictar presupuesto",
    lastChanges: voiceChanges,
    lastWarnings: voiceWarnings,
    canUndo: voiceUndoStack.length > 0,
    onUndo: () => {
      const prev = voiceUndoStack[voiceUndoStack.length - 1];
      if (!prev) return;
      setVoiceUndoStack((s) => s.slice(0, -1));
      setDraft(prev.draft);
      setUseNewClient(prev.useNewClient);
      setClientSelectorMode(prev.useNewClient ? "new" : prev.draft.client_id ? "existing" : "none");
      setVoiceChanges(["Último dictado deshecho"]);
      setVoiceWarnings([]);
      setVoiceDisambig(null);
    },
    disambiguation: voiceDisambig
      ? {
          prompt: voiceDisambig.prompt,
          options: voiceDisambig.options,
          onSelect: (id) => {
            const snapshot: QuoteBuilderFormState = { draft, useNewClient };
            setVoiceUndoStack((s) => [...s.slice(-9), snapshot]);
            const cl = clients.find((c) => c.id === id);
            setUseNewClient(false);
            setClientSelectorMode("existing");
            setDraft((prev) => ({
              ...prev,
              client_id: id,
              new_client: undefined,
              job_title: prev.job_title.trim()
                ? prev.job_title
                : cl
                  ? `Presupuesto trabajos ${cl.name}`
                  : prev.job_title,
            }));
            setVoiceChanges([cl ? `Cliente: ${cl.name}` : "Cliente seleccionado"]);
            setVoiceWarnings([]);
            setVoiceDisambig(null);
          },
          onDismiss: () => setVoiceDisambig(null),
        }
      : null,
    onTranscript: async (text) => {
      const snapshot: QuoteBuilderFormState = { draft, useNewClient };
      const res = await patchQuoteDraftByVoice(snapshot, text, {
        executor: runtime.executor,
        inferenceAdapter: runtime.inferenceAdapter,
      });
      if (res.changed) {
        setVoiceUndoStack((s) => [...s.slice(-9), snapshot]);
        setDraft(res.nextState.draft);
        setUseNewClient(res.nextState.useNewClient);
        setClientSelectorMode(
          res.nextState.useNewClient ? "new" : res.nextState.draft.client_id ? "existing" : "none"
        );
        setVoiceChanges(res.appliedChanges);
        setVoiceWarnings(res.warnings);
      } else if (!res.disambiguation) {
        setVoiceChanges([]);
        setVoiceWarnings([
          "No detecté cambios claros. Prueba: «Añade 1 plato de ducha» o «IVA al 10 %».",
        ]);
      }
      setVoiceDisambig(res.disambiguation ?? null);
    },
  });
  const billingMode: BillingMode = draft.modalidad_cobro ?? "solo_partidas";
  const laborSubMode: LaborOnlySubMode = draft.solo_mano_obra_submodo ?? "por_horas";
  const laborHoursThousandths = draft.horas_estimadas_thousandths ?? 0;
  const effectiveHourlyRateCents = draft.tarifa_hora_cents ?? hourlyRateCents;
  const fixedLaborCents = draft.mano_obra_fija_cents ?? 0;
  const isLaborOnly = billingMode === "solo_mano_obra";

  const billingConfig: BillingModeConfig = {
    modalidad_cobro: billingMode,
    solo_mano_obra_submodo: laborSubMode,
    horas_estimadas_thousandths: laborHoursThousandths,
    tarifa_hora_cents:
      draft.tarifa_hora_cents !== undefined ? draft.tarifa_hora_cents : hourlyRateCents,
    mano_obra_fija_cents: fixedLaborCents,
  };

  const totals = useMemo(() => {
    const summary = computeQuoteTotalsByBillingMode({
      billingMode,
      laborSubMode,
      lines: draft.lines,
      vatRate: draft.vat_rate,
      horasEstimadasThousandths: laborHoursThousandths,
      tarifaHoraCents: effectiveHourlyRateCents,
      manoObraFijaCents: fixedLaborCents,
    });
    const lineSubtotals = draft.lines.map((line) =>
      billingMode === "solo_mano_obra"
        ? 0
        : computeLineSubtotalCents(line.quantity_thousandths, line.unit_price_cents)
    );
    return {
      ...summary,
      lineSubtotals,
    };
  }, [
    billingMode,
    laborSubMode,
    draft.lines,
    draft.vat_rate,
    laborHoursThousandths,
    effectiveHourlyRateCents,
    fixedLaborCents,
  ]);

  const hasEmbeddedHoursCatalogItem = useMemo(() => {
    if (billingMode !== "partidas_mas_horas") return false;
    return draft.lines.some((line) => {
      if (!line.catalog_item_id) return false;
      const item = catalogItems.find((ci) => ci.id === line.catalog_item_id);
      return Boolean(
        item &&
          (item.pricing_mode === "hourly_plus_materials" || item.estimated_hours_thousandths > 0)
      );
    });
  }, [billingMode, draft.lines, catalogItems]);

  const isDirty = useMemo(() => JSON.stringify(draft) !== initialJson, [draft, initialJson]);

  const updateLine = (
    idx: number,
    patch: Partial<Gate1QuoteDraftPayload["lines"][number]>
  ) => {
    setDraft((prev) => ({
      ...prev,
      lines: prev.lines.map((line, i) => (i === idx ? { ...line, ...patch } : line)),
    }));
  };

  const sanitizeLineDescription = (idx: number) => {
    setDraft((prev) => ({
      ...prev,
      lines: prev.lines.map((line, i) => {
        if (i !== idx) return line;
        const cleaned = sanitizeQuoteItemDescription(line.description, {
          knownPricesCents: line.unit_price_cents > 0 ? [line.unit_price_cents] : [],
        });
        return cleaned !== line.description ? { ...line, description: cleaned } : line;
      }),
    }));
  };

  const addEmptyLine = () => {
    setDraft((prev) => ({
      ...prev,
      lines: [
        ...prev.lines,
        {
          catalog_item_id: null,
          description: "",
          category: "General",
          unit: "ud",
          quantity_thousandths: 1000,
          unit_price_cents: 0,
          original_unit_price_cents: 0,
          save_to_catalog: false,
        },
      ],
    }));
  };

  const removeLine = (idx: number) => {
    setDraft((prev) => ({
      ...prev,
      lines: prev.lines.filter((_, i) => i !== idx),
    }));
  };

  const addLineFromCatalog = (item: CatalogItemRow) => {
    const cleanDesc = sanitizeQuoteItemDescription(item.description, {
      knownPricesCents: [item.unit_price_cents],
    });
    const newLine: Gate1QuoteDraftPayload["lines"][number] = {
      catalog_item_id: item.id,
      description: cleanDesc || item.description,
      category: item.category,
      unit: item.unit,
      quantity_thousandths: 1000,
      unit_price_cents: item.unit_price_cents,
      original_unit_price_cents: item.unit_price_cents,
      save_to_catalog: false,
    };
    setDraft((prev) => {
      const onlyPlaceholder =
        prev.lines.length === 1 &&
        !prev.lines[0]!.description.trim() &&
        prev.lines[0]!.unit_price_cents === 0;
      return {
        ...prev,
        lines: onlyPlaceholder ? [newLine] : [...prev.lines, newLine],
      };
    });
    setShowCatalogPicker(false);
    setCatalogFilter("");
  };

  const filteredCatalog = useMemo(() => {
    const q = normalizeSpanishText(catalogFilter);
    if (!q) return catalogItems;
    return catalogItems.filter((c) =>
      normalizeSpanishText(`${c.description} ${c.category}`).includes(q)
    );
  }, [catalogItems, catalogFilter]);

  const effectiveGeneralDescription = draft.general_description ?? "";
  const effectiveDurationValue = draft.estimated_duration_value ?? null;
  const effectiveDurationUnit: QuoteDurationUnit =
    draft.estimated_duration_unit ?? "dias_laborables";
  const effectiveValidityDays =
    draft.validity_days ?? defaultSettings?.default_quote_validity_days ?? 30;
  const effectivePaymentMethods =
    draft.payment_methods ?? defaultSettings?.default_payment_methods ?? ["transferencia"];
  const effectivePaymentSchedule =
    draft.payment_schedule ?? defaultSettings?.default_payment_schedule ?? [];
  const effectivePaymentTermsText = draft.payment_terms_text ?? "";
  const effectiveIban =
    draft.iban_override !== undefined
      ? draft.iban_override
      : (defaultSettings?.emitter_iban ?? "");
  const effectiveBankName =
    draft.bank_name !== undefined
      ? draft.bank_name
      : (defaultSettings?.emitter_bank_name ?? "");
  const effectiveShowIban =
    draft.show_iban !== undefined ? draft.show_iban : Boolean(effectiveIban.trim());
  const effectiveAttachments: QuoteAttachment[] = draft.attachments ?? [];

  const handleAttachDocument = async (file: File | undefined) => {
    if (!file) return;
    setAttachmentNotice(null);
    setExtractingAttachment(true);
    try {
      const extracted = await extractQuoteAttachment(file);
      const nextAttachment: QuoteAttachment = {
        name: extracted.name,
        mimeType: extracted.mimeType,
        ...(extracted.extractedText ? { extractedText: extracted.extractedText } : {}),
      };
      setDraft((prev) => {
        const currentAttachments = prev.attachments ?? [];
        const updatedAttachments = [...currentAttachments, nextAttachment].slice(0, 10);
        let nextNotes = prev.notes;
        if (extracted.extractedText) {
          const formatted = formatAttachmentSummaryForNotes(nextAttachment);
          const joined = prev.notes.trim() ? `${prev.notes.trimEnd()}\n\n${formatted}` : formatted;
          nextNotes = joined.slice(0, TEXT_LIMITS.NOTES);
        }
        return {
          ...prev,
          attachments: updatedAttachments,
          notes: nextNotes,
        };
      });
      if (extracted.warning) {
        setAttachmentNotice(extracted.warning);
      } else if (extracted.extractedText) {
        setAttachmentNotice(
          `Texto extraído de «${extracted.name}» incorporado a las notas técnicas.`
        );
      } else {
        setAttachmentNotice(`Documento «${extracted.name}» adjuntado como referencia.`);
      }
    } catch (err) {
      setAttachmentNotice(
        `Error al leer el documento: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setExtractingAttachment(false);
    }
  };

  const handleRemoveAttachment = (idx: number) => {
    setDraft((prev) => ({
      ...prev,
      attachments: (prev.attachments ?? []).filter((_, i) => i !== idx),
    }));
  };

  const getSanitizedLines = () =>
    draft.lines.map((line) => {
      const cleaned = sanitizeQuoteItemDescription(line.description, {
        knownPricesCents: line.unit_price_cents > 0 ? [line.unit_price_cents] : [],
      });
      return {
        ...line,
        description: cleaned.trim() || line.description.trim(),
        save_to_catalog: isLaborOnly ? false : line.save_to_catalog,
      };
    });

  const handleOpenPreview = () => {
    if (!runtime.onOpenDocumentPreview) return;
    setValidationError(null);
    const sanitizedLines = getSanitizedLines();
    const nowMs = Date.now();
    const selectedClient = draft.client_id
      ? clients.find((c) => c.id === draft.client_id) ?? null
      : null;

    const previewInput: PdfQuoteDocumentInput = {
      kind: "quote",
      quoteCode: "BORRADOR",
      issuedDateIso: getLocalTodayIso(),
      validityDays: effectiveValidityDays,
      validUntilIso: computeQuoteValidUntilIso(nowMs, effectiveValidityDays),
      emitter: {
        name: defaultSettings?.emitter_name || "Autónomo",
        nif: defaultSettings?.emitter_nif ?? "",
        fiscalAddress: defaultSettings?.emitter_fiscal_address ?? "",
        phone: defaultSettings?.emitter_phone ?? "",
        email: defaultSettings?.emitter_email ?? "",
        iban: effectiveIban,
        bankName: effectiveBankName,
        logoDataUrl: defaultSettings?.emitter_logo_data_url ?? null,
      },
      client: selectedClient
        ? {
            name: selectedClient.name,
            nif: selectedClient.nif,
            fiscalAddress: selectedClient.fiscal_address,
            phone: selectedClient.phone,
            email: selectedClient.email,
          }
        : {
            name: draft.new_client?.name?.trim() ?? "",
            nif: draft.new_client?.nif?.trim().toUpperCase() ?? "",
            fiscalAddress: draft.new_client?.fiscal_address?.trim() ?? "",
            phone: draft.new_client?.phone?.trim() ?? "",
            email: draft.new_client?.email?.trim() ?? "",
          },
      jobTitle:
        draft.job_title.trim() || sanitizedLines[0]?.description || "Borrador de presupuesto",
      generalDescription: effectiveGeneralDescription,
      estimatedDurationValue: effectiveDurationValue,
      estimatedDurationUnit: effectiveDurationUnit,
      vatRate: draft.vat_rate,
      billingMode,
      laborSubMode,
      laborHoursThousandths,
      hourlyRateCents: effectiveHourlyRateCents,
      laborCents: totals.laborCents,
      itemsSubtotalCents: totals.itemsSubtotalCents,
      subtotalCents: totals.subtotalCents,
      vatCents: totals.vatCents,
      totalCents: totals.totalCents,
      paymentMethods: effectivePaymentMethods,
      paymentSchedule: effectivePaymentSchedule,
      paymentTermsText: effectivePaymentTermsText,
      ibanOverride: effectiveIban,
      bankName: effectiveBankName,
      showIban: effectiveShowIban,
      notes: draft.notes,
      attachments: effectiveAttachments,
      lines: sanitizedLines.map((line, i) => ({
        description: line.description || `Partida ${i + 1}`,
        unit: line.unit,
        quantityThousandths: line.quantity_thousandths,
        unitPriceCents: line.unit_price_cents,
        lineSubtotalCents: totals.lineSubtotals[i] ?? 0,
      })),
    };

    runtime.onOpenDocumentPreview({
      docKind: "quote",
      title: "Vista previa de presupuesto",
      subtitle: draft.job_title.trim() || "Borrador sin guardar",
      isDraft: true,
      loadBytes: () => runtime.pdfPort.buildDocumentPdf(previewInput),
      onDownloadOrShare: (bytes, fileName) =>
        runtime.documentOpener.shareRawPdfBytes(bytes, fileName, "Borrador de presupuesto"),
    });
  };

  const handleConfirm = async () => {
    setValidationError(null);
    if (!isScheduleSumValid(effectivePaymentSchedule)) {
      setValidationError("Los porcentajes de forma de cobro deben sumar exactamente 100 %.");
      return;
    }
    const sanitizedLines = getSanitizedLines();
    const candidatePayload = {
      ...draft,
      lines: sanitizedLines,
      modalidad_cobro: billingMode,
      solo_mano_obra_submodo: laborSubMode,
      horas_estimadas_thousandths: laborHoursThousandths,
      tarifa_hora_cents: effectiveHourlyRateCents,
      mano_obra_fija_cents: fixedLaborCents,
      general_description: effectiveGeneralDescription,
      estimated_duration_value: effectiveDurationValue,
      estimated_duration_unit: effectiveDurationUnit,
      validity_days: effectiveValidityDays,
      payment_methods: effectivePaymentMethods,
      payment_schedule: effectivePaymentSchedule,
      payment_terms_text: effectivePaymentTermsText,
      iban_override: effectiveIban,
      bank_name: effectiveBankName,
      show_iban: effectiveShowIban,
      attachments: effectiveAttachments,
    };
    const parsed = Gate1QuoteCommitPayloadSchema.safeParse(candidatePayload);
    if (!parsed.success) {
      setValidationError(
        parsed.error.issues.map((iss) => iss.message).join(" · ")
      );
      return;
    }

    if (isDirty) {
      await onResumeDecision({
        gate_id: "gate_1_quote",
        action: "edit",
        edited_payload: parsed.data,
        client_validated_at_ms: Date.now(),
      });
    } else {
      await onResumeDecision({
        gate_id: "gate_1_quote",
        action: "approve",
        client_validated_at_ms: Date.now(),
      });
    }
  };

  const handleReject = async () => {
    setValidationError(null);
    await onResumeDecision({
      gate_id: "gate_1_quote",
      action: "reject",
      rejection_reason: "Rechazado por el usuario",
      client_validated_at_ms: Date.now(),
    });
  };

  return (
    <section
      data-testid="quote-builder-widget"
      className="mt-1 w-full max-w-full overflow-x-hidden paper-sheet rounded-2xl border border-[#E5DFD2] bg-[#FFFDF7] p-3.5 text-[#2C2621] font-sans"
    >
      <div className="flex items-start justify-between gap-2 border-b border-[#E5DFD2] pb-2.5">
        <div className="min-w-0 flex-1">
          <span className="inline-flex items-center rounded-sm paper-stamp status-tangerine px-2.5 py-0.5 text-[11px] font-semibold">
            {canAct ? "Revisión de presupuesto" : "Presupuesto"}
          </span>
          <h3 className="mt-1.5 break-words [overflow-wrap:anywhere] text-sm font-bold text-[#2C2621]">
            {draft.job_title || "Nuevo presupuesto"}
          </h3>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[11px] text-[#6B6860]">Total c/IVA ({draft.vat_rate} %)</div>
          <div
            data-testid="quote-total-display"
            className="text-base font-extrabold font-mono-nums tabular-nums text-[#2C2621] highlighter-yellow"
          >
            {formatCentsEs(totals.totalCents)}
          </div>
        </div>
      </div>

      <div className="mt-3 space-y-3">
        <BillingModeSelector
          value={billingConfig}
          defaultHourlyRateCents={hourlyRateCents}
          disabled={!canAct || isSubmitting}
          onChange={(nextConfig) =>
            setDraft((prev) => ({
              ...prev,
              modalidad_cobro: nextConfig.modalidad_cobro,
              solo_mano_obra_submodo: nextConfig.solo_mano_obra_submodo,
              horas_estimadas_thousandths: nextConfig.horas_estimadas_thousandths,
              tarifa_hora_cents: nextConfig.tarifa_hora_cents,
              mano_obra_fija_cents: nextConfig.mano_obra_fija_cents,
            }))
          }
        />

        {hasEmbeddedHoursCatalogItem && (
          <div
            data-testid="quote-embedded-hours-hint"
            className="flex items-start gap-2 rounded-xl border border-[#BAE6FD] bg-[#E0F2FE]/65 px-3 py-2 text-[11px] text-[#0369A1]"
          >
            <Info className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              Alguna partida seleccionada del tarifario ya incluye horas estimadas en su precio
              unitario. Revisa las horas globales para evitar duplicar mano de obra.
            </span>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-[#2C2621]" htmlFor="qb-job-title">
            Título de la obra (opcional)
          </label>
          <input
            id="qb-job-title"
            data-testid="quote-job-title-input"
            type="text"
            disabled={!canAct || isSubmitting}
            value={draft.job_title}
            onChange={(e) => setDraft((p) => ({ ...p, job_title: e.target.value }))}
            placeholder="Opcional — se usará la primera partida"
            className="mt-1 w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 text-sm text-[#2C2621] disabled:bg-[#F5F1E6]"
          />
        </div>

        <div className="rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[#2C2621]">Cliente (opcional)</span>
            {canAct && (
              <div className="flex gap-1 text-[11px]">
                <button
                  type="button"
                  data-testid="quote-client-mode-none"
                  onClick={() => {
                    setClientSelectorMode("none");
                    setUseNewClient(false);
                    setDraft((p) => ({ ...p, client_id: null, new_client: undefined }));
                  }}
                  className={`rounded-lg px-2 py-1 font-medium ${
                    clientSelectorMode === "none"
                      ? "bg-[#4B7094] text-[#FFFDF9]"
                      : "bg-[#FFFDF7] text-[#2C2621] border border-[#E5DFD2]"
                  }`}
                >
                  Sin cliente
                </button>
                <button
                  type="button"
                  data-testid="quote-client-mode-existing"
                  onClick={() => {
                    setClientSelectorMode("existing");
                    setUseNewClient(false);
                    setDraft((p) => ({ ...p, new_client: undefined }));
                  }}
                  className={`rounded-lg px-2 py-1 font-medium ${
                    clientSelectorMode === "existing"
                      ? "bg-[#4B7094] text-[#FFFDF9]"
                      : "bg-[#FFFDF7] text-[#2C2621] border border-[#E5DFD2]"
                  }`}
                >
                  Existente
                </button>
                <button
                  type="button"
                  data-testid="quote-client-mode-new"
                  onClick={() => {
                    setClientSelectorMode("new");
                    setUseNewClient(true);
                    setDraft((p) => ({
                      ...p,
                      client_id: null,
                      new_client: p.new_client ?? { name: "", phone: "", nif: "", fiscal_address: "" },
                    }));
                  }}
                  className={`rounded-lg px-2 py-1 font-medium ${
                    clientSelectorMode === "new"
                      ? "bg-[#4B7094] text-[#FFFDF9]"
                      : "bg-[#FFFDF7] text-[#2C2621] border border-[#E5DFD2]"
                  }`}
                >
                  Nuevo cliente
                </button>
              </div>
            )}
          </div>

          {clientSelectorMode === "none" ? (
            <div className="mt-2 rounded-lg border border-dashed border-[#E5DFD2] bg-[#FFFDF7] px-2.5 py-2 text-[11px] text-[#6B6860]">
              Presupuesto simplificado sin datos de cliente (podrás asignar uno más tarde para facturar).
            </div>
          ) : clientSelectorMode === "existing" ? (
            <select
              aria-label="Seleccionar cliente existente"
              data-testid="quote-client-select"
              disabled={!canAct || isSubmitting}
              value={draft.client_id ?? ""}
              onChange={(e) => {
                const nextId = e.target.value || null;
                setDraft((p) => ({
                  ...p,
                  client_id: nextId,
                  new_client: undefined,
                }));
              }}
              className="mt-2 w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 text-sm text-[#2C2621] disabled:bg-[#F5F1E6]"
            >
              <option value="">-- Seleccionar cliente --</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.phone ? `(${c.phone})` : ""}
                </option>
              ))}
            </select>
          ) : (
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                type="text"
                disabled={!canAct || isSubmitting}
                placeholder="Nombre completo *"
                value={draft.new_client?.name ?? ""}
                onChange={(e) =>
                  setDraft((p) => ({
                    ...p,
                    client_id: null,
                    new_client: { ...(p.new_client ?? { name: "" }), name: e.target.value },
                  }))
                }
                className="rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 text-sm text-[#2C2621] disabled:bg-[#F5F1E6]"
              />
              <input
                type="tel"
                disabled={!canAct || isSubmitting}
                placeholder="Teléfono (+34...)"
                value={draft.new_client?.phone ?? ""}
                onChange={(e) =>
                  setDraft((p) => ({
                    ...p,
                    client_id: null,
                    new_client: { ...(p.new_client ?? { name: "" }), phone: e.target.value },
                  }))
                }
                className="rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 text-sm font-mono-nums text-[#2C2621] disabled:bg-[#F5F1E6]"
              />
              <input
                type="text"
                disabled={!canAct || isSubmitting}
                placeholder="NIF/CIF (opcional)"
                value={draft.new_client?.nif ?? ""}
                onChange={(e) =>
                  setDraft((p) => ({
                    ...p,
                    client_id: null,
                    new_client: { ...(p.new_client ?? { name: "" }), nif: e.target.value },
                  }))
                }
                className="rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 text-sm font-mono-nums text-[#2C2621] disabled:bg-[#F5F1E6]"
              />
              <ZoomableTextField
                as="input"
                multiline={false}
                zoomLabel="Domicilio fiscal del cliente"
                maxLength={TEXT_LIMITS.ADDRESS}
                disabled={!canAct || isSubmitting}
                placeholder="Domicilio fiscal"
                value={draft.new_client?.fiscal_address ?? ""}
                onValueChange={(next) =>
                  setDraft((p) => ({
                    ...p,
                    client_id: null,
                    new_client: {
                      ...(p.new_client ?? { name: "" }),
                      fiscal_address: next,
                    },
                  }))
                }
                className="rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 text-sm text-[#2C2621] disabled:bg-[#F5F1E6]"
              />
              <input
                type="email"
                disabled={!canAct || isSubmitting}
                placeholder="Email del cliente (opcional)"
                value={draft.new_client?.email ?? ""}
                onChange={(e) =>
                  setDraft((p) => ({
                    ...p,
                    client_id: null,
                    new_client: { ...(p.new_client ?? { name: "" }), email: e.target.value },
                  }))
                }
                className="sm:col-span-2 rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 text-sm text-[#2C2621] disabled:bg-[#F5F1E6]"
              />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-[#2C2621]">Tipo de IVA aplicable</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {([10, 21] as QuoteVatRate[]).map((rate) => (
              <button
                key={rate}
                type="button"
                data-testid={`quote-vat-${rate}`}
                disabled={!canAct || isSubmitting}
                onClick={() => setDraft((p) => ({ ...p, vat_rate: rate }))}
                className={`min-h-9 rounded-xl px-3 text-xs font-bold font-mono-nums ${
                  draft.vat_rate === rate
                    ? "bg-[#EA580C] text-white"
                    : "bg-[#F5F1E6] border border-[#E5DFD2] text-[#2C2621]"
                }`}
              >
                {rate} %
              </button>
            ))}
            <div className="flex items-center rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-2">
              <input
                type="number"
                step="0.5"
                min="0"
                max="100"
                aria-label="IVA personalizado (%)"
                data-testid="quote-vat-custom-input"
                disabled={!canAct || isSubmitting}
                value={draft.vat_rate}
                onChange={(e) => {
                  const val = Number.parseFloat(e.target.value.replace(",", "."));
                  if (Number.isFinite(val)) {
                    setDraft((p) => ({
                      ...p,
                      vat_rate: Math.max(0, Math.min(100, val)),
                    }));
                  }
                }}
                className="w-12 py-1.5 text-right text-xs font-bold font-mono-nums text-[#2C2621] focus:outline-none disabled:bg-transparent"
              />
              <span className="text-xs font-bold text-[#6B6860]">%</span>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[#2C2621]">
              {isLaborOnly ? `Tareas incluidas (${draft.lines.length})` : `Partidas (${draft.lines.length})`}
            </span>
            {canAct && (
              <div className="flex items-center gap-1.5">
                {catalogItems.length > 0 && (
                  <button
                    type="button"
                    data-testid="quote-catalog-picker-btn"
                    disabled={isSubmitting}
                    onClick={() => setShowCatalogPicker((v) => !v)}
                    className="rounded-lg border border-[#EA580C]/40 bg-[#FFD6B0] px-2.5 py-1 text-xs font-semibold text-[#4A2500]"
                  >
                    + Desde tarifario
                  </button>
                )}
                <button
                  type="button"
                  data-testid="quote-add-line"
                  disabled={isSubmitting}
                  onClick={addEmptyLine}
                  className="rounded-lg bg-[#4B7094] px-2.5 py-1 text-xs font-semibold text-[#FFFDF9]"
                >
                  {isLaborOnly ? "+ Añadir tarea" : "+ Añadir partida"}
                </button>
              </div>
            )}
          </div>

          {canAct && showCatalogPicker && (
            <div className="rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] p-2.5 space-y-2">
              <input
                type="search"
                value={catalogFilter}
                onChange={(e) => setCatalogFilter(e.target.value)}
                placeholder="Buscar en tarifario local..."
                className="w-full rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 py-1.5 text-xs text-[#2C2621]"
              />
              <div className="max-h-44 overflow-y-auto space-y-1">
                {filteredCatalog.length === 0 ? (
                  <div className="text-center text-[11px] text-[#6B6860] py-2">
                    Sin partidas coincidentes
                  </div>
                ) : (
                  filteredCatalog.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => addLineFromCatalog(item)}
                      className="w-full max-w-full overflow-hidden flex items-center justify-between gap-2 rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 py-1.5 text-left text-xs hover:bg-[#FFF3A1]/40"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="line-clamp-2 break-words [overflow-wrap:anywhere] font-semibold text-[#2C2621]">
                          {item.description}
                        </div>
                        <div className="break-words text-[10px] text-[#6B6860]">
                          {item.category} ·{" "}
                          {formatPricingBreakdown({
                            pricing_mode: item.pricing_mode,
                            estimated_hours_thousandths: item.estimated_hours_thousandths,
                            materials_cents: item.materials_cents,
                            hourly_rate_cents: hourlyRateCents,
                            unit_price_cents: item.unit_price_cents,
                          })}
                        </div>
                      </div>
                      {!isLaborOnly && (
                        <span className="shrink-0 font-bold font-mono-nums tabular-nums text-[#D04B00]">
                          {formatCentsEs(item.unit_price_cents)}/{item.unit}
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {draft.lines.map((line, idx) => {
            const lineSubtotal = totals.lineSubtotals[idx] ?? 0;
            const priceChanged =
              line.catalog_item_id !== null &&
              line.unit_price_cents !== line.original_unit_price_cents;

            return (
              <div
                key={`${line.catalog_item_id ?? "custom"}_${idx}`}
                data-testid={`quote-line-${idx}`}
                className="w-full max-w-full overflow-hidden ruled-notebook rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] p-2.5 pl-8 space-y-2"
              >
                <div
                  className="flex min-w-0 gap-2 items-start"
                  onBlur={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                      sanitizeLineDescription(idx);
                    }
                  }}
                >
                  <ZoomableTextField
                    as="textarea"
                    multiline
                    rows={2}
                    maxLength={TEXT_LIMITS.DESCRIPTION}
                    zoomLabel={
                      isLaborOnly ? `Descripción de la tarea ${idx + 1}` : `Descripción de la partida ${idx + 1}`
                    }
                    aria-label={`Descripción partida ${idx + 1}`}
                    disabled={!canAct || isSubmitting}
                    value={line.description}
                    onValueChange={(next) => updateLine(idx, { description: next })}
                    placeholder={
                      isLaborOnly
                        ? "Descripción de tarea incluida"
                        : "Descripción de trabajo o material"
                    }
                    className="min-w-0 flex-1 resize-none rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 py-1.5 text-xs font-medium text-[#2C2621] break-words disabled:bg-[#F5F1E6]"
                  />
                  {canAct && (isLaborOnly || draft.lines.length > 1) && (
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => removeLine(idx)}
                      className="shrink-0 rounded-lg px-2 py-1.5 text-xs font-semibold text-[#9A2D08] hover:bg-[#FAD2D8]/50"
                    >
                      Quitar
                    </button>
                  )}
                </div>

                {isLaborOnly ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <div className="flex items-center gap-1.5">
                      <span className="rounded-full bg-[#EAE5D9] px-2 py-0.5 text-[10px] font-semibold text-[#3D352E]">
                        Tarea incluida
                      </span>
                      <select
                        aria-label={`Categoría partida ${idx + 1}`}
                        disabled={!canAct || isSubmitting}
                        value={line.category}
                        onChange={(e) =>
                          updateLine(idx, { category: e.target.value as CatalogCategory })
                        }
                        className="rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] px-2 py-1 text-[11px] text-[#2C2621]"
                      >
                        {CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        aria-label={`Cantidad partida ${idx + 1}`}
                        disabled={!canAct || isSubmitting}
                        value={thousandthsToQtyInput(line.quantity_thousandths)}
                        onChange={(e) =>
                          updateLine(idx, {
                            quantity_thousandths: qtyInputToThousandths(e.target.value),
                          })
                        }
                        className="w-14 rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] px-2 py-1 text-xs font-mono-nums tabular-nums text-[#2C2621] disabled:bg-[#F5F1E6]"
                      />
                      <input
                        type="text"
                        aria-label={`Unidad partida ${idx + 1}`}
                        disabled={!canAct || isSubmitting}
                        value={line.unit}
                        onChange={(e) => updateLine(idx, { unit: e.target.value || "ud" })}
                        className="w-14 rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] px-2 py-1 text-xs text-[#2C2621] disabled:bg-[#F5F1E6]"
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-4 gap-1.5 items-center text-xs">
                      <div className="min-w-0">
                        <label className="block text-[10px] text-[#6B6860]">Cant.</label>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          aria-label={`Cantidad partida ${idx + 1}`}
                          disabled={!canAct || isSubmitting}
                          value={thousandthsToQtyInput(line.quantity_thousandths)}
                          onChange={(e) =>
                            updateLine(idx, {
                              quantity_thousandths: qtyInputToThousandths(e.target.value),
                            })
                          }
                          className="min-w-0 w-full rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] px-2 py-1 text-xs font-mono-nums tabular-nums text-[#2C2621] disabled:bg-[#F5F1E6]"
                        />
                      </div>
                      <div className="min-w-0">
                        <label className="block text-[10px] text-[#6B6860]">Ud</label>
                        <input
                          type="text"
                          aria-label={`Unidad partida ${idx + 1}`}
                          disabled={!canAct || isSubmitting}
                          value={line.unit}
                          onChange={(e) => updateLine(idx, { unit: e.target.value || "ud" })}
                          className="min-w-0 w-full rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] px-2 py-1 text-xs text-[#2C2621] disabled:bg-[#F5F1E6]"
                        />
                      </div>
                      <div className="min-w-0">
                        <label className="block text-[10px] text-[#6B6860]">Precio (€)</label>
                        <PriceInput
                          valueCents={line.unit_price_cents}
                          disabled={!canAct || isSubmitting}
                          testId={`quote-line-price-${idx}`}
                          ariaLabel={`Precio euros partida ${idx + 1}`}
                          onChangeCents={(cents) =>
                            updateLine(idx, {
                              unit_price_cents: cents,
                            })
                          }
                        />
                      </div>
                      <div className="min-w-0 text-right">
                        <div className="text-[10px] text-[#6B6860]">Subtotal</div>
                        <div className="truncate font-bold font-mono-nums text-[#2C2621] tabular-nums highlighter-yellow">
                          {formatCentsEs(lineSubtotal)}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <select
                        aria-label={`Categoría partida ${idx + 1}`}
                        disabled={!canAct || isSubmitting}
                        value={line.category}
                        onChange={(e) =>
                          updateLine(idx, { category: e.target.value as CatalogCategory })
                        }
                        className="rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] px-2 py-1 text-[11px] text-[#2C2621]"
                      >
                        {CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </select>

                      <label className="min-w-0 inline-flex items-center gap-1.5 text-[#2C2621] cursor-pointer">
                        <input
                          type="checkbox"
                          data-testid={`quote-line-save-catalog-${idx}`}
                          disabled={!canAct || isSubmitting}
                          checked={line.save_to_catalog}
                          onChange={(e) => updateLine(idx, { save_to_catalog: e.target.checked })}
                          className="h-4 w-4 shrink-0 rounded border-[#E5DFD2] text-[#EA580C]"
                        />
                        <span className="break-words leading-tight">
                          {priceChanged
                            ? `Guardar nuevo precio (${formatCentsEs(line.original_unit_price_cents)} → ${formatCentsEs(line.unit_price_cents)})`
                            : "Guardar en tarifario"}
                        </span>
                      </label>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div className="rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] p-2.5 text-xs space-y-1">
          {!isLaborOnly && totals.laborCents > 0 && (
            <div className="flex justify-between text-[#6B6860]">
              <span>Partidas</span>
              <span className="font-semibold font-mono-nums tabular-nums text-[#2C2621]">
                {formatCentsEs(totals.itemsSubtotalCents)}
              </span>
            </div>
          )}
          {(isLaborOnly || totals.laborCents > 0) && (
            <div className="flex justify-between text-[#6B6860]">
              <span>Mano de obra</span>
              <span className="font-semibold font-mono-nums tabular-nums text-[#2C2621]">
                {formatCentsEs(totals.laborCents)}
              </span>
            </div>
          )}
          <div className="flex justify-between text-[#6B6860]">
            <span>Base imponible</span>
            <span className="font-semibold font-mono-nums tabular-nums text-[#2C2621]">
              {formatCentsEs(totals.subtotalCents)}
            </span>
          </div>
          <div className="flex justify-between text-[#6B6860]">
            <span>IVA ({draft.vat_rate} %)</span>
            <span className="font-semibold font-mono-nums tabular-nums text-[#2C2621]">
              {formatCentsEs(totals.vatCents)}
            </span>
          </div>
          <div className="flex justify-between border-t border-dashed border-[#E5DFD2] pt-1 text-sm font-extrabold text-[#2C2621]">
            <span>Total presupuesto</span>
            <span className="font-mono-nums tabular-nums highlighter-yellow">
              {formatCentsEs(totals.totalCents)}
            </span>
          </div>
        </div>

        {/* Condiciones y Datos del Documento */}
        <div
          data-testid="quote-document-conditions-section"
          className="rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] p-2.5"
        >
          <button
            type="button"
            data-testid="quote-toggle-document-conditions-btn"
            onClick={() => setShowDocumentConditions((v) => !v)}
            className="flex w-full items-center justify-between gap-2 text-left cursor-pointer"
          >
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold text-[#2C2621]">
                Condiciones y Datos del Documento
              </div>
              <div className="mt-0.5 text-[11px] text-[#6B6860] truncate">
                Validez {effectiveValidityDays} días
                {effectiveDurationValue != null && effectiveDurationValue > 0
                  ? ` · ${effectiveDurationValue} ${effectiveDurationUnit === "semanas" ? "sem." : "días lab."}`
                  : ""}
                {effectiveShowIban && effectiveIban.trim() ? " · IBAN visible" : ""}
                {effectiveAttachments.length > 0
                  ? ` · ${effectiveAttachments.length} ${effectiveAttachments.length === 1 ? "anexo" : "anexos"}`
                  : ""}
              </div>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-[#D04B00]">
              <span>{showDocumentConditions ? "Ocultar" : "Editar"}</span>
              {showDocumentConditions ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </span>
          </button>

          {showDocumentConditions && (
            <div className="mt-3 space-y-3 border-t border-[#E5DFD2] pt-3">
              {/* 1. Descripción general del trabajo */}
              <div>
                <label
                  className="block text-xs font-semibold text-[#2C2621]"
                  htmlFor="qb-general-description"
                >
                  Descripción general del trabajo
                </label>
                <ZoomableTextField
                  id="qb-general-description"
                  as="input"
                  multiline={false}
                  maxLength={TEXT_LIMITS.DESCRIPTION}
                  zoomLabel="Descripción general del trabajo"
                  data-testid="quote-general-description-input"
                  disabled={!canAct || isSubmitting}
                  value={effectiveGeneralDescription}
                  onValueChange={(next) =>
                    setDraft((p) => ({ ...p, general_description: next }))
                  }
                  placeholder="Ej: Reforma eléctrica de vivienda..."
                  className="mt-1 w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 text-xs text-[#2C2621] placeholder:text-[#6B6860] disabled:bg-[#F5F1E6]"
                />
              </div>

              {/* 2. Tiempo estimado y 3. Validez del presupuesto */}
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div>
                  <label
                    className="block text-xs font-semibold text-[#2C2621]"
                    htmlFor="qb-estimated-duration"
                  >
                    Tiempo estimado (opcional)
                  </label>
                  <div className="mt-1 flex gap-1.5">
                    <input
                      id="qb-estimated-duration"
                      data-testid="quote-duration-value-input"
                      type="number"
                      min="1"
                      max="9999"
                      step="1"
                      disabled={!canAct || isSubmitting}
                      value={effectiveDurationValue ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        if (!raw) {
                          setDraft((p) => ({ ...p, estimated_duration_value: null }));
                          return;
                        }
                        const parsed = Number.parseFloat(raw.replace(",", "."));
                        if (Number.isFinite(parsed) && parsed > 0) {
                          setDraft((p) => ({
                            ...p,
                            estimated_duration_value: Math.min(9999, parsed),
                          }));
                        }
                      }}
                      placeholder="Ej: 5"
                      className="w-20 rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 py-2 text-xs font-mono-nums tabular-nums text-[#2C2621] disabled:bg-[#F5F1E6]"
                    />
                    <select
                      aria-label="Unidad de tiempo estimado"
                      data-testid="quote-duration-unit-select"
                      disabled={!canAct || isSubmitting}
                      value={effectiveDurationUnit}
                      onChange={(e) =>
                        setDraft((p) => ({
                          ...p,
                          estimated_duration_unit: e.target.value as QuoteDurationUnit,
                        }))
                      }
                      className="min-w-0 flex-1 rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 py-2 text-xs text-[#2C2621] disabled:bg-[#F5F1E6]"
                    >
                      <option value="dias_laborables">Días laborables</option>
                      <option value="semanas">Semanas</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label
                    className="block text-xs font-semibold text-[#2C2621]"
                    htmlFor="qb-validity-days"
                  >
                    Validez del presupuesto (días)
                  </label>
                  <input
                    id="qb-validity-days"
                    data-testid="quote-validity-days-input"
                    type="number"
                    min="1"
                    max="365"
                    step="1"
                    disabled={!canAct || isSubmitting}
                    value={effectiveValidityDays}
                    onChange={(e) => {
                      const val = Math.max(
                        1,
                        Math.min(365, Math.round(Number(e.target.value) || 30))
                      );
                      setDraft((p) => ({ ...p, validity_days: val }));
                    }}
                    className="mt-1 w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 text-xs font-mono-nums tabular-nums text-[#2C2621] disabled:bg-[#F5F1E6]"
                  />
                </div>
              </div>

              {/* 4. Condiciones de pago */}
              <div>
                <label
                  className="block text-xs font-semibold text-[#2C2621]"
                  htmlFor="qb-payment-terms"
                >
                  Condiciones de pago (opcional)
                </label>
                <ZoomableTextField
                  id="qb-payment-terms"
                  as="textarea"
                  multiline
                  rows={2}
                  maxLength={TEXT_LIMITS.NOTES}
                  zoomLabel="Condiciones de pago"
                  data-testid="quote-payment-terms-input"
                  disabled={!canAct || isSubmitting}
                  value={effectivePaymentTermsText}
                  onValueChange={(next) =>
                    setDraft((p) => ({ ...p, payment_terms_text: next }))
                  }
                  placeholder="Ej: 50% al inicio de obra, 40% a mediados y 10% al finalizar"
                  className="mt-1 w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-1.5 text-xs text-[#2C2621] placeholder:text-[#6B6860] disabled:bg-[#F5F1E6]"
                />
              </div>

              {/* 5. Cuenta corriente (IBAN) y Banco + Toggle */}
              <div className="rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] p-2.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#2C2621]">
                    Cuenta corriente (IBAN) y Banco
                  </span>
                  <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#2C2621] cursor-pointer">
                    <input
                      type="checkbox"
                      data-testid="quote-show-iban-toggle"
                      disabled={!canAct || isSubmitting}
                      checked={effectiveShowIban}
                      onChange={(e) =>
                        setDraft((p) => ({ ...p, show_iban: e.target.checked }))
                      }
                      className="h-4 w-4 rounded border-[#E5DFD2] text-[#EA580C]"
                    />
                    <span>Mostrar IBAN en este presupuesto</span>
                  </label>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    type="text"
                    aria-label="IBAN del presupuesto"
                    data-testid="quote-iban-input"
                    disabled={!canAct || isSubmitting}
                    value={effectiveIban}
                    onChange={(e) => {
                      const val = e.target.value.toUpperCase();
                      setDraft((p) => ({
                        ...p,
                        iban_override: val,
                        show_iban: p.show_iban !== undefined ? p.show_iban : Boolean(val.trim()),
                      }));
                    }}
                    placeholder="ES00 0000 0000 0000 0000 0000"
                    className="rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 py-1.5 font-mono-nums text-xs text-[#2C2621] placeholder:text-[#6B6860] disabled:bg-[#EFECE4]"
                  />
                  <input
                    type="text"
                    aria-label="Entidad bancaria"
                    data-testid="quote-bank-name-input"
                    disabled={!canAct || isSubmitting}
                    value={effectiveBankName}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, bank_name: e.target.value }))
                    }
                    placeholder="Entidad bancaria (ej. CaixaBank)"
                    className="rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 py-1.5 text-xs text-[#2C2621] placeholder:text-[#6B6860] disabled:bg-[#EFECE4]"
                  />
                </div>
              </div>

              {/* 6. Notas técnicas y Certificaciones / Anexos */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label
                    className="block text-xs font-semibold text-[#2C2621]"
                    htmlFor="qb-notes"
                  >
                    Notas técnicas y Certificaciones / Anexos
                  </label>
                  {canAct && (
                    <>
                      <input
                        ref={attachmentInputRef}
                        type="file"
                        data-testid="quote-attachment-file-input"
                        accept=".pdf,.txt,.md,.csv,.jpg,.jpeg,.png,.webp,application/pdf,text/plain,image/*"
                        disabled={isSubmitting || extractingAttachment}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          void handleAttachDocument(file);
                          e.target.value = "";
                        }}
                        className="hidden"
                      />
                      <button
                        type="button"
                        data-testid="quote-add-attachment-btn"
                        disabled={isSubmitting || extractingAttachment}
                        onClick={() => attachmentInputRef.current?.click()}
                        className="inline-flex items-center gap-1 rounded-lg border border-[#4B7094]/40 bg-[#E0F2FE] px-2.5 py-1 text-[11px] font-semibold text-[#0369A1] hover:bg-[#BAE6FD]/70 cursor-pointer disabled:opacity-50"
                      >
                        <Paperclip className="h-3 w-3" />
                        <span>
                          {extractingAttachment
                            ? "Extrayendo texto..."
                            : "Añadir documento / certificación"}
                        </span>
                      </button>
                    </>
                  )}
                </div>

                <ZoomableTextField
                  id="qb-notes"
                  as="textarea"
                  multiline
                  rows={3}
                  maxLength={TEXT_LIMITS.NOTES}
                  zoomLabel="Notas técnicas y certificaciones"
                  data-testid="quote-notes-input"
                  disabled={!canAct || isSubmitting}
                  value={draft.notes}
                  onValueChange={(next) => setDraft((p) => ({ ...p, notes: next }))}
                  placeholder="Ej: Certificado eléctrico (BRIE/CIE) no incluido. Desescombro y gestión de residuos incluidos..."
                  className="w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-1.5 text-xs text-[#2C2621] placeholder:text-[#6B6860] disabled:bg-[#F5F1E6]"
                />

                {attachmentNotice && (
                  <div
                    role="status"
                    className="rounded-lg border border-[#BAE6FD] bg-[#E0F2FE]/60 px-2.5 py-1.5 text-[11px] text-[#0369A1]"
                  >
                    {attachmentNotice}
                  </div>
                )}

                {effectiveAttachments.length > 0 && (
                  <div className="space-y-1.5" data-testid="quote-attachments-list">
                    {effectiveAttachments.map((att, idx) => (
                      <div
                        key={`${att.name}_${idx}`}
                        className="flex items-start justify-between gap-2 rounded-lg border border-[#E5DFD2] bg-[#F5F1E6] px-2.5 py-1.5 text-[11px]"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-[#2C2621] truncate">
                            {att.name}
                          </div>
                          {att.extractedText && (
                            <div className="text-[10px] text-[#6B6860] line-clamp-2">
                              {att.extractedText}
                            </div>
                          )}
                        </div>
                        {canAct && (
                          <button
                            type="button"
                            aria-label={`Quitar anexo ${att.name}`}
                            disabled={isSubmitting}
                            onClick={() => handleRemoveAttachment(idx)}
                            className="shrink-0 rounded p-1 text-[#9A2D08] hover:bg-[#FAD2D8]/50 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Métodos de pago y fraccionamiento (avanzado) */}
              <div className="rounded-xl border border-[#E5DFD2] bg-[#F5F1E6]/60 p-2.5">
                <button
                  type="button"
                  data-testid="quote-toggle-payment-validity-btn"
                  onClick={() => setShowPaymentOptions((v) => !v)}
                  className="flex w-full items-center justify-between gap-2 text-left text-[11px] font-bold text-[#2C2621] cursor-pointer"
                >
                  <span>
                    Métodos de pago y fraccionamiento automático
                    {effectivePaymentSchedule.length > 0
                      ? ` (${effectivePaymentSchedule.length} ${effectivePaymentSchedule.length === 1 ? "pago" : "pagos"})`
                      : ""}
                  </span>
                  <span className="font-semibold text-[#D04B00]">
                    {showPaymentOptions ? "Ocultar" : "Configurar"}
                  </span>
                </button>

                {showPaymentOptions && (
                  <div className="mt-2.5 pt-2.5 border-t border-[#E5DFD2]">
                    <QuotePaymentValidityEditor
                      validityDays={effectiveValidityDays}
                      onChangeValidityDays={(days) =>
                        setDraft((p) => ({ ...p, validity_days: days }))
                      }
                      paymentMethods={effectivePaymentMethods}
                      onChangePaymentMethods={(methods) =>
                        setDraft((p) => ({ ...p, payment_methods: methods }))
                      }
                      paymentSchedule={effectivePaymentSchedule}
                      onChangePaymentSchedule={(schedule) =>
                        setDraft((p) => ({ ...p, payment_schedule: schedule }))
                      }
                      emitterIban={effectiveIban}
                      totalCentsForPreview={totals.totalCents}
                      disabled={!canAct || isSubmitting}
                      testIdPrefix="qb-pv"
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {validationError && (
          <div
            role="alert"
            className="rounded-xl border border-[#DC2626]/30 bg-[#FAD2D8] p-2.5 text-xs font-medium text-[#5A121C]"
          >
            {validationError}
          </div>
        )}

        {canAct && (
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              data-testid="quote-reject-btn"
              disabled={isSubmitting}
              onClick={() => void handleReject()}
              className="min-h-12 rounded-xl border border-[#DC2626]/40 bg-[#FFFDF7] px-3.5 text-xs font-bold text-[#9A2D08]"
            >
              Rechazar
            </button>
            <button
              type="button"
              data-testid="quote-builder-preview-btn"
              disabled={isSubmitting || !runtime.onOpenDocumentPreview}
              onClick={handleOpenPreview}
              className="inline-flex min-h-12 items-center justify-center gap-1.5 rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] px-3.5 text-xs font-bold text-[#2C2621] hover:border-[#EA580C] disabled:opacity-50 cursor-pointer"
            >
              <Eye className="h-4 w-4 shrink-0 text-[#D04B00]" aria-hidden="true" />
              <span>Vista previa</span>
            </button>
            <button
              type="button"
              data-testid="quote-approve-btn"
              disabled={isSubmitting}
              onClick={handleConfirm}
              className="min-h-12 flex-1 rounded-xl bg-[#EA580C] hover:bg-[#D04B00] px-4 text-sm font-bold text-white shadow-sm disabled:opacity-50"
            >
              {isSubmitting
                ? "Guardando PDF..."
                : isDirty
                  ? "Guardar edición y crear PDF"
                  : "Aprobar y generar PDF"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
