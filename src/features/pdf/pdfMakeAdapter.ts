import type { MemoryCoordinator } from "../../core/contracts/types";
import { formatCentsEs } from "../../core/fiscal/fiscalEngine";
import type {
  PdfBuildInput,
  PdfInvoiceDocumentInput,
  PdfPort,
  PdfQuoteDocumentInput,
} from "../../core/ports/mediaPorts";

interface PdfMakeRuntime {
  vfs?: Record<string, string>;
  createPdf(
    docDefinition: Record<string, unknown>,
    tableLayouts?: Record<string, unknown>,
    fonts?: Record<string, unknown>,
    vfs?: Record<string, string>
  ): {
    getBuffer(cb: (buffer: Uint8Array | ArrayBuffer | ArrayLike<number>) => void): void;
  };
}

function formatThousandthsEs(thousandths: number): string {
  const intPart = Math.floor(thousandths / 1000);
  const rem = thousandths % 1000;
  if (rem === 0) return String(intPart);
  const trimmed = String(rem).padStart(3, "0").replace(/0+$/, "");
  return `${intPart},${trimmed}`;
}

function buildPartyBlock(
  label: string,
  party: { name: string; nif: string; fiscalAddress: string; phone: string; iban?: string }
): Record<string, unknown> {
  return {
    stack: [
      { text: label, fontSize: 8, bold: true, color: "#64748b", margin: [0, 0, 0, 2] },
      { text: party.name || "-", bold: true, fontSize: 10 },
      { text: `NIF/CIF: ${party.nif || "-"}`, fontSize: 9, color: "#334155" },
      { text: party.fiscalAddress || "-", fontSize: 9, color: "#334155" },
      ...(party.phone ? [{ text: `Tel: ${party.phone}`, fontSize: 9, color: "#334155" }] : []),
      ...(party.iban ? [{ text: `IBAN: ${party.iban}`, fontSize: 9, bold: true, color: "#334155" }] : []),
    ],
  };
}

function buildQuoteDocDefinition(input: PdfQuoteDocumentInput): Record<string, unknown> {
  const cleanRows: Array<Array<Record<string, unknown>>> = [
    [
      { text: "Concepto", style: "th" },
      { text: "Ud", style: "th", alignment: "center" },
      { text: "Cant.", style: "th", alignment: "right" },
      { text: "P. Unit.", style: "th", alignment: "right" },
      { text: "Importe", style: "th", alignment: "right" },
    ],
    ...input.lines.map((line) => [
      { text: line.description, fontSize: 9 },
      { text: line.unit, fontSize: 9, alignment: "center" },
      { text: formatThousandthsEs(line.quantityThousandths), fontSize: 9, alignment: "right" },
      { text: formatCentsEs(line.unitPriceCents), fontSize: 9, alignment: "right" },
      { text: formatCentsEs(line.lineSubtotalCents), fontSize: 9, alignment: "right", bold: true },
    ]),
  ];

  return {
    pageSize: "A4",
    pageMargins: [36, 40, 36, 48],
    content: [
      {
        columns: [
          {
            stack: [
              ...(input.emitter.logoDataUrl
                ? [{ image: input.emitter.logoDataUrl, fit: [110, 44], margin: [0, 0, 0, 6] }]
                : []),
              { text: "PRESUPUESTO DE OBRA", fontSize: 16, bold: true, color: "#0f172a" },
              { text: `Código: ${input.quoteCode}`, fontSize: 11, bold: true, color: "#ea580c", margin: [0, 3, 0, 0] },
              { text: `Obra: ${input.jobTitle}`, fontSize: 9.5, color: "#334155", margin: [0, 2, 0, 0] },
            ],
          },
          {
            stack: [
              { text: `Fecha emisión: ${input.issuedDateIso}`, fontSize: 9.5, alignment: "right" },
              { text: "Documento generado 100 % offline", fontSize: 8, color: "#64748b", alignment: "right", margin: [0, 2, 0, 0] },
            ],
          },
        ],
        margin: [0, 0, 0, 14],
      },
      {
        columns: [
          buildPartyBlock("EMISOR / PROFESIONAL", input.emitter),
          buildPartyBlock("CLIENTE", input.client),
        ],
        columnGap: 20,
        margin: [0, 0, 0, 16],
      },
      {
        table: {
          headerRows: 1,
          widths: ["*", 32, 42, 62, 68],
          body: cleanRows,
        },
        layout: "lightHorizontalLines",
        margin: [0, 0, 0, 16],
      },
      {
        columns: [
          {
            width: "*",
            text: input.notes ? `Observaciones:\n${input.notes}` : "",
            fontSize: 8.5,
            color: "#475569",
          },
          {
            width: 200,
            table: {
              widths: ["*", 80],
              body: [
                [
                  { text: "Base imponible:", fontSize: 9.5 },
                  { text: formatCentsEs(input.subtotalCents), fontSize: 9.5, alignment: "right" },
                ],
                [
                  { text: `IVA (${input.vatRate} %):`, fontSize: 9.5 },
                  { text: formatCentsEs(input.vatCents), fontSize: 9.5, alignment: "right" },
                ],
                [
                  { text: "TOTAL PRESUPUESTO:", fontSize: 11, bold: true, fillColor: "#f8fafc" },
                  {
                    text: formatCentsEs(input.totalCents),
                    fontSize: 11,
                    bold: true,
                    alignment: "right",
                    fillColor: "#f8fafc",
                  },
                ],
              ],
            },
            layout: "noBorders",
          },
        ],
      },
    ],
    styles: {
      th: { fontSize: 9, bold: true, color: "#0f172a", fillColor: "#f1f5f9", margin: [0, 3, 0, 3] },
    },
  };
}

