import type { BaseMessage } from "@langchain/core/messages";
import { Annotation, messagesStateReducer, type Messages } from "@langchain/langgraph/web";
import type {
  ActiveWidgetEnvelope,
  InputPayload,
  PendingDisambiguation,
  PendingGate,
  PendingSlotFill,
  QuickAction,
  RagSnippet,
  SpecialistRoute,
  TraceState,
} from "../core/contracts/types";

const MAX_CHECKPOINT_MESSAGES = 20;

function boundedMessagesReducer(left: BaseMessage[] | undefined, right: Messages): BaseMessage[] {
  const merged = messagesStateReducer(left ?? [], right);
  return merged.length > MAX_CHECKPOINT_MESSAGES
    ? merged.slice(merged.length - MAX_CHECKPOINT_MESSAGES)
    : merged;
}

function turnTraceReducer(
  prev: TraceState,
  next: Partial<TraceState> & { append_node?: string }
): TraceState {
  const { append_node, ...rest } = next;
  if (rest.turn_id && rest.turn_id !== prev.turn_id) {
    return {
      turn_id: rest.turn_id,
      trace_id: rest.trace_id ?? rest.turn_id,
      parent_trace_id: rest.parent_trace_id ?? null,
      started_at_ms: rest.started_at_ms ?? Date.now(),
      node_sequence: append_node ? [append_node] : rest.node_sequence ?? [],
      inference_engine: rest.inference_engine ?? "deterministic_rule_engine",
      rag_hit_count: rest.rag_hit_count ?? 0,
      error_code: rest.error_code ?? null,
      rejection_reason: rest.rejection_reason ?? null,
      cloud_cost_eur: 0,
    };
  }
  const appended = append_node ? [append_node] : [];
  return {
    ...prev,
    ...rest,
    node_sequence: [...prev.node_sequence, ...appended],
    cloud_cost_eur: 0,
  };
}

export const ObraLocalAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[], Messages>({
    reducer: boundedMessagesReducer,
    default: () => [],
  }),
  active_job_id: Annotation<string | null>({
    reducer: (_p, n) => n,
    default: () => null,
  }),
  active_quote_id: Annotation<string | null>({
    reducer: (_p, n) => n,
    default: () => null,
  }),
  pending_disambiguation: Annotation<PendingDisambiguation | null>({
    reducer: (_p, n) => n,
    default: () => null,
  }),
  pending_slot_fill: Annotation<PendingSlotFill | null>({
    reducer: (_p, n) => n,
    default: () => null,
  }),
  disambiguation_exhausted: Annotation<boolean>({
    reducer: (_p, n) => n,
    default: () => false,
  }),
  input_payload: Annotation<InputPayload | null>({
    reducer: (_p, n) => n,
    default: () => null,
  }),
  routed_intent: Annotation<SpecialistRoute | null>({
    reducer: (_p, n) => n,
    default: () => null,
  }),
  extracted_entities: Annotation<Record<string, unknown> | null>({
    reducer: (_p, n) => n,
    default: () => null,
  }),
  rag_snippets: Annotation<RagSnippet[]>({
    reducer: (_p, n) => n.slice(0, 5),
    default: () => [],
  }),
  active_widget: Annotation<ActiveWidgetEnvelope | null>({
    reducer: (_p, n) => n,
    default: () => null,
  }),
  quick_actions: Annotation<QuickAction[] | null>({
    reducer: (_p, n) => n,
    default: () => null,
  }),
  pending_gate: Annotation<PendingGate | null>({
    reducer: (_p, n) => n,
    default: () => null,
  }),
  turn_trace: Annotation<TraceState, Partial<TraceState> & { append_node?: string }>({
    reducer: turnTraceReducer,
    default: () => ({
      turn_id: "",
      trace_id: "",
      parent_trace_id: null,
      started_at_ms: 0,
      node_sequence: [],
      inference_engine: "deterministic_rule_engine",
      rag_hit_count: 0,
      error_code: null,
      rejection_reason: null,
      cloud_cost_eur: 0,
    }),
  }),
});

export type ObraLocalGraphState = typeof ObraLocalAnnotation.State;
export type ObraLocalGraphUpdate = typeof ObraLocalAnnotation.Update;
