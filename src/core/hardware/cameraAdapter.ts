import { Capacitor } from "@capacitor/core";
import { Camera, CameraResultType, CameraSource, type Photo } from "@capacitor/camera";
import type {
  CameraCaptureResult,
  LocalFileBridge,
  PendingCameraContext,
} from "../contracts/types";
import type { SettingsRepository } from "../db/repositories/settingsRepo";

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(",") ? (b64.split(",")[1] ?? "") : b64;
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

async function pickFileViaBrowserInput(): Promise<File | null> {
  if (typeof document === "undefined") {
    return null;
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.setAttribute("capture", "environment");
    input.style.display = "none";

    let settled = false;
    const finalize = (file: File | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", onWindowFocus);
      input.remove();
      resolve(file);
    };

    const onWindowFocus = () => {
      setTimeout(() => {
        if (!settled && (!input.files || input.files.length === 0)) {
          finalize(null);
        }
      }, 400);
    };

    input.onchange = () => {
      finalize(input.files?.[0] ?? null);
    };
    input.oncancel = () => {
      finalize(null);
    };

    window.addEventListener("focus", onWindowFocus, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

export class CameraAdapter {
  constructor(
    private readonly fileBridge: LocalFileBridge,
    private readonly settingsRepo: SettingsRepository
  ) {}

  async ingestRestoredPhoto(photo: Photo): Promise<string> {
    if (photo.base64String) {
      const bytes = base64ToBytes(photo.base64String);
      const ext = photo.format?.toLowerCase() === "png" ? "png" : "jpg";
      return this.fileBridge.saveTempMedia(bytes, ext);
    }
    if (photo.webPath) {
      const resp = await fetch(photo.webPath);
      const buf = new Uint8Array(await resp.arrayBuffer());
      const ext = photo.format?.toLowerCase() === "png" ? "png" : "jpg";
      return this.fileBridge.saveTempMedia(buf, ext);
    }
    throw new Error("OCR_ENGINE_ERROR: Fotografía restaurada sin datos binarios");
  }

  async captureOrPick(
    source: PendingCameraContext["source"],
    threadId: string | null = null,
    activeJobId: string | null = null
  ): Promise<CameraCaptureResult> {
    const context: PendingCameraContext = {
      source,
      thread_id: threadId,
      active_job_id: activeJobId,
      started_at_ms: Date.now(),
    };

    if (!Capacitor.isNativePlatform()) {
      try {
        const file = await pickFileViaBrowserInput();
        if (!file) {
          return { status: "cancelled" };
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        const ext = file.type.includes("png") ? "png" : "jpg";
        const mediaUri = await this.fileBridge.saveTempMedia(bytes, ext);
        return { status: "ok", media_uri: mediaUri };
      } catch (err) {
        return {
          status: "error",
          reason: err instanceof Error ? err.message : String(err),
        };
      }
    }

    await this.settingsRepo.setPendingCameraContext(context);
    try {
      let perms = await Camera.checkPermissions();
      if (
        perms.camera === "prompt" ||
        perms.camera === "prompt-with-rationale" ||
        perms.photos === "prompt" ||
        perms.photos === "prompt-with-rationale"
      ) {
        perms = await Camera.requestPermissions({ permissions: ["camera", "photos"] });
      }
      if (perms.camera === "denied" && perms.photos === "denied") {
        return { status: "permission_denied" };
      }

      const preferredSource =
        perms.camera === "denied" && perms.photos === "granted"
          ? CameraSource.Photos
          : CameraSource.Prompt;

      const photo = await Camera.getPhoto({
        quality: 85,
        width: 1600,
        height: 1600,
        correctOrientation: true,
        resultType: CameraResultType.Base64,
        source: preferredSource,
        promptLabelHeader: "Capturar documento o foto de obra",
        promptLabelPhoto: "Elegir de galería",
        promptLabelPicture: "Hacer foto",
        promptLabelCancel: "Cancelar",
      });

      const mediaUri = await this.ingestRestoredPhoto(photo);
      return { status: "ok", media_uri: mediaUri };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const lower = msg.toLowerCase();
      if (lower.includes("cancel") || lower.includes("user cancelled")) {
        return { status: "cancelled" };
      }
      if (lower.includes("permission") || lower.includes("denied")) {
        return { status: "permission_denied" };
      }
      return { status: "error", reason: msg };
    } finally {
      await this.settingsRepo.setPendingCameraContext(null);
    }
  }
}
