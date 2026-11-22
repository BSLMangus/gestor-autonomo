import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import type { LocalFileBridge } from "../contracts/types";
import type { PdfPort } from "../ports/mediaPorts";
import type { InvoicesRepository } from "../db/repositories/invoicesRepo";
import type { QuotesRepository } from "../db/repositories/quotesRepo";

export class DocumentOpenerService {
  constructor(
    private readonly fileBridge: LocalFileBridge,
    private readonly quotesRepo: QuotesRepository,
    private readonly invoicesRepo: InvoicesRepository
  ) {}

  /**
   * Abre o descarga un PDF local regenerándolo bajo demanda vía PdfPort si falta.
   * Jamás modifica sent_at_iso.
   */
  async openPdf(
    pdfUri: string | null,
    docKind: "quote" | "invoice",
    docId: string,
    pdfPort: PdfPort
  ): Promise<string> {
    const defaultName =
      docKind === "quote" ? `presupuesto_${docId}.pdf` : `factura_${docId}.pdf`;
    let resolvedUri = pdfUri;
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

    let targetFile: File;
    if (!resolvedUri || !file) {
      resolvedUri =
        docKind === "quote"
          ? await this.quotesRepo.regeneratePdfOnDemand(docId, pdfPort, this.fileBridge)
          : await this.invoicesRepo.regeneratePdfOnDemand(docId, pdfPort, this.fileBridge);
      targetFile = await this.fileBridge.readAsFile(
        resolvedUri,
        resolveFileName(resolvedUri),
        "application/pdf"
      );
    } else {
      targetFile = new File([file], resolveFileName(resolvedUri), { type: "application/pdf" });
    }

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
