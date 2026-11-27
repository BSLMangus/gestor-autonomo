import type {
  MemoryCoordinator,
  QuotePaymentMethod,
} from "../../core/contracts/types";
import {
  computePaymentScheduleAmounts,
  formatCentsEs,
  formatPercentEs,
} from "../../core/fiscal/fiscalEngine";
import { sanitizeQuoteItemDescription } from "../../core/text/quoteDescriptionSanitizer";
import type {
  PdfActaDocumentInput,
  PdfBuildInput,
  PdfInvoiceDocumentInput,
  PdfPort,
  PdfQuoteDocumentInput,
  PdfWorkOrderDocumentInput,
} from "../../core/ports/mediaPorts";
import {
  PDF_COLORS,
  PDF_PAGE_MARGINS,
  PDF_PAGE_SIZE,
  buildContextBanner,
  buildCreamNoticeBox,
  buildDualSignatureBlock,
  buildIbanStrip,
  buildPastelDataCell,
  buildPastelHeaderCell,
  buildPastelSubtotalCell,
  buildPastelTable,
  buildSectionBanner,
  buildSlateInfoStrip,
  buildStatusBadgeCell,
  buildTotalsBanner,
  buildUnifiedFooter,
  buildUnifiedHeader,
  buildUnifiedPartiesBlock,
  type TotalsBannerItem,
} from "./pdfSharedStyles";

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

const PAYMENT_METHOD_LABELS: Record<QuotePaymentMethod, string> = {
  transferencia: "Transferencia bancaria",
  efectivo: "Efectivo",
  bizum: "Bizum",
  tarjeta: "Tarjeta",
};

function formatEstimatedDuration(
  value: number | null | undefined,
  unit: PdfQuoteDocumentInput["estimatedDurationUnit"]
): string | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  const formattedVal = Number.isInteger(value) ? String(value) : String(value).replace(".", ",");
  if (unit === "semanas") {
    return `${formattedVal} ${value === 1 ? "Semana" : "Semanas"}`;
  }
  return `${formattedVal} ${value === 1 ? "Día laborable" : "Días laborables"}`;
}

