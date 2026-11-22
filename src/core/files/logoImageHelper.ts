const ALLOWED_LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_LOGO_WIDTH = 360;
const MAX_LOGO_HEIGHT = 160;
const MAX_DATA_URL_LENGTH = 440_000;

/**
 * Redimensiona localmente un archivo de logotipo en <canvas> a un Data URL ligero
 * compatible con SQLite y pdfMake (sin red externa).
 */
export async function resizeLogoFileToDataUrl(file: File): Promise<string> {
  if (!ALLOWED_LOGO_TYPES.has(file.type)) {
    throw new Error("Formato de logotipo no válido. Usa una imagen PNG, JPG o WebP.");
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("No se pudo leer la imagen seleccionada."));
      image.src = objectUrl;
    });

    const srcW = Math.max(1, img.naturalWidth || img.width);
    const srcH = Math.max(1, img.naturalHeight || img.height);
    const scale = Math.min(1, MAX_LOGO_WIDTH / srcW, MAX_LOGO_HEIGHT / srcH);
    const targetW = Math.max(1, Math.round(srcW * scale));
    const targetH = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("No se pudo inicializar el lienzo local para procesar el logotipo.");
    }
    ctx.clearRect(0, 0, targetW, targetH);
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const pngUrl = canvas.toDataURL("image/png");
    if (pngUrl.length <= MAX_DATA_URL_LENGTH) {
      return pngUrl;
    }

    const jpegUrl = canvas.toDataURL("image/jpeg", 0.85);
    if (jpegUrl.length <= MAX_DATA_URL_LENGTH) {
      return jpegUrl;
    }
    throw new Error("El logotipo es demasiado grande incluso tras redimensionarlo. Prueba con otra imagen.");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
