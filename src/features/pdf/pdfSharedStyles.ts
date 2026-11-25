export const PDF_PAGE_SIZE = "A4" as const;

export const PDF_PAGE_MARGINS: [number, number, number, number] = [36, 72, 36, 48];

export const PDF_FOOTER_TEXT = "Documento generado con Gestor Autónomo" as const;

export const PDF_COLORS = {
  ink: "#000000",
  mutedText: "#374151",
  slateLabel: "#334155",
  slateDark: "#0F172A",
  slateSubtle: "#475569",
  footerGray: "#94A3B8",
  contextCyanBg: "#E0F2FE",
  contextSkyBg: "#DBEAFE",
  tableHeaderPinkBg: "#FCE7F3",
  tableBorderGray: "#E5E7EB",
  subtotalLilacBg: "#EDE9FE",
  totalsMintBg: "#DCFCE7",
  totalsMintText: "#166534",
  errorRedBg: "#FEE2E2",
  errorRedText: "#991B1B",
  creamBg: "#FEF9C3",
  creamBorder: "#FDE047",
  creamText: "#713F12",
  slateBg: "#F1F5F9",
} as const;

const TABLE_CELL_BORDER_COLORS: [string, string, string, string] = [
  PDF_COLORS.tableBorderGray,
  PDF_COLORS.tableBorderGray,
  PDF_COLORS.tableBorderGray,
  PDF_COLORS.tableBorderGray,
];

export interface UnifiedHeaderMetaLine {
  text: string;
  bold?: boolean;
  fontSize?: number;
  color?: string;
}

export interface UnifiedHeaderOptions {
  logoDataUrl?: string | null;
  title: string;
  titleFontSize?: number;
  documentNumber: string;
  metaLines: Array<string | UnifiedHeaderMetaLine>;
  badge?: {
    text: string;
    bgColor: string;
    textColor: string;
  };
  marginBottom?: number;
}

export function buildUnifiedHeader(options: UnifiedHeaderOptions): Record<string, unknown> {
  const rightStack: Array<Record<string, unknown>> = [
    {
      text: options.title,
      fontSize: options.titleFontSize ?? 18,
      bold: true,
      color: PDF_COLORS.ink,
      alignment: "right",
    },
    {
      text: `Nº ${options.documentNumber}`,
      fontSize: 10.5,
      bold: true,
      color: PDF_COLORS.ink,
      alignment: "right",
      margin: [0, 3, 0, 0],
    },
  ];

  for (const line of options.metaLines) {
    if (typeof line === "string") {
      if (line.trim().length === 0) continue;
      rightStack.push({
        text: line,
        fontSize: 9,
        color: PDF_COLORS.ink,
        alignment: "right",
        margin: [0, 2, 0, 0],
      });
    } else if (line.text.trim().length > 0) {
      rightStack.push({
        text: line.text,
        fontSize: line.fontSize ?? 9,
        ...(line.bold ? { bold: true } : {}),
        color: line.color ?? PDF_COLORS.ink,
        alignment: "right",
        margin: [0, 2, 0, 0],
      });
    }
  }

  if (options.badge) {
    rightStack.push({
      table: {
        widths: ["auto"],
        body: [
          [
            {
              text: options.badge.text,
              fontSize: 8,
              bold: true,
              color: options.badge.textColor,
              fillColor: options.badge.bgColor,
              margin: [6, 2, 6, 2],
            },
          ],
        ],
      },
      layout: "noBorders",
      alignment: "right",
      margin: [0, 4, 0, 0],
    });
  }

  return {
    columns: [
      options.logoDataUrl
        ? {
            width: "*",
            image: options.logoDataUrl,
            fit: [130, 52],
          }
        : {
            width: "*",
            text: "",
          },
      {
        width: "auto",
        stack: rightStack,
      },
    ],
    margin: [0, 0, 0, options.marginBottom ?? 18],
  };
}

export interface UnifiedPartyInfo {
  name: string;
  nif: string;
  fiscalAddress: string;
  addressPrefix?: string;
  phone?: string;
  email?: string;
  extraLines?: Array<{ text: string; bold?: boolean }>;
  emptyFallbackText?: string;
}

export interface UnifiedPartiesOptions {
  emitterTitle?: string;
  clientTitle?: string;
  emitter: UnifiedPartyInfo;
  client: UnifiedPartyInfo;
  marginBottom?: number;
}

