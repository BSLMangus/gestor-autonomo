import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GraphRunner } from "../src/agent/graphRunner";
import { LocalInferenceAdapterImpl } from "../src/agent/inference/localInferenceAdapter";
import { BackupService } from "../src/core/backup/backupService";
import { ResetService } from "../src/core/backup/resetService";
import {
  Gate1QuoteCommitPayloadSchema,
  parseQuoteAttachmentsJson,
} from "../src/core/contracts/schemas";
import { NodeBetterSqliteExecutor } from "../src/core/db/nodeSqliteExecutor";
import { QuotesRepository } from "../src/core/db/repositories/quotesRepo";
import { SettingsRepository } from "../src/core/db/repositories/settingsRepo";
import { TracesRepository } from "../src/core/db/repositories/tracesRepo";
import { initializeSchema } from "../src/core/db/sqliteExecutor";
import { MemoryFileBridge } from "../src/core/files/memoryFileBridge";
import { MemoryCoordinatorNoop } from "../src/core/memory/memoryCoordinator";
import type {
  OcrPort,
  PdfBuildInput,
  PdfPort,
  PdfQuoteDocumentInput,
} from "../src/core/ports/mediaPorts";
import { buildQuoteDocDefinition } from "../src/features/pdf/pdfMakeAdapter";
import {
  extractQuoteAttachment,
  formatAttachmentSummaryForNotes,
  summarizeExtractedText,
  type QuoteAttachmentFileLike,
} from "../src/features/quotes/quoteAttachmentExtractor";
import { MockFreezerPort, MockOcrPort } from "./mocks/ports";

class CapturingPdfPort implements PdfPort {
  public readonly inputs: PdfBuildInput[] = [];

  async buildDocumentPdf(
    input: PdfBuildInput
  ): Promise<{ pdfBytes: Uint8Array; fileName: string }> {
    this.inputs.push(input);
    const name =
      input.kind === "quote"
        ? `${input.quoteCode}.pdf`
        : input.kind === "invoice"
          ? `${input.invoiceNumber}.pdf`
          : input.kind === "work_order"
            ? `${input.documentCode}.pdf`
            : `${input.codigoActa}.pdf`;
    return {
      pdfBytes: new TextEncoder().encode(`%PDF-1.4\n% ${name}\n`),
      fileName: name,
    };
  }
}

function collectStrings(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(collectStrings);
  if (node && typeof node === "object") {
    return Object.values(node as Record<string, unknown>).flatMap(collectStrings);
  }
  return [];
}

function collectColors(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(collectColors);
  if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    const own = typeof record.color === "string" ? [record.color] : [];
    const nested = Object.entries(record)
      .filter(([key]) => key !== "color")
      .flatMap(([, val]) => collectColors(val));
    return [...own, ...nested];
  }
  return [];
}

function makeBasePdfInput(
  overrides: Partial<PdfQuoteDocumentInput> = {}
): PdfQuoteDocumentInput {
  return {
    kind: "quote",
    quoteCode: "PRE-2026-0042",
    issuedDateIso: "2026-04-15",
    validityDays: 30,
    validUntilIso: "2026-05-15",
    emitter: {
      name: "Instalaciones Soler S.L.",
      nif: "B12345678",
      fiscalAddress: "C/ Mayor 12, 28013 Madrid",
      phone: "+34 600 111 222",
      email: "contacto@soler.es",
      iban: "ES91 2100 0418 4502 0005 1332",
      bankName: "CaixaBank",
      logoDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
    },
    client: {
      name: "María López García",
      nif: "12345678Z",
      fiscalAddress: "Av. América 45, 28002 Madrid",
      phone: "+34 611 333 444",
      email: "maria@cliente.es",
    },
    jobTitle: "Reforma eléctrica vivienda",
    generalDescription: "Reforma eléctrica completa de vivienda de 90m2",
    estimatedDurationValue: 5,
    estimatedDurationUnit: "dias_laborables",
    vatRate: 21,
    subtotalCents: 100_000,
    vatCents: 21_000,
    totalCents: 121_000,
    paymentMethods: [],
    paymentSchedule: [],
    paymentTermsText: "50% al inicio de obra, 40% a mediados y 10% al finalizar",
    ibanOverride: "ES91 2100 0418 4502 0005 1332",
    bankName: "CaixaBank",
    showIban: true,
    notes: "Material homologado según REBT ITC-BT-25.",
    attachments: [
      {
        name: "certificado-rebt.pdf",
        mimeType: "application/pdf",
        extractedText: "Instalador autorizado categoría especialista",
      },
    ],
    lines: [
      {
        description: "Cuadro general de mando y protección",
        unit: "ud",
        quantityThousandths: 1000,
        unitPriceCents: 45_000,
        lineSubtotalCents: 45_000,
      },
      {
        description: "Puntos de luz con mecanismo completo",
        unit: "ud",
        quantityThousandths: 10_000,
        unitPriceCents: 5_500,
        lineSubtotalCents: 55_000,
      },
    ],
    ...overrides,
  };
}

