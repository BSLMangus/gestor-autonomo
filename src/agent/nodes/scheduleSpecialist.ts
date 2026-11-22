import { AIMessage } from "@langchain/core/messages";
import type { ActiveWidgetEnvelope, JobRow, ResolvedTarget } from "../../core/contracts/types";
import { ClientsRepository } from "../../core/db/repositories/clientsRepo";
import { JobsRepository } from "../../core/db/repositories/jobsRepo";
import { ScheduleRepository } from "../../core/db/repositories/scheduleRepo";
import { getLocalTodayIso } from "../../core/fiscal/dateQuarter";
import type { ParsedScheduleFields } from "../inference/deterministicSpanishParser";
import type { GraphDependencies } from "../ports";
import type { ObraLocalGraphState, ObraLocalGraphUpdate } from "../state";

export function createScheduleSpecialistNode(deps: GraphDependencies) {
  const jobsRepo = new JobsRepository(deps.executor);
  const clientsRepo = new ClientsRepository(deps.executor);
  const scheduleRepo = new ScheduleRepository(deps.executor);

  return async function scheduleSpecialistNode(
    state: ObraLocalGraphState
  ): Promise<ObraLocalGraphUpdate> {
    try {
      const input = state.input_payload;
      const resolvedTarget = (state.extracted_entities?.resolved_target ?? {}) as ResolvedTarget;
      const parsedSchedule = state.extracted_entities?.schedule as ParsedScheduleFields | undefined;
      const jobQuery = (state.extracted_entities?.job_query as string | null | undefined) ?? null;

      let targetJob: JobRow | null = null;
      const explicitJobId = resolvedTarget.job_id ?? input?.target_ids?.job_id ?? null;
      if (explicitJobId) {
        targetJob = await jobsRepo.getById(explicitJobId);
      }

      if (!targetJob && jobQuery) {
        const ftsMatches = await jobsRepo.searchFts5WithScore(jobQuery, 5);
        if (ftsMatches.length > 0) {
          targetJob = ftsMatches[0] ?? null;
        } else {
          const clientRes = await clientsRepo.listPaginated({
            search: jobQuery,
            limit: 5,
            offset: 0,
          });
          if (clientRes.items.length > 0) {
            const allJobs = await jobsRepo.listAll();
            const clientIds = new Set(clientRes.items.map((c) => c.id));
            targetJob =
              allJobs.find((j) => j.client_id && clientIds.has(j.client_id) && j.status === "en_curso") ??
              allJobs.find((j) => j.client_id && clientIds.has(j.client_id)) ??
              null;
          }
        }
      }

      if (!targetJob && state.active_job_id) {
        targetJob = await jobsRepo.getById(state.active_job_id);
      }

      if (!targetJob) {
        const allJobs = await jobsRepo.listAll();
        targetJob = allJobs.find((j) => j.status === "en_curso") ?? allJobs[0] ?? null;
      }

      const todayIso = getLocalTodayIso();
      const mode = parsedSchedule?.mode ?? "daily_log";
      const dateIso = parsedSchedule?.date_iso ?? todayIso;
      const existingEntry = targetJob
        ? await scheduleRepo.getEntryByJobAndDate(targetJob.id, dateIso)
        : null;

      const widget: ActiveWidgetEnvelope = {
        ui_widget_type: "ScheduleWorkLogWidget",
        widget_payload: {
          mode,
          entry_id: existingEntry?.id ?? null,
          job_id: targetJob?.id ?? null,
          date_iso: dateIso,
          start_date_iso:
            mode === "plan_range" ? (parsedSchedule?.start_date_iso ?? dateIso) : null,
          end_date_iso:
            mode === "plan_range" ? (parsedSchedule?.end_date_iso ?? dateIso) : null,
          suggested_delta_thousandths: parsedSchedule?.delta_thousandths ?? null,
          suggested_reason: parsedSchedule?.reason ?? "",
          suggested_notes: parsedSchedule?.notes ?? "",
        },
      };

      const msg =
        mode === "plan_range"
          ? targetJob
            ? `Preparo la planificación en calendario para ${targetJob.job_code} (${targetJob.title}) del ${parsedSchedule?.start_date_iso ?? dateIso} al ${parsedSchedule?.end_date_iso ?? dateIso} según tu horario habitual.`
            : "Selecciona la obra y el rango de fechas para generar automáticamente los días en tu calendario."
          : targetJob
            ? `He preparado el parte de jornada para ${targetJob.job_code} (${targetJob.title}) el ${dateIso}. Revisa las horas y guarda para actualizar agenda y desviación.`
            : "He preparado el parte del día. Selecciona la obra y confirma las horas trabajadas.";

      const nextActiveJobId = targetJob ? targetJob.id : state.active_job_id;
      const nextActiveQuoteId =
        targetJob && targetJob.id !== state.active_job_id ? null : state.active_quote_id;

      return {
        routed_intent: "schedule_specialist",
        active_job_id: nextActiveJobId,
        active_quote_id: nextActiveQuoteId,
        active_widget: widget,
        pending_gate: null,
        messages: [new AIMessage(msg)],
        turn_trace: { append_node: "schedule_specialist" },
      };
    } catch (err) {
      return {
        routed_intent: "schedule_specialist",
        active_widget: null,
        pending_gate: null,
        messages: [
          new AIMessage(
            `Error preparando parte o planificación de agenda: ${
              err instanceof Error ? err.message : String(err)
            }`
          ),
        ],
        turn_trace: {
          append_node: "schedule_specialist",
          error_code: "SQLITE_QUERY_ERROR",
        },
      };
    }
  };
}
