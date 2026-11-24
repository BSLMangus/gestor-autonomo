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
  joinTranscriptSegments,
  WebVoiceInputAdapter,
  type ContinuousDictationPluginLike,
  type SpeechRecognitionPluginLike,
  type VoiceSessionEvent,
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

  it("joinTranscriptSegments une fragmentos con limpieza de espacios y signos de puntuación", () => {
    expect(joinTranscriptSegments("", "  hola mundo  ")).toBe("hola mundo");
    expect(joinTranscriptSegments("Presupuesto para ", "  Marta")).toBe("Presupuesto para Marta");
    expect(joinTranscriptSegments("Hola", ", qué tal")).toBe("Hola, qué tal");
    expect(joinTranscriptSegments("Línea 1\n", "Línea 2")).toBe("Línea 1\nLínea 2");
    expect(joinTranscriptSegments("Hola ", "")).toBe("Hola ");
  });

  it("CapacitorVoiceInputAdapter.startContinuousEsEs retransmite parciales/finales, gestiona pausas por notificación/background y limpia en stop()", async () => {
    type ListenerMap = {
      dictationPartial?: (ev: { sessionId: number; text: string }) => void;
      dictationFinal?: (ev: { sessionId: number; text: string }) => void;
      dictationState?: (ev: {
        sessionId: number;
        status: "listening" | "paused" | "stopped";
        reason?: "user" | "app_backgrounded" | "audio_focus_lost" | "inactivity_timeout" | "error";
      }) => void;
      dictationError?: (ev: {
        sessionId: number;
        code: string;
        message: string;
        fatal: boolean;
      }) => void;
    };
    const listeners: ListenerMap = {};
    const removeFns = [vi.fn(async () => {}), vi.fn(async () => {}), vi.fn(async () => {}), vi.fn(async () => {})];
    let addIdx = 0;

    const legacyPlugin: SpeechRecognitionPluginLike = {
      available: async () => ({ available: true }),
      checkPermissions: async () => ({ speechRecognition: "granted" }),
      requestPermissions: async () => ({ speechRecognition: "granted" }),
      start: vi.fn(),
      stop: vi.fn(async () => {}),
      isListening: async () => ({ listening: false }),
    };

    const stopSessionMock = vi.fn(async () => ({ stopped: true }));
    const continuousPlugin: ContinuousDictationPluginLike = {
      available: async () => ({ available: true, onDeviceSupported: true }),
      checkPermissions: async () => ({ microphone: "prompt" }),
      requestPermissions: async () => ({ microphone: "granted" }),
      startSession: vi.fn(async () => ({ started: true, sessionId: 42 })),
      stopSession: stopSessionMock,
      isListening: async () => ({ listening: true }),
      addListener: vi.fn(async (eventName: keyof ListenerMap, fn: never) => {
        listeners[eventName] = fn;
        const remove = removeFns[addIdx++] ?? vi.fn(async () => {});
        return { remove };
      }) as ContinuousDictationPluginLike["addListener"],
    };

    const adapter = new CapacitorVoiceInputAdapter({
      plugin: legacyPlugin,
      continuousPlugin,
      isNative: () => true,
      getPlatform: () => "android",
    });

    const events: VoiceSessionEvent[] = [];
    const session = await adapter.startContinuousEsEs((ev) => events.push(ev));
    expect(session).not.toBeNull();

    listeners.dictationState?.({ sessionId: 42, status: "listening" });
    listeners.dictationPartial?.({ sessionId: 42, text: "dos grifos" });
    listeners.dictationFinal?.({ sessionId: 42, text: "dos grifos a 90 euros" });
    // Evento de una sesión obsoleta debe descartarse
    listeners.dictationFinal?.({ sessionId: 99, text: "ruido sesión vieja" });
    listeners.dictationState?.({
      sessionId: 42,
      status: "paused",
      reason: "app_backgrounded",
    });

    expect(events).toEqual([
      { type: "listening" },
      { type: "partial", text: "dos grifos" },
      { type: "final", text: "dos grifos a 90 euros" },
      { type: "paused", reason: "app_backgrounded" },
    ]);
    for (const rm of removeFns) {
      expect(rm).toHaveBeenCalledTimes(1);
    }

    // Nueva sesión detenida vía adapter.stop() (p. ej. botón físico Atrás)
    addIdx = 0;
    const session2 = await adapter.startContinuousEsEs((ev) => events.push(ev));
    expect(session2).not.toBeNull();
    await adapter.stop();
    expect(stopSessionMock).toHaveBeenCalled();
  });

  it("CapacitorVoiceInputAdapter.startContinuousEsEs evita fugas si stop() ocurre antes de resolver startSession (StrictMode)", async () => {
    let resolvePerms!: (v: { microphone: string }) => void;
    const permsPromise = new Promise<{ microphone: string }>((r) => {
      resolvePerms = r;
    });
    const startSessionMock = vi.fn(async () => ({ started: true, sessionId: 1 }));
    const stopSessionMock = vi.fn(async () => ({ stopped: true }));

    const adapter = new CapacitorVoiceInputAdapter({
      plugin: {
        available: async () => ({ available: true }),
        checkPermissions: async () => ({ speechRecognition: "granted" }),
        requestPermissions: async () => ({ speechRecognition: "granted" }),
        start: vi.fn(),
        stop: vi.fn(async () => {}),
        isListening: async () => ({ listening: false }),
      },
      continuousPlugin: {
        available: async () => ({ available: true }),
        checkPermissions: async () => ({ microphone: "prompt" }),
        requestPermissions: () => permsPromise,
        startSession: startSessionMock,
        stopSession: stopSessionMock,
        isListening: async () => ({ listening: false }),
        addListener: vi.fn(async () => ({ remove: async () => {} })) as ContinuousDictationPluginLike["addListener"],
      },
      isNative: () => true,
      getPlatform: () => "android",
    });

    const pendingStart = adapter.startContinuousEsEs(() => {});
    await adapter.stop();
    resolvePerms({ microphone: "granted" });
    await pendingStart;

    expect(startSessionMock).not.toHaveBeenCalled();
  });

  it("WebVoiceInputAdapter.startContinuousEsEs deduplica por resultIndex, reinicia tras onend y corta en error fatal", async () => {
    vi.useFakeTimers();
    const origWindow = (globalThis as { window?: unknown }).window;

    interface MockRecInstance {
      lang: string;
      continuous: boolean;
      interimResults: boolean;
      maxAlternatives: number;
      onresult: ((ev: unknown) => void) | null;
      onerror: ((ev: { error: string }) => void) | null;
      onend: (() => void) | null;
      start: () => void;
      stop: () => void;
      abort: () => void;
    }
    const instances: MockRecInstance[] = [];

    class FakeSpeechRecognition implements MockRecInstance {
      lang = "";
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onresult: ((ev: unknown) => void) | null = null;
      onerror: ((ev: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      start = vi.fn();
      stop = vi.fn();
      abort = vi.fn();
      constructor() {
        instances.push(this);
      }
    }

    (globalThis as { window?: unknown }).window = {
      SpeechRecognition: FakeSpeechRecognition,
    };

    try {
      const adapter = new WebVoiceInputAdapter();
      const events: VoiceSessionEvent[] = [];
      const session = await adapter.startContinuousEsEs((ev) => events.push(ev));
      expect(session).not.toBeNull();
      expect(instances).toHaveLength(1);
      expect(instances[0]?.continuous).toBe(true);
      expect(instances[0]?.interimResults).toBe(true);

      instances[0]?.onresult?.({
        resultIndex: 0,
        results: [
          { isFinal: true, 0: { transcript: "Primera frase" } },
          { isFinal: false, 0: { transcript: "seguimos" } },
        ],
      });
      // Un segundo onresult con resultIndex: 0 NO debe duplicar "Primera frase"
      instances[0]?.onresult?.({
        resultIndex: 0,
        results: [
          { isFinal: true, 0: { transcript: "Primera frase" } },
          { isFinal: true, 0: { transcript: "seguimos hablando" } },
        ],
      });

      // Silencio / fin de ciclo Web Speech -> debe reiniciar automáticamente
      instances[0]?.onend?.();
      await vi.advanceTimersByTimeAsync(200);
      expect(instances).toHaveLength(2);

      // Error fatal not-allowed seguido de onend NO debe reiniciar bucle
      instances[1]?.onerror?.({ error: "not-allowed" });
      instances[1]?.onend?.();
      await vi.advanceTimersByTimeAsync(500);
      expect(instances).toHaveLength(2);

      expect(events).toEqual([
        { type: "listening" },
        { type: "final", text: "Primera frase" },
        { type: "partial", text: "seguimos" },
        { type: "final", text: "seguimos hablando" },
        { type: "partial", text: "" },
        { type: "listening" },
        { type: "permission_denied" },
      ]);
    } finally {
      (globalThis as { window?: unknown }).window = origWindow;
      vi.useRealTimers();
    }
  });
});
