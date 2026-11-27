import {
  PricingSettingsInputSchema,
  TaxSettingsInputSchema,
} from "../../core/contracts/schemas";
import type {
  CatalogCategory,
  CatalogItemRow,
  CatalogPricingMode,
  DocumentImportExtractedItem,
  DocumentImportReviewDraft,
  QuoteVatRate,
  SqliteExecutor,
} from "../../core/contracts/types";
import { computeCatalogUnitPriceCents } from "../../core/pricing/pricingEngine";
import type { OcrPort } from "../../core/ports/mediaPorts";
import { sanitizeQuoteItemDescription } from "../../core/text/quoteDescriptionSanitizer";
import { normalizeSpanishText, parseEurosToCents } from "../../core/text/spanishText";

const MAX_PDF_PAGES = 15;
const MIN_EMBEDDED_CHARS_PER_PAGE = 20;

function resolvePublicAsset(relativePath: string): string {
  const base = import.meta.env.BASE_URL ?? "/";
  const cleanBase = base.endsWith("/") ? base : `${base}/`;
  const cleanRel = relativePath.replace(/^\/+/, "");
  return `${cleanBase}${cleanRel}`;
}

function inferCategoryFromDescription(raw: string): CatalogCategory {
  const norm = normalizeSpanishText(raw);
  if (
    /\b(grifo|termo|fontaneria|tuberia|latiguillo|desague|inodoro|cisterna|lavabo|llave de escuadra|valvula|caldera)\b/.test(
      norm
    )
  ) {
    return "Fontanería";
  }
  if (
    /\b(cuadro electrico|punto de luz|enchufe|diferencial|magnetotermico|icp|iga|pia|cable|electricidad|boletin|cie|conmutado|led)\b/.test(
      norm
    )
  ) {
    return "Electricidad";
  }
  if (/\b(pintura|pintar|esmalte|plastica|techo|alisado|gotele|rodillo)\b/.test(norm)) {
    return "Pintura";
  }
  if (
    /\b(alicatado|plato de ducha|azulejo|tabique|escombro|desescombro|cemento|solado|albanileria|pladur|yeso|solera)\b/.test(
      norm
    )
  ) {
    return "Albañilería";
  }
  return "General";
}

function normalizeUnitToken(raw: string | undefined): string {
  const norm = normalizeSpanishText(raw ?? "");
  if (norm === "m2" || norm === "m²" || norm.startsWith("metro cuadrado")) return "m2";
  if (norm === "ml" || norm.startsWith("metro lineal")) return "ml";
  if (norm === "h" || norm.startsWith("hora")) return "h";
  if (norm === "lote" || norm === "lotes") return "lote";
  if (norm === "kg") return "kg";
  return "ud";
}

function isSummaryOrNoiseLine(norm: string): boolean {
  if (norm.length < 4) return true;
  if (
    /^(subtotal|base imponible|total|total presupuesto|total factura|iva\s*\d*|irpf|retencion|nif|cif|dni|fecha|validez|cliente|emisor|iban|forma de pago|pagina|observaciones|notas|codigo|descripcion|concepto|importe|cantidad|precio|unidad)\b/.test(
      norm
    )
  ) {
    return true;
  }
  if (/^\d+[.,]\d{2}\s*(€|eur)?$/.test(norm)) {
    return true;
  }
  return false;
}

