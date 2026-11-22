import sqlite3InitModule, { type Database as WasmDatabase } from "@sqlite.org/sqlite-wasm";
import { normalizeSqlParams } from "../core/db/sqliteExecutor";

type RpcRequest =
  | { id: number; op: "init" }
  | { id: number; op: "query"; sql: string; params?: unknown[] }
  | { id: number; op: "run"; sql: string; params?: unknown[] }
  | { id: number; op: "beginImmediate" }
  | { id: number; op: "txQuery"; sql: string; params?: unknown[] }
  | { id: number; op: "txRun"; sql: string; params?: unknown[] }
  | { id: number; op: "commit" }
  | { id: number; op: "rollback" }
  | { id: number; op: "close" };

type RpcResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; code: string; message: string };

let db: WasmDatabase | null = null;
let releaseSessionLock: (() => void) | null = null;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireSessionLockAndOpenDb(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.locks) {
    const err = new Error("OPFS_UNAVAILABLE: Web Locks API no disponible");
    err.name = "OPFS_UNAVAILABLE";
    throw err;
  }

  let acquired = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let lockGrantedNow = false;

    const lockPromise = new Promise<void>((resolveReady, rejectReady) => {
      void navigator.locks
        .request("obralocal_sqlite_lock", { ifAvailable: true }, async (lock) => {
          if (!lock) {
            resolveReady();
            return;
          }
          lockGrantedNow = true;
          acquired = true;

          let sessionResolve!: () => void;
          const sessionLifetime = new Promise<void>((res) => {
            sessionResolve = res;
          });
          releaseSessionLock = sessionResolve;

          try {
            const sqlite3 = await sqlite3InitModule();
            if (!sqlite3.installOpfsSAHPoolVfs) {
              throw new Error("OPFS_UNAVAILABLE: opfs-sahpool no soportado en este navegador");
            }
            const poolUtil = await sqlite3.installOpfsSAHPoolVfs({
              initialCapacity: 12,
              directory: "/obralocal-sahpool",
            });
            db = new poolUtil.OpfsSAHPoolDb("/obralocal.sqlite3");
            db.exec("PRAGMA foreign_keys = ON;");
            resolveReady();
            await sessionLifetime;
          } catch (initErr) {
            releaseSessionLock?.();
            releaseSessionLock = null;
            const msg = initErr instanceof Error ? initErr.message : String(initErr);
            const wrapped = new Error(`OPFS_UNAVAILABLE: ${msg}`);
            wrapped.name = "OPFS_UNAVAILABLE";
            rejectReady(wrapped);
          }
        })
        .catch((err) => rejectReady(err));
    });

    await lockPromise;
    if (lockGrantedNow && acquired) {
      return;
    }
    if (attempt < 2) {
      await delay(100);
    }
  }

  const lockErr = new Error(
    "OPFS_TAB_LOCKED: Gestor Autónomo ya está abierto en otra pestaña. Ciérrala para evitar corrupción OPFS."
  );
  lockErr.name = "OPFS_TAB_LOCKED";
  throw lockErr;
}

function getDbOrThrow(): WasmDatabase {
  if (!db) {
    const err = new Error("SQLITE_QUERY_ERROR: base de datos OPFS no inicializada");
    err.name = "SQLITE_QUERY_ERROR";
    throw err;
  }
  return db;
}

function execQuery(sql: string, params?: unknown[]): Record<string, unknown>[] {
  const conn = getDbOrThrow();
  const bound = normalizeSqlParams(params);
  return conn.exec({
    sql,
    bind: bound as never,
    rowMode: "object",
    returnValue: "resultRows",
  }) as Record<string, unknown>[];
}

function execRun(sql: string, params?: unknown[]): { changes: number } {
  const conn = getDbOrThrow();
  const bound = normalizeSqlParams(params);
  conn.exec({
    sql,
    bind: bound as never,
  });
  return { changes: conn.changes() };
}

let workerQueue: Promise<void> = Promise.resolve();

self.onmessage = (ev: MessageEvent<RpcRequest>) => {
  const req = ev.data;
  workerQueue = workerQueue.then(async () => {
    try {
      let result: unknown = null;
      switch (req.op) {
        case "init":
          await acquireSessionLockAndOpenDb();
          result = { ready: true };
          break;
        case "query":
        case "txQuery":
          result = execQuery(req.sql, req.params);
          break;
        case "run":
        case "txRun":
          result = execRun(req.sql, req.params);
          break;
        case "beginImmediate":
          getDbOrThrow().exec("BEGIN IMMEDIATE;");
          result = true;
          break;
        case "commit":
          getDbOrThrow().exec("COMMIT;");
          result = true;
          break;
        case "rollback":
          try {
            getDbOrThrow().exec("ROLLBACK;");
          } catch {
            // ignore rollback error
          }
          result = true;
          break;
        case "close":
          if (db) {
            db.close();
            db = null;
          }
          releaseSessionLock?.();
          releaseSessionLock = null;
          result = true;
          break;
      }
      const res: RpcResponse = { id: req.id, ok: true, result };
      self.postMessage(res);
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      const sqlHint =
        "sql" in req && typeof req.sql === "string"
          ? ` [${req.sql.replace(/\s+/g, " ").trim().slice(0, 80)}]`
          : "";
      let code = "SQLITE_QUERY_ERROR";
      if (rawMsg.includes("OPFS_TAB_LOCKED") || (err instanceof Error && err.name === "OPFS_TAB_LOCKED")) {
        code = "OPFS_TAB_LOCKED";
      } else if (
        rawMsg.includes("OPFS_UNAVAILABLE") ||
        (err instanceof Error && err.name === "OPFS_UNAVAILABLE")
      ) {
        code = "OPFS_UNAVAILABLE";
      }
      const res: RpcResponse = {
        id: req.id,
        ok: false,
        code,
        message: `${rawMsg}${sqlHint}`,
      };
      self.postMessage(res);
    }
  });
};
