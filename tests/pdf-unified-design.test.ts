import { describe, expect, it } from "vitest";
import type {
  PdfActaDocumentInput,
  PdfInvoiceDocumentInput,
  PdfQuoteDocumentInput,
  PdfWorkOrderDocumentInput,
} from "../src/core/ports/mediaPorts";
import {
  PdfMakeAdapter,
  buildActaDocDefinition,
  buildInvoiceDocDefinition,
  buildQuoteDocDefinition,
  buildWorkOrderDocDefinition,
} from "../src/features/pdf/pdfMakeAdapter";

const VALID_1X1_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

interface DocDefShape {
  pageSize: string;
  pageMargins: [number, number, number, number];
  content: Array<Record<string, unknown>>;
}

function collectStrings(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(collectStrings);
  if (node && typeof node === "object") {
    return Object.values(node as Record<string, unknown>).flatMap(collectStrings);
  }
  return [];
}

function collectFillColors(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(collectFillColors);
  if (node && typeof node === "object") {
    const rec = node as Record<string, unknown>;
    const own = typeof rec.fillColor === "string" ? [rec.fillColor] : [];
    const nested = Object.entries(rec)
      .filter(([k]) => k !== "fillColor")
      .flatMap(([, v]) => collectFillColors(v));
    return [...own, ...nested];
  }
  return [];
}

function collectImages(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(collectImages);
  if (node && typeof node === "object") {
    const rec = node as Record<string, unknown>;
    const own = typeof rec.image === "string" ? [rec.image] : [];
    const nested = Object.entries(rec)
      .filter(([k]) => k !== "image")
      .flatMap(([, v]) => collectImages(v));
    return [...own, ...nested];
  }
  return [];
}

function assertValidPdfBytes(pdfBytes: Uint8Array): void {
  expect(pdfBytes).toBeInstanceOf(Uint8Array);
  expect(pdfBytes.byteLength).toBeGreaterThan(500);
  const header = new TextDecoder().decode(pdfBytes.slice(0, 5));
  expect(header).toBe("%PDF-");
}

function makeQuoteInput(overrides: Partial<PdfQuoteDocumentInput> = {}): PdfQuoteDocumentInput {
  return {
    kind: "quote",
    quoteCode: "PRE-2026-0101",
    issuedDateIso: "2026-05-01",
    validityDays: 30,
    validUntilIso: "2026-05-31",
    emitter: {
      name: "Instalaciones Soler S.L.",
      nif: "B12345678",
      fiscalAddress: "C/ Mayor 12, 28013 Madrid",
      phone: "+34 600 111 222",
      email: "contacto@soler.es",
      iban: "ES91 2100 0418 4502 0005 1332",
      bankName: "CaixaBank",
      logoDataUrl: VALID_1X1_PNG_DATA_URL,
    },
    client: {
      name: "María López García",
      nif: "12345678Z",
      fiscalAddress: "Av. América 45, 28002 Madrid",
      phone: "+34 611 333 444",
      email: "maria@cliente.es",
    },
    jobTitle: "Reforma eléctrica integral",
    generalDescription: "Instalación eléctrica completa de vivienda de 90 m²",
    estimatedDurationValue: 10,
    estimatedDurationUnit: "dias_laborables",
    vatRate: 21,
    subtotalCents: 200_000,
    vatCents: 42_000,
    totalCents: 242_000,
    paymentTermsText: "50% al inicio y 50% a la finalización",
    ibanOverride: "ES91 2100 0418 4502 0005 1332",
    bankName: "CaixaBank",
    showIban: true,
    notes: "Materiales certificados según REBT.",
    lines: [
      {
        description: "Cuadro general de mando y protección",
        unit: "ud",
        quantityThousandths: 1000,
        unitPriceCents: 200_000,
        lineSubtotalCents: 200_000,
      },
    ],
    ...overrides,
  };
}

