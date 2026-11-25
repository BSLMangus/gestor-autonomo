import type { OcrPort } from "../../core/ports/mediaPorts";
import { TesseractOcrAdapter } from "../ocr/tesseractOcrAdapter";

export interface QuoteAttachmentFileLike {
  name: string;
  type: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
  text: () => Promise<string>;
}

export interface ExtractedQuoteAttachment {
  name: string;
  mimeType: string;
  extractedText?: string;
  warning?: string;
}

const MAX_ATTACHMENT_PDF_PAGES = 8;
const MIN_EMBEDDED_CHARS_PER_PAGE = 20;
const DEFAULT_MAX_EXTRACTED_CHARS = 1200;

function resolvePublicAsset(relativePath: string): string {
  const base = import.meta.env.BASE_URL ?? "/";
  const cleanBase = base.endsWith("/") ? base : `${base}/`;
  const cleanRel = relativePath.replace(/^\/+/, "");
  return `${cleanBase}${cleanRel}`;
}

/**
 * Normalizes whitespace and trims extracted text to a concise summary
 * suitable for embedding in quote technical notes or attachment metadata.
 */
export function summarizeExtractedText(
  rawText: string,
  maxChars = DEFAULT_MAX_EXTRACTED_CHARS
): string {
  const cleaned = rawText
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .trim();

  if (!cleaned) return "";
  if (maxChars <= 0) return "";
  if (cleaned.length <= maxChars) return cleaned;
  if (maxChars === 1) return cleaned.slice(0, 1);
  return `${cleaned.slice(0, maxChars - 1).trimEnd()}…`;
}

/**
 * Formats an extracted document/certification into a clean block that can be
 * appended to the quote's technical notes textarea.
 */
export function formatAttachmentSummaryForNotes(attachment: {
  name: string;
  extractedText?: string;
}): string {
  const title = attachment.name.trim() || "Documento adjunto";
  const body = attachment.extractedText?.trim();
  if (!body) {
    return `[Anexo: ${title}]`;
  }
  return `[Anexo: ${title}]\n${body}`;
}

function inferImageMimeType(
  fileName: string,
  mimeType: string
): "image/jpeg" | "image/png" | "image/webp" | null {
  const lower = fileName.toLowerCase();
  const mime = mimeType.toLowerCase();
  if (lower.endsWith(".png") || mime === "image/png") return "image/png";
  if (lower.endsWith(".webp") || mime === "image/webp") return "image/webp";
  if (
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    mime === "image/jpeg" ||
    mime === "image/jpg" ||
    mime.startsWith("image/")
  ) {
    return "image/jpeg";
  }
  return null;
}

function isTextFile(fileName: string, mimeType: string): boolean {
  const lower = fileName.toLowerCase();
  const mime = mimeType.toLowerCase();
  return (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    lower.endsWith(".txt") ||
    lower.endsWith(".md") ||
    lower.endsWith(".csv") ||
    lower.endsWith(".tsv") ||
    lower.endsWith(".json")
  );
}

function isPdfFile(fileName: string, mimeType: string): boolean {
  const lower = fileName.toLowerCase();
  const mime = mimeType.toLowerCase();
  return mime === "application/pdf" || lower.endsWith(".pdf");
}

