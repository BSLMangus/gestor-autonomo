import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DemoSeeder } from "../src/agent/demoSeeder";
import { GraphRunner } from "../src/agent/graphRunner";
import { LocalInferenceAdapterImpl } from "../src/agent/inference/localInferenceAdapter";
import { BackupService } from "../src/core/backup/backupService";
import { ResetService } from "../src/core/backup/resetService";
import { AuthRepository } from "../src/core/db/repositories/authRepo";
import { SettingsRepository } from "../src/core/db/repositories/settingsRepo";
import { TracesRepository } from "../src/core/db/repositories/tracesRepo";
import { NodeBetterSqliteExecutor } from "../src/core/db/nodeSqliteExecutor";
import { initializeSchema } from "../src/core/db/sqliteExecutor";
import { MemoryFileBridge } from "../src/core/files/memoryFileBridge";
import { LocalMemoryCoordinator } from "../src/core/memory/memoryCoordinator";
import { PdfMakeAdapter } from "../src/features/pdf/pdfMakeAdapter";
import { MockFreezerPort, MockOcrPort, MockPdfPort } from "./mocks/ports";

const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("AuthRepository, Onboarding, Clean Boot por Defecto y IBAN/Logo en PDFs", () => {
  let executor: NodeBetterSqliteExecutor;
  let authRepo: AuthRepository;
  let settingsRepo: SettingsRepository;
  let backupService: BackupService;
  let resetService: ResetService;
  let demoSeeder: DemoSeeder;

  beforeEach(async () => {
    executor = new NodeBetterSqliteExecutor(":memory:");
    await initializeSchema(executor);
    authRepo = new AuthRepository(executor);
    settingsRepo = new SettingsRepository(executor);
    backupService = new BackupService(executor);
    resetService = new ResetService(executor);

    const graphRunner = new GraphRunner(
      {
        executor,
        fileBridge: new MemoryFileBridge(),
        memoryCoordinator: new LocalMemoryCoordinator(),
        inference: new LocalInferenceAdapterImpl(),
        ocrPort: new MockOcrPort(),
        pdfPort: new MockPdfPort(),
        traceRecorder: new TracesRepository(executor),
      },
      "memory"
    );
    demoSeeder = new DemoSeeder(executor, graphRunner);
  });

  afterEach(async () => {
    await executor.close();
  });

  it("ensureInitialBoot() sin parámetros inicializa en modo clean con 0 datos demo", async () => {
    const outcome = await demoSeeder.ensureInitialBoot();
    expect(outcome).toBe("clean_initialized");

    const [clients, jobs, quotes, threads, settings] = await Promise.all([
      executor.query<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM clients`),
      executor.query<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM jobs`),
      executor.query<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM quotes`),
      executor.query<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM chat_threads`),
      settingsRepo.getAppSettings(),
    ]);

    expect(clients[0]?.cnt).toBe(0);
    expect(jobs[0]?.cnt).toBe(0);
    expect(quotes[0]?.cnt).toBe(0);
    expect(threads[0]?.cnt).toBe(0);
    expect(settings.boot_mode).toBe("clean");
    expect(settings.active_account_id).toBeNull();
  });

  it("registra cuenta con hash PBKDF2-SHA256, valida login, logout y onboarding", async () => {
    expect(await authRepo.hasAnyAccount()).toBe(false);
    expect(await authRepo.getActiveAccount()).toBeNull();

    // Contraseña demasiado corta
    await expect(
      authRepo.registerAccount({
        display_name: "Ana Reformas",
        email: "ana@obralocal.es",
        password: "123",
      })
    ).rejects.toThrow();

    const created = await authRepo.registerAccount({
      display_name: "Ana Reformas",
      email: "ANA@obralocal.es",
      password: "ClaveSegura2026",
    });

    expect(created.email).toBe("ana@obralocal.es");
    expect(created.display_name).toBe("Ana Reformas");
    expect(created.onboarding_completed).toBe(false);
    expect(await authRepo.hasAnyAccount()).toBe(true);
    expect((await authRepo.getActiveAccount())?.id).toBe(created.id);

    // Pre-rellena emitter_name y evita duplicados de email
    const settingsAfterReg = await settingsRepo.getAppSettings();
    expect(settingsAfterReg.emitter_name).toBe("Ana Reformas");
    await expect(
      authRepo.registerAccount({
        display_name: "Otra Cuenta",
        email: "ana@obralocal.es",
        password: "OtraClave123",
      })
    ).rejects.toThrow(/EMAIL_ALREADY_EXISTS/);

    // Completa onboarding
    const completed = await authRepo.completeOnboarding(created.id);
    expect(completed.onboarding_completed).toBe(true);

    // Logout limpia sesión activa sin borrar cuenta
    await authRepo.logout();
    expect(await authRepo.getActiveAccount()).toBeNull();
    expect(await authRepo.hasAnyAccount()).toBe(true);

    // Contraseña incorrecta falla
    await expect(
      authRepo.loginAccount({ email: "ana@obralocal.es", password: "incorrecta" })
    ).rejects.toThrow(/INVALID_CREDENTIALS/);

    // Login correcto restaura sesión con onboarding_completed = true
    const loggedIn = await authRepo.loginAccount({
      email: "ana@obralocal.es",
      password: "ClaveSegura2026",
    });
    expect(loggedIn.id).toBe(created.id);
    expect(loggedIn.onboarding_completed).toBe(true);
    expect((await authRepo.getActiveAccount())?.id).toBe(created.id);
  });

  it("purga datos demo legados al registrar cuenta nueva si boot_mode='demo', pero conserva datos reales en 'clean'", async () => {
    // Escenario 1: BD heredada con datos demo
    await resetService.restoreDemoData(new MockFreezerPort());
    expect((await executor.query<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM clients`))[0]?.cnt).toBe(4);
    expect((await settingsRepo.getAppSettings()).boot_mode).toBe("demo");

    await authRepo.registerAccount({
      display_name: "Usuario Real",
      email: "real@reformas.es",
      password: "Password123",
    });

    expect((await executor.query<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM clients`))[0]?.cnt).toBe(0);
    expect((await executor.query<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM jobs`))[0]?.cnt).toBe(0);
    expect((await executor.query<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM quotes`))[0]?.cnt).toBe(0);
    expect((await settingsRepo.getAppSettings()).boot_mode).toBe("clean");

    // Escenario 2: BD en modo clean con datos reales + nueva cuenta no borra datos propios
    await executor.run(
      `INSERT INTO clients (id, name, nif, fiscal_address, phone, email, notes, created_at_ms, updated_at_ms)
       VALUES ('cli_real_1', 'Cliente Propio', '', '', '', '', '', 1000, 1000)`
    );
    await authRepo.logout();
    await authRepo.registerAccount({
      display_name: "Segundo Usuario",
      email: "socio@reformas.es",
      password: "Password123",
    });
    expect((await executor.query<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM clients`))[0]?.cnt).toBe(1);
  });

  it("persiste y respalda emitter_iban y emitter_logo_data_url preservando active_account_id y migrando BD legada", async () => {
    const acc = await authRepo.registerAccount({
      display_name: "Taller Sur",
      email: "taller@sur.es",
      password: "Password123",
    });

    await settingsRepo.updateEmitterProfile({
      emitter_name: "Taller Sur S.L.",
      emitter_nif: "12345678Z",
      emitter_fiscal_address: "C/ Mayor 5, Sevilla",
      emitter_phone: "+34600112233",
      emitter_iban: "es91 2100 0418 4502 0005 1332",
      emitter_logo_data_url: TINY_PNG_DATA_URL,
    });

    const saved = await settingsRepo.getAppSettings();
    expect(saved.emitter_iban).toBe("ES9121000418450200051332");
    expect(saved.emitter_logo_data_url).toBe(TINY_PNG_DATA_URL);

    const backup = await backupService.exportBackupJson();
    await resetService.startFromScratch();

    // startFromScratch conserva sesión activa
    expect((await authRepo.getActiveAccount())?.id).toBe(acc.id);
    expect((await settingsRepo.getAppSettings()).emitter_iban).toBe("");

    await backupService.importBackupJson(backup);
    const restored = await settingsRepo.getAppSettings();
    expect(restored.emitter_iban).toBe("ES9121000418450200051332");
    expect(restored.emitter_logo_data_url).toBe(TINY_PNG_DATA_URL);
    expect(restored.active_account_id).toBe(acc.id);

    // Migración ALTER TABLE sobre BD legada sin columnas de cuentas/IBAN/logo
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
          boot_mode TEXT NOT NULL DEFAULT 'clean',
          updated_at_ms INTEGER NOT NULL
        )
      `);
      await legacyExec.run(
        `INSERT INTO app_settings (id, emitter_name, updated_at_ms) VALUES (1, 'Legacy', 1000)`
      );
      await initializeSchema(legacyExec);
      const migrated = await new SettingsRepository(legacyExec).getAppSettings();
      expect(migrated.emitter_iban).toBe("");
      expect(migrated.emitter_logo_data_url).toBeNull();
      expect(migrated.active_account_id).toBeNull();
    } finally {
      await legacyExec.close();
    }
  });

  it("PdfMakeAdapter genera PDF válido con logotipo Data URL e IBAN del emisor", async () => {
    const pdfAdapter = new PdfMakeAdapter();
    const res = await pdfAdapter.buildDocumentPdf({
      kind: "quote",
      quoteCode: "PRE-2026-001",
      issuedDateIso: "2026-11-22",
      emitter: {
        name: "Instalaciones Morales",
        nif: "12345678Z",
        fiscalAddress: "C/ Mayor 10, Madrid",
        phone: "+34600112233",
        iban: "ES9121000418450200051332",
        logoDataUrl: TINY_PNG_DATA_URL,
      },
      client: {
        name: "Elena Martín",
        nif: "45891234R",
        fiscalAddress: "Av. Libertad 4, Madrid",
        phone: "+34611223344",
      },
      jobTitle: "Reforma integral cocina",
      vatRate: 10,
      subtotalCents: 10000,
      vatCents: 1000,
      totalCents: 11000,
      notes: "Pago por transferencia al IBAN indicado.",
      lines: [
        {
          description: "Cambio de grifo cocina",
          unit: "ud",
          quantityThousandths: 1000,
          unitPriceCents: 10000,
          lineSubtotalCents: 10000,
        },
      ],
    });

    expect(res.fileName).toBe("PRE-2026-001.pdf");
    expect(res.pdfBytes.byteLength).toBeGreaterThan(500);
    const header = new TextDecoder().decode(res.pdfBytes.slice(0, 4));
    expect(header).toBe("%PDF");
  });
});
