import type {
  ActiveWidgetEnvelope,
  ChatMessageRecord,
  ChatThreadRecord,
  PendingGate,
  QuickAction,
  SqliteExecutor,
} from "../../contracts/types";
import { CheckpointsRepository } from "./checkpointsRepo";

interface RawThreadRow extends Record<string, unknown> {
  thread_id: string;
  title: string;
  status: "idle" | "running" | "interrupted" | "error";
  active_job_id: string | null;
  active_quote_id: string | null;
  pending_gate: PendingGate | null;
  last_node: string | null;
  is_seed: number;
  created_at_ms: number;
  updated_at_ms: number;
}

interface RawMessageRow extends Record<string, unknown> {
  id: string;
  thread_id: string;
  client_turn_id: string | null;
  role: "user" | "assistant" | "system";
  content: string;
  widget_json: string | null;
  quick_actions_json: string | null;
  trace_id: string | null;
  created_at_ms: number;
}

function mapThreadRow(row: RawThreadRow): ChatThreadRecord {
  return {
    thread_id: row.thread_id,
    title: row.title,
    status: row.status,
    active_job_id: row.active_job_id,
    active_quote_id: row.active_quote_id,
    pending_gate: row.pending_gate,
    last_node: row.last_node,
    is_seed: row.is_seed === 1,
    created_at_ms: row.created_at_ms,
    updated_at_ms: row.updated_at_ms,
  };
}

function mapMessageRow(row: RawMessageRow): ChatMessageRecord {
  return {
    id: row.id,
    thread_id: row.thread_id,
    client_turn_id: row.client_turn_id,
    role: row.role,
    content: row.content,
    widget_json: row.widget_json
      ? (JSON.parse(row.widget_json) as ActiveWidgetEnvelope)
      : null,
    quick_actions_json: row.quick_actions_json
      ? (JSON.parse(row.quick_actions_json) as QuickAction[])
      : null,
    trace_id: row.trace_id,
    created_at_ms: row.created_at_ms,
  };
}

export class ChatRepository {
  private readonly checkpointsRepo: CheckpointsRepository;

  constructor(private readonly executor: SqliteExecutor) {
    this.checkpointsRepo = new CheckpointsRepository(executor);
  }

  async reconcileInterruptedRunningThreads(): Promise<void> {
    await this.executor.run(
      `UPDATE chat_threads SET status = 'error', updated_at_ms = ? WHERE status = 'running'`,
      [Date.now()]
    );
  }

  async listThreads(): Promise<ChatThreadRecord[]> {
    const rows = await this.executor.query<RawThreadRow>(
      `SELECT * FROM chat_threads ORDER BY updated_at_ms DESC`
    );
    return rows.map(mapThreadRow);
  }

  async getThread(threadId: string): Promise<ChatThreadRecord | null> {
    const rows = await this.executor.query<RawThreadRow>(
      `SELECT * FROM chat_threads WHERE thread_id = ? LIMIT 1`,
      [threadId]
    );
    const row = rows[0];
    return row ? mapThreadRow(row) : null;
  }

  async createThread(params?: {
    thread_id?: string;
    title?: string;
    active_job_id?: string | null;
    active_quote_id?: string | null;
    is_seed?: boolean;
  }): Promise<ChatThreadRecord> {
    const now = Date.now();
    const threadId = params?.thread_id ?? `thr_${crypto.randomUUID().slice(0, 12)}`;
    const title = params?.title?.trim() || "Nueva consulta de obra";
    await this.executor.run(
      `INSERT INTO chat_threads (
        thread_id, title, status, active_job_id, active_quote_id,
        pending_gate, last_node, is_seed, created_at_ms, updated_at_ms
      ) VALUES (?, ?, 'idle', ?, ?, NULL, NULL, ?, ?, ?)`,
      [
        threadId,
        title,
        params?.active_job_id ?? null,
        params?.active_quote_id ?? null,
        params?.is_seed ? 1 : 0,
        now,
        now,
      ]
    );
    const created = await this.getThread(threadId);
    if (!created) throw new Error("SQLITE_QUERY_ERROR: error creando chat_thread");
    return created;
  }

  async updateThread(
    threadId: string,
    patch: Partial<{
      title: string;
      status: "idle" | "running" | "interrupted" | "error";
      active_job_id: string | null;
      active_quote_id: string | null;
      pending_gate: PendingGate | null;
      last_node: string | null;
    }>,
    tx?: Pick<SqliteExecutor, "query" | "run">
  ): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (patch.title !== undefined) {
      sets.push("title = ?");
      params.push(patch.title);
    }
    if (patch.status !== undefined) {
      sets.push("status = ?");
      params.push(patch.status);
    }
    if (patch.active_job_id !== undefined) {
      sets.push("active_job_id = ?");
      params.push(patch.active_job_id);
    }
    if (patch.active_quote_id !== undefined) {
      sets.push("active_quote_id = ?");
      params.push(patch.active_quote_id);
    }
    if (patch.pending_gate !== undefined) {
      sets.push("pending_gate = ?");
      params.push(patch.pending_gate);
    }
    if (patch.last_node !== undefined) {
      sets.push("last_node = ?");
      params.push(patch.last_node);
    }
    sets.push("updated_at_ms = ?");
    params.push(Date.now());
    params.push(threadId);

