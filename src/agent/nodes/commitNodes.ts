import { AIMessage } from "@langchain/core/messages";
import { interrupt, type LangGraphRunnableConfig } from "@langchain/langgraph";
import {
  Gate1QuoteCommitPayloadSchema,
  Gate2TicketCommitPayloadSchema,
  Gate3InvoiceCommitPayloadSchema,
  Gate4ShareCommitPayloadSchema,
  HumanDecisionSchema,
} from "../../core/contracts/schemas";
import type {
  ActiveWidgetEnvelope,
  ClientRow,
  ErrorCode,
  Gate1QuoteDraftPayload,
  Gate2TicketDraftPayload,
  Gate3InvoiceDraftPayload,
  Gate4ShareDraftPayload,
  InterruptPayload,
  InvoiceKind,
  InvoiceRow,
  JobRow,
  QuoteRow,
} from "../../core/contracts/types";
import { InvoicesRepository } from "../../core/db/repositories/invoicesRepo";
import { QuotesRepository } from "../../core/db/repositories/quotesRepo";
import {
  allocateNextSequence,
  peekNextSequenceCode,
  SettingsRepository,
} from "../../core/db/repositories/settingsRepo";
import {
  deriveFiscalQuarter,
  formatLocalDateIso,
  getFiscalYearFromIso,
  getLocalTodayIso,
} from "../../core/fiscal/dateQuarter";
import {
  computeAdvance40,
  computeFinalInvoiceFromQuoteAndAdvance,
  computeQuoteTotals,
  deriveRateOrMixed,
  formatCentsEs,
} from "../../core/fiscal/fiscalEngine";
import {
  getSeedOverride,
  getThreadIdFromConfig,
  type GraphDependencies,
  type PdfInvoiceDocumentInput,
  type PdfQuoteDocumentInput,
} from "../ports";
import type { ObraLocalGraphState, ObraLocalGraphUpdate } from "../state";

function mapCommitErrorCode(err: unknown): ErrorCode {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("STORAGE_QUOTA_EXCEEDED")) return "STORAGE_QUOTA_EXCEEDED";
  if (msg.includes("LAZY_CHUNK_LOAD_ERROR")) return "LAZY_CHUNK_LOAD_ERROR";
  if (msg.includes("PDF_BUILD_ERROR")) return "PDF_BUILD_ERROR";
  if (msg.includes("INVALID_STATE_TRANSITION")) return "INVALID_STATE_TRANSITION";
  if (msg.includes("SCHEMA_VALIDATION_ERROR")) return "SCHEMA_VALIDATION_ERROR";
  return "SQLITE_QUERY_ERROR";
}

function stripQuoteDisplayFields(
  widgetPayload: Extract<
    ActiveWidgetEnvelope,
    { ui_widget_type: "QuoteBuilderWidget" }
  >["widget_payload"]
): Gate1QuoteDraftPayload {
  const { subtotal_cents: _s, vat_cents: _v, total_cents: _t, ...draft } = widgetPayload;
  return draft;
}

function stripTicketDisplayFields(
  widgetPayload: Extract<
    ActiveWidgetEnvelope,
    { ui_widget_type: "TicketOcrValidatorWidget" }
  >["widget_payload"]
): Gate2TicketDraftPayload {
  const { ocr_fallback_reason: _r, ...draft } = widgetPayload;
  return draft;
}

