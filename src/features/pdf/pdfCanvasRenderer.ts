import type { MemoryCoordinator } from "../../core/contracts/types";

export const PDF_RENDERER_MAX_DPR = 2.5;
export const PDF_RENDERER_MAX_PIXELS = 4_000_000;

export function resolvePublicAsset(relativePath: string): string {
  const base = import.meta.env.BASE_URL ?? "/";
  const cleanBase = base.endsWith("/") ? base : `${base}/`;
  const cleanRel = relativePath.replace(/^\/+/, "");
  return `${cleanBase}${cleanRel}`;
}

export function computeSafeCanvasRenderDimensions(
  cssWidth: number,
  cssHeight: number,
  requestedDpr?: number,
  maxPixels = PDF_RENDERER_MAX_PIXELS
): {
  pixelWidth: number;
  pixelHeight: number;
  effectiveScale: number;
} {
  const safeCssW = Math.max(1, cssWidth);
  const safeCssH = Math.max(1, cssHeight);
  const rawDpr =
    requestedDpr ??
    (typeof window !== "undefined" && Number.isFinite(window.devicePixelRatio)
      ? window.devicePixelRatio
      : 1);
  const clampedDpr = Math.max(1, Math.min(rawDpr || 1, PDF_RENDERER_MAX_DPR));

  const rawPixels = safeCssW * clampedDpr * (safeCssH * clampedDpr);
  const effectiveScale =
    rawPixels > maxPixels && rawPixels > 0
      ? clampedDpr * Math.sqrt(maxPixels / rawPixels)
      : clampedDpr;

  return {
    pixelWidth: Math.max(1, Math.floor(safeCssW * effectiveScale)),
    pixelHeight: Math.max(1, Math.floor(safeCssH * effectiveScale)),
    effectiveScale,
  };
}

export function zeroOutCanvas(canvas: HTMLCanvasElement | null | undefined): void {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (ctx && canvas.width > 0 && canvas.height > 0) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  canvas.width = 0;
  canvas.height = 0;
}

export interface PdfPageBaseSize {
  pageNumber: number;
  width: number;
  height: number;
}

export interface PdfCanvasSession {
  readonly numPages: number;
  getPageBaseSize(pageNumber: number): Promise<PdfPageBaseSize>;
  renderPageToCanvas(params: {
    pageNumber: number;
    canvas: HTMLCanvasElement;
    targetWidthPx: number;
    signal?: AbortSignal;
  }): Promise<{ cssWidth: number; cssHeight: number }>;
  destroy(): Promise<void>;
}

async function runWithPdfCoordinator<T>(
  memoryCoordinator: MemoryCoordinator | undefined,
  fn: () => Promise<T>
): Promise<T> {
  const release = memoryCoordinator
    ? await memoryCoordinator.acquireHeavyTask("pdf")
    : async () => undefined;
  try {
    return await fn();
  } finally {
    await release();
  }
}

export async function openPdfCanvasDocument(
  pdfBytes: Uint8Array,
  memoryCoordinator?: MemoryCoordinator
): Promise<PdfCanvasSession> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = resolvePublicAsset("assets/pdf/pdf.worker.min.mjs");

  // Always slice bytes so pdf.js worker transfer never detaches caller's Uint8Array
  const clonedBytes = pdfBytes.slice();

  const loadingTask = pdfjs.getDocument({
    data: clonedBytes,
    isEvalSupported: false,
    cMapUrl: resolvePublicAsset("assets/pdf/cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: resolvePublicAsset("assets/pdf/standard_fonts/"),
    useWorkerFetch: false,
  });

  const pdfDoc = await runWithPdfCoordinator(memoryCoordinator, async () => loadingTask.promise);
  let destroyed = false;

  return {
    numPages: pdfDoc.numPages,

    async getPageBaseSize(pageNumber: number): Promise<PdfPageBaseSize> {
      if (destroyed) {
        throw new Error("PDF_RENDER_DISPOSED: Sesión de renderizado PDF cerrada");
      }
      const page = await pdfDoc.getPage(pageNumber);
      try {
        const viewport = page.getViewport({ scale: 1 });
        return {
          pageNumber,
          width: viewport.width,
          height: viewport.height,
        };
      } finally {
        page.cleanup();
      }
    },

    async renderPageToCanvas({
      pageNumber,
      canvas,
      targetWidthPx,
      signal,
    }): Promise<{ cssWidth: number; cssHeight: number }> {
      if (destroyed || signal?.aborted) {
        return { cssWidth: targetWidthPx, cssHeight: Math.round(targetWidthPx * 1.414) };
      }

      return runWithPdfCoordinator(memoryCoordinator, async () => {
        if (destroyed || signal?.aborted) {
          return { cssWidth: targetWidthPx, cssHeight: Math.round(targetWidthPx * 1.414) };
        }

        const page = await pdfDoc.getPage(pageNumber);
        try {
          const baseViewport = page.getViewport({ scale: 1 });
          const safeTargetWidth = Math.max(120, targetWidthPx);
          const cssScale = safeTargetWidth / Math.max(1, baseViewport.width);
          const viewport = page.getViewport({ scale: cssScale });

          const { pixelWidth, pixelHeight, effectiveScale } = computeSafeCanvasRenderDimensions(
            viewport.width,
            viewport.height
          );

          if (signal?.aborted || destroyed) {
            return { cssWidth: viewport.width, cssHeight: viewport.height };
          }

          canvas.width = pixelWidth;
          canvas.height = pixelHeight;

          const ctx = canvas.getContext("2d", { alpha: false });
          if (!ctx) {
            throw new Error("PDF_RENDER_ERROR: Contexto 2D de canvas no disponible");
          }

          ctx.fillStyle = "#FFFFFF";
          ctx.fillRect(0, 0, pixelWidth, pixelHeight);

          const renderTask = page.render({
            canvasContext: ctx,
            viewport,
            ...(effectiveScale !== 1
              ? { transform: [effectiveScale, 0, 0, effectiveScale, 0, 0] }
              : {}),
          });

          const onAbort = () => {
            renderTask.cancel();
          };
          signal?.addEventListener("abort", onAbort, { once: true });

          try {
            await renderTask.promise;
          } catch (err) {
            const isCancelled =
              signal?.aborted ||
              (err instanceof Error &&
                (err.name === "RenderingCancelledException" ||
                  err.message.toLowerCase().includes("cancel")));
            if (!isCancelled) {
              throw err;
            }
          } finally {
            signal?.removeEventListener("abort", onAbort);
          }

          return {
            cssWidth: viewport.width,
            cssHeight: viewport.height,
          };
        } finally {
          page.cleanup();
        }
      });
    },

    async destroy(): Promise<void> {
      if (destroyed) return;
      destroyed = true;
      await Promise.allSettled([loadingTask.destroy(), pdfDoc.destroy()]);
    },
  };
}