function makeInvoiceInput(overrides: Partial<PdfInvoiceDocumentInput> = {}): PdfInvoiceDocumentInput {
  return {
    kind: "invoice",
    invoiceNumber: "FAC-2026-0018",
    invoiceKind: "full",
    issuedAtIso: "2026-05-10",
    dueAtIso: "2026-05-25",
    emitter: {
      name: "Instalaciones Soler S.L.",
      nif: "B12345678",
      fiscalAddress: "C/ Mayor 12, 28013 Madrid",
      phone: "+34 600 111 222",
      email: "facturacion@soler.es",
      iban: "ES91 2100 0418 4502 0005 1332",
      bankName: "CaixaBank",
      logoDataUrl: VALID_1X1_PNG_DATA_URL,
    },
    client: {
      name: "Comunidad Serrano 40",
      nif: "H87654321",
      fiscalAddress: "C/ Serrano 40, 28001 Madrid",
      phone: "+34 622 555 666",
      email: "admin@serrano40.es",
    },
    jobCode: "OBR-2026-014",
    jobTitle: "Adecuación cuadro comunitario",
    quoteCode: "PRE-2026-0101",
    vatRate: 21,
    baseCents: 100_000,
    vatCents: 21_000,
    totalCents: 121_000,
    advanceDeductedBaseCents: 0,
    advanceDeductedVatCents: 0,
    notes: "Pago mediante transferencia indicando el número de factura.",
    paymentMethod: "Transferencia bancaria",
    paymentStatus: "Pendiente de cobro",
    ...overrides,
  };
}

function makeWorkOrderInput(
  overrides: Partial<PdfWorkOrderDocumentInput> = {}
): PdfWorkOrderDocumentInput {
  return {
    kind: "work_order",
    documentType: "parte_trabajo",
    documentCode: "PT-2026-0009",
    issuedDateIso: "2026-05-12",
    hoursWorkedLabel: "6,5 horas",
    emitter: {
      name: "Instalaciones Soler S.L.",
      nif: "B12345678",
      fiscalAddress: "C/ Mayor 12, 28013 Madrid",
      phone: "+34 600 111 222",
      email: "tecnico@soler.es",
      logoDataUrl: VALID_1X1_PNG_DATA_URL,
    },
    client: {
      name: "Hostelería Plaza S.L.",
      nif: "B99887766",
      fiscalAddress: "Plaza Mayor 8, 28012 Madrid",
      phone: "+34 633 777 888",
      email: "gerencia@plaza.es",
    },
    jobCode: "OBR-2026-019",
    jobTitle: "Mantenimiento preventivo cuadro cocina",
    quoteCode: "PRE-2026-0095",
    showPrices: false,
    items: [
      {
        description: "Revisión de protecciones y reapriete de bornes",
        kind: "tarea",
        quantityLabel: "4 h",
        unitPriceCents: 4_500,
        lineSubtotalCents: 18_000,
      },
      {
        description: "Magnetotérmico 2P 25A curva C",
        kind: "material",
        quantityLabel: "2 ud",
        unitPriceCents: 1_850,
        lineSubtotalCents: 3_700,
      },
    ],
    subtotalCents: 21_700,
    notes: "Instalación probada y operativa al cierre de la jornada.",
    receiverName: "Carlos Ruiz Mendoza",
    receiverNif: "44556677K",
    firmaProfesionalDataUrl: VALID_1X1_PNG_DATA_URL,
    firmaClienteDataUrl: VALID_1X1_PNG_DATA_URL,
    ...overrides,
  };
}

