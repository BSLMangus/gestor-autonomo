import { AsyncLocalStorage } from "node:async_hooks";
import Database from "better-sqlite3";
import type { SqliteExecutor } from "../contracts/types";
import { normalizeSqlParams } from "./sqliteExecutor";

/**
 * Ejecutor SQLite exclusivo de Node.js/Vitest sobre better-sqlite3 (:memory:).
 * Nunca debe importarse desde código Web/Capacitor/Workers.
 */
export class NodeBetterSqliteExecutor implements SqliteExecutor {
  private readonly db: Database.Database;
  private queue: Promise<void> = Promise.resolve();
  private readonly txContext = new AsyncLocalStorage<symbol>();
  private readonly txToken = Symbol("node-sqlite-tx");
  private closed = false;

  constructor(filename = ":memory:") {
    this.db = new Database(filename);
    this.db.pragma("foreign_keys = ON");
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
      throw new Error("SQLITE_QUERY_ERROR: conexión SQLite cerrada");
    }
  }

  private rawQuery<T extends Record<string, unknown>>(sql: string, params?: unknown[]): T[] {
    this.assertNotClosed();
    try {
      const stmt = this.db.prepare(sql);
      const bound = normalizeSqlParams(params);
      return stmt.all(...bound) as T[];
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
      const trimmed = sql.trim().toUpperCase();
      if (trimmed.startsWith("PRAGMA ")) {
        this.db.pragma(sql.trim().slice("PRAGMA ".length).replace(/;$/, ""));
        return { changes: 0 };
      }
      const stmt = this.db.prepare(sql);
      const bound = normalizeSqlParams(params);
      const info = stmt.run(...bound);
      return {
        changes: info.changes,
        lastInsertRowid:
          typeof info.lastInsertRowid === "bigint"
            ? Number(info.lastInsertRowid)
            : info.lastInsertRowid,
      };
    } catch (err) {
      throw new Error(`SQLITE_QUERY_ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async query<T extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    if (this.txContext.getStore() === this.txToken) {
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
    if (this.txContext.getStore() === this.txToken) {
      throw new Error(
        "SQLITE_QUERY_ERROR: llamada reentrante a executor.run() dentro de inTransaction; usa tx.run()"
      );
    }
    return this.enqueue(() => this.rawRun(sql, params));
  }

  async inTransaction<T>(
    fn: (tx: Pick<SqliteExecutor, "query" | "run">) => Promise<T>
  ): Promise<T> {
    if (this.txContext.getStore() === this.txToken) {
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
        const result = await this.txContext.run(this.txToken, () => fn(tx));
        this.db.exec("COMMIT;");
        return result;
      } catch (err) {
        try {
          this.db.exec("ROLLBACK;");
        } catch {
          // ignore rollback secondary failure
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
