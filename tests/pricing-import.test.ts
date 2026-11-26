import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GraphRunner } from "../src/agent/graphRunner";
import { LocalInferenceAdapterImpl } from "../src/agent/inference/localInferenceAdapter";
import { ResetService } from "../src/core/backup/resetService";
import { NodeBetterSqliteExecutor } from "../src/core/db/nodeSqliteExecutor";
import { CatalogRepository } from "../src/core/db/repositories/catalogRepo";
import { ClientsRepository } from "../src/core/db/repositories/clientsRepo";
import { QuotesRepository } from "../src/core/db/repositories/quotesRepo";
import { SettingsRepository } from "../src/core/db/repositories/settingsRepo";
import { TracesRepository } from "../src/core/db/repositories/tracesRepo";
import { initializeSchema } from "../src/core/db/sqliteExecutor";
import { MemoryFileBridge } from "../src/core/files/memoryFileBridge";
import { MemoryCoordinatorNoop } from "../src/core/memory/memoryCoordinator";
import { PREDEFINED_CATALOG_TEMPLATES } from "../src/core/pricing/predefinedCatalog";
import {
  computeCatalogUnitPriceCents,
  formatPricingBreakdown,
} from "../src/core/pricing/pricingEngine";
import {
  commitImportedCatalogAndConfig,
  parseCatalogAndRatesFromText,
} from "../src/features/pricing/documentImportPipeline";
import { MockFreezerPort, MockOcrPort, MockPdfPort } from "./mocks/ports";

