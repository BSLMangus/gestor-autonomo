import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BackupService } from "../src/core/backup/backupService";
import { ResetService } from "../src/core/backup/resetService";
import { NodeBetterSqliteExecutor } from "../src/core/db/nodeSqliteExecutor";
import { SettingsRepository } from "../src/core/db/repositories/settingsRepo";
import { initializeSchema } from "../src/core/db/sqliteExecutor";
import { MockFreezerPort } from "./mocks/ports";

describe("Preferencia expand_long_text_inputs en app_settings", () => {
  let executor: NodeBetterSqliteExecutor;

  beforeEach(async () => {
    executor = new NodeBetterSqliteExecutor(":memory:");
    await initializeSchema(executor);
  });

  afterEach(async () => {
    await executor.close();
  });

  it("activa expand_long_text_inputs por defecto y permite alternarlo en SQLite", async () => {
    const repo = new SettingsRepository(executor);
    const initial = await repo.getAppSettings();
    expect(initial.expand_long_text_inputs).toBe(true);

    const disabled = await repo.updateExpandLongTextInputs(false);
    expect(disabled.expand_long_text_inputs).toBe(false);

    const reloaded = await repo.getAppSettings();
    expect(reloaded.expand_long_text_inputs).toBe(false);

    const reEnabled = await repo.updateExpandLongTextInputs(true);
    expect(reEnabled.expand_long_text_inputs).toBe(true);
  });

  it("migra tablas app_settings legadas sin expand_long_text_inputs activándola por defecto", async () => {
    const legacy = new NodeBetterSqliteExecutor(":memory:");
    try {
      await legacy.run(`
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
          boot_mode TEXT NOT NULL DEFAULT 'clean',
          updated_at_ms INTEGER NOT NULL
        )
      `);
      await legacy.run(
        `INSERT INTO app_settings (id, emitter_name, updated_at_ms) VALUES (1, 'Legado', 1000)`
      );
      await initializeSchema(legacy);

      const settings = await new SettingsRepository(legacy).getAppSettings();
      expect(settings.expand_long_text_inputs).toBe(true);
    } finally {
      await legacy.close();
    }
  });

  it("ResetService.startFromScratch y BackupService.importBackupJson preservan la preferencia local del dispositivo", async () => {
    const repo = new SettingsRepository(executor);
    await repo.updateExpandLongTextInputs(false);

    const backup = await new BackupService(executor).exportBackupJson();
    await new ResetService(executor).startFromScratch();
    expect((await repo.getAppSettings()).expand_long_text_inputs).toBe(false);

    await new BackupService(executor).importBackupJson(backup);
    expect((await repo.getAppSettings()).expand_long_text_inputs).toBe(false);

    await new ResetService(executor).restoreDemoData(new MockFreezerPort());
    expect((await repo.getAppSettings()).expand_long_text_inputs).toBe(false);
  });
});
