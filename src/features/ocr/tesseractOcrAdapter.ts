import { extractTicketFieldsFromText } from "../../agent/inference/deterministicSpanishParser";
import type { MemoryCoordinator } from "../../core/contracts/types";
import type { OcrPort } from "../../core/ports/mediaPorts";

function resolvePublicAsset(relativePath: string): string {
  const base = import.meta.env.BASE_URL ?? "/";
  const cleanBase = base.endsWith("/") ? base : `${base}/`;
  const cleanRel = relativePath.replace(/^\/+/, "");
  return `${cleanBase}${cleanRel}`;
}

async function downscaleImageToBlob(
  imageBuffer: Uint8Array,
  mimeType: "image/jpeg" | "image/png" | "image/webp",
  maxDimension = 1600
): Promise<Blob> {
  const rawBlob = new Blob([imageBuffer.slice().buffer], { type: mimeType });
  if (typeof createImageBitmap !== "function") {
    return rawBlob;
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(rawBlob);
    const { width, height } = bitmap;
    const mustTranscodeWebp = mimeType === "image/webp";
    if (!mustTranscodeWebp && width <= maxDimension && height <= maxDimension) {
      return rawBlob;
    }

    const scale = Math.min(1, maxDimension / width, maxDimension / height);
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));

    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(targetW, targetH);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(bitmap, 0, 0, targetW, targetH);
        return await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
      }
    }

    if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(bitmap, 0, 0, targetW, targetH);
        const converted = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", 0.9)
        );
        canvas.width = 0;
        canvas.height = 0;
        if (converted) return converted;
      }
    }

    return rawBlob;
  } catch {
    return rawBlob;
  } finally {
    bitmap?.close();
  }
}

/**
 * Adaptador OCR local 100 % offline con carga diferida bajo demanda (`tesseract.js`)
 * usando worker, core WASM/JS y modelo `spa.traineddata.gz` servidos desde `assets/ocr/`.
 * Propietario único del bloqueo pesado `"ocr"` en `MemoryCoordinator`.
 */
export class TesseractOcrAdapter implements OcrPort {
  constructor(private readonly memoryCoordinator?: MemoryCoordinator) {}

  async extractRawTextBatch(
    images: Array<{
      bytes: Uint8Array;
      mimeType: "image/jpeg" | "image/png" | "image/webp";
    }>
  ): Promise<Array<{ rawText: string; confidence: number }>> {
    if (images.length === 0) {
      return [];
    }

    let tesseractModule: typeof import("tesseract.js");
    try {
      tesseractModule = await import("tesseract.js");
    } catch (err) {
      throw new Error(
        `LAZY_CHUNK_LOAD_ERROR: No se pudo cargar el motor OCR local (${err instanceof Error ? err.message : String(err)})`
      );
    }

    const release = this.memoryCoordinator
      ? await this.memoryCoordinator.acquireHeavyTask("ocr")
      : async () => undefined;

    let worker: Awaited<ReturnType<typeof tesseractModule.createWorker>> | null = null;

    try {
      const createWorkerFn =
        tesseractModule.createWorker ??
        (tesseractModule as unknown as { default?: typeof tesseractModule }).default?.createWorker;

      if (!createWorkerFn) {
        throw new Error("OCR_ENGINE_ERROR: createWorker no disponible en tesseract.js");
      }

      worker = await createWorkerFn("spa", 1, {
        workerPath: resolvePublicAsset("assets/ocr/worker.min.js"),
        corePath: resolvePublicAsset("assets/ocr"),
        langPath: resolvePublicAsset("assets/ocr"),
        cacheMethod: "none",
        workerBlobURL: false,
        gzip: true,
      });

      const results: Array<{ rawText: string; confidence: number }> = [];
      for (const img of images) {
        const imageBlob = await downscaleImageToBlob(img.bytes, img.mimeType, 1600);
        const recognized = await worker.recognize(imageBlob);
        const rawText = recognized.data?.text ?? "";
        const rawConfidence = Number(recognized.data?.confidence ?? 0);
        const confidence = Math.max(0, Math.min(100, Math.round(rawConfidence)));
        results.push({ rawText, confidence });
      }
      return results;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith("LAZY_CHUNK_LOAD_ERROR")) {
        throw err;
      }
      throw new Error(`OCR_ENGINE_ERROR: ${msg}`);
    } finally {
      if (worker) {
        try {
          await worker.terminate();
        } catch {
          // ignore worker termination cleanup error
        }
      }
      await release();
    }
  }

  async extractTicketText(
    imageBuffer: Uint8Array,
    mimeType: "image/jpeg" | "image/png"
  ): Promise<{
    rawText: string;
    parsed: {
      supplierName: string | null;
      supplierNif: string | null;
      issueDateIso: string | null;
      vatRate?: 0 | 4 | 10 | 21 | "mixed";
      baseCents: number | null;
      vatCents: number | null;
      totalCents: number | null;
    };
    confidence: number;
  }> {
    const batch = await this.extractRawTextBatch([{ bytes: imageBuffer, mimeType }]);
    const first = batch[0] ?? { rawText: "", confidence: 0 };
    const parsed = extractTicketFieldsFromText(first.rawText);

    return {
      rawText: first.rawText,
      parsed: {
        supplierName: parsed.supplier_name,
        supplierNif: parsed.supplier_nif,
        issueDateIso: parsed.issue_date_iso,
        vatRate: parsed.vat_rate,
        baseCents: parsed.base_cents,
        vatCents: parsed.vat_cents,
        totalCents: parsed.total_cents,
      },
      confidence: first.confidence,
    };
  }
}
