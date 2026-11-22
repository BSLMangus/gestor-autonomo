import type { TraceRecorder } from "../../ports/mediaPorts";
import type {
  ActiveWidgetEnvelope,
  AgentTraceRecord,
  ErrorCode,
  InferenceEngine,
  PendingGate,
  RagSnippet,
  SqliteExecutor,
} from "../../contracts/types";

interface RawTraceRow extends Record<string, unknown> {
  trace_id: string;
  parent_trace_id: string | null;
  thread_id: string;
  turn_id: string;
  turn_phase: "complete" | "pre_interrupt" | "post_resume";
  routed_intent: string | null;
  node_sequence_json: string;
  inference_engine: InferenceEngine;
  latency_ms: number;
  rag_snippets_json: string;
  validated_widget_json: string | null;
  hitl_gate_id: PendingGate | null;
  hitl_outcome: "pending" | "approved" | "edited" | "rejected" | null;
  rejection_reason: string | null;
  error_code: ErrorCode | null;
  cloud_cost_eur: number;
  created_at_ms: number;
}

export class TracesRepository implements TraceRecorder {
  constructor(private readonly executor: SqliteExecutor) {}

  async recordTrace(trace: Parameters<TraceRecorder["recordTrace"]>[0]): Promise<void> {
    await this.executor.run(
      `INSERT INTO agent_traces (
        trace_id, parent_trace_id, thread_id, turn_id, turn_phase,
        routed_intent, node_sequence_json, inference_engine, latency_ms,
        rag_snippets_json, validated_widget_json, hitl_gate_id, hitl_outcome,
        rejection_reason, error_code, cloud_cost_eur, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.0, ?)`,
      [
        trace.trace_id,
        trace.parent_trace_id,
        trace.thread_id,
        trace.turn_id,
        trace.turn_phase,
        trace.routed_intent,
        JSON.stringify(trace.node_sequence),
        trace.inference_engine,
        trace.latency_ms,
        JSON.stringify(trace.rag_snippets),
        trace.validated_widget ? JSON.stringify(trace.validated_widget) : null,
        trace.hitl_gate_id,
        trace.hitl_outcome,
        trace.rejection_reason,
        trace.error_code,
        trace.created_at_ms,
      ]
    );
  }

  async listTraces(threadId?: string, limit = 100): Promise<AgentTraceRecord[]> {
    const rows = threadId
      ? await this.executor.query<RawTraceRow>(
          `SELECT * FROM agent_traces WHERE thread_id = ? ORDER BY created_at_ms DESC LIMIT ?`,
          [threadId, limit]
        )
      : await this.executor.query<RawTraceRow>(
          `SELECT * FROM agent_traces ORDER BY created_at_ms DESC LIMIT ?`,
          [limit]
        );

    return rows.map((row) => ({
      trace_id: row.trace_id,
      parent_trace_id: row.parent_trace_id,
      thread_id: row.thread_id,
      turn_id: row.turn_id,
      turn_phase: row.turn_phase,
      routed_intent: row.routed_intent,
      node_sequence: JSON.parse(row.node_sequence_json) as string[],
      inference_engine: row.inference_engine,
      latency_ms: row.latency_ms,
      rag_snippets: JSON.parse(row.rag_snippets_json) as RagSnippet[],
      validated_widget: row.validated_widget_json
        ? (JSON.parse(row.validated_widget_json) as ActiveWidgetEnvelope)
        : null,
      hitl_gate_id: row.hitl_gate_id,
      hitl_outcome: row.hitl_outcome,
      rejection_reason: row.rejection_reason,
      error_code: row.error_code,
      cloud_cost_eur: 0,
      created_at_ms: row.created_at_ms,
    }));
  }
}
