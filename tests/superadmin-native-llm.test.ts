import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Directory } from "@capacitor/filesystem";
import type {
  AiFinishedEvent,
  DownloadModelOptions,
  DownloadProgressEvent,
  LLMPlugin,
  ModelOptions,
  TextFromAiEvent,
} from "@capgo/capacitor-llm";
import { LocalInferenceAdapterImpl } from "../src/agent/inference/localInferenceAdapter";
import { ResetService } from "../src/core/backup/resetService";
import { NodeBetterSqliteExecutor } from "../src/core/db/nodeSqliteExecutor";
import { SettingsRepository } from "../src/core/db/repositories/settingsRepo";
import { initializeSchema } from "../src/core/db/sqliteExecutor";
import {
  CapacitorLlmAdapter,
  type FilesystemProbe,
} from "../src/features/llm/capacitorLlmAdapter";
import {
  ANDROID_MODEL_FILENAMES,
  resolveEffectiveLlmTarget,
  selectAndroidModelTier,
} from "../src/features/llm/modelCatalog";
import {
  hashPinSha256,
  verifySuperAdminPin,
} from "../src/features/settings/superAdminAuth";

class MockCapgoLlmPlugin implements LLMPlugin {
  setModelCalls: ModelOptions[] = [];
  downloadCalls: DownloadModelOptions[] = [];
  failOnSetModel = false;
  failOnDownload = false;
  mockResponse = '{"intent":"assistant_qa_node","confidence":0.9,"entities":{}}';

  private textListeners = new Set<(ev: TextFromAiEvent) => void>();
  private finishListeners = new Set<(ev: AiFinishedEvent) => void>();
  private progressListeners = new Set<(ev: DownloadProgressEvent) => void>();

  async createChat(): Promise<{ id: string; instructions?: string }> {
    return { id: "chat_mock_1" };
  }

  async sendMessage(options: { chatId: string; message: string }): Promise<void> {
    for (const cb of this.textListeners) {
      cb({ chatId: options.chatId, text: this.mockResponse, isChunk: true });
    }
    for (const cb of this.finishListeners) {
      cb({ chatId: options.chatId });
    }
  }

  async getReadiness(): Promise<{ readiness: string }> {
    return { readiness: "ready" };
  }

  async setModel(options: ModelOptions): Promise<void> {
    this.setModelCalls.push(options);
    if (this.failOnSetModel) {
      throw new Error("MODEL_LOAD_FAILED");
    }
  }

  async downloadModel(options: DownloadModelOptions) {
    this.downloadCalls.push(options);
    if (this.failOnDownload) {
      throw new Error("NETWORK_UNAVAILABLE");
    }
    for (const cb of this.progressListeners) {
      cb({ progress: 50, totalBytes: 1000, downloadedBytes: 500 });
      cb({ progress: 100, totalBytes: 1000, downloadedBytes: 1000 });
    }
    return {
      path: `/data/user/0/es.obralocal.app/files/${options.filename ?? "model.task"}`,
      companionPath: options.companionUrl
        ? `/data/user/0/es.obralocal.app/files/${(options.filename ?? "model.task").replace(".task", ".litertlm")}`
        : undefined,
    };
  }

  async addListener(
    eventName: "textFromAi" | "aiFinished" | "downloadProgress" | "readinessChange",
    listenerFunc: (event: never) => void
  ): Promise<{ remove: () => Promise<void> }> {
    if (eventName === "textFromAi") {
      const fn = listenerFunc as unknown as (ev: TextFromAiEvent) => void;
      this.textListeners.add(fn);
      return { remove: async () => void this.textListeners.delete(fn) };
    }
    if (eventName === "aiFinished") {
      const fn = listenerFunc as unknown as (ev: AiFinishedEvent) => void;
      this.finishListeners.add(fn);
      return { remove: async () => void this.finishListeners.delete(fn) };
    }
    if (eventName === "downloadProgress") {
      const fn = listenerFunc as unknown as (ev: DownloadProgressEvent) => void;
      this.progressListeners.add(fn);
      return { remove: async () => void this.progressListeners.delete(fn) };
    }
    return { remove: async () => undefined };
  }

  async getPluginVersion(): Promise<{ version: string }> {
    return { version: "7.2.15-mock" };
  }
}

class MockFilesystem implements FilesystemProbe {
  files = new Map<string, number>();
  deleted: string[] = [];

  async stat(options: { path: string; directory?: Directory }) {
    const size = this.files.get(options.path);
    if (size === undefined) {
      throw new Error("FILE_NOT_FOUND");
    }
    return {
      uri: `file:///data/user/0/es.obralocal.app/files/${options.path}`,
      size,
    };
  }

  async deleteFile(options: { path: string; directory?: Directory }) {
    this.deleted.push(options.path);
    this.files.delete(options.path);
  }
}

