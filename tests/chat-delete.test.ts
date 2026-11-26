import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GraphRunner } from "../src/agent/graphRunner";
import { LocalInferenceAdapterImpl } from "../src/agent/inference/localInferenceAdapter";
import { ResetService } from "../src/core/backup/resetService";
import { NodeBetterSqliteExecutor } from "../src/core/db/nodeSqliteExecutor";
import { ChatRepository } from "../src/core/db/repositories/chatRepo";
import { JobsRepository } from "../src/core/db/repositories/jobsRepo";
import { QuotesRepository } from "../src/core/db/repositories/quotesRepo";
import { SettingsRepository } from "../src/core/db/repositories/settingsRepo";
import { TracesRepository } from "../src/core/db/repositories/tracesRepo";
import { initializeSchema } from "../src/core/db/sqliteExecutor";
import { MemoryFileBridge } from "../src/core/files/memoryFileBridge";
import { MemoryCoordinatorNoop } from "../src/core/memory/memoryCoordinator";
import { MockFreezerPort, MockOcrPort, MockPdfPort } from "./mocks/ports";

describe("ChatRepository.deleteThread — Borrado seguro de conversaciones individuales", () => {
  let executor: NodeBetterSqliteExecutor;
  let chatRepo: ChatRepository;
  let settingsRepo: SettingsRepository;
  let jobsRepo: JobsRepository;
  let quotesRepo: QuotesRepository;
  let runner: GraphRunner;

  beforeEach(async () => {
    executor = new NodeBetterSqliteExecutor(":memory:");
    await initializeSchema(executor);
    await new ResetService(executor).restoreDemoData(new MockFreezerPort());

    chatRepo = new ChatRepository(executor);
    settingsRepo = new SettingsRepository(executor);
    jobsRepo = new JobsRepository(executor);
    quotesRepo = new QuotesRepository(executor);
    runner = new GraphRunner(
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
  });

  afterEach(async () => {
    await executor.close();
  });

  it("elimina una conversación idle, hace cascada en chat_messages, limpia checkpoints, recovered_drafts y last_active_thread_id, y preserva jobs/quotes", async () => {
    const seededJobs = await jobsRepo.listAll();
    const seededQuotes = await quotesRepo.listPaginated({ limit: 10 });
    const job = seededJobs[0]!;
    const quote = seededQuotes.items[0]!;

    const thr = await chatRepo.createThread({
      title: "Conversación idle vinculada",
      active_job_id: job.id,
      active_quote_id: quote.id,
    });
    await chatRepo.insertMessage({
      thread_id: thr.thread_id,
      client_turn_id: "turn_idle_1",
      role: "user",
      content: "Hola asistente",
    });
    await chatRepo.insertMessage({
      thread_id: thr.thread_id,
      client_turn_id: null,
      role: "assistant",
      content: "Hola, ¿en qué obra trabajamos?",
    });

    const now = Date.now();
    await executor.run(
      `INSERT INTO lg_checkpoints (
        thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id,
        checkpoint_type, checkpoint_data, metadata_type, metadata_data,
        schema_version, has_pending_interrupt, created_at_ms
      ) VALUES (?, '', 'cp_idle_1', NULL, 'json', '{}', 'json', '{}', '1.0.0', 0, ?)`,
      [thr.thread_id, now]
    );
    await executor.run(
      `INSERT INTO lg_checkpoint_writes (
        thread_id, checkpoint_ns, checkpoint_id, task_id, task_path, idx, channel, write_type, write_data
      ) VALUES (?, '', 'cp_idle_1', 'task_1', '', 0, 'messages', 'json', '{}')`,
      [thr.thread_id]
    );
    await executor.run(
      `INSERT INTO recovered_drafts (
        id, thread_id, original_schema_version, pending_gate, widget_json,
        active_job_id, active_quote_id, dismissed, recovered_at_ms
      ) VALUES ('rec_idle_1', ?, '0.9.0', 'gate_1_quote', '{}', ?, ?, 0, ?)`,
      [thr.thread_id, job.id, quote.id, now]
    );
    await settingsRepo.setLastActiveThreadId(thr.thread_id);

    await chatRepo.deleteThread(thr.thread_id);

    expect(await chatRepo.getThread(thr.thread_id)).toBeNull();
    expect(await chatRepo.listMessages(thr.thread_id)).toEqual([]);

    const msgCount = await executor.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM chat_messages WHERE thread_id = ?`,
      [thr.thread_id]
    );
    const cpCount = await executor.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM lg_checkpoints WHERE thread_id = ?`,
      [thr.thread_id]
    );
    const cpWritesCount = await executor.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM lg_checkpoint_writes WHERE thread_id = ?`,
      [thr.thread_id]
    );
    const draftsCount = await executor.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM recovered_drafts WHERE thread_id = ?`,
      [thr.thread_id]
    );
    expect(Number(msgCount[0]?.cnt)).toBe(0);
    expect(Number(cpCount[0]?.cnt)).toBe(0);
    expect(Number(cpWritesCount[0]?.cnt)).toBe(0);
    expect(Number(draftsCount[0]?.cnt)).toBe(0);

    const settingsAfter = await settingsRepo.getAppSettings();
    expect(settingsAfter.last_active_thread_id).toBeNull();

    // Obras y presupuestos vinculados siguen intactos
    expect(await jobsRepo.getById(job.id)).not.toBeNull();
    expect(await quotesRepo.getById(quote.id)).not.toBeNull();

    // Borrar un ID inexistente es no-op seguro
    await expect(chatRepo.deleteThread("thr_inexistente")).resolves.toBeUndefined();
  });

  it("permite eliminar una conversación interrupted en pausa HITL y limpia mensajes, checkpoints, recovered_drafts y last_active_thread_id", async () => {
    const thr = await runner.createThread({ title: "Presupuesto pendiente HITL" });
    const turn = await runner.runTurn(thr.thread_id, {
      client_turn_id: "turn_hitl_del_1",
      text: "Presupuesto para Elena García: 2 puntos de luz a 45 euros",
      action_type: "free_text_or_voice",
    });

    expect(turn.checkpoint_status).toBe("interrupted");
    expect(turn.active_interrupt?.gate_id).toBe("gate_1_quote");

    const beforeThread = await chatRepo.getThread(thr.thread_id);
    expect(beforeThread?.status).toBe("interrupted");
    expect((await chatRepo.listMessages(thr.thread_id)).length).toBeGreaterThan(0);

    await executor.run(
      `INSERT INTO recovered_drafts (
        id, thread_id, original_schema_version, pending_gate, widget_json,
        active_job_id, active_quote_id, dismissed, recovered_at_ms
      ) VALUES ('rec_hitl_1', ?, '0.9.0', 'gate_1_quote', '{}', NULL, NULL, 0, ?)`,
      [thr.thread_id, Date.now()]
    );
    await settingsRepo.setLastActiveThreadId(thr.thread_id);

    await chatRepo.deleteThread(thr.thread_id);

    expect(await chatRepo.getThread(thr.thread_id)).toBeNull();
    expect(await chatRepo.listMessages(thr.thread_id)).toEqual([]);

    const cpCount = await executor.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM lg_checkpoints WHERE thread_id = ?`,
      [thr.thread_id]
    );
    const draftsCount = await executor.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM recovered_drafts WHERE thread_id = ?`,
      [thr.thread_id]
    );
    expect(Number(cpCount[0]?.cnt)).toBe(0);
    expect(Number(draftsCount[0]?.cnt)).toBe(0);

    const settingsAfter = await settingsRepo.getAppSettings();
    expect(settingsAfter.last_active_thread_id).toBeNull();
  });

  it("bloquea con INVALID_STATE_TRANSITION el borrado de una conversación en estado running", async () => {
    const thr = await chatRepo.createThread({ title: "Conversación en ejecución" });
    await chatRepo.insertMessage({
      thread_id: thr.thread_id,
      client_turn_id: "turn_running_1",
      role: "user",
      content: "Generando presupuesto...",
    });
    await chatRepo.updateThread(thr.thread_id, { status: "running" });

    await expect(chatRepo.deleteThread(thr.thread_id)).rejects.toThrow(
      /INVALID_STATE_TRANSITION/
    );

    const stillThere = await chatRepo.getThread(thr.thread_id);
    expect(stillThere).not.toBeNull();
    expect(stillThere?.status).toBe("running");
    expect((await chatRepo.listMessages(thr.thread_id)).length).toBe(1);
  });
});
