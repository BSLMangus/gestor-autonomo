import { AIMessage } from "@langchain/core/messages";
import type {
  ActiveWidgetEnvelope,
  PendingDisambiguation,
  RagSnippet,
  ResolvedTarget,
} from "../../core/contracts/types";
import { CatalogRepository } from "../../core/db/repositories/catalogRepo";
import { InvoicesRepository } from "../../core/db/repositories/invoicesRepo";
import { JobsRepository } from "../../core/db/repositories/jobsRepo";
import { QuotesRepository } from "../../core/db/repositories/quotesRepo";
import { TicketsRepository } from "../../core/db/repositories/ticketsRepo";
import { computeJobSummary, formatCentsEs } from "../../core/fiscal/fiscalEngine";
import { validateSpanishTaxId } from "../../core/fiscal/taxIdValidator";
import {
  extractClientFieldsFromText,
  normalizeSpanishText,
  type ParsedClientFields,
} from "../inference/deterministicSpanishParser";
import type { GraphDependencies } from "../ports";
import type { ObraLocalGraphState, ObraLocalGraphUpdate } from "../state";

export function createAssistantQaNode(deps: GraphDependencies) {
  const jobsRepo = new JobsRepository(deps.executor);
  const quotesRepo = new QuotesRepository(deps.executor);
  const invoicesRepo = new InvoicesRepository(deps.executor);
  const ticketsRepo = new TicketsRepository(deps.executor);
  const catalogRepo = new CatalogRepository(deps.executor);

  return async function assistantQaNode(
    state: ObraLocalGraphState
  ): Promise<ObraLocalGraphUpdate> {
    try {
      const entities = state.extracted_entities ?? {};
      if (entities.cancelled_disambiguation) {
        return {
          routed_intent: "assistant_qa_node",
          active_widget: null,
          pending_gate: null,
          quick_actions: null,
          messages: [new AIMessage("Operación cancelada. Dime qué necesitas hacer ahora.")],
          turn_trace: { append_node: "assistant_qa_node" },
        };
      }

      if (entities.expired_disambiguation) {
        return {
          routed_intent: "assistant_qa_node",
          active_widget: null,
          pending_gate: null,
          quick_actions: null,
          messages: [
            new AIMessage(
              "El acceso rápido anterior ha caducado o el registro ya no existe. Escribe una nueva consulta."
            ),
          ],
          turn_trace: { append_node: "assistant_qa_node" },
        };
      }

      const inputText = state.input_payload?.text ?? "";
      const norm = normalizeSpanishText(inputText);
      const resolvedTarget = (entities.resolved_target ?? {}) as ResolvedTarget;
      const snippets: RagSnippet[] = [];

      // 0. Alta conversacional de cliente -> abre ClientProfileWidget editable
      const clientDraftFromEntities =
        (entities.new_client_draft as ParsedClientFields | undefined) ??
        (typeof entities.client_onboarding_input === "string"
          ? extractClientFieldsFromText(entities.client_onboarding_input)
          : undefined);

      if (clientDraftFromEntities) {
        const cleanedNif = (clientDraftFromEntities.nif ?? "").trim().toUpperCase();
        const hasInvalidNif = cleanedNif.length > 0 && !validateSpanishTaxId(cleanedNif);
        let validationHint: string | null = null;
        if (!clientDraftFromEntities.name) {
          validationHint = "Completa el nombre completo del cliente antes de confirmar.";
        } else if (hasInvalidNif) {
          validationHint = `El NIF «${cleanedNif}» no supera el dígito de control; corrígelo o déjalo vacío (es opcional).`;
        }

        const clientWidget: ActiveWidgetEnvelope = {
          ui_widget_type: "ClientProfileWidget",
          widget_payload: {
            client_id: null,
            name: clientDraftFromEntities.name ?? "",
            phone: clientDraftFromEntities.phone ?? "",
            nif: cleanedNif,
            fiscal_address: clientDraftFromEntities.fiscal_address ?? "",
            email: "",
            notes: "",
            validation_hint: validationHint,
          },
        };

        return {
          routed_intent: "assistant_qa_node",
          active_widget: clientWidget,
          pending_gate: null,
          quick_actions: null,
          messages: [
            new AIMessage(
              "He preparado la ficha de cliente para que la revises, completes o edites antes de guardarla."
            ),
          ],
          turn_trace: { append_node: "assistant_qa_node" },
        };
      }

      // 1. Consultas sobre facturas pendientes / cobros
      if (/\b(pendiente|cobrar|vencid|facturas sin cobrar)\b/.test(norm) && !/\besta obra\b/.test(norm)) {
        const allInv = await invoicesRepo.listAll();
        const pending = allInv.filter(
          (i) => i.status === "pendiente_cobro" || i.status === "vencido"
        );
        if (pending.length === 0) {
          return {
            routed_intent: "assistant_qa_node",
            active_widget: null,
            pending_gate: null,
            messages: [new AIMessage("No tienes ninguna factura pendiente de cobro ni vencida.")],
            turn_trace: { append_node: "assistant_qa_node" },
          };
        }
        const totalPending = pending.reduce((acc, i) => acc + i.total_cents, 0);
        const listStr = pending
          .slice(0, 5)
          .map(
            (i) =>
              `${i.invoice_number} (${i.client_name_snapshot}: ${formatCentsEs(i.total_cents)}, ${i.status})`
          )
          .join("; ");
        return {
          routed_intent: "assistant_qa_node",
          active_widget: null,
          pending_gate: null,
          messages: [
            new AIMessage(
              `Tienes ${pending.length} factura(s) pendiente(s) por un total de ${formatCentsEs(totalPending)}: ${listStr}.`
            ),
          ],
          turn_trace: { append_node: "assistant_qa_node" },
        };
      }

      // 2. Consultas sobre precio en tarifario
      if (/\b(precio|tarifa|cuanto cobro|a cuanto)\b/.test(norm)) {
        const searchTerm = norm
          .replace(/\b(cual es el|precio de|tarifa de|a cuanto|tengo el|la|los|las|un|una)\b/g, " ")
          .trim();
        const items = searchTerm
          ? await catalogRepo.searchFts5WithScore(searchTerm, 5)
          : (await catalogRepo.listPaginated({ limit: 5 })).items.map((i) => ({
              ...i,
              bm25_score: 0,
            }));
        if (items.length === 0) {
          return {
            routed_intent: "assistant_qa_node",
            active_widget: null,
            pending_gate: null,
            messages: [
              new AIMessage(
                "No he encontrado partidas coincidentes en tu tarifario local."
              ),
            ],
            turn_trace: { append_node: "assistant_qa_node" },
          };
        }
        const lines = items.map((i) => `${i.description}: ${formatCentsEs(i.unit_price_cents)}/${i.unit}`);
        return {
          routed_intent: "assistant_qa_node",
          active_widget: null,
          pending_gate: null,
          rag_snippets: items.slice(0, 5).map((i) => ({
            source_table: "catalog_items",
            record_id: i.id,
            title: i.description,
            snippet_text: `${formatCentsEs(i.unit_price_cents)}/${i.unit}`,
            bm25_score: i.bm25_score,
          })),
          messages: [new AIMessage(`Precios en tu tarifario: ${lines.join(" · ")}.`)],
          turn_trace: {
            append_node: "assistant_qa_node",
            rag_hit_count: Math.min(items.length, 5),
          },
        };
      }

      // 3. Consultas sobre una obra específica o activa
      let targetJobId: string | null = resolvedTarget.job_id ?? null;
      const jobQuery = (entities.job_query as string | null | undefined) ?? null;

      if (!targetJobId && jobQuery) {
        const matches = await jobsRepo.searchFts5WithScore(jobQuery, 5);
        for (const m of matches.slice(0, 3)) {
          snippets.push({
            source_table: "jobs",
            record_id: m.id,
            title: `${m.job_code} ${m.title}`,
            snippet_text: m.address || m.status,
            bm25_score: m.bm25_score,
          });
        }

        if (matches.length === 1) {
          targetJobId = matches[0]!.id;
        } else if (matches.length >= 2) {
          if (!state.disambiguation_exhausted) {
            const pending: PendingDisambiguation = {
              original_intent: "assistant_qa_node",
              original_text: inputText,
              preserved_target: resolvedTarget,
              prompt: "He encontrado varias obras coincidentes. ¿Sobre cuál quieres consultar?",
              candidates: matches.slice(0, 5).map((m) => ({
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
              rag_snippets: snippets,
              pending_gate: null,
              turn_trace: {
                append_node: "assistant_qa_node",
                rag_hit_count: snippets.length,
              },
            };
          }
          const flat = matches
            .map((m) => `${m.job_code} (${m.title})`)
            .join("; ");
          return {
            routed_intent: "assistant_qa_node",
            active_widget: null,
            pending_gate: null,
            messages: [new AIMessage(`Obras registradas coincidentes: ${flat}.`)],
            turn_trace: { append_node: "assistant_qa_node" },
          };
        }
      }

      if (!targetJobId) {
        targetJobId = state.active_job_id;
      }

      if (targetJobId) {
        const job = await jobsRepo.getById(targetJobId);
        if (job) {
          const [activeQuote, jobInvoices, ticketPage] = await Promise.all([
            quotesRepo.getActiveByJobId(job.id),
            invoicesRepo.listByJobId(job.id),
            ticketsRepo.listByQuarterOrJob({ jobId: job.id, limit: 100, offset: 0 }),
          ]);
          const summary = computeJobSummary({
            job,
            activeQuote,
            invoices: jobInvoices,
            tickets: ticketPage.items,
          });

          const totalQuotedGross = activeQuote?.total_cents ?? 0;
          const totalInvoicedGross = jobInvoices.reduce((acc, inv) => acc + inv.total_cents, 0);
          const remainingToInvoice = Math.max(0, totalQuotedGross - totalInvoicedGross);

          const text =
            `En ${job.job_code} (${job.title}) tienes ${ticketPage.totalCount} ticket(s) registrado(s) por ` +
            `${formatCentsEs(summary.tickets_base_cents)} base (${formatCentsEs(summary.tickets_gross_cents)} con IVA). ` +
            `Facturado: ${formatCentsEs(totalInvoicedGross)} (cobrado ${formatCentsEs(summary.collected_gross_cents)}, pendiente de cobro ${formatCentsEs(summary.pending_invoice_gross_cents)}). ` +
            (activeQuote
              ? `Sobre el presupuesto ${activeQuote.quote_code} (${formatCentsEs(totalQuotedGross)}), quedan ${formatCentsEs(remainingToInvoice)} pendientes de facturar.`
              : "Aún no hay presupuesto activo vinculado.");

          return {
            routed_intent: "assistant_qa_node",
            active_job_id: job.id,
            active_quote_id: activeQuote?.id ?? null,
            rag_snippets: snippets,
            active_widget: null,
            pending_gate: null,
            messages: [new AIMessage(text)],
            turn_trace: {
              append_node: "assistant_qa_node",
              rag_hit_count: snippets.length,
            },
          };
        }
      }

      // 4. Sin obra específica: resumen general o lista plana si agotó desambiguación
      const allJobs = await jobsRepo.listPaginated({ limit: 5, offset: 0 });
      if (state.disambiguation_exhausted && allJobs.items.length > 0) {
        const listStr = allJobs.items.map((j) => `${j.job_code}: ${j.title} (${j.status})`).join(" · ");
        return {
          routed_intent: "assistant_qa_node",
          active_widget: null,
          pending_gate: null,
          messages: [
            new AIMessage(`Obras activas disponibles: ${listStr}. Selecciona una en Directorio o indícala por código OBR.`),
          ],
          turn_trace: { append_node: "assistant_qa_node" },
        };
      }

      if (allJobs.items.length >= 2 && !state.disambiguation_exhausted) {
        const pending: PendingDisambiguation = {
          original_intent: "assistant_qa_node",
          original_text: inputText,
          preserved_target: resolvedTarget,
          prompt: "¿Sobre qué obra quieres consultar?",
          candidates: allJobs.items.map((j) => ({
            entity_type: "job",
            id: j.id,
            label: `${j.job_code} · ${j.title}`,
            subtitle: j.status,
            job_id: j.id,
          })),
          attempts: 0,
        };
        return {
          routed_intent: "clarification_node",
          pending_disambiguation: pending,
          pending_gate: null,
          turn_trace: { append_node: "assistant_qa_node" },
        };
      }

      return {
        routed_intent: "assistant_qa_node",
        active_widget: null,
        pending_gate: null,
        messages: [
          new AIMessage(
            "No hay datos coincidentes en la base de datos local. Puedes pedirme un presupuesto o usar Voz/Cámara desde la barra inferior."
          ),
        ],
        turn_trace: { append_node: "assistant_qa_node" },
      };
    } catch (err) {
      return {
        routed_intent: "assistant_qa_node",
        active_widget: null,
        pending_gate: null,
        messages: [
          new AIMessage(
            `Error consultando SQLite local: ${err instanceof Error ? err.message : String(err)}`
          ),
        ],
        turn_trace: {
          append_node: "assistant_qa_node",
          error_code: "SQLITE_QUERY_ERROR",
        },
      };
    }
  };
}
