import { AIMessage } from "@langchain/core/messages";
import { TEXT_LIMITS, truncateText } from "../../core/contracts/textLimits";
import type {
  ActiveWidgetEnvelope,
  PendingSlotFill,
  ResolvedTarget,
  SiteLogCategory,
} from "../../core/contracts/types";
import { ClientsRepository } from "../../core/db/repositories/clientsRepo";
import { JobsRepository } from "../../core/db/repositories/jobsRepo";
import { formatLocalDateTimeIso } from "../../core/fiscal/dateQuarter";
import type { GraphDependencies } from "../ports";
import type { ObraLocalGraphState, ObraLocalGraphUpdate } from "../state";

export function createSiteLogSpecialistNode(deps: GraphDependencies) {
  const jobsRepo = new JobsRepository(deps.executor);
  const clientsRepo = new ClientsRepository(deps.executor);

  return async function siteLogSpecialistNode(
    state: ObraLocalGraphState
  ): Promise<ObraLocalGraphUpdate> {
    try {
      const input = state.input_payload;
      const resolvedTarget = (state.extracted_entities?.resolved_target ?? {}) as ResolvedTarget;
      const category =
        (state.extracted_entities?.site_log_category as SiteLogCategory | undefined) ?? "nota";
      const noteText = truncateText(
        (state.extracted_entities?.note_text as string | undefined) ?? input?.text ?? "",
        TEXT_LIMITS.NOTES
      );

      let candidateJobId =
        resolvedTarget.job_id ?? input?.target_ids?.job_id ?? null;

      const jobQuery = (state.extracted_entities?.job_query as string | null | undefined) ?? null;
      if (!candidateJobId && jobQuery) {
        const matches = await jobsRepo.searchFts5WithScore(jobQuery, 3);
        if (matches.length === 1) {
          candidateJobId = matches[0]!.id;
        }
      }

      if (!candidateJobId) {
        candidateJobId = state.active_job_id;
      }

      const job = candidateJobId ? await jobsRepo.getById(candidateJobId) : null;
      const client = job?.client_id ? await clientsRepo.getById(job.client_id) : null;

      const nextActiveJobId = job ? job.id : state.active_job_id;
      const nextActiveQuoteId =
        job && job.id !== state.active_job_id ? null : state.active_quote_id;
      const slotFillAttempt = Number(state.extracted_entities?.slot_fill_attempt ?? 0);

      if (
        input?.action_type === "free_text_or_voice" &&
        !input.raw_media_uri &&
        noteText.trim().length === 0 &&
        slotFillAttempt < 2
      ) {
        const pendingSlot: PendingSlotFill = {
          target_intent: "site_log_specialist",
          missing_fields: ["note_or_photo"],
          collected_data: {
            ...(job?.id ? { job_id: job.id } : {}),
            category,
          },
          original_text: input.text,
          attempts: slotFillAttempt,
        };
        return {
          routed_intent: "site_log_specialist",
          pending_slot_fill: pendingSlot,
          active_job_id: nextActiveJobId,
          active_quote_id: nextActiveQuoteId,
          active_widget: null,
          pending_gate: null,
          messages: [
            new AIMessage(
              job
                ? `Vale, ¿qué nota quieres añadir al diario de ${job.job_code} (${job.title})? También puedes enviar una fotografía con la cámara.`
                : "Vale, dime qué nota quieres guardar en el diario de obra (o envía una foto con la cámara)."
            ),
          ],
          turn_trace: { append_node: "site_log_specialist" },
        };
      }

      const widget: ActiveWidgetEnvelope = {
        ui_widget_type: "SiteLogStampWidget",
        widget_payload: {
          candidate_job_id: job?.id ?? null,
          category,
          note_text: noteText,
          raw_media_uri: input?.raw_media_uri ?? null,
          stamp_preview_meta: {
            job_code: job?.job_code ?? null,
            client_name: job ? client?.name ?? "Sin cliente asignado" : null,
            timestamp_iso: formatLocalDateTimeIso(Date.now()),
          },
        },
      };

      const msg = job
        ? `Entrada preparada para ${job.job_code} (${client?.name ?? "Sin cliente asignado"}) en categoría '${category}'. Revisa la nota o adjunta foto sellada y guarda en el diario.`
        : "Selecciona la obra (o crea una nueva) para sellar y guardar la entrada en el diario.";

      return {
        routed_intent: "site_log_specialist",
        pending_slot_fill: null,
        active_job_id: nextActiveJobId,
        active_quote_id: nextActiveQuoteId,
        active_widget: widget,
        pending_gate: null,
        messages: [new AIMessage(msg)],
        turn_trace: { append_node: "site_log_specialist" },
      };
    } catch (err) {
      return {
        routed_intent: "site_log_specialist",
        active_widget: null,
        pending_gate: null,
        messages: [
          new AIMessage(
            `Error preparando diario de obra: ${
              err instanceof Error ? err.message : String(err)
            }`
          ),
        ],
        turn_trace: {
          append_node: "site_log_specialist",
          error_code: "SQLITE_QUERY_ERROR",
        },
      };
    }
  };
}
