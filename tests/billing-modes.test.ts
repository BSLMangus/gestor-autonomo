import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GraphRunner } from "../src/agent/graphRunner";
import { LocalInferenceAdapterImpl } from "../src/agent/inference/localInferenceAdapter";
import { BackupService } from "../src/core/backup/backupService";
import { ResetService } from "../src/core/backup/resetService";
import { Gate1QuoteCommitPayloadSchema } from "../src/core/contracts/schemas";
import { NodeBetterSqliteExecutor } from "../src/core/db/nodeSqliteExecutor";
import { ClientsRepository } from "../src/core/db/repositories/clientsRepo";
import { InvoicesRepository } from "../src/core/db/repositories/invoicesRepo";
import { JobsRepository } from "../src/core/db/repositories/jobsRepo";
import { QuotesRepository } from "../src/core/db/repositories/quotesRepo";
import { SettingsRepository } from "../src/core/db/repositories/settingsRepo";
import { TracesRepository } from "../src/core/db/repositories/tracesRepo";
import { initializeSchema } from "../src/core/db/sqliteExecutor";
import { MemoryFileBridge } from "../src/core/files/memoryFileBridge";
import { computeQuoteTotalsByBillingMode } from "../src/core/fiscal/fiscalEngine";
import { MemoryCoordinatorNoop } from "../src/core/memory/memoryCoordinator";
import { MockFreezerPort, MockOcrPort, MockPdfPort } from "./mocks/ports";

