import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import type { LocalFileBridge } from "../contracts/types";
import type { PdfPort } from "../ports/mediaPorts";
import type { ActasRepository } from "../db/repositories/actasRepo";
import type { InvoicesRepository } from "../db/repositories/invoicesRepo";
import type { QuotesRepository } from "../db/repositories/quotesRepo";

export class DocumentOpenerService {
  constructor(
    private readonly fileBridge: LocalFileBridge,
    private readonly quotesRepo: QuotesRepository,
    private readonly invoicesRepo: InvoicesRepository,
    private readonly actasRepo?: ActasRepository
  ) {}

  private async resolvePdfFile(
    pdfUri: string | null,
    docKind: "quote" | "invoice" | "acta",
    docId: string,
    pdfPort: PdfPort,
    options?: { forceRegenerate?: boolean }
  ): Promise<{ resolvedUri: string; targetFile: File }> {
    const defaultName =
      docKind === "quote"
        ? `presupuesto_${docId}.pdf`
        : docKind === "invoice"
          ? `factura_${docId}.pdf`
          : `acta_${docId}.pdf`;
    let resolvedUri = options?.forceRegenerate ? null : pdfUri;
    let file: File | null = null;

    if (resolvedUri) {
      try {
        file = await this.fileBridge.readAsFile(resolvedUri, defaultName, "application/pdf");
      } catch {
        file = null;
      }
    }

    const resolveFileName = (uri: string | null): string => {
      const lastSegment = uri?.split("/").pop()?.trim() ?? "";
      return lastSegment.toLowerCase().endsWith(".pdf") ? lastSegment : defaultName;
    };

    if (!resolvedUri || !file) {
      if (docKind === "quote") {
        resolvedUri = await this.quotesRepo.regeneratePdfOnDemand(docId, pdfPort, this.fileBridge);
      } else if (docKind === "invoice") {
        resolvedUri = await this.invoicesRepo.regeneratePdfOnDemand(
          docId,
          pdfPort,
          this.fileBridge
        );
      } else {
        if (!this.actasRepo) {
          throw new Error("PDF_BUILD_ERROR: ActasRepository no configurado en DocumentOpenerService");
        }
        resolvedUri = await this.actasRepo.regeneratePdfOnDemand(docId, pdfPort, this.fileBridge);
      }
      const targetFile = await this.fileBridge.readAsFile(
        resolvedUri,
        resolveFileName(resolvedUri),
        "application/pdf"
      );
      return { resolvedUri, targetFile };
    }

    const targetFile = new File([file], resolveFileName(resolvedUri), { type: "application/pdf" });
    return { resolvedUri, targetFile };
  }

  /**
   * Resuelve los bytes de un PDF local regenerándolo bajo demanda vía PdfPort si falta.
   * Jamás modifica sent_at_iso.
   */
  async resolvePdfBytes(
    pdfUri: string | null,
    docKind: "quote" | "invoice" | "acta",
    docId: string,
    pdfPort: PdfPort,
    options?: { forceRegenerate?: boolean }
  ): Promise<{ pdfBytes: Uint8Array; fileName: string }> {
    const { targetFile } = await this.resolvePdfFile(pdfUri, docKind, docId, pdfPort, options);
    const buffer = await targetFile.arrayBuffer();
    return {
      pdfBytes: new Uint8Array(buffer),
      fileName: targetFile.name,
    };
  }

  /**
   * Comparte o descarga bytes PDF directamente desde memoria.
   */
  async shareRawPdfBytes(pdfBytes: Uint8Array, fileName: string, title?: string): Promise<void> {
    const safeName = fileName.toLowerCase().endsWith(".pdf") ? fileName : `${fileName}.pdf`;
    if (Capacitor.isNativePlatform()) {
      const savedUri = await this.fileBridge.savePdf(pdfBytes, safeName);
      const shareUri = await this.fileBridge.toShareableNativeUri(savedUri);
      await Share.share({
        title: title ?? safeName,
        files: [shareUri],
      });
      return;
    }

    const pdfFile = new File([new Uint8Array(pdfBytes)], safeName, { type: "application/pdf" });
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function" &&
      typeof navigator.canShare === "function" &&
      navigator.canShare({ files: [pdfFile] })
    ) {
      try {
        await navigator.share({
          title: title ?? safeName,
          files: [pdfFile],
        });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
      }
    }

    if (typeof document !== "undefined" && typeof URL.createObjectURL === "function") {
      const url = URL.createObjectURL(pdfFile);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = safeName;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
  }

  /**
   * Abre o descarga un PDF local regenerándolo bajo demanda vía PdfPort si falta.
   * Jamás modifica sent_at_iso.
   */
  async openPdf(
    pdfUri: string | null,
    docKind: "quote" | "invoice" | "acta",
    docId: string,
    pdfPort: PdfPort,
    options?: { forceRegenerate?: boolean }
  ): Promise<string> {
    const { resolvedUri, targetFile } = await this.resolvePdfFile(
      pdfUri,
      docKind,
      docId,
      pdfPort,
      options
    );

    if (Capacitor.isNativePlatform()) {
      const shareUri = await this.fileBridge.toShareableNativeUri(resolvedUri);
      await Share.share({
        title: targetFile.name,
        files: [shareUri],
      });
      return resolvedUri;
    }

    if (typeof document !== "undefined" && typeof URL.createObjectURL === "function") {
      const url = URL.createObjectURL(targetFile);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = targetFile.name;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }

    return resolvedUri;
  }
}
