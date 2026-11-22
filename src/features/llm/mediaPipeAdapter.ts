import type { MemoryCoordinator } from "../../core/contracts/types";

function resolvePublicAsset(relativePath: string): string {
  const base = import.meta.env.BASE_URL ?? "/";
  const cleanBase = base.endsWith("/") ? base : `${base}/`;
  const cleanRel = relativePath.replace(/^\/+/, "");
  return `${cleanBase}${cleanRel}`;
}

export interface LocalLlmCapabilities {
  webGpuAvailable: boolean;
  loaded: boolean;
  modelUri: string | null;
}

/**
 * Adaptador LLM opcional 100 % offline en dispositivo (`@mediapipe/tasks-genai` + WebGPU).
 * Registra su liberador en `MemoryCoordinator` y expone `llmRunner` inyectable
 * en `DefaultLocalInferenceAdapter` manteniendo `src/agent/` libre de imports de UI/WASM.
 */
export class MediaPipeLlmAdapter {
  private instance: {
    generateResponse(prompt: string): Promise<string>;
    close(): void;
  } | null = null;
  private modelUri: string | null = null;
  private loadPromise: Promise<void> | null = null;

  constructor(private readonly memoryCoordinator: MemoryCoordinator) {
    this.memoryCoordinator.registerLlmReleaser(() => this.unloadLocalLlm());
  }

  isWebGpuSupported(): boolean {
    return typeof navigator !== "undefined" && "gpu" in navigator && Boolean((navigator as { gpu?: unknown }).gpu);
  }

  getCapabilities(): LocalLlmCapabilities {
    return {
      webGpuAvailable: this.isWebGpuSupported(),
      loaded: this.instance !== null,
      modelUri: this.modelUri,
    };
  }

  async initialize(modelUri: string): Promise<void> {
    if (!modelUri.trim()) {
      throw new Error("LLM_INIT_ERROR: Ruta/archivo de modelo local vacía");
    }
    if (!this.isWebGpuSupported()) {
      throw new Error("LLM_INIT_ERROR: WebGPU no disponible en este dispositivo/navegador");
    }
    if (this.instance && this.modelUri === modelUri) {
      return;
    }
    if (this.loadPromise) {
      await this.loadPromise;
      return;
    }

    this.loadPromise = (async () => {
      await this.unloadLocalLlm();

      let genaiMod: typeof import("@mediapipe/tasks-genai");
      try {
        genaiMod = await import("@mediapipe/tasks-genai");
      } catch (err) {
        throw new Error(
          `LAZY_CHUNK_LOAD_ERROR: No se pudo cargar @mediapipe/tasks-genai (${err instanceof Error ? err.message : String(err)})`
        );
      }

      try {
        const fileset = await genaiMod.FilesetResolver.forGenAiTasks(
          resolvePublicAsset("assets/mediapipe/wasm")
        );
        const llm = await genaiMod.LlmInference.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: modelUri,
          },
          maxTokens: 512,
          temperature: 0.1,
          topK: 8,
        });
        this.instance = llm;
        this.modelUri = modelUri;
      } catch (err) {
        this.instance = null;
        this.modelUri = null;
        throw new Error(
          `LLM_INIT_ERROR: Error inicializando modelo local MediaPipe (${err instanceof Error ? err.message : String(err)})`
        );
      }
    })();

    try {
      await this.loadPromise;
    } finally {
      this.loadPromise = null;
    }
  }

  /**
   * Función pura inyectable como `llmRunner` en `DefaultLocalInferenceAdapter`.
   */
  createRunner(): (prompt: string) => Promise<string> {
    return async (prompt: string) => {
      if (!this.instance) {
        throw new Error("LLM_INIT_ERROR: Modelo MediaPipe local no cargado");
      }
      const release = await this.memoryCoordinator.acquireHeavyTask("llm");
      try {
        return await this.instance.generateResponse(prompt);
      } catch (err) {
        throw new Error(
          `LLM_INFERENCE_ERROR: ${err instanceof Error ? err.message : String(err)}`
        );
      } finally {
        await release();
      }
    };
  }

  async unloadLocalLlm(): Promise<void> {
    if (this.instance) {
      try {
        this.instance.close();
      } catch {
        // ignore close failure
      }
      this.instance = null;
      this.modelUri = null;
    }
  }
}
