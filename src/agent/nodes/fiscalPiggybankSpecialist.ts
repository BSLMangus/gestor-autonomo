import { AIMessage } from "@langchain/core/messages";
import { InvoicesRepository } from "../../core/db/repositories/invoicesRepo";
import { JobsRepository } from "../../core/db/repositories/jobsRepo";
import { SettingsRepository } from "../../core/db/repositories/settingsRepo";
import { TicketsRepository } from "../../core/db/repositories/ticketsRepo";
import { deriveFiscalQuarter, getLocalTodayIso } from "../../core/fiscal/dateQuarter";
import { computePiggyBank, formatCentsEs } from "../../core/fiscal/fiscalEngine";
import type { GraphDependencies } from "../ports";
import type { ObraLocalGraphState, ObraLocalGraphUpdate } from "../state";

export function createFiscalPiggybankSpecialistNode(deps: GraphDependencies) {
  const invoicesRepo = new InvoicesRepository(deps.executor);
  const ticketsRepo = new TicketsRepository(deps.executor);
  const jobsRepo = new JobsRepository(deps.executor);
  const settingsRepo = new SettingsRepository(deps.executor);

  return async function fiscalPiggybankSpecialistNode(
    state: ObraLocalGraphState
  ): Promise<ObraLocalGraphUpdate> {
    try {
      const quarter =
        state.input_payload?.quarter ??
        (state.extracted_entities?.quarter as string | undefined) ??
        deriveFiscalQuarter(getLocalTodayIso());

      const [invoices, tickets, jobs, settings] = await Promise.all([
        invoicesRepo.listAll(),
        ticketsRepo.listAll(),
        jobsRepo.listAll(),
        settingsRepo.getAppSettings(),
      ]);

      const irpfRate = settings.irpf_reserve_rate;
      const payload = computePiggyBank({
        quarter,
        invoices,
        tickets,
        jobs,
        selectedJobId: state.active_job_id,
        irpfRate,
      });

      const msg =
        `Resumen fiscal ${quarter} calculado sobre tus facturas y tickets reales: ` +
        `Dinero Intocable para Hacienda ${formatCentsEs(payload.untouchable_tax_cents)} ` +
        `(${formatCentsEs(payload.iva_to_reserve_cents)} IVA neto + ${formatCentsEs(payload.irpf_20_cents)} IRPF ${irpfRate} %) ` +
        `y Saldo Disponible Real del trimestre ${formatCentsEs(payload.available_cash_cents)}.`;

      return {
        routed_intent: "fiscal_piggybank_specialist",
        active_widget: {
          ui_widget_type: "FiscalPiggyBankWidget",
          widget_payload: payload,
        },
        pending_gate: null,
        messages: [new AIMessage(msg)],
        turn_trace: { append_node: "fiscal_piggybank_specialist" },
      };
    } catch (err) {
      return {
        routed_intent: "fiscal_piggybank_specialist",
        active_widget: null,
        pending_gate: null,
        messages: [
          new AIMessage(
            `Error consultando la Hucha Fiscal: ${err instanceof Error ? err.message : String(err)}`
          ),
        ],
        turn_trace: {
          append_node: "fiscal_piggybank_specialist",
          error_code: "SQLITE_QUERY_ERROR",
        },
      };
    }
  };
}