export function parseCatalogAndRatesFromText(params: {
  documents: Array<{ fileName: string; rawText: string }>;
  currentHourlyRateCents: number;
  existingCatalog: ReadonlyArray<CatalogItemRow>;
  sourceFiles?: DocumentImportReviewDraft["source_files"];
  warnings?: string[];
}): DocumentImportReviewDraft {
  const {
    documents,
    currentHourlyRateCents,
    existingCatalog,
    sourceFiles = [],
    warnings = [],
  } = params;

  const catalogByNormDesc = new Map<string, CatalogItemRow>();
  for (const existing of existingCatalog) {
    catalogByNormDesc.set(normalizeSpanishText(existing.description), existing);
  }

  const vatCounts = new Map<QuoteVatRate, number>();
  const irpfVotes: number[] = [];
  const hourlyRateCandidates: number[] = [];
  const extractedItems: DocumentImportExtractedItem[] = [];
  const seenDescriptions = new Set<string>();

  for (const doc of documents) {
    const lines = doc.rawText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    for (const rawLine of lines) {
      const normLine = normalizeSpanishText(rawLine);

      // 1. Detectar IVA predominante
      const vatRx = /\bi\.?\s*v\.?\s*a\.?(?:\s+[a-z0-9]+){0,4}[:\s]*(?:al\s+)?(4|10|21)\s*%/gi;
      let vatMatch: RegExpExecArray | null;
      while ((vatMatch = vatRx.exec(normLine)) !== null) {
        const rate = Number(vatMatch[1]) as QuoteVatRate;
        vatCounts.set(rate, (vatCounts.get(rate) ?? 0) + 1);
      }

      // 2. Detectar IRPF si consta retención
      const irpfMatch =
        /\b(?:irpf|retencion(?:\s+irpf)?)[:\s]*(?:-\s*)?(7|15|20)\s*%/i.exec(normLine);
      if (irpfMatch?.[1]) {
        irpfVotes.push(Number(irpfMatch[1]));
      }

      // 3. Detectar tarifa/hora explícita (€/h o eur/hora)
      const hourlyMatch =
        /(?:tarifa\s*(?:base|hora)?|mano\s+de\s+obra|precio\s*hora|oficial)[^0-9\n]{0,30}(\d+(?:[.,]\d{1,2})?)\s*(?:€|eur|euros)\s*(?:\/\s*h(?:ora)?|\bpor\s+hora\b)?/i.exec(
          normLine
        ) ?? /(\d+(?:[.,]\d{1,2})?)\s*(?:€|eur)\s*\/\s*h(?:ora)?\b/i.exec(normLine);
      if (hourlyMatch?.[1]) {
        const cents = parseEurosToCents(hourlyMatch[1]);
        if (cents && cents >= 1000 && cents <= 20000) {
          hourlyRateCandidates.push(cents);
        }
      }

      // 4. Extraer partidas candidatas desde formato delimitado (CSV/TSV) o líneas de presupuesto/factura
      if (isSummaryOrNoiseLine(normLine)) {
        continue;
      }

      let description = "";
      let unit = "ud";
      let pricingMode: CatalogPricingMode = "fixed";
      let estimatedHoursThousandths = 0;
      let materialsCents = 0;
      let unitPriceCents: number | null = null;
      let lineVatRate: QuoteVatRate = 21;

      const csvParts = rawLine.split(/[;\t|]+/).map((p) => p.trim());
      if (csvParts.length >= 2) {
        const descCand = csvParts[0] ?? "";
        const pricePart = csvParts.find((p, idx) => idx > 0 && /\d/.test(p) && !/%/.test(p));
        const unitPart = csvParts.find((p, idx) =>
          idx > 0 && /^(ud|uds|h|hora|horas|m2|m²|ml|lote|kg)$/i.test(p)
        );
        const vatPart = csvParts.find((p, idx) => idx > 0 && /\b(4|10|21)\s*%?$/.test(p) && /%|iva/i.test(p));
        if (descCand.length >= 3 && pricePart) {
          const parsedCents = parseEurosToCents(pricePart.replace(/[^\d.,]/g, ""));
          if (parsedCents && parsedCents > 0) {
            const cleanedDesc = sanitizeQuoteItemDescription(descCand, {
              knownPricesCents: [parsedCents],
            });
            if (cleanedDesc.length >= 3) {
              description = cleanedDesc;
              unit = normalizeUnitToken(unitPart);
              unitPriceCents = parsedCents;
              if (vatPart) {
                const vm = /\b(4|10|21)\b/.exec(vatPart);
                if (vm?.[1]) lineVatRate = Number(vm[1]) as QuoteVatRate;
              }
            }
          }
        }
      }

      if (unitPriceCents === null) {
        // Línea libre tipo: "2 ud Cambio de grifo monomando ... 89,00 €" o "Instalación termo - 320 €"
        const priceAtEnd =
          /^(?:(\d+(?:[.,]\d+)?)\s*(m2|m²|ml|kg|lotes?|horas?|h|uds?)\s+)?(.{3,600}?)\s*(?:[-–:|·]|a\s+precio|pvp)?\s*(\d{1,4}(?:\.\d{3})*(?:,\d{1,2}|\.\d{1,2})?)\s*(?:€|eur|euros)(?:\s*\/\s*(m2|m²|ml|h|ud|lote))?(?:\s*\(.*\))?$/i.exec(
            rawLine
          );

        if (priceAtEnd) {
          const qtyRaw = priceAtEnd[1];
          const qtyUnitRaw = priceAtEnd[2] ?? priceAtEnd[5];
          let rawDesc = (priceAtEnd[3] ?? "").replace(/[-–:|·]+$/g, "").trim();
          const parsedMoney = parseEurosToCents(priceAtEnd[4] ?? "");

          if (rawDesc.length >= 3 && parsedMoney && parsedMoney > 0 && !isSummaryOrNoiseLine(normalizeSpanishText(rawDesc))) {
            unit = normalizeUnitToken(qtyUnitRaw);
            const qtyNum = qtyRaw ? Number(qtyRaw.replace(",", ".")) : 1;
            const looksTotalWithMultiQty =
              qtyRaw !== undefined &&
              Number.isFinite(qtyNum) &&
              qtyNum > 1 &&
              unit !== "h" &&
              !/\/(ud|m2|m²|ml|h|lote)/i.test(rawLine);

            // Si aparece "2 ud ... 178 €", intentar no confundir si es unitario vs total: conservamos el importe unitario estimado cuando qty > 1 y divisible limpio
            if (looksTotalWithMultiQty) {
              unitPriceCents = Math.max(100, Math.round(parsedMoney / qtyNum));
            } else {
              unitPriceCents = parsedMoney;
            }

            if (unit === "h" && qtyRaw && Number.isFinite(qtyNum) && qtyNum > 0) {
              pricingMode = "hourly_plus_materials";
              estimatedHoursThousandths = Math.round(qtyNum * 1000);
              const refRate = hourlyRateCandidates[0] ?? currentHourlyRateCents;
              unitPriceCents = computeCatalogUnitPriceCents({
                pricing_mode: "hourly_plus_materials",
                estimated_hours_thousandths: estimatedHoursThousandths,
                materials_cents: 0,
                hourly_rate_cents: refRate,
                fixed_price_cents: unitPriceCents,
              });
              unit = "ud";
            }

            const hoursInline = /(\d+(?:[.,]\d+)?)\s*h(?:oras?)?\b/i.exec(rawDesc);
            if (hoursInline?.[1] && pricingMode === "fixed") {
              const hNum = Number(hoursInline[1].replace(",", "."));
              const refRate = hourlyRateCandidates[0] ?? currentHourlyRateCents;
              const laborCents = Math.round(hNum * refRate);
              if (Number.isFinite(hNum) && hNum > 0 && laborCents <= unitPriceCents) {
                pricingMode = "hourly_plus_materials";
                estimatedHoursThousandths = Math.round(hNum * 1000);
                materialsCents = Math.max(0, unitPriceCents - laborCents);
              }
            }

            rawDesc = rawDesc.replace(/\biva\s*\d{1,2}\s*%/gi, "").trim();
            description = sanitizeQuoteItemDescription(rawDesc, {
              knownPricesCents: [unitPriceCents, parsedMoney],
            });
          }
        }
      }

      if (!description || unitPriceCents === null || unitPriceCents <= 0) {
        continue;
      }

      const normDesc = normalizeSpanishText(description);
      if (isSummaryOrNoiseLine(normDesc) || seenDescriptions.has(normDesc)) {
        continue;
      }
      seenDescriptions.add(normDesc);

      const category = inferCategoryFromDescription(description);
      const existingMatch = catalogByNormDesc.get(normDesc) ?? null;

      extractedItems.push({
        temp_id: `imp_${extractedItems.length + 1}_${crypto.randomUUID().slice(0, 6)}`,
        selected: true,
        description,
        category,
        unit,
        pricing_mode: pricingMode,
        estimated_hours_thousandths: estimatedHoursThousandths,
        materials_cents: materialsCents,
        unit_price_cents: unitPriceCents,
        default_vat_rate: lineVatRate,
        existing_match_id: existingMatch?.id ?? null,
        source_file_name: doc.fileName,
      });
    }
  }

  let detectedVatRate: QuoteVatRate | null = null;
  let maxVatCount = 0;
  for (const [rate, count] of vatCounts.entries()) {
    if (count > maxVatCount) {
      maxVatCount = count;
      detectedVatRate = rate;
    }
  }
  if (detectedVatRate !== null) {
    for (const item of extractedItems) {
      if (item.default_vat_rate === 21 && detectedVatRate !== 21) {
        item.default_vat_rate = detectedVatRate;
      }
    }
  }

  const inferredHourlyRateCents =
    hourlyRateCandidates.length > 0 ? hourlyRateCandidates[0]! : null;
  const detectedIrpfRate = irpfVotes.length > 0 ? irpfVotes[0]! : null;

  const servicesSet = new Set<string>();
  for (const item of extractedItems) {
    servicesSet.add(item.category);
  }

  if (extractedItems.length === 0 && inferredHourlyRateCents === null) {
    warnings.push(
      "No se detectaron partidas con precio claro automáticamente. Puedes añadir filas manualmente antes de confirmar."
    );
  }

  return {
    source_files: sourceFiles,
    inferred_hourly_rate_cents: inferredHourlyRateCents,
    apply_hourly_rate: inferredHourlyRateCents !== null,
    detected_vat_rate: detectedVatRate,
    detected_irpf_rate: detectedIrpfRate,
    apply_tax_defaults: detectedVatRate !== null || detectedIrpfRate !== null,
    detected_services: Array.from(servicesSet),
    items: extractedItems,
    warnings,
  };
}

