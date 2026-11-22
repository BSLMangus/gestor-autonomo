import type { SqliteExecutor } from "../contracts/types";

interface RpcResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  code?: string;
  message?: string;
}

export class WebSqliteInitError extends Error {
  readonly code: "OPFS_TAB_LOCKED" | "OPFS_UNAVAILABLE" | "SQLITE_QUERY_ERROR";

  constructor(
    code: "OPFS_TAB_LOCKED" | "OPFS_UNAVAILABLE" | "SQLITE_QUERY_ERROR",
    message: string
  ) {
    super(message);
    this.code = code;
    this.name = "WebSqliteInitError";
  }
}

/**
 * Proxy RPC hacia sqlite.worker.ts (@sqlite.org/sqlite-wasm + opfs-sahpool + Web Lock).
 */
export class WebWorkerSqliteExecutor implements SqliteExecutor {
  private readonly worker: Worker;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (val: unknown) => void; reject: (err: Error) => void }
  >();
  private queue: Promise<void> = Promise.resolve();
  private syncInTxDepth = 0;
  private closed = false;

  private constructor(worker: Worker) {
    this.worker = worker;
    this.worker.onmessage = (ev: MessageEvent<RpcResponse>) => {
      const msg = ev.data;
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      if (msg.ok) {
        entry.resolve(msg.result);
      } else if (msg.code === "OPFS_TAB_LOCKED" || msg.code === "OPFS_UNAVAILABLE") {
        entry.reject(new WebSqliteInitError(msg.code, msg.message ?? msg.code));
      } else {
        entry.reject(new Error(msg.message ?? "SQLITE_QUERY_ERROR"));
      }
    };
  }

  static async create(): Promise<WebWorkerSqliteExecutor> {
    const worker = new Worker(new URL("../../workers/sqlite.worker.ts", import.meta.url), {
      type: "module",
    });
    const instance = new WebWorkerSqliteExecutor(worker);
    try {
      await instance.callWorker("init");
      return instance;
    } catch (err) {
      worker.terminate();
      throw err;
    }
  }

  private callWorker(op: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    if (this.closed && op !== "close") {
      return Promise.reject(new Error("SQLITE_QUERY_ERROR: WebWorkerSqliteExecutor cerrado"));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, op, ...payload });
    });
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(() => fn());
    this.queue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  async query<T extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    if (this.syncInTxDepth > 0) {
      throw new Error(
        "SQLITE_QUERY_ERROR: llamada reentrante a executor.query() dentro de inTransaction; usa tx.query()"
      );
    }
    return this.enqueue(async () => (await this.callWorker("query", { sql, params })) as T[]);
  }

  async run(
    sql: string,
    params?: unknown[]
  ): Promise<{ changes: number; lastInsertRowid?: number }> {
    if (this.syncInTxDepth > 0) {
      throw new Error(
        "SQLITE_QUERY_ERROR: llamada reentrante a executor.run() dentro de inTransaction; usa tx.run()"
      );
    }
    return this.enqueue(
      async () =>
        (await this.callWorker("run", { sql, params })) as {
          changes: number;
          lastInsertRowid?: number;
        }
    );
  }

  async inTransaction<T>(
    fn: (tx: Pick<SqliteExecutor, "query" | "run">) => Promise<T>
  ): Promise<T> {
    if (this.syncInTxDepth > 0) {
      throw new Error("SQLITE_QUERY_ERROR: transacción anidada prohibida en FIFO");
    }
    return this.enqueue(async () => {
      await this.callWorker("beginImmediate");
      const tx: Pick<SqliteExecutor, "query" | "run"> = {
        query: async <R extends Record<string, unknown>>(sql: string, params?: unknown[]) =>
          (await this.callWorker("txQuery", { sql, params })) as R[],
        run: async (sql: string, params?: unknown[]) =>
          (await this.callWorker("txRun", { sql, params })) as {
            changes: number;
            lastInsertRowid?: number;
          },
      };
      try {
        this.syncInTxDepth += 1;
        let promise: Promise<T>;
        try {
          promise = Promise.resolve(fn(tx));
        } finally {
          this.syncInTxDepth -= 1;
        }
        const result = await promise;
        await this.callWorker("commit");
        return result;
      } catch (err) {
        try {
          await this.callWorker("rollback");
        } catch {
          // ignore secondary rollback failure
        }
        throw err;
      }
    });
  }

  async close(): Promise<void> {
    return this.enqueue(async () => {
      if (!this.closed) {
        this.closed = true;
        await this.callWorker("close");
        this.worker.terminate();
      }
    });
  }
}
