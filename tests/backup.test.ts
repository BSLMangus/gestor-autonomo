import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeBetterSqliteExecutor } from "../src/core/db/nodeSqliteExecutor";
import { initializeSchema } from "../src/core/db/sqliteExecutor";
import { BackupService } from "../src/core/backup/backupService";
import { ResetService } from "../src/core/backup/resetService";
import { CheckpointsRepository } from "../src/core/db/repositories/checkpointsRepo";
import { SettingsRepository } from "../src/core/db/repositories/settingsRepo";
import { MockFreezerPort } from "./mocks/ports";

describe("Backup AES-256-GCM, Purga Checkpoints, Demo Reset y StartFromScratch", () => {
  let executor: NodeBetterSqliteExecutor;
  let backupService: BackupService;
  let resetService: ResetService;
  let settingsRepo: SettingsRepository;
  let checkpointsRepo: CheckpointsRepository;

  beforeEach(async () => {
    executor = new NodeBetterSqliteExecutor(":memory:");
    await initializeSchema(executor);
    backupService = new BackupService(executor);
    resetService = new ResetService(executor);
    settingsRepo = new SettingsRepository(executor);
    checkpointsRepo = new CheckpointsRepository(executor);
  });

  afterEach(async () => {
    await executor.close();
  });

  it("siembra Fase 1 demo e invoca SeedGraphFreezerPort fuera de inTransaction", async () => {
    const freezer = new MockFreezerPort();
    await resetService.restoreDemoData(freezer);
    expect(freezer.called).toBe(true);
    expect(freezer.callCount).toBe(1);

    const threads = await executor.query<{ thread_id: string }>(`SELECT thread_id FROM chat_threads`);
    expect(threads.length).toBe(5);

    // Solo inserta trazas históricas 3..5 en Fase 1 (1 y 2 corresponden a Fase 2 DemoSeeder)
    const traces = await executor.query<{ trace_id: string }>(`SELECT trace_id FROM agent_traces`);
    expect(traces.map((t) => t.trace_id).sort()).toEqual([
      "tr_seed_03_post",
      "tr_seed_03_pre",
      "tr_seed_04_fiscal",
      "tr_seed_04_qa",
      "tr_seed_05_sl",
    ]);
  });

  it("exporta e importa backup plano y cifrado AES-256-GCM purgando checkpoints y FK inversas", async () => {
    await resetService.restoreDemoData(new MockFreezerPort());

    // Simula checkpoints y drafts antiguos antes de importar
    await executor.run(
      `INSERT INTO lg_checkpoints (
        thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id,
        checkpoint_type, checkpoint_data, metadata_type, metadata_data,
        schema_version, has_pending_interrupt, created_at_ms
      ) VALUES ('thr_old', '', 'cp_old', NULL, 'json', '{}', 'json', '{}', '1.0.0', 1, 1000)`
    );

    const plainBackup = await backupService.exportBackupJson();
    expect(plainBackup.encrypted).toBe(false);
    expect(plainBackup.version).toBe("1.0.0");

    const encBackup = await backupService.exportBackupJson("ClaveObra2026!");
    expect(encBackup.encrypted).toBe(true);
    expect(encBackup.cipher).toBe("AES-256-GCM");
    expect(encBackup.iterations).toBe(210000);

    // Rechaza contraseña incorrecta
    await expect(
      backupService.importBackupJson(encBackup, "ClaveErronea")
    ).rejects.toThrow(/SCHEMA_VALIDATION_ERROR/);

    // Limpia todo y restaura desde backup cifrado
    await resetService.startFromScratch({ FAC: 10 });
    expect((await executor.query(`SELECT * FROM clients`)).length).toBe(0);

    const imported = await backupService.importBackupJson(encBackup, "ClaveObra2026!");
    expect(imported.ok).toBe(true);
    expect(imported.restoredCounts.clients).toBe(4);
    expect(imported.restoredCounts.invoices).toBe(4);

    // Verifica limpieza de checkpoints y boot_mode = 'clean'
    expect((await executor.query(`SELECT * FROM lg_checkpoints`)).length).toBe(0);
    const settings = await settingsRepo.getAppSettings();
    expect(settings.boot_mode).toBe("clean");
    expect(settings.emitter_nif).toBe("12345678Z");
  });

  it("valida contadores iniciales en startFromScratch y configureSequences", async () => {
    await resetService.startFromScratch({ FAC: 12, PRE: 5 });
    const seqs = await settingsRepo.listSequences();
    expect(seqs.find((s) => s.series_type === "FAC")?.last_seq).toBe(12);
    expect(seqs.find((s) => s.series_type === "PRE")?.last_seq).toBe(5);

    await resetService.restoreDemoData(new MockFreezerPort());
    // FAC-2026-002 ya emitido -> bajar a 1 debe fallar
    await expect(settingsRepo.configureSequences(2026, { FAC: 1 })).rejects.toThrow(
      /INVALID_STATE_TRANSITION/
    );
    await settingsRepo.configureSequences(2026, { FAC: 10 });
    expect((await settingsRepo.listSequences(2026)).find((s) => s.series_type === "FAC")?.last_seq).toBe(10);

    // Verifica migrateIncompatibleCheckpoints rescata solo último checkpoint Gate 1/2
    await executor.run(
      `INSERT INTO lg_checkpoints (
        thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id,
        checkpoint_type, checkpoint_data, metadata_type, metadata_data,
        schema_version, has_pending_interrupt, created_at_ms
      ) VALUES ('thr_legacy', '', 'cp_01', NULL, 'json', ?, 'json', '{}', '0.9.0', 1, 2000)`,
      [
        JSON.stringify({
          channel_values: {
            pending_gate: "gate_1_quote",
            active_widget: {
              ui_widget_type: "QuoteBuilderWidget",
              widget_payload: {
                quote_id: null,
                client_id: "cli_elena_garcia",
                job_id: null,
                job_title: "Borrador antiguo",
                vat_rate: 10,
                notes: "",
                lines: [],
                subtotal_cents: 0,
                vat_cents: 0,
                total_cents: 0,
              },
            },
          },
        }),
      ]
    );
    const rescued = await checkpointsRepo.migrateIncompatibleCheckpoints("1.0.0");
    expect(rescued.length).toBe(1);
    expect(rescued[0]?.pending_gate).toBe("gate_1_quote");
  });

  it("persiste y exporta/importa configuración fiscal (default_vat_rate e irpf_reserve_rate) y migra BD legada", async () => {
    await settingsRepo.updateTaxSettings({ default_vat_rate: 10.5, irpf_reserve_rate: 15 });
    const updated = await settingsRepo.getAppSettings();
    expect(updated.default_vat_rate).toBe(10.5);
    expect(updated.irpf_reserve_rate).toBe(15);

    const backup = await backupService.exportBackupJson();
    await resetService.startFromScratch();
    const resetSettings = await settingsRepo.getAppSettings();
    expect(resetSettings.default_vat_rate).toBe(21);
    expect(resetSettings.irpf_reserve_rate).toBe(20);

    await backupService.importBackupJson(backup);
    const restoredSettings = await settingsRepo.getAppSettings();
    expect(restoredSettings.default_vat_rate).toBe(10.5);
    expect(restoredSettings.irpf_reserve_rate).toBe(15);

    // Migración ALTER TABLE sobre BD legada sin columnas default_vat_rate / irpf_reserve_rate
    const legacyExec = new NodeBetterSqliteExecutor(":memory:");
    try {
      await legacyExec.run(`
        CREATE TABLE app_settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          emitter_name TEXT NOT NULL DEFAULT '',
          emitter_nif TEXT NOT NULL DEFAULT '',
          emitter_fiscal_address TEXT NOT NULL DEFAULT '',
          emitter_phone TEXT NOT NULL DEFAULT '',
          last_active_thread_id TEXT,
          pending_camera_context_json TEXT,
          llm_enabled INTEGER NOT NULL DEFAULT 1,
          llm_model_uri TEXT,
          boot_mode TEXT NOT NULL DEFAULT 'demo',
          updated_at_ms INTEGER NOT NULL
        )
      `);
      await legacyExec.run(
        `INSERT INTO app_settings (id, emitter_name, updated_at_ms) VALUES (1, 'Legacy', 1000)`
      );
      await initializeSchema(legacyExec);
      const legacyRepo = new SettingsRepository(legacyExec);
      const migrated = await legacyRepo.getAppSettings();
      expect(migrated.default_vat_rate).toBe(21);
      expect(migrated.irpf_reserve_rate).toBe(20);
    } finally {
      await legacyExec.close();
    }
  });
});