function buildPartyColumn(
  title: string,
  party: UnifiedPartyInfo,
  alignment: "left" | "right"
): Record<string, unknown> {
  const alignProp = alignment === "right" ? { alignment: "right" as const } : {};
  const hasName = party.name.trim().length > 0;

  if (!hasName && party.emptyFallbackText) {
    return {
      stack: [
        {
          text: title,
          fontSize: 8,
          bold: true,
          color: PDF_COLORS.ink,
          ...alignProp,
          margin: [0, 0, 0, 3],
        },
        {
          text: party.emptyFallbackText,
          italics: true,
          fontSize: 9,
          color: PDF_COLORS.ink,
          ...alignProp,
        },
      ],
    };
  }

  const email = party.email?.trim() ?? "";
  const phone = party.phone?.trim() ?? "";
  const addressText = party.addressPrefix
    ? `${party.addressPrefix}${party.fiscalAddress || "-"}`
    : party.fiscalAddress || "-";

  const stack: Array<Record<string, unknown>> = [
    {
      text: title,
      fontSize: 8,
      bold: true,
      color: PDF_COLORS.ink,
      ...alignProp,
      margin: [0, 0, 0, 3],
    },
    {
      text: party.name || "-",
      bold: true,
      fontSize: 10,
      color: PDF_COLORS.ink,
      ...alignProp,
    },
    {
      text: `NIF/CIF: ${party.nif || "-"}`,
      fontSize: 9,
      color: PDF_COLORS.ink,
      ...alignProp,
      margin: [0, 1, 0, 0],
    },
    {
      text: addressText,
      fontSize: 9,
      color: PDF_COLORS.ink,
      ...alignProp,
      margin: [0, 1, 0, 0],
    },
  ];

  if (phone) {
    stack.push({
      text: `Tel: ${phone}`,
      fontSize: 9,
      color: PDF_COLORS.ink,
      ...alignProp,
      margin: [0, 1, 0, 0],
    });
  }

  if (email) {
    stack.push({
      text: `Email: ${email}`,
      fontSize: 9,
      color: PDF_COLORS.ink,
      ...alignProp,
      margin: [0, 1, 0, 0],
    });
  }

  if (party.extraLines) {
    for (const extra of party.extraLines) {
      if (!extra.text.trim()) continue;
      stack.push({
        text: extra.text,
        fontSize: 8.5,
        ...(extra.bold ? { bold: true } : {}),
        color: PDF_COLORS.ink,
        ...alignProp,
        margin: [0, 1.5, 0, 0],
      });
    }
  }

  return { stack };
}

export function buildUnifiedPartiesBlock(options: UnifiedPartiesOptions): Record<string, unknown> {
  return {
    columns: [
      buildPartyColumn(options.emitterTitle ?? "EMISOR", options.emitter, "left"),
      buildPartyColumn(options.clientTitle ?? "CLIENTE", options.client, "right"),
    ],
    columnGap: 24,
    margin: [0, 0, 0, options.marginBottom ?? 16],
  };
}

export interface ContextBannerOptions {
  label: string;
  value: string;
  secondarySegments?: Array<{ label?: string; text: string }>;
  variant?: "cyan" | "sky";
  fontSize?: number;
  marginBottom?: number;
}

export function buildContextBanner(options: ContextBannerOptions): Record<string, unknown> {
  const isSky = options.variant === "sky";
  const fillColor = isSky ? PDF_COLORS.contextSkyBg : PDF_COLORS.contextCyanBg;
  const fontSize = options.fontSize ?? (isSky ? 9 : 9.5);
  const cellPaddingY = isSky ? 5 : 6;

  const textRuns: Array<Record<string, unknown>> = [
    { text: `${options.label}: `, bold: true, color: PDF_COLORS.ink },
    { text: options.value, color: PDF_COLORS.ink },
  ];

  if (options.secondarySegments) {
    for (const seg of options.secondarySegments) {
      if (!seg.text.trim()) continue;
      textRuns.push({ text: "  ·  ", color: PDF_COLORS.ink });
      if (seg.label) {
        textRuns.push({ text: `${seg.label}: `, bold: true, color: PDF_COLORS.ink });
      }
      textRuns.push({ text: seg.text, color: PDF_COLORS.ink });
    }
  }

  return {
    table: {
      dontBreakRows: true,
      widths: ["*"],
      body: [
        [
          {
            text: textRuns,
            fontSize,
            fillColor,
            margin: [8, cellPaddingY, 8, cellPaddingY],
          },
        ],
      ],
    },
    layout: "noBorders",
    margin: [0, 0, 0, options.marginBottom ?? 12],
  };
}

export function buildSectionBanner(
  title: string,
  marginTop = 4,
  marginBottom = 6
): Record<string, unknown> {
  return {
    table: {
      dontBreakRows: true,
      widths: ["*"],
      body: [
        [
          {
            text: title,
            fontSize: 9,
            bold: true,
            color: PDF_COLORS.ink,
            fillColor: PDF_COLORS.contextSkyBg,
            margin: [8, 4, 8, 4],
          },
        ],
      ],
    },
    layout: "noBorders",
    margin: [0, marginTop, 0, marginBottom],
  };
}

