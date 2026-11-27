import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GraphRunner } from "../src/agent/graphRunner";
import { LocalInferenceAdapterImpl } from "../src/agent/inference/localInferenceAdapter";
import { ResetService } from "../src/core/backup/resetService";
import { Gate1QuoteCommitPayloadSchema } from "../src/core/contracts/schemas";
import { NodeBetterSqliteExecutor } from "../src/core/db/nodeSqliteExecutor";
import { ActasRepository } from "../src/core/db/repositories/actasRepo";
import { InvoicesRepository } from "../src/core/db/repositories/invoicesRepo";
import { QuotesRepository } from "../src/core/db/repositories/quotesRepo";
import { TracesRepository } from "../src/core/db/repositories/tracesRepo";
import { initializeSchema } from "../src/core/db/sqliteExecutor";
import { DocumentOpenerService } from "../src/core/files/documentOpener";
import { MemoryFileBridge } from "../src/core/files/memoryFileBridge";
import { MemoryCoordinatorNoop } from "../src/core/memory/memoryCoordinator";
import { BACK_PRIORITY } from "../src/core/navigation/routes";
import type {
  PdfActaDocumentInput,
  PdfInvoiceDocumentInput,
  PdfQuoteDocumentInput,
} from "../src/core/ports/mediaPorts";
import {
  PDF_RENDERER_MAX_DPR,
  PDF_RENDERER_MAX_PIXELS,
  computeSafeCanvasRenderDimensions,
  resolvePublicAsset,
  zeroOutCanvas,
} from "../src/features/pdf/pdfCanvasRenderer";
import { PdfMakeAdapter } from "../src/features/pdf/pdfMakeAdapter";
import { MockFreezerPort, MockOcrPort } from "./mocks/ports";

function assertPdfBytes(bytes: Uint8Array): void {
  expect(bytes).toBeInstanceOf(Uint8Array);
  expect(bytes.byteLength).toBeGreaterThan(500);
  expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
}

