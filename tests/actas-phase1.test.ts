import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BackupService } from "../src/core/backup/backupService";
import { ResetService } from "../src/core/backup/resetService";
import { ActasRepository } from "../src/core/db/repositories/actasRepo";
import { ClientsRepository } from "../src/core/db/repositories/clientsRepo";
import { JobsRepository } from "../src/core/db/repositories/jobsRepo";
import { allocateNextSequence, SettingsRepository } from "../src/core/db/repositories/settingsRepo";
import { NodeBetterSqliteExecutor } from "../src/core/db/nodeSqliteExecutor";
import { initializeSchema } from "../src/core/db/sqliteExecutor";
import { MemoryFileBridge } from "../src/core/files/memoryFileBridge";
import {
  ACTA_CONFORMIDAD_TEMPLATE,
  computeActaCompletion,
  isInstallerActaProfileComplete,
} from "../src/features/actas/actaTemplates";

describe("Fase 1 Actas de Puesta en Marcha — Esquema, Repositorio, Pre-rellenado y Backups", () => {
  let executor: NodeBetterSqliteExecutor;
  let fileBridge: MemoryFileBridge;
  let actasRepo: ActasRepository;
  let settingsRepo: SettingsRepository;
  let clientsRepo: ClientsRepository;
  let jobsRepo: JobsRepository;

  beforeEach(async () => {
    executor = new NodeBetterSqliteExecutor(":memory:");
    await initializeSchema(executor);
    fileBridge = new MemoryFileBridge();
    actasRepo = new ActasRepository(executor);
    settingsRepo = new SettingsRepository(executor);
    clientsRepo = new ClientsRepository(executor);
    jobsRepo = new JobsRepository(executor);
  });

  afterEach(async () => {
    await executor.close();
  });

  it("migra una BD legacy (sequences sin 'ACT' y app_settings sin columnas técnicas) sin perder filas", async () => {
    const legacyExec = new NodeBetterSqliteExecutor(":memory:");
    try {
      await legacyExec.run(`
        CREATE TABLE local_accounts (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          display_name TEXT NOT NULL DEFAULT '',
          password_hash TEXT NOT NULL,
          password_salt TEXT NOT NULL,
          password_iterations INTEGER NOT NULL DEFAULT 100000,
          onboarding_completed INTEGER NOT NULL DEFAULT 0,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL
        );
      `);
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
          default_vat_rate REAL NOT NULL DEFAULT 21,
          irpf_reserve_rate REAL NOT NULL DEFAULT 20,
          boot_mode TEXT NOT NULL DEFAULT 'clean',
          updated_at_ms INTEGER NOT NULL
        );
      `);
      await legacyExec.run(`
        CREATE TABLE sequences (
          series_type TEXT NOT NULL CHECK (series_type IN ('PRE', 'ANT', 'FAC', 'OBR')),
          fiscal_year INTEGER NOT NULL CHECK (fiscal_year BETWEEN 2020 AND 2100),
          last_seq INTEGER NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
          updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0),
          PRIMARY KEY (series_type, fiscal_year)
        );
      `);
      await legacyExec.run(
        `INSERT INTO app_settings (id, emitter_name, emitter_nif, emitter_fiscal_address, emitter_phone, updated_at_ms)
         VALUES (1, 'Instalaciones Norte SL', '12345678Z', 'C/ Mayor 1', '600112233', 1000)`
      );
      await legacyExec.run(
        `INSERT INTO sequences (series_type, fiscal_year, last_seq, updated_at_ms)
         VALUES ('PRE', 2026, 7, 1000)`
      );

      await initializeSchema(legacyExec);

      const preSeqs = await legacyExec.query<{ last_seq: number }>(
        `SELECT last_seq FROM sequences WHERE series_type = 'PRE' AND fiscal_year = 2026`
      );
      expect(preSeqs[0]?.last_seq).toBe(7);

      const allocated = await legacyExec.inTransaction((tx) =>
        allocateNextSequence(tx, "ACT", 2026, 2000)
      );
      expect(allocated.code).toBe("ACT-2026-001");

      const migratedSettings = await new SettingsRepository(legacyExec).getAppSettings();
      expect(migratedSettings.emitter_name).toBe("Instalaciones Norte SL");
      expect(migratedSettings.default_acta_warranty_months).toBe(24);
      expect(migratedSettings.emitter_registry_number).toBe("");
    } finally {
      await legacyExec.close();
    }
  });

  it("genera códigos correlativos ACT-YYYY-NNN y rebobina al eliminar la última acta", async () => {
    const a1 = await actasRepo.createDraftFromContext({ fechaEmisionIso: "2026-11-25" });
    const a2 = await actasRepo.createDraftFromContext({ fechaEmisionIso: "2026-11-25" });
    expect(a1.row.codigo_acta).toBe("ACT-2026-001");
    expect(a2.row.codigo_acta).toBe("ACT-2026-002");

    // Borrar la última (002) rebobina la secuencia a 1 -> la siguiente vuelve a ser 002
    await actasRepo.delete(a2.row.id, fileBridge);
    const a2Reused = await actasRepo.createDraftFromContext({ fechaEmisionIso: "2026-11-25" });
    expect(a2Reused.row.codigo_acta).toBe("ACT-2026-002");

    // Borrar una intermedia (001) NO rebobina por debajo de 002 -> la siguiente es 003
    await actasRepo.delete(a1.row.id, fileBridge);
    const a3 = await actasRepo.createDraftFromContext({ fechaEmisionIso: "2026-11-25" });
    expect(a3.row.codigo_acta).toBe("ACT-2026-003");
  });

  it("permite múltiples actas por obra y client_id nullable", async () => {
    const job = await jobsRepo.createDirectJob({
      title: "Reforma local comercial",
      address: "Avda. Diagonal 120",
      client_id: null,
    });

    const first = await actasRepo.createDraftFromContext({
      jobId: job.id,
      especialidad: "electricidad",
      fechaEmisionIso: "2026-11-25",
    });
    const second = await actasRepo.createDraftFromContext({
      jobId: job.id,
      especialidad: "fontaneria",
      fechaEmisionIso: "2026-11-25",
    });

    expect(first.row.client_id).toBeNull();
    expect(second.row.client_id).toBeNull();
    expect(first.row.id).not.toBe(second.row.id);

    const jobActas = await actasRepo.listByJobId(job.id);
    expect(jobActas.length).toBe(2);
  });

  it("autocompleta datos de instalador, cliente, alcance, especialidad 'mixta' y partidas desde obra + presupuesto", async () => {
    await settingsRepo.updateEmitterProfile({
      emitter_name: "ElectroFontanería Pérez SL",
      emitter_nif: "12345678Z",
      emitter_fiscal_address: "C/ Alcalá 50, Madrid",
      emitter_phone: "611223344",
      emitter_iban: "",
      emitter_logo_data_url: null,
    });
    const updatedSettings = await settingsRepo.updateInstallerActaProfile({
      emitter_email: "",
      emitter_registry_number: "REIE-28-09912",
      emitter_tech_name: "Carlos Pérez",
      emitter_tech_dni: "00000000T",
      emitter_installer_card: "CI-BT-4410",
      default_acta_warranty_months: 12,
    });
    expect(isInstallerActaProfileComplete(updatedSettings)).toBe(true);

    const client = await clientsRepo.create({
      name: "Marta Gómez",
      nif: "11111111H",
      fiscal_address: "C/ Velázquez 14, 3º 2ª",
      phone: "699887766",
      email: "marta@ejemplo.es",
    });
    const job = await jobsRepo.createDirectJob({
      title: "Reforma baño y cuadro eléctrico",
      address: "C/ Velázquez 14, 3º 2ª",
      client_id: client.id,
    });

    const now = Date.now();
    await executor.run(
      `INSERT INTO quotes (
        id, quote_code, job_id, client_id, client_name_snapshot, client_nif_snapshot,
        client_address_snapshot, client_phone_snapshot, vat_rate, subtotal_cents,
        vat_cents, total_cents, status, notes, pdf_uri, sent_at_iso, created_at_ms, updated_at_ms
      ) VALUES ('quo_mix_1', 'PRE-2026-010', ?, ?, ?, ?, ?, ?, 21, 100000, 21000, 121000, 'aceptado', '', NULL, NULL, ?, ?)`,
      [job.id, client.id, client.name, client.nif, client.fiscal_address, client.phone, now, now]
    );
    await executor.run(
      `INSERT INTO quote_items (
        id, quote_id, line_order, catalog_item_id, description, category, unit,
        quantity_thousandths, unit_price_cents, line_subtotal_cents
      ) VALUES
        ('qi_1', 'quo_mix_1', 0, NULL, 'Cuadro eléctrico 12 módulos + IGA 25A', 'Electricidad', 'ud', 1000, 50000, 50000),
        ('qi_2', 'quo_mix_1', 1, NULL, 'Termo eléctrico 80L + red multicapa baño', 'Fontanería', 'ud', 1000, 50000, 50000)`
    );

    const { row, data } = await actasRepo.createDraftFromContext({
      jobId: job.id,
      activeAccountEmail: "fallback@cuenta.es",
      fechaEmisionIso: "2026-11-25",
    });

    expect(row.especialidad).toBe("mixta");
    expect(data.instalador.nombre_razon_social).toBe("ElectroFontanería Pérez SL");
    expect(data.instalador.email).toBe("fallback@cuenta.es");
    expect(data.instalador.num_registro_empresa).toBe("REIE-28-09912");
    expect(data.instalador.tecnico_nombre).toBe("Carlos Pérez");
    expect(data.instalador.tecnico_dni).toBe("00000000T");
    expect(data.cliente.nombre_razon_social).toBe("Marta Gómez");
    expect(data.cliente.email).toBe("marta@ejemplo.es");
    expect(data.alcance_ubicacion).toContain("Reforma baño y cuadro eléctrico");
    expect(data.memoria_electricidad?.receptores_conectados).toContain("Cuadro eléctrico 12 módulos");
    expect(data.memoria_fontaneria?.equipos_sanitarios).toContain("Termo eléctrico 80L");
    expect(data.plazo_garantia_meses).toBe(12);
    expect(data.clausula_conformidad).toBe(ACTA_CONFORMIDAD_TEMPLATE);
    expect(data.clausula_recepcion_cliente).toContain("12 meses");

    const progress = computeActaCompletion(data);
    expect(progress.completedBlocks).toBeGreaterThanOrEqual(2);
  });

  it("valida DNI técnico inválido y permite actualizar datos fiscales básicos junto a la ficha técnica", async () => {
    await expect(
      settingsRepo.updateInstallerActaProfile({
        emitter_tech_dni: "12345678A",
      })
    ).rejects.toThrow();

    const updated = await settingsRepo.updateInstallerActaProfile({
      emitter_name: "Instalador Inline SL",
      emitter_nif: "12345678Z",
      emitter_fiscal_address: "C/ Serrano 10",
      emitter_phone: "600000111",
      emitter_email: "tecnico@inline.es",
      emitter_tech_name: "Luis Martín",
      emitter_tech_dni: "00000000T",
      emitter_registry_number: "RII-08-123",
      emitter_installer_card: "CI-998",
      default_acta_warranty_months: 36,
    });
    expect(updated.emitter_name).toBe("Instalador Inline SL");
    expect(updated.emitter_tech_name).toBe("Luis Martín");
    expect(updated.default_acta_warranty_months).toBe(36);
    expect(isInstallerActaProfileComplete(updated)).toBe(true);
  });

  it("exporta, resetea e importa backups con actas, serie ACT y ficha de instalador (y soporta backups legacy)", async () => {
    const backupService = new BackupService(executor);
    const resetService = new ResetService(executor);

    await settingsRepo.updateInstallerActaProfile({
      emitter_email: "soporte@instalador.es",
      emitter_registry_number: "REIE-28-777",
      emitter_tech_name: "Ana Ruiz",
      emitter_tech_dni: "12345678Z",
      emitter_installer_card: "CI-777",
      default_acta_warranty_months: 24,
    });
    const client = await clientsRepo.create({ name: "Comunidad Sol", nif: "11111111H" });
    const created = await actasRepo.createDraftFromContext({
      clientId: client.id,
      especialidad: "fontaneria",
      fechaEmisionIso: "2026-11-25",
    });

    const signed = await actasRepo.markSigned(created.row.id, {
      firmaClienteBase64: "data:image/png;base64,AAAA",
      pdfUri: null,
    });
    expect(signed.row.estado).toBe("firmada");

    const encrypted = await backupService.exportBackupJson("ClaveActa2026!");
    await resetService.startFromScratch({ PRE: 0, ANT: 0, FAC: 0, OBR: 0, ACT: 0 });
    expect((await actasRepo.listPaginated()).totalCount).toBe(0);

    const restored = await backupService.importBackupJson(encrypted, "ClaveActa2026!");
    expect(restored.restoredCounts.actas_puesta_en_marcha).toBe(1);

    const reloadedActa = await actasRepo.getById(created.row.id);
    expect(reloadedActa?.row.codigo_acta).toBe("ACT-2026-001");
    expect(reloadedActa?.row.estado).toBe("firmada");

    const reloadedSettings = await settingsRepo.getAppSettings();
    expect(reloadedSettings.emitter_tech_name).toBe("Ana Ruiz");
    expect(reloadedSettings.emitter_registry_number).toBe("REIE-28-777");

    // Borrado físico limpia fotos comprometidas y PDF
    const tempPhoto = await fileBridge.saveTempMedia(new Uint8Array([1, 2, 3]), "jpg");
    const committedPhoto = await fileBridge.commitMedia(tempPhoto, "sitelogs");
    expect(committedPhoto).toBeTruthy();
    await actasRepo.saveDraft(created.row.id, {
      data: {
        ...reloadedActa!.data,
        fotos: [
          {
            id: "f1",
            uri: committedPhoto!,
            pie_foto: "Cuadro",
            timestamp: "2026-11-25T10:00:00Z",
          },
        ],
      },
    });
    await actasRepo.delete(created.row.id, fileBridge);
    expect(fileBridge.has(committedPhoto!)).toBe(false);
  });
});
