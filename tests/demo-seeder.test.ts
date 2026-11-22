import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DemoSeeder } from "../src/agent/demoSeeder";
import { GraphRunner } from "../src/agent/graphRunner";
import { LocalInferenceAdapterImpl } from "../src/agent/inference/localInferenceAdapter";
import { NodeBetterSqliteExecutor } from "../src/core/db/nodeSqliteExecutor";
import { TracesRepository } from "../src/core/db/repositories/tracesRepo";
import { initializeSchema } from "../src/core/db/sqliteExecutor";
import { MemoryFileBridge } from "../src/core/files/memoryFileBridge";
import { LocalMemoryCoordinator } from "../src/core/memory/memoryCoordinator";
import { SiteLogService } from "../src/features/sitelog/siteLogService";
import { MockOcrPort, MockPdfPort, MockWatermarkPort } from "./mocks/ports";

describe("DemoSeeder y SiteLogService (Fase 3)", () => {
  let executor: NodeBetterSqliteExecutor;
  let fileBridge: MemoryFileBridge;
  let ocrPort: MockOcrPort;
  let pdfPort: MockPdfPort;
  let watermarkPort: MockWatermarkPort;
  let graphRunner: GraphRunner;
  let demoSeeder: DemoSeeder;
  let tracesRepo: TracesRepository;

  beforeEach(async () => {
    executor = new NodeBetterSqliteExecutor(":memory:");
    await initializeSchema(executor);
    fileBridge = new MemoryFileBridge();
    ocrPort = new MockOcrPort();
    pdfPort = new MockPdfPort();
    watermarkPort = new MockWatermarkPort();
    tracesRepo = new TracesRepository(executor);

    graphRunner = new GraphRunner(
      {
        executor,
        fileBridge,
        memoryCoordinator: new LocalMemoryCoordinator(),
        inference: new LocalInferenceAdapterImpl(),
        ocrPort,
        pdfPort,
        traceRecorder: tracesRepo,
      },
      "memory"
    );

    demoSeeder = new DemoSeeder(executor, graphRunner);
  });

  afterEach(async () => {
    await executor.close();
  });

  it("ejecuta ensureInitialBoot('demo') en 2 fases congelando thr-seed-01-gate1 y thr-seed-02-gate2 sin OCR real", async () => {
    const bootOutcome = await demoSeeder.ensureInitialBoot("demo");
    expect(bootOutcome).toBe("demo_seeded");
    expect(ocrPort.callCount).toBe(0);

    // Segunda llamada sobre BD ya poblada debe ser idempotente no destructiva
    const secondOutcome = await demoSeeder.ensureInitialBoot("demo");
    expect(secondOutcome).toBe("already_ready");

    // Verificar todas las tablas maestras y semillas cargadas
    const clientCnt = await executor.query<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM clients`);
    const catCnt = await executor.query<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM catalog_items`);
    const jobCnt = await executor.query<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM jobs`);
    const invCnt = await executor.query<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM invoices`);
    const thrCnt = await executor.query<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM chat_threads`);
    const trCnt = await executor.query<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM agent_traces`);
    const cpInterrupts = await executor.query<{ thread_id: string; has_pending_interrupt: number }>(
      `SELECT thread_id, has_pending_interrupt FROM lg_checkpoints WHERE has_pending_interrupt = 1 ORDER BY thread_id`
    );

    expect(clientCnt[0]?.cnt).toBe(4);
    expect(catCnt[0]?.cnt).toBe(12);
    expect(jobCnt[0]?.cnt).toBe(5);
    expect(invCnt[0]?.cnt).toBe(4);
    expect(thrCnt[0]?.cnt).toBe(5);
    expect(trCnt[0]?.cnt).toBe(7);
    expect(cpInterrupts.map((c) => c.thread_id)).toEqual([
      "thr-seed-01-gate1",
      "thr-seed-02-gate2",
    ]);

    // Verificar rehidratación directa en LangGraph de ambas puertas pausadas
    const gate1State = await graphRunner.getThreadState("thr-seed-01-gate1");
    expect(gate1State.checkpointStatus).toBe("interrupted");
    expect(gate1State.activeInterrupt?.gate_id).toBe("gate_1_quote");
    expect(gate1State.activeInterrupt?.ui_widget_type).toBe("QuoteBuilderWidget");

    const gate2State = await graphRunner.getThreadState("thr-seed-02-gate2");
    expect(gate2State.checkpointStatus).toBe("interrupted");
    expect(gate2State.activeInterrupt?.gate_id).toBe("gate_2_ticket");
    expect(gate2State.activeInterrupt?.ui_widget_type).toBe("TicketOcrValidatorWidget");

    // Reanudar Gate 1 directamente desde el estado semilla congelado
    const resumed = await graphRunner.resumeGate("thr-seed-01-gate1", {
      gate_id: "gate_1_quote",
      action: "approve",
      client_validated_at_ms: Date.now(),
    });
    expect(resumed.checkpoint_status).toBe("idle");
    expect(resumed.active_interrupt).toBeNull();
    expect(pdfPort.callCount).toBe(1);

    const quotes = await executor.query<{ quote_code: string; total_cents: number }>(
      `SELECT quote_code, total_cents FROM quotes WHERE quote_code = 'PRE-2026-005'`
    );
    expect(quotes).toHaveLength(1);
    expect(quotes[0]?.total_cents).toBe(43340);

    const traces = await tracesRepo.listTraces("thr-seed-01-gate1");
    const postTrace = traces.find((t) => t.turn_phase === "post_resume");
    expect(postTrace).toBeDefined();
    expect(postTrace?.parent_trace_id).toBe("tr_seed_01_pre");
    expect(postTrace?.hitl_outcome).toBe("approved");
  });

  it("permite modo limpio ('clean') sin filas demo e inicializa secuencias en 0", async () => {
    const cleanOutcome = await demoSeeder.ensureInitialBoot("clean");
    expect(cleanOutcome).toBe("clean_initialized");

    const clientCnt = await executor.query<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM clients`);
    const thrCnt = await executor.query<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM chat_threads`);
    const seqRows = await executor.query<{ series_type: string; last_seq: number }>(
      `SELECT series_type, last_seq FROM sequences ORDER BY series_type`
    );

    expect(clientCnt[0]?.cnt).toBe(0);
    expect(thrCnt[0]?.cnt).toBe(0);
    expect(seqRows).toHaveLength(4);
    expect(seqRows.every((s) => s.last_seq === 0)).toBe(true);
  });

  it("SiteLogService crea new_job + entrada atómica con foto sellada y evita huérfanos si falla", async () => {
    await demoSeeder.ensureInitialBoot("clean");
    const siteLogService = new SiteLogService(executor, fileBridge, watermarkPort);

    const rawBytes = new TextEncoder().encode("fake-jpeg-bytes");
    const tempUri = await fileBridge.saveTempMedia(rawBytes, "jpg");

    const saved = await siteLogService.commitSiteLog({
      job_id: null,
      new_job: {
        title: "Urgencia fuga bajante",
        address: "C/ Alcalá 42, Madrid",
      },
      category: "nota",
      note_text: "Sellado inicial en patio interior.",
      raw_media_uri: tempUri,
    });

    expect(saved.jobCode).toMatch(/^OBR-\d{4}-001$/);
    expect(watermarkPort.callCount).toBe(1);
    expect(saved.siteLog.photo_uri).toMatch(/^mem:\/\/sitelogs\//);

    // Intento con obra inexistente no debe crear registros huérfanos
    await expect(
      siteLogService.commitSiteLog({
        job_id: "job_no_existe",
        category: "antes",
        note_text: "Fallo esperado",
        raw_media_uri: null,
      })
    ).rejects.toThrow(/INVALID_STATE_TRANSITION/);
  });
});
