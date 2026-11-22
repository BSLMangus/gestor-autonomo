import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { CapgoLLM, type LLMPlugin } from "@capgo/capacitor-llm";
import type { SettingsRepository } from "../../core/db/repositories/settingsRepo";
import {
  detectDeviceRamGb,
  resolveEffectiveLlmTarget,
  type AndroidModelTier,
} from "./modelCatalog";

export type NativeLlmReadiness =
  | "idle"
  | "downloading"
  | "loading"
  | "ready"
  | "deterministic_fallback"
  | "error";

export interface NativeLlmStatus {
  platform: string;
  deviceRamGb: number | undefined;
  readiness: NativeLlmReadiness;
  progress: number | null;
  activeTier: AndroidModelTier | "apple_intelligence" | "webgpu" | "deterministic" | null;
  activeModelPath: string | null;
  lastError: string | null;
}

export interface FilesystemProbe {
  stat(options: { path: string; directory?: Directory }): Promise<{ uri: string; size: number }>;
  deleteFile(options: { path: string; directory?: Directory }): Promise<void>;
}

export interface CapacitorLlmAdapterDeps {
  plugin?: LLMPlugin;
  filesystem?: FilesystemProbe;
  platform?: string;
  deviceMemoryGb?: () => number | undefined;
}

export class CapacitorLlmAdapter {
  private readonly plugin: LLMPlugin;
  private readonly filesystem: FilesystemProbe;
  private readonly platformOverride?: string;
  private readonly getRamGb: () => number | undefined;

  private status: NativeLlmStatus;
  private initInFlight: Promise<boolean> | null = null;
  private readonly listeners = new Set<(status: NativeLlmStatus) => void>();

  constructor(deps: CapacitorLlmAdapterDeps = {}) {
    this.plugin = deps.plugin ?? CapgoLLM;
    this.filesystem = deps.filesystem ?? Filesystem;
    this.platformOverride = deps.platform;
    this.getRamGb = deps.deviceMemoryGb ?? detectDeviceRamGb;

    const platform = this.getPlatform();
    this.status = {
      platform,
      deviceRamGb: this.getRamGb(),
      readiness: "idle",
      progress: null,
      activeTier: null,
      activeModelPath: null,
      lastError: null,
    };
  }

  getPlatform(): string {
    return this.platformOverride ?? Capacitor.getPlatform();
  }

  getStatus(): NativeLlmStatus {
    return { ...this.status, deviceRamGb: this.getRamGb() };
  }

