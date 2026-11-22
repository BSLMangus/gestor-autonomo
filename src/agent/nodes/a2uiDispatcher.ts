import { AIMessage } from "@langchain/core/messages";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { ActiveWidgetEnvelopeSchema } from "../../core/contracts/schemas";
import type { ActiveWidgetEnvelope, PendingGate } from "../../core/contracts/types";
import { getSeedOverride, getThreadIdFromConfig, type GraphDependencies } from "../ports";
import type { ObraLocalGraphState, ObraLocalGraphUpdate } from "../state";

export function validateGateWidgetMatch(
  pendingGate: PendingGate | null,
  activeWidget: ActiveWidgetEnvelope | null
): boolean {
  if (pendingGate === null) {
    return true;
  }
  if (!activeWidget) {
    return false;
  }
  switch (pendingGate) {
    case "gate_1_quote":
      return activeWidget.ui_widget_type === "QuoteBuilderWidget";
    case "gate_2_ticket":
      return activeWidget.ui_widget_type === "TicketOcrValidatorWidget";
    case "gate_3_invoice":
      return (
        activeWidget.ui_widget_type === "JobLifecycleActionWidget" &&
        activeWidget.widget_payload.mode === "preview_gate_3" &&
        activeWidget.widget_payload.gate_3_draft !== undefined
      );
    case "gate_4_share":
      return (
        activeWidget.ui_widget_type === "JobLifecycleActionWidget" &&
        activeWidget.widget_payload.mode === "preview_gate_4" &&
        activeWidget.widget_payload.gate_4_draft !== undefined
      );
  }
}

export function createA2uiDispatcherNode(deps: GraphDependencies) {
  return async function a2uiDispatcherNode(
    state: ObraLocalGraphState,
    config?: LangGraphRunnableConfig
  ): Promise<ObraLocalGraphUpdate> {
    const threadId = getThreadIdFromConfig(config);
    const traceId = getSeedOverride(config)?.traceIdOverride ?? state.turn_trace.trace_id;
    const nodeSeq = [...state.turn_trace.node_sequence, "a2ui_dispatcher"];
    const latencyMs = Math.max(0, Date.now() - state.turn_trace.started_at_ms);

    let validatedWidget = state.active_widget;
    let pendingGate = state.pending_gate;
    let errorCode = state.turn_trace.error_code;
    let extraMessages: AIMessage[] = [];

    if (validatedWidget !== null) {
      const parsed = ActiveWidgetEnvelopeSchema.safeParse(validatedWidget);
      if (!parsed.success || !validateGateWidgetMatch(pendingGate, parsed.data)) {
        validatedWidget = null;
        pendingGate = null;
        errorCode = "SCHEMA_VALIDATION_ERROR";
        extraMessages = [
          new AIMessage(
            "Error interno validando la tarjeta de respuesta (SCHEMA_VALIDATION_ERROR)."
          ),
        ];
      } else {
        validatedWidget = parsed.data;
      }
    } else if (pendingGate !== null) {
      pendingGate = null;
      errorCode = "SCHEMA_VALIDATION_ERROR";
      extraMessages = [
        new AIMessage(
          "Falta el componente requerido para la puerta HITL (SCHEMA_VALIDATION_ERROR)."
        ),
      ];
    }

    await deps.traceRecorder.recordTrace({
      trace_id: traceId,
      parent_trace_id: null,
      thread_id: threadId,
      turn_id: state.turn_trace.turn_id,
      turn_phase: pendingGate !== null ? "pre_interrupt" : "complete",
      routed_intent: state.routed_intent,
      node_sequence: nodeSeq,
      inference_engine: state.turn_trace.inference_engine,
      latency_ms: latencyMs,
      rag_snippets: state.rag_snippets,
      validated_widget: validatedWidget,
      hitl_gate_id: pendingGate,
      hitl_outcome: pendingGate !== null ? "pending" : null,
      rejection_reason: null,
      error_code: errorCode,
      cloud_cost_eur: 0,
      created_at_ms: Date.now(),
    });

    return {
      active_widget: validatedWidget,
      pending_gate: pendingGate,
      ...(extraMessages.length > 0 ? { messages: extraMessages } : {}),
      turn_trace: {
        trace_id: traceId,
        append_node: "a2ui_dispatcher",
        error_code: errorCode,
      },
    };
  };
}
