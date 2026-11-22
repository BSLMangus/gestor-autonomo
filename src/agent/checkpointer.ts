import type { RunnableConfig } from "@langchain/core/runnables";
import {
  BaseCheckpointSaver,
  WRITES_IDX_MAP,
  type ChannelVersions,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointPendingWrite,
  type CheckpointTuple,
  type PendingWrite,
} from "@langchain/langgraph-checkpoint";
import type { SqliteExecutor } from "../core/contracts/types";
import { CheckpointsRepository } from "../core/db/repositories/checkpointsRepo";

export const CHECKPOINT_SCHEMA_VERSION = "1.0.0";
export const RETENTION_PER_THREAD = 50;

interface RawCheckpointRow extends Record<string, unknown> {
  thread_id: string;
  checkpoint_ns: string;
  checkpoint_id: string;
  parent_checkpoint_id: string | null;
  checkpoint_type: string;
  checkpoint_data: string;
  metadata_type: string;
  metadata_data: string;
  schema_version: string;
  has_pending_interrupt: number;
  created_at_ms: number;
}

interface RawWriteRow extends Record<string, unknown> {
  task_id: string;
  channel: string;
  write_type: string;
  write_data: string;
}

function uint8ToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    parts.push(String.fromCharCode(...slice));
  }
  return btoa(parts.join(""));
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

function encodeTypedPayload(type: string, bytes: Uint8Array): string {
  if (type === "json") {
    return new TextDecoder().decode(bytes);
  }
  return `b64:${uint8ToBase64(bytes)}`;
}

function decodeTypedPayload(stored: string): Uint8Array | string {
  if (stored.startsWith("b64:")) {
    return base64ToUint8(stored.slice(4));
  }
  return stored;
}

/**
 * Checkpointer SQLite determinista para LangGraph.js Web.
 * - getTuple / list: 100 % solo lectura (WHERE schema_version = ?) ordenados checkpoint_id DESC, rowid DESC.
 * - put: inTransaction, limpia has_pending_interrupt previo, inserta y poda > 50 preservando has_pending_interrupt=1.
 * - putWrites: WRITES_IDX_MAP (<0 INSERT OR REPLACE, >=0 INSERT OR IGNORE) y marca has_pending_interrupt=1 ante __interrupt__.
 */
export class CapacitorSqliteSaver extends BaseCheckpointSaver {
  private readonly checkpointsRepo: CheckpointsRepository;
  private readonly checkpointWaiters = new Map<string, Set<() => void>>();

  constructor(private readonly executor: SqliteExecutor) {
    super();
    this.checkpointsRepo = new CheckpointsRepository(executor);
  }

  private static cpKey(threadId: string, checkpointNs: string, checkpointId: string): string {
    return `${threadId}\u0000${checkpointNs}\u0000${checkpointId}`;
  }

  private notifyCheckpointReady(threadId: string, checkpointNs: string, checkpointId: string): void {
    const key = CapacitorSqliteSaver.cpKey(threadId, checkpointNs, checkpointId);
    const waiters = this.checkpointWaiters.get(key);
    if (!waiters) return;
    this.checkpointWaiters.delete(key);
    for (const resolve of waiters) {
      resolve();
    }
  }

