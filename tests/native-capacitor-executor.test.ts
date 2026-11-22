import { beforeEach, describe, expect, it, vi } from "vitest";
import { initializeSchema } from "../src/core/db/sqliteExecutor";

const { mockDb, mockConnection } = vi.hoisted(() => {
  const db = {
    open: vi.fn(async () => undefined),
    query: vi.fn(async (_sql: string, _values?: unknown[]) => ({
      values: [] as Record<string, unknown>[],
    })),
    execute: vi.fn(async (_sql: string, _transaction?: boolean) => ({
      changes: { changes: 0 },
    })),
    run: vi.fn(async (_sql: string, _values?: unknown[], _transaction?: boolean) => ({
      changes: { changes: 1, lastId: 1 },
    })),
  };
  const connection = {
    checkConnectionsConsistency: vi.fn(async () => ({ result: false })),
    isConnection: vi.fn(async () => ({ result: false })),
    createConnection: vi.fn(async () => db),
    retrieveConnection: vi.fn(async () => db),
    closeConnection: vi.fn(async () => undefined),
  };
  return { mockDb: db, mockConnection: connection };
});

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
  },
}));

vi.mock("@capacitor-community/sqlite", () => {
  class SQLiteConnection {
    checkConnectionsConsistency = mockConnection.checkConnectionsConsistency;
    isConnection = mockConnection.isConnection;
    createConnection = mockConnection.createConnection;
    retrieveConnection = mockConnection.retrieveConnection;
    closeConnection = mockConnection.closeConnection;
  }
  return {
    CapacitorSQLite: {},
    SQLiteConnection,
  };
});

import { NativeCapacitorSqliteExecutor } from "../src/core/db/nativeCapacitorExecutor";

describe("NativeCapacitorSqliteExecutor DDL flattening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("aplana todos los DDL de docs/schema.sql (incluidos triggers FTS5 AFTER UPDATE) antes de db.execute()", async () => {
    const executor = await NativeCapacitorSqliteExecutor.create("test_obralocal");
    await initializeSchema(executor);

    const executeCalls = mockDb.execute.mock.calls;
    expect(executeCalls.length).toBeGreaterThan(10);

    for (const [sql, transaction] of executeCalls) {
      expect(transaction).toBe(false);
      expect(sql).not.toMatch(/\r|\n/);
      expect(sql.endsWith(";")).toBe(true);
      expect(sql.endsWith(";;")).toBe(false);
    }

    const executedSqls = executeCalls.map(([sql]) => sql);
    const catalogAu = executedSqls.find((s) => s.includes("trg_catalog_items_au"));
    const clientsAu = executedSqls.find((s) => s.includes("trg_clients_au"));
    const jobsAu = executedSqls.find((s) => s.includes("trg_jobs_au"));

    expect(catalogAu).toBeDefined();
    expect(catalogAu).toContain("VALUES ('delete', old.rowid");
    expect(catalogAu).toContain("VALUES (new.rowid, new.description");
    expect(clientsAu).toBeDefined();
    expect(jobsAu).toBeDefined();

    await executor.close();
  });

  it("aplana sentencias DROP y ALTER multilínea y mantiene DML en db.run()", async () => {
    const executor = await NativeCapacitorSqliteExecutor.create("test_obralocal");

    await executor.run(
      `ALTER TABLE jobs
       ADD COLUMN notes TEXT;`
    );
    await executor.run(
      `DROP TRIGGER IF EXISTS
       trg_catalog_items_au`
    );
    await executor.run("INSERT INTO sequences (key, val) VALUES (?, ?)", ["k", 1]);

    expect(mockDb.execute).toHaveBeenCalledWith("ALTER TABLE jobs        ADD COLUMN notes TEXT;", false);
    expect(mockDb.execute).toHaveBeenCalledWith(
      "DROP TRIGGER IF EXISTS        trg_catalog_items_au;",
      false
    );
    expect(mockDb.run).toHaveBeenCalledWith(
      "INSERT INTO sequences (key, val) VALUES (?, ?)",
      ["k", 1],
      false
    );

    await executor.close();
  });
});