export function buildQuoteDocDefinition(input: PdfQuoteDocumentInput): Record<string, unknown> {
  const generalDescription = input.generalDescription?.trim() || input.jobTitle?.trim() || "";
  const estimatedDurationText = formatEstimatedDuration(
    input.estimatedDurationValue,
    input.estimatedDurationUnit
  );
  const billingMode = input.billingMode ?? "solo_partidas";

  const sanitizedLines = input.lines.map((line) => ({
    ...line,
    cleanDescription: sanitizeQuoteItemDescription(line.description, {
      knownPricesCents: [line.unitPriceCents, line.lineSubtotalCents],
    }),
  }));

  const quoteTables: Array<Record<string, unknown>> = [];

  if (billingMode === "solo_mano_obra") {
    const taskRows: Array<Array<Record<string, unknown>>> = [
      [buildPastelHeaderCell("Descripción de las tareas / trabajos incluidos")],
    ];

    if (sanitizedLines.length > 0) {
      for (const line of sanitizedLines) {
        const trimmedUnit = line.unit?.trim() ?? "";
        const includeQty =
          line.quantityThousandths > 0 &&
          (line.quantityThousandths !== 1000 ||
            (trimmedUnit.length > 0 && trimmedUnit.toLowerCase() !== "ud"));
        const taskText = includeQty
          ? `${line.cleanDescription} (${formatThousandthsEs(line.quantityThousandths)}${trimmedUnit ? ` ${trimmedUnit}` : ""})`
          : line.cleanDescription;
        taskRows.push([
          buildPastelDataCell(taskText, {
            fontSize: 9.5,
            color: PDF_COLORS.ink,
          }),
        ]);
      }
    } else {
      taskRows.push([
        buildPastelDataCell(
          generalDescription || "Trabajos de mano de obra incluidos según presupuesto",
          {
            fontSize: 9.5,
            color: PDF_COLORS.ink,
          }
        ),
      ]);
    }

    quoteTables.push(
      buildPastelTable({
        widths: ["*"],
        body: taskRows,
        marginBottom: 8,
      })
    );

    const effectiveLaborCents = input.laborCents ?? input.subtotalCents;
    const laborLabel =
      input.laborSubMode === "precio_cerrado"
        ? "Mano de obra (Precio cerrado)"
        : `Mano de obra (${formatThousandthsEs(input.laborHoursThousandths ?? 0)} h × ${formatCentsEs(input.hourlyRateCents ?? 0)}/h)`;

    quoteTables.push(
      buildPastelTable({
        widths: ["*", "auto"],
        headerRows: 0,
        body: [
          [
            buildPastelDataCell(laborLabel, {
              fontSize: 9.5,
              color: PDF_COLORS.ink,
            }),
            buildPastelDataCell(formatCentsEs(effectiveLaborCents), {
              fontSize: 9.5,
              bold: true,
              alignment: "right",
              color: PDF_COLORS.ink,
            }),
          ],
          [
            buildPastelSubtotalCell("Sub-Total"),
            buildPastelSubtotalCell(formatCentsEs(input.subtotalCents), "right"),
          ],
        ],
        marginBottom: 12,
      })
    );
  } else {
    const lineRows: Array<Array<Record<string, unknown>>> = [
      [
        buildPastelHeaderCell("Descripción de las tareas"),
        buildPastelHeaderCell("Cant.", "right"),
        buildPastelHeaderCell("Precio unit.", "right"),
        buildPastelHeaderCell("Total", "right"),
      ],
      ...sanitizedLines.map((line) => {
        const trimmedUnit = line.unit?.trim() ?? "";
        const qtyLabel = trimmedUnit
          ? `${formatThousandthsEs(line.quantityThousandths)} ${trimmedUnit}`
          : formatThousandthsEs(line.quantityThousandths);

        return [
          buildPastelDataCell(line.cleanDescription, {
            fontSize: 9.5,
            color: PDF_COLORS.ink,
          }),
          buildPastelDataCell(qtyLabel, {
            fontSize: 9,
            alignment: "right",
            color: PDF_COLORS.ink,
          }),
          buildPastelDataCell(formatCentsEs(line.unitPriceCents), {
            fontSize: 9,
            alignment: "right",
            color: PDF_COLORS.ink,
          }),
          buildPastelDataCell(formatCentsEs(line.lineSubtotalCents), {
            fontSize: 9.5,
            bold: true,
            alignment: "right",
            color: PDF_COLORS.ink,
          }),
        ];
      }),
    ];

    if (billingMode === "partidas_mas_horas" && (input.laborCents ?? 0) > 0) {
      lineRows.push([
        buildPastelDataCell("Mano de obra", {
          fontSize: 9.5,
          color: PDF_COLORS.ink,
        }),
        buildPastelDataCell(`${formatThousandthsEs(input.laborHoursThousandths ?? 0)} h`, {
          fontSize: 9,
          alignment: "right",
          color: PDF_COLORS.ink,
        }),
        buildPastelDataCell(`${formatCentsEs(input.hourlyRateCents ?? 0)}/h`, {
          fontSize: 9,
          alignment: "right",
          color: PDF_COLORS.ink,
        }),
        buildPastelDataCell(formatCentsEs(input.laborCents ?? 0), {
          fontSize: 9.5,
          bold: true,
          alignment: "right",
          color: PDF_COLORS.ink,
        }),
      ]);
    } else if (billingMode === "partidas_mas_fijo_mano_obra" && (input.laborCents ?? 0) > 0) {
      const fixedLabor = input.laborCents ?? 0;
      lineRows.push([
        buildPastelDataCell("Mano de obra (importe fijo)", {
          fontSize: 9.5,
          color: PDF_COLORS.ink,
        }),
        buildPastelDataCell("1 ud", {
          fontSize: 9,
          alignment: "right",
          color: PDF_COLORS.ink,
        }),
        buildPastelDataCell(formatCentsEs(fixedLabor), {
          fontSize: 9,
          alignment: "right",
          color: PDF_COLORS.ink,
        }),
        buildPastelDataCell(formatCentsEs(fixedLabor), {
          fontSize: 9.5,
          bold: true,
          alignment: "right",
          color: PDF_COLORS.ink,
        }),
      ]);
    }

    lineRows.push([
      buildPastelSubtotalCell("Sub-Total"),
      buildPastelSubtotalCell("", "right"),
      buildPastelSubtotalCell("", "right"),
      buildPastelSubtotalCell(formatCentsEs(input.subtotalCents), "right"),
    ]);

    quoteTables.push(
      buildPastelTable({
        widths: ["*", "auto", "auto", "auto"],
        body: lineRows,
        marginBottom: 12,
      })
    );
  }

  const content: Array<Record<string, unknown>> = [
    buildUnifiedHeader({
      logoDataUrl: input.emitter.logoDataUrl,
      title: "PRESUPUESTO",
      documentNumber: input.quoteCode,
      metaLines: [`Fecha de emisión: ${input.issuedDateIso}`],
    }),
    buildUnifiedPartiesBlock({
      emitter: {
        name: input.emitter.name,
        nif: input.emitter.nif,
        fiscalAddress: input.emitter.fiscalAddress,
        phone: input.emitter.phone,
        email: input.emitter.email,
      },
      client: {
        name: input.client.name,
        nif: input.client.nif,
        fiscalAddress: input.client.fiscalAddress,
        phone: input.client.phone,
        email: input.client.email,
        emptyFallbackText: "Presupuesto simplificado sin datos de cliente asignados",
      },
    }),
  ];

  if (generalDescription.length > 0) {
    content.push(
      buildContextBanner({
        label: "Descripción general",
        value: generalDescription,
        variant: "cyan",
        marginBottom: estimatedDurationText ? 6 : 12,
      })
    );
  }

  if (estimatedDurationText) {
    content.push(
      buildContextBanner({
        label: "Tiempo estimado",
        value: estimatedDurationText,
        variant: "sky",
        marginBottom: 12,
      })
    );
  }

  content.push(...quoteTables);

  const closingStack: Array<Record<string, unknown>> = [];

  const trimmedNotes = input.notes?.trim() ?? "";
  const attachments = input.attachments ?? [];
  if (trimmedNotes.length > 0 || attachments.length > 0) {
    const notesStack: Array<Record<string, unknown>> = [
      {
        text: "Notas técnicas y certificaciones:",
        fontSize: 9,
        bold: true,
        color: PDF_COLORS.mutedText,
        margin: [0, 0, 0, 3],
      },
    ];
    if (trimmedNotes.length > 0) {
      notesStack.push({
        text: trimmedNotes,
        fontSize: 9,
        color: PDF_COLORS.mutedText,
        margin: [0, 0, 0, attachments.length > 0 ? 4 : 0],
      });
    }
    for (const att of attachments) {
      const excerpt = att.extractedText?.trim();
      notesStack.push({
        text: excerpt ? `• ${att.name}: ${excerpt}` : `• Documento adjunto: ${att.name}`,
        fontSize: 9,
        color: PDF_COLORS.mutedText,
        margin: [0, 1, 0, 1],
      });
    }
    closingStack.push({
      stack: notesStack,
      margin: [0, 0, 0, 12],
    });
  }

  closingStack.push(
    buildTotalsBanner([
      { label: "Base imponible", value: formatCentsEs(input.subtotalCents), alignment: "left" },
      { label: `IVA (${input.vatRate} %)`, value: formatCentsEs(input.vatCents), alignment: "center" },
      { label: "Total", value: formatCentsEs(input.totalCents), alignment: "right", emphasize: true },
    ])
  );

  const effectiveValidityDays =
    input.validityDays !== null &&
    input.validityDays !== undefined &&
    Number.isFinite(input.validityDays) &&
    input.validityDays > 0
      ? Math.round(input.validityDays)
      : 30;

  const trimmedPaymentTerms = input.paymentTermsText?.trim() ?? "";
  const paymentMethods = input.paymentMethods ?? [];
  const paymentSchedule = input.paymentSchedule ?? [];
  const scheduleAmounts = computePaymentScheduleAmounts(input.totalCents, paymentSchedule);
  const paymentConditionParts: string[] = [];

  if (trimmedPaymentTerms.length > 0) {
    paymentConditionParts.push(trimmedPaymentTerms);
  }
  if (scheduleAmounts.length > 0) {
    paymentConditionParts.push(
      scheduleAmounts
        .map((s) => `${s.label}: ${formatPercentEs(s.percentage)} (${formatCentsEs(s.amount_cents)})`)
        .join(" · ")
    );
  }
  if (paymentMethods.length > 0) {
    const methodLabels = paymentMethods.map((m) => PAYMENT_METHOD_LABELS[m] ?? m);
    paymentConditionParts.push(`Métodos aceptados: ${methodLabels.join(" · ")}`);
  }

  const validityBoxStack: Array<Record<string, unknown>> = [
    {
      text: "Presupuesto orientativo. Sujeto a diseño, medición y negociación.",
      fontSize: 8.5,
      bold: true,
      color: PDF_COLORS.creamText,
      alignment: "center",
      margin: [0, 0, 0, 3],
    },
    {
      text: `Presupuesto válido durante ${effectiveValidityDays} días.`,
      fontSize: 8.5,
      bold: true,
      color: PDF_COLORS.creamText,
      alignment: "center",
      margin: [0, 0, 0, 4],
    },
    {
      text: "El presupuesto no cubre imprevistos generados por problemas surgidos una vez empiecen las obras debido a vicios ocultos del inmueble. Importe estimado con materiales de calidades medias; puede variar según necesidades del cliente.",
      fontSize: 8,
      color: PDF_COLORS.creamText,
      alignment: "center",
    },
  ];

  if (paymentConditionParts.length > 0) {
    validityBoxStack.push({
      text: [
        { text: "Condiciones de pago: ", bold: true, color: PDF_COLORS.creamText },
        { text: paymentConditionParts.join(" | "), color: PDF_COLORS.creamText },
      ],
      fontSize: 8.5,
      alignment: "center",
      margin: [0, 5, 0, 0],
    });
  }

  closingStack.push(buildCreamNoticeBox(validityBoxStack, 10));

  const resolvedIban = input.ibanOverride?.trim() || input.emitter.iban?.trim() || "";
  const resolvedBankName = input.bankName?.trim() || input.emitter.bankName?.trim() || "";
  const shouldShowIban = (input.showIban ?? true) && resolvedIban.length > 0;

  if (shouldShowIban) {
    closingStack.push(buildIbanStrip(resolvedIban, resolvedBankName, 10));
  }

  closingStack.push(buildUnifiedFooter());

  content.push({
    stack: closingStack,
    unbreakable: true,
  });

  return {
    pageSize: PDF_PAGE_SIZE,
    pageMargins: PDF_PAGE_MARGINS,
    content,
  };
}

