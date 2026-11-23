import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ResetService } from "../src/core/backup/resetService";
import { NodeBetterSqliteExecutor } from "../src/core/db/nodeSqliteExecutor";
import { initializeSchema } from "../src/core/db/sqliteExecutor";
import { TracesRepository } from "../src/core/db/repositories/tracesRepo";
import { CatalogRepository } from "../src/core/db/repositories/catalogRepo";
import { InvoicesRepository } from "../src/core/db/repositories/invoicesRepo";
import { MemoryFileBridge } from "../src/core/files/memoryFileBridge";
import { MemoryCoordinatorNoop } from "../src/core/memory/memoryCoordinator";
import { GraphRunner } from "../src/agent/graphRunner";
import { LocalInferenceAdapterImpl } from "../src/agent/inference/localInferenceAdapter";
import type { Gate1QuoteCommitPayload, Gate2TicketCommitPayload } from "../src/core/contracts/types";
import { MockFreezerPort, MockOcrPort, MockPdfPort } from "./mocks/ports";

describe("LangGraph StateGraph + CapacitorSqliteSaver + 4 HITL Gates (:memory:)", () => {
  let executor: NodeBetterSqliteExecutor;
  let fileBridge: MemoryFileBridge;
  let mockOcr: MockOcrPort;
  let mockPdf: MockPdfPort;
  let tracesRepo: TracesRepository;
  let runner: GraphRunner;

  beforeEach(async () => {
    executor = new NodeBetterSqliteExecutor(":memory:");
    await initializeSchema(executor);
    fileBridge = new MemoryFileBridge();
    mockOcr = new MockOcrPort();
    mockPdf = new MockPdfPort();
    tracesRepo = new TracesRepository(executor);

    const reset = new ResetService(executor);
    await reset.restoreDemoData(new MockFreezerPort());

    runner = new GraphRunner(
      {
        executor,
        fileBridge,
        memoryCoordinator: new MemoryCoordinatorNoop(),
        inference: new LocalInferenceAdapterImpl(),
        ocrPort: mockOcr,
        pdfPort: mockPdf,
        traceRecorder: tracesRepo,
      },
      "memory"
    );
  });

  afterEach(async () => {
    await executor.close();
  });

  it("Gate 1: approve, edit (feedback_corrections), reject y PDF_BUILD_ERROR sin consumir correlativo", async () => {
    const thr1 = await runner.createThread({ title: "Test Gate 1" });
    const turn1 = await runner.runTurn(thr1.thread_id, {
      client_turn_id: "t_g1_1",
      text: "Presupuesto para Javier García: 1 termo eléctrico 80L y desmontaje antiguo por 45 euros, IVA 10% vivienda.",
      action_type: "free_text_or_voice",
    });

    expect(turn1.checkpoint_status).toBe("interrupted");
    expect(turn1.active_interrupt?.gate_id).toBe("gate_1_quote");
    expect(turn1.active_widget?.ui_widget_type).toBe("QuoteBuilderWidget");

    // 1. Prueba PDF_BUILD_ERROR no consume secuencia PRE
    mockPdf.shouldFailWith = new Error("PDF_BUILD_ERROR: font glitch");
    const errRes = await runner.resumeGate(thr1.thread_id, {
      gate_id: "gate_1_quote",
      action: "approve",
      client_validated_at_ms: Date.now(),
    });
    expect(errRes.error_code).toBe("PDF_BUILD_ERROR");
    const seqPre = await executor.query<{ last_seq: number }>(
      `SELECT last_seq FROM sequences WHERE series_type = 'PRE' AND fiscal_year = 2026`
    );
    expect(seqPre[0]?.last_seq).toBe(4);
    mockPdf.shouldFailWith = null;

    // 2. Nuevo hilo con edit (sube precio catálogo con save_to_catalog=true)
    const thr2 = await runner.createThread({ title: "Test Gate 1 Edit" });
    const turn2 = await runner.runTurn(thr2.thread_id, {
      client_turn_id: "t_g1_2",
      text: "Presupuesto para Elena García: 1 termo eléctrico 80L, IVA 10% vivienda.",
      action_type: "free_text_or_voice",
    });
    expect(turn2.active_interrupt?.gate_id).toBe("gate_1_quote");
    if (turn2.active_interrupt?.gate_id !== "gate_1_quote") throw new Error("Expected gate_1");

    const draft = turn2.active_interrupt.proposed_payload;
    const editedPayload: Gate1QuoteCommitPayload = {
      ...draft,
      client_id: "cli_elena_garcia",
      job_title: "Cambio termo Elena",
      lines: draft.lines.map((l) => ({
        ...l,
        unit_price_cents: 35000,
        save_to_catalog: true,
      })),
    };

    const resumedEdit = await runner.resumeGate(thr2.thread_id, {
      gate_id: "gate_1_quote",
      action: "edit",
      edited_payload: editedPayload,
      client_validated_at_ms: Date.now(),
    });
    expect(resumedEdit.checkpoint_status).toBe("idle");
    expect(resumedEdit.active_widget?.ui_widget_type).toBe("JobLifecycleActionWidget");
    if (resumedEdit.active_widget?.ui_widget_type === "JobLifecycleActionWidget") {
      expect(resumedEdit.active_widget.widget_payload.mode).toBe("overview");
      expect(resumedEdit.active_widget.widget_payload.pdf_uri).toBeTruthy();
    }

    const catalogRepo = new CatalogRepository(executor);
    const fb = await catalogRepo.listFeedbackCorrections(10);
    expect(fb.some((f) => f.old_unit_price_cents === 32000 && f.new_unit_price_cents === 35000)).toBe(
      true
    );

    // Verifica doble traza vinculada por parent_trace_id y cloud_cost_eur = 0
    const traces = await tracesRepo.listTraces(thr2.thread_id);
    expect(traces.length).toBe(2);
    const pre = traces.find((t) => t.turn_phase === "pre_interrupt");
    const post = traces.find((t) => t.turn_phase === "post_resume");
    expect(pre).toBeTruthy();
    expect(post?.parent_trace_id).toBe(pre?.trace_id);
    expect(post?.hitl_outcome).toBe("edited");
    expect(post?.cloud_cost_eur).toBe(0);

    // 3. Reject limpia sin escribir
    const thr3 = await runner.createThread({ title: "Test Gate 1 Reject" });
    await runner.runTurn(thr3.thread_id, {
      client_turn_id: "t_g1_3",
      text: "",
      action_type: "start_empty_quote",
    });
    const rejRes = await runner.resumeGate(thr3.thread_id, {
      gate_id: "gate_1_quote",
      action: "reject",
      rejection_reason: "Cliente pospone obra",
      client_validated_at_ms: Date.now(),
    });
    expect(rejRes.active_widget).toBeNull();
    expect(rejRes.checkpoint_status).toBe("idle");
  });

  it("Gate 2: OCR, fallback manual OCR_ENGINE_ERROR, edit ±2cts y reject con limpieza temp", async () => {
    const tempUri = await fileBridge.saveTempMedia(new Uint8Array([1, 2, 3]), "jpg");
    const thr = await runner.createThread({
      title: "Test Gate 2",
      active_job_id: "job_02",
    });

    const turn = await runner.runTurn(thr.thread_id, {
      client_turn_id: "t_g2_1",
      text: "",
      action_type: "scan_ticket",
      raw_media_uri: tempUri,
      media_kind: "ticket_photo",
    });
    expect(mockOcr.callCount).toBe(1);
    expect(turn.active_interrupt?.gate_id).toBe("gate_2_ticket");
    if (turn.active_interrupt?.gate_id !== "gate_2_ticket") throw new Error("Expected gate_2");

    const editedTicket: Gate2TicketCommitPayload = {
      ...turn.active_interrupt.proposed_payload,
      supplier_name: "Obramat Validado",
      base_cents: 10000,
      vat_cents: 2100,
      total_cents: 12101, // 1 céntimo dentro de tolerancia ±2
      vat_rate: 21,
      job_id: "job_03",
    };

    const resumed = await runner.resumeGate(thr.thread_id, {
      gate_id: "gate_2_ticket",
      action: "edit",
      edited_payload: editedTicket,
      client_validated_at_ms: Date.now(),
    });
    expect(resumed.active_widget).toBeNull();
    expect(resumed.active_job_id).toBe("job_03");
    expect(resumed.active_quote_id).toBeNull();
    expect(resumed.quick_actions?.some((q) => q.action_type === "open_fiscal_piggybank")).toBe(
      true
    );

    // Fallback OCR_ENGINE_ERROR -> abre manual + reject limpia tempUri
    const tempFail = await fileBridge.saveTempMedia(new Uint8Array([9, 9]), "jpg");
    mockOcr.shouldFailWith = new Error("OCR crashed");
    const thrErr = await runner.createThread({ title: "OCR Fallback" });
    const turnErr = await runner.runTurn(thrErr.thread_id, {
      client_turn_id: "t_g2_err",
      text: "",
      action_type: "scan_ticket",
      raw_media_uri: tempFail,
    });
    expect(turnErr.active_interrupt?.gate_id).toBe("gate_2_ticket");
    expect(turnErr.error_code).toBe("OCR_ENGINE_ERROR");

    await runner.resumeGate(thrErr.thread_id, {
      gate_id: "gate_2_ticket",
      action: "reject",
      client_validated_at_ms: Date.now(),
    });
    expect(fileBridge.has(tempFail)).toBe(false);
  });

  it("Gate 3 y Gate 4: ANT 40%, bloqueo doble ANT, FAC final deducida y Gate 4 ready_to_share sin sent_at falso", async () => {
    // job_02 ya tiene ANT-2026-002 (inv_02_ant). Intentar ANT debe devolver overview bloqueado
    const thrAnt = await runner.createThread({ title: "Bloqueo doble ANT", active_job_id: "job_02" });
    const dupAnt = await runner.runTurn(thrAnt.thread_id, {
      client_turn_id: "t_g3_dup_ant",
      text: "",
      action_type: "request_advance_gate",
      target_ids: { job_id: "job_02" },
    });
    expect(dupAnt.checkpoint_status).toBe("idle");
    expect(dupAnt.active_interrupt).toBeNull();
    expect(dupAnt.active_widget?.ui_widget_type).toBe("JobLifecycleActionWidget");

    // Emitir FAC final sobre job_02 descontando ANT-2026-002
    const facTurn = await runner.runTurn(thrAnt.thread_id, {
      client_turn_id: "t_g3_fac",
      text: "",
      action_type: "request_invoice_gate",
      target_ids: { job_id: "job_02" },
    });
    expect(facTurn.checkpoint_status).toBe("interrupted");
    expect(facTurn.active_interrupt?.gate_id).toBe("gate_3_invoice");

    const facRes = await runner.resumeGate(thrAnt.thread_id, {
      gate_id: "gate_3_invoice",
      action: "approve",
      client_validated_at_ms: Date.now(),
    });
    expect(facRes.checkpoint_status).toBe("idle");
    expect(facRes.active_widget?.ui_widget_type).toBe("JobLifecycleActionWidget");

    const invRepo = new InvoicesRepository(executor);
    const job02Invs = await invRepo.listByJobId("job_02");
    const fac03 = job02Invs.find((i) => i.invoice_number === "FAC-2026-003");
    expect(fac03).toBeTruthy();
    expect(fac03?.kind).toBe("final");
    expect(fac03?.advance_invoice_id).toBe("inv_02_ant");
    expect(fac03?.base_cents).toBe(76100 - 30440);
    expect(fac03?.sent_at_iso).toBeNull();

    // Gate 4 Share en el mismo hilo -> actualiza teléfono si se edita y deja sent_at_iso NULL
    const shareTurn = await runner.runTurn(thrAnt.thread_id, {
      client_turn_id: "t_g4_1",
      text: "",
      action_type: "request_share_gate",
      target_ids: { job_id: "job_02", invoice_id: fac03!.id },
    });
    expect(shareTurn.active_interrupt?.gate_id).toBe("gate_4_share");
    if (shareTurn.active_interrupt?.gate_id !== "gate_4_share") throw new Error("Expected gate_4");

    const shareDone = await runner.resumeGate(thrAnt.thread_id, {
      gate_id: "gate_4_share",
      action: "edit",
      edited_payload: {
        ...shareTurn.active_interrupt.proposed_payload,
        recipient_phone: "699887766",
        channel: "whatsapp",
      },
      client_validated_at_ms: Date.now(),
    });
    expect(shareDone.checkpoint_status).toBe("idle");
    expect(shareDone.active_widget?.ui_widget_type).toBe("JobLifecycleActionWidget");
    if (shareDone.active_widget?.ui_widget_type === "JobLifecycleActionWidget") {
      expect(shareDone.active_widget.widget_payload.mode).toBe("ready_to_share");
      expect(shareDone.active_widget.widget_payload.gate_4_draft?.recipient_phone).toBe("+34699887766");
    }
    const facAfterShare = await invRepo.getById(fac03!.id);
    expect(facAfterShare?.sent_at_iso).toBeNull();
  });

  it("assistant_qa_node, desambiguación encadenada sin bucles, cancelación y reopenRecoveredDraft", async () => {
    // 1. assistant_qa_node sobre active_job_id = job_02
    const thrQa = await runner.createThread({ title: "QA Obra", active_job_id: "job_02" });
    const qaRes = await runner.runTurn(thrQa.thread_id, {
      client_turn_id: "t_qa_1",
      text: "¿Cuánto llevo gastado en esta obra?",
      action_type: "free_text_or_voice",
      session_context: { active_job_id: "job_02", active_quote_id: "quote_02" },
    });
    expect(qaRes.checkpoint_status).toBe("idle");
    expect(qaRes.active_widget).toBeNull();
    expect(qaRes.assistant_message?.content).toContain("185,00");
    expect(qaRes.assistant_message?.content).toContain("223,85");
    expect(qaRes.assistant_message?.content).toContain("OBR-2026-003");

    // 2. Desambiguación "Presupuesto para García: 1 termo eléctrico 80L" -> "Javier" -> Gate 1
    const thrDisamb = await runner.createThread({ title: "Desambiguación" });
    const d1 = await runner.runTurn(thrDisamb.thread_id, {
      client_turn_id: "t_dis_1",
      text: "Presupuesto para García: 1 termo eléctrico 80L",
      action_type: "free_text_or_voice",
    });
    expect(d1.checkpoint_status).toBe("idle");
    expect(d1.quick_actions?.length).toBeGreaterThanOrEqual(2);

    const d2 = await runner.runTurn(thrDisamb.thread_id, {
      client_turn_id: "t_dis_2",
      text: "Javier",
      action_type: "free_text_or_voice",
    });
    expect(d2.checkpoint_status).toBe("interrupted");
    expect(d2.active_interrupt?.gate_id).toBe("gate_1_quote");

    // 3. Foto ambigua + "cancelar" limpia temporal; agotamiento sin bucles
    const tempAmb = await fileBridge.saveTempMedia(new Uint8Array([7, 7]), "jpg");
    const thrLoop = await runner.createThread({ title: "Loop Guard" });
    const p1 = await runner.runTurn(thrLoop.thread_id, {
      client_turn_id: "t_loop_1",
      text: "",
      action_type: "free_text_or_voice",
      raw_media_uri: tempAmb,
    });
    expect(p1.quick_actions?.length).toBe(2);

    // Respuesta ambigua #1 -> attempts=1 -> clarification_node
    const p2 = await runner.runTurn(thrLoop.thread_id, {
      client_turn_id: "t_loop_2",
      text: "eh",
      action_type: "free_text_or_voice",
    });
    expect(p2.quick_actions?.length).toBe(2);

    // Respuesta ambigua #2 -> disambiguation_exhausted -> assistant_qa_node sin bucle
    const p3 = await runner.runTurn(thrLoop.thread_id, {
      client_turn_id: "t_loop_3",
      text: "mm",
      action_type: "free_text_or_voice",
    });
    expect(p3.checkpoint_status).toBe("idle");
    expect(fileBridge.has(tempAmb)).toBe(false);

    // 4. Migración de checkpoint incompatible -> reopenRecoveredDraft
    await executor.run(
      `INSERT INTO lg_checkpoints (
        thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id,
        checkpoint_type, checkpoint_data, metadata_type, metadata_data,
        schema_version, has_pending_interrupt, created_at_ms
      ) VALUES ('thr_old_gate1', '', 'cp_old_1', NULL, 'json', ?, 'json', '{}', '0.9.0', 1, 5000)`,
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
                job_title: "Reparación rescatada",
                vat_rate: 10,
                notes: "",
                lines: [
                  {
                    catalog_item_id: null,
                    description: "Partida rescatada",
                    category: "General",
                    unit: "ud",
                    quantity_thousandths: 1000,
                    unit_price_cents: 5000,
                    original_unit_price_cents: 0,
                    save_to_catalog: true,
                  },
                ],
                subtotal_cents: 5000,
                vat_cents: 500,
                total_cents: 5500,
              },
            },
          },
        }),
      ]
    );

    const boot = await runner.bootstrapStorage();
    expect(boot.recoveredDrafts.length).toBe(1);
    const reopened = await runner.reopenRecoveredDraft(boot.recoveredDrafts[0]!.id);
    expect(reopened.checkpoint_status).toBe("interrupted");
    expect(reopened.active_interrupt?.gate_id).toBe("gate_1_quote");

    const remainingDrafts = await executor.query<{ dismissed: number }>(
      `SELECT dismissed FROM recovered_drafts WHERE id = ?`,
      [boot.recoveredDrafts[0]!.id]
    );
    expect(remainingDrafts[0]?.dismissed).toBe(1);
  });

  it("usa default_vat_rate configurable en presupuestos sin IVA explícito y LLM conversacional en fallback", async () => {
    const { SettingsRepository } = await import("../src/core/db/repositories/settingsRepo");
    const settingsRepo = new SettingsRepository(executor);
    await settingsRepo.updateTaxSettings({ default_vat_rate: 10, irpf_reserve_rate: 15 });

    const thrQuote = await runner.createThread({ title: "IVA por defecto" });
    const qTurn = await runner.runTurn(thrQuote.thread_id, {
      client_turn_id: "t_default_vat",
      text: "",
      action_type: "start_empty_quote",
    });
    expect(qTurn.active_interrupt?.gate_id).toBe("gate_1_quote");
    if (qTurn.active_interrupt?.gate_id === "gate_1_quote") {
      expect(qTurn.active_interrupt.proposed_payload.vat_rate).toBe(10);
    }

    const inferenceWithLlm = new LocalInferenceAdapterImpl(
      async () => "Hola, puedo ayudarte con presupuestos, tickets o tu hucha fiscal."
    );
    const chatRunner = new GraphRunner(
      {
        executor,
        fileBridge,
        memoryCoordinator: new MemoryCoordinatorNoop(),
        inference: inferenceWithLlm,
        ocrPort: mockOcr,
        pdfPort: mockPdf,
        traceRecorder: tracesRepo,
      },
      "memory"
    );
    const thrChat = await chatRunner.createThread({ title: "Charla LLM" });
    const chatTurn = await chatRunner.runTurn(thrChat.thread_id, {
      client_turn_id: "t_llm_chat",
      text: "hola buenos días",
      action_type: "free_text_or_voice",
    });
    expect(chatTurn.checkpoint_status).toBe("idle");
    expect(chatTurn.assistant_message?.content).toBe(
      "Hola, puedo ayudarte con presupuestos, tickets o tu hucha fiscal."
    );
  });
});
