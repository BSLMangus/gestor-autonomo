import type { AdminLlmConfigRecord } from "../../core/contracts/types";

export type AndroidModelTier = "low_ram_270m" | "high_ram_1b";

export type EffectiveLlmTarget =
  | { kind: "deterministic_only"; reason: string }
  | { kind: "ios_apple_intelligence" }
  | {
      kind: "android_mediapipe";
      tier: AndroidModelTier;
      filename: string;
      companionFilename: string;
      url: string;
      companionUrl: string;
    }
  | { kind: "webgpu_mediapipe"; modelUri: string };

export const ANDROID_MODEL_FILENAMES: Record<
  AndroidModelTier,
  { filename: string; companionFilename: string; minRamGb: number; label: string }
> = {
  low_ram_270m: {
    filename: "gemma-3-270m-it-int8.task",
    companionFilename: "gemma-3-270m-it-int8.litertlm",
    minRamGb: 4,
    label: "Gemma 3 270M (< 8 GB RAM)",
  },
  high_ram_1b: {
    filename: "gemma-3-1b-it-int4.task",
    companionFilename: "gemma-3-1b-it-int4.litertlm",
    minRamGb: 8,
    label: "Gemma 3 1B (>= 8 GB RAM)",
  },
};

export function detectDeviceRamGb(): number | undefined {
  if (typeof navigator === "undefined") return undefined;
  const mem = (navigator as { deviceMemory?: unknown }).deviceMemory;
  return typeof mem === "number" && Number.isFinite(mem) && mem > 0 ? mem : undefined;
}

export function selectAndroidModelTier(deviceMemoryGb?: number): AndroidModelTier {
  if (typeof deviceMemoryGb === "number" && Number.isFinite(deviceMemoryGb) && deviceMemoryGb >= 8) {
    return "high_ram_1b";
  }
  return "low_ram_270m";
}

export function resolveEffectiveLlmTarget(params: {
  platform: string;
  deviceMemoryGb: number | undefined;
  adminConfig: AdminLlmConfigRecord;
}): EffectiveLlmTarget {
  const { platform, deviceMemoryGb, adminConfig } = params;
  const override = adminConfig.strategy_override;

  if (override === "deterministic_only") {
    return { kind: "deterministic_only", reason: "Override Super Admin: solo determinista" };
  }

  if (override === "force_apple_intelligence") {
    return { kind: "ios_apple_intelligence" };
  }

  if (override === "force_270m") {
    const meta = ANDROID_MODEL_FILENAMES.low_ram_270m;
    return {
      kind: "android_mediapipe",
      tier: "low_ram_270m",
      filename: meta.filename,
      companionFilename: meta.companionFilename,
      url: adminConfig.android_270m_url.trim(),
      companionUrl: adminConfig.android_270m_companion_url.trim(),
    };
  }

  if (override === "force_1b") {
    const meta = ANDROID_MODEL_FILENAMES.high_ram_1b;
    return {
      kind: "android_mediapipe",
      tier: "high_ram_1b",
      filename: meta.filename,
      companionFilename: meta.companionFilename,
      url: adminConfig.android_1b_url.trim(),
      companionUrl: adminConfig.android_1b_companion_url.trim(),
    };
  }

  if (override === "force_webgpu") {
    const uri = adminConfig.custom_model_uri.trim();
    if (!uri) {
      return {
        kind: "deterministic_only",
        reason: "Falta ruta custom_model_uri para modo WebGPU",
      };
    }
    return { kind: "webgpu_mediapipe", modelUri: uri };
  }

  // Modo automático según plataforma y RAM del dispositivo
  if (platform === "ios") {
    return { kind: "ios_apple_intelligence" };
  }

  if (platform === "android") {
    const tier = selectAndroidModelTier(deviceMemoryGb);
    const meta = ANDROID_MODEL_FILENAMES[tier];
    const url =
      tier === "high_ram_1b"
        ? adminConfig.android_1b_url.trim()
        : adminConfig.android_270m_url.trim();
    const companionUrl =
      tier === "high_ram_1b"
        ? adminConfig.android_1b_companion_url.trim()
        : adminConfig.android_270m_companion_url.trim();
    return {
      kind: "android_mediapipe",
      tier,
      filename: meta.filename,
      companionFilename: meta.companionFilename,
      url,
      companionUrl,
    };
  }

  // En Web sin override explícito: opera inmediatamente en modo determinista sin descargas externas
  return {
    kind: "deterministic_only",
    reason: "Entorno Web estándar (motor determinista offline)",
  };
}
