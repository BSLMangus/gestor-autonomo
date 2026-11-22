import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { z } from "zod";

export const DEFAULT_UPDATE_MANIFEST_URL =
  (import.meta.env.VITE_UPDATE_MANIFEST_URL as string | undefined)?.trim() ||
  "https://github.com/BSLMangus/gestor-autonomo/releases/latest/download/version.json";

export function isTrustedHttpsUrl(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

export const UpdateManifestSchema = z.object({
  versionCode: z.number().int().positive(),
  versionName: z.string().trim().min(1),
  apkUrl: z
    .string()
    .trim()
    .refine(isTrustedHttpsUrl, { message: "apkUrl debe usar una URL HTTPS válida." }),
  sha256: z
    .union([
      z
        .string()
        .trim()
        .regex(/^[a-fA-F0-9]{64}$/, "sha256 debe ser un hash hexadecimal de 64 caracteres.")
        .transform((val) => val.toLowerCase()),
      z.literal("").transform(() => undefined),
    ])
    .optional(),
  releaseNotes: z.string().trim().optional(),
  mandatory: z.boolean().optional().default(false),
});

export type UpdateManifest = z.infer<typeof UpdateManifestSchema>;

export function parseUpdateManifest(raw: unknown): UpdateManifest {
  return UpdateManifestSchema.parse(raw);
}

export function isUpdateAvailable(installedVersionCode: number, remoteVersionCode: number): boolean {
  return (
    Number.isInteger(installedVersionCode) &&
    Number.isInteger(remoteVersionCode) &&
    remoteVersionCode > installedVersionCode
  );
}

export interface InstalledAppVersion {
  versionCode: number;
  versionName: string;
  packageName: string;
}

export interface AvailableUpdateInfo {
  installedVersionCode: number;
  installedVersionName: string;
  remoteVersionCode: number;
  remoteVersionName: string;
  apkUrl: string;
  sha256?: string;
  releaseNotes?: string;
  mandatory: boolean;
}

export type UpdateCheckResult =
  | { status: "unsupported" }
  | { status: "available"; update: AvailableUpdateInfo }
  | {
      status: "up_to_date";
      installedVersionCode: number;
      installedVersionName: string;
      remoteVersionCode: number;
      remoteVersionName: string;
    }
  | { status: "error"; message: string };

export interface DownloadProgress {
  percent: number;
  downloadedBytes: number;
  totalBytes: number;
}

export interface DownloadInstallResult {
  status: "installer_launched" | "permission_required" | "unsupported";
}

export interface NativeCheckForUpdateResponse {
  available: boolean;
  installedVersionCode: number;
  installedVersionName: string;
  remoteVersionCode: number;
  remoteVersionName: string;
  apkUrl: string;
  sha256?: string;
  releaseNotes?: string;
  mandatory?: boolean;
}

export interface ApkUpdaterNativePlugin {
  getInstalledVersion(): Promise<InstalledAppVersion>;
  checkForUpdate(options: { manifestUrl: string }): Promise<NativeCheckForUpdateResponse>;
  downloadAndInstall(options: {
    apkUrl: string;
    sha256?: string;
  }): Promise<{ status: "installer_launched" | "permission_required" }>;
  addListener(
    eventName: "downloadProgress",
    listenerFunc: (progress: DownloadProgress) => void
  ): Promise<PluginListenerHandle>;
}

const NativeApkUpdater = registerPlugin<ApkUpdaterNativePlugin>("ApkUpdater");

export class ApkUpdaterService {
  constructor(private readonly nativeBridge?: ApkUpdaterNativePlugin) {}

  isSupported(): boolean {
    if (this.nativeBridge) return true;
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
  }

  private get bridge(): ApkUpdaterNativePlugin {
    return this.nativeBridge ?? NativeApkUpdater;
  }

  async getInstalledVersion(): Promise<InstalledAppVersion | null> {
    if (!this.isSupported()) return null;
    try {
      return await this.bridge.getInstalledVersion();
    } catch {
      return null;
    }
  }

  async checkForUpdate(
    manifestUrl: string = DEFAULT_UPDATE_MANIFEST_URL
  ): Promise<UpdateCheckResult> {
    if (!this.isSupported()) {
      return { status: "unsupported" };
    }
    if (!isTrustedHttpsUrl(manifestUrl)) {
      return {
        status: "error",
        message: "La URL del manifiesto de actualización debe usar HTTPS.",
      };
    }

    try {
      const raw = await this.bridge.checkForUpdate({ manifestUrl: manifestUrl.trim() });
      const parsed = parseUpdateManifest({
        versionCode: raw.remoteVersionCode,
        versionName: raw.remoteVersionName,
        apkUrl: raw.apkUrl,
        sha256: raw.sha256,
        releaseNotes: raw.releaseNotes,
        mandatory: raw.mandatory ?? false,
      });

      const available =
        Boolean(raw.available) &&
        isUpdateAvailable(raw.installedVersionCode, parsed.versionCode);

      if (!available) {
        return {
          status: "up_to_date",
          installedVersionCode: raw.installedVersionCode,
          installedVersionName: raw.installedVersionName,
          remoteVersionCode: parsed.versionCode,
          remoteVersionName: parsed.versionName,
        };
      }

      return {
        status: "available",
        update: {
          installedVersionCode: raw.installedVersionCode,
          installedVersionName: raw.installedVersionName,
          remoteVersionCode: parsed.versionCode,
          remoteVersionName: parsed.versionName,
          apkUrl: parsed.apkUrl,
          sha256: parsed.sha256,
          releaseNotes: parsed.releaseNotes || undefined,
          mandatory: parsed.mandatory,
        },
      };
    } catch (err) {
      return {
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async downloadAndInstall(
    info: { apkUrl: string; sha256?: string | null },
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<DownloadInstallResult> {
    if (!this.isSupported()) {
      return { status: "unsupported" };
    }
    if (!isTrustedHttpsUrl(info.apkUrl)) {
      throw new Error("La URL de descarga del APK debe usar HTTPS.");
    }

    let listenerHandle: PluginListenerHandle | null = null;
    if (onProgress) {
      listenerHandle = await this.bridge.addListener("downloadProgress", (progress) => {
        onProgress(progress);
      });
    }

    try {
      const res = await this.bridge.downloadAndInstall({
        apkUrl: info.apkUrl.trim(),
        sha256: info.sha256?.trim() || "",
      });
      return { status: res.status };
    } finally {
      await listenerHandle?.remove();
    }
  }
}
