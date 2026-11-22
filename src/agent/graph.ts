import { END, START, StateGraph } from "@langchain/langgraph/web";
import { CapacitorSqliteSaver } from "./checkpointer";
import { createA2uiDispatcherNode } from "./nodes/a2uiDispatcher";
import { createAssistantQaNode } from "./nodes/assistantQaNode";
import { createClarificationNode } from "./nodes/clarificationNode";
import {
  createLifecycleCommitNode,
  createOcrCommitNode,
  createQuoteCommitNode,
} from "./nodes/commitNodes";
import { createFiscalPiggybankSpecialistNode } from "./nodes/fiscalPiggybankSpecialist";
import { createIntentRouterNode } from "./nodes/intentRouter";
import { createLifecycleBillingSpecialistNode } from "./nodes/lifecycleBillingSpecialist";
import { createOcrTicketSpecialistNode } from "./nodes/ocrTicketSpecialist";
import { createQuoteSpecialistNode } from "./nodes/quoteSpecialist";
import { createScheduleSpecialistNode } from "./nodes/scheduleSpecialist";
import { createSiteLogSpecialistNode } from "./nodes/siteLogSpecialist";
import type { GraphDependencies } from "./ports";
import { ObraLocalAnnotation, type ObraLocalGraphState } from "./state";

export function buildObraLocalGraph(deps: GraphDependencies) {
  const checkpointer = new CapacitorSqliteSaver(deps.executor);

  const builder = new StateGraph(ObraLocalAnnotation)
    .addNode("intent_router", createIntentRouterNode(deps))
    .addNode("quote_specialist", createQuoteSpecialistNode(deps))
    .addNode("ocr_ticket_specialist", createOcrTicketSpecialistNode(deps))
    .addNode("fiscal_piggybank_specialist", createFiscalPiggybankSpecialistNode(deps))
    .addNode("lifecycle_billing_specialist", createLifecycleBillingSpecialistNode(deps))
    .addNode("site_log_specialist", createSiteLogSpecialistNode(deps))
    .addNode("schedule_specialist", createScheduleSpecialistNode(deps))
    .addNode("assistant_qa_node", createAssistantQaNode(deps))
    .addNode("clarification_node", createClarificationNode(deps))
    .addNode("a2ui_dispatcher", createA2uiDispatcherNode(deps))
    .addNode("quote_commit", createQuoteCommitNode(deps))
    .addNode("ocr_commit", createOcrCommitNode(deps))
    .addNode("lifecycle_commit", createLifecycleCommitNode(deps))
    .addEdge(START, "intent_router")
    .addConditionalEdges("intent_router", (state: ObraLocalGraphState) => {
      return state.routed_intent ?? "clarification_node";
    }, {
      quote_specialist: "quote_specialist",
      ocr_ticket_specialist: "ocr_ticket_specialist",
      fiscal_piggybank_specialist: "fiscal_piggybank_specialist",
      lifecycle_billing_specialist: "lifecycle_billing_specialist",
      site_log_specialist: "site_log_specialist",
      schedule_specialist: "schedule_specialist",
      assistant_qa_node: "assistant_qa_node",
      clarification_node: "clarification_node",
    })
    .addConditionalEdges(
      "quote_specialist",
      (state: ObraLocalGraphState) =>
        state.routed_intent === "clarification_node" ? "clarification_node" : "a2ui_dispatcher",
      {
        clarification_node: "clarification_node",
        a2ui_dispatcher: "a2ui_dispatcher",
      }
    )
    .addEdge("ocr_ticket_specialist", "a2ui_dispatcher")
    .addEdge("fiscal_piggybank_specialist", "a2ui_dispatcher")
    .addConditionalEdges(
      "lifecycle_billing_specialist",
      (state: ObraLocalGraphState) =>
        state.routed_intent === "clarification_node" ? "clarification_node" : "a2ui_dispatcher",
      {
        clarification_node: "clarification_node",
        a2ui_dispatcher: "a2ui_dispatcher",
      }
    )
    .addEdge("site_log_specialist", "a2ui_dispatcher")
    .addEdge("schedule_specialist", "a2ui_dispatcher")
    .addConditionalEdges(
      "assistant_qa_node",
      (state: ObraLocalGraphState) =>
        state.routed_intent === "clarification_node" ? "clarification_node" : "a2ui_dispatcher",
      {
        clarification_node: "clarification_node",
        a2ui_dispatcher: "a2ui_dispatcher",
      }
    )
    .addEdge("clarification_node", "a2ui_dispatcher")
    .addConditionalEdges(
      "a2ui_dispatcher",
      (state: ObraLocalGraphState) => {
        if (state.pending_gate === "gate_1_quote") return "quote_commit";
        if (state.pending_gate === "gate_2_ticket") return "ocr_commit";
        if (state.pending_gate === "gate_3_invoice" || state.pending_gate === "gate_4_share") {
          return "lifecycle_commit";
        }
        return END;
      },
      {
        quote_commit: "quote_commit",
        ocr_commit: "ocr_commit",
        lifecycle_commit: "lifecycle_commit",
        [END]: END,
      }
    )
    .addEdge("quote_commit", END)
    .addEdge("ocr_commit", END)
    .addEdge("lifecycle_commit", END);

  return builder.compile({ checkpointer });
}

export type CompiledObraLocalGraph = ReturnType<typeof buildObraLocalGraph>;
