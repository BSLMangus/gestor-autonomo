import type {
  MemoryCoordinator,
  QuotePaymentMethod,
} from "../../core/contracts/types";
import {
  computePaymentScheduleAmounts,
  formatCentsEs,
  formatPercentEs,
} from "../../core/fiscal/fiscalEngine";
import type {
  PdfActaDocumentInput,
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

const PAYMENT_METHOD_LABELS: Record<QuotePaymentMethod, string> = {
  transferencia: "Transferencia bancaria",
  efectivo: "Efectivo",
  bizum: "Bizum",
  tarjeta: "Tarjeta",
};

function buildPartyBlock(
  label: string,
  party: { name: string; nif: string; fiscalAddress: string; phone: string; iban?: string },
  options?: { allowEmpty?: boolean }
): Record<string, unknown> {
  const hasName = party.name.trim().length > 0;
  if (options?.allowEmpty && !hasName) {
    return {
      stack: [
        { text: label, fontSize: 8, bold: true, color: "#64748b", margin: [0, 0, 0, 2] },
        {
          text: "Presupuesto simplificado sin datos de cliente asignados",
          italics: true,
          fontSize: 9,
          color: "#64748b",
        },
      ],
    };
  }
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

  const paymentMethods = input.paymentMethods ?? [];
  const paymentSchedule = input.paymentSchedule ?? [];
  const scheduleAmounts = computePaymentScheduleAmounts(input.totalCents, paymentSchedule);
  const paymentBlocks: Array<Record<string, unknown>> = [];

  if (paymentMethods.length > 0 || scheduleAmounts.length > 0) {
    const methodLabels = paymentMethods.map((m) => PAYMENT_METHOD_LABELS[m] ?? m);
    paymentBlocks.push({
      stack: [
        {
          text: "CONDICIONES Y FORMA DE PAGO",
          fontSize: 8.5,
          bold: true,
          color: "#0f172a",
          margin: [0, 12, 0, 4],
        },
        ...(methodLabels.length > 0
          ? [
              {
                text: `Métodos aceptados: ${methodLabels.join(" · ")}`,
                fontSize: 9,
                color: "#334155",
                margin: [0, 0, 0, 3],
              },
            ]
          : []),
        ...(paymentMethods.includes("transferencia") && input.emitter.iban
          ? [
              {
                text: `Cuenta bancaria (IBAN): ${input.emitter.iban}`,
                fontSize: 8.5,
                bold: true,
                color: "#334155",
                margin: [0, 0, 0, 4],
              },
            ]
          : []),
        ...(scheduleAmounts.length > 0
          ? [
              {
                table: {
                  headerRows: 1,
                  widths: ["*", 64, 84],
                  body: [
                    [
                      { text: "Hito de pago", style: "th" },
                      { text: "Porcentaje", style: "th", alignment: "right" },
                      { text: "Importe", style: "th", alignment: "right" },
                    ],
                    ...scheduleAmounts.map((step) => [
                      { text: step.label, fontSize: 9, color: "#0f172a" },
                      {
                        text: formatPercentEs(step.percentage),
                        fontSize: 9,
                        alignment: "right",
                        color: "#334155",
                      },
                      {
                        text: formatCentsEs(step.amount_cents),
                        fontSize: 9,
                        bold: true,
                        alignment: "right",
                        color: "#0f172a",
                      },
                    ]),
                  ],
                },
                layout: "lightHorizontalLines",
                margin: [0, 2, 0, 4],
              },
            ]
          : []),
      ],
    });
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
              { text: "PRESUPUESTO DE OBRA", fontSize: 16, bold: true, color: "#0f172a" },
              { text: `Código: ${input.quoteCode}`, fontSize: 11, bold: true, color: "#ea580c", margin: [0, 3, 0, 0] },
              { text: `Obra: ${input.jobTitle}`, fontSize: 9.5, color: "#334155", margin: [0, 2, 0, 0] },
            ],
          },
          {
            stack: [
              { text: `Fecha emisión: ${input.issuedDateIso}`, fontSize: 9.5, alignment: "right" },
              ...(input.validityDays
                ? [
                    {
                      text: input.validUntilIso
                        ? `Validez: ${input.validityDays} días (hasta ${input.validUntilIso})`
                        : `Validez: ${input.validityDays} días`,
                      fontSize: 9,
                      bold: true,
                      color: "#334155",
                      alignment: "right",
                      margin: [0, 2, 0, 0],
                    },
                  ]
                : []),
              { text: "Documento generado 100 % offline", fontSize: 8, color: "#64748b", alignment: "right", margin: [0, 2, 0, 0] },
            ],
          },
        ],
        margin: [0, 0, 0, 14],
      },
      {
        columns: [
          buildPartyBlock("EMISOR / PROFESIONAL", input.emitter),
          buildPartyBlock("CLIENTE", input.client, { allowEmpty: true }),
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
        margin: [0, 0, 0, 14],
      },
      {
        columns: [
          { width: "*", text: "" },
          {
            width: 210,
            table: {
              widths: ["*", 84],
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
      ...paymentBlocks,
      ...(input.notes
        ? [
            {
              stack: [
                {
                  text: "OBSERVACIONES Y CONDICIONES ADICIONALES",
                  fontSize: 8.5,
                  bold: true,
                  color: "#0f172a",
                  margin: [0, 12, 0, 3],
                },
                { text: input.notes, fontSize: 8.5, color: "#475569" },
              ],
            },
          ]
        : []),
    ],
    styles: {
      th: { fontSize: 9, bold: true, color: "#0f172a", fillColor: "#f1f5f9", margin: [0, 3, 0, 3] },
    },
  };
}

function invoiceKindLabel(
  kind: PdfInvoiceDocumentInput["invoiceKind"],
  advancePercent?: number
): string {
  switch (kind) {
    case "advance_40":
      return `FACTURA DE ANTICIPO (${formatPercentEs(advancePercent ?? 40)})`;
    case "final":
      return "FACTURA FINAL / LIQUIDACIÓN";
    case "full":
      return "FACTURA COMPLETA";
  }
}

function buildInvoiceDocDefinition(input: PdfInvoiceDocumentInput): Record<string, unknown> {
  const kindText = invoiceKindLabel(input.invoiceKind, input.advancePercent);
  const rows: Array<Array<Record<string, unknown>>> = [
    [
      { text: "Concepto", style: "th" },
      { text: "Base", style: "th", alignment: "right" },
      { text: `IVA (${input.vatRate} %)`, style: "th", alignment: "right" },
      { text: "Total", style: "th", alignment: "right" },
    ],
    [
      {
        text: `${kindText} · Obra ${input.jobCode} (${input.jobTitle}) · Ref. ${input.quoteCode}`,
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
              { text: kindText, fontSize: 15, bold: true, color: "#0f172a" },
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

function buildActaDocDefinition(input: PdfActaDocumentInput): Record<string, unknown> {
  const { data } = input;
  const needsElec = data.especialidad === "electricidad" || data.especialidad === "mixta";
  const needsFont = data.especialidad === "fontaneria" || data.especialidad === "mixta";

  const content: Array<Record<string, unknown>> = [
    {
      columns: [
        {
          stack: [
            ...(input.emitterLogoDataUrl
              ? [{ image: input.emitterLogoDataUrl, fit: [100, 40], margin: [0, 0, 0, 6] }]
              : []),
            {
              text: "ACTA DE PUESTA EN MARCHA Y CERTIFICACIÓN INTERNA",
              fontSize: 13.5,
              bold: true,
              color: "#0f172a",
            },
            {
              text: `Código: ${input.codigoActa}`,
              fontSize: 11,
              bold: true,
              color: "#ea580c",
              margin: [0, 3, 0, 0],
            },
            {
              text: `${ESPECIALIDAD_PDF_LABELS[data.especialidad]} · ${TIPO_ACTUACION_PDF_LABELS[data.tipo_actuacion]}`,
              fontSize: 9,
              color: "#334155",
              margin: [0, 2, 0, 0],
            },
          ],
        },
        {
          width: 175,
          stack: [
            { text: `Fecha emisión: ${data.fecha_emision}`, fontSize: 9, alignment: "right" },
            {
              text: `Estado: ${input.estado.toUpperCase()}`,
              fontSize: 9,
              bold: true,
              color: input.estado === "firmada" ? "#15803d" : "#334155",
              alignment: "right",
              margin: [0, 2, 0, 0],
            },
            {
              text: "Acta técnica de entrega y garantía · No sustituye al CIE ante Industria",
              fontSize: 7.5,
              color: "#64748b",
              alignment: "right",
              margin: [0, 3, 0, 0],
            },
          ],
        },
      ],
      margin: [0, 0, 0, 10],
    },
    ...(data.alcance_ubicacion.trim()
      ? [
          {
            table: {
              widths: ["*"],
              body: [
                [
                  {
                    stack: [
                      {
                        text: "ALCANCE Y UBICACIÓN EN OBRA",
                        fontSize: 7.5,
                        bold: true,
                        color: "#64748b",
                        margin: [0, 0, 0, 2],
                      },
                      { text: data.alcance_ubicacion, fontSize: 9, color: "#0f172a" },
                    ],
                    fillColor: "#f8fafc",
                    margin: [8, 6, 8, 6],
                  },
                ],
              ],
            },
            layout: "noBorders",
            margin: [0, 0, 0, 10],
          },
        ]
      : []),
    {
      columns: [
        {
          stack: [
            { text: "INSTALADOR AUTORIZADO", fontSize: 8, bold: true, color: "#64748b", margin: [0, 0, 0, 2] },
            { text: data.instalador.nombre_razon_social || "-", bold: true, fontSize: 9.5 },
            { text: `NIF/CIF: ${data.instalador.nif_cif || "-"}`, fontSize: 8.5, color: "#334155" },
            { text: data.instalador.domicilio_fiscal || "-", fontSize: 8.5, color: "#334155" },
            ...(data.instalador.telefono
              ? [{ text: `Tel: ${data.instalador.telefono}`, fontSize: 8.5, color: "#334155" }]
              : []),
            ...(data.instalador.email
              ? [{ text: `Email: ${data.instalador.email}`, fontSize: 8.5, color: "#334155" }]
              : []),
            ...(data.instalador.num_registro_empresa
              ? [{ text: `Reg. Empresa (REIE/RII): ${data.instalador.num_registro_empresa}`, fontSize: 8.5, color: "#334155" }]
              : []),
            {
              text: `Técnico: ${data.instalador.tecnico_nombre || "-"} (${data.instalador.tecnico_dni || "-"})`,
              fontSize: 8.5,
              bold: true,
              color: "#0f172a",
              margin: [0, 2, 0, 0],
            },
            ...(data.instalador.num_carne_instalador
              ? [{ text: `Carné instalador: ${data.instalador.num_carne_instalador}`, fontSize: 8.5, color: "#334155" }]
              : []),
          ],
        },
        {
          stack: [
            { text: "TITULAR / CLIENTE", fontSize: 8, bold: true, color: "#64748b", margin: [0, 0, 0, 2] },
            { text: data.cliente.nombre_razon_social || "-", bold: true, fontSize: 9.5 },
            { text: `NIF/CIF: ${data.cliente.nif_cif || "-"}`, fontSize: 8.5, color: "#334155" },
            { text: `Emplazamiento: ${data.cliente.direccion_emplazamiento || "-"}`, fontSize: 8.5, color: "#334155" },
            ...(data.cliente.telefono
              ? [{ text: `Tel: ${data.cliente.telefono}`, fontSize: 8.5, color: "#334155" }]
              : []),
            ...(data.cliente.email
              ? [{ text: `Email: ${data.cliente.email}`, fontSize: 8.5, color: "#334155" }]
              : []),
          ],
        },
      ],
      columnGap: 18,
      margin: [0, 0, 0, 12],
    },
  ];

  if (needsElec && data.memoria_electricidad) {
    const me = data.memoria_electricidad;
    content.push({
      text: "MEMORIA DESCRIPTIVA · ELECTRICIDAD",
      fontSize: 9,
      bold: true,
      color: "#0f172a",
      margin: [0, 4, 0, 4],
    });
    content.push({
      table: {
        widths: [145, "*"],
        body: [
          [{ text: "Tensión nominal", style: "th" }, { text: me.tension_nominal, fontSize: 8.5 }],
          [{ text: "Interruptor General (IGA)", style: "th" }, { text: `${me.iga_amperios} A`, fontSize: 8.5 }],
          [{ text: "Protector sobretensiones", style: "th" }, { text: me.protector_sobretensiones ? "Sí instalado" : "No", fontSize: 8.5 }],
          [{ text: "Diferencial", style: "th" }, { text: me.diferencial_calibre || "-", fontSize: 8.5 }],
          [{ text: "Receptores conectados", style: "th" }, { text: me.receptores_conectados || "-", fontSize: 8.5 }],
        ],
      },
      layout: "lightHorizontalLines",
      margin: [0, 0, 0, me.circuitos.length > 0 ? 6 : 10],
    });

    if (me.circuitos.length > 0) {
      content.push({
        table: {
          headerRows: 1,
          widths: ["*", 70, 80],
          body: [
            [
              { text: "Circuito", style: "th" },
              { text: "Calibre", style: "th", alignment: "right" },
              { text: "Sección", style: "th", alignment: "right" },
            ],
            ...me.circuitos.map((c) => [
              { text: c.nombre, fontSize: 8.5 },
              { text: `${c.calibre_a} A`, fontSize: 8.5, alignment: "right" },
              { text: `${String(c.seccion_mm2).replace(".", ",")} mm²`, fontSize: 8.5, alignment: "right" },
            ]),
          ],
        },
        layout: "lightHorizontalLines",
        margin: [0, 0, 0, 10],
      });
    }
  }

  if (needsFont && data.memoria_fontaneria) {
    const mf = data.memoria_fontaneria;
    content.push({
      text: "MEMORIA DESCRIPTIVA · FONTANERÍA Y ACS",
      fontSize: 9,
      bold: true,
      color: "#0f172a",
      margin: [0, 4, 0, 4],
    });
    content.push({
      table: {
        widths: [145, "*"],
        body: [
          [{ text: "Redes intervenidas", style: "th" }, { text: mf.redes_intervenidas.join(", ") || "-", fontSize: 8.5 }],
          [{ text: "Material de tuberías", style: "th" }, { text: mf.material_tuberias || "-", fontSize: 8.5 }],
          [{ text: "Diámetros instalados", style: "th" }, { text: mf.diametros_mm || "-", fontSize: 8.5 }],
          [{ text: "Llaves de corte", style: "th" }, { text: mf.ubicacion_llaves_corte || "-", fontSize: 8.5 }],
          [{ text: "Equipos sanitarios", style: "th" }, { text: mf.equipos_sanitarios || "-", fontSize: 8.5 }],
        ],
      },
      layout: "lightHorizontalLines",
      margin: [0, 0, 0, 10],
    });
  }

  if (needsElec && data.pruebas_electricidad) {
    const pe = data.pruebas_electricidad;
    content.push({
      text: "PROTOCOLO DE VERIFICACIÓN Y PRUEBAS · ELECTRICIDAD",
      fontSize: 9,
      bold: true,
      color: "#0f172a",
      margin: [0, 4, 0, 4],
    });
    content.push({
      table: {
        headerRows: 1,
        widths: ["*", 120],
        body: [
          [{ text: "Verificación / Medición", style: "th" }, { text: "Resultado", style: "th", alignment: "right" }],
          [{ text: "Inspección visual de bornes y etiquetado", fontSize: 8.5 }, { text: pe.inspeccion_visual_bornes_etiquetado ? "Correcto" : "Pendiente", fontSize: 8.5, alignment: "right" }],
          [{ text: "Continuidad de protección y equipotencial", fontSize: 8.5 }, { text: pe.continuidad_proteccion_equipotencial ? "Correcto" : "Pendiente", fontSize: 8.5, alignment: "right" }],
          [{ text: "Resistencia de aislamiento", fontSize: 8.5 }, { text: formatMeasure(pe.resistencia_aislamiento_mohm, "MΩ"), fontSize: 8.5, alignment: "right" }],
          [{ text: "Resistencia de puesta a tierra", fontSize: 8.5 }, { text: formatMeasure(pe.resistencia_tierra_ohm, "Ω"), fontSize: 8.5, alignment: "right" }],
          [{ text: "Tiempo de disparo diferencial", fontSize: 8.5 }, { text: formatMeasure(pe.disparo_diferencial_ms, "ms"), fontSize: 8.5, alignment: "right" }],
          [{ text: "Tensión comprobada en servicio", fontSize: 8.5 }, { text: formatMeasure(pe.tension_comprobada_v, "V"), fontSize: 8.5, alignment: "right" }],
          [
            { text: "Dictamen verificación eléctrica", fontSize: 8.5, bold: true },
            { text: pe.resultado_apto ? "APTO" : "NO APTO", fontSize: 8.5, bold: true, color: pe.resultado_apto ? "#15803d" : "#b91c1c", alignment: "right" },
          ],
        ],
      },
      layout: "lightHorizontalLines",
      margin: [0, 0, 0, 10],
    });
  }

  if (needsFont && data.pruebas_fontaneria) {
    const pf = data.pruebas_fontaneria;
    content.push({
      text: "PROTOCOLO DE VERIFICACIÓN Y PRUEBAS · FONTANERÍA",
      fontSize: 9,
      bold: true,
      color: "#0f172a",
      margin: [0, 4, 0, 4],
    });
    content.push({
      table: {
        headerRows: 1,
        widths: ["*", 120],
        body: [
          [{ text: "Verificación / Medición", style: "th" }, { text: "Resultado", style: "th", alignment: "right" }],
          [{ text: "Presión de prueba hidráulica", fontSize: 8.5 }, { text: formatMeasure(pf.presion_prueba_bar, "bar"), fontSize: 8.5, alignment: "right" }],
          [{ text: "Duración de prueba", fontSize: 8.5 }, { text: formatMeasure(pf.duracion_prueba_min, "min"), fontSize: 8.5, alignment: "right" }],
          [{ text: "Estanqueidad comprobada sin fugas", fontSize: 8.5 }, { text: pf.estanqueidad_sin_fugas ? "Sin fugas" : "Con incidencia", fontSize: 8.5, alignment: "right" }],
          [{ text: "Presión de servicio en grifería", fontSize: 8.5 }, { text: formatMeasure(pf.presion_servicio_bar, "bar"), fontSize: 8.5, alignment: "right" }],
          [{ text: "Comprobación de desagües y válvulas", fontSize: 8.5 }, { text: pf.comprobacion_desagues_valvulas ? "Correcto" : "Pendiente", fontSize: 8.5, alignment: "right" }],
          ...(pf.temperatura_consigna_acs_c !== null && pf.temperatura_consigna_acs_c !== undefined
            ? [[{ text: "Temperatura consigna ACS", fontSize: 8.5 }, { text: formatMeasure(pf.temperatura_consigna_acs_c, "°C"), fontSize: 8.5, alignment: "right" }]]
            : []),
          [
            { text: "Dictamen verificación fontanería", fontSize: 8.5, bold: true },
            { text: pf.resultado_apto ? "APTO" : "NO APTO", fontSize: 8.5, bold: true, color: pf.resultado_apto ? "#15803d" : "#b91c1c", alignment: "right" },
          ],
        ],
      },
      layout: "lightHorizontalLines",
      margin: [0, 0, 0, 10],
    });
  }

  if (input.resolvedFotos.length > 0) {
    content.push({
      text: "ANEXO FOTOGRÁFICO DE OBRA",
      fontSize: 9,
      bold: true,
      color: "#0f172a",
      margin: [0, 4, 0, 4],
    });
    const photoRows: Array<Array<Record<string, unknown>>> = [];
    for (let i = 0; i < input.resolvedFotos.length; i += 2) {
      const left = input.resolvedFotos[i]!;
      const right = input.resolvedFotos[i + 1];
      const buildPhotoCell = (item: { dataUrl: string; pieFoto: string }) => ({
        stack: [
          { image: item.dataUrl, fit: [235, 145], alignment: "center", margin: [0, 0, 0, 4] },
          { text: item.pieFoto || "Fotografía de instalación", fontSize: 8, color: "#475569", alignment: "center" },
        ],
        margin: [0, 4, 0, 6],
      });
      photoRows.push([
        buildPhotoCell(left),
        right ? buildPhotoCell(right) : { text: "" },
      ]);
    }
    content.push({
      table: { widths: ["*", "*"], body: photoRows },
      layout: "noBorders",
      margin: [0, 0, 0, 10],
    });
  }

  content.push(
    {
      text: "INSTRUCCIONES DE USO Y MANTENIMIENTO",
      fontSize: 8.5,
      bold: true,
      color: "#0f172a",
      margin: [0, 4, 0, 2],
    },
    { text: data.instrucciones_mantenimiento, fontSize: 8, color: "#334155", margin: [0, 0, 0, 6] },
    {
      text: "DECLARACIÓN DE CONFORMIDAD Y GARANTÍA",
      fontSize: 8.5,
      bold: true,
      color: "#0f172a",
      margin: [0, 2, 0, 2],
    },
    { text: data.clausula_conformidad, fontSize: 8, color: "#334155", margin: [0, 0, 0, 4] },
    { text: data.clausula_recepcion_cliente, fontSize: 8, color: "#334155", margin: [0, 0, 0, 14] },
    {
      columns: [
        {
          stack: [
            { text: "Por la empresa instaladora", fontSize: 8.5, bold: true, color: "#0f172a", alignment: "center" },
            ...(input.firmaInstaladorDataUrl
              ? [{ image: input.firmaInstaladorDataUrl, fit: [175, 65], alignment: "center", margin: [0, 6, 0, 4] }]
              : [{ text: "\n\n\n____________________________", alignment: "center", color: "#94a3b8", fontSize: 9 }]),
            {
              text: `${data.instalador.tecnico_nombre || data.instalador.nombre_razon_social || "-"}`,
              fontSize: 8,
              color: "#475569",
              alignment: "center",
            },
          ],
        },
        {
          stack: [
            { text: "Conforme el titular / cliente", fontSize: 8.5, bold: true, color: "#0f172a", alignment: "center" },
            ...(input.firmaClienteDataUrl
              ? [{ image: input.firmaClienteDataUrl, fit: [175, 65], alignment: "center", margin: [0, 6, 0, 4] }]
              : [{ text: "\n\n\n____________________________", alignment: "center", color: "#94a3b8", fontSize: 9 }]),
            {
              text: `${data.cliente.nombre_razon_social || "-"}`,
              fontSize: 8,
              color: "#475569",
              alignment: "center",
            },
          ],
        },
      ],
      columnGap: 24,
    }
  );

  return {
    pageSize: "A4",
    pageMargins: [36, 36, 36, 44],
    content,
    styles: {
      th: { fontSize: 8.5, bold: true, color: "#0f172a", fillColor: "#f1f5f9", margin: [0, 3, 0, 3] },
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
        : input.kind === "invoice"
          ? buildInvoiceDocDefinition(input)
          : buildActaDocDefinition(input);

    const fileName =
      input.kind === "quote"
        ? `${input.quoteCode}.pdf`
        : input.kind === "invoice"
          ? `${input.invoiceNumber}.pdf`
          : `${input.codigoActa}.pdf`;

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
