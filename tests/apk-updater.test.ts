import { describe, expect, it, vi } from "vitest";
import {
  ApkUpdaterService,
  isTrustedHttpsUrl,
  isUpdateAvailable,
  parseUpdateManifest,
  type ApkUpdaterNativePlugin,
  type DownloadProgress,
} from "../src/core/updates/apkUpdaterService";

const VALID_SHA = "a".repeat(64);

describe("ApkUpdaterService y validación de manifiesto version.json", () => {
  it("valida URLs HTTPS estrictas y rechaza esquemas inseguros", () => {
    expect(
      isTrustedHttpsUrl(
        "https://github.com/BSLMangus/gestor-autonomo/releases/latest/download/version.json"
      )
    ).toBe(true);
    expect(isTrustedHttpsUrl("http://github.com/magnus/gestor-autonomo/version.json")).toBe(false);
    expect(isTrustedHttpsUrl("javascript:alert(1)")).toBe(false);
    expect(isTrustedHttpsUrl("")).toBe(false);
  });

  it("parseUpdateManifest valida campos obligatorios, sha256 y rechaza URL no HTTPS", () => {
    const parsed = parseUpdateManifest({
      versionCode: 2,
      versionName: "1.0.1",
      apkUrl: "https://github.com/BSLMangus/gestor-autonomo/releases/latest/download/GestorAutonomo-v1.0.1.apk",
      sha256: VALID_SHA.toUpperCase(),
      releaseNotes: "Mejoras en presupuestos.",
      mandatory: true,
    });
    expect(parsed.versionCode).toBe(2);
    expect(parsed.sha256).toBe(VALID_SHA);
    expect(parsed.mandatory).toBe(true);

    expect(() =>
      parseUpdateManifest({
        versionCode: 2,
        versionName: "1.0.1",
        apkUrl: "http://example.com/app.apk",
      })
    ).toThrow();

    expect(() =>
      parseUpdateManifest({
        versionCode: 0,
        versionName: "1.0.0",
        apkUrl: "https://example.com/app.apk",
      })
    ).toThrow();

    expect(() =>
      parseUpdateManifest({
        versionCode: 3,
        versionName: "1.0.2",
        apkUrl: "https://example.com/app.apk",
        sha256: "hash-invalido",
      })
    ).toThrow();
  });

  it("isUpdateAvailable compara versionCode remoto frente a instalado", () => {
    expect(isUpdateAvailable(1, 2)).toBe(true);
    expect(isUpdateAvailable(2, 2)).toBe(false);
    expect(isUpdateAvailable(3, 2)).toBe(false);
  });

  it("en entorno web devuelve unsupported sin ejecutar red", async () => {
    const webUpdater = new ApkUpdaterService();
    expect(webUpdater.isSupported()).toBe(false);
    expect(await webUpdater.getInstalledVersion()).toBeNull();
    expect(await webUpdater.checkForUpdate()).toEqual({ status: "unsupported" });
    expect(
      await webUpdater.downloadAndInstall({
        apkUrl: "https://github.com/BSLMangus/gestor-autonomo/releases/latest/download/app.apk",
      })
    ).toEqual({ status: "unsupported" });
  });

  it("gestiona checkForUpdate (available, up_to_date, error) y limpia listener en downloadAndInstall", async () => {
    const removeSpy = vi.fn().mockResolvedValue(undefined);
    let progressCallback: ((p: DownloadProgress) => void) | null = null;

    const mockBridge: ApkUpdaterNativePlugin = {
      getInstalledVersion: vi.fn().mockResolvedValue({
        versionCode: 1,
        versionName: "1.0.0",
        packageName: "es.obralocal.app",
      }),
      checkForUpdate: vi.fn().mockResolvedValue({
        available: true,
        installedVersionCode: 1,
        installedVersionName: "1.0.0",
        remoteVersionCode: 2,
        remoteVersionName: "1.0.1",
        apkUrl:
          "https://github.com/BSLMangus/gestor-autonomo/releases/latest/download/GestorAutonomo-v1.0.1.apk",
        sha256: VALID_SHA,
        releaseNotes: "Corrección de errores",
        mandatory: false,
      }),
      addListener: vi.fn().mockImplementation(async (_ev, cb) => {
        progressCallback = cb;
        return { remove: removeSpy };
      }),
      downloadAndInstall: vi.fn().mockImplementation(async () => {
        progressCallback?.({ percent: 50, downloadedBytes: 5_000_000, totalBytes: 10_000_000 });
        progressCallback?.({ percent: 100, downloadedBytes: 10_000_000, totalBytes: 10_000_000 });
        return { status: "permission_required" as const };
      }),
    };

    const svc = new ApkUpdaterService(mockBridge);
    expect(svc.isSupported()).toBe(true);

    const checkRes = await svc.checkForUpdate();
    expect(checkRes.status).toBe("available");
    if (checkRes.status === "available") {
      expect(checkRes.update.remoteVersionCode).toBe(2);
      expect(checkRes.update.sha256).toBe(VALID_SHA);
    }

    const badUrlRes = await svc.checkForUpdate("http://insecure.local/version.json");
    expect(badUrlRes.status).toBe("error");

    const progressEvents: DownloadProgress[] = [];
    const dlRes = await svc.downloadAndInstall(
      {
        apkUrl:
          "https://github.com/BSLMangus/gestor-autonomo/releases/latest/download/GestorAutonomo-v1.0.1.apk",
        sha256: VALID_SHA,
      },
      (p) => progressEvents.push(p)
    );
    expect(dlRes.status).toBe("permission_required");
    expect(progressEvents).toHaveLength(2);
    expect(removeSpy).toHaveBeenCalledTimes(1);

    // Aunque downloadAndInstall falle, el listener se elimina siempre
    (mockBridge.downloadAndInstall as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Error de red")
    );
    await expect(
      svc.downloadAndInstall(
        {
          apkUrl:
            "https://github.com/BSLMangus/gestor-autonomo/releases/latest/download/GestorAutonomo-v1.0.1.apk",
        },
        () => undefined
      )
    ).rejects.toThrow("Error de red");
    expect(removeSpy).toHaveBeenCalledTimes(2);

    // Caso up_to_date cuando remoteVersionCode <= installedVersionCode
    (mockBridge.checkForUpdate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      available: false,
      installedVersionCode: 2,
      installedVersionName: "1.0.1",
      remoteVersionCode: 2,
      remoteVersionName: "1.0.1",
      apkUrl:
        "https://github.com/magnus/gestor-autonomo/releases/latest/download/ObraLocalAI-v1.0.1.apk",
    });
    const upToDateRes = await svc.checkForUpdate();
    expect(upToDateRes.status).toBe("up_to_date");
  });
});
