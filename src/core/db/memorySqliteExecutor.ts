import sqlite3InitModule, { type Database as WasmDatabase } from "@sqlite.org/sqlite-wasm";
import type { SqliteExecutor } from "../contracts/types";
import { normalizeSqlParams } from "./sqliteExecutor";

/**
 * Ejecutor SQLite WASM en memoria (:memory:) para navegador y evals.worker.ts.
 * Libre de dependencias Node nativas.
 */
export class InMemorySqliteExecutor implements SqliteExecutor {
  private readonly db: WasmDatabase;
  private queue: Promise<void> = Promise.resolve();
  private syncInTxDepth = 0;
  private closed = false;

  private constructor(db: WasmDatabase) {
    this.db = db;
    this.db.exec("PRAGMA foreign_keys = ON;");
  }

  static async create(): Promise<InMemorySqliteExecutor> {
    const sqlite3 = await sqlite3InitModule();
    const db = new sqlite3.oo1.DB(":memory:", "ct");
    return new InMemorySqliteExecutor(db);
  }

  private enqueue<T>(fn: () => Promise<T> | T): Promise<T> {
    const next = this.queue.then(() => fn());
    this.queue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  private assertNotClosed(): void {
    if (this.closed) {
      throw new Error("SQLITE_QUERY_ERROR: conexión :memory: cerrada");
    }
  }

  private rawQuery<T extends Record<string, unknown>>(sql: string, params?: unknown[]): T[] {
    this.assertNotClosed();
    try {
      const bound = normalizeSqlParams(params);
      return this.db.exec({
        sql,
        bind: bound as never,
        rowMode: "object",
        returnValue: "resultRows",
      }) as T[];
    } catch (err) {
      throw new Error(`SQLITE_QUERY_ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private rawRun(
    sql: string,
    params?: unknown[]
  ): { changes: number; lastInsertRowid?: number } {
    this.assertNotClosed();
    try {
      const bound = normalizeSqlParams(params);
      this.db.exec({
        sql,
        bind: bound as never,
      });
      return {
        changes: this.db.changes(),
      };
    } catch (err) {
      throw new Error(`SQLITE_QUERY_ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async query<T extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    if (this.syncInTxDepth > 0) {
      throw new Error(
        "SQLITE_QUERY_ERROR: llamada reentrante a executor.query() dentro de inTransaction; usa tx.query()"
      );
    }
    return this.enqueue(() => this.rawQuery<T>(sql, params));
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
    return this.enqueue(() => this.rawRun(sql, params));
  }

  async inTransaction<T>(
    fn: (tx: Pick<SqliteExecutor, "query" | "run">) => Promise<T>
  ): Promise<T> {
    if (this.syncInTxDepth > 0) {
      throw new Error("SQLITE_QUERY_ERROR: transacción anidada prohibida en FIFO");
    }
    return this.enqueue(async () => {
      this.assertNotClosed();
      this.db.exec("BEGIN IMMEDIATE;");
      const tx: Pick<SqliteExecutor, "query" | "run"> = {
        query: async <R extends Record<string, unknown>>(sql: string, params?: unknown[]) =>
          this.rawQuery<R>(sql, params),
        run: async (sql: string, params?: unknown[]) => this.rawRun(sql, params),
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
        this.db.exec("COMMIT;");
        return result;
      } catch (err) {
        try {
          this.db.exec("ROLLBACK;");
        } catch {
          // ignore secondary rollback failure
        }
        throw err;
      }
    });
  }

  async close(): Promise<void> {
    return this.enqueue(() => {
      if (!this.closed) {
        this.closed = true;
        this.db.close();
      }
    });
  }
}