function invoiceKindLabel(
  kind: PdfInvoiceDocumentInput["invoiceKind"],
  advancePercent?: number
): string {
  switch (kind) {
    case "advance_40":
      return `Factura de anticipo (${formatPercentEs(advancePercent ?? 40)})`;
    case "final":
      return "Factura final / liquidación";
    case "full":
      return "Factura completa";
  }
}

export function buildInvoiceDocDefinition(input: PdfInvoiceDocumentInput): Record<string, unknown> {
  const kindText = invoiceKindLabel(input.invoiceKind, input.advancePercent);
  const irpfCents =
    input.irpfCents !== undefined && Number.isFinite(input.irpfCents) && input.irpfCents > 0
      ? input.irpfCents
      : 0;
  const lineGrossTotalCents = input.baseCents + input.vatCents;

  const headerMetaLines: Array<string | { text: string; bold?: boolean }> = [
    `Fecha de emisión: ${input.issuedAtIso}`,
    `Fecha de vencimiento: ${input.dueAtIso}`,
  ];

  if (input.isRectificative) {
    if (input.rectifiedInvoiceNumber?.trim()) {
      headerMetaLines.push({
        text: `Rectifica a: Nº ${input.rectifiedInvoiceNumber.trim()}`,
        bold: true,
      });
    }
    if (input.rectificationReason?.trim()) {
      headerMetaLines.push(`Motivo: ${input.rectificationReason.trim()}`);
    }
  }

  const rows: Array<Array<Record<string, unknown>>> = [
    [
      buildPastelHeaderCell("Concepto"),
      buildPastelHeaderCell("Base", "right"),
      buildPastelHeaderCell(`IVA (${input.vatRate} %)`, "right"),
      buildPastelHeaderCell("Total", "right"),
    ],
    [
      buildPastelDataCell(
        `${kindText} · Obra ${input.jobCode} (${input.jobTitle}) · Ref. ${input.quoteCode}`,
        { fontSize: 9 }
      ),
      buildPastelDataCell(formatCentsEs(input.baseCents), { fontSize: 9, alignment: "right" }),
      buildPastelDataCell(formatCentsEs(input.vatCents), { fontSize: 9, alignment: "right" }),
      buildPastelDataCell(formatCentsEs(lineGrossTotalCents), {
        fontSize: 9,
        bold: true,
        alignment: "right",
      }),
    ],
  ];

  if (input.advanceDeductedBaseCents > 0) {
    const deductedTotal = input.advanceDeductedBaseCents + input.advanceDeductedVatCents;
    rows.push([
      buildPastelDataCell(
        "Anticipo previo deducido (ya facturado y devengado en factura ANT)",
        { fontSize: 8.5, color: PDF_COLORS.slateSubtle }
      ),
      buildPastelDataCell(`-${formatCentsEs(input.advanceDeductedBaseCents)}`, {
        fontSize: 8.5,
        color: PDF_COLORS.slateSubtle,
        alignment: "right",
      }),
      buildPastelDataCell(`-${formatCentsEs(input.advanceDeductedVatCents)}`, {
        fontSize: 8.5,
        color: PDF_COLORS.slateSubtle,
        alignment: "right",
      }),
      buildPastelDataCell(`-${formatCentsEs(deductedTotal)}`, {
        fontSize: 8.5,
        color: PDF_COLORS.slateSubtle,
        alignment: "right",
      }),
    ]);
    rows.push([
      buildPastelSubtotalCell("Sub-Total", "left", 9),
      buildPastelSubtotalCell(formatCentsEs(input.baseCents), "right", 9),
      buildPastelSubtotalCell(formatCentsEs(input.vatCents), "right", 9),
      buildPastelSubtotalCell(formatCentsEs(lineGrossTotalCents), "right", 9),
    ]);
  }

  const secondarySegments: Array<{ label?: string; text: string }> = [];
  if (input.quoteCode?.trim()) {
    secondarySegments.push({ label: "Ref. presupuesto", text: input.quoteCode.trim() });
  }
  secondarySegments.push({ label: "Tipo", text: kindText });

  const content: Array<Record<string, unknown>> = [
    buildUnifiedHeader({
      logoDataUrl: input.emitter.logoDataUrl,
      title: input.isRectificative ? "FACTURA RECTIFICATIVA" : "FACTURA",
      titleFontSize: input.isRectificative ? 16 : 18,
      documentNumber: input.invoiceNumber,
      metaLines: headerMetaLines,
    }),
    buildUnifiedPartiesBlock({
      emitter: {
        name: input.emitter.name,
        nif: input.emitter.nif,
        fiscalAddress: input.emitter.fiscalAddress,
        phone: input.emitter.phone,
        email: input.emitter.email,
      },
      client: {
        name: input.client.name,
        nif: input.client.nif,
        fiscalAddress: input.client.fiscalAddress,
        phone: input.client.phone,
        email: input.client.email,
      },
    }),
    buildContextBanner({
      label: "Obra",
      value: `${input.jobCode} · ${input.jobTitle}`,
      secondarySegments,
      variant: "cyan",
      marginBottom: 12,
    }),
    buildPastelTable({
      widths: ["*", 72, 72, 76],
      body: rows,
      marginBottom: 12,
    }),
  ];

  const closingStack: Array<Record<string, unknown>> = [];

  const totalsItems: TotalsBannerItem[] = [
    { label: "Base imponible", value: formatCentsEs(input.baseCents), alignment: "left" },
    { label: `IVA (${input.vatRate} %)`, value: formatCentsEs(input.vatCents), alignment: "center" },
  ];

  if (irpfCents > 0) {
    const irpfRateLabel =
      input.irpfRate !== undefined && Number.isFinite(input.irpfRate) ? input.irpfRate : 0;
    totalsItems.push({
      label: `Retención IRPF (-${irpfRateLabel} %)`,
      value: `-${formatCentsEs(irpfCents)}`,
      alignment: "center",
    });
  }

  totalsItems.push({
    label: "TOTAL FACTURA",
    value: formatCentsEs(input.totalCents),
    alignment: "right",
    emphasize: true,
  });

  closingStack.push(buildTotalsBanner(totalsItems, 10));

  const paymentMethod = input.paymentMethod?.trim() ?? "";
  const paymentStatus = input.paymentStatus?.trim() ?? "";
  if (paymentMethod || paymentStatus) {
    const paymentRuns: Array<Record<string, unknown>> = [];
    if (paymentMethod) {
      paymentRuns.push(
        { text: "Forma de pago: ", bold: true, color: PDF_COLORS.ink },
        { text: paymentMethod, color: PDF_COLORS.ink }
      );
    }
    if (paymentStatus) {
      if (paymentRuns.length > 0) {
        paymentRuns.push({ text: "   ·   ", color: PDF_COLORS.ink });
      }
      paymentRuns.push(
        { text: "Estado: ", bold: true, color: PDF_COLORS.ink },
        { text: paymentStatus, bold: true, color: PDF_COLORS.ink }
      );
    }
    closingStack.push({
      table: {
        dontBreakRows: true,
        widths: ["*"],
        body: [
          [
            {
              text: paymentRuns,
              fontSize: 9,
              fillColor: PDF_COLORS.contextSkyBg,
              margin: [8, 5, 8, 5],
            },
          ],
        ],
      },
      layout: "noBorders",
      margin: [0, 0, 0, 8],
    });
  }

  const trimmedNotes = input.notes?.trim() ?? "";
  if (trimmedNotes.length > 0) {
    closingStack.push({
      stack: [
        {
          text: "Observaciones:",
          fontSize: 9,
          bold: true,
          color: PDF_COLORS.mutedText,
          margin: [0, 0, 0, 2],
        },
        {
          text: trimmedNotes,
          fontSize: 9,
          color: PDF_COLORS.mutedText,
        },
      ],
      margin: [0, 0, 0, 8],
    });
  }

  const resolvedIban = input.emitter.iban?.trim() ?? "";
  const resolvedBankName = input.emitter.bankName?.trim() ?? "";
  const legalNotice = input.legalNotice?.trim() ?? "";

  if (resolvedIban.length > 0) {
    closingStack.push(buildIbanStrip(resolvedIban, resolvedBankName, legalNotice ? 6 : 10));
    if (legalNotice) {
      closingStack.push({
        text: legalNotice,
        fontSize: 8,
        color: PDF_COLORS.slateSubtle,
        alignment: "center",
        margin: [0, 0, 0, 8],
      });
    }
  } else {
    closingStack.push(
      buildSlateInfoStrip(
        legalNotice || "Factura emitida conforme al Reglamento de Facturación (RD 1619/2012).",
        { alignment: "center", fontSize: 8.5, marginBottom: 10 }
      )
    );
  }

  closingStack.push(buildUnifiedFooter());

  content.push({
    stack: closingStack,
    unbreakable: true,
  });

  return {
    pageSize: PDF_PAGE_SIZE,
    pageMargins: PDF_PAGE_MARGINS,
    content,
  };
}