export function buildPastelTableLayout(): Record<string, unknown> {
  return {
    hLineWidth: () => 0.75,
    vLineWidth: () => 0,
    hLineColor: () => PDF_COLORS.tableBorderGray,
    vLineColor: () => PDF_COLORS.tableBorderGray,
    paddingLeft: () => 6,
    paddingRight: () => 6,
    paddingTop: () => 4,
    paddingBottom: () => 4,
  };
}

export function buildPastelHeaderCell(
  text: string,
  alignment?: "left" | "center" | "right",
  fontSize = 9.5
): Record<string, unknown> {
  return {
    text,
    bold: true,
    fontSize,
    color: PDF_COLORS.ink,
    fillColor: PDF_COLORS.tableHeaderPinkBg,
    ...(alignment ? { alignment } : {}),
    borderColor: TABLE_CELL_BORDER_COLORS,
    margin: [2, 3, 2, 3],
  };
}

export function buildPastelSubtotalCell(
  text: string,
  alignment?: "left" | "center" | "right",
  fontSize = 9.5
): Record<string, unknown> {
  return {
    text,
    bold: true,
    fontSize,
    color: PDF_COLORS.ink,
    fillColor: PDF_COLORS.subtotalLilacBg,
    ...(alignment ? { alignment } : {}),
    borderColor: TABLE_CELL_BORDER_COLORS,
    margin: [2, 3, 2, 3],
  };
}

export function buildPastelDataCell(
  textOrStack: string | Array<Record<string, unknown>>,
  options?: {
    alignment?: "left" | "center" | "right";
    bold?: boolean;
    fontSize?: number;
    color?: string;
    fillColor?: string;
  }
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    borderColor: TABLE_CELL_BORDER_COLORS,
    margin: [2, 2, 2, 2],
    ...(options?.alignment ? { alignment: options.alignment } : {}),
    ...(options?.fillColor ? { fillColor: options.fillColor } : {}),
  };

  if (typeof textOrStack === "string") {
    return {
      ...base,
      text: textOrStack,
      fontSize: options?.fontSize ?? 9.5,
      ...(options?.bold ? { bold: true } : {}),
      color: options?.color ?? PDF_COLORS.ink,
    };
  }

  return {
    ...base,
    stack: textOrStack,
  };
}

export function buildStatusBadgeCell(
  text: string,
  isOk: boolean,
  alignment: "left" | "center" | "right" = "right"
): Record<string, unknown> {
  return {
    text,
    fontSize: 8.5,
    bold: true,
    color: isOk ? PDF_COLORS.totalsMintText : PDF_COLORS.errorRedText,
    fillColor: isOk ? PDF_COLORS.totalsMintBg : PDF_COLORS.errorRedBg,
    alignment,
    borderColor: TABLE_CELL_BORDER_COLORS,
    margin: [4, 3, 4, 3],
  };
}

export interface PastelTableOptions {
  widths: Array<string | number>;
  body: Array<Array<Record<string, unknown>>>;
  headerRows?: number;
  marginBottom?: number;
}

export function buildPastelTable(options: PastelTableOptions): Record<string, unknown> {
  return {
    table: {
      headerRows: options.headerRows ?? 1,
      dontBreakRows: true,
      widths: options.widths,
      body: options.body,
    },
    layout: buildPastelTableLayout(),
    margin: [0, 0, 0, options.marginBottom ?? 12],
  };
}

export interface TotalsBannerItem {
  label: string;
  value: string;
  alignment?: "left" | "center" | "right";
  emphasize?: boolean;
}

export function buildTotalsBanner(
  items: TotalsBannerItem[],
  marginBottom = 12
): Record<string, unknown> {
  const cells = items.map((item, idx) => {
    const align =
      item.alignment ??
      (idx === 0 ? "left" : idx === items.length - 1 ? "right" : "center");
    const alignProp = align === "left" ? {} : { alignment: align };

    return {
      stack: [
        {
          text: item.label,
          fontSize: 8.5,
          ...(item.emphasize ? { bold: true } : {}),
          color: PDF_COLORS.totalsMintText,
          ...alignProp,
        },
        {
          text: item.value,
          fontSize: item.emphasize ? 12 : 10,
          bold: true,
          color: PDF_COLORS.totalsMintText,
          ...alignProp,
          margin: [0, 2, 0, 0],
        },
      ],
      fillColor: PDF_COLORS.totalsMintBg,
      margin: [8, 7, 8, 7],
    };
  });

  return {
    table: {
      dontBreakRows: true,
      widths: items.map(() => "*"),
      body: [cells],
    },
    layout: "noBorders",
    margin: [0, 0, 0, marginBottom],
  };
}