async function extractTextFromPdf(
  file: QuoteAttachmentFileLike,
  ocrPort?: OcrPort
): Promise<{ rawText: string; warning?: string }> {
  let pdfjs: typeof import("pdfjs-dist/legacy/build/pdf.mjs");
  try {
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch (err) {
    return {
      rawText: "",
      warning: `No se pudo cargar el lector PDF local (${err instanceof Error ? err.message : String(err)}).`,
    };
  }

  pdfjs.GlobalWorkerOptions.workerSrc = resolvePublicAsset("assets/pdf/pdf.worker.min.mjs");

  const buffer = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({
    data: buffer,
    isEvalSupported: false,
    cMapUrl: resolvePublicAsset("assets/pdf/cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: resolvePublicAsset("assets/pdf/standard_fonts/"),
    useWorkerFetch: false,
  });

  const pdfDoc = await loadingTask.promise;
  try {
    const pagesToRead = Math.min(pdfDoc.numPages, MAX_ATTACHMENT_PDF_PAGES);
    const warning =
      pdfDoc.numPages > MAX_ATTACHMENT_PDF_PAGES
        ? `«${file.name}» tiene ${pdfDoc.numPages} páginas; se resumieron las primeras ${MAX_ATTACHMENT_PDF_PAGES}.`
        : undefined;

    const pageTexts: string[] = [];
    const scannedImages: Array<{ bytes: Uint8Array; mimeType: "image/jpeg" }> = [];

    for (let pageNo = 1; pageNo <= pagesToRead; pageNo += 1) {
      const page = await pdfDoc.getPage(pageNo);
      try {
        const textContent = await page.getTextContent();
        const rawPageText = textContent.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
          .replace(/\s{2,}/g, "\n")
          .trim();

        const nonWhitespaceLen = rawPageText.replace(/\s+/g, "").length;
        if (nonWhitespaceLen >= MIN_EMBEDDED_CHARS_PER_PAGE) {
          pageTexts.push(rawPageText);
        } else if (typeof document !== "undefined") {
          const baseViewport = page.getViewport({ scale: 1 });
          const maxSide = Math.max(baseViewport.width, baseViewport.height, 1);
          const scale = Math.min(2, 1600 / maxSide);
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(viewport.width));
          canvas.height = Math.max(1, Math.round(viewport.height));
          const ctx = canvas.getContext("2d");
          if (ctx) {
            await page.render({ canvasContext: ctx, viewport }).promise;
            const blob = await new Promise<Blob | null>((resolve) =>
              canvas.toBlob(resolve, "image/jpeg", 0.88)
            );
            canvas.width = 0;
            canvas.height = 0;
            if (blob) {
              scannedImages.push({
                bytes: new Uint8Array(await blob.arrayBuffer()),
                mimeType: "image/jpeg",
              });
            }
          }
        }
      } finally {
        page.cleanup();
      }
    }

    if (scannedImages.length > 0) {
      const activeOcr = ocrPort ?? new TesseractOcrAdapter();
      try {
        const ocrResults = await activeOcr.extractRawTextBatch(scannedImages);
        for (const r of ocrResults) {
          if (r.rawText.trim()) {
            pageTexts.push(r.rawText.trim());
          }
        }
      } catch {
        // Ignore OCR failure on scanned PDF fallback; keep any embedded text found
      }
    }

    return {
      rawText: pageTexts.join("\n"),
      warning,
    };
  } finally {
    await pdfDoc.destroy();
  }
}

/**
 * Extracts text/summary from a user-selected document or certification file
 * (TXT/CSV/MD, PDF, or JPG/PNG/WEBP image) for attachment to a quote.
 */
export async function extractQuoteAttachment(
  file: QuoteAttachmentFileLike,
  options?: {
    ocrPort?: OcrPort;
    maxChars?: number;
  }
): Promise<ExtractedQuoteAttachment> {
  const maxChars = options?.maxChars ?? DEFAULT_MAX_EXTRACTED_CHARS;
  const name = file.name.trim() || "documento";
  const fallbackMime = file.type.trim() || "application/octet-stream";

  if (isTextFile(name, fallbackMime)) {
    const raw = await file.text();
    const summary = summarizeExtractedText(raw, maxChars);
    return {
      name,
      mimeType: file.type.trim() || "text/plain",
      extractedText: summary || undefined,
    };
  }

  if (isPdfFile(name, fallbackMime)) {
    const pdfRes = await extractTextFromPdf(file, options?.ocrPort);
    const summary = summarizeExtractedText(pdfRes.rawText, maxChars);
    return {
      name,
      mimeType: "application/pdf",
      extractedText: summary || undefined,
      warning:
        pdfRes.warning ??
        (!summary
          ? `No se detectó texto legible en «${name}»; se conservará como referencia adjunta.`
          : undefined),
    };
  }

  const imageMime = inferImageMimeType(name, fallbackMime);
  if (imageMime) {
    const activeOcr = options?.ocrPort ?? new TesseractOcrAdapter();
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const batch = await activeOcr.extractRawTextBatch([{ bytes, mimeType: imageMime }]);
      const raw = batch[0]?.rawText ?? "";
      const summary = summarizeExtractedText(raw, maxChars);
      return {
        name,
        mimeType: imageMime,
        extractedText: summary || undefined,
        warning: !summary
          ? `No se detectó texto legible en «${name}»; se conservará como referencia adjunta.`
          : undefined,
      };
    } catch (err) {
      return {
        name,
        mimeType: imageMime,
        warning: `No se pudo leer el texto de «${name}» (${err instanceof Error ? err.message : String(err)}); se adjuntó como referencia.`,
      };
    }
  }

  return {
    name,
    mimeType: fallbackMime,
    warning: `Formato no extraíble automáticamente; «${name}» se adjuntó como referencia.`,
  };
}