export function buildWorkOrderDocDefinition(
  input: PdfWorkOrderDocumentInput
): Record<string, unknown> {
  const isAlbaran = input.documentType === "albaran";
  const showPrices = input.showPrices === true;

  const headerMetaLines: string[] = [`Fecha: ${input.issuedDateIso}`];
  if (input.hoursWorkedLabel?.trim()) {
    headerMetaLines.push(`Jornada / Horas: ${input.hoursWorkedLabel.trim()}`);
  }

  const contextValue = input.jobCode?.trim()
    ? `${input.jobCode.trim()} · ${input.jobTitle}`
    : input.jobTitle;

  const secondarySegments: Array<{ label?: string; text: string }> = [];
  if (input.quoteCode?.trim()) {
    secondarySegments.push({ label: "Ref. presupuesto", text: input.quoteCode.trim() });
  }

  const formatItemDescription = (item: PdfWorkOrderDocumentInput["items"][number]): string => {
    if (item.kind === "material") return `[Material] ${item.description}`;
    if (item.kind === "tarea") return `[Tarea] ${item.description}`;
    return item.description;
  };

  let tableNode: Record<string, unknown>;
  if (showPrices) {
    const computedSubtotal =
      input.subtotalCents !== undefined && Number.isFinite(input.subtotalCents)
        ? input.subtotalCents
        : input.items.reduce((acc, item) => acc + (item.lineSubtotalCents ?? 0), 0);

    const rows: Array<Array<Record<string, unknown>>> = [
      [
        buildPastelHeaderCell("Conceptos realizados / Materiales suministrados"),
        buildPastelHeaderCell("Cantidad / Horas", "right"),
        buildPastelHeaderCell("Precio unit.", "right"),
        buildPastelHeaderCell("Importe", "right"),
      ],
      ...input.items.map((item) => [
        buildPastelDataCell(formatItemDescription(item), { fontSize: 9 }),
        buildPastelDataCell(item.quantityLabel, { fontSize: 9, alignment: "right" }),
        buildPastelDataCell(formatCentsEs(item.unitPriceCents ?? 0), {
          fontSize: 9,
          alignment: "right",
        }),
        buildPastelDataCell(formatCentsEs(item.lineSubtotalCents ?? 0), {
          fontSize: 9,
          bold: true,
          alignment: "right",
        }),
      ]),
      [
        buildPastelSubtotalCell("Sub-Total", "left", 9),
        buildPastelSubtotalCell("", "right", 9),
        buildPastelSubtotalCell("", "right", 9),
        buildPastelSubtotalCell(formatCentsEs(computedSubtotal), "right", 9),
      ],
    ];

    tableNode = buildPastelTable({
      widths: ["*", 78, 72, 78],
      body: rows,
      marginBottom: 12,
    });
  } else {
    const rows: Array<Array<Record<string, unknown>>> = [
      [
        buildPastelHeaderCell("Conceptos realizados / Materiales suministrados"),
        buildPastelHeaderCell("Cantidad / Horas", "right"),
      ],
      ...input.items.map((item) => [
        buildPastelDataCell(formatItemDescription(item), { fontSize: 9.5 }),
        buildPastelDataCell(item.quantityLabel, {
          fontSize: 9.5,
          bold: true,
          alignment: "right",
        }),
      ]),
    ];

    tableNode = buildPastelTable({
      widths: ["*", 110],
      body: rows,
      marginBottom: 12,
    });
  }

  const content: Array<Record<string, unknown>> = [
    buildUnifiedHeader({
      logoDataUrl: input.emitter.logoDataUrl,
      title: isAlbaran ? "ALBARÁN DE ENTREGA" : "PARTE DE TRABAJO",
      titleFontSize: 17,
      documentNumber: input.documentCode,
      metaLines: headerMetaLines,
    }),
    buildUnifiedPartiesBlock({
      emitter: {
        name: input.emitter.name,
        nif: input.emitter.nif,
        fiscalAddress: input.emitter.fiscalAddress,
        phone: input.emitter.phone,
        email: input.emitter.email,
      },
      client: {
        name: input.client.name,
        nif: input.client.nif,
        fiscalAddress: input.client.fiscalAddress,
        phone: input.client.phone,
        email: input.client.email,
      },
    }),
    buildContextBanner({
      label: "Obra / Servicio",
      value: contextValue,
      secondarySegments,
      variant: "cyan",
      marginBottom: 12,
    }),
    tableNode,
  ];

  const closingStack: Array<Record<string, unknown>> = [];

  const trimmedNotes = input.notes?.trim() ?? "";
  if (trimmedNotes.length > 0) {
    closingStack.push({
      stack: [
        {
          text: "Observaciones del trabajo:",
          fontSize: 9,
          bold: true,
          color: PDF_COLORS.mutedText,
          margin: [0, 0, 0, 2],
        },
        {
          text: trimmedNotes,
          fontSize: 9,
          color: PDF_COLORS.mutedText,
        },
      ],
      margin: [0, 0, 0, 10],
    });
  }

  closingStack.push(
    buildDualSignatureBlock({
      left: {
        title: "Firma del Profesional",
        signatureDataUrl: input.firmaProfesionalDataUrl,
        name: input.emitter.name,
        nif: input.emitter.nif,
      },
      right: {
        title: "Firma / Conformidad del Cliente",
        signatureDataUrl: input.firmaClienteDataUrl,
        name: input.receiverName?.trim() || input.client.name,
        nif: input.receiverNif?.trim() || input.client.nif,
      },
      marginBottom: 10,
    })
  );

  closingStack.push(
    buildSlateInfoStrip(
      isAlbaran
        ? "Albarán de entrega de materiales y trabajos realizados · Documento sin validez fiscal como factura"
        : "Parte de trabajo y conformidad del servicio realizado · Documento de control y trazabilidad en obra",
      { alignment: "center", fontSize: 8.5, marginBottom: 10 }
    )
  );

  closingStack.push(buildUnifiedFooter());

  content.push({
    stack: closingStack,
    unbreakable: true,
  });

  return {
    pageSize: PDF_PAGE_SIZE,
    pageMargins: PDF_PAGE_MARGINS,
    content,
  };
}