function invoiceKindLabel(kind: PdfInvoiceDocumentInput["invoiceKind"]): string {
  switch (kind) {
    case "advance_40":
      return "FACTURA DE ANTICIPO (40 %)";
    case "final":
      return "FACTURA FINAL / LIQUIDACIÓN";
    case "full":
      return "FACTURA COMPLETA";
  }
}

function buildInvoiceDocDefinition(input: PdfInvoiceDocumentInput): Record<string, unknown> {
  const rows: Array<Array<Record<string, unknown>>> = [
    [
      { text: "Concepto", style: "th" },
      { text: "Base", style: "th", alignment: "right" },
      { text: `IVA (${input.vatRate} %)`, style: "th", alignment: "right" },
      { text: "Total", style: "th", alignment: "right" },
    ],
    [
      {
        text: `${invoiceKindLabel(input.invoiceKind)} · Obra ${input.jobCode} (${input.jobTitle}) · Ref. ${input.quoteCode}`,
        fontSize: 9,
      },
      { text: formatCentsEs(input.baseCents), fontSize: 9, alignment: "right" },
      { text: formatCentsEs(input.vatCents), fontSize: 9, alignment: "right" },
      { text: formatCentsEs(input.totalCents), fontSize: 9, alignment: "right", bold: true },
    ],
  ];

  if (input.advanceDeductedBaseCents > 0) {
    const deductedTotal = input.advanceDeductedBaseCents + input.advanceDeductedVatCents;
    rows.push([
      {
        text: "Anticipo previo deducido (ya facturado y devengado en factura ANT)",
        fontSize: 8.5,
        color: "#475569",
      },
      { text: `-${formatCentsEs(input.advanceDeductedBaseCents)}`, fontSize: 8.5, alignment: "right", color: "#475569" },
      { text: `-${formatCentsEs(input.advanceDeductedVatCents)}`, fontSize: 8.5, alignment: "right", color: "#475569" },
      { text: `-${formatCentsEs(deductedTotal)}`, fontSize: 8.5, alignment: "right", color: "#475569" },
    ]);
  }

  return {
    pageSize: "A4",
    pageMargins: [36, 40, 36, 48],
    content: [
      {
        columns: [
          {
            stack: [
              ...(input.emitter.logoDataUrl
                ? [{ image: input.emitter.logoDataUrl, fit: [110, 44], margin: [0, 0, 0, 6] }]
                : []),
              { text: invoiceKindLabel(input.invoiceKind), fontSize: 15, bold: true, color: "#0f172a" },
              { text: `Número de factura: ${input.invoiceNumber}`, fontSize: 11, bold: true, color: "#ea580c", margin: [0, 3, 0, 0] },
              { text: `Obra ${input.jobCode}: ${input.jobTitle}`, fontSize: 9.5, color: "#334155", margin: [0, 2, 0, 0] },
            ],
          },
          {
            stack: [
              { text: `Fecha emisión: ${input.issuedAtIso}`, fontSize: 9.5, alignment: "right" },
              { text: `Vencimiento: ${input.dueAtIso}`, fontSize: 9.5, alignment: "right" },
              { text: "Factura conforme RD 1619/2012", fontSize: 8, color: "#64748b", alignment: "right", margin: [0, 2, 0, 0] },
            ],
          },
        ],
        margin: [0, 0, 0, 14],
      },
      {
        columns: [
          buildPartyBlock("EMISOR OBLIGADO TRIBUTARIO", input.emitter),
          buildPartyBlock("DESTINATARIO / CLIENTE", input.client),
        ],
        columnGap: 20,
        margin: [0, 0, 0, 16],
      },
      {
        table: {
          headerRows: 1,
          widths: ["*", 68, 68, 72],
          body: rows,
        },
        layout: "lightHorizontalLines",
        margin: [0, 0, 0, 16],
      },
      {
        columns: [
          {
            width: "*",
            text: input.notes ? `Notas legales / Forma de pago:\n${input.notes}` : "",
            fontSize: 8.5,
            color: "#475569",
          },
          {
            width: 210,
            table: {
              widths: ["*", 84],
              body: [
                [
                  { text: "Base imponible factura:", fontSize: 9.5 },
                  { text: formatCentsEs(input.baseCents), fontSize: 9.5, alignment: "right" },
                ],
                [
                  { text: `Cuota IVA (${input.vatRate} %):`, fontSize: 9.5 },
                  { text: formatCentsEs(input.vatCents), fontSize: 9.5, alignment: "right" },
                ],
                [
                  { text: "TOTAL A PAGAR:", fontSize: 11, bold: true, fillColor: "#f8fafc" },
                  {
                    text: formatCentsEs(input.totalCents),
                    fontSize: 11,
                    bold: true,
                    alignment: "right",
                    fillColor: "#f8fafc",
                  },
                ],
              ],
            },
            layout: "noBorders",
          },
        ],
      },
    ],
    styles: {
      th: { fontSize: 9, bold: true, color: "#0f172a", fillColor: "#f1f5f9", margin: [0, 3, 0, 3] },
    },
  };
}

