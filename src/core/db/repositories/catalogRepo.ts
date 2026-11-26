import type {
  CatalogCategory,
  CatalogItemRow,
  CatalogPricingMode,
  FeedbackCorrectionRecord,
  QuoteVatRate,
  SqliteExecutor,
} from "../../contracts/types";
import {
  computeTemplatePreviewPriceCents,
  findMatchingCatalogItemForTemplate,
  type PredefinedCatalogTemplate,
} from "../../pricing/predefinedCatalog";
import { computeCatalogUnitPriceCents } from "../../pricing/pricingEngine";
import { sanitizeFts5Query } from "../sqliteExecutor";

export interface CatalogItemInput {
  description: string;
  category?: CatalogCategory;
  unit?: string;
  unit_price_cents: number;
  pricing_mode?: CatalogPricingMode;
  estimated_hours_thousandths?: number;
  materials_cents?: number;
  default_vat_rate?: QuoteVatRate;
}

function mapCatalogRow(row: CatalogItemRow): CatalogItemRow {
  return {
    ...row,
    unit_price_cents: Number(row.unit_price_cents),
    pricing_mode: row.pricing_mode === "hourly_plus_materials" ? "hourly_plus_materials" : "fixed",
    estimated_hours_thousandths: Number(row.estimated_hours_thousandths ?? 0),
    materials_cents: Number(row.materials_cents ?? 0),
    default_vat_rate: Number(row.default_vat_rate) as QuoteVatRate,
    active: Number(row.active) === 1 ? 1 : 0,
    created_at_ms: Number(row.created_at_ms),
    updated_at_ms: Number(row.updated_at_ms),
  };
}

export class CatalogRepository {
  constructor(private readonly executor: SqliteExecutor) {}

  private async getCurrentHourlyRateCents(): Promise<number> {
    const rows = await this.executor.query<{ hourly_rate_cents?: number }>(
      `SELECT hourly_rate_cents FROM app_settings WHERE id = 1 LIMIT 1`
    );
    return Number(rows[0]?.hourly_rate_cents ?? 3800);
  }