describe("Vista previa de documentos, duplicación y generación PDF offline", () => {
  let executor: NodeBetterSqliteExecutor;
  let fileBridge: MemoryFileBridge;
  let pdfAdapter: PdfMakeAdapter;
  let quotesRepo: QuotesRepository;
  let invoicesRepo: InvoicesRepository;
  let actasRepo: ActasRepository;
  let docOpener: DocumentOpenerService;
  let runner: GraphRunner;

  beforeEach(async () => {
    executor = new NodeBetterSqliteExecutor(":memory:");
    await initializeSchema(executor);
    fileBridge = new MemoryFileBridge();
    pdfAdapter = new PdfMakeAdapter();
    quotesRepo = new QuotesRepository(executor);
    invoicesRepo = new InvoicesRepository(executor);
    actasRepo = new ActasRepository(executor);
    docOpener = new DocumentOpenerService(fileBridge, quotesRepo, invoicesRepo, actasRepo);

    await new ResetService(executor).restoreDemoData(new MockFreezerPort());

    runner = new GraphRunner(
      {
        executor,
        fileBridge,
        memoryCoordinator: new MemoryCoordinatorNoop(),
        inference: new LocalInferenceAdapterImpl(),
        ocrPort: new MockOcrPort(),
        pdfPort: pdfAdapter,
        traceRecorder: new TracesRepository(executor),
      },
      "memory"
    );
  });

  afterEach(async () => {
    await executor.close();
  });

  it("QuotesRepository.getDuplicateDraftData restaura datos limpios como nuevo borrador y resetea quote_id/job_id", async () => {
    const thr = await runner.createThread({ title: "Presupuesto para duplicar" });
    const turn = await runner.runTurn(thr.thread_id, {
      client_turn_id: "t_dup_1",
      text: "Presupuesto: 2 enchufes a 45 euros",
      action_type: "free_text_or_voice",
    });

    if (turn.active_interrupt?.gate_id !== "gate_1_quote") {
      throw new Error("Expected gate_1_quote");
    }

    const edited = Gate1QuoteCommitPayloadSchema.parse({
      ...turn.active_interrupt.proposed_payload,
      client_id: null,
      new_client: {
        name: "Lucía Navarro",
        nif: "44556677L",
        fiscal_address: "C/ Velázquez 18, Madrid",
        phone: "+34 611 222 333",
      },
      job_title: "Instalación salón",
      general_description: "Adecuación tomas de corriente y alumbrado",
      modalidad_cobro: "partidas_mas_horas",
      solo_mano_obra_submodo: "por_horas",
      horas_estimadas_thousandths: 4000,
      tarifa_hora_cents: 4200,
      mano_obra_fija_cents: 0,
      notes: "Material incluido según normativa.",
      lines: [
        {
          catalog_item_id: null,
          description: "Base de enchufe schuko 16A - 45,00 €",
          category: "Electricidad",
          unit: "ud",
          quantity_thousandths: 2000,
          unit_price_cents: 4500,
          original_unit_price_cents: 4500,
          save_to_catalog: false,
        },
      ],
    });

    const saved = await runner.resumeGate(thr.thread_id, {
      gate_id: "gate_1_quote",
      action: "edit",
      edited_payload: edited,
      client_validated_at_ms: Date.now(),
    });
    const sourceQuoteId = saved.active_quote_id!;
    expect(sourceQuoteId).toBeTruthy();

    const dupDraft = await quotesRepo.getDuplicateDraftData(sourceQuoteId);
    expect(dupDraft.quote_id).toBeNull();
    expect(dupDraft.job_id).toBeNull();
    expect(dupDraft.job_title).toBe("Instalación salón");
    expect(dupDraft.general_description).toBe("Adecuación tomas de corriente y alumbrado");
    expect(dupDraft.modalidad_cobro).toBe("partidas_mas_horas");
    expect(dupDraft.horas_estimadas_thousandths).toBe(4000);
    expect(dupDraft.tarifa_hora_cents).toBe(4200);
    expect(dupDraft.notes).toBe("Material incluido según normativa.");
    expect(dupDraft.lines).toHaveLength(1);
    expect(dupDraft.lines[0]!.description).toBe("Base de enchufe schuko 16A");
    expect(dupDraft.lines[0]!.unit_price_cents).toBe(4500);
  });

  it("ActasRepository.duplicateAsDraft crea un borrador nuevo sin firma de cliente ni pdf_uri conservando datos técnicos", async () => {
    const created = await actasRepo.createDraftFromContext({
      especialidad: "electricidad",
      tipoActuacion: "reforma_integral",
      fechaEmisionIso: "2026-05-01",
    });

    const signed = await actasRepo.markSigned(created.row.id, {
      data: {
        ...created.data,
        alcance_ubicacion: "Cuadro principal vivienda 4ºA",
        instrucciones_mantenimiento: "Revisar diferencial mensualmente.",
      },
      firmaClienteBase64: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
      firmaInstaladorBase64: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
      pdfUri: "mem://actas/old.pdf",
    });

    const duplicated = await actasRepo.duplicateAsDraft(signed.row.id);
    expect(duplicated.id).not.toBe(signed.row.id);
    expect(duplicated.codigo_acta).not.toBe(signed.row.codigo_acta);
    expect(duplicated.codigo_acta).toMatch(/^ACT-\d{4}-\d+$/);
    expect(duplicated.estado).toBe("borrador");
    expect(duplicated.firma_cliente_base64).toBeNull();
    expect(duplicated.pdf_uri).toBeNull();
    expect(duplicated.firma_instalador_base64).toBe(signed.row.firma_instalador_base64);

    const loadedDup = await actasRepo.getById(duplicated.id);
    expect(loadedDup).not.toBeNull();
    expect(loadedDup!.data.codigo_acta).toBe(duplicated.codigo_acta);
    expect(loadedDup!.data.alcance_ubicacion).toBe("Cuadro principal vivienda 4ºA");
    expect(loadedDup!.data.instrucciones_mantenimiento).toBe(
      "Revisar diferencial mensualmente."
    );
  });

  it("DocumentOpenerService.resolvePdfBytes regenera PDFs bajo demanda sin alterar sent_at_iso y shareRawPdfBytes no falla", async () => {
    // 1. Presupuesto (borrando pdf_uri para forzar regeneración bajo demanda)
    const quotesList = await quotesRepo.listPaginated({ limit: 10 });
    const quote = quotesList.items[0]!;
    await executor.run(`UPDATE quotes SET pdf_uri = NULL WHERE id = ?`, [quote.id]);

    const quoteBefore = await quotesRepo.getById(quote.id);
    const quoteResolved = await docOpener.resolvePdfBytes(null, "quote", quote.id, pdfAdapter);
    expect(quoteResolved.fileName).toBe(`${quote.quote_code}.pdf`);
    assertPdfBytes(quoteResolved.pdfBytes);
    const quoteAfter = await quotesRepo.getById(quote.id);
    expect(quoteAfter?.sent_at_iso).toBe(quoteBefore?.sent_at_iso ?? null);
    expect(quoteAfter?.pdf_uri).toBeTruthy();

    // 2. Factura
    const invoicesList = await invoicesRepo.listAll();
    if (invoicesList.length > 0) {
      const invoice = invoicesList[0]!;
      await executor.run(`UPDATE invoices SET pdf_uri = NULL WHERE id = ?`, [invoice.id]);
      const invBefore = await invoicesRepo.getById(invoice.id);
      const invResolved = await docOpener.resolvePdfBytes(null, "invoice", invoice.id, pdfAdapter);
      expect(invResolved.fileName).toBe(`${invoice.invoice_number}.pdf`);
      assertPdfBytes(invResolved.pdfBytes);
      const invAfter = await invoicesRepo.getById(invoice.id);
      expect(invAfter?.sent_at_iso).toBe(invBefore?.sent_at_iso ?? null);
    }

    // 3. Acta
    const createdActa = await actasRepo.createDraftFromContext({
      especialidad: "fontaneria",
      fechaEmisionIso: "2026-05-20",
    });
    const actaResolved = await docOpener.resolvePdfBytes(
      null,
      "acta",
      createdActa.row.id,
      pdfAdapter
    );
    expect(actaResolved.fileName).toBe(`${createdActa.row.codigo_acta}.pdf`);
    assertPdfBytes(actaResolved.pdfBytes);

    // 4. shareRawPdfBytes en entorno no-nativo (node/web fallback)
    await expect(
      docOpener.shareRawPdfBytes(quoteResolved.pdfBytes, quoteResolved.fileName, quote.quote_code)
    ).resolves.toBeUndefined();
  });

  it("PdfMakeAdapter genera buffers PDF válidos para presupuestos (todas modalidades), facturas y actas", async () => {
    const baseQuote: PdfQuoteDocumentInput = {
      kind: "quote",
      quoteCode: "PRE-2026-0777",
      issuedDateIso: "2026-06-01",
      validityDays: 30,
      emitter: {
        name: "Instalaciones Soler S.L.",
        nif: "B12345678",
        fiscalAddress: "C/ Mayor 12, Madrid",
        phone: "600111222",
      },
      client: {
        name: "Carlos Gómez",
        nif: "12345678Z",
        fiscalAddress: "Av. Libertad 5, Madrid",
        phone: "611222333",
      },
      jobTitle: "Reforma integral",
      vatRate: 21,
      subtotalCents: 100_000,
      vatCents: 21_000,
      totalCents: 121_000,
      notes: "",
      lines: [
        {
          description: "Instalación cuadro 18 módulos por 500 €",
          unit: "ud",
          quantityThousandths: 1000,
          unitPriceCents: 50_000,
          lineSubtotalCents: 50_000,
        },
      ],
    };

    for (const variant of [
      baseQuote,
      {
        ...baseQuote,
        billingMode: "partidas_mas_horas" as const,
        laborHoursThousandths: 5000,
        hourlyRateCents: 4000,
        laborCents: 20_000,
      },
      {
        ...baseQuote,
        billingMode: "partidas_mas_fijo_mano_obra" as const,
        laborCents: 30_000,
      },
      {
        ...baseQuote,
        billingMode: "solo_mano_obra" as const,
        laborSubMode: "por_horas" as const,
        laborHoursThousandths: 6000,
        hourlyRateCents: 3800,
        laborCents: 22_800,
        subtotalCents: 22_800,
        vatCents: 4_788,
        totalCents: 27_588,
      },
    ]) {
      const res = await pdfAdapter.buildDocumentPdf(variant);
      expect(res.fileName).toBe("PRE-2026-0777.pdf");
      assertPdfBytes(res.pdfBytes);
    }

    const invoiceInput: PdfInvoiceDocumentInput = {
      kind: "invoice",
      invoiceNumber: "FAC-2026-0099",
      invoiceKind: "full",
      issuedAtIso: "2026-06-05",
      dueAtIso: "2026-06-20",
      emitter: {
        name: "Instalaciones Soler S.L.",
        nif: "B12345678",
        fiscalAddress: "C/ Mayor 12, Madrid",
        phone: "600111222",
      },
      client: {
        name: "Carlos Gómez",
        nif: "12345678Z",
        fiscalAddress: "Av. Libertad 5, Madrid",
        phone: "611222333",
      },
      jobCode: "OBR-2026-009",
      jobTitle: "Reforma integral",
      quoteCode: "PRE-2026-0777",
      vatRate: 21,
      baseCents: 100_000,
      vatCents: 21_000,
      totalCents: 121_000,
      advanceDeductedBaseCents: 0,
      advanceDeductedVatCents: 0,
      notes: "Gracias por su confianza.",
    };
    const invPdf = await pdfAdapter.buildDocumentPdf(invoiceInput);
    expect(invPdf.fileName).toBe("FAC-2026-0099.pdf");
    assertPdfBytes(invPdf.pdfBytes);

    const createdActa = await actasRepo.createDraftFromContext({
      especialidad: "electricidad",
      fechaEmisionIso: "2026-06-10",
    });
    const actaInput: PdfActaDocumentInput = {
      kind: "acta",
      codigoActa: createdActa.row.codigo_acta,
      estado: "borrador",
      data: createdActa.data,
      resolvedFotos: [],
    };
    const actaPdf = await pdfAdapter.buildDocumentPdf(actaInput);
    expect(actaPdf.fileName).toBe(`${createdActa.row.codigo_acta}.pdf`);
    assertPdfBytes(actaPdf.pdfBytes);
  });

  it("pdfCanvasRenderer respeta el tope de DPR, el límite de 4MP por página y prioridad DOCUMENT_PREVIEW", () => {
    expect(BACK_PRIORITY.DOCUMENT_PREVIEW).toBe(85);
    expect(resolvePublicAsset("assets/pdf/pdf.worker.min.mjs")).toMatch(
      /assets\/pdf\/pdf\.worker\.min\.mjs$/
    );

    // DPR limitado a 2.5
    const normal = computeSafeCanvasRenderDimensions(400, 566, 4);
    expect(normal.effectiveScale).toBe(PDF_RENDERER_MAX_DPR);
    expect(normal.pixelWidth).toBe(1000);
    expect(normal.pixelHeight).toBe(1415);

    // Tope de ~4MP en zoom alto para evitar OOM en WebView Android
    const capped = computeSafeCanvasRenderDimensions(1600, 2262, 2.5);
    expect(capped.pixelWidth * capped.pixelHeight).toBeLessThanOrEqual(PDF_RENDERER_MAX_PIXELS);
    expect(capped.effectiveScale).toBeLessThan(PDF_RENDERER_MAX_DPR);

    // zeroOutCanvas limpia ancho y alto
    const fakeCanvas = {
      width: 800,
      height: 1131,
      getContext: () => ({ clearRect: () => undefined }),
    } as unknown as HTMLCanvasElement;
    zeroOutCanvas(fakeCanvas);
    expect(fakeCanvas.width).toBe(0);
    expect(fakeCanvas.height).toBe(0);
  });
});