function makeActaInput(overrides: Partial<PdfActaDocumentInput> = {}): PdfActaDocumentInput {
  return {
    kind: "acta",
    codigoActa: "ACT-2026-0003",
    estado: "firmada",
    emitterLogoDataUrl: VALID_1X1_PNG_DATA_URL,
    firmaInstaladorDataUrl: VALID_1X1_PNG_DATA_URL,
    firmaClienteDataUrl: VALID_1X1_PNG_DATA_URL,
    resolvedFotos: [
      { dataUrl: VALID_1X1_PNG_DATA_URL, pieFoto: "Foto 1: Cuadro general terminado" },
      { dataUrl: VALID_1X1_PNG_DATA_URL, pieFoto: "Foto 2: Verificación de diferencial" },
      { dataUrl: VALID_1X1_PNG_DATA_URL, pieFoto: "Foto 3: Esta no debe aparecer" },
    ],
    data: {
      titulo_documento: "ACTA DE PUESTA EN MARCHA",
      codigo_acta: "ACT-2026-0003",
      fecha_emision: "2026-05-14",
      especialidad: "mixta",
      tipo_actuacion: "reforma_integral",
      alcance_ubicacion: "Vivienda 3ºB - Cuadro principal y red de agua fría/ACS",
      instalador: {
        nombre_razon_social: "Instalaciones Soler S.L.",
        nif_cif: "B12345678",
        domicilio_fiscal: "C/ Mayor 12, 28013 Madrid",
        telefono: "+34 600 111 222",
        email: "ingenieria@soler.es",
        num_registro_empresa: "REIE-28-004512",
        tecnico_nombre: "Javier Soler",
        tecnico_dni: "50123456M",
        num_carne_instalador: "IBTE-28-9981",
      },
      cliente: {
        nombre_razon_social: "Elena Torres",
        nif_cif: "22334455L",
        direccion_emplazamiento: "C/ Goya 75, 3ºB, 28001 Madrid",
        telefono: "+34 644 222 111",
        email: "elena@ejemplo.es",
      },
      memoria_electricidad: {
        tension_nominal: "230V Monofásica",
        iga_amperios: 40,
        protector_sobretensiones: true,
        diferencial_calibre: "2x40A / 30mA Clase A",
        receptores_conectados: "Iluminación LED, cocina inducción, climatización",
        circuitos: [
          { nombre: "C1 Iluminación", calibre_a: 10, seccion_mm2: 1.5 },
          { nombre: "C2 Tomas uso general", calibre_a: 16, seccion_mm2: 2.5 },
        ],
      },
      memoria_fontaneria: {
        redes_intervenidas: ["AFCH", "ACS", "Saneamiento"],
        material_tuberias: "Multicapa PEX-Al-PEX",
        diametros_mm: "20 mm montante / 16 mm derivaciones",
        ubicacion_llaves_corte: "Entrada cocina y falso techo baño",
        equipos_sanitarios: "Termo eléctrico 80L y grifería monomando",
      },
      pruebas_electricidad: {
        inspeccion_visual_bornes_etiquetado: true,
        continuidad_proteccion_equipotencial: true,
        resistencia_aislamiento_mohm: 250,
        resistencia_tierra_ohm: 14.5,
        disparo_diferencial_ms: 18,
        tension_comprobada_v: 231,
        resultado_apto: true,
      },
      pruebas_fontaneria: {
        presion_prueba_bar: 6,
        duracion_prueba_min: 30,
        estanqueidad_sin_fugas: true,
        presion_servicio_bar: 3.2,
        comprobacion_desagues_valvulas: true,
        temperatura_consigna_acs_c: 55,
        resultado_apto: true,
      },
      instrucciones_mantenimiento:
        "Pulsar el botón TEST del diferencial mensualmente y revisar llaves de corte cada 6 meses.",
      plazo_garantia_meses: 12,
      clausula_conformidad:
        "La instalación se entrega conforme a la normativa vigente con garantía de mano de obra de 12 meses.",
      clausula_recepcion_cliente:
        "El cliente recibe la instalación en correcto estado de funcionamiento.",
      fotos: [],
    },
    ...overrides,
  };
}