/**
 * Adaptador PDF 100 % offline con carga diferida (`pdfmake` + `vfs_fonts`).
 * Desenvuelve `.default` de Vite/ESM y convierte `getBuffer` a `Promise<Uint8Array>`.
 */
export class PdfMakeAdapter implements PdfPort {
  constructor(_memoryCoordinator?: MemoryCoordinator) {
    void _memoryCoordinator;
  }

  async buildDocumentPdf(input: PdfBuildInput): Promise<{ pdfBytes: Uint8Array; fileName: string }> {
    let pdfMakeMod: Record<string, unknown>;
    let vfsMod: Record<string, unknown>;
    try {
      const [pm, vf] = await Promise.all([
        import("pdfmake/build/pdfmake"),
        import("pdfmake/build/vfs_fonts"),
      ]);
      pdfMakeMod = pm as unknown as Record<string, unknown>;
      vfsMod = vf as unknown as Record<string, unknown>;
    } catch (err) {
      throw new Error(
        `LAZY_CHUNK_LOAD_ERROR: No se pudo cargar el generador PDF (${err instanceof Error ? err.message : String(err)})`
      );
    }

    const pdfMake = ((pdfMakeMod.default as PdfMakeRuntime | undefined) ??
      (pdfMakeMod as unknown as PdfMakeRuntime));

    if (!pdfMake || typeof pdfMake.createPdf !== "function") {
      throw new Error("PDF_BUILD_ERROR: createPdf no disponible en el módulo pdfmake");
    }

    const vfsDefault = vfsMod.default as Record<string, unknown> | undefined;
    const vfsPdfMake = vfsMod.pdfMake as Record<string, unknown> | undefined;
    const vfsDefaultPdfMake = vfsDefault?.pdfMake as Record<string, unknown> | undefined;

    const resolvedVfs = (vfsPdfMake?.vfs ??
      vfsDefaultPdfMake?.vfs ??
      vfsMod.vfs ??
      vfsDefault?.vfs ??
      vfsDefault ??
      vfsMod) as Record<string, string>;

    pdfMake.vfs = resolvedVfs;

    const docDef =
      input.kind === "quote"
        ? buildQuoteDocDefinition(input)
        : buildInvoiceDocDefinition(input);

    const fileName =
      input.kind === "quote"
        ? `${input.quoteCode}.pdf`
        : `${input.invoiceNumber}.pdf`;

    return new Promise<Uint8Array>((resolve, reject) => {
      try {
        const doc = pdfMake.createPdf(docDef, undefined, undefined, resolvedVfs);
        doc.getBuffer((rawBuffer) => {
          if (!rawBuffer) {
            reject(new Error("PDF_BUILD_ERROR: buffer PDF vacío"));
            return;
          }
          if (rawBuffer instanceof ArrayBuffer) {
            resolve(new Uint8Array(rawBuffer));
            return;
          }
          if (ArrayBuffer.isView(rawBuffer)) {
            resolve(new Uint8Array(rawBuffer.buffer, rawBuffer.byteOffset, rawBuffer.byteLength).slice());
            return;
          }
          resolve(Uint8Array.from(rawBuffer));
        });
      } catch (err) {
        reject(
          new Error(
            `PDF_BUILD_ERROR: ${err instanceof Error ? err.message : String(err)}`
          )
        );
      }
    }).then((pdfBytes) => ({ pdfBytes, fileName }));
  }
}
