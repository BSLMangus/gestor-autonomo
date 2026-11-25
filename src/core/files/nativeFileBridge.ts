import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import type { LocalFileBridge } from "../contracts/types";
import {
  extractTempTimestampMs,
  isQuotaExceededError,
  isSeedVirtualUri,
} from "./fileBridge";

function uint8ToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    parts.push(String.fromCharCode(...slice));
  }
  return btoa(parts.join(""));
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

const TEMP_DIR = "obralocal_tmp";

export class NativeFileBridge implements LocalFileBridge {
  private async ensureDir(path: string, directory: Directory): Promise<void> {
    try {
      await Filesystem.mkdir({ path, directory, recursive: true });
    } catch {
      // Directory may already exist
    }
  }

  async saveTempMedia(bytes: Uint8Array, ext: "jpg" | "png"): Promise<string> {
    try {
      await this.ensureDir(TEMP_DIR, Directory.Cache);
      const name = `tmp_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.${ext}`;
      const relPath = `${TEMP_DIR}/${name}`;
      const res = await Filesystem.writeFile({
        path: relPath,
        data: uint8ToBase64(bytes),
        directory: Directory.Cache,
        recursive: true,
      });
      return res.uri;
    } catch (err) {
      if (isQuotaExceededError(err)) {
        throw new Error("STORAGE_QUOTA_EXCEEDED: Espacio insuficiente en caché temporal");
      }
      throw err;
    }
  }

  async commitMedia(
    tempUri: string,
    folder: "tickets" | "sitelogs" | "actas"
  ): Promise<string | null> {
    if (isSeedVirtualUri(tempUri)) {
      return null;
    }
    try {
      await this.ensureDir(folder, Directory.Data);
      const ext = tempUri.toLowerCase().endsWith(".png") ? "png" : "jpg";
      const destPath = `${folder}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}.${ext}`;
      const readRes = await Filesystem.readFile({ path: tempUri });
      const dataStr = typeof readRes.data === "string" ? readRes.data : "";
      const writeRes = await Filesystem.writeFile({
        path: destPath,
        data: dataStr,
        directory: Directory.Data,
        recursive: true,
      });
      await this.deleteIfTemp(tempUri);
      return writeRes.uri;
    } catch (err) {
      if (isQuotaExceededError(err)) {
        throw new Error("STORAGE_QUOTA_EXCEEDED: Espacio insuficiente para guardar media");
      }
      throw err;
    }
  }

  async rollbackCommittedMedia(committedUri: string, restoreTempUri?: string): Promise<void> {
    try {
      if (restoreTempUri) {
        const readRes = await Filesystem.readFile({ path: committedUri });
        const dataStr = typeof readRes.data === "string" ? readRes.data : "";
        await Filesystem.writeFile({
          path: restoreTempUri,
          data: dataStr,
          recursive: true,
        });
      }
    } catch {
      // best-effort restore
    }
    await this.deleteCommittedMedia(committedUri);
  }

  async deleteCommittedMedia(uri: string | null): Promise<void> {
    if (!uri || isSeedVirtualUri(uri)) return;
    try {
      await Filesystem.deleteFile({ path: uri });
    } catch {
      // ignore missing file
    }
  }

  async resolveDisplayUrl(
    uri: string | null
  ): Promise<{ url: string; revoke: () => void } | null> {
    if (!uri || isSeedVirtualUri(uri)) return null;
    return {
      url: Capacitor.convertFileSrc(uri),
      revoke: () => undefined,
    };
  }

  async savePdf(bytes: Uint8Array, fileName: string): Promise<string> {
    try {
      await this.ensureDir("pdfs", Directory.Data);
      const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
      const res = await Filesystem.writeFile({
        path: `pdfs/${safeName}`,
        data: uint8ToBase64(bytes),
        directory: Directory.Data,
        recursive: true,
      });
      return res.uri;
    } catch (err) {
      if (isQuotaExceededError(err)) {
        throw new Error("STORAGE_QUOTA_EXCEEDED: Espacio insuficiente para guardar PDF");
      }
      throw err;
    }
  }

  async deletePdf(uri: string | null): Promise<void> {
    if (!uri || isSeedVirtualUri(uri)) return;
    try {
      await Filesystem.deleteFile({ path: uri });
    } catch {
      // ignore missing PDF
    }
  }

  async toShareableNativeUri(uri: string): Promise<string> {
    const readRes = await Filesystem.readFile({ path: uri });
    const baseName = uri.split("/").pop() || `doc_${Date.now()}.pdf`;
    await this.ensureDir("share_cache", Directory.Cache);
    const cacheRes = await Filesystem.writeFile({
      path: `share_cache/${baseName}`,
      data: typeof readRes.data === "string" ? readRes.data : "",
      directory: Directory.Cache,
      recursive: true,
    });
    return cacheRes.uri;
  }

  async readAsFile(uri: string, fileName: string, mimeType: string): Promise<File> {
    const readRes = await Filesystem.readFile({ path: uri });
    const bytes =
      typeof readRes.data === "string"
        ? base64ToUint8(readRes.data)
        : new Uint8Array(await readRes.data.arrayBuffer());
    return new File([new Uint8Array(bytes)], fileName, { type: mimeType });
  }

  async deleteIfTemp(uri: string | null): Promise<void> {
    if (!uri || !uri.includes(TEMP_DIR)) return;
    try {
      await Filesystem.deleteFile({ path: uri });
    } catch {
      // ignore missing temp
    }
  }

  async sweepOrphanTempFiles(activeInterruptUris: Set<string>, maxAgeMs: number): Promise<number> {
    let deleted = 0;
    try {
      const listed = await Filesystem.readdir({ path: TEMP_DIR, directory: Directory.Cache });
      const now = Date.now();
      for (const fileInfo of listed.files) {
        const uri = fileInfo.uri ?? `${TEMP_DIR}/${fileInfo.name}`;
        if (activeInterruptUris.has(uri)) continue;
        const ts = extractTempTimestampMs(fileInfo.name) ?? fileInfo.mtime ?? now;
        if (now - ts >= maxAgeMs) {
          try {
            await Filesystem.deleteFile({ path: `${TEMP_DIR}/${fileInfo.name}`, directory: Directory.Cache });
            deleted += 1;
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // temp dir may not exist yet
    }
    return deleted;
  }
}
