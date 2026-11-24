import type { LocalFileBridge } from "../contracts/types";
import {
  extractTempTimestampMs,
  isQuotaExceededError,
  isSeedVirtualUri,
} from "./fileBridge";

interface FileWorkerResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  code?: string;
  message?: string;
}

export class WebOpfsFileBridge implements LocalFileBridge {
  private readonly worker: Worker;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (val: unknown) => void; reject: (err: Error) => void }
  >();

  constructor() {
    this.worker = new Worker(new URL("../../workers/opfsFile.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (ev: MessageEvent<FileWorkerResponse>) => {
      const msg = ev.data;
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      if (msg.ok) {
        entry.resolve(msg.result);
      } else {
        const prefix = msg.code === "STORAGE_QUOTA_EXCEEDED" ? "STORAGE_QUOTA_EXCEEDED: " : "";
        entry.reject(new Error(`${prefix}${msg.message ?? "OPFS I/O error"}`));
      }
    };
  }

  private call(
    payload: Record<string, unknown>,
    transfer: Transferable[] = []
  ): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, ...payload }, transfer);
    });
  }

  async saveTempMedia(bytes: Uint8Array, ext: "jpg" | "png"): Promise<string> {
    const name = `tmp_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.${ext}`;
    const relPath = `tmp/${name}`;
    const copyBuf = bytes.slice().buffer;
    try {
      await this.call({ op: "write", relPath, bytes: copyBuf }, [copyBuf]);
      return `opfs://${relPath}`;
    } catch (err) {
      if (isQuotaExceededError(err)) {
        throw new Error("STORAGE_QUOTA_EXCEEDED: Almacenamiento OPFS lleno");
      }
      throw err;
    }
  }

  async commitMedia(tempUri: string, folder: "tickets" | "sitelogs"): Promise<string | null> {
    if (isSeedVirtualUri(tempUri)) {
      return null;
    }
    const ext = tempUri.toLowerCase().endsWith(".png") ? "png" : "jpg";
    const destPath = `${folder}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}.${ext}`;
    try {
      await this.call({ op: "copy", srcPath: tempUri, destPath });
      await this.deleteIfTemp(tempUri);
      return `opfs://${destPath}`;
    } catch (err) {
      if (isQuotaExceededError(err)) {
        throw new Error("STORAGE_QUOTA_EXCEEDED: Almacenamiento OPFS lleno");
      }
      throw err;
    }
  }

  async rollbackCommittedMedia(committedUri: string, restoreTempUri?: string): Promise<void> {
    try {
      if (restoreTempUri) {
        await this.call({ op: "copy", srcPath: committedUri, destPath: restoreTempUri });
      }
    } catch {
      // ignore restore failure
    }
    await this.deleteCommittedMedia(committedUri);
  }

  async deleteCommittedMedia(uri: string | null): Promise<void> {
    if (!uri || isSeedVirtualUri(uri)) return;
    await this.call({ op: "delete", relPath: uri });
  }

  async resolveDisplayUrl(
    uri: string | null
  ): Promise<{ url: string; revoke: () => void } | null> {
    if (!uri || isSeedVirtualUri(uri)) return null;
    try {
      const buf = (await this.call({ op: "read", relPath: uri })) as ArrayBuffer;
      const mime = uri.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
      const blob = new Blob([buf], { type: mime });
      const url = URL.createObjectURL(blob);
      return {
        url,
        revoke: () => URL.revokeObjectURL(url),
      };
    } catch {
      return null;
    }
  }

  async savePdf(bytes: Uint8Array, fileName: string): Promise<string> {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const relPath = `pdfs/${safeName}`;
    const copyBuf = bytes.slice().buffer;
    try {
      await this.call({ op: "write", relPath, bytes: copyBuf }, [copyBuf]);
      return `opfs://${relPath}`;
    } catch (err) {
      if (isQuotaExceededError(err)) {
        throw new Error("STORAGE_QUOTA_EXCEEDED: Almacenamiento OPFS lleno al guardar PDF");
      }
      throw err;
    }
  }

  async deletePdf(uri: string | null): Promise<void> {
    if (!uri || isSeedVirtualUri(uri)) return;
    await this.call({ op: "delete", relPath: uri });
  }

  async toShareableNativeUri(uri: string): Promise<string> {
    return uri;
  }

  async readAsFile(uri: string, fileName: string, mimeType: string): Promise<File> {
    const buf = (await this.call({ op: "read", relPath: uri })) as ArrayBuffer;
    return new File([buf], fileName, { type: mimeType });
  }

  async deleteIfTemp(uri: string | null): Promise<void> {
    if (!uri || !uri.startsWith("opfs://tmp/")) return;
    await this.call({ op: "delete", relPath: uri });
  }

  async sweepOrphanTempFiles(activeInterruptUris: Set<string>, maxAgeMs: number): Promise<number> {
    const files = (await this.call({ op: "list", dirPath: "tmp" })) as string[];
    const now = Date.now();
    let deleted = 0;
    for (const fileName of files) {
      const uri = `opfs://tmp/${fileName}`;
      if (activeInterruptUris.has(uri)) continue;
      const ts = extractTempTimestampMs(fileName) ?? now;
      if (now - ts >= maxAgeMs) {
        await this.call({ op: "delete", relPath: uri });
        deleted += 1;
      }
    }
    return deleted;
  }

  close(): void {
    this.worker.terminate();
  }
}
