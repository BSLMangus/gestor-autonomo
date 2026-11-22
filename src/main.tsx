import "./index.css";
import { ensureBrowserAsyncLocalStorageInitialized } from "./agent/asyncLocalStoragePolyfill";

// Obligatorio inicializar BrowserAsyncLocalStorage ANTES de compilar el grafo
ensureBrowserAsyncLocalStorageInitialized();

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import type { Photo } from "@capacitor/camera";
import { DemoSeeder } from "./agent/demoSeeder";
import { GraphRunner, type StorageMode } from "./agent/graphRunner";
import { LocalInferenceAdapterImpl } from "./agent/inference/localInferenceAdapter";
import App, { type AppRuntime } from "./App";
import type { LocalFileBridge, PendingCameraContext, SqliteExecutor } from "./core/contracts/types";
import { InMemorySqliteExecutor } from "./core/db/memorySqliteExecutor";
import { NativeCapacitorSqliteExecutor } from "./core/db/nativeCapacitorExecutor";
import { SettingsRepository } from "./core/db/repositories/settingsRepo";
import { TracesRepository } from "./core/db/repositories/tracesRepo";
import { initializeSchema } from "./core/db/sqliteExecutor";
import { WebSqliteInitError, WebWorkerSqliteExecutor } from "./core/db/webWorkerSqliteExecutor";
import { DocumentOpenerService } from "./core/files/documentOpener";
import { MemoryFileBridge } from "./core/files/memoryFileBridge";
import { NativeFileBridge } from "./core/files/nativeFileBridge";
import { WebOpfsFileBridge } from "./core/files/webOpfsFileBridge";
import { CameraAdapter } from "./core/hardware/cameraAdapter";
import {
  CapacitorVoiceInputAdapter,
  WebVoiceInputAdapter,
} from "./core/hardware/voiceAdapter";
import { LocalMemoryCoordinator } from "./core/memory/memoryCoordinator";
import { QuotesRepository } from "./core/db/repositories/quotesRepo";
import { InvoicesRepository } from "./core/db/repositories/invoicesRepo";
import { CapacitorLlmAdapter } from "./features/llm/capacitorLlmAdapter";
import { MediaPipeLlmAdapter } from "./features/llm/mediaPipeAdapter";
import { TesseractOcrAdapter } from "./features/ocr/tesseractOcrAdapter";
import { PdfMakeAdapter } from "./features/pdf/pdfMakeAdapter";
import { CanvasWatermarkAdapter } from "./features/sitelog/canvasWatermark";
import { SiteLogService } from "./features/sitelog/siteLogService";

async function collectProtectedMediaUris(executor: SqliteExecutor): Promise<Set<string>> {
  const uris = new Set<string>();
  try {
    const draftRows = await executor.query<{ widget_json: string }>(
      `SELECT widget_json FROM recovered_drafts WHERE dismissed = 0`
    );
    for (const r of draftRows) {
      try {
        const parsed = JSON.parse(r.widget_json) as { widget_payload?: { media_uri?: string | null } };
        if (parsed.widget_payload?.media_uri) {
          uris.add(parsed.widget_payload.media_uri);
        }
      } catch {
        // ignore invalid draft json
      }
    }
  } catch {
    // ignore sweep helper error
  }
  return uris;
}