  async listPaginated(opts?: {
    search?: string;
    category?: CatalogCategory;
    includeInactive?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ items: CatalogItemRow[]; totalCount: number }> {
    const limit = Math.max(1, Math.min(100, opts?.limit ?? 25));
    const offset = Math.max(0, opts?.offset ?? 0);
    const fts = opts?.search ? sanitizeFts5Query(opts.search) : "";
    const activeClause = opts?.includeInactive ? "1=1" : "c.active = 1";
    const catParams: unknown[] = [];
    const catClause = opts?.category ? "AND c.category = ?" : "";
    if (opts?.category) catParams.push(opts.category);

    if (fts.length > 0) {
      const countRows = await this.executor.query<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt
         FROM catalog_items c
         JOIN catalog_items_fts f ON c.rowid = f.rowid
         WHERE catalog_items_fts MATCH ? AND ${activeClause} ${catClause}`,
        [fts, ...catParams]
      );
      const items = await this.executor.query<CatalogItemRow>(
        `SELECT c.*, bm25(catalog_items_fts) AS rank_score
         FROM catalog_items c
         JOIN catalog_items_fts f ON c.rowid = f.rowid
         WHERE catalog_items_fts MATCH ? AND ${activeClause} ${catClause}
         ORDER BY rank_score ASC, c.updated_at_ms DESC
         LIMIT ? OFFSET ?`,
        [fts, ...catParams, limit, offset]
      );
      return { items: items.map(mapCatalogRow), totalCount: countRows[0]?.cnt ?? 0 };
    }

    const plainActiveClause = opts?.includeInactive ? "1=1" : "active = 1";
    const plainCatClause = opts?.category ? "AND category = ?" : "";
    const countRows = await this.executor.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM catalog_items WHERE ${plainActiveClause} ${plainCatClause}`,
      catParams
    );
    const items = await this.executor.query<CatalogItemRow>(
      `SELECT * FROM catalog_items
       WHERE ${plainActiveClause} ${plainCatClause}
       ORDER BY category ASC, description ASC
       LIMIT ? OFFSET ?`,
      [...catParams, limit, offset]
    );
    return { items: items.map(mapCatalogRow), totalCount: countRows[0]?.cnt ?? 0 };
  }

  async searchFts5WithScore(
    search: string,
    limit = 5
  ): Promise<Array<CatalogItemRow & { bm25_score: number }>> {
    const fts = sanitizeFts5Query(search);
    if (!fts) return [];
    const rows = await this.executor.query<CatalogItemRow & { bm25_score: number }>(
      `SELECT c.*, bm25(catalog_items_fts) AS bm25_score
       FROM catalog_items c
       JOIN catalog_items_fts f ON c.rowid = f.rowid
       WHERE catalog_items_fts MATCH ? AND c.active = 1
       ORDER BY bm25_score ASC
       LIMIT ?`,
      [fts, limit]
    );
    return rows.map((r) => ({ ...mapCatalogRow(r), bm25_score: Number(r.bm25_score) }));
  }

  async getById(id: string): Promise<CatalogItemRow | null> {
    const rows = await this.executor.query<CatalogItemRow>(
      `SELECT * FROM catalog_items WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows[0] ? mapCatalogRow(rows[0]) : null;
  }

  async create(input: CatalogItemInput, idOverride?: string): Promise<CatalogItemRow> {
    const desc = input.description.trim();
    if (!desc) {
      throw new Error("SCHEMA_VALIDATION_ERROR: Descripción obligatoria");
    }
    const pricingMode: CatalogPricingMode = input.pricing_mode ?? "fixed";
    const estimatedHoursThousandths = Math.max(
      0,
      Math.round(input.estimated_hours_thousandths ?? 0)
    );
    const materialsCents = Math.max(0, Math.round(input.materials_cents ?? 0));
    const hourlyRateCents =
      pricingMode === "hourly_plus_materials" ? await this.getCurrentHourlyRateCents() : 3800;

    const unitPriceCents =
      pricingMode === "hourly_plus_materials"
        ? computeCatalogUnitPriceCents({
            pricing_mode: pricingMode,
            estimated_hours_thousandths: estimatedHoursThousandths,
            materials_cents: materialsCents,
            hourly_rate_cents: hourlyRateCents,
            fixed_price_cents: input.unit_price_cents,
          })
        : input.unit_price_cents;

    if (!Number.isInteger(unitPriceCents) || unitPriceCents <= 0) {
      throw new Error("SCHEMA_VALIDATION_ERROR: El precio unitario debe ser > 0 céntimos");
    }
    const now = Date.now();
    const id = idOverride ?? `cat_${crypto.randomUUID().slice(0, 12)}`;
    await this.executor.run(
      `INSERT INTO catalog_items (
        id, description, category, unit, unit_price_cents, pricing_mode,
        estimated_hours_thousandths, materials_cents, default_vat_rate,
        active, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [
        id,
        desc,
        input.category ?? "General",
        (input.unit ?? "ud").trim() || "ud",
        unitPriceCents,
        pricingMode,
        estimatedHoursThousandths,
        materialsCents,
        input.default_vat_rate ?? 21,
        now,
        now,
      ]
    );
    const created = await this.getById(id);
    if (!created) throw new Error("SQLITE_QUERY_ERROR: error creando partida");
    return mapCatalogRow(created);
  }

  async update(id: string, input: Partial<CatalogItemInput>): Promise<CatalogItemRow> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new Error("INVALID_STATE_TRANSITION: Partida no encontrada");
    }
    const desc = input.description !== undefined ? input.description.trim() : existing.description;
    if (!desc) {
      throw new Error("SCHEMA_VALIDATION_ERROR: Descripción obligatoria");
    }
    const pricingMode: CatalogPricingMode =
      input.pricing_mode ?? existing.pricing_mode ?? "fixed";
    const estimatedHoursThousandths = Math.max(
      0,
      Math.round(
        input.estimated_hours_thousandths ?? existing.estimated_hours_thousandths ?? 0
      )
    );
    const materialsCents = Math.max(
      0,
      Math.round(input.materials_cents ?? existing.materials_cents ?? 0)
    );
    const hourlyRateCents =
      pricingMode === "hourly_plus_materials" ? await this.getCurrentHourlyRateCents() : 3800;

    const price =
      pricingMode === "hourly_plus_materials"
        ? computeCatalogUnitPriceCents({
            pricing_mode: pricingMode,
            estimated_hours_thousandths: estimatedHoursThousandths,
            materials_cents: materialsCents,
            hourly_rate_cents: hourlyRateCents,
            fixed_price_cents: input.unit_price_cents ?? existing.unit_price_cents,
          })
        : (input.unit_price_cents ?? existing.unit_price_cents);

    if (!Number.isInteger(price) || price <= 0) {
      throw new Error("SCHEMA_VALIDATION_ERROR: El precio unitario debe ser > 0 céntimos");
    }
    const now = Date.now();
    await this.executor.run(
      `UPDATE catalog_items
       SET description = ?, category = ?, unit = ?, unit_price_cents = ?,
           pricing_mode = ?, estimated_hours_thousandths = ?, materials_cents = ?,
           default_vat_rate = ?, updated_at_ms = ?
       WHERE id = ?`,
      [
        desc,
        input.category ?? existing.category,
        input.unit !== undefined ? input.unit.trim() || "ud" : existing.unit,
        price,
        pricingMode,
        estimatedHoursThousandths,
        materialsCents,
        input.default_vat_rate ?? existing.default_vat_rate,
        now,
        id,
      ]
    );
    const updated = await this.getById(id);
    if (!updated) throw new Error("SQLITE_QUERY_ERROR: error actualizando partida");
    return mapCatalogRow(updated);
  }