describe("Tarifario Dinámico, Plantillas, Importador IA, Migración y Módulos Separados", () => {
  let executor: NodeBetterSqliteExecutor;
  let settingsRepo: SettingsRepository;
  let catalogRepo: CatalogRepository;
  let clientsRepo: ClientsRepository;
  let quotesRepo: QuotesRepository;

  beforeEach(async () => {
    executor = new NodeBetterSqliteExecutor(":memory:");
    await initializeSchema(executor);
    settingsRepo = new SettingsRepository(executor);
    catalogRepo = new CatalogRepository(executor);
    clientsRepo = new ClientsRepository(executor);
    quotesRepo = new QuotesRepository(executor);
  });

  afterEach(async () => {
    await executor.close();
  });

  it("calcula duracion × tarifa/hora + materiales y recalcula partidas dinámicas al cambiar hourly_rate_cents", async () => {
    await settingsRepo.getAppSettings();
    expect(
      computeCatalogUnitPriceCents({
        pricing_mode: "hourly_plus_materials",
        estimated_hours_thousandths: 2500,
        materials_cents: 4500,
        hourly_rate_cents: 4000,
        fixed_price_cents: 0,
      })
    ).toBe(14500);

    const dynamicItem = await catalogRepo.create({
      description: "Instalación grifo con materiales",
      category: "Fontanería",
      unit: "ud",
      pricing_mode: "hourly_plus_materials",
      estimated_hours_thousandths: 1500,
      materials_cents: 2500,
      unit_price_cents: 1,
      default_vat_rate: 10,
    });
    // 1.5 * 38.00 + 25.00 = 57.00 + 25.00 = 82.00 (8200)
    expect(dynamicItem.unit_price_cents).toBe(8200);

    const fixedItem = await catalogRepo.create({
      description: "Desplazamiento fijo",
      category: "General",
      unit: "ud",
      pricing_mode: "fixed",
      unit_price_cents: 4500,
      default_vat_rate: 21,
    });

    // Subir tarifa base a 50,00 €/h -> solo cambia dynamicItem (1.5 * 50 + 25 = 100.00 = 10000)
    const updated = await settingsRepo.updateHourlyRate(5000);
    expect(updated.settings.hourly_rate_cents).toBe(5000);
    expect(updated.updatedCatalogCount).toBe(1);

    const afterDyn = await catalogRepo.getById(dynamicItem.id);
    const afterFixed = await catalogRepo.getById(fixedItem.id);
    expect(afterDyn?.unit_price_cents).toBe(10000);
    expect(afterFixed?.unit_price_cents).toBe(4500);
    expect(
      formatPricingBreakdown({
        pricing_mode: "hourly_plus_materials",
        estimated_hours_thousandths: 1500,
        materials_cents: 2500,
        hourly_rate_cents: 5000,
        unit_price_cents: 10000,
      })
    ).toContain("50,00 €");
  });

  it("activa partidas predefinidas sin duplicar y convierte precio manual en presupuesto a 'fixed'", async () => {
    const reset = new ResetService(executor);
    await reset.restoreDemoData(new MockFreezerPort());

    const tplGrifo = PREDEFINED_CATALOG_TEMPLATES[0]!;
    const first = await catalogRepo.activatePredefinedTemplate(tplGrifo, 3800);
    const second = await catalogRepo.activatePredefinedTemplate(tplGrifo, 3800);
    expect(second.createdOrReactivated).toBe(false);
    expect(second.item.id).toBe(first.item.id);

    // Crear partida dinámica y luego ajustarla manualmente en un presupuesto Gate 1
    const dyn = await catalogRepo.create({
      description: "Montaje radiador aluminio",
      category: "Fontanería",
      unit: "ud",
      pricing_mode: "hourly_plus_materials",
      estimated_hours_thousandths: 2000,
      materials_cents: 3000,
      unit_price_cents: 1,
      default_vat_rate: 10,
    });
    expect(dyn.pricing_mode).toBe("hourly_plus_materials");

    const runner = new GraphRunner(
      {
        executor,
        fileBridge: new MemoryFileBridge(),
        memoryCoordinator: new MemoryCoordinatorNoop(),
        inference: new LocalInferenceAdapterImpl(),
        ocrPort: new MockOcrPort(),
        pdfPort: new MockPdfPort(),
        traceRecorder: new TracesRepository(executor),
      },
      "memory"
    );
    const thr = await runner.createThread({ title: "Override a fixed" });
    await runner.runTurn(thr.thread_id, {
      client_turn_id: "t_ovr_1",
      text: "",
      action_type: "start_empty_quote",
    });

    await runner.resumeGate(thr.thread_id, {
      gate_id: "gate_1_quote",
      action: "edit",
      edited_payload: {
        quote_id: null,
        client_id: "cli_elena_garcia",
        job_id: null,
        job_title: "Cambio radiador",
        vat_rate: 10,
        notes: "",
        lines: [
          {
            catalog_item_id: dyn.id,
            description: dyn.description,
            category: "Fontanería",
            unit: "ud",
            quantity_thousandths: 1000,
            unit_price_cents: 15500,
            original_unit_price_cents: dyn.unit_price_cents,
            save_to_catalog: true,
          },
        ],
      },
      client_validated_at_ms: Date.now(),
    });

    const reloaded = await catalogRepo.getById(dyn.id);
    expect(reloaded?.unit_price_cents).toBe(15500);
    expect(reloaded?.pricing_mode).toBe("fixed");
  });

  it("extrae tarifas, impuestos y partidas desde texto/CSV y persiste importación atómica", async () => {
    const sampleDoc = [
      "TARIFA PROFESIONAL REFORMAS 2026",
      "Tarifa base mano de obra: 44,00 €/h",
      "IVA aplicado en vivienda: 10 %",
      "Retención IRPF: 15 %",
      "Cambio de grifo cocina monomando;ud;95,00 €",
      "Revisión cuadro eléctrico 18 módulos;ud;165,00 €",
      "2,5 h Reparación de fuga en bajante general - 110,00 €",
    ].join("\n");

    const draft = parseCatalogAndRatesFromText({
      documents: [{ fileName: "tarifas_2026.csv", rawText: sampleDoc }],
      currentHourlyRateCents: 3800,
      existingCatalog: [],
    });

    expect(draft.inferred_hourly_rate_cents).toBe(4400);
    expect(draft.detected_vat_rate).toBe(10);
    expect(draft.detected_irpf_rate).toBe(15);
    expect(draft.items.length).toBeGreaterThanOrEqual(3);
    expect(draft.detected_services).toContain("Fontanería");
    expect(draft.detected_services).toContain("Electricidad");

    const commitRes = await commitImportedCatalogAndConfig(executor, draft);
    expect(commitRes.savedCount).toBe(draft.items.length);
    expect(commitRes.appliedHourlyRateCents).toBe(4400);
    expect(commitRes.appliedTaxDefaults).toBe(true);

    const savedSettings = await settingsRepo.getAppSettings();
    expect(savedSettings.hourly_rate_cents).toBe(4400);
    expect(savedSettings.default_vat_rate).toBe(10);
    expect(savedSettings.irpf_reserve_rate).toBe(15);
  });

  it("migra esquema v1.4.0 antiguo y consulta portfolio de cliente + presupuestos sin tildes", async () => {
    const legacyDb = new NodeBetterSqliteExecutor(":memory:");
    try {
      await legacyDb.run(`
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
        );
      `);
      await legacyDb.run(`
        CREATE TABLE catalog_items (
          id TEXT PRIMARY KEY,
          description TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'General',
          unit TEXT NOT NULL DEFAULT 'ud',
          unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents > 0),
          default_vat_rate REAL NOT NULL DEFAULT 21,
          active INTEGER NOT NULL DEFAULT 1,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL
        );
      `);
      await legacyDb.run(
        `INSERT INTO app_settings (id, updated_at_ms) VALUES (1, 1000)`
      );
      await initializeSchema(legacyDb);

      const settingsCols = await legacyDb.query<{ name: string }>(`PRAGMA table_info(app_settings)`);
      const catalogCols = await legacyDb.query<{ name: string }>(`PRAGMA table_info(catalog_items)`);
      expect(settingsCols.some((c) => c.name === "hourly_rate_cents")).toBe(true);
      expect(catalogCols.some((c) => c.name === "pricing_mode")).toBe(true);
      expect(catalogCols.some((c) => c.name === "estimated_hours_thousandths")).toBe(true);
      expect(catalogCols.some((c) => c.name === "materials_cents")).toBe(true);
    } finally {
      await legacyDb.close();
    }

    const reset = new ResetService(executor);
    await reset.restoreDemoData(new MockFreezerPort());

    const clientStats = await clientsRepo.listPaginatedWithStats({ limit: 10 });
    expect(clientStats.items.some((c) => c.jobs_count > 0)).toBe(true);

    const portfolio = await clientsRepo.getClientPortfolio("cli_elena_garcia");
    expect(portfolio?.client.name).toBe("Elena García Martín");
    expect(portfolio?.jobs.length).toBeGreaterThanOrEqual(1);

    const qSearch = await quotesRepo.listPaginated({ search: "garcia" });
    expect(qSearch.totalCount).toBeGreaterThanOrEqual(1);
  });

  it("activatePredefinedTemplate respeta precio por defecto, guarda precio personalizado como fixed, reactiva inactivas y rechaza <= 0", async () => {
    await settingsRepo.getAppSettings();
    // tpl_cambio_grifo: 1h * 38,00 € + 51,00 € materiales = 89,00 € (8900 céntimos), modo hourly_plus_materials
    const tplGrifo = PREDEFINED_CATALOG_TEMPLATES.find((t) => t.template_id === "tpl_cambio_grifo")!;
    // tpl_punto_luz: 1h * 38,00 € + 14,00 € materiales = 52,00 € (5200 céntimos), modo hourly_plus_materials
    const tplPuntoLuz = PREDEFINED_CATALOG_TEMPLATES.find((t) => t.template_id === "tpl_punto_luz")!;

    // 1. Activar con precio por defecto (sin options y con options coincidente) preserva hourly_plus_materials
    const defaultRes = await catalogRepo.activatePredefinedTemplate(tplGrifo, 3800, {
      customUnitPriceCents: 8900,
    });
    expect(defaultRes.createdOrReactivated).toBe(true);
    expect(defaultRes.item.unit_price_cents).toBe(8900);
    expect(defaultRes.item.pricing_mode).toBe("hourly_plus_materials");
    expect(defaultRes.item.estimated_hours_thousandths).toBe(1000);
    expect(defaultRes.item.materials_cents).toBe(5100);

    // 2. Activar con precio personalizado cambia a fixed con 0 horas y 0 materiales
    const customRes = await catalogRepo.activatePredefinedTemplate(tplPuntoLuz, 3800, {
      customUnitPriceCents: 10550,
    });
    expect(customRes.createdOrReactivated).toBe(true);
    expect(customRes.item.unit_price_cents).toBe(10550);
    expect(customRes.item.pricing_mode).toBe("fixed");
    expect(customRes.item.estimated_hours_thousandths).toBe(0);
    expect(customRes.item.materials_cents).toBe(0);

    // Subir tarifa base a 50 €/h -> la partida personalizada fixed NO se recalcula; la de por defecto SÍ
    await settingsRepo.updateHourlyRate(5000);
    const grifoAfterRate = await catalogRepo.getById(defaultRes.item.id);
    const puntoLuzAfterRate = await catalogRepo.getById(customRes.item.id);
    expect(grifoAfterRate?.unit_price_cents).toBe(10100);
    expect(puntoLuzAfterRate?.unit_price_cents).toBe(10550);

    // 3. Desactivar y reactivar partida existente inactiva con precio personalizado
    await catalogRepo.deactivate(defaultRes.item.id);
    const inactiveCheck = await catalogRepo.getById(defaultRes.item.id);
    expect(inactiveCheck?.active).toBe(0);

    const reactivatedCustom = await catalogRepo.activatePredefinedTemplate(tplGrifo, 5000, {
      customUnitPriceCents: 12345,
    });
    expect(reactivatedCustom.createdOrReactivated).toBe(true);
    expect(reactivatedCustom.item.id).toBe(defaultRes.item.id);
    expect(reactivatedCustom.item.active).toBe(1);
    expect(reactivatedCustom.item.unit_price_cents).toBe(12345);
    expect(reactivatedCustom.item.pricing_mode).toBe("fixed");
    expect(reactivatedCustom.item.estimated_hours_thousandths).toBe(0);
    expect(reactivatedCustom.item.materials_cents).toBe(0);

    // 4. Rechaza <= 0 céntimos o no entero
    await expect(
      catalogRepo.activatePredefinedTemplate(tplGrifo, 3800, { customUnitPriceCents: 0 })
    ).rejects.toThrow(/SCHEMA_VALIDATION_ERROR/);
    await expect(
      catalogRepo.activatePredefinedTemplate(tplGrifo, 3800, { customUnitPriceCents: -250 })
    ).rejects.toThrow(/SCHEMA_VALIDATION_ERROR/);
    await expect(
      catalogRepo.activatePredefinedTemplate(tplGrifo, 3800, { customUnitPriceCents: 12.5 })
    ).rejects.toThrow(/SCHEMA_VALIDATION_ERROR/);
  });
});
