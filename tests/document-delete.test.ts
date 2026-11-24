import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GraphRunner } from "../src/agent/graphRunner";
import { LocalInferenceAdapterImpl } from "../src/agent/inference/localInferenceAdapter";
import { ResetService } from "../src/core/backup/resetService";
import type { Gate1QuoteCommitPayload } from "../src/core/contracts/types";
import { NodeBetterSqliteExecutor } from "../src/core/db/nodeSqliteExecutor";
import { InvoicesRepository } from "../src/core/db/repositories/invoicesRepo";
import { JobsRepository } from "../src/core/db/repositories/jobsRepo";
import { QuotesRepository } from "../src/core/db/repositories/quotesRepo";
import { SiteLogsRepository } from "../src/core/db/repositories/siteLogsRepo";
import { TracesRepository } from "../src/core/db/repositories/tracesRepo";
import { initializeSchema } from "../src/core/db/sqliteExecutor";
import { MemoryFileBridge } from "../src/core/files/memoryFileBridge";
import { computePiggyBank } from "../src/core/fiscal/fiscalEngine";
import { MemoryCoordinatorNoop } from "../src/core/memory/memoryCoordinator";
import { MockFreezerPort, MockOcrPort, MockPdfPort } from "./mocks/ports";

describe("Borrado Seguro de Documentos Generados (Presupuestos, Facturas y Diario)", () => {
  let executor: NodeBetterSqliteExecutor;
  let fileBridge: MemoryFileBridge;
  let mockPdf: MockPdfPort;
  let runner: GraphRunner;

  beforeEach(async () => {
    executor = new NodeBetterSqliteExecutor(":memory:");
    await initializeSchema(executor);
    fileBridge = new MemoryFileBridge();
    mockPdf = new MockPdfPort();

    const reset = new ResetService(executor);
    await reset.restoreDemoData(new MockFreezerPort());

    runner = new GraphRunner(
      {
        executor,
        fileBridge,
        memoryCoordinator: new MemoryCoordinatorNoop(),
        inference: new LocalInferenceAdapterImpl(),
        ocrPort: new MockOcrPort(),
        pdfPort: mockPdf,
        traceRecorder: new TracesRepository(executor),
      },
      "memory"
    );
  });

  afterEach(async () => {
    await executor.close();
  });

  async function createQuoteViaGate1(clientId: string, jobTitle: string) {
    const thr = await runner.createThread({ title: `Presupuesto ${jobTitle}` });
    const turn = await runner.runTurn(thr.thread_id, {
      client_turn_id: `t_${crypto.randomUUID().slice(0, 8)}`,
      text: "Presupuesto para Elena García: 1 termo eléctrico 80L, IVA 10% vivienda.",
      action_type: "free_text_or_voice",
    });
    if (turn.active_interrupt?.gate_id !== "gate_1_quote") {
      throw new Error("Expected gate_1_quote interrupt");
    }
    const payload: Gate1QuoteCommitPayload = {
      ...turn.active_interrupt.proposed_payload,
      client_id: clientId,
      job_title: jobTitle,
      lines: turn.active_interrupt.proposed_payload.lines.map((l) => ({
        ...l,
        save_to_catalog: false,
      })),
    };
    const res = await runner.resumeGate(thr.thread_id, {
      gate_id: "gate_1_quote",
      action: "edit",
      edited_payload: payload,
      client_validated_at_ms: Date.now(),
    });
    if (!res.active_quote_id || !res.active_job_id) {
      throw new Error("Expected active_quote_id and active_job_id");
    }
    return { threadId: thr.thread_id, quoteId: res.active_quote_id, jobId: res.active_job_id };
  }

  it("borra presupuesto sin facturas, limpia PDF, cascada quote_items, referencias y solo retrocede secuencia si es el último", async () => {
    const quotesRepo = new QuotesRepository(executor);

    // Demo data tiene PRE-2026-001..004 -> last_seq = 4
    const q5 = await createQuoteViaGate1("cli_elena_garcia", "Obra Cinco");
    const q6 = await createQuoteViaGate1("cli_elena_garcia", "Obra Seis");

    const q5Row = await quotesRepo.getById(q5.quoteId);
    const q6Row = await quotesRepo.getById(q6.quoteId);
    expect(q5Row?.quote_code).toBe("PRE-2026-005");
    expect(q6Row?.quote_code).toBe("PRE-2026-006");
    expect(q5Row?.pdf_uri && fileBridge.has(q5Row.pdf_uri)).toBe(true);
    expect(q6Row?.pdf_uri && fileBridge.has(q6Row.pdf_uri)).toBe(true);

    // Vincular un recovered_draft a q5 para comprobar limpieza de active_quote_id
    await executor.run(
      `INSERT INTO recovered_drafts (
        id, thread_id, original_schema_version, pending_gate, widget_json,
        active_job_id, active_quote_id, dismissed, recovered_at_ms
      ) VALUES ('rd_1', 'thr_rd_1', '1.0.0', 'gate_1_quote', '{}', ?, ?, 0, ?)`,
      [q5.jobId, q5.quoteId, Date.now()]
    );

    // 1. Borrar presupuesto intermedio (005 existiendo 006) -> NO retrocede sequences
    await quotesRepo.delete(q5.quoteId, fileBridge);

    expect(await quotesRepo.getById(q5.quoteId)).toBeNull();
    const q5Items = await quotesRepo.getItems(q5.quoteId);
    expect(q5Items.length).toBe(0);
    expect(q5Row?.pdf_uri && fileBridge.has(q5Row.pdf_uri)).toBe(false);

    const threadAfter = await executor.query<{ active_quote_id: string | null }>(
      `SELECT active_quote_id FROM chat_threads WHERE thread_id = ?`,
      [q5.threadId]
    );
    expect(threadAfter[0]?.active_quote_id).toBeNull();

    const draftAfter = await executor.query<{ active_quote_id: string | null }>(
      `SELECT active_quote_id FROM recovered_drafts WHERE id = 'rd_1'`
    );
    expect(draftAfter[0]?.active_quote_id).toBeNull();

    const seqAfterIntermediate = await executor.query<{ last_seq: number }>(
      `SELECT last_seq FROM sequences WHERE series_type = 'PRE' AND fiscal_year = 2026`
    );
    expect(seqAfterIntermediate[0]?.last_seq).toBe(6);

    // 2. Borrar el último presupuesto (006) -> SÍ retrocede sequences al máximo restante (4)
    await quotesRepo.delete(q6.quoteId, fileBridge);
    expect(await quotesRepo.getById(q6.quoteId)).toBeNull();
    expect(q6Row?.pdf_uri && fileBridge.has(q6Row.pdf_uri)).toBe(false);

    const seqAfterLatest = await executor.query<{ last_seq: number }>(
      `SELECT last_seq FROM sequences WHERE series_type = 'PRE' AND fiscal_year = 2026`
    );
    expect(seqAfterLatest[0]?.last_seq).toBe(4);
  });

  it("bloquea borrado de presupuesto con facturas y de anticipo descontado en factura final; permite borrar en orden FAC -> ANT -> PRE y recalcula Hucha Fiscal", async () => {
    const quotesRepo = new QuotesRepository(executor);
    const invoicesRepo = new InvoicesRepository(executor);
    const jobsRepo = new JobsRepository(executor);

    // Crear presupuesto PRE-2026-005
    const { threadId, quoteId, jobId } = await createQuoteViaGate1(
      "cli_elena_garcia",
      "Instalación caldera"
    );
    const quoteBefore = await quotesRepo.getById(quoteId);
    expect(quoteBefore?.quote_code).toBe("PRE-2026-005");

    // Emitir factura de anticipo 40% (ANT)
    const advGate = await runner.runTurn(threadId, {
      client_turn_id: "t_del_adv",
      text: "",
      action_type: "request_advance_gate",
      target_ids: { job_id: jobId, quote_id: quoteId },
      billing_sub_intent: "advance_40",
    });
    expect(advGate.active_interrupt?.gate_id).toBe("gate_3_invoice");
    await runner.resumeGate(threadId, {
      gate_id: "gate_3_invoice",
      action: "approve",
      client_validated_at_ms: Date.now(),
    });

    // Emitir factura final (FAC) vinculada al anticipo
    const facGate = await runner.runTurn(threadId, {
      client_turn_id: "t_del_fac",
      text: "",
      action_type: "request_invoice_gate",
      target_ids: { job_id: jobId, quote_id: quoteId },
      billing_sub_intent: "final_invoice",
    });
    expect(facGate.active_interrupt?.gate_id).toBe("gate_3_invoice");
    await runner.resumeGate(threadId, {
      gate_id: "gate_3_invoice",
      action: "approve",
      client_validated_at_ms: Date.now(),
    });

    const jobInvoices = await invoicesRepo.listByJobId(jobId);
    const antInv = jobInvoices.find((i) => i.series_type === "ANT");
    const facInv = jobInvoices.find((i) => i.series_type === "FAC");
    expect(antInv).toBeTruthy();
    expect(facInv).toBeTruthy();
    expect(facInv?.advance_invoice_id).toBe(antInv!.id);
    expect(antInv?.pdf_uri && fileBridge.has(antInv.pdf_uri)).toBe(true);
    expect(facInv?.pdf_uri && fileBridge.has(facInv.pdf_uri)).toBe(true);

    const quarter = facInv!.quarter;
    const allJobsBeforeDelete = await jobsRepo.listAll();
    const piggyWithNewInvoices = computePiggyBank({
      quarter,
      invoices: await invoicesRepo.listAll(),
      tickets: [],
      jobs: allJobsBeforeDelete,
    });
    const piggyExpectedAfterDelete = computePiggyBank({
      quarter,
      invoices: (await invoicesRepo.listAll()).filter(
        (i) => i.id !== antInv!.id && i.id !== facInv!.id
      ),
      tickets: [],
      jobs: allJobsBeforeDelete,
    });
    expect(piggyWithNewInvoices.pendiente_cobro_trimestre_cents).toBeGreaterThan(
      piggyExpectedAfterDelete.pendiente_cobro_trimestre_cents
    );

    const fiscalYear = facInv!.fiscal_year;
    const seqAntBefore = await executor.query<{ last_seq: number }>(
      `SELECT last_seq FROM sequences WHERE series_type = 'ANT' AND fiscal_year = ?`,
      [fiscalYear]
    );
    const seqFacBefore = await executor.query<{ last_seq: number }>(
      `SELECT last_seq FROM sequences WHERE series_type = 'FAC' AND fiscal_year = ?`,
      [fiscalYear]
    );
    const antSeqNum = seqAntBefore[0]!.last_seq;
    const facSeqNum = seqFacBefore[0]!.last_seq;

    // 1. Bloquea borrar presupuesto con facturas vinculadas
    await expect(quotesRepo.delete(quoteId, fileBridge)).rejects.toThrow(
      /INVALID_STATE_TRANSITION/
    );
    expect(await quotesRepo.getById(quoteId)).not.toBeNull();
    expect((await quotesRepo.getItems(quoteId)).length).toBeGreaterThan(0);
    expect(quoteBefore?.pdf_uri && fileBridge.has(quoteBefore.pdf_uri)).toBe(true);

    // 2. Bloquea borrar anticipo ANT referenciado por factura final FAC
    await expect(invoicesRepo.delete(antInv!.id, fileBridge)).rejects.toThrow(
      /INVALID_STATE_TRANSITION/
    );
    expect(await invoicesRepo.getById(antInv!.id)).not.toBeNull();
    expect(antInv?.pdf_uri && fileBridge.has(antInv.pdf_uri)).toBe(true);

    // 3. Borrar FAC -> ANT -> PRE en orden correcto
    await invoicesRepo.delete(facInv!.id, fileBridge);
    expect(await invoicesRepo.getById(facInv!.id)).toBeNull();
    expect(facInv?.pdf_uri && fileBridge.has(facInv.pdf_uri)).toBe(false);

    const seqFacAfter = await executor.query<{ last_seq: number }>(
      `SELECT last_seq FROM sequences WHERE series_type = 'FAC' AND fiscal_year = ?`,
      [fiscalYear]
    );
    expect(seqFacAfter[0]?.last_seq).toBe(facSeqNum - 1);

    await invoicesRepo.delete(antInv!.id, fileBridge);
    expect(await invoicesRepo.getById(antInv!.id)).toBeNull();
    expect(antInv?.pdf_uri && fileBridge.has(antInv.pdf_uri)).toBe(false);

    const seqAntAfter = await executor.query<{ last_seq: number }>(
      `SELECT last_seq FROM sequences WHERE series_type = 'ANT' AND fiscal_year = ?`,
      [fiscalYear]
    );
    expect(seqAntAfter[0]?.last_seq).toBe(antSeqNum - 1);

    await quotesRepo.delete(quoteId, fileBridge);
    expect(await quotesRepo.getById(quoteId)).toBeNull();
    expect(quoteBefore?.pdf_uri && fileBridge.has(quoteBefore.pdf_uri)).toBe(false);

    // Verificar Hucha Fiscal recalculada sin esas facturas en su trimestre
    const remainingInvoices = await invoicesRepo.listAll();
    const allJobs = await jobsRepo.listAll();
    const piggyAfter = computePiggyBank({
      quarter,
      invoices: remainingInvoices,
      tickets: [],
      jobs: allJobs,
    });
    expect(piggyAfter).toEqual(piggyExpectedAfterDelete);
  });

  it("borra entrada de site_logs junto con su foto sellada y protege URIs seed:// en deletePdf", async () => {
    const siteLogsRepo = new SiteLogsRepository(executor);
    const tempPhoto = await fileBridge.saveTempMedia(new Uint8Array([1, 2, 3, 4]), "jpg");
    const committedPhoto = await fileBridge.commitMedia(tempPhoto, "sitelogs");
    expect(committedPhoto).toBeTruthy();
    expect(fileBridge.has(committedPhoto!)).toBe(true);

    const createdLog = await siteLogsRepo.insertWithOptionalNewJob({
      input: {
        job_id: "job_02",
        category: "antes",
        note_text: "Foto tomada por error",
        raw_media_uri: tempPhoto,
      },
      committedPhotoUri: committedPhoto,
      todayIso: "2026-11-24",
    });

    expect(await siteLogsRepo.getById(createdLog.id)).not.toBeNull();

    await siteLogsRepo.delete(createdLog.id, fileBridge);
    expect(await siteLogsRepo.getById(createdLog.id)).toBeNull();
    expect(fileBridge.has(committedPhoto!)).toBe(false);

    // seed:// debe ser no-op seguro en deletePdf
    await expect(fileBridge.deletePdf("seed://pdfs/PRE-2026-001.pdf")).resolves.toBeUndefined();
  });
});