async function bootstrapRuntime(): Promise<AppRuntime> {
  const isNative = Capacitor.isNativePlatform();
  let executor: SqliteExecutor;
  let fileBridge: LocalFileBridge;
  let storageMode: StorageMode;
  let initialStorageError: string | null = null;

  if (isNative) {
    executor = await NativeCapacitorSqliteExecutor.create("obralocal");
    fileBridge = new NativeFileBridge();
    storageMode = "capacitor_wal";
  } else {
    try {
      executor = await WebWorkerSqliteExecutor.create();
      fileBridge = new WebOpfsFileBridge();
      storageMode = "web_opfs_worker";
    } catch (err) {
      if (err instanceof WebSqliteInitError && err.code === "OPFS_TAB_LOCKED") {
        initialStorageError =
          "Gestor Autónomo ya está abierto en otra pestaña. Cierra la pestaña duplicada y recarga para usar almacenamiento persistente OPFS (operando temporalmente en memoria).";
      } else {
        initialStorageError =
          "OPFS persistente no disponible en este contexto del navegador; operando temporalmente en memoria.";
      }
      executor = await InMemorySqliteExecutor.create();
      fileBridge = new MemoryFileBridge();
      storageMode = "memory";
    }
  }

  await initializeSchema(executor);

  const memoryCoordinator = new LocalMemoryCoordinator();
  const mediaPipeAdapter = new MediaPipeLlmAdapter(memoryCoordinator);
  const capacitorLlmAdapter = new CapacitorLlmAdapter();
  const inferenceAdapter = new LocalInferenceAdapterImpl();
  const ocrPort = new TesseractOcrAdapter(memoryCoordinator);
  const pdfPort = new PdfMakeAdapter(memoryCoordinator);
  const watermarkPort = new CanvasWatermarkAdapter();
  const traceRecorder = new TracesRepository(executor);

  const graphRunner = new GraphRunner(
    {
      executor,
      fileBridge,
      memoryCoordinator,
      inference: inferenceAdapter,
      ocrPort,
      pdfPort,
      traceRecorder,
    },
    storageMode
  );

  const demoSeeder = new DemoSeeder(executor, graphRunner);
  const siteLogService = new SiteLogService(executor, fileBridge, watermarkPort);
  const settingsRepo = new SettingsRepository(executor);
  const quotesRepo = new QuotesRepository(executor, memoryCoordinator);
  const invoicesRepo = new InvoicesRepository(executor, memoryCoordinator);
  const documentOpener = new DocumentOpenerService(fileBridge, quotesRepo, invoicesRepo);
  const cameraAdapter = new CameraAdapter(fileBridge, settingsRepo);
  const voiceAdapter = isNative ? new CapacitorVoiceInputAdapter() : new WebVoiceInputAdapter();

  const bootResult = await graphRunner.bootstrapStorage();
  await demoSeeder.ensureInitialBoot("clean");
  await invoicesRepo.syncOverdueOnRead().catch(() => undefined);

  const protectedUris = await collectProtectedMediaUris(executor);
  await fileBridge.sweepOrphanTempFiles(protectedUris, 24 * 60 * 60 * 1000).catch(() => 0);

  // Carga silenciosa en segundo plano del LLM local nativo (Apple Intelligence en iOS / descarga única por RAM en Android)
  if (isNative) {
    capacitorLlmAdapter
      .initializeFromConfig(settingsRepo)
      .then((ready) => {
        if (ready) {
          inferenceAdapter.setLlmRunner(capacitorLlmAdapter.createRunner());
        }
      })
      .catch(() => {
        // Fallback silencioso a motor determinista
      });
  } else {
    settingsRepo
      .getAdminLlmConfig()
      .then(async (adminCfg) => {
        if (
          adminCfg.strategy_override === "force_webgpu" &&
          adminCfg.custom_model_uri &&
          mediaPipeAdapter.isWebGpuSupported()
        ) {
          await mediaPipeAdapter.initialize(adminCfg.custom_model_uri);
          inferenceAdapter.setLlmRunner(mediaPipeAdapter.createRunner());
        }
      })
      .catch(() => {
        // Fallback silencioso a motor determinista
      });
  }

  // Escucha Android Process Death (appRestoredResult tras Camera.getPhoto)
  const pendingCameraRestores: Array<{ mediaUri: string; context: PendingCameraContext }> = [];
  const restoredListeners = new Set<
    (ev: { mediaUri: string; context: PendingCameraContext }) => void
  >();
  if (isNative) {
    void CapacitorApp.addListener("appRestoredResult", async (event) => {
      if (event.pluginId !== "Camera" || !event.success || !event.data) return;
      const pendingCtx = (await settingsRepo.getAppSettings()).pending_camera_context;
      await settingsRepo.setPendingCameraContext(null);
      if (!pendingCtx) return;
      try {
        const mediaUri = await cameraAdapter.ingestRestoredPhoto(event.data as Photo);
        const restoredEvent = { mediaUri, context: pendingCtx };
        if (restoredListeners.size === 0) {
          pendingCameraRestores.push(restoredEvent);
          return;
        }
        for (const cb of restoredListeners) {
          cb(restoredEvent);
        }
      } catch {
        // ignore broken restore payload
      }
    });
  }

  return {
    executor,
    fileBridge,
    memoryCoordinator,
    inferenceAdapter,
    mediaPipeAdapter,
    capacitorLlmAdapter,
    ocrPort,
    pdfPort,
    watermarkPort,
    documentOpener,
    cameraAdapter,
    voiceAdapter,
    siteLogService,
    graphRunner,
    demoSeeder,
    storageMode,
    initialStorageError,
    initialRecoveredDrafts: bootResult.recoveredDrafts,
    consumePendingCameraRestores: () => pendingCameraRestores.splice(0, pendingCameraRestores.length),
    onCameraRestoredSubscribe: (cb) => {
      restoredListeners.add(cb);
      return () => {
        restoredListeners.delete(cb);
      };
    },
  };
}

export const appReadyPromise = bootstrapRuntime();

const rootEl = document.getElementById("root");
if (rootEl) {
  const root = createRoot(rootEl);
  root.render(
    <div className="flex h-dvh items-center justify-center bg-slate-100 text-xs font-semibold text-slate-600">
      Inicializando base de datos local...
    </div>
  );

  appReadyPromise
    .then((runtime) => {
      root.render(
        <StrictMode>
          <App runtime={runtime} />
        </StrictMode>
      );
    })
    .catch((err) => {
      root.render(
        <div role="alert" className="p-4 text-sm text-rose-800">
          Error crítico al inicializar Gestor Autónomo:{" "}
          {err instanceof Error ? err.message : String(err)}
        </div>
      );
    });
}
