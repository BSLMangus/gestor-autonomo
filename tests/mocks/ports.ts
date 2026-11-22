import type {
  OcrPort,
  PdfBuildInput,
  PdfPort,
  WatermarkPort,
} from "../../src/core/ports/mediaPorts";
import type { SeedGraphFreezerPort } from "../../src/core/ports/seedFreezerPort";

export class MockOcrPort implements OcrPort {
  public callCount = 0;
  public shouldFailWith: Error | null = null;
  public nextResponse: Awaited<ReturnType<OcrPort["extractTicketText"]>> = {
    rawText:
      "FERRETERIA OBRAMAT SL\nNIF B85296341\nFECHA 16/11/2026\nBASE 100,00\nIVA 21%: 21,00\nTOTAL 121,00 EUR",
    parsed: {
      supplierName: "Obramat Mock",
      supplierNif: "B85296341",
      issueDateIso: "2026-11-16",
      vatRate: 21,
      baseCents: 10000,
      vatCents: 2100,
      totalCents: 12100,
    },
    confidence: 92,
  };

  async extractTicketText(): Promise<Awaited<ReturnType<OcrPort["extractTicketText"]>>> {
    this.callCount += 1;
    if (this.shouldFailWith) {
      throw this.shouldFailWith;
    }
    return this.nextResponse;
  }

  async extractRawTextBatch(
    images: Array<{ bytes: Uint8Array; mimeType: "image/jpeg" | "image/png" | "image/webp" }>
  ): Promise<Array<{ rawText: string; confidence: number }>> {
    this.callCount += 1;
    if (this.shouldFailWith) {
      throw this.shouldFailWith;
    }
    return images.map(() => ({
      rawText: this.nextResponse.rawText,
      confidence: this.nextResponse.confidence,
    }));
  }
}

export class MockPdfPort implements PdfPort {
  public callCount = 0;
  public shouldFailWith: Error | null = null;
  public lastInput: PdfBuildInput | null = null;

  async buildDocumentPdf(input: PdfBuildInput): Promise<{ pdfBytes: Uint8Array; fileName: string }> {
    this.callCount += 1;
    this.lastInput = input;
    if (this.shouldFailWith) {
      throw this.shouldFailWith;
    }
    const label = input.kind === "quote" ? input.quoteCode : input.invoiceNumber;
    const pdfBytes = new TextEncoder().encode(`%PDF-1.4\n%MOCK ${label}\n%%EOF`);
    return {
      pdfBytes,
      fileName: `${label}.pdf`,
    };
  }
}

export class MockWatermarkPort implements WatermarkPort {
  public callCount = 0;

  async compressAndStamp(params: {
    imageBytes: Uint8Array;
    mimeType: "image/jpeg" | "image/png";
    stamp: { jobCode: string; clientName: string; timestampIso: string };
  }): Promise<{ jpegBytes: Uint8Array; mimeType: "image/jpeg" }> {
    this.callCount += 1;
    return {
      jpegBytes: new Uint8Array(params.imageBytes),
      mimeType: "image/jpeg",
    };
  }
}

export class MockFreezerPort implements SeedGraphFreezerPort {
  public called = false;
  public callCount = 0;

  async freezeDemoGates(): Promise<void> {
    this.called = true;
    this.callCount += 1;
  }
}
