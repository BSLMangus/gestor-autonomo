import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeBetterSqliteExecutor } from "../src/core/db/nodeSqliteExecutor";
import { initializeSchema, sanitizeFts5Query } from "../src/core/db/sqliteExecutor";
import { CatalogRepository } from "../src/core/db/repositories/catalogRepo";
import { ClientsRepository } from "../src/core/db/repositories/clientsRepo";
import { JobsRepository } from "../src/core/db/repositories/jobsRepo";
import { ResetService } from "../src/core/backup/resetService";
import { MockFreezerPort } from "./mocks/ports";

describe("SQLite Schema, Triggers FTS5, Sanitización BM25 y Guardia FIFO", () => {
  let executor: NodeBetterSqliteExecutor;

  beforeEach(async () => {
    executor = new NodeBetterSqliteExecutor(":memory:");
    await initializeSchema(executor);
  });

  afterEach(async () => {
    await executor.close();
  });

  it("ejecuta docs/schema.sql completo con 9 triggers, foreign_keys ON y cascada checkpoints", async () => {
    const fk = await executor.query<{ foreign_keys: number }>(`PRAGMA foreign_keys;`);
    expect(fk[0]?.foreign_keys).toBe(1);

    const triggers = await executor.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'trigger'`
    );
    expect(triggers.length).toBe(9);

    // Verifica ON DELETE CASCADE de lg_checkpoints -> lg_checkpoint_writes
    await executor.run(
      `INSERT INTO lg_checkpoints (
        thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id,
        checkpoint_type, checkpoint_data, metadata_type, metadata_data,
        schema_version, has_pending_interrupt, created_at_ms
      ) VALUES ('t1', '', 'cp1', NULL, 'json', '{}', 'json', '{}', '1.0.0', 0, 1000)`
    );
    await executor.run(
      `INSERT INTO lg_checkpoint_writes (
        thread_id, checkpoint_ns, checkpoint_id, task_id, task_path,
        idx, channel, write_type, write_data
      ) VALUES ('t1', '', 'cp1', 'task1', '', 0, 'ch', 'json', '{}')`
    );
    await executor.run(`DELETE FROM lg_checkpoints WHERE thread_id = 't1'`);
    const remainingWrites = await executor.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM lg_checkpoint_writes`
    );
    expect(remainingWrites[0]?.cnt).toBe(0);
  });

  it("sanitiza consultas FTS5 y busca sin tildes ni errores de sintaxis", async () => {
    expect(sanitizeFts5Query("OBR-2026-003 AND NOT")).toBe('"OBR" "2026" "003"');
    expect(sanitizeFts5Query('term* "OR" (foo/bar)')).toBe('"term" "foo" "bar"');

    const reset = new ResetService(executor);
    await reset.restoreDemoData(new MockFreezerPort());

    const jobsRepo = new JobsRepository(executor);
    const catalogRepo = new CatalogRepository(executor);
    const clientsRepo = new ClientsRepository(executor);

    const jobRes = await jobsRepo.searchFts5WithScore("OBR-2026-003 AND NOT");
    expect(jobRes[0]?.id).toBe("job_02");

    const termoRes = await catalogRepo.searchFts5WithScore("termo electrico");
    expect(termoRes.some((r) => r.id === "cat_termo_80l")).toBe(true);

    const alicatadoRes = await catalogRepo.searchFts5WithScore("alicatado porcelanico");
    expect(alicatadoRes.some((r) => r.id === "cat_alicatado_m2")).toBe(true);

    // Verifica sincronización de triggers UPDATE y DELETE en catalog_items_fts
    const created = await catalogRepo.create({
      description: "Válvula termostática latón",
      category: "Fontanería",
      unit: "ud",
      unit_price_cents: 2900,
      default_vat_rate: 10,
    });
    expect(
      (await catalogRepo.searchFts5WithScore("valvula termostatica")).some(
        (r) => r.id === created.id
      )
    ).toBe(true);

    await catalogRepo.update(created.id, { description: "Grifo termostático ducha" });
    expect(
      (await catalogRepo.searchFts5WithScore("valvula")).some((r) => r.id === created.id)
    ).toBe(false);
    expect(
      (await catalogRepo.searchFts5WithScore("grifo termostatico")).some((r) => r.id === created.id)
    ).toBe(true);

    // Verifica bloqueo borrado de cliente con obras vinculadas
    await expect(clientsRepo.delete("cli_elena_garcia")).rejects.toThrow(/INVALID_STATE_TRANSITION/);
  });

  it("lanza SQLITE_QUERY_ERROR ante llamada reentrante a executor dentro de inTransaction", async () => {
    await expect(
      executor.inTransaction(async () => {
        await executor.query(`SELECT 1 AS ok`);
      })
    ).rejects.toThrow(/SQLITE_QUERY_ERROR/);

    await expect(
      executor.inTransaction(async () => {
        await executor.run(`DELETE FROM sequences`);
      })
    ).rejects.toThrow(/SQLITE_QUERY_ERROR/);
  });
});