export function buildCreamNoticeBox(
  stackItems: Array<Record<string, unknown>>,
  marginBottom = 10
): Record<string, unknown> {
  return {
    table: {
      dontBreakRows: true,
      widths: ["*"],
      body: [
        [
          {
            stack: stackItems,
            fillColor: PDF_COLORS.creamBg,
            borderColor: [
              PDF_COLORS.creamBorder,
              PDF_COLORS.creamBorder,
              PDF_COLORS.creamBorder,
              PDF_COLORS.creamBorder,
            ],
            margin: [10, 8, 10, 8],
          },
        ],
      ],
    },
    layout: {
      hLineWidth: () => 1,
      vLineWidth: () => 1,
      hLineColor: () => PDF_COLORS.creamBorder,
      vLineColor: () => PDF_COLORS.creamBorder,
    },
    margin: [0, 0, 0, marginBottom],
  };
}

export function buildSlateInfoStrip(
  content: string | Array<Record<string, unknown>>,
  options?: {
    alignment?: "left" | "center" | "right";
    fontSize?: number;
    color?: string;
    marginBottom?: number;
  }
): Record<string, unknown> {
  const cell: Record<string, unknown> = {
    text: content,
    fontSize: options?.fontSize ?? 8.5,
    alignment: options?.alignment ?? "center",
    fillColor: PDF_COLORS.slateBg,
    margin: [8, 6, 8, 6],
    ...(typeof content === "string" ? { color: options?.color ?? PDF_COLORS.slateLabel } : {}),
  };

  return {
    table: {
      dontBreakRows: true,
      widths: ["*"],
      body: [[cell]],
    },
    layout: "noBorders",
    margin: [0, 0, 0, options?.marginBottom ?? 10],
  };
}

export function buildIbanStrip(
  iban: string,
  bankName?: string,
  marginBottom = 10
): Record<string, unknown> {
  const trimmedBank = bankName?.trim() ?? "";
  return buildSlateInfoStrip(
    [
      { text: "Cuenta corriente / IBAN: ", bold: true, color: PDF_COLORS.slateLabel },
      { text: iban, bold: true, color: PDF_COLORS.slateDark },
      ...(trimmedBank ? [{ text: `  ·  ${trimmedBank}`, color: PDF_COLORS.slateSubtle }] : []),
    ],
    { alignment: "center", fontSize: 8.5, marginBottom }
  );
}

export interface SignaturePartySpec {
  title: string;
  signatureDataUrl?: string | null;
  name?: string;
  nif?: string;
}

export interface DualSignatureBlockOptions {
  left: SignaturePartySpec;
  right: SignaturePartySpec;
  marginBottom?: number;
}

function buildSignatureBox(party: SignaturePartySpec): Record<string, unknown> {
  const stack: Array<Record<string, unknown>> = [
    {
      text: party.title,
      fontSize: 8.5,
      bold: true,
      color: PDF_COLORS.ink,
      alignment: "center",
      margin: [0, 0, 0, 4],
    },
    party.signatureDataUrl
      ? {
          image: party.signatureDataUrl,
          fit: [170, 58],
          alignment: "center",
          margin: [0, 4, 0, 4],
        }
      : {
          text: "\n\n\n____________________________",
          alignment: "center",
          color: PDF_COLORS.footerGray,
          fontSize: 9,
          margin: [0, 2, 0, 4],
        },
    {
      text: party.name?.trim() || "-",
      fontSize: 8.5,
      bold: true,
      color: PDF_COLORS.slateDark,
      alignment: "center",
    },
  ];

  if (party.nif?.trim()) {
    stack.push({
      text: `DNI/NIF: ${party.nif.trim()}`,
      fontSize: 8,
      color: PDF_COLORS.slateSubtle,
      alignment: "center",
      margin: [0, 1, 0, 0],
    });
  }

  return {
    table: {
      dontBreakRows: true,
      widths: ["*"],
      body: [
        [
          {
            stack,
            borderColor: TABLE_CELL_BORDER_COLORS,
            margin: [8, 8, 8, 8],
          },
        ],
      ],
    },
    layout: {
      hLineWidth: () => 0.75,
      vLineWidth: () => 0.75,
      hLineColor: () => PDF_COLORS.tableBorderGray,
      vLineColor: () => PDF_COLORS.tableBorderGray,
    },
  };
}

export function buildDualSignatureBlock(
  options: DualSignatureBlockOptions
): Record<string, unknown> {
  return {
    columns: [buildSignatureBox(options.left), buildSignatureBox(options.right)],
    columnGap: 18,
    unbreakable: true,
    margin: [0, 0, 0, options.marginBottom ?? 10],
  };
}

export function buildUnifiedFooter(marginTop = 4): Record<string, unknown> {
  return {
    text: PDF_FOOTER_TEXT,
    fontSize: 8,
    color: PDF_COLORS.footerGray,
    alignment: "center",
    margin: [0, marginTop, 0, 0],
  };
}