describe("Diseño PDF Unificado — Invariantes compartidos en los 4 documentos", () => {
  const sharedCases: Array<{
    label: string;
    build: () => DocDefShape;
    expectedTitle: string;
    expectedCode: string;
  }> = [
    {
      label: "Presupuesto (buildQuoteDocDefinition)",
      build: () => buildQuoteDocDefinition(makeQuoteInput()) as unknown as DocDefShape,
      expectedTitle: "PRESUPUESTO",
      expectedCode: "PRE-2026-0101",
    },
    {
      label: "Factura (buildInvoiceDocDefinition)",
      build: () => buildInvoiceDocDefinition(makeInvoiceInput()) as unknown as DocDefShape,
      expectedTitle: "FACTURA",
      expectedCode: "FAC-2026-0018",
    },
    {
      label: "Parte de Trabajo (buildWorkOrderDocDefinition)",
      build: () => buildWorkOrderDocDefinition(makeWorkOrderInput()) as unknown as DocDefShape,
      expectedTitle: "PARTE DE TRABAJO",
      expectedCode: "PT-2026-0009",
    },
    {
      label: "Acta de Puesta en Marcha (buildActaDocDefinition)",
      build: () => buildActaDocDefinition(makeActaInput()) as unknown as DocDefShape,
      expectedTitle: "ACTA DE PUESTA EN MARCHA",
      expectedCode: "ACT-2026-0003",
    },
  ];

  it.each(sharedCases)(
    "$label cumple márgenes [36, 72, 36, 48], cabecera, EMISOR/CLIENTE, paleta pastel y pie unificado",
    ({ build, expectedTitle, expectedCode }) => {
      const docDef = build();

      expect(docDef.pageSize).toBe("A4");
      expect(docDef.pageMargins).toEqual([36, 72, 36, 48]);

      // Cabecera unificada: logo top-left + título/número/fechas top-right
      const header = docDef.content[0] as { columns: Array<Record<string, unknown>> };
      expect(header.columns).toHaveLength(2);
      expect(header.columns[0]?.image).toBe(VALID_1X1_PNG_DATA_URL);
      const headerRight = collectStrings(header.columns[1]).join(" ");
      expect(headerRight).toContain(expectedTitle);
      expect(headerRight).toContain(`Nº ${expectedCode}`);
      expect(headerRight).toMatch(/Fecha/i);

      // Bloque 2 columnas EMISOR / CLIENTE
      const parties = docDef.content[1] as { columns: Array<Record<string, unknown>> };
      expect(parties.columns).toHaveLength(2);
      const leftText = collectStrings(parties.columns[0]).join(" ");
      const rightText = collectStrings(parties.columns[1]).join(" ");
      expect(leftText).toContain("EMISOR");
      expect(rightText).toContain("CLIENTE");

      // Paleta pastel unificada presente en el documento
      const fills = collectFillColors(docDef.content);
      expect(fills).toContain("#E0F2FE"); // franja de contexto
      expect(fills).toContain("#FCE7F3"); // cabecera de tabla
      expect(fills).toContain("#F1F5F9"); // franja inferior slate

      // Cierre indivisible con pie unificado al final
      const closing = docDef.content[docDef.content.length - 1] as {
        unbreakable?: boolean;
        stack?: Array<Record<string, unknown>>;
      };
      expect(closing.unbreakable).toBe(true);
      const footerNode = closing.stack?.[closing.stack.length - 1];
      expect(footerNode?.text).toBe("Documento generado con Gestor Autónomo");
      expect(footerNode?.color).toBe("#94A3B8");
      expect(footerNode?.alignment).toBe("center");
    }
  );
});

