import type { LocalFileBridge } from "../../core/contracts/types";

const MAX_PDF_PHOTO_WIDTH = 800;
const MAX_PDF_PHOTO_HEIGHT = 600;

function uint8ToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    parts.push(String.fromCharCode(...slice));
  }
  return btoa(parts.join(""));
}

/**
 * Lee una foto almacenada en LocalFileBridge y la redimensiona a un Data URL ligero
 * para incrustarla en el PDF A4 sin saturar la memoria del WebView.
 */
export async function readActaPhotoAsPdfDataUrl(
  fileBridge: LocalFileBridge,
  uri: string
): Promise<string | null> {
  try {
    const isPng = uri.toLowerCase().endsWith(".png");
    const mime = isPng ? "image/png" : "image/jpeg";
    const file = await fileBridge.readAsFile(uri, isPng ? "foto.png" : "foto.jpg", mime);

    if (
      typeof document !== "undefined" &&
      typeof URL !== "undefined" &&
      typeof URL.createObjectURL === "function"
    ) {
      const objectUrl = URL.createObjectURL(file);
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error("No se pudo decodificar la imagen del acta."));
          image.src = objectUrl;
        });
        const srcW = Math.max(1, img.naturalWidth || img.width);
        const srcH = Math.max(1, img.naturalHeight || img.height);
        const scale = Math.min(1, MAX_PDF_PHOTO_WIDTH / srcW, MAX_PDF_PHOTO_HEIGHT / srcH);
        const targetW = Math.max(1, Math.round(srcW * scale));
        const targetH = Math.max(1, Math.round(srcH * scale));

        const canvas = document.createElement("canvas");
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, targetW, targetH);
          return canvas.toDataURL("image/jpeg", 0.78);
        }
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    return `data:${mime};base64,${uint8ToBase64(bytes)}`;
  } catch {
    return null;
  }
}
