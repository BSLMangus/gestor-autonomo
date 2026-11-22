import { Capacitor } from "@capacitor/core";
import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from "@capacitor-community/sqlite";
import type { SqliteExecutor } from "../contracts/types";
import { normalizeSqlParams } from "./sqliteExecutor";

/**
 * Ejecutor SQLite nativo para Android/iOS (@capacitor-community/sqlite v7).
 * Configura WAL, busy_timeout=5000, foreign_keys=ON, cola FIFO, transaction=false
 * en execute/run y guardia anti-reentrancia isInTx.
 */
export class NativeCapacitorSqliteExecutor implements SqliteExecutor {
  private readonly sqlite: SQLiteConnection;
  private db: SQLiteDBConnection | null = null;
  private queue: Promise<void> = Promise.resolve();
  private syncInTxDepth = 0;
  private closed = false;
  private readonly dbName: string;

  private constructor(dbName: string) {
    this.dbName = dbName;
    this.sqlite = new SQLiteConnection(CapacitorSQLite);
  }

  static async create(dbName = "obralocal"): Promise<NativeCapacitorSqliteExecutor> {
    if (!Capacitor.isNativePlatform()) {
      throw new Error("SQLITE_QUERY_ERROR: NativeCapacitorSqliteExecutor requiere plataforma nativa");
    }
    const instance = new NativeCapacitorSqliteExecutor(dbName);
    await instance.open();
    return instance;
  }

  private async open(): Promise<void> {
    const consistency = await this.sqlite.checkConnectionsConsistency();
    const isConn = (await this.sqlite.isConnection(this.dbName, false)).result;
    if (consistency.result && isConn) {
      this.db = await this.sqlite.retrieveConnection(this.dbName, false);
    } else {
      this.db = await this.sqlite.createConnection(
        this.dbName,
        false,
        "no-encryption",
        1,
        false
      );
    }
    await this.db.open();
    // En Android (SQLCipher/SQLiteDatabase), los PRAGMA que devuelven fila (WAL, busy_timeout)
    // fallan con execSQL (`db.execute`) y deben ejecutarse vía `rawQuery` (`db.query`).
    await this.db.query("PRAGMA journal_mode = WAL;");
    await this.db.query("PRAGMA busy_timeout = 5000;");
    await this.db.query("PRAGMA foreign_keys = ON;");
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(() => fn());
    this.queue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  private getDb(): SQLiteDBConnection {
    if (this.closed || !this.db) {
      throw new Error("SQLITE_QUERY_ERROR: conexión Capacitor SQLite cerrada o no inicializada");
    }
    return this.db;
  }

  private async rawQuery<T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<T[]> {
    const db = this.getDb();
    try {
      const bound = normalizeSqlParams(params);
      const res = await db.query(sql, bound);
      return (res.values ?? []) as T[];
    } catch (err) {
      throw new Error(`SQLITE_QUERY_ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async rawRun(
    sql: string,
    params?: unknown[]
  ): Promise<{ changes: number; lastInsertRowid?: number }> {
    const db = this.getDb();
    try {
      const trimmed = sql.trim().toUpperCase();
      if (trimmed.startsWith("PRAGMA ")) {
        await db.query(sql);
        return { changes: 0 };
      }
      if (
        trimmed.startsWith("CREATE ") ||
        trimmed.startsWith("DROP ") ||
        trimmed.startsWith("ALTER ")
      ) {
        // Evita que @capacitor-community/sqlite trocee por ";\n" los triggers FTS5 con múltiples sentencias
        const singleLineDdl = `${sql.replace(/\r?\n/g, " ").trim().replace(/;$/, "")};`;
        await db.execute(singleLineDdl, false);
        return { changes: 0 };
      }
      const bound = normalizeSqlParams(params);
      const res = await db.run(sql, bound, false);
      return {
        changes: res.changes?.changes ?? 0,
        lastInsertRowid: res.changes?.lastId,
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
      const db = this.getDb();
      await db.execute("BEGIN IMMEDIATE;", false);
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
        await db.execute("COMMIT;", false);
        return result;
      } catch (err) {
        try {
          await db.execute("ROLLBACK;", false);
        } catch {
          // ignore secondary rollback failure
        }
        throw err;
      }
    });
  }

  async close(): Promise<void> {
    return this.enqueue(async () => {
      if (!this.closed && this.db) {
        this.closed = true;
        await this.sqlite.closeConnection(this.dbName, false);
        this.db = null;
      }
    });
  }
}