describe("Diseño PDF Unificado — Factura y Factura Rectificativa", () => {
  it("genera FACTURA estándar con totales #DCFCE7, forma/estado de pago, IBAN en #F1F5F9 y SIN caja amarilla de presupuesto", () => {
    const docDef = buildInvoiceDocDefinition(makeInvoiceInput()) as unknown as DocDefShape;
    const allText = collectStrings(docDef.content).join(" ");
    const fills = collectFillColors(docDef.content);

    expect(allText).toContain("FACTURA");
    expect(allText).not.toContain("FACTURA RECTIFICATIVA");
    expect(allText).toContain("Fecha de emisión: 2026-05-10");
    expect(allText).toContain("Fecha de vencimiento: 2026-05-25");

    // Totales en menta #DCFCE7 sin IRPF
    expect(fills).toContain("#DCFCE7");
    expect(allText).toContain("Base imponible");
    expect(allText).toContain("IVA (21 %)");
    expect(allText).toContain("TOTAL FACTURA");
    expect(allText).not.toContain("Retención IRPF");

    // Sin caja amarilla de validez de presupuesto
    expect(fills).not.toContain("#FEF9C3");
    expect(allText).not.toContain("Presupuesto orientativo");

    // Forma de pago, estado e IBAN en #F1F5F9
    expect(allText).toContain("Forma de pago:");
    expect(allText).toContain("Transferencia bancaria");
    expect(allText).toContain("Estado:");
    expect(allText).toContain("Pendiente de cobro");
    expect(allText).toContain("ES91 2100 0418 4502 0005 1332");
    expect(allText).toContain("CaixaBank");
    expect(fills).toContain("#F1F5F9");
  });

  it("genera FACTURA RECTIFICATIVA con número rectificado, motivo y retención IRPF en la franja #DCFCE7", () => {
    const docDef = buildInvoiceDocDefinition(
      makeInvoiceInput({
        invoiceNumber: "REC-2026-0001",
        isRectificative: true,
        rectifiedInvoiceNumber: "FAC-2026-0018",
        rectificationReason: "Error en la aplicación del descuento acordado",
        irpfRate: 15,
        irpfCents: 15_000,
        totalCents: 106_000,
        advanceDeductedBaseCents: 20_000,
        advanceDeductedVatCents: 4_200,
        emitter: {
          ...makeInvoiceInput().emitter,
          iban: "",
          bankName: "",
        },
        legalNotice: "Factura rectificativa emitida según art. 15 RD 1619/2012.",
      })
    ) as unknown as DocDefShape;

    const allText = collectStrings(docDef.content).join(" ");
    const fills = collectFillColors(docDef.content);

    expect(allText).toContain("FACTURA RECTIFICATIVA");
    expect(allText).toContain("Rectifica a: Nº FAC-2026-0018");
    expect(allText).toContain("Motivo: Error en la aplicación del descuento acordado");
    expect(allText).toContain("Retención IRPF (-15 %)");
    expect(allText).toContain("Sub-Total");
    expect(fills).toContain("#EDE9FE");
    expect(fills).toContain("#DCFCE7");
    expect(fills).not.toContain("#FEF9C3");
    expect(allText).toContain("Factura rectificativa emitida según art. 15 RD 1619/2012.");
  });

  it("genera un buffer PDF válido para Factura mediante PdfMakeAdapter", async () => {
    const adapter = new PdfMakeAdapter();
    const res = await adapter.buildDocumentPdf(makeInvoiceInput());
    expect(res.fileName).toBe("FAC-2026-0018.pdf");
    assertValidPdfBytes(res.pdfBytes);
  });
});