describe("Super Admin, Detección RAM, Descarga Única y Apple Intelligence", () => {
  let executor: NodeBetterSqliteExecutor;
  let settingsRepo: SettingsRepository;

  beforeEach(async () => {
    executor = new NodeBetterSqliteExecutor(":memory:");
    await initializeSchema(executor);
    settingsRepo = new SettingsRepository(executor);
  });

  afterEach(async () => {
    await executor.close();
  });

  it("selecciona el tier Android según RAM y resuelve overrides Super Admin", async () => {
    expect(selectAndroidModelTier(undefined)).toBe("low_ram_270m");
    expect(selectAndroidModelTier(4)).toBe("low_ram_270m");
    expect(selectAndroidModelTier(6)).toBe("low_ram_270m");
    expect(selectAndroidModelTier(8)).toBe("high_ram_1b");
    expect(selectAndroidModelTier(12)).toBe("high_ram_1b");

    const adminCfg = await settingsRepo.updateAdminLlmConfig({
      strategy_override: "auto",
      android_270m_url: "https://cdn.example.com/270m.task",
      android_270m_companion_url: "https://cdn.example.com/270m.litertlm",
      android_1b_url: "https://cdn.example.com/1b.task",
      android_1b_companion_url: "https://cdn.example.com/1b.litertlm",
      custom_model_uri: "",
      max_tokens: 512,
      temperature_thousandths: 100,
      topk: 8,
    });

    expect(
      resolveEffectiveLlmTarget({
        platform: "ios",
        deviceMemoryGb: 6,
        adminConfig: adminCfg,
      })
    ).toEqual({ kind: "ios_apple_intelligence" });

    const targetLow = resolveEffectiveLlmTarget({
      platform: "android",
      deviceMemoryGb: 6,
      adminConfig: adminCfg,
    });
    expect(targetLow).toMatchObject({
      kind: "android_mediapipe",
      tier: "low_ram_270m",
      filename: ANDROID_MODEL_FILENAMES.low_ram_270m.filename,
      url: "https://cdn.example.com/270m.task",
    });

    const targetHigh = resolveEffectiveLlmTarget({
      platform: "android",
      deviceMemoryGb: 12,
      adminConfig: adminCfg,
    });
    expect(targetHigh).toMatchObject({
      kind: "android_mediapipe",
      tier: "high_ram_1b",
      filename: ANDROID_MODEL_FILENAMES.high_ram_1b.filename,
      url: "https://cdn.example.com/1b.task",
    });

    const forcedDet = resolveEffectiveLlmTarget({
      platform: "android",
      deviceMemoryGb: 12,
      adminConfig: { ...adminCfg, strategy_override: "deterministic_only" },
    });
    expect(forcedDet.kind).toBe("deterministic_only");

    const webAuto = resolveEffectiveLlmTarget({
      platform: "web",
      deviceMemoryGb: 16,
      adminConfig: adminCfg,
    });
    expect(webAuto.kind).toBe("deterministic_only");
  });

  it("en iOS activa Apple Intelligence sin descargar ficheros y cae silenciosamente si no está soportado", async () => {
    const plugin = new MockCapgoLlmPlugin();
    const fs = new MockFilesystem();
    const adapter = new CapacitorLlmAdapter({
      plugin,
      filesystem: fs,
      platform: "ios",
      deviceMemoryGb: () => 8,
    });

    const ready = await adapter.initializeFromConfig(settingsRepo);
    expect(ready).toBe(true);
    expect(plugin.downloadCalls).toHaveLength(0);
    expect(plugin.setModelCalls[0]?.path).toBe("Apple Intelligence");
    expect(adapter.getStatus().activeTier).toBe("apple_intelligence");

    // Ejecutar runner de inferencia nativo
    const runner = adapter.createRunner();
    const out = await runner("¿Cuánto he gastado?");
    expect(out).toContain("assistant_qa_node");

    // Si iOS no soporta Apple Intelligence, cae a fallback determinista sin lanzar error
    plugin.failOnSetModel = true;
    const readyFail = await adapter.initializeFromConfig(settingsRepo);
    expect(readyFail).toBe(false);
    expect(adapter.getStatus().readiness).toBe("deterministic_fallback");
  });

  it("en Android descarga una sola vez según RAM, persiste ruta local y reutiliza en arranques posteriores", async () => {
    await settingsRepo.updateAdminLlmConfig({
      strategy_override: "auto",
      android_270m_url: "https://cdn.example.com/270m.task",
      android_270m_companion_url: "https://cdn.example.com/270m.litertlm",
      android_1b_url: "https://cdn.example.com/1b.task",
      android_1b_companion_url: "https://cdn.example.com/1b.litertlm",
      custom_model_uri: "",
      max_tokens: 512,
      temperature_thousandths: 100,
      topk: 8,
    });

    const plugin = new MockCapgoLlmPlugin();
    const fs = new MockFilesystem();
    const progressEvents: number[] = [];

    const adapter = new CapacitorLlmAdapter({
      plugin,
      filesystem: fs,
      platform: "android",
      deviceMemoryGb: () => 8,
    });
    adapter.onStatusChange((st) => {
      if (st.progress !== null) progressEvents.push(st.progress);
    });

    // Primer arranque: descarga 1B porque RAM >= 8 GB
    const firstReady = await adapter.initializeFromConfig(settingsRepo);
    expect(firstReady).toBe(true);
    expect(plugin.downloadCalls).toHaveLength(1);
    expect(plugin.downloadCalls[0]?.filename).toBe(ANDROID_MODEL_FILENAMES.high_ram_1b.filename);
    expect(progressEvents).toContain(100);

    const saved = await settingsRepo.getAppSettings();
    expect(saved.llm_model_uri).toContain(ANDROID_MODEL_FILENAMES.high_ram_1b.filename);

    // Simular que el fichero ya existe en Filesystem (Directory.Data) en el segundo arranque
    fs.files.set(ANDROID_MODEL_FILENAMES.high_ram_1b.filename, 900_000_000);
    const pluginBoot2 = new MockCapgoLlmPlugin();
    const adapterBoot2 = new CapacitorLlmAdapter({
      plugin: pluginBoot2,
      filesystem: fs,
      platform: "android",
      deviceMemoryGb: () => 8,
    });

    const secondReady = await adapterBoot2.initializeFromConfig(settingsRepo);
    expect(secondReady).toBe(true);
    expect(pluginBoot2.downloadCalls).toHaveLength(0);
    expect(pluginBoot2.setModelCalls).toHaveLength(1);

    // Borrar modelo descargado limpia disco y BD
    await adapterBoot2.deleteDownloadedModel(settingsRepo);
    expect(fs.deleted).toContain(ANDROID_MODEL_FILENAMES.high_ram_1b.filename);
    expect((await settingsRepo.getAppSettings()).llm_model_uri).toBeNull();
  });

  it("mantiene admin_llm_config intacta tras ResetService.startFromScratch y migra app_settings", async () => {
    // Simular fila heredada con llm_enabled = 0 y llm_model_uri = NULL
    await executor.run(
      `INSERT INTO app_settings (
        id, emitter_name, emitter_nif, emitter_fiscal_address, emitter_phone,
        last_active_thread_id, pending_camera_context_json, llm_enabled, llm_model_uri,
        boot_mode, updated_at_ms
      ) VALUES (1, 'Test', '12345678Z', 'Calle 1', '+34600112233', NULL, NULL, 0, NULL, 'clean', 1000)`
    );
    const migrated = await settingsRepo.getAppSettings();
    expect(migrated.llm_enabled).toBe(true);

    await settingsRepo.updateAdminLlmConfig({
      strategy_override: "force_1b",
      android_270m_url: "https://cdn.example.com/270m.task",
      android_270m_companion_url: "",
      android_1b_url: "https://cdn.example.com/1b.task",
      android_1b_companion_url: "",
      custom_model_uri: "",
      max_tokens: 1024,
      temperature_thousandths: 200,
      topk: 16,
    });

    await new ResetService(executor).startFromScratch({ PRE: 0, ANT: 0, FAC: 0, OBR: 0 });

    const afterResetAdmin = await settingsRepo.getAdminLlmConfig();
    expect(afterResetAdmin.strategy_override).toBe("force_1b");
    expect(afterResetAdmin.android_1b_url).toBe("https://cdn.example.com/1b.task");
    expect(afterResetAdmin.max_tokens).toBe(1024);

    const afterResetApp = await settingsRepo.getAppSettings();
    expect(afterResetApp.llm_enabled).toBe(true);
  });

  it("valida PIN Super Admin mediante SHA-256 y opera fallback determinista si falla descarga", async () => {
    expect(await verifySuperAdminPin("246800")).toBe(true);
    expect(await verifySuperAdminPin("000000")).toBe(false);
    expect(await verifySuperAdminPin("")).toBe(false);

    const customHash = await hashPinSha256("998877");
    expect(await verifySuperAdminPin("998877", customHash)).toBe(true);
    expect(await verifySuperAdminPin("246800", customHash)).toBe(false);

    const plugin = new MockCapgoLlmPlugin();
    plugin.failOnDownload = true;
    await settingsRepo.updateAdminLlmConfig({
      strategy_override: "force_270m",
      android_270m_url: "https://cdn.example.com/270m.task",
      android_270m_companion_url: "",
      android_1b_url: "",
      android_1b_companion_url: "",
      custom_model_uri: "",
      max_tokens: 512,
      temperature_thousandths: 100,
      topk: 8,
    });
    const adapter = new CapacitorLlmAdapter({
      plugin,
      filesystem: new MockFilesystem(),
      platform: "android",
      deviceMemoryGb: () => 4,
    });
    const ok = await adapter.initializeFromConfig(settingsRepo);
    expect(ok).toBe(false);
    expect(adapter.getStatus().readiness).toBe("error");

    const inference = new LocalInferenceAdapterImpl();
    const res = await inference.classifyAndExtract({
      text: "Presupuesto para Juan: termo 80L",
      activeJobId: null,
      activeQuoteId: null,
      pendingDisambiguation: null,
      catalogCandidates: [],
    });
    expect(res.engine_used).toBe("deterministic_rule_engine");
  });
});
