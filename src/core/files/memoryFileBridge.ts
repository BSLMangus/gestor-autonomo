import type { LocalFileBridge } from "../contracts/types";
import { extractTempTimestampMs, isSeedVirtualUri } from "./fileBridge";

/**
 * Implementación en memoria de LocalFileBridge para Vitest y evals.worker.ts.
 */
export class MemoryFileBridge implements LocalFileBridge {
  private readonly files = new Map<string, { bytes: Uint8Array; createdAtMs: number }>();

  async saveTempMedia(bytes: Uint8Array, ext: "jpg" | "png"): Promise<string> {
    const now = Date.now();
    const uri = `mem://tmp/tmp_${now}_${crypto.randomUUID().slice(0, 8)}.${ext}`;
    this.files.set(uri, { bytes: new Uint8Array(bytes), createdAtMs: now });
    return uri;
  }

  async commitMedia(
    tempUri: string,
    folder: "tickets" | "sitelogs" | "actas"
  ): Promise<string | null> {
    if (isSeedVirtualUri(tempUri)) {
      return null;
    }
    const existing = this.files.get(tempUri);
    if (!existing) {
      return null;
    }
    const ext = tempUri.endsWith(".png") ? "png" : "jpg";
    const destUri = `mem://${folder}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}.${ext}`;
    this.files.set(destUri, { bytes: existing.bytes, createdAtMs: Date.now() });
    if (tempUri.startsWith("mem://tmp/")) {
      this.files.delete(tempUri);
    }
    return destUri;
  }

  async rollbackCommittedMedia(committedUri: string, restoreTempUri?: string): Promise<void> {
    const entry = this.files.get(committedUri);
    if (entry && restoreTempUri) {
      this.files.set(restoreTempUri, { bytes: entry.bytes, createdAtMs: Date.now() });
    }
    this.files.delete(committedUri);
  }

  async deleteCommittedMedia(uri: string | null): Promise<void> {
    if (!uri || isSeedVirtualUri(uri)) return;
    this.files.delete(uri);
  }

  async resolveDisplayUrl(
    uri: string | null
  ): Promise<{ url: string; revoke: () => void } | null> {
    if (!uri || isSeedVirtualUri(uri)) return null;
    const entry = this.files.get(uri);
    if (!entry) return null;
    const mime = uri.endsWith(".png") ? "image/png" : "image/jpeg";
    const blob = new Blob([new Uint8Array(entry.bytes)], { type: mime });
    if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
      const url = URL.createObjectURL(blob);
      return { url, revoke: () => URL.revokeObjectURL(url) };
    }
    return { url: uri, revoke: () => undefined };
  }

  async savePdf(bytes: Uint8Array, fileName: string): Promise<string> {
    const uri = `mem://pdfs/${fileName}`;
    this.files.set(uri, { bytes: new Uint8Array(bytes), createdAtMs: Date.now() });
    return uri;
  }

  async deletePdf(uri: string | null): Promise<void> {
    if (!uri || isSeedVirtualUri(uri)) return;
    this.files.delete(uri);
  }

  async toShareableNativeUri(uri: string): Promise<string> {
    return uri;
  }

  async readAsFile(uri: string, fileName: string, mimeType: string): Promise<File> {
    const entry = this.files.get(uri);
    if (!entry) {
      throw new Error(`SQLITE_QUERY_ERROR: Archivo en memoria no encontrado '${uri}'`);
    }
    return new File([new Uint8Array(entry.bytes)], fileName, { type: mimeType });
  }

  async deleteIfTemp(uri: string | null): Promise<void> {
    if (!uri || !uri.startsWith("mem://tmp/")) return;
    this.files.delete(uri);
  }

  async sweepOrphanTempFiles(activeInterruptUris: Set<string>, maxAgeMs: number): Promise<number> {
    const now = Date.now();
    let deleted = 0;
    for (const [uri, entry] of this.files.entries()) {
      if (!uri.startsWith("mem://tmp/")) continue;
      if (activeInterruptUris.has(uri)) continue;
      const ts = extractTempTimestampMs(uri) ?? entry.createdAtMs;
      if (now - ts >= maxAgeMs) {
        this.files.delete(uri);
        deleted += 1;
      }
    }
    return deleted;
  }

  /** Helper solo para tests Vitest */
  has(uri: string): boolean {
    return this.files.has(uri);
  }
}