describe("Diseño PDF Unificado — Parte de Trabajo y Albarán de Entrega", () => {
  it("genera PARTE DE TRABAJO con showPrices: false ocultando precios, importes y Sub-Total, e incluye doble firma con receptor", () => {
    const docDef = buildWorkOrderDocDefinition(
      makeWorkOrderInput({
        documentType: "parte_trabajo",
        showPrices: false,
      })
    ) as unknown as DocDefShape;

    const allText = collectStrings(docDef.content).join(" ");
    const fills = collectFillColors(docDef.content);

    expect(allText).toContain("PARTE DE TRABAJO");
    expect(allText).not.toContain("ALBARÁN DE ENTREGA");
    expect(allText).toContain("Jornada / Horas: 6,5 horas");
    expect(allText).toContain("Conceptos realizados / Materiales suministrados");
    expect(allText).toContain("Cantidad / Horas");

    // Precios ocultos
    expect(allText).not.toContain("Precio unit.");
    expect(allText).not.toContain("Importe");
    expect(allText).not.toContain("Sub-Total");
    expect(fills).not.toContain("#EDE9FE");

    // Bloque de doble firma con nombre y DNI/NIF del receptor
    expect(allText).toContain("Firma del Profesional");
    expect(allText).toContain("Firma / Conformidad del Cliente");
    expect(allText).toContain("Carlos Ruiz Mendoza");
    expect(allText).toContain("DNI/NIF: 44556677K");
  });

  it("genera ALBARÁN DE ENTREGA con showPrices: true mostrando columnas de precios y fila Sub-Total en #EDE9FE", () => {
    const docDef = buildWorkOrderDocDefinition(
      makeWorkOrderInput({
        documentType: "albaran",
        documentCode: "ALB-2026-0004",
        showPrices: true,
      })
    ) as unknown as DocDefShape;

    const allText = collectStrings(docDef.content).join(" ");
    const fills = collectFillColors(docDef.content);

    expect(allText).toContain("ALBARÁN DE ENTREGA");
    expect(allText).toContain("Nº ALB-2026-0004");
    expect(allText).toContain("Precio unit.");
    expect(allText).toContain("Importe");
    expect(allText).toContain("Sub-Total");
    expect(fills).toContain("#EDE9FE");
    expect(allText).toContain("217,00");
    expect(allText).toContain("Documento sin validez fiscal como factura");
  });

  it("genera un buffer PDF válido para Parte de Trabajo / Albarán mediante PdfMakeAdapter", async () => {
    const adapter = new PdfMakeAdapter();
    const res = await adapter.buildDocumentPdf(
      makeWorkOrderInput({ documentType: "albaran", documentCode: "ALB-2026-0004", showPrices: true })
    );
    expect(res.fileName).toBe("ALB-2026-0004.pdf");
    assertValidPdfBytes(res.pdfBytes);
  });
});

describe("Diseño PDF Unificado — Acta de Puesta en Marcha", () => {
  it("incluye tablas técnicas, badges pastel OK/Conforme e Incidencia, máximo 2 fotos en grid, caja crema #FEF9C3 de garantía y doble firma", () => {
    const base = makeActaInput();
    const docDef = buildActaDocDefinition({
      ...base,
      data: {
        ...base.data,
        pruebas_fontaneria: {
          ...base.data.pruebas_fontaneria!,
          estanqueidad_sin_fugas: false,
          resultado_apto: false,
        },
      },
    }) as unknown as DocDefShape;

    const allText = collectStrings(docDef.content).join(" ");
    const fills = collectFillColors(docDef.content);

    expect(allText).toContain("ACTA DE PUESTA EN MARCHA");
    expect(allText).not.toContain("FIRMADA");
    expect(allText).not.toContain("BORRADOR");
    expect(allText).toContain("MEMORIA DESCRIPTIVA · ELECTRICIDAD (REBT)");
    expect(allText).toContain("MEMORIA DESCRIPTIVA · FONTANERÍA Y ACS (CTE HS-4)");
    expect(allText).toContain("PROTOCOLO DE VERIFICACIÓN Y PRUEBAS · ELECTRICIDAD");
    expect(allText).toContain("PROTOCOLO DE VERIFICACIÓN Y PRUEBAS · FONTANERÍA");

    // Badges pastel
    expect(allText).toContain("OK / Conforme");
    expect(allText).toContain("Incidencia / No Apto");
    expect(fills).toContain("#DCFCE7");
    expect(fills).toContain("#FEE2E2");

    // Máximo 2 fotos incluso cuando se pasan 3
    expect(allText).toContain("Foto 1: Cuadro general terminado");
    expect(allText).toContain("Foto 2: Verificación de diferencial");
    expect(allText).not.toContain("Foto 3: Esta no debe aparecer");
    // 1 logo + 2 fotos + 2 firmas = 5 imágenes en total
    expect(collectImages(docDef.content)).toHaveLength(5);

    // Caja crema #FEF9C3 de garantía y mantenimiento
    expect(fills).toContain("#FEF9C3");
    expect(allText).toContain("Garantía de instalación y recomendaciones de mantenimiento");
    expect(allText).toContain("Pulsar el botón TEST del diferencial mensualmente");

    // Doble firma y nota de trazabilidad
    expect(allText).toContain("Firma del Instalador");
    expect(allText).toContain("Firma del Cliente");
    expect(allText).toContain("No sustituye al CIE ante Industria");
  });

  it("genera un buffer PDF válido para Acta de Puesta en Marcha mediante PdfMakeAdapter", async () => {
    const adapter = new PdfMakeAdapter();
    const res = await adapter.buildDocumentPdf(makeActaInput());
    expect(res.fileName).toBe("ACT-2026-0003.pdf");
    assertValidPdfBytes(res.pdfBytes);
  });
});