  private async ensureParentCheckpointCommitted(
    threadId: string,
    checkpointNs: string,
    checkpointId: string
  ): Promise<void> {
    const key = CapacitorSqliteSaver.cpKey(threadId, checkpointNs, checkpointId);
    let waiterFn: (() => void) | null = null;
    const waitPromise = new Promise<void>((resolve) => {
      waiterFn = resolve;
      let set = this.checkpointWaiters.get(key);
      if (!set) {
        set = new Set();
        this.checkpointWaiters.set(key, set);
      }
      set.add(resolve);
    });

    const cleanupWaiter = () => {
      if (!waiterFn) return;
      const set = this.checkpointWaiters.get(key);
      if (set) {
        set.delete(waiterFn);
        if (set.size === 0) this.checkpointWaiters.delete(key);
      }
    };

    const existing = await this.executor.query<{ ok: number }>(
      `SELECT 1 AS ok FROM lg_checkpoints
       WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
       LIMIT 1`,
      [threadId, checkpointNs, checkpointId]
    );
    if (existing.length > 0) {
      cleanupWaiter();
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        waitPromise,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 5000);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      cleanupWaiter();
    }
  }

  private async deserializeRow(row: RawCheckpointRow): Promise<CheckpointTuple> {
    const checkpoint = (await this.serde.loadsTyped(
      row.checkpoint_type,
      decodeTypedPayload(row.checkpoint_data)
    )) as Checkpoint;

    const metadata = (await this.serde.loadsTyped(
      row.metadata_type,
      decodeTypedPayload(row.metadata_data)
    )) as CheckpointMetadata;

    const writeRows = await this.executor.query<RawWriteRow>(
      `SELECT task_id, channel, write_type, write_data
       FROM lg_checkpoint_writes
       WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
       ORDER BY task_path ASC, task_id ASC, idx ASC`,
      [row.thread_id, row.checkpoint_ns, row.checkpoint_id]
    );

    const pendingWrites: CheckpointPendingWrite[] = [];
    for (const w of writeRows) {
      const value = await this.serde.loadsTyped(w.write_type, decodeTypedPayload(w.write_data));
      pendingWrites.push([w.task_id, w.channel, value]);
    }

    const tuple: CheckpointTuple = {
      config: {
        configurable: {
          thread_id: row.thread_id,
          checkpoint_ns: row.checkpoint_ns,
          checkpoint_id: row.checkpoint_id,
        },
      },
      checkpoint,
      metadata,
      pendingWrites,
    };

    if (row.parent_checkpoint_id) {
      tuple.parentConfig = {
        configurable: {
          thread_id: row.thread_id,
          checkpoint_ns: row.checkpoint_ns,
          checkpoint_id: row.parent_checkpoint_id,
        },
      };
    }

    return tuple;
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id as string | undefined;
    if (!threadId) return undefined;
    const checkpointNs = (config.configurable?.checkpoint_ns as string | undefined) ?? "";
    const checkpointId = config.configurable?.checkpoint_id as string | undefined;

    const rows = checkpointId
      ? await this.executor.query<RawCheckpointRow>(
          `SELECT * FROM lg_checkpoints
           WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ? AND schema_version = ?
           LIMIT 1`,
          [threadId, checkpointNs, checkpointId, CHECKPOINT_SCHEMA_VERSION]
        )
      : await this.executor.query<RawCheckpointRow>(
          `SELECT * FROM lg_checkpoints
           WHERE thread_id = ? AND checkpoint_ns = ? AND schema_version = ?
           ORDER BY checkpoint_id DESC, rowid DESC
           LIMIT 1`,
          [threadId, checkpointNs, CHECKPOINT_SCHEMA_VERSION]
        );

    const row = rows[0];
    if (!row) return undefined;
    return this.deserializeRow(row);
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions
  ): AsyncGenerator<CheckpointTuple> {
    const threadId = config.configurable?.thread_id as string | undefined;
    const checkpointNs = config.configurable?.checkpoint_ns as string | undefined;
    const beforeId = options?.before?.configurable?.checkpoint_id as string | undefined;
    const limit = options?.limit;

    const clauses: string[] = ["schema_version = ?"];
    const params: unknown[] = [CHECKPOINT_SCHEMA_VERSION];

    if (threadId !== undefined) {
      clauses.push("thread_id = ?");
      params.push(threadId);
    }
    if (checkpointNs !== undefined) {
      clauses.push("checkpoint_ns = ?");
      params.push(checkpointNs);
    }
    if (beforeId !== undefined) {
      clauses.push("checkpoint_id < ?");
      params.push(beforeId);
    }

    const limitClause = limit !== undefined && limit > 0 ? "LIMIT ?" : "";
    if (limit !== undefined && limit > 0) {
      params.push(limit);
    }

    const rows = await this.executor.query<RawCheckpointRow>(
      `SELECT * FROM lg_checkpoints
       WHERE ${clauses.join(" AND ")}
       ORDER BY checkpoint_id DESC, rowid DESC
       ${limitClause}`,
      params
    );

    const filter = options?.filter;
    for (const row of rows) {
      const tuple = await this.deserializeRow(row);
      if (filter) {
        const meta = (tuple.metadata ?? {}) as Record<string, unknown>;
        const matches = Object.entries(filter).every(([k, v]) => meta[k] === v);
        if (!matches) continue;
      }
      yield tuple;
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions
  ): Promise<RunnableConfig> {
    const threadId = config.configurable?.thread_id as string | undefined;
    if (!threadId) {
      throw new Error("SCHEMA_VALIDATION_ERROR: thread_id requerido en checkpointer.put");
    }
    const checkpointNs = (config.configurable?.checkpoint_ns as string | undefined) ?? "";
    const parentCheckpointId =
      (config.configurable?.checkpoint_id as string | undefined) ?? null;

    const [cpType, cpBytes] = this.serde.dumpsTyped(checkpoint);
    const [metaType, metaBytes] = this.serde.dumpsTyped(metadata);
    const cpData = encodeTypedPayload(cpType, cpBytes);
    const metaData = encodeTypedPayload(metaType, metaBytes);
    const now = Date.now();

    await this.executor.inTransaction(async (tx) => {
      await tx.run(
        `UPDATE lg_checkpoints SET has_pending_interrupt = 0
         WHERE thread_id = ? AND checkpoint_ns = ?`,
        [threadId, checkpointNs]
      );

      await tx.run(
        `INSERT OR REPLACE INTO lg_checkpoints (
          thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id,
          checkpoint_type, checkpoint_data, metadata_type, metadata_data,
          schema_version, has_pending_interrupt, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        [
          threadId,
          checkpointNs,
          checkpoint.id,
          parentCheckpointId,
          cpType,
          cpData,
          metaType,
          metaData,
          CHECKPOINT_SCHEMA_VERSION,
          now,
        ]
      );

      await tx.run(
        `DELETE FROM lg_checkpoints
         WHERE thread_id = ? AND checkpoint_ns = ?
           AND has_pending_interrupt = 0
           AND checkpoint_id NOT IN (
             SELECT checkpoint_id FROM lg_checkpoints
             WHERE thread_id = ? AND checkpoint_ns = ?
             ORDER BY checkpoint_id DESC, rowid DESC
             LIMIT ?
           )`,
        [threadId, checkpointNs, threadId, checkpointNs, RETENTION_PER_THREAD]
      );
    });

    this.notifyCheckpointReady(threadId, checkpointNs, checkpoint.id);

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
    taskPath = ""
  ): Promise<void> {
    const threadId = config.configurable?.thread_id as string | undefined;
    const checkpointId = config.configurable?.checkpoint_id as string | undefined;
    if (!threadId || !checkpointId) {
      throw new Error(
        "SCHEMA_VALIDATION_ERROR: thread_id y checkpoint_id requeridos en putWrites"
      );
    }
    const checkpointNs = (config.configurable?.checkpoint_ns as string | undefined) ?? "";
    const hasInterrupt = writes.some(([channel]) => channel === "__interrupt__");

    // PregelLoop puede disparar putWrites() en paralelo o antes de que su microtarea .then(() => put())
    // inserte el checkpoint padre en lg_checkpoints; esperamos fuera de inTransaction.
    await this.ensureParentCheckpointCommitted(threadId, checkpointNs, checkpointId);

    await this.executor.inTransaction(async (tx) => {
      for (const [idx, [channel, value]] of writes.entries()) {
        const mappedIdx = WRITES_IDX_MAP[channel] ?? idx;
        const [writeType, writeBytes] = this.serde.dumpsTyped(value);
        const writeData = encodeTypedPayload(writeType, writeBytes);
        const sqlVerb = mappedIdx < 0 ? "INSERT OR REPLACE" : "INSERT OR IGNORE";
        await tx.run(
          `${sqlVerb} INTO lg_checkpoint_writes (
            thread_id, checkpoint_ns, checkpoint_id, task_id, task_path,
            idx, channel, write_type, write_data
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            threadId,
            checkpointNs,
            checkpointId,
            taskId,
            taskPath,
            mappedIdx,
            channel,
            writeType,
            writeData,
          ]
        );
      }

      if (hasInterrupt) {
        await tx.run(
          `UPDATE lg_checkpoints
           SET has_pending_interrupt = 1
           WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?`,
          [threadId, checkpointNs, checkpointId]
        );
      }
    });
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.checkpointsRepo.deleteThreadCheckpoints(threadId);
  }

  async purgeAll(): Promise<void> {
    await this.checkpointsRepo.purgeAllCheckpoints();
  }
}