  onStatusChange(cb: (status: NativeLlmStatus) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private updateStatus(patch: Partial<NativeLlmStatus>): void {
    this.status = {
      ...this.status,
      ...patch,
      platform: this.getPlatform(),
      deviceRamGb: this.getRamGb(),
    };
    const snapshot = this.getStatus();
    for (const cb of this.listeners) {
      try {
        cb(snapshot);
      } catch {
        // ignore listener failure
      }
    }
  }

  private async checkDownloadedModelInFilesDir(filename: string): Promise<string | null> {
    try {
      const info = await this.filesystem.stat({
        path: filename,
        directory: Directory.Data,
      });
      if (info.size > 0 && info.uri) {
        return info.uri.startsWith("file://") ? info.uri.slice("file://".length) : info.uri;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Inicializa el modelo local nativo según plataforma, RAM detectada y overrides de Super Admin.
   * Devuelve `true` si el runner nativo quedó listo para usarse; `false` si opera en modo determinista.
   */
  async initializeFromConfig(settingsRepo: SettingsRepository): Promise<boolean> {
    if (this.initInFlight) {
      return this.initInFlight;
    }

    this.initInFlight = this.runInitialize(settingsRepo).finally(() => {
      this.initInFlight = null;
    });
    return this.initInFlight;
  }

  private async runInitialize(settingsRepo: SettingsRepository): Promise<boolean> {
    const [appSettings, adminConfig] = await Promise.all([
      settingsRepo.getAppSettings(),
      settingsRepo.getAdminLlmConfig(),
    ]);

    if (!appSettings.llm_enabled && adminConfig.strategy_override === "auto") {
      this.updateStatus({
        readiness: "deterministic_fallback",
        progress: null,
        activeTier: "deterministic",
        activeModelPath: null,
        lastError: null,
      });
      return false;
    }

    const platform = this.getPlatform();
    const deviceMemoryGb = this.getRamGb();
    const target = resolveEffectiveLlmTarget({ platform, deviceMemoryGb, adminConfig });

    if (target.kind === "deterministic_only" || target.kind === "webgpu_mediapipe") {
      this.updateStatus({
        readiness: "deterministic_fallback",
        progress: null,
        activeTier: target.kind === "webgpu_mediapipe" ? "webgpu" : "deterministic",
        activeModelPath: target.kind === "webgpu_mediapipe" ? target.modelUri : null,
        lastError: null,
      });
      return false;
    }

    const temperature = adminConfig.temperature_thousandths / 1000;

    if (target.kind === "ios_apple_intelligence") {
      this.updateStatus({
        readiness: "loading",
        progress: null,
        activeTier: "apple_intelligence",
        activeModelPath: "Apple Intelligence",
        lastError: null,
      });
      try {
        await this.plugin.setModel({
          path: "Apple Intelligence",
          maxTokens: adminConfig.max_tokens,
          topk: adminConfig.topk,
          temperature,
        });
        await settingsRepo.setLocalLlmConfig(true, "Apple Intelligence");
        this.updateStatus({
          readiness: "ready",
          progress: null,
          activeTier: "apple_intelligence",
          activeModelPath: "Apple Intelligence",
          lastError: null,
        });
        return true;
      } catch (err) {
        this.updateStatus({
          readiness: "deterministic_fallback",
          progress: null,
          activeTier: "deterministic",
          activeModelPath: null,
          lastError: err instanceof Error ? err.message : String(err),
        });
        return false;
      }
    }

    // Android MediaPipe (.task + .litertlm) con descarga única en primer uso
    let progressHandle: { remove: () => Promise<void> } | null = null;
    try {
      let localPath: string | null = null;
      if (
        appSettings.llm_model_uri &&
        appSettings.llm_model_uri.endsWith(`/${target.filename}`)
      ) {
        localPath = await this.checkDownloadedModelInFilesDir(target.filename);
      }
      if (!localPath) {
        localPath = await this.checkDownloadedModelInFilesDir(target.filename);
      }

      if (!localPath) {
        if (!target.url) {
          this.updateStatus({
            readiness: "deterministic_fallback",
            progress: null,
            activeTier: "deterministic",
            activeModelPath: null,
            lastError: `URL de descarga no configurada para ${target.filename}`,
          });
          return false;
        }

        this.updateStatus({
          readiness: "downloading",
          progress: 0,
          activeTier: target.tier,
          activeModelPath: null,
          lastError: null,
        });

        progressHandle = await this.plugin.addListener("downloadProgress", (ev) => {
          const pct = Math.max(0, Math.min(100, Math.round(ev.progress)));
          this.updateStatus({ readiness: "downloading", progress: pct });
        });

        const downloaded = await this.plugin.downloadModel({
          url: target.url,
          companionUrl: target.companionUrl || undefined,
          filename: target.filename,
        });
        localPath = downloaded.path;
        await settingsRepo.setLocalLlmConfig(true, localPath);
      }

      this.updateStatus({
        readiness: "loading",
        progress: 100,
        activeTier: target.tier,
        activeModelPath: localPath,
        lastError: null,
      });

      await this.plugin.setModel({
        path: localPath,
        modelType: "task",
        maxTokens: adminConfig.max_tokens,
        topk: adminConfig.topk,
        temperature,
      });

      this.updateStatus({
        readiness: "ready",
        progress: null,
        activeTier: target.tier,
        activeModelPath: localPath,
        lastError: null,
      });
      return true;
    } catch (err) {
      this.updateStatus({
        readiness: "error",
        progress: null,
        activeTier: "deterministic",
        activeModelPath: null,
        lastError: err instanceof Error ? err.message : String(err),
      });
      return false;
    } finally {
      if (progressHandle) {
        await progressHandle.remove().catch(() => undefined);
      }
    }
  }

  async deleteDownloadedModel(settingsRepo: SettingsRepository): Promise<void> {
    const filenames = [
      "gemma-3-270m-it-int8.task",
      "gemma-3-270m-it-int8.litertlm",
      "gemma-3-1b-it-int4.task",
      "gemma-3-1b-it-int4.litertlm",
    ];
    for (const name of filenames) {
      await this.filesystem
        .deleteFile({ path: name, directory: Directory.Data })
        .catch(() => undefined);
    }
    await settingsRepo.setLocalLlmConfig(true, null);
    this.updateStatus({
      readiness: "deterministic_fallback",
      progress: null,
      activeTier: "deterministic",
      activeModelPath: null,
      lastError: null,
    });
  }

  createRunner(): (prompt: string) => Promise<string> {
    return async (prompt: string) => {
      if (this.status.readiness !== "ready") {
        throw new Error("LLM_INIT_ERROR: Modelo nativo no inicializado");
      }

      const { id: chatId } = await this.plugin.createChat();
      let buffer = "";
      let textHandle: { remove: () => Promise<void> } | null = null;
      let finishHandle: { remove: () => Promise<void> } | null = null;

      try {
        let resolveCompletion!: (val: string) => void;
        let rejectCompletion!: (err: Error) => void;
        const completionPromise = new Promise<string>((resolve, reject) => {
          resolveCompletion = resolve;
          rejectCompletion = reject;
        });

        const timer = setTimeout(() => {
          rejectCompletion(new Error("LLM_NATIVE_TIMEOUT"));
        }, 15_000);

        textHandle = await this.plugin.addListener("textFromAi", (ev) => {
          if (ev.chatId === chatId) {
            buffer += ev.text;
          }
        });
        finishHandle = await this.plugin.addListener("aiFinished", (ev) => {
          if (ev.chatId === chatId) {
            clearTimeout(timer);
            resolveCompletion(buffer);
          }
        });

        try {
          await this.plugin.sendMessage({ chatId, message: prompt });
          return await completionPromise;
        } catch (err) {
          clearTimeout(timer);
          throw err;
        }
      } finally {
        await textHandle?.remove().catch(() => undefined);
        await finishHandle?.remove().catch(() => undefined);
      }
    };
  }
}