const ESPECIALIDAD_PDF_LABELS: Record<PdfActaDocumentInput["data"]["especialidad"], string> = {
  electricidad: "Electricidad (Baja Tensión)",
  fontaneria: "Fontanería y ACS",
  mixta: "Mixta (Electricidad + Fontanería)",
};

const TIPO_ACTUACION_PDF_LABELS: Record<PdfActaDocumentInput["data"]["tipo_actuacion"], string> = {
  obra_nueva: "Obra nueva",
  reforma_integral: "Reforma integral",
  modificacion_parcial: "Modificación parcial",
  reparacion_sustitucion: "Reparación / Sustitución",
};

function formatMeasure(val: number | null | undefined, unit: string): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return "No medido";
  return `${String(val).replace(".", ",")} ${unit}`;
}

export function buildActaDocDefinition(input: PdfActaDocumentInput): Record<string, unknown> {
  const { data } = input;
  const needsElec = data.especialidad === "electricidad" || data.especialidad === "mixta";
  const needsFont = data.especialidad === "fontaneria" || data.especialidad === "mixta";

  const emitterExtraLines: Array<{ text: string; bold?: boolean }> = [];
  if (data.instalador.num_registro_empresa?.trim()) {
    emitterExtraLines.push({
      text: `Reg. Empresa (REIE/RII): ${data.instalador.num_registro_empresa.trim()}`,
    });
  }
  emitterExtraLines.push({
    text: `Técnico: ${data.instalador.tecnico_nombre || "-"} (${data.instalador.tecnico_dni || "-"})`,
    bold: true,
  });
  if (data.instalador.num_carne_instalador?.trim()) {
    emitterExtraLines.push({
      text: `Carné instalador: ${data.instalador.num_carne_instalador.trim()}`,
    });
  }

  const content: Array<Record<string, unknown>> = [
    buildUnifiedHeader({
      logoDataUrl: input.emitterLogoDataUrl,
      title: "ACTA DE PUESTA EN MARCHA",
      titleFontSize: 16,
      documentNumber: input.codigoActa,
      metaLines: [`Fecha de intervención: ${data.fecha_emision}`],
      marginBottom: 14,
    }),
    buildUnifiedPartiesBlock({
      emitterTitle: "EMISOR",
      clientTitle: "CLIENTE",
      emitter: {
        name: data.instalador.nombre_razon_social,
        nif: data.instalador.nif_cif,
        fiscalAddress: data.instalador.domicilio_fiscal,
        phone: data.instalador.telefono,
        email: data.instalador.email,
        extraLines: emitterExtraLines,
      },
      client: {
        name: data.cliente.nombre_razon_social,
        nif: data.cliente.nif_cif,
        fiscalAddress: data.cliente.direccion_emplazamiento,
        addressPrefix: "Emplazamiento: ",
        phone: data.cliente.telefono,
        email: data.cliente.email,
      },
      marginBottom: 12,
    }),
    buildContextBanner({
      label: "Alcance y ubicación en obra",
      value: data.alcance_ubicacion.trim() || data.cliente.direccion_emplazamiento || "-",
      secondarySegments: [
        { label: "Especialidad", text: ESPECIALIDAD_PDF_LABELS[data.especialidad] },
        { label: "Actuación", text: TIPO_ACTUACION_PDF_LABELS[data.tipo_actuacion] },
      ],
      variant: "cyan",
      marginBottom: 10,
    }),
  ];

  if (needsElec && data.memoria_electricidad) {
    const me = data.memoria_electricidad;
    content.push(buildSectionBanner("MEMORIA DESCRIPTIVA · ELECTRICIDAD (REBT)"));
    content.push(
      buildPastelTable({
        widths: [165, "*"],
        body: [
          [
            buildPastelHeaderCell("Parámetro técnico", "left", 8.5),
            buildPastelHeaderCell("Especificación", "left", 8.5),
          ],
          [
            buildPastelDataCell("Tensión nominal", { fontSize: 8.5, bold: true }),
            buildPastelDataCell(me.tension_nominal, { fontSize: 8.5 }),
          ],
          [
            buildPastelDataCell("Interruptor General (IGA)", { fontSize: 8.5, bold: true }),
            buildPastelDataCell(`${me.iga_amperios} A`, { fontSize: 8.5 }),
          ],
          [
            buildPastelDataCell("Protector sobretensiones", { fontSize: 8.5, bold: true }),
            buildPastelDataCell(me.protector_sobretensiones ? "Sí instalado" : "No", { fontSize: 8.5 }),
          ],
          [
            buildPastelDataCell("Diferencial", { fontSize: 8.5, bold: true }),
            buildPastelDataCell(me.diferencial_calibre || "-", { fontSize: 8.5 }),
          ],
          [
            buildPastelDataCell("Receptores conectados", { fontSize: 8.5, bold: true }),
            buildPastelDataCell(me.receptores_conectados || "-", { fontSize: 8.5 }),
          ],
        ],
        marginBottom: me.circuitos.length > 0 ? 6 : 10,
      })
    );

    if (me.circuitos.length > 0) {
      content.push(
        buildPastelTable({
          widths: ["*", 75, 85],
          body: [
            [
              buildPastelHeaderCell("Circuito", "left", 8.5),
              buildPastelHeaderCell("Calibre", "right", 8.5),
              buildPastelHeaderCell("Sección", "right", 8.5),
            ],
            ...me.circuitos.map((c) => [
              buildPastelDataCell(c.nombre, { fontSize: 8.5 }),
              buildPastelDataCell(`${c.calibre_a} A`, { fontSize: 8.5, alignment: "right" }),
              buildPastelDataCell(`${String(c.seccion_mm2).replace(".", ",")} mm²`, {
                fontSize: 8.5,
                alignment: "right",
              }),
            ]),
          ],
          marginBottom: 10,
        })
      );
    }
  }

  if (needsFont && data.memoria_fontaneria) {
    const mf = data.memoria_fontaneria;
    content.push(buildSectionBanner("MEMORIA DESCRIPTIVA · FONTANERÍA Y ACS (CTE HS-4)"));
    content.push(
      buildPastelTable({
        widths: [165, "*"],
        body: [
          [
            buildPastelHeaderCell("Parámetro técnico", "left", 8.5),
            buildPastelHeaderCell("Especificación", "left", 8.5),
          ],
          [
            buildPastelDataCell("Redes intervenidas", { fontSize: 8.5, bold: true }),
            buildPastelDataCell(mf.redes_intervenidas.join(", ") || "-", { fontSize: 8.5 }),
          ],
          [
            buildPastelDataCell("Material de tuberías", { fontSize: 8.5, bold: true }),
            buildPastelDataCell(mf.material_tuberias || "-", { fontSize: 8.5 }),
          ],
          [
            buildPastelDataCell("Diámetros instalados", { fontSize: 8.5, bold: true }),
            buildPastelDataCell(mf.diametros_mm || "-", { fontSize: 8.5 }),
          ],
          [
            buildPastelDataCell("Llaves de corte", { fontSize: 8.5, bold: true }),
            buildPastelDataCell(mf.ubicacion_llaves_corte || "-", { fontSize: 8.5 }),
          ],
          [
            buildPastelDataCell("Equipos sanitarios", { fontSize: 8.5, bold: true }),
            buildPastelDataCell(mf.equipos_sanitarios || "-", { fontSize: 8.5 }),
          ],
        ],
        marginBottom: 10,
      })
    );
  }

  if (needsElec && data.pruebas_electricidad) {
    const pe = data.pruebas_electricidad;
    content.push(buildSectionBanner("PROTOCOLO DE VERIFICACIÓN Y PRUEBAS · ELECTRICIDAD"));
    content.push(
      buildPastelTable({
        widths: ["*", 130],
        body: [
          [
            buildPastelHeaderCell("Verificación / Medición", "left", 8.5),
            buildPastelHeaderCell("Resultado", "right", 8.5),
          ],
          [
            buildPastelDataCell("Inspección visual de bornes y etiquetado", { fontSize: 8.5 }),
            buildStatusBadgeCell(
              pe.inspeccion_visual_bornes_etiquetado ? "OK / Conforme" : "Incidencia / No Apto",
              pe.inspeccion_visual_bornes_etiquetado
            ),
          ],
          [
            buildPastelDataCell("Continuidad de protección y equipotencial", { fontSize: 8.5 }),
            buildStatusBadgeCell(
              pe.continuidad_proteccion_equipotencial ? "OK / Conforme" : "Incidencia / No Apto",
              pe.continuidad_proteccion_equipotencial
            ),
          ],
          [
            buildPastelDataCell("Resistencia de aislamiento", { fontSize: 8.5 }),
            buildPastelDataCell(formatMeasure(pe.resistencia_aislamiento_mohm, "MΩ"), {
              fontSize: 8.5,
              alignment: "right",
            }),
          ],
          [
            buildPastelDataCell("Resistencia de puesta a tierra", { fontSize: 8.5 }),
            buildPastelDataCell(formatMeasure(pe.resistencia_tierra_ohm, "Ω"), {
              fontSize: 8.5,
              alignment: "right",
            }),
          ],
          [
            buildPastelDataCell("Tiempo de disparo diferencial", { fontSize: 8.5 }),
            buildPastelDataCell(formatMeasure(pe.disparo_diferencial_ms, "ms"), {
              fontSize: 8.5,
              alignment: "right",
            }),
          ],
          [
            buildPastelDataCell("Tensión comprobada en servicio", { fontSize: 8.5 }),
            buildPastelDataCell(formatMeasure(pe.tension_comprobada_v, "V"), {
              fontSize: 8.5,
              alignment: "right",
            }),
          ],
          [
            buildPastelDataCell("Dictamen verificación eléctrica", { fontSize: 8.5, bold: true }),
            buildStatusBadgeCell(
              pe.resultado_apto ? "OK / Conforme (APTO)" : "Incidencia / No Apto",
              pe.resultado_apto
            ),
          ],
        ],
        marginBottom: 10,
      })
    );
  }

  if (needsFont && data.pruebas_fontaneria) {
    const pf = data.pruebas_fontaneria;
    content.push(buildSectionBanner("PROTOCOLO DE VERIFICACIÓN Y PRUEBAS · FONTANERÍA"));
    content.push(
      buildPastelTable({
        widths: ["*", 130],
        body: [
          [
            buildPastelHeaderCell("Verificación / Medición", "left", 8.5),
            buildPastelHeaderCell("Resultado", "right", 8.5),
          ],
          [
            buildPastelDataCell("Presión de prueba hidráulica", { fontSize: 8.5 }),
            buildPastelDataCell(formatMeasure(pf.presion_prueba_bar, "bar"), {
              fontSize: 8.5,
              alignment: "right",
            }),
          ],
          [
            buildPastelDataCell("Duración de prueba", { fontSize: 8.5 }),
            buildPastelDataCell(formatMeasure(pf.duracion_prueba_min, "min"), {
              fontSize: 8.5,
              alignment: "right",
            }),
          ],
          [
            buildPastelDataCell("Estanqueidad comprobada sin fugas", { fontSize: 8.5 }),
            buildStatusBadgeCell(
              pf.estanqueidad_sin_fugas ? "OK / Conforme" : "Incidencia / No Apto",
              pf.estanqueidad_sin_fugas
            ),
          ],
          [
            buildPastelDataCell("Presión de servicio en grifería", { fontSize: 8.5 }),
            buildPastelDataCell(formatMeasure(pf.presion_servicio_bar, "bar"), {
              fontSize: 8.5,
              alignment: "right",
            }),
          ],
          [
            buildPastelDataCell("Comprobación de desagües y válvulas", { fontSize: 8.5 }),
            buildStatusBadgeCell(
              pf.comprobacion_desagues_valvulas ? "OK / Conforme" : "Incidencia / No Apto",
              pf.comprobacion_desagues_valvulas
            ),
          ],
          ...(pf.temperatura_consigna_acs_c !== null && pf.temperatura_consigna_acs_c !== undefined
            ? [
                [
                  buildPastelDataCell("Temperatura consigna ACS", { fontSize: 8.5 }),
                  buildPastelDataCell(formatMeasure(pf.temperatura_consigna_acs_c, "°C"), {
                    fontSize: 8.5,
                    alignment: "right",
                  }),
                ],
              ]
            : []),
          [
            buildPastelDataCell("Dictamen verificación fontanería", { fontSize: 8.5, bold: true }),
            buildStatusBadgeCell(
              pf.resultado_apto ? "OK / Conforme (APTO)" : "Incidencia / No Apto",
              pf.resultado_apto
            ),
          ],
        ],
        marginBottom: 10,
      })
    );
  }

  const boundedPhotos = input.resolvedFotos.slice(0, 2);
  if (boundedPhotos.length > 0) {
    content.push(buildSectionBanner("ANEXO FOTOGRÁFICO DE OBRA"));
    const buildPhotoCell = (item: { dataUrl: string; pieFoto: string }) => ({
      stack: [
        { image: item.dataUrl, fit: [235, 145], alignment: "center", margin: [0, 0, 0, 4] },
        {
          text: item.pieFoto || "Fotografía de instalación",
          fontSize: 8,
          color: PDF_COLORS.slateSubtle,
          alignment: "center",
        },
      ],
      margin: [0, 4, 0, 6],
    });

    const leftPhoto = boundedPhotos[0]!;
    const rightPhoto = boundedPhotos[1];
    content.push({
      table: {
        dontBreakRows: true,
        widths: ["*", "*"],
        body: [[buildPhotoCell(leftPhoto), rightPhoto ? buildPhotoCell(rightPhoto) : { text: "" }]],
      },
      layout: "noBorders",
      margin: [0, 0, 0, 10],
    });
  }

  const warrantyStack: Array<Record<string, unknown>> = [
    {
      text: "Garantía de instalación y recomendaciones de mantenimiento",
      fontSize: 8.5,
      bold: true,
      color: PDF_COLORS.creamText,
      margin: [0, 0, 0, 4],
    },
  ];
  if (data.instrucciones_mantenimiento?.trim()) {
    warrantyStack.push({
      text: data.instrucciones_mantenimiento.trim(),
      fontSize: 8,
      color: PDF_COLORS.creamText,
      margin: [0, 0, 0, 3],
    });
  }
  if (data.clausula_conformidad?.trim()) {
    warrantyStack.push({
      text: data.clausula_conformidad.trim(),
      fontSize: 8,
      color: PDF_COLORS.creamText,
      margin: [0, 0, 0, 3],
    });
  }
  if (data.clausula_recepcion_cliente?.trim()) {
    warrantyStack.push({
      text: data.clausula_recepcion_cliente.trim(),
      fontSize: 8,
      color: PDF_COLORS.creamText,
    });
  }

  const closingStack: Array<Record<string, unknown>> = [
    buildCreamNoticeBox(warrantyStack, 10),
    buildDualSignatureBlock({
      left: {
        title: "Firma del Instalador",
        signatureDataUrl: input.firmaInstaladorDataUrl,
        name: data.instalador.tecnico_nombre || data.instalador.nombre_razon_social,
        nif: data.instalador.tecnico_dni || data.instalador.nif_cif,
      },
      right: {
        title: "Firma del Cliente",
        signatureDataUrl: input.firmaClienteDataUrl,
        name: data.cliente.nombre_razon_social,
        nif: data.cliente.nif_cif,
      },
      marginBottom: 10,
    }),
    buildSlateInfoStrip(
      "Acta técnica de entrega y garantía · No sustituye al CIE ante Industria",
      { alignment: "center", fontSize: 8.5, marginBottom: 10 }
    ),
    buildUnifiedFooter(),
  ];

  content.push({
    stack: closingStack,
    unbreakable: true,
  });

  return {
    pageSize: PDF_PAGE_SIZE,
    pageMargins: PDF_PAGE_MARGINS,
    content,
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

    let docDef: Record<string, unknown>;
    let fileName: string;
    switch (input.kind) {
      case "quote":
        docDef = buildQuoteDocDefinition(input);
        fileName = `${input.quoteCode}.pdf`;
        break;
      case "invoice":
        docDef = buildInvoiceDocDefinition(input);
        fileName = `${input.invoiceNumber}.pdf`;
        break;
      case "work_order":
        docDef = buildWorkOrderDocDefinition(input);
        fileName = `${input.documentCode}.pdf`;
        break;
      case "acta":
        docDef = buildActaDocDefinition(input);
        fileName = `${input.codigoActa}.pdf`;
        break;
    }

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
