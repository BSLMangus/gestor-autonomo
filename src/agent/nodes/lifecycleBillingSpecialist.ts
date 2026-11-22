import { AIMessage } from "@langchain/core/messages";
import type {
  ActiveWidgetEnvelope,
  BillingSubIntent,
  JobRow,
  PendingDisambiguation,
  PendingGate,
  RagSnippet,
  ResolvedTarget,
} from "../../core/contracts/types";
import { ClientsRepository } from "../../core/db/repositories/clientsRepo";
import { InvoicesRepository } from "../../core/db/repositories/invoicesRepo";
import { JobsRepository } from "../../core/db/repositories/jobsRepo";
import { QuotesRepository } from "../../core/db/repositories/quotesRepo";
import { SettingsRepository } from "../../core/db/repositories/settingsRepo";
import { addDaysIso, getLocalTodayIso } from "../../core/fiscal/dateQuarter";
import type { GraphDependencies } from "../ports";
import type { ObraLocalGraphState, ObraLocalGraphUpdate } from "../state";

export function createLifecycleBillingSpecialistNode(deps: GraphDependencies) {
  const jobsRepo = new JobsRepository(deps.executor);
  const quotesRepo = new QuotesRepository(deps.executor);
  const invoicesRepo = new InvoicesRepository(deps.executor);
  const clientsRepo = new ClientsRepository(deps.executor);
  const settingsRepo = new SettingsRepository(deps.executor);

  return async function lifecycleBillingSpecialistNode(
    state: ObraLocalGraphState
  ): Promise<ObraLocalGraphUpdate> {
    try {
      const input = state.input_payload;
      const resolvedTarget = (state.extracted_entities?.resolved_target ?? {}) as ResolvedTarget;
      const snippets: RagSnippet[] = [];

      let subIntent: BillingSubIntent = "overview";
      if (input?.action_type === "request_advance_gate") subIntent = "advance_40";
      else if (input?.action_type === "request_invoice_gate") subIntent = "final_invoice";
      else if (input?.action_type === "request_share_gate") subIntent = "share";
      else if (input?.action_type === "open_job_overview") subIntent = "overview";
      else if (input?.billing_sub_intent) subIntent = input.billing_sub_intent;
      else if (state.extracted_entities?.billing_sub_intent) {
        subIntent = state.extracted_entities.billing_sub_intent as BillingSubIntent;
      }

      let jobId =
        resolvedTarget.job_id ??
        input?.target_ids?.job_id ??
        null;
      let quoteId =
        resolvedTarget.quote_id ??
        input?.target_ids?.quote_id ??
        null;
      const invoiceId = input?.target_ids?.invoice_id ?? null;

      if (!jobId && invoiceId) {
        const inv = await invoicesRepo.getById(invoiceId);
        if (inv) {
          jobId = inv.job_id;
          quoteId = inv.quote_id;
        }
      }
      if (!jobId && quoteId) {
        const q = await quotesRepo.getById(quoteId);
        if (q) jobId = q.job_id;
      }

      const jobQuery = (state.extracted_entities?.job_query as string | null | undefined) ?? null;
      if (!jobId && jobQuery) {
        const matches = await jobsRepo.searchFts5WithScore(jobQuery, 5);
        for (const m of matches.slice(0, 2)) {
          snippets.push({
            source_table: "jobs",
            record_id: m.id,
            title: `${m.job_code} ${m.title}`,
            snippet_text: m.address || m.status,
            bm25_score: m.bm25_score,
          });
        }
        if (matches.length === 1) {
          jobId = matches[0]!.id;
        } else if (matches.length >= 2) {
          const pending: PendingDisambiguation = {
            original_intent: "lifecycle_billing_specialist",
            original_text: input?.text ?? "",
            preserved_target: resolvedTarget,
            prompt: "¿A cuál de estas obras te refieres?",
            candidates: matches.slice(0, 5).map((m) => ({
              entity_type: "job",
              id: m.id,
              label: `${m.job_code} · ${m.title}`,
              subtitle: m.address || m.status,
              job_id: m.id,
            })),
            attempts: 0,
          };
          return {
            routed_intent: "clarification_node",
            pending_disambiguation: pending,
            rag_snippets: snippets,
            pending_gate: null,
            turn_trace: {
              append_node: "lifecycle_billing_specialist",
              rag_hit_count: snippets.length,
            },
          };
        }
      }

      if (!jobId) {
        jobId = state.active_job_id;
      }

      const job: JobRow | null = jobId ? await jobsRepo.getById(jobId) : null;
      if (!job) {
        const recent = await jobsRepo.listPaginated({ limit: 5, offset: 0 });
        const pending: PendingDisambiguation = {
          original_intent: "lifecycle_billing_specialist",
          original_text: input?.text ?? "",
          preserved_target: resolvedTarget,
          prompt:
            recent.items.length > 0
              ? "Indica qué obra quieres consultar o facturar:"
              : "No hay obras registradas todavía.",
          candidates: recent.items.map((m) => ({
            entity_type: "job",
            id: m.id,
            label: `${m.job_code} · ${m.title}`,
            subtitle: m.status,
            job_id: m.id,
          })),
          attempts: 0,
        };
        return {
          routed_intent: "clarification_node",
          pending_disambiguation: pending,
          pending_gate: null,
          turn_trace: { append_node: "lifecycle_billing_specialist" },
        };
      }

      const activeQuote = quoteId
        ? await quotesRepo.getById(quoteId)
        : await quotesRepo.getActiveByJobId(job.id);
      const jobInvoices = await invoicesRepo.listByJobId(job.id);
      const antInv = jobInvoices.find((i) => i.series_type === "ANT") ?? null;
      const facInv = jobInvoices.find((i) => i.series_type === "FAC") ?? null;
      const latestInvoice = facInv ?? antInv ?? null;

      // Modo overview directo
      if (subIntent === "overview") {
        return {
          routed_intent: "lifecycle_billing_specialist",
          active_job_id: job.id,
          active_quote_id: activeQuote?.id ?? null,
          rag_snippets: snippets,
          active_widget: {
            ui_widget_type: "JobLifecycleActionWidget",
            widget_payload: {
              job_id: job.id,
              quote_id: activeQuote?.id ?? null,
              invoice_id: latestInvoice?.id ?? null,
              mode: "overview",
              pdf_uri: latestInvoice?.pdf_uri ?? activeQuote?.pdf_uri ?? null,
            },
          },
          pending_gate: null,
          messages: [new AIMessage(`Resumen actualizado de la obra ${job.job_code} (${job.title}).`)],
          turn_trace: {
            append_node: "lifecycle_billing_specialist",
            rag_hit_count: snippets.length,
          },
        };
      }

      // Gate 4: Envío externo (prioridad FAC > ANT > PRE no rechazado)
      if (subIntent === "share") {
        let docKind: "quote" | "invoice" | null = null;
        let docId: string | null = null;
        let docCode = "";
        let pdfUri: string | null = null;
        let clientId: string | null = job.client_id;

        if (invoiceId) {
          const explicitInv = jobInvoices.find((i) => i.id === invoiceId);
          if (explicitInv) {
            docKind = "invoice";
            docId = explicitInv.id;
            docCode = explicitInv.invoice_number;
            pdfUri = explicitInv.pdf_uri;
            clientId = explicitInv.client_id;
          }
        } else if (quoteId && activeQuote && activeQuote.status !== "rechazado" && input?.target_ids?.quote_id) {
          docKind = "quote";
          docId = activeQuote.id;
          docCode = activeQuote.quote_code;
          pdfUri = activeQuote.pdf_uri;
          clientId = activeQuote.client_id;
        } else if (facInv) {
          docKind = "invoice";
          docId = facInv.id;
          docCode = facInv.invoice_number;
          pdfUri = facInv.pdf_uri;
          clientId = facInv.client_id;
        } else if (antInv) {
          docKind = "invoice";
          docId = antInv.id;
          docCode = antInv.invoice_number;
          pdfUri = antInv.pdf_uri;
          clientId = antInv.client_id;
        } else if (activeQuote && activeQuote.status !== "rechazado") {
          docKind = "quote";
          docId = activeQuote.id;
          docCode = activeQuote.quote_code;
          pdfUri = activeQuote.pdf_uri;
          clientId = activeQuote.client_id;
        }

        if (!docKind || !docId) {
          return {
            routed_intent: "lifecycle_billing_specialist",
            active_job_id: job.id,
            active_quote_id: activeQuote?.id ?? null,
            active_widget: {
              ui_widget_type: "JobLifecycleActionWidget",
              widget_payload: {
                job_id: job.id,
                quote_id: activeQuote?.id ?? null,
                invoice_id: null,
                mode: "overview",
                pdf_uri: null,
              },
            },
            pending_gate: null,
            messages: [
              new AIMessage(
                `La obra ${job.job_code} no tiene ningún presupuesto activo ni factura disponible para enviar.`
              ),
            ],
            turn_trace: { append_node: "lifecycle_billing_specialist" },
          };
        }

        const client = clientId ? await clientsRepo.getById(clientId) : null;
        const recipientPhone = client?.phone ?? "";
        const widget: ActiveWidgetEnvelope = {
          ui_widget_type: "JobLifecycleActionWidget",
          widget_payload: {
            job_id: job.id,
            quote_id: activeQuote?.id ?? null,
            invoice_id: docKind === "invoice" ? docId : null,
            mode: "preview_gate_4",
            pdf_uri: pdfUri,
            gate_4_draft: {
              document_kind: docKind,
              document_id: docId,
              channel: recipientPhone ? "whatsapp" : "share_sheet",
              recipient_phone: recipientPhone,
              message_text: `Hola${client?.name ? ` ${client.name}` : ""}, te adjunto ${
                docKind === "invoice" ? `la factura ${docCode}` : `el presupuesto ${docCode}`
              } de la obra ${job.job_code}. Un saludo.`,
            },
          },
        };

        return {
          routed_intent: "lifecycle_billing_specialist",
          rag_snippets: snippets,
          active_widget: widget,
          pending_gate: "gate_4_share",
          messages: [
            new AIMessage(
              `Previsualización de envío para ${docCode}. Revisa el canal, teléfono y mensaje antes de compartir.`
            ),
          ],
          turn_trace: {
            append_node: "lifecycle_billing_specialist",
            rag_hit_count: snippets.length,
          },
        };
      }

      // Gate 3: Emisión de Anticipo 40% o Factura Final
      const quoteItems = activeQuote ? await quotesRepo.getItems(activeQuote.id) : [];
      const ineligibleReason =
        job.status === "cancelado"
          ? `La obra ${job.job_code} está cancelada.`
          : !activeQuote || activeQuote.status === "rechazado" || quoteItems.length === 0
            ? `La obra ${job.job_code} necesita un presupuesto no rechazado con al menos una partida para facturar.`
            : subIntent === "advance_40" && antInv
              ? `Ya existe un anticipo 40 % (${antInv.invoice_number}) en la obra ${job.job_code}.`
              : subIntent === "advance_40" && facInv
                ? `No se puede emitir un anticipo 40 % porque la factura final (${facInv.invoice_number}) ya fue emitida.`
                : subIntent === "final_invoice" && facInv
                  ? `La factura final (${facInv.invoice_number}) ya fue emitida para esta obra.`
                  : null;

      if (ineligibleReason || !activeQuote) {
        return {
          routed_intent: "lifecycle_billing_specialist",
          active_job_id: job.id,
          active_quote_id: activeQuote?.id ?? null,
          rag_snippets: snippets,
          active_widget: {
            ui_widget_type: "JobLifecycleActionWidget",
            widget_payload: {
              job_id: job.id,
              quote_id: activeQuote?.id ?? null,
              invoice_id: latestInvoice?.id ?? null,
              mode: "overview",
              pdf_uri: latestInvoice?.pdf_uri ?? activeQuote?.pdf_uri ?? null,
            },
          },
          pending_gate: null,
          messages: [
            new AIMessage(
              ineligibleReason ?? `No hay presupuesto elegible para facturar en ${job.job_code}.`
            ),
          ],
          turn_trace: {
            append_node: "lifecycle_billing_specialist",
            rag_hit_count: snippets.length,
          },
        };
      }

      const settings = await settingsRepo.getAppSettings();
      const client = await clientsRepo.getById(activeQuote.client_id);
      const series = subIntent === "advance_40" ? "ANT" : "FAC";
      const maxRows = await deps.executor.query<{ max_issued: string | null }>(
        `SELECT MAX(issued_at_iso) AS max_issued FROM invoices WHERE series_type = ?`,
        [series]
      );
      const todayIso = getLocalTodayIso();
      const maxIssued = maxRows[0]?.max_issued ?? null;
      const issuedAtIso = maxIssued && maxIssued > todayIso ? maxIssued : todayIso;
      const dueAtIso = addDaysIso(issuedAtIso, 30);

      const gate3Widget: ActiveWidgetEnvelope = {
        ui_widget_type: "JobLifecycleActionWidget",
        widget_payload: {
          job_id: job.id,
          quote_id: activeQuote.id,
          invoice_id: null,
          mode: "preview_gate_3",
          pdf_uri: null,
          gate_3_draft: {
            sub_intent: subIntent,
            quote_id: activeQuote.id,
            job_id: job.id,
            issued_at_iso: issuedAtIso,
            due_at_iso: dueAtIso,
            emitter_name: settings.emitter_name,
            emitter_nif: settings.emitter_nif,
            emitter_fiscal_address: settings.emitter_fiscal_address,
            client_id: activeQuote.client_id,
            client_nif: client?.nif || activeQuote.client_nif_snapshot || "",
            client_fiscal_address:
              client?.fiscal_address || activeQuote.client_address_snapshot || "",
            notes:
              subIntent === "advance_40"
                ? `Anticipo 40 % sobre presupuesto ${activeQuote.quote_code}.`
                : antInv
                  ? `Factura final con deducción íntegra de ${antInv.invoice_number}.`
                  : `Factura completa sobre presupuesto ${activeQuote.quote_code}.`,
          },
        },
      };

      const pendingGate: PendingGate = "gate_3_invoice";
      return {
        routed_intent: "lifecycle_billing_specialist",
        rag_snippets: snippets,
        active_widget: gate3Widget,
        pending_gate: pendingGate,
        messages: [
          new AIMessage(
            `Borrador fiscal listo (${subIntent === "advance_40" ? "Anticipo 40 %" : "Factura correlativa"}) para ${job.job_code}. Verifica NIF/dirección de emisor y cliente antes de confirmar la emisión legal.`
          ),
        ],
        turn_trace: {
          append_node: "lifecycle_billing_specialist",
          rag_hit_count: snippets.length,
        },
      };
    } catch (err) {
      return {
        routed_intent: "lifecycle_billing_specialist",
        active_widget: null,
        pending_gate: null,
        messages: [
          new AIMessage(
            `Error preparando gestión de obra/factura: ${
              err instanceof Error ? err.message : String(err)
            }`
          ),
        ],
        turn_trace: {
          append_node: "lifecycle_billing_specialist",
          error_code: "SQLITE_QUERY_ERROR",
        },
      };
    }
  };
}