describe("Persistencia SQLite de condiciones y datos del documento en presupuestos", () => {
  let executor: NodeBetterSqliteExecutor;
  let fileBridge: MemoryFileBridge;
  let pdfPort: CapturingPdfPort;
  let quotesRepo: QuotesRepository;
  let settingsRepo: SettingsRepository;
  let runner: GraphRunner;

  beforeEach(async () => {
    executor = new NodeBetterSqliteExecutor(":memory:");
    await initializeSchema(executor);
    fileBridge = new MemoryFileBridge();
    pdfPort = new CapturingPdfPort();
    quotesRepo = new QuotesRepository(executor);
    settingsRepo = new SettingsRepository(executor);

    await new ResetService(executor).restoreDemoData(new MockFreezerPort());

    runner = new GraphRunner(
      {
        executor,
        fileBridge,
        memoryCoordinator: new MemoryCoordinatorNoop(),
        inference: new LocalInferenceAdapterImpl(),
        ocrPort: new MockOcrPort(),
        pdfPort,
        traceRecorder: new TracesRepository(executor),
      },
      "memory"
    );
  });

  afterEach(async () => {
    await executor.close();
  });

  it("persiste todos los nuevos campos de presupuesto sin alterar cálculos de subtotal/IVA/total y los propaga al PDF y backup", async () => {
    await settingsRepo.updateEmitterProfile({
      emitter_name: "Electricidad Norte",
      emitter_nif: "12345678Z",
      emitter_fiscal_address: "C/ Velázquez 20, Madrid",
      emitter_phone: "+34 699 000 111",
      emitter_email: "info@electricidadnorte.es",
      emitter_iban: "ES12 0049 1500 0512 3456 7892",
      emitter_bank_name: "Banco Santander",
    });

    const settings = await settingsRepo.getAppSettings();
    expect(settings.emitter_email).toBe("info@electricidadnorte.es");
    expect(settings.emitter_bank_name).toBe("Banco Santander");

    const thr = await runner.createThread({ title: "Presupuesto completo" });
    const turn = await runner.runTurn(thr.thread_id, {
      client_turn_id: "t_full_doc_1",
      text: "Presupuesto: 4 puntos de luz a 50 euros",
      action_type: "free_text_or_voice",
    });

    expect(turn.checkpoint_status).toBe("interrupted");
    expect(turn.active_interrupt?.gate_id).toBe("gate_1_quote");
    if (turn.active_interrupt?.gate_id !== "gate_1_quote") {
      throw new Error("Expected gate_1_quote");
    }

    // Verificar pre-rellenado automático desde app_settings
    const draft = turn.active_interrupt.proposed_payload;
    expect(draft.validity_days).toBe(30);
    expect(draft.iban_override).toBe("ES1200491500051234567892");
    expect(draft.bank_name).toBe("Banco Santander");
    expect(draft.show_iban).toBe(true);

    const edited = Gate1QuoteCommitPayloadSchema.parse({
      ...draft,
      client_id: null,
      new_client: {
        name: "Ana Martín",
        nif: "00000000T",
        fiscal_address: "C/ Alcalá 100, Madrid",
        phone: "+34 622 444 555",
        email: "ana.martin@ejemplo.es",
      },
      job_title: "Reforma salón",
      general_description: "Renovación de iluminación LED y cuadro secundario",
      estimated_duration_value: 2,
      estimated_duration_unit: "semanas",
      validity_days: 45,
      payment_terms_text: "50% al inicio y 50% a la entrega",
      iban_override: "ES99 2100 0418 4502 0005 9999",
      bank_name: "BBVA",
      show_iban: true,
      notes: "Incluye retirada de escombros.",
      attachments: [
        {
          name: "boletin.txt",
          mimeType: "text/plain",
          extractedText: "Certificado de instalación eléctrica",
        },
      ],
      vat_rate: 21,
      lines: [
        {
          catalog_item_id: null,
          description: "Punto de luz LED",
          category: "Electricidad",
          unit: "ud",
          quantity_thousandths: 4000,
          unit_price_cents: 5000,
          original_unit_price_cents: 5000,
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
    expect(saved.checkpoint_status).toBe("idle");
    const quoteId = saved.active_quote_id!;
    expect(quoteId).toBeTruthy();

    const quote = await quotesRepo.getById(quoteId);
    expect(quote).not.toBeNull();
    // Cálculos fiscales exactos intactos: 4 * 5000 = 20000 cts base, 21% IVA = 4200 cts, total = 24200 cts
    expect(quote!.subtotal_cents).toBe(20_000);
    expect(quote!.vat_cents).toBe(4_200);
    expect(quote!.total_cents).toBe(24_200);

    // Nuevos campos persistidos en SQLite
    expect(quote!.general_description).toBe("Renovación de iluminación LED y cuadro secundario");
    expect(quote!.estimated_duration_value).toBe(2);
    expect(quote!.estimated_duration_unit).toBe("semanas");
    expect(quote!.validity_days).toBe(45);
    expect(quote!.payment_terms_text).toBe("50% al inicio y 50% a la entrega");
    expect(quote!.iban_override).toBe("ES9921000418450200059999");
    expect(quote!.bank_name).toBe("BBVA");
    expect(quote!.show_iban).toBe(1);
    expect(quote!.notes).toBe("Incluye retirada de escombros.");
    const parsedAtts = parseQuoteAttachmentsJson(quote!.attachments_json);
    expect(parsedAtts).toEqual([
      {
        name: "boletin.txt",
        mimeType: "text/plain",
        extractedText: "Certificado de instalación eléctrica",
      },
    ]);

    // Verificar entrada enviada a PdfPort en commit inicial y en regeneratePdfOnDemand
    await quotesRepo.regeneratePdfOnDemand(quoteId, pdfPort, fileBridge);
    const quotePdfInputs = pdfPort.inputs.filter(
      (i): i is PdfQuoteDocumentInput => i.kind === "quote"
    );
    expect(quotePdfInputs.length).toBeGreaterThanOrEqual(2);
    for (const pdfInput of quotePdfInputs) {
      expect(pdfInput.generalDescription).toBe(
        "Renovación de iluminación LED y cuadro secundario"
      );
      expect(pdfInput.estimatedDurationValue).toBe(2);
      expect(pdfInput.estimatedDurationUnit).toBe("semanas");
      expect(pdfInput.validityDays).toBe(45);
      expect(pdfInput.paymentTermsText).toBe("50% al inicio y 50% a la entrega");
      expect(pdfInput.ibanOverride).toBe("ES9921000418450200059999");
      expect(pdfInput.bankName).toBe("BBVA");
      expect(pdfInput.showIban).toBe(true);
      expect(pdfInput.emitter.email).toBe("info@electricidadnorte.es");
      expect(pdfInput.client.email).toBe("ana.martin@ejemplo.es");
      expect(pdfInput.attachments).toEqual(parsedAtts);
    }

    // Verificar backup & restore round-trip
    const backupService = new BackupService(executor);
    const exported = await backupService.exportBackupJson();
    await new ResetService(executor).startFromScratch();
    await backupService.importBackupJson(exported);

    const restored = await quotesRepo.getById(quoteId);
    const restoredSettings = await settingsRepo.getAppSettings();
    expect(restored?.general_description).toBe("Renovación de iluminación LED y cuadro secundario");
    expect(restored?.estimated_duration_value).toBe(2);
    expect(restored?.estimated_duration_unit).toBe("semanas");
    expect(restored?.payment_terms_text).toBe("50% al inicio y 50% a la entrega");
    expect(restored?.iban_override).toBe("ES9921000418450200059999");
    expect(restored?.bank_name).toBe("BBVA");
    expect(restored?.show_iban).toBe(1);
    expect(parseQuoteAttachmentsJson(restored?.attachments_json)).toEqual(parsedAtts);
    expect(restoredSettings.emitter_bank_name).toBe("Banco Santander");
    expect(restoredSettings.emitter_email).toBe("info@electricidadnorte.es");
  });

  it("respeta show_iban = false al guardar en SQLite y al regenerar el PDF", async () => {
    const thr = await runner.createThread({ title: "Ocultar IBAN" });
    const turn = await runner.runTurn(thr.thread_id, {
      client_turn_id: "t_no_iban_1",
      text: "Presupuesto: 1 enchufe a 35 euros",
      action_type: "free_text_or_voice",
    });
    if (turn.active_interrupt?.gate_id !== "gate_1_quote") {
      throw new Error("Expected gate_1_quote");
    }

    const edited = Gate1QuoteCommitPayloadSchema.parse({
      ...turn.active_interrupt.proposed_payload,
      iban_override: "ES91 2100 0418 4502 0005 1332",
      bank_name: "CaixaBank",
      show_iban: false,
    });
    const saved = await runner.resumeGate(thr.thread_id, {
      gate_id: "gate_1_quote",
      action: "edit",
      edited_payload: edited,
      client_validated_at_ms: Date.now(),
    });
    const quote = await quotesRepo.getById(saved.active_quote_id!);
    expect(quote?.show_iban).toBe(0);

    pdfPort.inputs.length = 0;
    await quotesRepo.regeneratePdfOnDemand(saved.active_quote_id!, pdfPort, fileBridge);
    const regenerated = pdfPort.inputs[0] as PdfQuoteDocumentInput;
    expect(regenerated.showIban).toBe(false);
  });
});

describe("Diseño PDF de Presupuesto (buildQuoteDocDefinition)", () => {
  it("cumple márgenes, cabecera, dos columnas, textos negros en parte superior/tabla con fondos pastel y cierre inferior unbreakable", () => {
    const docDef = buildQuoteDocDefinition(makeBasePdfInput()) as {
      pageSize: string;
      pageMargins: [number, number, number, number];
      content: Array<Record<string, unknown>>;
    };

    expect(docDef.pageSize).toBe("A4");
    // Margen superior >= 70pt (~25mm)
    expect(docDef.pageMargins[1]).toBeGreaterThanOrEqual(70);

    const content = docDef.content;
    // 0: Cabecera (logo izq, PRESUPUESTO + código + fecha der en #000000, SIN aviso de validez arriba)
    const headerBlock = content[0] as { columns: Array<Record<string, unknown>> };
    expect(headerBlock.columns).toHaveLength(2);
    expect(headerBlock.columns[0]?.image).toBe(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"
    );
    const headerRightText = collectStrings(headerBlock.columns[1]).join(" ");
    expect(headerRightText).toContain("PRESUPUESTO");
    expect(headerRightText).toContain("PRE-2026-0042");
    expect(headerRightText).toContain("2026-04-15");
    expect(headerRightText.toLowerCase()).not.toContain("válido");
    expect(headerRightText.toLowerCase()).not.toContain("sin conexión");
    const headerColors = collectColors(headerBlock.columns[1]);
    expect(headerColors.length).toBeGreaterThanOrEqual(3);
    expect(headerColors.every((c) => c === "#000000")).toBe(true);

    // 1: Dos columnas enfrentadas (Emisor izq con email | Cliente der alineado a la derecha con email, todo en #000000)
    const partiesBlock = content[1] as {
      columns: Array<{ stack: Array<Record<string, unknown>> }>;
    };
    expect(partiesBlock.columns).toHaveLength(2);
    const emitterStrings = collectStrings(partiesBlock.columns[0]).join(" ");
    expect(emitterStrings).toContain("Instalaciones Soler S.L.");
    expect(emitterStrings).toContain("Email: contacto@soler.es");
    const emitterColors = collectColors(partiesBlock.columns[0]);
    expect(emitterColors.length).toBeGreaterThan(0);
    expect(emitterColors.every((c) => c === "#000000")).toBe(true);

    const clientStack = partiesBlock.columns[1]!.stack;
    expect(clientStack.every((entry) => entry.alignment === "right")).toBe(true);
    const clientStrings = collectStrings(clientStack).join(" ");
    expect(clientStrings).toContain("María López García");
    expect(clientStrings).toContain("Email: maria@cliente.es");
    const clientColors = collectColors(clientStack);
    expect(clientColors.length).toBeGreaterThan(0);
    expect(clientColors.every((c) => c === "#000000")).toBe(true);

    // 2: Franja Descripción general (#E0F2FE fondo pastel / #000000 texto)
    const descBlock = content[2] as { table: { body: Array<Array<Record<string, unknown>>> } };
    const descCell = descBlock.table.body[0]![0]!;
    expect(descCell.fillColor).toBe("#E0F2FE");
    const descColors = collectColors(descCell);
    expect(descColors.length).toBeGreaterThanOrEqual(2);
    expect(descColors.every((c) => c === "#000000")).toBe(true);
    expect(collectStrings(descCell).join("")).toContain(
      "Reforma eléctrica completa de vivienda de 90m2"
    );

    // 3: Franja Tiempo estimado (#DBEAFE fondo pastel / #000000 texto)
    const durationBlock = content[3] as { table: { body: Array<Array<Record<string, unknown>>> } };
    const durationCell = durationBlock.table.body[0]![0]!;
    expect(durationCell.fillColor).toBe("#DBEAFE");
    const durationColors = collectColors(durationCell);
    expect(durationColors.length).toBeGreaterThanOrEqual(2);
    expect(durationColors.every((c) => c === "#000000")).toBe(true);
    expect(collectStrings(durationCell).join("")).toContain("5 Días laborables");

    // 4: Tabla de tareas (#FCE7F3 cabecera, #E5E7EB bordes, #EDE9FE Sub-Total, todos los textos/números #000000)
    const tasksBlock = content[4] as {
      table: { body: Array<Array<Record<string, unknown>>> };
      layout: { hLineColor: () => string; vLineColor: () => string };
    };
    const headerRow = tasksBlock.table.body[0]!;
    expect(headerRow[0]?.text).toBe("Descripción de las tareas");
    expect(headerRow[0]?.fillColor).toBe("#FCE7F3");
    expect(headerRow[0]?.color).toBe("#000000");
    expect(headerRow[1]?.text).toBe("Costes");
    expect(headerRow[1]?.fillColor).toBe("#FCE7F3");
    expect(headerRow[1]?.color).toBe("#000000");
    expect(tasksBlock.layout.hLineColor()).toBe("#E5E7EB");
    expect(tasksBlock.layout.vLineColor()).toBe("#E5E7EB");

    const itemRows = tasksBlock.table.body.slice(1, -1);
    expect(itemRows.length).toBe(2);
    for (const row of itemRows) {
      const rowColors = collectColors(row);
      expect(rowColors.length).toBeGreaterThanOrEqual(3);
      expect(rowColors.every((c) => c === "#000000")).toBe(true);
    }

    const subtotalRow = tasksBlock.table.body[tasksBlock.table.body.length - 1]!;
    expect(subtotalRow[0]?.text).toBe("Sub-Total");
    expect(subtotalRow[0]?.fillColor).toBe("#EDE9FE");
    expect(subtotalRow[0]?.color).toBe("#000000");
    expect(subtotalRow[1]?.fillColor).toBe("#EDE9FE");
    expect(subtotalRow[1]?.color).toBe("#000000");

    // 5: Bloque de cierre indivisible (unbreakable: true) con orden estricto de los 5 sub-bloques
    expect(content).toHaveLength(6);
    const closingBlock = content[5] as {
      stack: Array<Record<string, unknown>>;
      unbreakable?: boolean;
    };
    expect(closingBlock.unbreakable).toBe(true);
    expect(closingBlock.stack).toHaveLength(5);

    // (1) Notas técnicas y certificaciones (9pt, #374151)
    const notesBlock = closingBlock.stack[0] as { stack: Array<Record<string, unknown>> };
    expect(notesBlock.stack).toBeDefined();
    expect(notesBlock.stack.every((n) => n.fontSize === 9 && n.color === "#374151")).toBe(true);
    const notesText = collectStrings(notesBlock).join(" ");
    expect(notesText).toContain("Material homologado según REBT ITC-BT-25.");
    expect(notesText).toContain("certificado-rebt.pdf");
    expect(notesText).toContain("Instalador autorizado categoría especialista");

    // (2) Barra de Totales (#DCFCE7 / #166534)
    const totalsBlock = closingBlock.stack[1] as {
      table: { body: Array<Array<Record<string, unknown>>> };
    };
    const totalsRow = totalsBlock.table.body[0]!;
    expect(totalsRow).toHaveLength(3);
    expect(totalsRow.every((c) => c.fillColor === "#DCFCE7")).toBe(true);
    expect(JSON.stringify(totalsRow)).toContain("#166534");
    const totalsText = collectStrings(totalsRow).join(" ");
    expect(totalsText).toContain("Base imponible");
    expect(totalsText).toContain("IVA (21 %)");
    expect(totalsText).toContain("Total");

    // (3) Caja de Validez y Condiciones (#FEF9C3 / borde #FDE047 / texto #713F12)
    const validityBlock = closingBlock.stack[2] as {
      table: { body: Array<Array<Record<string, unknown>>> };
      layout: { hLineColor: () => string; vLineColor: () => string };
    };
    const validityCell = validityBlock.table.body[0]![0]!;
    expect(validityCell.fillColor).toBe("#FEF9C3");
    expect(validityBlock.layout.hLineColor()).toBe("#FDE047");
    expect(validityBlock.layout.vLineColor()).toBe("#FDE047");
    expect(JSON.stringify(validityCell)).toContain("#713F12");

    const validityText = collectStrings(validityCell).join(" ");
    expect(validityText).toContain(
      "Presupuesto orientativo. Sujeto a diseño, medición y negociación."
    );
    expect(validityText).toContain("Presupuesto válido durante 30 días.");
    expect(validityText).toContain(
      "El presupuesto no cubre imprevistos generados por problemas surgidos una vez empiecen las obras debido a vicios ocultos del inmueble. Importe estimado con materiales de calidades medias; puede variar según necesidades del cliente."
    );
    expect(validityText).toContain("Condiciones de pago:");
    expect(validityText).toContain(
      "50% al inicio de obra, 40% a mediados y 10% al finalizar"
    );

    // (4) Franja de IBAN (#F1F5F9)
    const ibanBlock = closingBlock.stack[3] as {
      table: { body: Array<Array<Record<string, unknown>>> };
    };
    const ibanCell = ibanBlock.table.body[0]![0]!;
    expect(ibanCell.fillColor).toBe("#F1F5F9");
    const ibanText = collectStrings(ibanCell).join("");
    expect(ibanText).toContain("ES91 2100 0418 4502 0005 1332");
    expect(ibanText).toContain("CaixaBank");

    // (5) Pie de página (8pt, #94A3B8, centrado, "Documento generado con Gestor Autónomo")
    const footerBlock = closingBlock.stack[4] as Record<string, unknown>;
    expect(footerBlock.text).toBe("Documento generado con Gestor Autónomo");
    expect(footerBlock.fontSize).toBe(8);
    expect(footerBlock.color).toBe("#94A3B8");
    expect(footerBlock.alignment).toBe("center");
  });

  it("omite bloques opcionales cuando están vacíos o desactivados (tiempo estimado, notas, condiciones de pago, IBAN, logo)", () => {
    const docDef = buildQuoteDocDefinition(
      makeBasePdfInput({
        validityDays: 15,
        emitter: {
          name: "Autónomo Test",
          nif: "11111111H",
          fiscalAddress: "C/ Falsa 1",
          phone: "",
          email: "",
          iban: "",
          bankName: "",
          logoDataUrl: null,
        },
        client: {
          name: "",
          nif: "",
          fiscalAddress: "",
          phone: "",
          email: "",
        },
        generalDescription: "",
        jobTitle: "Reparación puntual",
        estimatedDurationValue: null,
        paymentTermsText: "",
        paymentMethods: [],
        paymentSchedule: [],
        ibanOverride: "",
        bankName: "",
        showIban: false,
        notes: "",
        attachments: [],
      })
    ) as { content: Array<Record<string, unknown>> };

    const allText = collectStrings(docDef.content).join(" ");
    // Sin logo -> bloque izquierdo de cabecera tiene text vacío y sin image
    const headerBlock = docDef.content[0] as { columns: Array<Record<string, unknown>> };
    expect(headerBlock.columns[0]?.image).toBeUndefined();

    // Cliente vacío también usa #000000
    const partiesBlock = docDef.content[1] as { columns: Array<Record<string, unknown>> };
    const emptyClientColors = collectColors(partiesBlock.columns[1]);
    expect(emptyClientColors.length).toBeGreaterThan(0);
    expect(emptyClientColors.every((c) => c === "#000000")).toBe(true);

    // Fallback de descripción general al jobTitle
    expect(allText).toContain("Reparación puntual");
    // Tiempo estimado omitido
    expect(allText).not.toContain("Tiempo estimado:");
    // Notas técnicas omitidas
    expect(allText).not.toContain("Notas técnicas y certificaciones:");
    // Condiciones de pago omitidas
    expect(allText).not.toContain("Condiciones de pago:");
    // Validez usa los 15 días editables
    expect(allText).toContain("Presupuesto válido durante 15 días.");
    // IBAN omitido
    expect(allText).not.toContain("Cuenta corriente / IBAN:");
    // Bloque de cierre sigue siendo unbreakable con el footer actualizado al final
    const closingBlock = docDef.content[docDef.content.length - 1] as {
      stack: Array<Record<string, unknown>>;
      unbreakable?: boolean;
    };
    expect(closingBlock.unbreakable).toBe(true);
    const footerBlock = closingBlock.stack[closingBlock.stack.length - 1]!;
    expect(footerBlock.text).toBe("Documento generado con Gestor Autónomo");
  });

  it("omite franja IBAN cuando showIban es false aunque exista IBAN", () => {
    const docDef = buildQuoteDocDefinition(
      makeBasePdfInput({
        ibanOverride: "ES91 2100 0418 4502 0005 1332",
        showIban: false,
      })
    ) as { content: Array<Record<string, unknown>> };

    const allText = collectStrings(docDef.content).join(" ");
    expect(allText).not.toContain("Cuenta corriente / IBAN:");
    expect(allText).not.toContain("ES91 2100 0418 4502 0005 1332");
  });
});

describe("Helper de extracción de documentos/certificaciones (quoteAttachmentExtractor)", () => {
  function makeMockFile(
    name: string,
    type: string,
    content: string | Uint8Array
  ): QuoteAttachmentFileLike {
    const bytes =
      typeof content === "string" ? new TextEncoder().encode(content) : content;
    const textContent =
      typeof content === "string" ? content : new TextDecoder().decode(content);
    return {
      name,
      type,
      arrayBuffer: async () => new Uint8Array(bytes).buffer,
      text: async () => textContent,
    };
  }

  it("normaliza y recorta texto extraído y formatea bloques para notas", () => {
    expect(summarizeExtractedText("  Línea 1  \r\n\r\n   Línea   2\t\tfin  ")).toBe(
      "Línea 1\nLínea 2 fin"
    );
    expect(summarizeExtractedText("abcdefghij", 5)).toBe("abcd…");
    expect(summarizeExtractedText("   \n  ")).toBe("");
    expect(summarizeExtractedText("abc", 0)).toBe("");

    expect(
      formatAttachmentSummaryForNotes({
        name: "certificado.pdf",
        extractedText: "Instalador autorizado REBT",
      })
    ).toBe("[Anexo: certificado.pdf]\nInstalador autorizado REBT");
    expect(formatAttachmentSummaryForNotes({ name: "plano.png" })).toBe("[Anexo: plano.png]");
  });

  it("extrae texto de archivos .txt/.csv/.md directamente", async () => {
    const file = makeMockFile(
      "especificaciones.txt",
      "text/plain",
      "  Cable libre de halógenos RZ1-K  \n\n  Sección 2,5 mm2  "
    );
    const res = await extractQuoteAttachment(file);
    expect(res.name).toBe("especificaciones.txt");
    expect(res.mimeType).toBe("text/plain");
    expect(res.extractedText).toBe("Cable libre de halógenos RZ1-K\nSección 2,5 mm2");
    expect(res.warning).toBeUndefined();
  });

  it("extrae texto de imágenes mediante OcrPort inyectado y maneja OCR vacío o fallo con aviso", async () => {
    const okOcr: OcrPort = {
      extractTicketText: async () => {
        throw new Error("not used");
      },
      extractRawTextBatch: async () => [
        { rawText: "  Certificado RITE Nº 4421  ", confidence: 0.95 },
      ],
    };
    const imgFile = makeMockFile("certificado.png", "image/png", new Uint8Array([137, 80, 78, 71]));
    const okRes = await extractQuoteAttachment(imgFile, { ocrPort: okOcr });
    expect(okRes.mimeType).toBe("image/png");
    expect(okRes.extractedText).toBe("Certificado RITE Nº 4421");
    expect(okRes.warning).toBeUndefined();

    const emptyOcr: OcrPort = {
      extractTicketText: async () => {
        throw new Error("not used");
      },
      extractRawTextBatch: async () => [{ rawText: "   ", confidence: 0.1 }],
    };
    const emptyRes = await extractQuoteAttachment(imgFile, { ocrPort: emptyOcr });
    expect(emptyRes.extractedText).toBeUndefined();
    expect(emptyRes.warning).toContain("No se detectó texto legible");

    const failingOcr: OcrPort = {
      extractTicketText: async () => {
        throw new Error("not used");
      },
      extractRawTextBatch: async () => {
        throw new Error("OCR timeout");
      },
    };
    const failRes = await extractQuoteAttachment(imgFile, { ocrPort: failingOcr });
    expect(failRes.extractedText).toBeUndefined();
    expect(failRes.warning).toContain("OCR timeout");
  });

  it("adjunta formatos no soportados como referencia con aviso sin lanzar error", async () => {
    const binFile = makeMockFile("anexo.docx", "application/octet-stream", new Uint8Array([80, 75]));
    const res = await extractQuoteAttachment(binFile);
    expect(res.name).toBe("anexo.docx");
    expect(res.extractedText).toBeUndefined();
    expect(res.warning).toContain("Formato no extraíble automáticamente");
  });
});