  async activatePredefinedTemplate(
    template: PredefinedCatalogTemplate,
    hourlyRateCents?: number,
    options?: { customUnitPriceCents?: number }
  ): Promise<{ item: CatalogItemRow; createdOrReactivated: boolean }> {
    const rate = hourlyRateCents ?? (await this.getCurrentHourlyRateCents());
    const defaultPriceCents = computeTemplatePreviewPriceCents(template, rate);

    if (options?.customUnitPriceCents !== undefined) {
      if (
        !Number.isInteger(options.customUnitPriceCents) ||
        options.customUnitPriceCents <= 0
      ) {
        throw new Error("SCHEMA_VALIDATION_ERROR: El precio unitario debe ser > 0 céntimos");
      }
    }

    const hasCustomOverride =
      options?.customUnitPriceCents !== undefined &&
      options.customUnitPriceCents !== defaultPriceCents;
    const unitPriceCents = hasCustomOverride ? options!.customUnitPriceCents! : defaultPriceCents;
    const pricingMode: CatalogPricingMode = hasCustomOverride ? "fixed" : template.pricing_mode;
    const estimatedHoursThousandths = hasCustomOverride ? 0 : template.estimated_hours_thousandths;
    const materialsCents = hasCustomOverride ? 0 : template.materials_cents;

    const allRows = await this.executor.query<CatalogItemRow>(`SELECT * FROM catalog_items`);
    const existing = findMatchingCatalogItemForTemplate(template, allRows);

    if (existing) {
      if (Number(existing.active) === 1) {
        return { item: mapCatalogRow(existing), createdOrReactivated: false };
      }
      const now = Date.now();
      await this.executor.run(
        `UPDATE catalog_items
         SET active = 1, category = ?, unit = ?, unit_price_cents = ?,
             pricing_mode = ?, estimated_hours_thousandths = ?, materials_cents = ?,
             default_vat_rate = ?, updated_at_ms = ?
         WHERE id = ?`,
        [
          template.category,
          template.unit,
          unitPriceCents,
          pricingMode,
          estimatedHoursThousandths,
          materialsCents,
          template.default_vat_rate,
          now,
          existing.id,
        ]
      );
      const reactivated = await this.getById(existing.id);
      if (!reactivated) throw new Error("SQLITE_QUERY_ERROR: error reactivando plantilla");
      return { item: mapCatalogRow(reactivated), createdOrReactivated: true };
    }

    const idTaken = allRows.some((r) => r.id === template.template_id);
    const item = await this.create(
      {
        description: template.description,
        category: template.category,
        unit: template.unit,
        unit_price_cents: unitPriceCents,
        pricing_mode: pricingMode,
        estimated_hours_thousandths: estimatedHoursThousandths,
        materials_cents: materialsCents,
        default_vat_rate: template.default_vat_rate,
      },
      idTaken ? undefined : template.template_id
    );
    return { item, createdOrReactivated: true };
  }

  async reactivate(id: string): Promise<CatalogItemRow> {
    await this.executor.run(
      `UPDATE catalog_items SET active = 1, updated_at_ms = ? WHERE id = ?`,
      [Date.now(), id]
    );
    const updated = await this.getById(id);
    if (!updated) throw new Error("INVALID_STATE_TRANSITION: Partida no encontrada");
    return mapCatalogRow(updated);
  }

  async deactivate(id: string): Promise<void> {
    await this.executor.run(
      `UPDATE catalog_items SET active = 0, updated_at_ms = ? WHERE id = ?`,
      [Date.now(), id]
    );
  }

  async listFeedbackCorrections(limit = 50): Promise<FeedbackCorrectionRecord[]> {
    return this.executor.query<FeedbackCorrectionRecord & Record<string, unknown>>(
      `SELECT fc.id, fc.catalog_item_id, ci.description AS item_description,
              fc.quote_id, fc.old_unit_price_cents, fc.new_unit_price_cents, fc.created_at_ms
       FROM feedback_corrections fc
       JOIN catalog_items ci ON ci.id = fc.catalog_item_id
       ORDER BY fc.created_at_ms DESC
       LIMIT ?`,
      [limit]
    );
  }
}