    const runner = tx ?? this.executor;
    await runner.run(`UPDATE chat_threads SET ${sets.join(", ")} WHERE thread_id = ?`, params);
  }

  async listMessages(threadId: string): Promise<ChatMessageRecord[]> {
    const rows = await this.executor.query<RawMessageRow>(
      `SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY created_at_ms ASC, rowid ASC`,
      [threadId]
    );
    return rows.map(mapMessageRow);
  }

  async getMessageByClientTurnId(clientTurnId: string): Promise<ChatMessageRecord | null> {
    const rows = await this.executor.query<RawMessageRow>(
      `SELECT * FROM chat_messages WHERE client_turn_id = ? LIMIT 1`,
      [clientTurnId]
    );
    const row = rows[0];
    return row ? mapMessageRow(row) : null;
  }

  async insertMessage(
    msg: {
      id?: string;
      thread_id: string;
      client_turn_id: string | null;
      role: "user" | "assistant" | "system";
      content: string;
      widget_json?: ActiveWidgetEnvelope | null;
      quick_actions_json?: QuickAction[] | null;
      trace_id?: string | null;
      created_at_ms?: number;
    },
    tx?: Pick<SqliteExecutor, "query" | "run">
  ): Promise<ChatMessageRecord> {
    const id = msg.id ?? `msg_${crypto.randomUUID().slice(0, 12)}`;
    const now = msg.created_at_ms ?? Date.now();
    const runner = tx ?? this.executor;
    await runner.run(
      `INSERT INTO chat_messages (
        id, thread_id, client_turn_id, role, content,
        widget_json, quick_actions_json, trace_id, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        msg.thread_id,
        msg.client_turn_id,
        msg.role,
        msg.content,
        msg.widget_json ? JSON.stringify(msg.widget_json) : null,
        msg.quick_actions_json ? JSON.stringify(msg.quick_actions_json) : null,
        msg.trace_id ?? null,
        now,
      ]
    );
    return {
      id,
      thread_id: msg.thread_id,
      client_turn_id: msg.client_turn_id,
      role: msg.role,
      content: msg.content,
      widget_json: msg.widget_json ?? null,
      quick_actions_json: msg.quick_actions_json ?? null,
      trace_id: msg.trace_id ?? null,
      created_at_ms: now,
    };
  }

  async deleteThread(threadId: string): Promise<void> {
    const existing = await this.getThread(threadId);
    if (!existing) return;
    if (existing.status === "running") {
      throw new Error(
        "INVALID_STATE_TRANSITION: No se puede borrar una conversación en ejecución"
      );
    }
    await this.executor.inTransaction(async (tx) => {
      await tx.run(
        `UPDATE app_settings SET last_active_thread_id = NULL, updated_at_ms = ?
         WHERE id = 1 AND last_active_thread_id = ?`,
        [Date.now(), threadId]
      );
      await tx.run(`DELETE FROM recovered_drafts WHERE thread_id = ?`, [threadId]);
      await tx.run(`DELETE FROM chat_messages WHERE thread_id = ?`, [threadId]);
      await tx.run(`DELETE FROM chat_threads WHERE thread_id = ?`, [threadId]);
      await this.checkpointsRepo.deleteThreadCheckpoints(threadId, tx);
    });
  }

  async deleteClosedThread(threadId: string): Promise<void> {
    const existing = await this.getThread(threadId);
    if (!existing) return;
    if (existing.status === "interrupted") {
      throw new Error(
        "INVALID_STATE_TRANSITION: No se puede borrar un hilo en pausa HITL pendiente"
      );
    }
    await this.executor.inTransaction(async (tx) => {
      await tx.run(
        `UPDATE app_settings SET last_active_thread_id = NULL, updated_at_ms = ?
         WHERE id = 1 AND last_active_thread_id = ?`,
        [Date.now(), threadId]
      );
      await tx.run(`DELETE FROM chat_threads WHERE thread_id = ?`, [threadId]);
      await this.checkpointsRepo.deleteThreadCheckpoints(threadId, tx);
    });
  }

  async purgeClosedHistory(): Promise<{ deletedCount: number }> {
    let deletedCount = 0;
    await this.executor.inTransaction(async (tx) => {
      const closedThreads = await tx.query<{ thread_id: string }>(
        `SELECT thread_id FROM chat_threads WHERE status IN ('idle', 'error')`
      );
      deletedCount = closedThreads.length;
      if (deletedCount === 0) return;

      const now = Date.now();
      for (const { thread_id } of closedThreads) {
        await tx.run(
          `UPDATE app_settings SET last_active_thread_id = NULL, updated_at_ms = ?
           WHERE id = 1 AND last_active_thread_id = ?`,
          [now, thread_id]
        );
        await tx.run(`DELETE FROM chat_threads WHERE thread_id = ?`, [thread_id]);
        await this.checkpointsRepo.deleteThreadCheckpoints(thread_id, tx);
      }
    });
    return { deletedCount };
  }
}
