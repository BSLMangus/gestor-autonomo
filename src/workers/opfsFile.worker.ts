/**
 * Dedicated Web Worker para acceso binario en OPFS mediante createSyncAccessHandle().
 * Todo fichero se almacena bajo el subdirectorio aislado "obralocal_media" para no
 * colisionar jamás con el pool interno de @sqlite.org/sqlite-wasm ("/obralocal-sahpool").
 */

interface SyncAccessHandle {
  getSize(): number;
  truncate(newSize: number): void;
  read(buffer: ArrayBufferView, options?: { at?: number }): number;
  write(buffer: ArrayBufferView, options?: { at?: number }): number;
  flush(): void;
  close(): void;
}

type FileWorkerRequest =
  | { id: number; op: "write"; relPath: string; bytes: ArrayBuffer }
  | { id: number; op: "read"; relPath: string }
  | { id: number; op: "delete"; relPath: string }
  | { id: number; op: "copy"; srcPath: string; destPath: string }
  | { id: number; op: "list"; dirPath: string };

type FileWorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; code: string; message: string };

const ROOT_FOLDER = "obralocal_media";

async function getMediaRoot(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(ROOT_FOLDER, { create: true });
}

async function resolveParentAndName(
  relPath: string,
  createDirs: boolean
): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
  const clean = relPath.replace(/^opfs:\/\//, "").replace(/^\/+/, "");
  const parts = clean.split("/").filter((p) => p.length > 0 && p !== "." && p !== "..");
  const name = parts.pop();
  if (!name) {
    throw new Error(`SCHEMA_VALIDATION_ERROR: Ruta OPFS inválida '${relPath}'`);
  }
  let dir = await getMediaRoot();
  for (const seg of parts) {
    dir = await dir.getDirectoryHandle(seg, { create: createDirs });
  }
  return { dir, name };
}

async function getSyncHandle(handle: FileSystemFileHandle): Promise<SyncAccessHandle> {
  const withSync = handle as unknown as {
    createSyncAccessHandle?: () => Promise<SyncAccessHandle>;
  };
  if (typeof withSync.createSyncAccessHandle !== "function") {
    throw new Error("OPFS_UNAVAILABLE: createSyncAccessHandle no soportado");
  }
  return withSync.createSyncAccessHandle();
}

async function writeFileBytes(relPath: string, bytes: Uint8Array): Promise<void> {
  const { dir, name } = await resolveParentAndName(relPath, true);
  const fileHandle = await dir.getFileHandle(name, { create: true });
  const syncHandle = await getSyncHandle(fileHandle);
  try {
    syncHandle.truncate(0);
    syncHandle.write(bytes, { at: 0 });
    syncHandle.flush();
  } finally {
    syncHandle.close();
  }
}

async function readFileBytes(relPath: string): Promise<ArrayBuffer> {
  const { dir, name } = await resolveParentAndName(relPath, false);
  const fileHandle = await dir.getFileHandle(name, { create: false });
  const syncHandle = await getSyncHandle(fileHandle);
  try {
    const size = syncHandle.getSize();
    const buf = new Uint8Array(size);
    if (size > 0) {
      syncHandle.read(buf, { at: 0 });
    }
    return buf.buffer;
  } finally {
    syncHandle.close();
  }
}

async function deleteFilePath(relPath: string): Promise<void> {
  try {
    const { dir, name } = await resolveParentAndName(relPath, false);
    await dir.removeEntry(name);
  } catch {
    // ignore missing entry
  }
}

async function listDirFiles(dirPath: string): Promise<string[]> {
  try {
    const clean = dirPath.replace(/^opfs:\/\//, "").replace(/^\/+/, "");
    const parts = clean.split("/").filter((p) => p.length > 0);
    let dir = await getMediaRoot();
    for (const seg of parts) {
      dir = await dir.getDirectoryHandle(seg, { create: false });
    }
    const entries: string[] = [];
    const iterable = dir as unknown as {
      entries?: () => AsyncIterableIterator<[string, FileSystemHandle]>;
    };
    if (iterable.entries) {
      for await (const [name, handle] of iterable.entries()) {
        if (handle.kind === "file") {
          entries.push(name);
        }
      }
    }
    return entries;
  } catch {
    return [];
  }
}

let queue: Promise<void> = Promise.resolve();

self.onmessage = (ev: MessageEvent<FileWorkerRequest>) => {
  const req = ev.data;
  queue = queue.then(async () => {
    try {
      switch (req.op) {
        case "write":
          await writeFileBytes(req.relPath, new Uint8Array(req.bytes));
          self.postMessage({ id: req.id, ok: true, result: true } satisfies FileWorkerResponse);
          break;
        case "read": {
          const buf = await readFileBytes(req.relPath);
          const msg: FileWorkerResponse = { id: req.id, ok: true, result: buf };
          self.postMessage(msg, { transfer: [buf] });
          break;
        }
        case "delete":
          await deleteFilePath(req.relPath);
          self.postMessage({ id: req.id, ok: true, result: true } satisfies FileWorkerResponse);
          break;
        case "copy": {
          const buf = await readFileBytes(req.srcPath);
          await writeFileBytes(req.destPath, new Uint8Array(buf));
          self.postMessage({ id: req.id, ok: true, result: true } satisfies FileWorkerResponse);
          break;
        }
        case "list": {
          const names = await listDirFiles(req.dirPath);
          self.postMessage({ id: req.id, ok: true, result: names } satisfies FileWorkerResponse);
          break;
        }
      }
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      const message = err instanceof Error ? err.message : String(err);
      const code =
        name === "QuotaExceededError" || message.includes("QuotaExceededError")
          ? "STORAGE_QUOTA_EXCEEDED"
          : "FILE_IO_ERROR";
      self.postMessage({ id: req.id, ok: false, code, message } satisfies FileWorkerResponse);
    }
  });
};
