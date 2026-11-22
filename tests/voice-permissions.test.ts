import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphRunner } from "../src/agent/graphRunner";
import { LocalInferenceAdapterImpl } from "../src/agent/inference/localInferenceAdapter";
import { ResetService } from "../src/core/backup/resetService";
import { NodeBetterSqliteExecutor } from "../src/core/db/nodeSqliteExecutor";
import { TracesRepository } from "../src/core/db/repositories/tracesRepo";
import { initializeSchema } from "../src/core/db/sqliteExecutor";
import { MemoryFileBridge } from "../src/core/files/memoryFileBridge";
import {
  CapacitorVoiceInputAdapter,
  type SpeechRecognitionPluginLike,
} from "../src/core/hardware/voiceAdapter";
import { MemoryCoordinatorNoop } from "../src/core/memory/memoryCoordinator";
import { MockFreezerPort, MockOcrPort, MockPdfPort } from "./mocks/ports";

describe("CapacitorVoiceInputAdapter y Alta de Cliente como Generative UI", () => {
  let executor: NodeBetterSqliteExecutor;

  beforeEach(async () => {
    executor = new NodeBetterSqliteExecutor(":memory:");
    await initializeSchema(executor);
    await new ResetService(executor).restoreDemoData(new MockFreezerPort());
  });

  afterEach(async () => {
    await executor.close();
  });

  it("comprueba disponibilidad y permisos en Capacitor sin depender de métodos inexistentes y usa partialResults: false", async () => {
    const startMock = vi.fn().mockResolvedValue({ matches: ["presupuesto para Marta Ruiz"] });
    const stopMock = vi.fn().mockResolvedValue(undefined);
    const reqPermMock = vi.fn().mockResolvedValue({ speechRecognition: "granted" });

    const plugin: SpeechRecognitionPluginLike = {
      available: async () => ({ available: true }),
      checkPermissions: async () => ({ speechRecognition: "prompt" }),
      requestPermissions: reqPermMock,
      start: startMock,
      stop: stopMock,
      isListening: async () => ({ listening: true }),
    };

    const adapter = new CapacitorVoiceInputAdapter({ plugin, isNative: () => true });
    const avail = await adapter.isAvailable();
    expect(avail.available).toBe(true);
    expect(avail.offlineSupported).toBe(true);
    expect(avail.permissionDenied).toBe(false);

    const res = await adapter.listenOnceEsEs();
    expect(res).toEqual({ status: "ok", text: "presupuesto para Marta Ruiz" });
    expect(reqPermMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledWith({
      language: "es-ES",
      maxResults: 1,
      partialResults: false,
      popup: false,
    });

    await adapter.stop();
    expect(stopMock).toHaveBeenCalledTimes(1);
  });

  it("devuelve permission_denied cuando SpeechRecognition rechaza permisos y no llama stop si no escucha", async () => {
    const stopMock = vi.fn().mockResolvedValue(undefined);
    const plugin: SpeechRecognitionPluginLike = {
      available: async () => ({ available: true }),
      checkPermissions: async () => ({ speechRecognition: "denied" }),
      requestPermissions: async () => ({ speechRecognition: "denied" }),
      start: vi.fn(),
      stop: stopMock,
      isListening: async () => ({ listening: false }),
    };

    const adapter = new CapacitorVoiceInputAdapter({ plugin, isNative: () => true });
    const res = await adapter.listenOnceEsEs();
    expect(res.status).toBe("permission_denied");

    await adapter.stop();
    expect(stopMock).not.toHaveBeenCalled();
  });

  it("assistantQaNode emite ClientProfileWidget editable en lenguaje natural y NIF inválido", async () => {
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

    const thr = await runner.createThread({ title: "Alta cliente widget" });
    const turn1 = await runner.runTurn(thr.thread_id, {
      client_turn_id: "t_cli_1",
      text: "Nuevo cliente Laura Méndez, teléfono 611223344",
      action_type: "free_text_or_voice",
    });

    expect(turn1.error_code).toBeNull();
    expect(turn1.active_widget?.ui_widget_type).toBe("ClientProfileWidget");
    if (turn1.active_widget?.ui_widget_type === "ClientProfileWidget") {
      expect(turn1.active_widget.widget_payload.name).toContain("Laura Méndez");
      expect(turn1.active_widget.widget_payload.phone).toBe("+34611223344");
      expect(turn1.active_widget.widget_payload.validation_hint).toBeNull();
    }

    const turnBadNif = await runner.runTurn(thr.thread_id, {
      client_turn_id: "t_cli_2",
      text: "Crear cliente Pepe Serrano, NIF 99999999A",
      action_type: "free_text_or_voice",
    });
    expect(turnBadNif.error_code).toBeNull();
    expect(turnBadNif.active_widget?.ui_widget_type).toBe("ClientProfileWidget");
    if (turnBadNif.active_widget?.ui_widget_type === "ClientProfileWidget") {
      expect(turnBadNif.active_widget.widget_payload.validation_hint).toContain("99999999A");
    }
  });
});
