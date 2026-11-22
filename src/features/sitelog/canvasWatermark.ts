import type { WatermarkPort } from "../../core/ports/mediaPorts";

/**
 * Estampa en Canvas HTML5 una banda inferior con `GESTOR AUTÓNOMO · Obra · Cliente · Fecha/Hora`
 * y comprime la fotografía en JPEG <= 1600px sin librerías externas.
 */
export class CanvasWatermarkAdapter implements WatermarkPort {
  async compressAndStamp(params: {
    imageBytes: Uint8Array;
    mimeType: "image/jpeg" | "image/png";
    stamp: { jobCode: string; clientName: string; timestampIso: string };
  }): Promise<{ jpegBytes: Uint8Array; mimeType: "image/jpeg" }> {
    const rawBlob = new Blob([params.imageBytes.slice().buffer], { type: params.mimeType });
    const stampText = `GESTOR AUTÓNOMO · ${params.stamp.jobCode} · ${params.stamp.clientName} · ${params.stamp.timestampIso}`;

    if (typeof createImageBitmap !== "function") {
      return { jpegBytes: params.imageBytes, mimeType: "image/jpeg" };
    }

    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(rawBlob);
      const maxDim = 1600;
      const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height, 1));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const barHeight = Math.max(28, Math.round(height * 0.075));

      const drawWatermark = (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => {
        ctx.drawImage(bitmap!, 0, 0, width, height);
        ctx.fillStyle = "rgba(15, 23, 42, 0.78)";
        ctx.fillRect(0, height - barHeight, width, barHeight);
        const fontSize = Math.max(12, Math.round(barHeight * 0.48));
        ctx.font = `bold ${fontSize}px system-ui, -apple-system, sans-serif`;
        ctx.fillStyle = "#f8fafc";
        ctx.textBaseline = "middle";
        ctx.fillText(stampText, 12, height - barHeight / 2, Math.max(40, width - 24));
      };

      if (typeof OffscreenCanvas !== "undefined") {
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext("2d");
        if (ctx) {
          drawWatermark(ctx);
          const outBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.84 });
          return {
            jpegBytes: new Uint8Array(await outBlob.arrayBuffer()),
            mimeType: "image/jpeg",
          };
        }
      }

      if (typeof document !== "undefined") {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          drawWatermark(ctx);
          const outBlob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, "image/jpeg", 0.84)
          );
          if (outBlob) {
            return {
              jpegBytes: new Uint8Array(await outBlob.arrayBuffer()),
              mimeType: "image/jpeg",
            };
          }
        }
      }

      return { jpegBytes: params.imageBytes, mimeType: "image/jpeg" };
    } finally {
      bitmap?.close();
    }
  }
}