describe("Modalidades de cobro (billing modes), migración quote_items, commit y facturación", () => {
  let executor: NodeBetterSqliteExecutor;
  let fileBridge: MemoryFileBridge;
  let pdfPort: MockPdfPort;
  let jobsRepo: JobsRepository;
  let quotesRepo: QuotesRepository;
  let clientsRepo: ClientsRepository;
  let invoicesRepo: InvoicesRepository;
  let settingsRepo: SettingsRepository;
  let runner: GraphRunner;

  beforeEach(async () => {
    executor = new NodeBetterSqliteExecutor(":memory:");
    await initializeSchema(executor);
    fileBridge = new MemoryFileBridge();
    pdfPort = new MockPdfPort();
    jobsRepo = new JobsRepository(executor);
    quotesRepo = new QuotesRepository(executor);
    clientsRepo = new ClientsRepository(executor);
    invoicesRepo = new InvoicesRepository(executor);
    settingsRepo = new SettingsRepository(executor);

    await new ResetService(executor).restoreDemoData(new MockFreezerPort());

    runner = new GraphRunner(
      {
        executor,
        fileBridge,
        memoryCoordinator: new MemoryCoordinatorNoop(),
        inference: new LocalInferenceAdapterImpl(),
        ocrPort: new MockOcrPort(),
        pdfPort,
        traceRecorder: new TracesRepository(executor),
      },
      "memory"
    );
  });

  afterEach(async () => {
    await executor.close();
  });

  it("migra tabla legacy quote_items (unit_price_cents > 0 -> >= 0) preservando filas y FKs", async () => {
    const legacyDb = new NodeBetterSqliteExecutor(":memory:");
    try {
      await initializeSchema(legacyDb);
      await new ResetService(legacyDb).restoreDemoData(new MockFreezerPort());

      await legacyDb.run("PRAGMA foreign_keys = OFF;");
      await legacyDb.inTransaction(async (tx) => {
        await tx.run(
          `CREATE TABLE quote_items_legacy (
            id TEXT PRIMARY KEY,
            quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
            line_order INTEGER NOT NULL CHECK (line_order >= 0),
            catalog_item_id TEXT REFERENCES catalog_items(id) ON DELETE SET NULL,
            description TEXT NOT NULL CHECK (length(trim(description)) > 0),
            category TEXT NOT NULL DEFAULT 'General' CHECK (category IN ('Fontanería', 'Electricidad', 'Albañilería', 'Pintura', 'General')),
            unit TEXT NOT NULL DEFAULT 'ud' CHECK (length(trim(unit)) > 0),
            quantity_thousandths INTEGER NOT NULL CHECK (quantity_thousandths > 0),
            unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents > 0),
            line_subtotal_cents INTEGER NOT NULL CHECK (line_subtotal_cents >= 0),
            UNIQUE (quote_id, line_order)
          );`
        );
        await tx.run(
          `INSERT INTO quote_items_legacy
           SELECT id, quote_id, line_order, catalog_item_id, description, category,
                  unit, quantity_thousandths, unit_price_cents, line_subtotal_cents
           FROM quote_items;`
        );
        await tx.run(`DROP TABLE quote_items;`);
        await tx.run(`ALTER TABLE quote_items_legacy RENAME TO quote_items;`);
      });
      await legacyDb.run("PRAGMA foreign_keys = ON;");

      const preItems = await legacyDb.query<{ id: string }>(`SELECT id FROM quote_items`);
      expect(preItems.length).toBeGreaterThan(0);

      await initializeSchema(legacyDb);

      const qiSqlRows = await legacyDb.query<{ sql: string | null }>(
        `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'quote_items'`
      );
      expect(qiSqlRows[0]?.sql).toBeTruthy();
      expect(qiSqlRows[0]?.sql).not.toMatch(/unit_price_cents\s*>\s*0/);
      expect(qiSqlRows[0]?.sql).toMatch(/unit_price_cents\s*>=\s*0/);

      const fkViolations = await legacyDb.query(`PRAGMA foreign_key_check;`);
      expect(fkViolations).toEqual([]);

      const postItems = await legacyDb.query<{ id: string }>(`SELECT id FROM quote_items`);
      expect(postItems).toHaveLength(preItems.length);

      const firstQuoteRows = await legacyDb.query<{ id: string }>(`SELECT id FROM quotes LIMIT 1`);
      const targetQuoteId = firstQuoteRows[0]!.id;
      await legacyDb.run(
        `INSERT INTO quote_items (
          id, quote_id, line_order, catalog_item_id, description, category,
          unit, quantity_thousandths, unit_price_cents, line_subtotal_cents
        ) VALUES ('qi_zero_test', ?, 99, NULL, 'Tarea sin precio unitario', 'General', 'ud', 1000, 0, 0)`,
        [targetQuoteId]
      );
      const inserted = await legacyDb.query<{ unit_price_cents: number }>(
        `SELECT unit_price_cents FROM quote_items WHERE id = 'qi_zero_test'`
      );
      expect(inserted[0]?.unit_price_cents).toBe(0);
    } finally {
      await legacyDb.close();
    }
  });

  it("persiste los 5 campos de modalidad de cobro en jobs y updateBillingConfig", async () => {
    const job = await jobsRepo.createDirectJob({
      title: "Reforma cuadro eléctrico",
      modalidad_cobro: "partidas_mas_horas",
      solo_mano_obra_submodo: "por_horas",
      horas_estimadas_thousandths: 4500,
      tarifa_hora_cents: 4200,
      mano_obra_fija_cents: 0,
    });
    expect(job.modalidad_cobro).toBe("partidas_mas_horas");
    expect(job.solo_mano_obra_submodo).toBe("por_horas");
    expect(job.horas_estimadas_thousandths).toBe(4500);
    expect(job.tarifa_hora_cents).toBe(4200);
    expect(job.mano_obra_fija_cents).toBe(0);

    const updated = await jobsRepo.updateBillingConfig(job.id, {
      modalidad_cobro: "solo_mano_obra",
      solo_mano_obra_submodo: "precio_cerrado",
      horas_estimadas_thousandths: 0,
      tarifa_hora_cents: null,
      mano_obra_fija_cents: 28000,
    });
    expect(updated.modalidad_cobro).toBe("solo_mano_obra");
    expect(updated.solo_mano_obra_submodo).toBe("precio_cerrado");
    expect(updated.horas_estimadas_thousandths).toBe(0);
    expect(updated.tarifa_hora_cents).toBeNull();
    expect(updated.mano_obra_fija_cents).toBe(28000);
  });

  it("calcula computeQuoteTotalsByBillingMode correctamente para los 4 modos y 2 submodos", () => {
    const lines = [
      { quantity_thousandths: 2000, unit_price_cents: 4500 }, // 9000 cts
      { quantity_thousandths: 1500, unit_price_cents: 2000 }, // 3000 cts
    ];

    // 1. solo_partidas
    const m1 = computeQuoteTotalsByBillingMode({
      billingMode: "solo_partidas",
      lines,
      vatRate: 21,
      horasEstimadasThousandths: 5000,
      tarifaHoraCents: 4000,
      manoObraFijaCents: 10000,
    });
    expect(m1).toEqual({
      itemsSubtotalCents: 12000,
      laborCents: 0,
      subtotalCents: 12000,
      vatCents: 2520,
      totalCents: 14520,
    });

    // 2. partidas_mas_horas (3.5h * 38,00 € = 133,00 € = 13300 cts)
    const m2 = computeQuoteTotalsByBillingMode({
      billingMode: "partidas_mas_horas",
      lines,
      vatRate: 10,
      horasEstimadasThousandths: 3500,
      tarifaHoraCents: 3800,
    });
    expect(m2).toEqual({
      itemsSubtotalCents: 12000,
      laborCents: 13300,
      subtotalCents: 25300,
      vatCents: 2530,
      totalCents: 27830,
    });

    // 3. partidas_mas_fijo_mano_obra
    const m3 = computeQuoteTotalsByBillingMode({
      billingMode: "partidas_mas_fijo_mano_obra",
      lines,
      vatRate: 21,
      manoObraFijaCents: 15000,
    });
    expect(m3).toEqual({
      itemsSubtotalCents: 12000,
      laborCents: 15000,
      subtotalCents: 27000,
      vatCents: 5670,
      totalCents: 32670,
    });

    // 4a. solo_mano_obra + por_horas (ignora unit_price_cents de las líneas)
    const m4a = computeQuoteTotalsByBillingMode({
      billingMode: "solo_mano_obra",
      laborSubMode: "por_horas",
      lines,
      vatRate: 21,
      horasEstimadasThousandths: 2500,
      tarifaHoraCents: 4000,
    });
    expect(m4a).toEqual({
      itemsSubtotalCents: 0,
      laborCents: 10000,
      subtotalCents: 10000,
      vatCents: 2100,
      totalCents: 12100,
    });

    // 4b. solo_mano_obra + precio_cerrado
    const m4b = computeQuoteTotalsByBillingMode({
      billingMode: "solo_mano_obra",
      laborSubMode: "precio_cerrado",
      lines,
      vatRate: 10,
      manoObraFijaCents: 32000,
    });
    expect(m4b).toEqual({
      itemsSubtotalCents: 0,
      laborCents: 32000,
      subtotalCents: 32000,
      vatCents: 3200,
      totalCents: 35200,
    });
  });

  it("ejecuta quoteSpecialist + quoteCommitNode en solo_mano_obra, sanitiza descripciones, pasa campos al PDF y persiste en jobs/quotes", async () => {
    await settingsRepo.updateHourlyRate(4500);
    const client = await clientsRepo.create({
      name: "Laura Gómez",
      nif: "12345678Z",
      fiscal_address: "C/ Alcalá 50, Madrid",
      phone: "+34611223344",
      email: "",
      notes: "",
    });
    const job = await jobsRepo.createDirectJob({
      title: "Asistencia fontanería urgente",
      client_id: client.id,
      modalidad_cobro: "solo_mano_obra",
      solo_mano_obra_submodo: "por_horas",
      horas_estimadas_thousandths: 3000,
      tarifa_hora_cents: null, // debe heredar appSettings.hourly_rate_cents (4500)
      mano_obra_fija_cents: 0,
    });

    const thr = await runner.createThread({ title: "Solo mano de obra" });
    const startTurn = await runner.runTurn(thr.thread_id, {
      client_turn_id: "t_mo_1",
      text: "",
      action_type: "start_job_quote",
      target_ids: { job_id: job.id },
    });
    expect(startTurn.checkpoint_status).toBe("interrupted");
    expect(startTurn.active_interrupt?.gate_id).toBe("gate_1_quote");
    if (startTurn.active_interrupt?.gate_id !== "gate_1_quote") {
      throw new Error("Expected gate_1_quote");
    }

    const seeded = startTurn.active_interrupt.proposed_payload;
    expect(seeded.modalidad_cobro).toBe("solo_mano_obra");
    expect(seeded.solo_mano_obra_submodo).toBe("por_horas");
    expect(seeded.horas_estimadas_thousandths).toBe(3000);
    expect(seeded.tarifa_hora_cents).toBe(4500);

    const edited = Gate1QuoteCommitPayloadSchema.parse({
      ...seeded,
      vat_rate: 21,
      horas_estimadas_thousandths: 4000,
      tarifa_hora_cents: 4500,
      lines: [
        {
          catalog_item_id: null,
          description: "Reparación fuga bajo fregadero 180 €",
          category: "Fontanería",
          unit: "ud",
          quantity_thousandths: 1000,
          unit_price_cents: 0,
          original_unit_price_cents: 0,
          save_to_catalog: true,
        },
      ],
    });

    const commitRes = await runner.resumeGate(thr.thread_id, {
      gate_id: "gate_1_quote",
      action: "edit",
      edited_payload: edited,
      client_validated_at_ms: Date.now(),
    });
    expect(commitRes.checkpoint_status).toBe("idle");
    expect(commitRes.error_code).toBeNull();

    const savedQuote = await quotesRepo.getById(commitRes.active_quote_id!);
    expect(savedQuote).toBeTruthy();
    expect(savedQuote?.modalidad_cobro).toBe("solo_mano_obra");
    expect(savedQuote?.solo_mano_obra_submodo).toBe("por_horas");
    expect(savedQuote?.horas_estimadas_thousandths).toBe(4000);
    expect(savedQuote?.tarifa_hora_cents).toBe(4500);
    expect(savedQuote?.mano_obra_fija_cents).toBe(0);
    expect(savedQuote?.subtotal_cents).toBe(18000);
    expect(savedQuote?.vat_cents).toBe(3780);
    expect(savedQuote?.total_cents).toBe(21780);

    const updatedJob = await jobsRepo.getById(job.id);
    expect(updatedJob?.horas_estimadas_thousandths).toBe(4000);
    expect(updatedJob?.tarifa_hora_cents).toBe(4500);

    const savedItems = await quotesRepo.getItems(savedQuote!.id);
    expect(savedItems).toHaveLength(1);
    expect(savedItems[0]?.description).toBe("Reparación fuga bajo fregadero");
    expect(savedItems[0]?.unit_price_cents).toBe(0);
    expect(savedItems[0]?.line_subtotal_cents).toBe(0);

    expect(pdfPort.lastInput?.kind).toBe("quote");
    if (pdfPort.lastInput?.kind === "quote") {
      expect(pdfPort.lastInput.billingMode).toBe("solo_mano_obra");
      expect(pdfPort.lastInput.laborSubMode).toBe("por_horas");
      expect(pdfPort.lastInput.laborHoursThousandths).toBe(4000);
      expect(pdfPort.lastInput.hourlyRateCents).toBe(4500);
      expect(pdfPort.lastInput.laborCents).toBe(18000);
      expect(pdfPort.lastInput.itemsSubtotalCents).toBe(0);
      expect(pdfPort.lastInput.lines[0]?.description).toBe("Reparación fuga bajo fregadero");
    }
  });

  it("sobrevive a backup export/import roundtrip e importa backups legacy sin los 5 campos nuevos", async () => {
    const job = await jobsRepo.createDirectJob({
      title: "Instalación termosifón",
      modalidad_cobro: "partidas_mas_fijo_mano_obra",
      solo_mano_obra_submodo: "precio_cerrado",
      horas_estimadas_thousandths: 0,
      tarifa_hora_cents: 4000,
      mano_obra_fija_cents: 22000,
    });

    const thr = await runner.createThread({ title: "Backup billing" });
    const startTurn = await runner.runTurn(thr.thread_id, {
      client_turn_id: "t_bkp_1",
      text: "",
      action_type: "start_job_quote",
      target_ids: { job_id: job.id },
    });
    if (startTurn.active_interrupt?.gate_id !== "gate_1_quote") {
      throw new Error("Expected gate_1_quote");
    }
    const edited = Gate1QuoteCommitPayloadSchema.parse({
      ...startTurn.active_interrupt.proposed_payload,
      lines: [
        {
          catalog_item_id: null,
          description: "Material tubería cobre",
          category: "Fontanería",
          unit: "ud",
          quantity_thousandths: 1000,
          unit_price_cents: 8000,
          original_unit_price_cents: 8000,
          save_to_catalog: false,
        },
      ],
    });
    const committed = await runner.resumeGate(thr.thread_id, {
      gate_id: "gate_1_quote",
      action: "edit",
      edited_payload: edited,
      client_validated_at_ms: Date.now(),
    });
    const quoteId = committed.active_quote_id!;

    const backupService = new BackupService(executor);
    const exported = await backupService.exportBackupJson();
    expect(exported.encrypted).toBe(false);

    // Roundtrip completo
    await new ResetService(executor).startFromScratch();
    await backupService.importBackupJson(exported);
    const restoredJob = await jobsRepo.getById(job.id);
    const restoredQuote = await quotesRepo.getById(quoteId);
    expect(restoredJob?.modalidad_cobro).toBe("partidas_mas_fijo_mano_obra");
    expect(restoredJob?.mano_obra_fija_cents).toBe(22000);
    expect(restoredQuote?.modalidad_cobro).toBe("partidas_mas_fijo_mano_obra");
    expect(restoredQuote?.mano_obra_fija_cents).toBe(22000);
    expect(restoredQuote?.subtotal_cents).toBe(30000);

    // Simular backup JSON legacy sin los 5 campos nuevos en jobs y quotes
    if (exported.encrypted) {
      throw new Error("Expected unencrypted backup");
    }
    const legacyJson = JSON.stringify({
      ...exported,
      payload: {
        ...exported.payload,
        jobs: exported.payload.jobs.map((j) => {
          const {
            modalidad_cobro: _m,
            solo_mano_obra_submodo: _s,
            horas_estimadas_thousandths: _h,
            tarifa_hora_cents: _t,
            mano_obra_fija_cents: _f,
            ...legacyJob
          } = j;
          return legacyJob;
        }),
        quotes: exported.payload.quotes.map((q) => {
          const {
            modalidad_cobro: _m,
            solo_mano_obra_submodo: _s,
            horas_estimadas_thousandths: _h,
            tarifa_hora_cents: _t,
            mano_obra_fija_cents: _f,
            ...legacyQuote
          } = q;
          return legacyQuote;
        }),
      },
    });

    await new ResetService(executor).startFromScratch();
    await backupService.importBackupJson(legacyJson);
    const legacyRestoredJob = await jobsRepo.getById(job.id);
    const legacyRestoredQuote = await quotesRepo.getById(quoteId);
    expect(legacyRestoredJob?.modalidad_cobro).toBe("solo_partidas");
    expect(legacyRestoredJob?.mano_obra_fija_cents).toBe(0);
    expect(legacyRestoredQuote?.modalidad_cobro).toBe("solo_partidas");
    expect(legacyRestoredQuote?.tarifa_hora_cents).toBeNull();
  });

  it("permite facturar en lifecycleBillingSpecialist un presupuesto solo_mano_obra con unit_price_cents=0 o sin líneas si subtotal_cents > 0", async () => {
    const client = await clientsRepo.create({
      name: "Carlos Ruiz",
      nif: "12345678Z",
      fiscal_address: "Av. Diagonal 100, Barcelona",
      phone: "+34622334455",
      email: "",
      notes: "",
    });

    // Caso A: solo_mano_obra precio_cerrado SIN líneas de detalle (lines = [])
    const jobNoLines = await jobsRepo.createDirectJob({
      title: "Mano de obra cerrada sin líneas",
      client_id: client.id,
      modalidad_cobro: "solo_mano_obra",
      solo_mano_obra_submodo: "precio_cerrado",
      mano_obra_fija_cents: 25000,
    });
    const thrA = await runner.createThread({ title: "Facturar solo MO sin líneas" });
    const startA = await runner.runTurn(thrA.thread_id, {
      client_turn_id: "t_inv_mo_1",
      text: "",
      action_type: "start_job_quote",
      target_ids: { job_id: jobNoLines.id },
    });
    if (startA.active_interrupt?.gate_id !== "gate_1_quote") {
      throw new Error("Expected gate_1_quote");
    }
    const editedA = Gate1QuoteCommitPayloadSchema.parse({
      ...startA.active_interrupt.proposed_payload,
      vat_rate: 21,
      lines: [],
    });
    const savedA = await runner.resumeGate(thrA.thread_id, {
      gate_id: "gate_1_quote",
      action: "edit",
      edited_payload: editedA,
      client_validated_at_ms: Date.now(),
    });
    const quoteIdA = savedA.active_quote_id!;
    await quotesRepo.acceptOrReject(quoteIdA, "aceptado");

    const invTurnA = await runner.runTurn(thrA.thread_id, {
      client_turn_id: "t_inv_mo_2",
      text: "",
      action_type: "request_invoice_gate",
      target_ids: { job_id: jobNoLines.id, quote_id: quoteIdA },
      billing_sub_intent: "final_invoice",
    });
    expect(invTurnA.checkpoint_status).toBe("interrupted");
    expect(invTurnA.active_interrupt?.gate_id).toBe("gate_3_invoice");

    const invResA = await runner.resumeGate(thrA.thread_id, {
      gate_id: "gate_3_invoice",
      action: "approve",
      client_validated_at_ms: Date.now(),
    });
    expect(invResA.checkpoint_status).toBe("idle");
    const invsA = await invoicesRepo.listByJobId(jobNoLines.id);
    expect(invsA).toHaveLength(1);
    expect(invsA[0]?.base_cents).toBe(25000);
    expect(invsA[0]?.vat_cents).toBe(5250);
    expect(invsA[0]?.total_cents).toBe(30250);

    // Caso B: solo_mano_obra con línea de tarea a 0 €
    const jobZeroLine = await jobsRepo.createDirectJob({
      title: "Mano de obra con tarea a 0",
      client_id: client.id,
      modalidad_cobro: "solo_mano_obra",
      solo_mano_obra_submodo: "por_horas",
      horas_estimadas_thousandths: 2000,
      tarifa_hora_cents: 5000,
    });
    const thrB = await runner.createThread({ title: "Facturar solo MO tarea 0" });
    const startB = await runner.runTurn(thrB.thread_id, {
      client_turn_id: "t_inv_mo_3",
      text: "",
      action_type: "start_job_quote",
      target_ids: { job_id: jobZeroLine.id },
    });
    if (startB.active_interrupt?.gate_id !== "gate_1_quote") {
      throw new Error("Expected gate_1_quote");
    }
    const editedB = Gate1QuoteCommitPayloadSchema.parse({
      ...startB.active_interrupt.proposed_payload,
      vat_rate: 10,
      lines: [
        {
          catalog_item_id: null,
          description: "Sustitución de mecanismo",
          category: "Electricidad",
          unit: "ud",
          quantity_thousandths: 1000,
          unit_price_cents: 0,
          original_unit_price_cents: 0,
          save_to_catalog: false,
        },
      ],
    });
    const savedB = await runner.resumeGate(thrB.thread_id, {
      gate_id: "gate_1_quote",
      action: "edit",
      edited_payload: editedB,
      client_validated_at_ms: Date.now(),
    });
    const quoteIdB = savedB.active_quote_id!;
    await quotesRepo.acceptOrReject(quoteIdB, "aceptado");

    const invTurnB = await runner.runTurn(thrB.thread_id, {
      client_turn_id: "t_inv_mo_4",
      text: "",
      action_type: "request_invoice_gate",
      target_ids: { job_id: jobZeroLine.id, quote_id: quoteIdB },
      billing_sub_intent: "final_invoice",
    });
    expect(invTurnB.checkpoint_status).toBe("interrupted");
    expect(invTurnB.active_interrupt?.gate_id).toBe("gate_3_invoice");

    await runner.resumeGate(thrB.thread_id, {
      gate_id: "gate_3_invoice",
      action: "approve",
      client_validated_at_ms: Date.now(),
    });
    const invsB = await invoicesRepo.listByJobId(jobZeroLine.id);
    expect(invsB).toHaveLength(1);
    expect(invsB[0]?.base_cents).toBe(10000);
    expect(invsB[0]?.vat_cents).toBe(1000);
  });
});