async function readPdfFileOffline(params: {
  file: File;
  ocrPort: OcrPort;
}): Promise<{
  rawText: string;
  pagesProcessed: number;
  warnings: string[];
}> {
  const { file, ocrPort } = params;
  const warnings: string[] = [];

  let pdfjs: typeof import("pdfjs-dist/legacy/build/pdf.mjs");
  try {
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch (err) {
    throw new Error(
      `LAZY_CHUNK_LOAD_ERROR: No se pudo cargar el lector PDF local (${err instanceof Error ? err.message : String(err)})`
    );
  }

  pdfjs.GlobalWorkerOptions.workerSrc = resolvePublicAsset("assets/pdf/pdf.worker.min.mjs");

  const buffer = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({
    data: buffer,
    isEvalSupported: false,
    cMapUrl: resolvePublicAsset("assets/pdf/cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: resolvePublicAsset("assets/pdf/standard_fonts/"),
    useWorkerFetch: false,
  });

  const pdfDoc = await loadingTask.promise;
  try {
    const pagesToRead = Math.min(pdfDoc.numPages, MAX_PDF_PAGES);
    if (pdfDoc.numPages > MAX_PDF_PAGES) {
      warnings.push(
        `«${file.name}» tiene ${pdfDoc.numPages} páginas; se analizaron las primeras ${MAX_PDF_PAGES} páginas.`
      );
    }

    const pageTexts: string[] = [];
    const scannedImages: Array<{
      pageNumber: number;
      bytes: Uint8Array;
      mimeType: "image/jpeg";
    }> = [];

    for (let pageNo = 1; pageNo <= pagesToRead; pageNo += 1) {
      const page = await pdfDoc.getPage(pageNo);
      try {
        const textContent = await page.getTextContent();
        const rawPageText = textContent.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
          .replace(/\s{2,}/g, "\n")
          .trim();

        const nonWhitespaceLen = rawPageText.replace(/\s+/g, "").length;
        if (nonWhitespaceLen >= MIN_EMBEDDED_CHARS_PER_PAGE) {
          pageTexts.push(rawPageText);
        } else if (typeof document !== "undefined") {
          const baseViewport = page.getViewport({ scale: 1 });
          const maxSide = Math.max(baseViewport.width, baseViewport.height, 1);
          const scale = Math.min(2, 1600 / maxSide);
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(viewport.width));
          canvas.height = Math.max(1, Math.round(viewport.height));
          const ctx = canvas.getContext("2d");
          if (ctx) {
            await page.render({ canvasContext: ctx, viewport }).promise;
            const blob = await new Promise<Blob | null>((resolve) =>
              canvas.toBlob(resolve, "image/jpeg", 0.88)
            );
            canvas.width = 0;
            canvas.height = 0;
            if (blob) {
              scannedImages.push({
                pageNumber: pageNo,
                bytes: new Uint8Array(await blob.arrayBuffer()),
                mimeType: "image/jpeg",
              });
            }
          }
        }
      } finally {
        page.cleanup();
      }
    }

    if (scannedImages.length > 0) {
      const ocrResults = await ocrPort.extractRawTextBatch(
        scannedImages.map((s) => ({ bytes: s.bytes, mimeType: s.mimeType }))
      );
      for (const r of ocrResults) {
        if (r.rawText.trim()) {
          pageTexts.push(r.rawText.trim());
        }
      }
    }

    return {
      rawText: pageTexts.join("\n"),
      pagesProcessed: pagesToRead,
      warnings,
    };
  } finally {
    await pdfDoc.destroy();
  }
}

export async function analyzeDocumentsForCatalog(params: {
  files: File[];
  ocrPort: OcrPort;
  currentHourlyRateCents: number;
  existingCatalog: ReadonlyArray<CatalogItemRow>;
}): Promise<DocumentImportReviewDraft> {
  const { files, ocrPort, currentHourlyRateCents, existingCatalog } = params;

  const docs: Array<{ fileName: string; rawText: string }> = [];
  const sourceFiles: DocumentImportReviewDraft["source_files"] = [];
  const warnings: string[] = [];
  const imageQueue: Array<{
    fileName: string;
    bytes: Uint8Array;
    mimeType: "image/jpeg" | "image/png" | "image/webp";
  }> = [];

  for (const file of files) {
    const lowerName = file.name.toLowerCase();
    const mime = file.type.toLowerCase();

    if (lowerName.endsWith(".txt") || lowerName.endsWith(".csv") || lowerName.endsWith(".tsv") || mime.startsWith("text/")) {
      const rawText = await file.text();
      docs.push({ fileName: file.name, rawText });
      sourceFiles.push({
        name: file.name,
        kind: "text",
        pages_processed: 1,
        extracted_chars: rawText.length,
      });
    } else if (
      lowerName.endsWith(".pdf") ||
      mime === "application/pdf"
    ) {
      const pdfRes = await readPdfFileOffline({ file, ocrPort });
      warnings.push(...pdfRes.warnings);
      docs.push({ fileName: file.name, rawText: pdfRes.rawText });
      sourceFiles.push({
        name: file.name,
        kind: "pdf",
        pages_processed: pdfRes.pagesProcessed,
        extracted_chars: pdfRes.rawText.length,
      });
    } else if (
      lowerName.endsWith(".jpg") ||
      lowerName.endsWith(".jpeg") ||
      lowerName.endsWith(".png") ||
      lowerName.endsWith(".webp") ||
      mime.startsWith("image/")
    ) {
      let imgMime: "image/jpeg" | "image/png" | "image/webp" = "image/jpeg";
      if (lowerName.endsWith(".png") || mime === "image/png") imgMime = "image/png";
      else if (lowerName.endsWith(".webp") || mime === "image/webp") imgMime = "image/webp";
      imageQueue.push({
        fileName: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
        mimeType: imgMime,
      });
    } else {
      warnings.push(`Formato no compatible omitido: «${file.name}».`);
    }
  }

  if (imageQueue.length > 0) {
    const ocrBatch = await ocrPort.extractRawTextBatch(
      imageQueue.map((item) => ({ bytes: item.bytes, mimeType: item.mimeType }))
    );
    imageQueue.forEach((img, idx) => {
      const rawText = ocrBatch[idx]?.rawText ?? "";
      docs.push({ fileName: img.fileName, rawText });
      sourceFiles.push({
        name: img.fileName,
        kind: "image",
        pages_processed: 1,
        extracted_chars: rawText.length,
      });
    });
  }

  return parseCatalogAndRatesFromText({
    documents: docs,
    currentHourlyRateCents,
    existingCatalog,
    sourceFiles,
    warnings,
  });
}

export async function commitImportedCatalogAndConfig(
  executor: SqliteExecutor,
  draft: DocumentImportReviewDraft
): Promise<{
  savedCount: number;
  appliedHourlyRateCents: number | null;
  appliedTaxDefaults: boolean;
}> {
  const selectedItems = draft.items.filter((it) => it.selected);
  if (
    selectedItems.length === 0 &&
    !(draft.apply_hourly_rate && draft.inferred_hourly_rate_cents !== null) &&
    !(draft.apply_tax_defaults && (draft.detected_vat_rate !== null || draft.detected_irpf_rate !== null))
  ) {
    throw new Error("SCHEMA_VALIDATION_ERROR: Selecciona al menos una partida o ajuste para guardar.");
  }

  if (draft.apply_hourly_rate && draft.inferred_hourly_rate_cents !== null) {
    PricingSettingsInputSchema.parse({ hourly_rate_cents: draft.inferred_hourly_rate_cents });
  }

  let savedCount = 0;
  let appliedHourlyRateCents: number | null = null;
  let appliedTaxDefaults = false;
  const now = Date.now();

  await executor.inTransaction(async (tx) => {
    await tx.run(
      `INSERT OR IGNORE INTO app_settings (
        id, emitter_name, emitter_nif, emitter_fiscal_address, emitter_phone,
        last_active_thread_id, pending_camera_context_json, llm_enabled, llm_model_uri,
        default_vat_rate, irpf_reserve_rate, hourly_rate_cents, boot_mode, updated_at_ms
      ) VALUES (1, '', '', '', '', NULL, NULL, 1, NULL, 21, 20, 3800, 'clean', ?)`,
      [now]
    );
    const settingsRows = await tx.query<{
      default_vat_rate?: number;
      irpf_reserve_rate?: number;
      hourly_rate_cents?: number;
    }>(`SELECT default_vat_rate, irpf_reserve_rate, hourly_rate_cents FROM app_settings WHERE id = 1 LIMIT 1`);
    const currentSettings = settingsRows[0] ?? {
      default_vat_rate: 21,
      irpf_reserve_rate: 20,
      hourly_rate_cents: 3800,
    };

    const effectiveHourlyRate =
      draft.apply_hourly_rate && draft.inferred_hourly_rate_cents !== null
        ? draft.inferred_hourly_rate_cents
        : Number(currentSettings.hourly_rate_cents ?? 3800);

    const nextVatRate =
      draft.apply_tax_defaults && draft.detected_vat_rate !== null
        ? draft.detected_vat_rate
        : Number(currentSettings.default_vat_rate ?? 21);

    const nextIrpfRate =
      draft.apply_tax_defaults && draft.detected_irpf_rate !== null
        ? draft.detected_irpf_rate
        : Number(currentSettings.irpf_reserve_rate ?? 20);

    if (draft.apply_tax_defaults && (draft.detected_vat_rate !== null || draft.detected_irpf_rate !== null)) {
      TaxSettingsInputSchema.parse({
        default_vat_rate: nextVatRate,
        irpf_reserve_rate: nextIrpfRate,
      });
      await tx.run(
        `UPDATE app_settings
         SET default_vat_rate = ?, irpf_reserve_rate = ?, updated_at_ms = ?
         WHERE id = 1`,
        [nextVatRate, nextIrpfRate, now]
      );
      appliedTaxDefaults = true;
    }

    if (draft.apply_hourly_rate && draft.inferred_hourly_rate_cents !== null) {
      await tx.run(
        `UPDATE app_settings SET hourly_rate_cents = ?, updated_at_ms = ? WHERE id = 1`,
        [effectiveHourlyRate, now]
      );
      appliedHourlyRateCents = effectiveHourlyRate;

      // Recalcular partidas dinámicas existentes que no se sobrescriban abajo
      const existingDynamic = await tx.query<{
        id: string;
        estimated_hours_thousandths: number;
        materials_cents: number;
      }>(
        `SELECT id, estimated_hours_thousandths, materials_cents
         FROM catalog_items
         WHERE pricing_mode = 'hourly_plus_materials'`
      );
      for (const row of existingDynamic) {
        const recalculated = computeCatalogUnitPriceCents({
          pricing_mode: "hourly_plus_materials",
          estimated_hours_thousandths: Number(row.estimated_hours_thousandths ?? 0),
          materials_cents: Number(row.materials_cents ?? 0),
          hourly_rate_cents: effectiveHourlyRate,
          fixed_price_cents: 0,
        });
        if (recalculated > 0) {
          await tx.run(
            `UPDATE catalog_items SET unit_price_cents = ?, updated_at_ms = ? WHERE id = ?`,
            [recalculated, now, row.id]
          );
        }
      }
    }

    for (const item of selectedItems) {
      const desc = sanitizeQuoteItemDescription(item.description.trim(), {
        knownPricesCents: [item.unit_price_cents],
      });
      if (!desc) {
        throw new Error("SCHEMA_VALIDATION_ERROR: Todas las partidas seleccionadas requieren descripción.");
      }
      const computedPrice = computeCatalogUnitPriceCents({
        pricing_mode: item.pricing_mode,
        estimated_hours_thousandths: item.estimated_hours_thousandths,
        materials_cents: item.materials_cents,
        hourly_rate_cents: effectiveHourlyRate,
        fixed_price_cents: item.unit_price_cents,
      });
      if (!Number.isInteger(computedPrice) || computedPrice <= 0) {
        throw new Error(
          `SCHEMA_VALIDATION_ERROR: La partida '${desc}' debe tener un importe superior a 0 €.`
        );
      }

      const unitClean = item.unit.trim() || "ud";
      if (item.existing_match_id) {
        const existingCheck = await tx.query<{ id: string }>(
          `SELECT id FROM catalog_items WHERE id = ? LIMIT 1`,
          [item.existing_match_id]
        );
        if (existingCheck.length > 0) {
          await tx.run(
            `UPDATE catalog_items
             SET description = ?, category = ?, unit = ?, unit_price_cents = ?,
                 pricing_mode = ?, estimated_hours_thousandths = ?, materials_cents = ?,
                 default_vat_rate = ?, active = 1, updated_at_ms = ?
             WHERE id = ?`,
            [
              desc,
              item.category,
              unitClean,
              computedPrice,
              item.pricing_mode,
              item.estimated_hours_thousandths,
              item.materials_cents,
              item.default_vat_rate,
              now,
              item.existing_match_id,
            ]
          );
          savedCount += 1;
          continue;
        }
      }

      const newId = `cat_${crypto.randomUUID().slice(0, 12)}`;
      await tx.run(
        `INSERT INTO catalog_items (
          id, description, category, unit, unit_price_cents, pricing_mode,
          estimated_hours_thousandths, materials_cents, default_vat_rate,
          active, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          newId,
          desc,
          item.category,
          unitClean,
          computedPrice,
          item.pricing_mode,
          item.estimated_hours_thousandths,
          item.materials_cents,
          item.default_vat_rate,
          now,
          now,
        ]
      );
      savedCount += 1;
    }
  });

  return {
    savedCount,
    appliedHourlyRateCents,
    appliedTaxDefaults,
  };
}