describe("Diseño PDF Unificado — Presupuestos por modalidad y sanitización", () => {
  it("sanitiza descripciones en tiempo de render y usa tabla de 4 columnas sin sub-línea qty × price", () => {
    const docDef = buildQuoteDocDefinition(
      makeQuoteInput({
        lines: [
          {
            description: "Cable 2.5mm IP65 por 120,00 €",
            unit: "m",
            quantityThousandths: 10_000,
            unitPriceCents: 12_000,
            lineSubtotalCents: 120_000,
          },
        ],
        subtotalCents: 120_000,
        vatCents: 25_200,
        totalCents: 145_200,
      })
    ) as unknown as DocDefShape;

    const tasksTable = docDef.content[4] as {
      table: { widths: Array<string | number>; body: Array<Array<Record<string, unknown>>> };
    };
    expect(tasksTable.table.widths).toEqual(["*", "auto", "auto", "auto"]);
    expect(tasksTable.table.body[0]!.map((c) => c.text)).toEqual([
      "Descripción de las tareas",
      "Cant.",
      "Precio unit.",
      "Total",
    ]);

    const firstRow = tasksTable.table.body[1]!;
    expect(firstRow[0]?.text).toBe("Cable 2.5mm IP65");
    expect(firstRow[0]?.stack).toBeUndefined();
    expect(firstRow[1]?.text).toBe("10 m");
    expect(firstRow[2]?.text).toBe("120,00 €");
    expect(firstRow[3]?.text).toBe("1.200,00 €");
  });

  it("añade fila de Mano de obra antes de Sub-Total en partidas_mas_horas y partidas_mas_fijo_mano_obra", () => {
    const hourlyDoc = buildQuoteDocDefinition(
      makeQuoteInput({
        billingMode: "partidas_mas_horas",
        laborHoursThousandths: 5_500,
        hourlyRateCents: 4_000,
        laborCents: 22_000,
        itemsSubtotalCents: 200_000,
        subtotalCents: 222_000,
        vatCents: 46_620,
        totalCents: 268_620,
      })
    ) as unknown as DocDefShape;

    const hourlyTable = hourlyDoc.content[4] as {
      table: { body: Array<Array<Record<string, unknown>>> };
    };
    const hourlyLaborRow = hourlyTable.table.body[2]!;
    expect(hourlyLaborRow.map((c) => c.text)).toEqual([
      "Mano de obra",
      "5,5 h",
      "40,00 €/h",
      "220,00 €",
    ]);
    expect(hourlyTable.table.body[3]![3]?.text).toBe("2.220,00 €");

    const fixedDoc = buildQuoteDocDefinition(
      makeQuoteInput({
        billingMode: "partidas_mas_fijo_mano_obra",
        laborCents: 35_000,
        itemsSubtotalCents: 200_000,
        subtotalCents: 235_000,
        vatCents: 49_350,
        totalCents: 284_350,
      })
    ) as unknown as DocDefShape;

    const fixedTable = fixedDoc.content[4] as {
      table: { body: Array<Array<Record<string, unknown>>> };
    };
    const fixedLaborRow = fixedTable.table.body[2]!;
    expect(fixedLaborRow.map((c) => c.text)).toEqual([
      "Mano de obra (importe fijo)",
      "1 ud",
      "350,00 €",
      "350,00 €",
    ]);
    expect(fixedTable.table.body[3]![3]?.text).toBe("2.350,00 €");
  });

  it("en solo_mano_obra oculta precios unitarios y totales de partida y renderiza tabla 1-col + resumen global", async () => {
    const inputHourly = makeQuoteInput({
      billingMode: "solo_mano_obra",
      laborSubMode: "por_horas",
      laborHoursThousandths: 8_000,
      hourlyRateCents: 3_800,
      laborCents: 30_400,
      itemsSubtotalCents: 0,
      subtotalCents: 30_400,
      vatCents: 6_384,
      totalCents: 36_784,
      lines: [
        {
          description: "Sustitución de magnetotérmico y revisión general - 99,00 €",
          unit: "ud",
          quantityThousandths: 1000,
          unitPriceCents: 9_900,
          lineSubtotalCents: 9_900,
        },
        {
          description: "Comprobación de derivaciones",
          unit: "ud",
          quantityThousandths: 2000,
          unitPriceCents: 0,
          lineSubtotalCents: 0,
        },
      ],
    });

    const docHourly = buildQuoteDocDefinition(inputHourly) as unknown as DocDefShape;
    const allTextHourly = collectStrings(docHourly.content).join(" ");

    expect(allTextHourly).toContain("Descripción de las tareas / trabajos incluidos");
    expect(allTextHourly).toContain("Sustitución de magnetotérmico y revisión general");
    expect(allTextHourly).toContain("Comprobación de derivaciones");
    expect(allTextHourly).not.toContain("Precio unit.");
    expect(allTextHourly).not.toContain("99,00 €");
    expect(allTextHourly).toContain("Mano de obra (8 h × 38,00 €/h)");
    expect(allTextHourly).toContain("304,00 €");
    expect(allTextHourly).toContain("Sub-Total");

    const taskTable = docHourly.content[4] as {
      table: { widths: Array<string | number>; body: Array<Array<Record<string, unknown>>> };
    };
    expect(taskTable.table.widths).toEqual(["*"]);
    expect(taskTable.table.body[0]).toHaveLength(1);

    const inputClosed = makeQuoteInput({
      billingMode: "solo_mano_obra",
      laborSubMode: "precio_cerrado",
      laborCents: 48_000,
      itemsSubtotalCents: 0,
      subtotalCents: 48_000,
      vatCents: 10_080,
      totalCents: 58_080,
      lines: [],
    });
    const docClosed = buildQuoteDocDefinition(inputClosed) as unknown as DocDefShape;
    const allTextClosed = collectStrings(docClosed.content).join(" ");
    expect(allTextClosed).toContain("Mano de obra (Precio cerrado)");
    expect(allTextClosed).toContain("480,00 €");

    const adapter = new PdfMakeAdapter();
    const pdfRes = await adapter.buildDocumentPdf(inputHourly);
    assertValidPdfBytes(pdfRes.pdfBytes);
    const pdfClosedRes = await adapter.buildDocumentPdf(inputClosed);
    assertValidPdfBytes(pdfClosedRes.pdfBytes);
  });
});