export function createQuoteCommitNode(deps: GraphDependencies) {
  const quotesRepo = new QuotesRepository(deps.executor, deps.memoryCoordinator);

  return async function quoteCommitNode(
    state: ObraLocalGraphState,
    config?: LangGraphRunnableConfig
  ): Promise<ObraLocalGraphUpdate> {
    if (state.active_widget?.ui_widget_type !== "QuoteBuilderWidget") {
      throw new Error("SCHEMA_VALIDATION_ERROR: Widget inválido para quote_commit");
    }
    const proposed = stripQuoteDisplayFields(state.active_widget.widget_payload);
    const totalsSummary = computeQuoteTotals(proposed.lines, proposed.vat_rate);
    const summaryEs =
      getSeedOverride(config)?.quoteFixtureOverride?.summary_es ??
      `Presupuesto borrador (${proposed.lines.length} líneas, IVA ${proposed.vat_rate} %, total ${formatCentsEs(totalsSummary.totalCents)}).`;

    const interruptPayload: InterruptPayload = {
      gate_id: "gate_1_quote",
      title: "Confirmar presupuesto y catálogo",
      summary_es: summaryEs,
      requires_fiscal_lock: false,
      ui_widget_type: "QuoteBuilderWidget",
      proposed_payload: proposed,
    };

    // interrupt() SIEMPRE en las primeras líneas fuera de try/catch
    const rawDecision = interrupt(interruptPayload);
    const resumedAtMs = Date.now();
    const threadId = getThreadIdFromConfig(config);
    const postTraceId = `tr_${crypto.randomUUID().slice(0, 12)}`;
    const parentTraceId = state.turn_trace.trace_id;

    try {
      const decision = HumanDecisionSchema.parse(rawDecision);
      if (decision.gate_id !== "gate_1_quote") {
        throw new Error("SCHEMA_VALIDATION_ERROR: gate_id incompatible en quote_commit");
      }

      if (decision.action === "reject") {
        await deps.traceRecorder.recordTrace({
          trace_id: postTraceId,
          parent_trace_id: parentTraceId,
          thread_id: threadId,
          turn_id: state.turn_trace.turn_id,
          turn_phase: "post_resume",
          routed_intent: state.routed_intent,
          node_sequence: ["quote_commit"],
          inference_engine: state.turn_trace.inference_engine,
          latency_ms: Math.max(0, Date.now() - resumedAtMs),
          rag_snippets: [],
          validated_widget: null,
          hitl_gate_id: "gate_1_quote",
          hitl_outcome: "rejected",
          rejection_reason: decision.rejection_reason ?? null,
          error_code: null,
          cloud_cost_eur: 0,
          created_at_ms: Date.now(),
        });

        return {
          active_widget: null,
          quick_actions: null,
          pending_gate: null,
          messages: [
            new AIMessage(
              decision.rejection_reason
                ? `Presupuesto cancelado (${decision.rejection_reason}).`
                : "Presupuesto cancelado sin cambios en la base de datos."
            ),
          ],
          turn_trace: {
            trace_id: postTraceId,
            parent_trace_id: parentTraceId,
            started_at_ms: resumedAtMs,
            append_node: "quote_commit",
            rejection_reason: decision.rejection_reason ?? null,
          },
        };
      }

      const committed =
        decision.action === "edit"
          ? decision.edited_payload ??
            (() => {
              throw new Error("SCHEMA_VALIDATION_ERROR: edited_payload obligatorio en edit");
            })()
          : Gate1QuoteCommitPayloadSchema.parse(proposed);

      const now = Date.now();
      const todayIso = getLocalTodayIso();
      const fiscalYear = getFiscalYearFromIso(todayIso);
      const totals = computeQuoteTotals(committed.lines, committed.vat_rate);

      // Proyección previa (solo lectura) antes de generar PDF fuera de transacción
      let projectedQuoteCode: string;
      let existingQuote: QuoteRow | null = null;
      if (committed.quote_id) {
        existingQuote = await quotesRepo.getById(committed.quote_id);
        if (!existingQuote) {
          throw new Error("INVALID_STATE_TRANSITION: El presupuesto a editar ya no existe");
        }
        if (existingQuote.status !== "borrador") {
          throw new Error(
            "INVALID_STATE_TRANSITION: Solo se puede reeditar un presupuesto en estado 'borrador'"
          );
        }
        projectedQuoteCode = existingQuote.quote_code;
      } else {
        projectedQuoteCode = await peekNextSequenceCode(deps.executor, "PRE", fiscalYear);
      }

      const settingsRows = await deps.executor.query<{
        emitter_name: string;
        emitter_nif: string;
        emitter_fiscal_address: string;
        emitter_phone: string;
        emitter_iban?: string;
        emitter_logo_data_url?: string | null;
      }>(
        `SELECT emitter_name, emitter_nif, emitter_fiscal_address, emitter_phone, emitter_iban, emitter_logo_data_url
         FROM app_settings WHERE id = 1`
      );
      const emitter = settingsRows[0] ?? {
        emitter_name: "",
        emitter_nif: "",
        emitter_fiscal_address: "",
        emitter_phone: "",
        emitter_iban: "",
        emitter_logo_data_url: null,
      };

      const existingClient = committed.client_id
        ? (
            await deps.executor.query<ClientRow>(
              `SELECT * FROM clients WHERE id = ? LIMIT 1`,
              [committed.client_id]
            )
          )[0] ?? null
        : null;

      if (committed.client_id && !existingClient) {
        throw new Error("INVALID_STATE_TRANSITION: El cliente seleccionado ya no existe");
      }

      const clientSnapshot = existingClient
        ? {
            name: existingClient.name,
            nif: existingClient.nif,
            fiscalAddress: existingClient.fiscal_address,
            phone: existingClient.phone,
          }
        : {
            name: committed.new_client?.name.trim() ?? "",
            nif: committed.new_client?.nif?.trim().toUpperCase() ?? "",
            fiscalAddress: committed.new_client?.fiscal_address?.trim() ?? "",
            phone: committed.new_client?.phone?.trim() ?? "",
          };

      // Pre-generación PDF en memoria + disco ANTES de abrir transacción SQLite (Sección 3.2)
      const pdfInput: PdfQuoteDocumentInput = {
        kind: "quote",
        quoteCode: projectedQuoteCode,
        issuedDateIso: existingQuote ? formatLocalDateIso(existingQuote.created_at_ms) : todayIso,
        emitter: {
          name: emitter.emitter_name || "Autónomo",
          nif: emitter.emitter_nif,
          fiscalAddress: emitter.emitter_fiscal_address,
          phone: emitter.emitter_phone,
          iban: emitter.emitter_iban ?? "",
          logoDataUrl: emitter.emitter_logo_data_url ?? null,
        },
        client: clientSnapshot,
        jobTitle: committed.job_title,
        vatRate: committed.vat_rate,
        subtotalCents: totals.subtotalCents,
        vatCents: totals.vatCents,
        totalCents: totals.totalCents,
        notes: committed.notes,
        lines: committed.lines.map((line, i) => ({
          description: line.description,
          unit: line.unit,
          quantityThousandths: line.quantity_thousandths,
          unitPriceCents: line.unit_price_cents,
          lineSubtotalCents: totals.lineSubtotals[i] ?? 0,
        })),
      };

      const releasePdf = await deps.memoryCoordinator.acquireHeavyTask("pdf");
      let pdfUri: string;
      try {
        const built = await deps.pdfPort.buildDocumentPdf(pdfInput);
        pdfUri = await deps.fileBridge.savePdf(built.pdfBytes, built.fileName);
      } catch (pdfErr) {
        const msg = pdfErr instanceof Error ? pdfErr.message : String(pdfErr);
        if (msg.includes("LAZY_CHUNK_LOAD_ERROR") || msg.includes("STORAGE_QUOTA_EXCEEDED")) {
          throw pdfErr;
        }
        throw new Error(`PDF_BUILD_ERROR: ${msg}`);
      } finally {
        await releasePdf();
      }

      let finalJobId = committed.job_id;
      let finalQuoteId = committed.quote_id;

      try {
        await deps.executor.inTransaction(async (tx) => {
          let resolvedClientId = committed.client_id;
          if (!resolvedClientId && committed.new_client) {
            resolvedClientId = `cli_${crypto.randomUUID().slice(0, 12)}`;
            await tx.run(
              `INSERT INTO clients (
                id, name, nif, fiscal_address, phone, email, notes, created_at_ms, updated_at_ms
              ) VALUES (?, ?, ?, ?, ?, '', '', ?, ?)`,
              [
                resolvedClientId,
                clientSnapshot.name,
                clientSnapshot.nif,
                clientSnapshot.fiscalAddress,
                clientSnapshot.phone,
                now,
                now,
              ]
            );
          }
          if (!resolvedClientId) {
            throw new Error("SCHEMA_VALIDATION_ERROR: Cliente requerido para presupuesto");
          }

          if (finalJobId) {
            const jobRows = await tx.query<JobRow>(
              `SELECT * FROM jobs WHERE id = ? LIMIT 1`,
              [finalJobId]
            );
            const liveJob = jobRows[0];
            if (!liveJob || liveJob.status === "cancelado") {
              throw new Error(
                "INVALID_STATE_TRANSITION: La obra ya no existe o ha sido cancelada"
              );
            }
            if (liveJob.client_id !== null && liveJob.client_id !== resolvedClientId) {
              throw new Error(
                "INVALID_STATE_TRANSITION: La obra ya pertenece a otro cliente distinto"
              );
            }
            if (liveJob.client_id === null) {
              await tx.run(
                `UPDATE jobs SET client_id = ?, updated_at_ms = ? WHERE id = ? AND client_id IS NULL`,
                [resolvedClientId, now, finalJobId]
              );
            }
            const activeQuotes = await tx.query<{ id: string }>(
              `SELECT id FROM quotes WHERE job_id = ? AND status != 'rechazado'`,
              [finalJobId]
            );
            const conflict = activeQuotes.find((q) => q.id !== finalQuoteId);
            if (conflict) {
              throw new Error(
                "INVALID_STATE_TRANSITION: La obra ya tiene otro presupuesto activo distinto"
              );
            }
          } else {
            const { code: jobCode } = await allocateNextSequence(tx, "OBR", fiscalYear, now);
            finalJobId = `job_${crypto.randomUUID().slice(0, 12)}`;
            await tx.run(
              `INSERT INTO jobs (
                id, job_code, client_id, title, address, status,
                created_at_iso, created_at_ms, updated_at_ms
              ) VALUES (?, ?, ?, ?, ?, 'pendiente', ?, ?, ?)`,
              [
                finalJobId,
                jobCode,
                resolvedClientId,
                committed.job_title.trim(),
                clientSnapshot.fiscalAddress,
                todayIso,
                now,
                now,
              ]
            );
          }

          if (finalQuoteId) {
            const liveQuoteRows = await tx.query<QuoteRow>(
              `SELECT * FROM quotes WHERE id = ? LIMIT 1`,
              [finalQuoteId]
            );
            const liveQuote = liveQuoteRows[0];
            if (!liveQuote || liveQuote.status !== "borrador") {
              throw new Error(
                "INVALID_STATE_TRANSITION: El presupuesto dejó de ser editable ('borrador')"
              );
            }
            await tx.run(
              `UPDATE quotes
               SET client_id = ?, client_name_snapshot = ?, client_nif_snapshot = ?,
                   client_address_snapshot = ?, client_phone_snapshot = ?,
                   vat_rate = ?, subtotal_cents = ?, vat_cents = ?, total_cents = ?,
                   notes = ?, pdf_uri = ?, updated_at_ms = ?
               WHERE id = ?`,
              [
                resolvedClientId,
                clientSnapshot.name,
                clientSnapshot.nif,
                clientSnapshot.fiscalAddress,
                clientSnapshot.phone,
                committed.vat_rate,
                totals.subtotalCents,
                totals.vatCents,
                totals.totalCents,
                committed.notes,
                pdfUri,
                now,
                finalQuoteId,
              ]
            );
            await tx.run(`DELETE FROM quote_items WHERE quote_id = ?`, [finalQuoteId]);
          } else {
            const { code: quoteCode } = await allocateNextSequence(tx, "PRE", fiscalYear, now);
            if (quoteCode !== projectedQuoteCode) {
              throw new Error("INVALID_STATE_TRANSITION: Colisión de correlativo PRE");
            }
            finalQuoteId = `quote_${crypto.randomUUID().slice(0, 12)}`;
            await tx.run(
              `INSERT INTO quotes (
                id, quote_code, job_id, client_id, client_name_snapshot, client_nif_snapshot,
                client_address_snapshot, client_phone_snapshot, vat_rate, subtotal_cents,
                vat_cents, total_cents, status, notes, pdf_uri, sent_at_iso,
                created_at_ms, updated_at_ms
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'borrador', ?, ?, NULL, ?, ?)`,
              [
                finalQuoteId,
                quoteCode,
                finalJobId,
                resolvedClientId,
                clientSnapshot.name,
                clientSnapshot.nif,
                clientSnapshot.fiscalAddress,
                clientSnapshot.phone,
                committed.vat_rate,
                totals.subtotalCents,
                totals.vatCents,
                totals.totalCents,
                committed.notes,
                pdfUri,
                now,
                now,
              ]
            );
          }

          for (const [idx, line] of committed.lines.entries()) {
            let lineCatalogId = line.catalog_item_id;
            if (line.save_to_catalog) {
              if (lineCatalogId === null) {
                lineCatalogId = `cat_${crypto.randomUUID().slice(0, 12)}`;
                await tx.run(
                  `INSERT INTO catalog_items (
                    id, description, category, unit, unit_price_cents, pricing_mode,
                    estimated_hours_thousandths, materials_cents, default_vat_rate,
                    active, created_at_ms, updated_at_ms
                  ) VALUES (?, ?, ?, ?, ?, 'fixed', 0, 0, ?, 1, ?, ?)`,
                  [
                    lineCatalogId,
                    line.description.trim(),
                    line.category,
                    line.unit,
                    line.unit_price_cents,
                    committed.vat_rate,
                    now,
                    now,
                  ]
                );
                await tx.run(
                  `INSERT INTO feedback_corrections (
                    id, catalog_item_id, quote_id, old_unit_price_cents, new_unit_price_cents, created_at_ms
                  ) VALUES (?, ?, ?, 0, ?, ?)`,
                  [
                    `fb_${crypto.randomUUID().slice(0, 12)}`,
                    lineCatalogId,
                    finalQuoteId,
                    line.unit_price_cents,
                    now,
                  ]
                );
              } else if (line.unit_price_cents !== line.original_unit_price_cents) {
                await tx.run(
                  `UPDATE catalog_items
                   SET unit_price_cents = ?, pricing_mode = 'fixed',
                       estimated_hours_thousandths = 0, materials_cents = 0, updated_at_ms = ?
                   WHERE id = ?`,
                  [line.unit_price_cents, now, lineCatalogId]
                );
                await tx.run(
                  `INSERT INTO feedback_corrections (
                    id, catalog_item_id, quote_id, old_unit_price_cents, new_unit_price_cents, created_at_ms
                  ) VALUES (?, ?, ?, ?, ?, ?)`,
                  [
                    `fb_${crypto.randomUUID().slice(0, 12)}`,
                    lineCatalogId,
                    finalQuoteId,
                    line.original_unit_price_cents,
                    line.unit_price_cents,
                    now,
                  ]
                );
              }
            }

            await tx.run(
              `INSERT INTO quote_items (
                id, quote_id, line_order, catalog_item_id, description, category,
                unit, quantity_thousandths, unit_price_cents, line_subtotal_cents
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                `qi_${crypto.randomUUID().slice(0, 12)}`,
                finalQuoteId,
                idx,
                lineCatalogId,
                line.description.trim(),
                line.category,
                line.unit,
                line.quantity_thousandths,
                line.unit_price_cents,
                totals.lineSubtotals[idx] ?? 0,
              ]
            );
          }
        });
      } catch (txErr) {
        await deps.fileBridge.deletePdf(pdfUri);
        throw txErr;
      }

      const overviewWidget: ActiveWidgetEnvelope = {
        ui_widget_type: "JobLifecycleActionWidget",
        widget_payload: {
          job_id: finalJobId!,
          quote_id: finalQuoteId!,
          invoice_id: null,
          mode: "overview",
          pdf_uri: pdfUri,
        },
      };

      const outcome = decision.action === "edit" ? "edited" : "approved";
      await deps.traceRecorder.recordTrace({
        trace_id: postTraceId,
        parent_trace_id: parentTraceId,
        thread_id: threadId,
        turn_id: state.turn_trace.turn_id,
        turn_phase: "post_resume",
        routed_intent: state.routed_intent,
        node_sequence: ["quote_commit"],
        inference_engine: state.turn_trace.inference_engine,
        latency_ms: Math.max(0, Date.now() - resumedAtMs),
        rag_snippets: [],
        validated_widget: overviewWidget,
        hitl_gate_id: "gate_1_quote",
        hitl_outcome: outcome,
        rejection_reason: null,
        error_code: null,
        cloud_cost_eur: 0,
        created_at_ms: Date.now(),
      });

      return {
        active_job_id: finalJobId!,
        active_quote_id: finalQuoteId!,
        active_widget: overviewWidget,
        quick_actions: null,
        pending_gate: null,
        messages: [
          new AIMessage(
            `Presupuesto ${projectedQuoteCode} guardado con PDF listo (${formatCentsEs(totals.totalCents)}). Puedes enviarlo al cliente o emitir factura/anticipo.`
          ),
        ],
        turn_trace: {
          trace_id: postTraceId,
          parent_trace_id: parentTraceId,
          started_at_ms: resumedAtMs,
          append_node: "quote_commit",
        },
      };
    } catch (err) {
      const code = mapCommitErrorCode(err);
      await deps.traceRecorder.recordTrace({
        trace_id: postTraceId,
        parent_trace_id: parentTraceId,
        thread_id: threadId,
        turn_id: state.turn_trace.turn_id,
        turn_phase: "post_resume",
        routed_intent: state.routed_intent,
        node_sequence: ["quote_commit"],
        inference_engine: state.turn_trace.inference_engine,
        latency_ms: Math.max(0, Date.now() - resumedAtMs),
        rag_snippets: [],
        validated_widget: null,
        hitl_gate_id: "gate_1_quote",
        hitl_outcome: "rejected",
        rejection_reason: null,
        error_code: code,
        cloud_cost_eur: 0,
        created_at_ms: Date.now(),
      });

      return {
        active_widget: null,
        quick_actions: null,
        pending_gate: null,
        messages: [
          new AIMessage(
            `No se pudo guardar el presupuesto (${code}): ${
              err instanceof Error ? err.message : String(err)
            }`
          ),
        ],
        turn_trace: {
          trace_id: postTraceId,
          parent_trace_id: parentTraceId,
          started_at_ms: resumedAtMs,
          append_node: "quote_commit",
          error_code: code,
        },
      };
    }
  };
}

export function createOcrCommitNode(deps: GraphDependencies) {
  return async function ocrCommitNode(
    state: ObraLocalGraphState,
    config?: LangGraphRunnableConfig
  ): Promise<ObraLocalGraphUpdate> {
    if (state.active_widget?.ui_widget_type !== "TicketOcrValidatorWidget") {
      throw new Error("SCHEMA_VALIDATION_ERROR: Widget inválido para ocr_commit");
    }
    const proposed = stripTicketDisplayFields(state.active_widget.widget_payload);
    const summaryEs =
      (state.extracted_entities?.gate2_summary_es as string | undefined) ??
      `Ticket detectado de ${proposed.supplier_name || "Proveedor sin identificar"} (${formatCentsEs(proposed.total_cents)}).`;

    const interruptPayload: InterruptPayload = {
      gate_id: "gate_2_ticket",
      title: "Validar ticket de gasto antes de archivar",
      summary_es: summaryEs,
      requires_fiscal_lock: false,
      ui_widget_type: "TicketOcrValidatorWidget",
      proposed_payload: proposed,
    };

    const rawDecision = interrupt(interruptPayload);
    const resumedAtMs = Date.now();
    const threadId = getThreadIdFromConfig(config);
    const postTraceId = `tr_${crypto.randomUUID().slice(0, 12)}`;
    const parentTraceId = state.turn_trace.trace_id;

    try {
      const decision = HumanDecisionSchema.parse(rawDecision);
      if (decision.gate_id !== "gate_2_ticket") {
        throw new Error("SCHEMA_VALIDATION_ERROR: gate_id incompatible en ocr_commit");
      }

      if (decision.action === "reject") {
        await deps.fileBridge.deleteIfTemp(proposed.media_uri);
        await deps.traceRecorder.recordTrace({
          trace_id: postTraceId,
          parent_trace_id: parentTraceId,
          thread_id: threadId,
          turn_id: state.turn_trace.turn_id,
          turn_phase: "post_resume",
          routed_intent: state.routed_intent,
          node_sequence: ["ocr_commit"],
          inference_engine: state.turn_trace.inference_engine,
          latency_ms: Math.max(0, Date.now() - resumedAtMs),
          rag_snippets: [],
          validated_widget: null,
          hitl_gate_id: "gate_2_ticket",
          hitl_outcome: "rejected",
          rejection_reason: decision.rejection_reason ?? null,
          error_code: null,
          cloud_cost_eur: 0,
          created_at_ms: Date.now(),
        });

        return {
          active_widget: null,
          quick_actions: null,
          pending_gate: null,
          messages: [
            new AIMessage(
              decision.rejection_reason
                ? `Ticket descartado (${decision.rejection_reason}).`
                : "Ticket descartado sin archivar."
            ),
          ],
          turn_trace: {
            trace_id: postTraceId,
            parent_trace_id: parentTraceId,
            started_at_ms: resumedAtMs,
            append_node: "ocr_commit",
            rejection_reason: decision.rejection_reason ?? null,
          },
        };
      }

      const committed =
        decision.action === "edit"
          ? decision.edited_payload ??
            (() => {
              throw new Error("SCHEMA_VALIDATION_ERROR: edited_payload obligatorio en edit");
            })()
          : Gate2TicketCommitPayloadSchema.parse(proposed);

      const committedMediaUri =
        committed.media_uri !== null
          ? await deps.fileBridge.commitMedia(committed.media_uri, "tickets")
          : null;

      const vatRateLabel = String(
        committed.vat_rate ?? deriveRateOrMixed(committed.base_cents, committed.vat_cents)
      );
      const now = Date.now();
      const ticketId = `tkt_${crypto.randomUUID().slice(0, 12)}`;

      try {
        await deps.executor.inTransaction(async (tx) => {
          if (committed.job_id !== null) {
            const jobRows = await tx.query<{ id: string }>(
              `SELECT id FROM jobs WHERE id = ? LIMIT 1`,
              [committed.job_id]
            );
            if (!jobRows[0]) {
              throw new Error("INVALID_STATE_TRANSITION: La obra vinculada ya no existe");
            }
          }
          await tx.run(
            `INSERT INTO expense_tickets (
              id, job_id, supplier_name, supplier_nif, issue_date_iso, quarter,
              category, vat_rate_label, base_cents, vat_cents, total_cents,
              ocr_confidence, image_uri, created_at_ms, updated_at_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              ticketId,
              committed.job_id,
              committed.supplier_name.trim(),
              committed.supplier_nif,
              committed.issue_date_iso,
              committed.quarter,
              committed.category,
              vatRateLabel,
              committed.base_cents,
              committed.vat_cents,
              committed.total_cents,
              committed.ocr_confidence,
              committedMediaUri,
              now,
              now,
            ]
          );
        });
      } catch (txErr) {
        if (committedMediaUri) {
          await deps.fileBridge.rollbackCommittedMedia(
            committedMediaUri,
            committed.media_uri ?? undefined
          );
        }
        throw txErr;
      }

      const jobChanged =
        committed.job_id !== null && committed.job_id !== state.active_job_id;
      const nextActiveJobId = jobChanged ? committed.job_id : state.active_job_id;
      const nextActiveQuoteId = jobChanged ? null : state.active_quote_id;

      const quickActions = [
        {
          id: "qa_open_fiscal_after_ticket",
          label: `Ver Hucha Fiscal ${committed.quarter}`,
          action_type: "open_fiscal_piggybank" as const,
          payload: { quarter: committed.quarter },
        },
      ];

      await deps.traceRecorder.recordTrace({
        trace_id: postTraceId,
        parent_trace_id: parentTraceId,
        thread_id: threadId,
        turn_id: state.turn_trace.turn_id,
        turn_phase: "post_resume",
        routed_intent: state.routed_intent,
        node_sequence: ["ocr_commit"],
        inference_engine: state.turn_trace.inference_engine,
        latency_ms: Math.max(0, Date.now() - resumedAtMs),
        rag_snippets: [],
        validated_widget: null,
        hitl_gate_id: "gate_2_ticket",
        hitl_outcome: decision.action === "edit" ? "edited" : "approved",
        rejection_reason: null,
        error_code: null,
        cloud_cost_eur: 0,
        created_at_ms: Date.now(),
      });

      return {
        active_job_id: nextActiveJobId,
        active_quote_id: nextActiveQuoteId,
        active_widget: null,
        quick_actions: quickActions,
        pending_gate: null,
        messages: [
          new AIMessage(
            `Ticket archivado en ${committed.quarter}: ${committed.supplier_name} por ${formatCentsEs(committed.total_cents)} (IVA deducible ${formatCentsEs(committed.vat_cents)}).`
          ),
        ],
        turn_trace: {
          trace_id: postTraceId,
          parent_trace_id: parentTraceId,
          started_at_ms: resumedAtMs,
          append_node: "ocr_commit",
        },
      };
    } catch (err) {
      const code = mapCommitErrorCode(err);
      await deps.traceRecorder.recordTrace({
        trace_id: postTraceId,
        parent_trace_id: parentTraceId,
        thread_id: threadId,
        turn_id: state.turn_trace.turn_id,
        turn_phase: "post_resume",
        routed_intent: state.routed_intent,
        node_sequence: ["ocr_commit"],
        inference_engine: state.turn_trace.inference_engine,
        latency_ms: Math.max(0, Date.now() - resumedAtMs),
        rag_snippets: [],
        validated_widget: null,
        hitl_gate_id: "gate_2_ticket",
        hitl_outcome: "rejected",
        rejection_reason: null,
        error_code: code,
        cloud_cost_eur: 0,
        created_at_ms: Date.now(),
      });

      return {
        active_widget: null,
        quick_actions: null,
        pending_gate: null,
        messages: [
          new AIMessage(
            `No se pudo archivar el ticket (${code}): ${
              err instanceof Error ? err.message : String(err)
            }`
          ),
        ],
        turn_trace: {
          trace_id: postTraceId,
          parent_trace_id: parentTraceId,
          started_at_ms: resumedAtMs,
          append_node: "ocr_commit",
          error_code: code,
        },
      };
    }
  };
}

export function createLifecycleCommitNode(deps: GraphDependencies) {
  const quotesRepo = new QuotesRepository(deps.executor, deps.memoryCoordinator);
  const invoicesRepo = new InvoicesRepository(deps.executor, deps.memoryCoordinator);
  const settingsRepo = new SettingsRepository(deps.executor);

  return async function lifecycleCommitNode(
    state: ObraLocalGraphState,
    config?: LangGraphRunnableConfig
  ): Promise<ObraLocalGraphUpdate> {
    if (state.active_widget?.ui_widget_type !== "JobLifecycleActionWidget") {
      throw new Error("SCHEMA_VALIDATION_ERROR: Widget inválido para lifecycle_commit");
    }

    const wp = state.active_widget.widget_payload;
    const isGate4 = state.pending_gate === "gate_4_share" || wp.mode === "preview_gate_4";

    let interruptPayload: InterruptPayload;
    if (isGate4) {
      if (!wp.gate_4_draft) {
        throw new Error("SCHEMA_VALIDATION_ERROR: Falta gate_4_draft para gate_4_share");
      }
      const proposed: Gate4ShareDraftPayload = wp.gate_4_draft;
      interruptPayload = {
        gate_id: "gate_4_share",
        title: "Confirmar envío al cliente",
        summary_es: `Confirmar envío de ${
          proposed.document_kind === "invoice" ? "factura" : "presupuesto"
        } por ${proposed.channel === "whatsapp" ? "WhatsApp" : "hoja de compartir"}.`,
        requires_fiscal_lock: false,
        ui_widget_type: "JobLifecycleActionWidget",
        proposed_payload: proposed,
      };
    } else {
      if (!wp.gate_3_draft) {
        throw new Error("SCHEMA_VALIDATION_ERROR: Falta gate_3_draft para gate_3_invoice");
      }
      const proposed: Gate3InvoiceDraftPayload = wp.gate_3_draft;
      interruptPayload = {
        gate_id: "gate_3_invoice",
        title: "Confirmar emisión de factura",
        summary_es:
          proposed.sub_intent === "advance_40"
            ? "Confirmar emisión de factura de anticipo 40 % correlativa."
            : "Confirmar emisión de factura correlativa con instantánea fiscal inmutable.",
        requires_fiscal_lock: true,
        ui_widget_type: "JobLifecycleActionWidget",
        proposed_payload: proposed,
      };
    }

    const expectedGate = interruptPayload.gate_id;
    const rawDecision = interrupt(interruptPayload);
    const resumedAtMs = Date.now();
    const threadId = getThreadIdFromConfig(config);
    const postTraceId = `tr_${crypto.randomUUID().slice(0, 12)}`;
    const parentTraceId = state.turn_trace.trace_id;

    try {
      const decision = HumanDecisionSchema.parse(rawDecision);
      if (decision.gate_id !== expectedGate) {
        throw new Error("SCHEMA_VALIDATION_ERROR: gate_id incompatible en lifecycle_commit");
      }

      if (decision.action === "reject") {
        await deps.traceRecorder.recordTrace({
          trace_id: postTraceId,
          parent_trace_id: parentTraceId,
          thread_id: threadId,
          turn_id: state.turn_trace.turn_id,
          turn_phase: "post_resume",
          routed_intent: state.routed_intent,
          node_sequence: ["lifecycle_commit"],
          inference_engine: state.turn_trace.inference_engine,
          latency_ms: Math.max(0, Date.now() - resumedAtMs),
          rag_snippets: [],
          validated_widget: null,
          hitl_gate_id: expectedGate,
          hitl_outcome: "rejected",
          rejection_reason: decision.rejection_reason ?? null,
          error_code: null,
          cloud_cost_eur: 0,
          created_at_ms: Date.now(),
        });

        return {
          active_widget: null,
          quick_actions: null,
          pending_gate: null,
          messages: [
            new AIMessage(
              decision.rejection_reason
                ? `Acción cancelada (${decision.rejection_reason}).`
                : "Acción cancelada sin cambios."
            ),
          ],
          turn_trace: {
            trace_id: postTraceId,
            parent_trace_id: parentTraceId,
            started_at_ms: resumedAtMs,
            append_node: "lifecycle_commit",
            rejection_reason: decision.rejection_reason ?? null,
          },
        };
      }

      const now = Date.now();

      if (decision.gate_id === "gate_4_share") {
        const committed =
          decision.action === "edit"
            ? decision.edited_payload ??
              (() => {
                throw new Error("SCHEMA_VALIDATION_ERROR: edited_payload obligatorio en edit");
              })()
            : Gate4ShareCommitPayloadSchema.parse(interruptPayload.proposed_payload);

        let pdfUri: string | null = null;
        let docJobId = wp.job_id;
        let docQuoteId = wp.quote_id;
        let docClientId = "";

        if (committed.document_kind === "invoice") {
          const inv = await invoicesRepo.getById(committed.document_id);
          if (!inv) {
            throw new Error("INVALID_STATE_TRANSITION: La factura ya no existe");
          }
          pdfUri = inv.pdf_uri;
          docJobId = inv.job_id;
          docQuoteId = inv.quote_id;
          docClientId = inv.client_id;
        } else {
          const quote = await quotesRepo.getById(committed.document_id);
          if (!quote || quote.status === "rechazado") {
            throw new Error("INVALID_STATE_TRANSITION: El presupuesto ya no es válido para enviar");
          }
          pdfUri = quote.pdf_uri;
          docJobId = quote.job_id;
          docQuoteId = quote.id;
          docClientId = quote.client_id;
        }

        if (committed.recipient_phone.length > 0 && docClientId) {
          await deps.executor.inTransaction(async (tx) => {
            await tx.run(
              `UPDATE clients SET phone = ?, updated_at_ms = ? WHERE id = ?`,
              [committed.recipient_phone, now, docClientId]
            );
          });
        }

        // Si falta pdf_uri, regenerar bajo demanda dejando sent_at_iso intacto
        if (!pdfUri) {
          pdfUri =
            committed.document_kind === "invoice"
              ? await invoicesRepo.regeneratePdfOnDemand(
                  committed.document_id,
                  deps.pdfPort,
                  deps.fileBridge
                )
              : await quotesRepo.regeneratePdfOnDemand(
                  committed.document_id,
                  deps.pdfPort,
                  deps.fileBridge
                );
        }

        const readyWidget: ActiveWidgetEnvelope = {
          ui_widget_type: "JobLifecycleActionWidget",
          widget_payload: {
            job_id: docJobId,
            quote_id: docQuoteId,
            invoice_id: committed.document_kind === "invoice" ? committed.document_id : null,
            mode: "ready_to_share",
            pdf_uri: pdfUri,
            gate_4_draft: committed,
          },
        };

        await deps.traceRecorder.recordTrace({
          trace_id: postTraceId,
          parent_trace_id: parentTraceId,
          thread_id: threadId,
          turn_id: state.turn_trace.turn_id,
          turn_phase: "post_resume",
          routed_intent: state.routed_intent,
          node_sequence: ["lifecycle_commit"],
          inference_engine: state.turn_trace.inference_engine,
          latency_ms: Math.max(0, Date.now() - resumedAtMs),
          rag_snippets: [],
          validated_widget: readyWidget,
          hitl_gate_id: "gate_4_share",
          hitl_outcome: decision.action === "edit" ? "edited" : "approved",
          rejection_reason: null,
          error_code: null,
          cloud_cost_eur: 0,
          created_at_ms: Date.now(),
        });

        return {
          active_job_id: docJobId,
          active_quote_id: docQuoteId,
          active_widget: readyWidget,
          quick_actions: null,
          pending_gate: null,
          messages: [
            new AIMessage(
              "Envío autorizado y PDF verificado. Pulsa 'Abrir Compartir / WhatsApp' para enviarlo al cliente."
            ),
          ],
          turn_trace: {
            trace_id: postTraceId,
            parent_trace_id: parentTraceId,
            started_at_ms: resumedAtMs,
            append_node: "lifecycle_commit",
          },
        };
      }

      // --- Gate 3: Emisión de Anticipo 40% o Factura Correlativa ---
      const committed =
        decision.action === "edit"
          ? decision.edited_payload ??
            (() => {
              throw new Error("SCHEMA_VALIDATION_ERROR: edited_payload obligatorio en edit");
            })()
          : Gate3InvoiceCommitPayloadSchema.parse(interruptPayload.proposed_payload);

      const liveQuote = await quotesRepo.getById(committed.quote_id);
      if (!liveQuote || liveQuote.status === "rechazado") {
        throw new Error(
          "INVALID_STATE_TRANSITION: El presupuesto ya no existe o está rechazado"
        );
      }
      const liveJobRows = await deps.executor.query<JobRow>(
        `SELECT * FROM jobs WHERE id = ? LIMIT 1`,
        [committed.job_id]
      );
      const liveJob = liveJobRows[0];
      if (!liveJob || liveJob.status === "cancelado") {
        throw new Error("INVALID_STATE_TRANSITION: La obra ya no existe o está cancelada");
      }

      const existingInvoices = await invoicesRepo.listByJobId(committed.job_id);
      const existingAnt = existingInvoices.find((i) => i.series_type === "ANT") ?? null;
      const existingFac = existingInvoices.find((i) => i.series_type === "FAC") ?? null;

      if (committed.sub_intent === "advance_40" && (existingAnt || existingFac)) {
        throw new Error(
          "INVALID_STATE_TRANSITION: No se puede emitir anticipo 40 % sobre una obra con ANT o FAC previa"
        );
      }
      if (committed.sub_intent === "final_invoice" && existingFac) {
        throw new Error("INVALID_STATE_TRANSITION: La factura final FAC ya fue emitida");
      }

      const seriesType = committed.sub_intent === "advance_40" ? "ANT" : "FAC";
      const fiscalYear = getFiscalYearFromIso(committed.issued_at_iso);
      const quarter = deriveFiscalQuarter(committed.issued_at_iso);
      const maxRows = await deps.executor.query<{ max_issued: string | null }>(
        `SELECT MAX(issued_at_iso) AS max_issued FROM invoices WHERE series_type = ?`,
        [seriesType]
      );
      const maxIssued = maxRows[0]?.max_issued ?? null;
      if (maxIssued && committed.issued_at_iso < maxIssued) {
        throw new Error(
          `INVALID_STATE_TRANSITION: La fecha de emisión (${committed.issued_at_iso}) no puede ser anterior a la última factura ${seriesType} (${maxIssued})`
        );
      }

      let invoiceKind: InvoiceKind;
      let baseCents: number;
      let vatCents: number;
      let totalCents: number;
      let deductedBase = 0;
      let deductedVat = 0;
      let advanceInvoiceId: string | null = null;

      if (committed.sub_intent === "advance_40") {
        invoiceKind = "advance_40";
        const adv = computeAdvance40(liveQuote.subtotal_cents, liveQuote.vat_rate);
        baseCents = adv.baseCents;
        vatCents = adv.vatCents;
        totalCents = adv.totalCents;
      } else if (existingAnt) {
        invoiceKind = "final";
        deductedBase = existingAnt.base_cents;
        deductedVat = existingAnt.vat_cents;
        advanceInvoiceId = existingAnt.id;
        const fin = computeFinalInvoiceFromQuoteAndAdvance(
          liveQuote.subtotal_cents,
          liveQuote.vat_cents,
          deductedBase,
          deductedVat
        );
        baseCents = fin.baseCents;
        vatCents = fin.vatCents;
        totalCents = fin.totalCents;
      } else {
        invoiceKind = "full";
        baseCents = liveQuote.subtotal_cents;
        vatCents = liveQuote.vat_cents;
        totalCents = liveQuote.total_cents;
      }

      const projectedNumber = await peekNextSequenceCode(deps.executor, seriesType, fiscalYear);
      const settings = await settingsRepo.getAppSettings();
      const clientRows = await deps.executor.query<ClientRow>(
        `SELECT * FROM clients WHERE id = ? LIMIT 1`,
        [committed.client_id]
      );
      const clientRow = clientRows[0];
      const clientName = clientRow?.name || liveQuote.client_name_snapshot;
      const clientPhone = clientRow?.phone || liveQuote.client_phone_snapshot;

      const pdfInput: PdfInvoiceDocumentInput = {
        kind: "invoice",
        invoiceNumber: projectedNumber,
        invoiceKind,
        issuedAtIso: committed.issued_at_iso,
        dueAtIso: committed.due_at_iso,
        emitter: {
          name: committed.emitter_name,
          nif: committed.emitter_nif,
          fiscalAddress: committed.emitter_fiscal_address,
          phone: settings.emitter_phone,
          iban: settings.emitter_iban,
          logoDataUrl: settings.emitter_logo_data_url,
        },
        client: {
          name: clientName,
          nif: committed.client_nif,
          fiscalAddress: committed.client_fiscal_address,
          phone: clientPhone,
        },
        jobCode: liveJob.job_code,
        jobTitle: liveJob.title,
        quoteCode: liveQuote.quote_code,
        vatRate: liveQuote.vat_rate,
        baseCents,
        vatCents,
        totalCents,
        advanceDeductedBaseCents: deductedBase,
        advanceDeductedVatCents: deductedVat,
        notes: committed.notes,
      };

      const releasePdf = await deps.memoryCoordinator.acquireHeavyTask("pdf");
      let pdfUri: string;
      try {
        const built = await deps.pdfPort.buildDocumentPdf(pdfInput);
        pdfUri = await deps.fileBridge.savePdf(built.pdfBytes, built.fileName);
      } catch (pdfErr) {
        const msg = pdfErr instanceof Error ? pdfErr.message : String(pdfErr);
        if (msg.includes("LAZY_CHUNK_LOAD_ERROR") || msg.includes("STORAGE_QUOTA_EXCEEDED")) {
          throw pdfErr;
        }
        throw new Error(`PDF_BUILD_ERROR: ${msg}`);
      } finally {
        await releasePdf();
      }

      const newInvoiceId = `inv_${crypto.randomUUID().slice(0, 12)}`;
      try {
        await deps.executor.inTransaction(async (tx) => {
          const txJobRows = await tx.query<JobRow>(
            `SELECT * FROM jobs WHERE id = ? LIMIT 1`,
            [committed.job_id]
          );
          if (!txJobRows[0] || txJobRows[0].status === "cancelado") {
            throw new Error("INVALID_STATE_TRANSITION: Obra cancelada durante la emisión");
          }
          const txQuoteRows = await tx.query<QuoteRow>(
            `SELECT * FROM quotes WHERE id = ? LIMIT 1`,
            [committed.quote_id]
          );
          if (!txQuoteRows[0] || txQuoteRows[0].status === "rechazado") {
            throw new Error("INVALID_STATE_TRANSITION: Presupuesto rechazado durante la emisión");
          }
          const txExisting = await tx.query<InvoiceRow>(
            `SELECT * FROM invoices WHERE job_id = ?`,
            [committed.job_id]
          );
          if (
            (seriesType === "ANT" && txExisting.some((i) => i.series_type === "ANT" || i.series_type === "FAC")) ||
            (seriesType === "FAC" && txExisting.some((i) => i.series_type === "FAC"))
          ) {
            throw new Error("INVALID_STATE_TRANSITION: Conflicto concurrente de factura");
          }

          const { code: allocatedNumber } = await allocateNextSequence(
            tx,
            seriesType,
            fiscalYear,
            now
          );
          if (allocatedNumber !== projectedNumber) {
            throw new Error("INVALID_STATE_TRANSITION: Desajuste de correlativo en secuencia");
          }

          await tx.run(
            `INSERT INTO app_settings (
              id, emitter_name, emitter_nif, emitter_fiscal_address, emitter_phone,
              last_active_thread_id, pending_camera_context_json, llm_enabled, llm_model_uri,
              boot_mode, updated_at_ms
            ) VALUES (1, ?, ?, ?, ?, NULL, NULL, 1, NULL, 'clean', ?)
            ON CONFLICT(id) DO UPDATE SET
              emitter_name = excluded.emitter_name,
              emitter_nif = excluded.emitter_nif,
              emitter_fiscal_address = excluded.emitter_fiscal_address,
              updated_at_ms = excluded.updated_at_ms`,
            [
              committed.emitter_name,
              committed.emitter_nif,
              committed.emitter_fiscal_address,
              settings.emitter_phone,
              now,
            ]
          );

          await tx.run(
            `UPDATE clients SET nif = ?, fiscal_address = ?, updated_at_ms = ? WHERE id = ?`,
            [committed.client_nif, committed.client_fiscal_address, now, committed.client_id]
          );

          await tx.run(
            `INSERT INTO invoices (
              id, invoice_number, series_type, fiscal_year, kind, job_id, quote_id, client_id,
              emitter_nif_snapshot, emitter_name_snapshot, emitter_address_snapshot,
              client_name_snapshot, client_nif_snapshot, client_address_snapshot,
              client_phone_snapshot, issued_at_iso, due_at_iso, quarter,
              paid_at_iso, paid_quarter, sent_at_iso, vat_rate, base_cents, vat_cents,
              total_cents, advance_deducted_base_cents, advance_deducted_vat_cents,
              advance_invoice_id, status, notes, pdf_uri, created_at_ms, updated_at_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, 'pendiente_cobro', ?, ?, ?, ?)`,
            [
              newInvoiceId,
              allocatedNumber,
              seriesType,
              fiscalYear,
              invoiceKind,
              committed.job_id,
              committed.quote_id,
              committed.client_id,
              committed.emitter_nif,
              committed.emitter_name,
              committed.emitter_fiscal_address,
              clientName,
              committed.client_nif,
              committed.client_fiscal_address,
              clientPhone,
              committed.issued_at_iso,
              committed.due_at_iso,
              quarter,
              liveQuote.vat_rate,
              baseCents,
              vatCents,
              totalCents,
              deductedBase,
              deductedVat,
              advanceInvoiceId,
              committed.notes,
              pdfUri,
              now,
              now,
            ]
          );

          await tx.run(
            `UPDATE quotes SET status = 'aceptado', updated_at_ms = ? WHERE id = ?`,
            [now, committed.quote_id]
          );
        });
      } catch (txErr) {
        await deps.fileBridge.deletePdf(pdfUri);
        throw txErr;
      }

      const overviewWidget: ActiveWidgetEnvelope = {
        ui_widget_type: "JobLifecycleActionWidget",
        widget_payload: {
          job_id: committed.job_id,
          quote_id: committed.quote_id,
          invoice_id: newInvoiceId,
          mode: "overview",
          pdf_uri: pdfUri,
        },
      };

      await deps.traceRecorder.recordTrace({
        trace_id: postTraceId,
        parent_trace_id: parentTraceId,
        thread_id: threadId,
        turn_id: state.turn_trace.turn_id,
        turn_phase: "post_resume",
        routed_intent: state.routed_intent,
        node_sequence: ["lifecycle_commit"],
        inference_engine: state.turn_trace.inference_engine,
        latency_ms: Math.max(0, Date.now() - resumedAtMs),
        rag_snippets: [],
        validated_widget: overviewWidget,
        hitl_gate_id: "gate_3_invoice",
        hitl_outcome: decision.action === "edit" ? "edited" : "approved",
        rejection_reason: null,
        error_code: null,
        cloud_cost_eur: 0,
        created_at_ms: Date.now(),
      });

      return {
        active_job_id: committed.job_id,
        active_quote_id: committed.quote_id,
        active_widget: overviewWidget,
        quick_actions: null,
        pending_gate: null,
        messages: [
          new AIMessage(
            `Documento ${projectedNumber} emitido correctamente (${formatCentsEs(totalCents)}, vencimiento ${committed.due_at_iso}). PDF local guardado.`
          ),
        ],
        turn_trace: {
          trace_id: postTraceId,
          parent_trace_id: parentTraceId,
          started_at_ms: resumedAtMs,
          append_node: "lifecycle_commit",
        },
      };
    } catch (err) {
      const code = mapCommitErrorCode(err);
      await deps.traceRecorder.recordTrace({
        trace_id: postTraceId,
        parent_trace_id: parentTraceId,
        thread_id: threadId,
        turn_id: state.turn_trace.turn_id,
        turn_phase: "post_resume",
        routed_intent: state.routed_intent,
        node_sequence: ["lifecycle_commit"],
        inference_engine: state.turn_trace.inference_engine,
        latency_ms: Math.max(0, Date.now() - resumedAtMs),
        rag_snippets: [],
        validated_widget: null,
        hitl_gate_id: expectedGate,
        hitl_outcome: "rejected",
        rejection_reason: null,
        error_code: code,
        cloud_cost_eur: 0,
        created_at_ms: Date.now(),
      });

      return {
        active_widget: null,
        quick_actions: null,
        pending_gate: null,
        messages: [
          new AIMessage(
            `No se pudo completar la operación (${code}): ${
              err instanceof Error ? err.message : String(err)
            }`
          ),
        ],
        turn_trace: {
          trace_id: postTraceId,
          parent_trace_id: parentTraceId,
          started_at_ms: resumedAtMs,
          append_node: "lifecycle_commit",
          error_code: code,
        },
      };
    }
  };
}
