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
import {
  computePaymentScheduleAmounts,
  computeQuoteValidUntilIso,
  deriveInvoiceAdvancePercent,
  formatPercentEs,
  resolveQuoteAdvancePolicy,
} from "../src/core/fiscal/fiscalEngine";
import { formatLocalDateIso } from "../src/core/fiscal/dateQuarter";
import { MemoryCoordinatorNoop } from "../src/core/memory/memoryCoordinator";
import { MockFreezerPort, MockOcrPort, MockPdfPort } from "./mocks/ports";

describe("Presupuestos simplificados sin cliente, validez y fraccionamiento (1-4 pagos)", () => {
  let executor: NodeBetterSqliteExecutor;
  let fileBridge: MemoryFileBridge;
  let pdfPort: MockPdfPort;
  let quotesRepo: QuotesRepository;
  let invoicesRepo: InvoicesRepository;
  let clientsRepo: ClientsRepository;
  let jobsRepo: JobsRepository;
  let settingsRepo: SettingsRepository;
  let runner: GraphRunner;

  beforeEach(async () => {
    executor = new NodeBetterSqliteExecutor(":memory:");
    await initializeSchema(executor);
    fileBridge = new MemoryFileBridge();
    pdfPort = new MockPdfPort();
    quotesRepo = new QuotesRepository(executor);
    invoicesRepo = new InvoicesRepository(executor);
    clientsRepo = new ClientsRepository(executor);
    jobsRepo = new JobsRepository(executor);
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

  it("migra tabla legacy quotes con client_id NOT NULL y preserva triggers y FKs", async () => {
    const legacyDb = new NodeBetterSqliteExecutor(":memory:");
    try {
      await initializeSchema(legacyDb);
      await new ResetService(legacyDb).restoreDemoData(new MockFreezerPort());

      // Simular tabla legacy v1.4.0 (client_id NOT NULL + client_name_snapshot CHECK)
      await legacyDb.run("PRAGMA foreign_keys = OFF;");
      await legacyDb.inTransaction(async (tx) => {
        await tx.run(
          `CREATE TABLE quotes_v14 (
            id TEXT PRIMARY KEY,
            quote_code TEXT NOT NULL UNIQUE,
            job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
            client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
            client_name_snapshot TEXT NOT NULL CHECK (length(trim(client_name_snapshot)) > 0),
            client_nif_snapshot TEXT NOT NULL DEFAULT '',
            client_address_snapshot TEXT NOT NULL DEFAULT '',
            client_phone_snapshot TEXT NOT NULL DEFAULT '',
            vat_rate REAL NOT NULL CHECK (vat_rate >= 0 AND vat_rate <= 100),
            subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
            vat_cents INTEGER NOT NULL CHECK (vat_cents >= 0),
            total_cents INTEGER NOT NULL CHECK (total_cents >= 0 AND total_cents = subtotal_cents + vat_cents),
            status TEXT NOT NULL DEFAULT 'borrador' CHECK (status IN ('borrador', 'enviado', 'aceptado', 'rechazado')),
            notes TEXT NOT NULL DEFAULT '',
            pdf_uri TEXT,
            sent_at_iso TEXT,
            created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
            updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
          );`
        );
        await tx.run(
          `INSERT INTO quotes_v14
           SELECT id, quote_code, job_id, client_id, client_name_snapshot, client_nif_snapshot,
                  client_address_snapshot, client_phone_snapshot, vat_rate, subtotal_cents,
                  vat_cents, total_cents, status, notes, pdf_uri, sent_at_iso, created_at_ms, updated_at_ms
           FROM quotes;`
        );
        await tx.run(`DROP TABLE quotes;`);
        await tx.run(`ALTER TABLE quotes_v14 RENAME TO quotes;`);
        await tx.run(
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_quotes_one_active_per_job ON quotes(job_id) WHERE status != 'rechazado';`
        );
      });
      await legacyDb.run("PRAGMA foreign_keys = ON;");

      const preQuotes = await legacyDb.query<{ id: string }>(`SELECT id FROM quotes`);
      const preItems = await legacyDb.query<{ id: string }>(`SELECT id FROM quote_items`);
      const preInvoices = await legacyDb.query<{ id: string }>(`SELECT id FROM invoices`);
      expect(preQuotes.length).toBeGreaterThan(0);

      // Ejecutar initializeSchema sobre la BD legacy
      await initializeSchema(legacyDb);

      const cols = await legacyDb.query<{ name: string; notnull: number }>(`PRAGMA table_info(quotes)`);
      const clientIdCol = cols.find((c) => c.name === "client_id");
      expect(clientIdCol?.notnull).toBe(0);
      expect(cols.some((c) => c.name === "validity_days")).toBe(true);
      expect(cols.some((c) => c.name === "payment_methods_json")).toBe(true);
      expect(cols.some((c) => c.name === "payment_schedule_json")).toBe(true);

      const fkViolations = await legacyDb.query(`PRAGMA foreign_key_check;`);
      expect(fkViolations).toEqual([]);

      const postQuotes = await legacyDb.query<{ id: string; validity_days: number | null }>(
        `SELECT id, validity_days FROM quotes`
      );
      const postItems = await legacyDb.query<{ id: string }>(`SELECT id FROM quote_items`);
      const postInvoices = await legacyDb.query<{ id: string }>(`SELECT id FROM invoices`);
      expect(postQuotes).toHaveLength(preQuotes.length);
      expect(postItems).toHaveLength(preItems.length);
      expect(postInvoices).toHaveLength(preInvoices.length);
      // Presupuestos legacy conservan validity_days = NULL sin caducidad inventada
      expect(postQuotes.every((q) => q.validity_days === null)).toBe(true);

      const triggers = await legacyDb.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'trigger'`
      );
      expect(triggers).toHaveLength(9);
    } finally {
      await legacyDb.close();
    }
  });

  it("calcula fraccionamientos (1-4 pagos) con redondeo acumulado exacto sin negativos", () => {
    // 2 céntimos divididos en 4 pagos del 25 % -> suma exacta === 2 y todos >= 0
    const tiny = computePaymentScheduleAmounts(2, [
      { label: "P1", percentage: 25 },
      { label: "P2", percentage: 25 },
      { label: "P3", percentage: 25 },
      { label: "P4", percentage: 25 },
    ]);
    expect(tiny.reduce((s, r) => s + r.amount_cents, 0)).toBe(2);
    expect(tiny.every((r) => r.amount_cents >= 0)).toBe(true);

    // 100,01 € (10001 cts) en 33.33 / 33.33 / 33.34
    const thirds = computePaymentScheduleAmounts(10_001, [
      { label: "Inicio", percentage: 33.33 },
      { label: "Mitad", percentage: 33.33 },
      { label: "Fin", percentage: 33.34 },
    ]);
    expect(thirds.reduce((s, r) => s + r.amount_cents, 0)).toBe(10_001);
    expect(formatPercentEs(33.33)).toBe("33,33 %");

    // Políticas Opción B
    expect(resolveQuoteAdvancePolicy([])).toMatchObject({ allowAdvance: true, advancePercent: 40 });
    expect(resolveQuoteAdvancePolicy([{ label: "Único", percentage: 100 }])).toMatchObject({
      allowAdvance: false,
      advancePercent: 100,
      mode: "single_payment",
    });
    expect(
      resolveQuoteAdvancePolicy([
        { label: "Adelanto", percentage: 30 },
        { label: "Mitad", percentage: 40 },
        { label: "Final", percentage: 30 },
      ])
    ).toMatchObject({
      allowAdvance: true,
      advancePercent: 30,
      mode: "first_installment",
    });
  });

  it("crea presupuestos sin cliente ni título obligatorio con validez y fraccionamiento, sobrevive backup y bloquea Gate 3 hasta asignar cliente", async () => {
    await settingsRepo.updateQuoteDefaults({
      default_quote_validity_days: 45,
      default_payment_methods: ["transferencia", "bizum"],
      default_payment_schedule: [
        { label: "Antes de empezar", percentage: 30 },
        { label: "A mitad de obra", percentage: 40 },
        { label: "Al finalizar", percentage: 30 },
      ],
    });

    const thr = await runner.createThread({ title: "Sin cliente" });
    const turn = await runner.runTurn(thr.thread_id, {
      client_turn_id: "t_no_client_1",
      text: "Presupuesto: 2 puntos de luz a 45 euros",
      action_type: "free_text_or_voice",
    });
    expect(turn.checkpoint_status).toBe("interrupted");
    expect(turn.active_interrupt?.gate_id).toBe("gate_1_quote");

    if (turn.active_interrupt?.gate_id !== "gate_1_quote") {
      throw new Error("Expected gate_1_quote interrupt");
    }
    const draft = turn.active_interrupt.proposed_payload;
    expect(draft.validity_days).toBe(45);
    expect(draft.payment_methods).toEqual(["transferencia", "bizum"]);
    expect(draft.payment_schedule).toHaveLength(3);

    const edited = Gate1QuoteCommitPayloadSchema.parse({
      ...draft,
      client_id: null,
      new_client: undefined,
      job_title: "",
    });
    const saved = await runner.resumeGate(thr.thread_id, {
      gate_id: "gate_1_quote",
      action: "edit",
      edited_payload: edited,
      client_validated_at_ms: Date.now(),
    });
    expect(saved.checkpoint_status).toBe("idle");
    const quoteId = saved.active_quote_id!;
    const jobId = saved.active_job_id!;
    expect(quoteId).toBeTruthy();

    const quote = await quotesRepo.getById(quoteId);
    const job = await jobsRepo.getById(jobId);
    expect(quote?.client_id).toBeNull();
    expect(quote?.client_name_snapshot).toBe("");
    expect(quote?.validity_days).toBe(45);
    expect(job?.client_id).toBeNull();
    expect(job?.title.length).toBeGreaterThan(0);

    const validUntil = computeQuoteValidUntilIso(quote!.created_at_ms, quote!.validity_days);
    expect(validUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Regenerar PDF sin cliente no debe fallar
    const regeneratedUri = await quotesRepo.regeneratePdfOnDemand(quoteId, pdfPort, fileBridge);
    expect(regeneratedUri).toBeTruthy();

    // Backup round-trip conserva el presupuesto sin cliente + defaults de presupuesto
    const backupService = new BackupService(executor);
    const exported = await backupService.exportBackupJson();
    await new ResetService(executor).startFromScratch();
    await backupService.importBackupJson(exported);
    const restoredQuote = await quotesRepo.getById(quoteId);
    const restoredSettings = await settingsRepo.getAppSettings();
    expect(restoredQuote?.client_id).toBeNull();
    expect(restoredQuote?.validity_days).toBe(45);
    expect(restoredSettings.default_quote_validity_days).toBe(45);
    expect(restoredSettings.default_payment_methods).toEqual(["transferencia", "bizum"]);

    // Gate 3 sin cliente asignado bloquea con aviso y vuelve a overview (sin crear factura)
    const billThr = await runner.createThread({ title: "Intentar facturar sin cliente" });
    const blockedTurn = await runner.runTurn(billThr.thread_id, {
      client_turn_id: "t_bill_blocked",
      text: "",
      action_type: "request_advance_gate",
      target_ids: { job_id: jobId, quote_id: quoteId },
      billing_sub_intent: "advance_40",
    });
    expect(blockedTurn.checkpoint_status).toBe("idle");
    expect(blockedTurn.assistant_message?.content).toContain("no tiene cliente asignado");

    // Asignar cliente nuevo y comprobar propagación a quote, job, PDF y factura anticipo del 30 %
    const newClient = await clientsRepo.create({
      name: "Comunidad Calle Sol 8",
      nif: "12345678Z",
      fiscal_address: "C/ del Sol 8, Madrid",
      phone: "+34611223344",
      email: "",
      notes: "",
    });
    const assignedQuote = await quotesRepo.assignClient(quoteId, newClient.id, {
      pdfPort,
      fileBridge,
    });
    expect(assignedQuote.client_id).toBe(newClient.id);
    expect(assignedQuote.client_name_snapshot).toBe("Comunidad Calle Sol 8");
    const updatedJob = await jobsRepo.getById(jobId);
    expect(updatedJob?.client_id).toBe(newClient.id);

    // Emitir anticipo Opción B -> 30 % del primer pago
    const advTurn = await runner.runTurn(billThr.thread_id, {
      client_turn_id: "t_bill_adv30",
      text: "",
      action_type: "request_advance_gate",
      target_ids: { job_id: jobId, quote_id: quoteId },
      billing_sub_intent: "advance_40",
    });
    expect(advTurn.checkpoint_status).toBe("interrupted");
    expect(advTurn.assistant_message?.content).toContain("30 %");
    const advDone = await runner.resumeGate(billThr.thread_id, {
      gate_id: "gate_3_invoice",
      action: "approve",
      client_validated_at_ms: Date.now(),
    });
    expect(advDone.checkpoint_status).toBe("idle");

    const invsAfterAdv = await invoicesRepo.listByJobId(jobId);
    const antInv = invsAfterAdv.find((i) => i.series_type === "ANT")!;
    expect(antInv).toBeTruthy();
    // 2 * 4500 = 9000 cts base; 30 % = 2700 cts base
    expect(antInv.base_cents).toBe(2700);
    expect(deriveInvoiceAdvancePercent(antInv, assignedQuote)).toBe(30);

    // Emitir factura final -> deduce 2700 cts exactos, facturando el 70 % restante (6300 cts)
    const finTurn = await runner.runTurn(billThr.thread_id, {
      client_turn_id: "t_bill_fin70",
      text: "",
      action_type: "request_invoice_gate",
      target_ids: { job_id: jobId, quote_id: quoteId },
      billing_sub_intent: "final_invoice",
    });
    expect(finTurn.checkpoint_status).toBe("interrupted");
    await runner.resumeGate(billThr.thread_id, {
      gate_id: "gate_3_invoice",
      action: "approve",
      client_validated_at_ms: Date.now(),
    });
    const invsAfterFin = await invoicesRepo.listByJobId(jobId);
    const facInv = invsAfterFin.find((i) => i.series_type === "FAC")!;
    expect(facInv.kind).toBe("final");
    expect(facInv.advance_deducted_base_cents).toBe(2700);
    expect(facInv.base_cents).toBe(6300);
  });

  it("en presupuesto de pago único (100 %), redirige cualquier solicitud de anticipo directo a factura completa", async () => {
    const client = await clientsRepo.create({
      name: "Cliente Pago Único",
      nif: "12345678Z",
      fiscal_address: "Av. Libertad 10, Valencia",
      phone: "",
      email: "",
      notes: "",
    });
    await settingsRepo.updateQuoteDefaults({
      default_quote_validity_days: 15,
      default_payment_methods: ["efectivo"],
      default_payment_schedule: [{ label: "Pago único al finalizar", percentage: 100 }],
    });

    const thr = await runner.createThread({ title: "Pago único" });
    const draftTurn = await runner.runTurn(thr.thread_id, {
      client_turn_id: "t_1pay_1",
      text: "",
      action_type: "start_empty_quote",
      target_ids: { client_id: client.id },
    });
    expect(draftTurn.checkpoint_status).toBe("interrupted");
    if (draftTurn.active_interrupt?.gate_id !== "gate_1_quote") {
      throw new Error("Expected gate_1_quote");
    }

    const res = await runner.resumeGate(thr.thread_id, {
      gate_id: "gate_1_quote",
      action: "edit",
      edited_payload: Gate1QuoteCommitPayloadSchema.parse({
        ...draftTurn.active_interrupt.proposed_payload,
        job_title: "Pintura dormitorio",
        lines: [
          {
            catalog_item_id: null,
            description: "Pintura plástica 2 manos",
            category: "Pintura",
            unit: "m2",
            quantity_thousandths: 10_000,
            unit_price_cents: 1000,
            original_unit_price_cents: 1000,
            save_to_catalog: false,
          },
        ],
      }),
      client_validated_at_ms: Date.now(),
    });
    const quoteId = res.active_quote_id!;
    const jobId = res.active_job_id!;

    // Solicitar anticipo redirige a final_invoice ('full')
    const advRequest = await runner.runTurn(thr.thread_id, {
      client_turn_id: "t_1pay_2",
      text: "",
      action_type: "request_advance_gate",
      target_ids: { job_id: jobId, quote_id: quoteId },
      billing_sub_intent: "advance_40",
    });
    expect(advRequest.checkpoint_status).toBe("interrupted");
    if (advRequest.active_interrupt?.gate_id === "gate_3_invoice") {
      expect(advRequest.active_interrupt.proposed_payload.sub_intent).toBe("final_invoice");
    }

    await runner.resumeGate(thr.thread_id, {
      gate_id: "gate_3_invoice",
      action: "approve",
      client_validated_at_ms: Date.now(),
    });
    const invs = await invoicesRepo.listByJobId(jobId);
    expect(invs).toHaveLength(1);
    expect(invs[0]?.kind).toBe("full");
    expect(invs[0]?.series_type).toBe("FAC");
    expect(invs[0]?.base_cents).toBe(10_000);
    // Comprobar helper fecha local sin warnings
    expect(formatLocalDateIso(Date.now())).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
