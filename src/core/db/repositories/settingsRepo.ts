import {
  AdminLlmConfigInputSchema,
  EmitterProfileInputSchema,
  PricingSettingsInputSchema,
  TaxSettingsInputSchema,
  type SequenceRowSchema,
} from "../../contracts/schemas";
import { computeCatalogUnitPriceCents } from "../../pricing/pricingEngine";
import type {
  AdminLlmConfigInput,
  AdminLlmConfigRecord,
  AppSettingsRecord,
  EmitterProfileInput,
  LlmStrategyOverride,
  PendingCameraContext,
  RecoveredDraft,
  SeriesType,
  SqliteExecutor,
  TaxSettingsInput,
} from "../../contracts/types";
import type { z } from "zod";

interface RawAppSettingsRow extends Record<string, unknown> {
  id: number;
  emitter_name: string;
  emitter_nif: string;
  emitter_fiscal_address: string;
  emitter_phone: string;
  emitter_iban?: string;
  emitter_logo_data_url?: string | null;
  active_account_id?: string | null;
  last_active_thread_id: string | null;
  pending_camera_context_json: string | null;
  llm_enabled: number;
  llm_model_uri: string | null;
  default_vat_rate: number;
  irpf_reserve_rate: number;
  hourly_rate_cents?: number;
  boot_mode: "demo" | "clean";
  updated_at_ms: number;
}

interface RawRecoveredDraftRow extends Record<string, unknown> {
  id: string;
  thread_id: string;
  original_schema_version: string;
  pending_gate: "gate_1_quote" | "gate_2_ticket";
  widget_json: string;
  active_job_id: string | null;
  active_quote_id: string | null;
  dismissed: number;
  recovered_at_ms: number;
}

function mapSettingsRow(row: RawAppSettingsRow): AppSettingsRecord {
  let pendingCam: PendingCameraContext | null = null;
  if (row.pending_camera_context_json) {
    try {
      pendingCam = JSON.parse(row.pending_camera_context_json) as PendingCameraContext;
    } catch {
      pendingCam = null;
    }
  }
  return {
    id: 1,
    emitter_name: row.emitter_name,
    emitter_nif: row.emitter_nif,
    emitter_fiscal_address: row.emitter_fiscal_address,
    emitter_phone: row.emitter_phone,
    emitter_iban: row.emitter_iban ?? "",
    emitter_logo_data_url: row.emitter_logo_data_url ?? null,
    active_account_id: row.active_account_id ?? null,
    last_active_thread_id: row.last_active_thread_id,
    pending_camera_context: pendingCam,
    llm_enabled: row.llm_enabled === 1,
    llm_model_uri: row.llm_model_uri,
    default_vat_rate: Number(row.default_vat_rate ?? 21),
    irpf_reserve_rate: Number(row.irpf_reserve_rate ?? 20),
    hourly_rate_cents: Number(row.hourly_rate_cents ?? 3800),
    boot_mode: row.boot_mode,
    updated_at_ms: row.updated_at_ms,
  };
}

export async function allocateNextSequence(
  tx: Pick<SqliteExecutor, "query" | "run">,
  seriesType: SeriesType,
  fiscalYear: number,
  nowMs = Date.now()
): Promise<{ seq: number; code: string }> {
  await tx.run(
    `INSERT OR IGNORE INTO sequences (series_type, fiscal_year, last_seq, updated_at_ms)
     VALUES (?, ?, 0, ?)`,
    [seriesType, fiscalYear, nowMs]
  );
  const rows = await tx.query<{ last_seq: number }>(
    `SELECT last_seq FROM sequences WHERE series_type = ? AND fiscal_year = ?`,
    [seriesType, fiscalYear]
  );
  const nextSeq = (rows[0]?.last_seq ?? 0) + 1;
  await tx.run(
    `UPDATE sequences SET last_seq = ?, updated_at_ms = ?
     WHERE series_type = ? AND fiscal_year = ?`,
    [nextSeq, nowMs, seriesType, fiscalYear]
  );
  return {
    seq: nextSeq,
    code: `${seriesType}-${fiscalYear}-${String(nextSeq).padStart(3, "0")}`,
  };
}

export async function peekNextSequenceCode(
  executor: Pick<SqliteExecutor, "query">,
  seriesType: SeriesType,
  fiscalYear: number
): Promise<string> {
  const rows = await executor.query<{ last_seq: number }>(
    `SELECT last_seq FROM sequences WHERE series_type = ? AND fiscal_year = ?`,
    [seriesType, fiscalYear]
  );
  const nextSeq = (rows[0]?.last_seq ?? 0) + 1;
  return `${seriesType}-${fiscalYear}-${String(nextSeq).padStart(3, "0")}`;
}

function extractNumericSuffix(code: string, prefix: string): number {
  if (!code.startsWith(prefix)) return 0;
  const suffix = Number(code.slice(prefix.length));
  return Number.isInteger(suffix) && suffix > 0 ? suffix : 0;
}

export async function rewindSequenceIfLatest(
  tx: Pick<SqliteExecutor, "query" | "run">,
  seriesType: Extract<SeriesType, "PRE" | "ANT" | "FAC">,
  fiscalYear: number,
  deletedCode: string,
  nowMs = Date.now()
): Promise<void> {
  const prefix = `${seriesType}-${fiscalYear}-`;
  const deletedSeq = extractNumericSuffix(deletedCode, prefix);
  if (deletedSeq <= 0) return;

  const seqRows = await tx.query<{ last_seq: number }>(
    `SELECT last_seq FROM sequences WHERE series_type = ? AND fiscal_year = ?`,
    [seriesType, fiscalYear]
  );
  if (!seqRows[0] || Number(seqRows[0].last_seq) !== deletedSeq) {
    return;
  }

  let maxRemaining = 0;
  if (seriesType === "PRE") {
    const rows = await tx.query<{ quote_code: string }>(
      `SELECT quote_code FROM quotes WHERE quote_code LIKE ?`,
      [`${prefix}%`]
    );
    for (const r of rows) {
      maxRemaining = Math.max(maxRemaining, extractNumericSuffix(r.quote_code, prefix));
    }
  } else {
    const rows = await tx.query<{ invoice_number: string }>(
      `SELECT invoice_number FROM invoices WHERE series_type = ? AND fiscal_year = ?`,
      [seriesType, fiscalYear]
    );
    for (const r of rows) {
      maxRemaining = Math.max(maxRemaining, extractNumericSuffix(r.invoice_number, prefix));
    }
  }

  await tx.run(
    `UPDATE sequences SET last_seq = ?, updated_at_ms = ?
     WHERE series_type = ? AND fiscal_year = ?`,
    [maxRemaining, nowMs, seriesType, fiscalYear]
  );
}

export class SettingsRepository {
  constructor(private readonly executor: SqliteExecutor) {}

  async getAppSettingsOrNull(): Promise<AppSettingsRecord | null> {
    const rows = await this.executor.query<RawAppSettingsRow>(
      `SELECT * FROM app_settings WHERE id = 1 LIMIT 1`
    );
    const first = rows[0];
    return first ? mapSettingsRow(first) : null;
  }

  async getAppSettings(): Promise<AppSettingsRecord> {
    const existing = await this.getAppSettingsOrNull();
    if (existing) {
      if (!existing.llm_enabled && existing.llm_model_uri === null) {
        await this.executor.run(
          `UPDATE app_settings SET llm_enabled = 1, updated_at_ms = ? WHERE id = 1`,
          [Date.now()]
        );
        return (await this.getAppSettingsOrNull()) ?? existing;
      }
      return existing;
    }
    const now = Date.now();
    await this.executor.run(
      `INSERT OR IGNORE INTO app_settings (
        id, emitter_name, emitter_nif, emitter_fiscal_address, emitter_phone,
        emitter_iban, emitter_logo_data_url, active_account_id,
        last_active_thread_id, pending_camera_context_json, llm_enabled, llm_model_uri,
        default_vat_rate, irpf_reserve_rate, hourly_rate_cents, boot_mode, updated_at_ms
      ) VALUES (1, '', '', '', '', '', NULL, NULL, NULL, NULL, 1, NULL, 21, 20, 3800, 'clean', ?)`,
      [now]
    );
    const created = await this.getAppSettingsOrNull();
    if (!created) {
      throw new Error("SQLITE_QUERY_ERROR: no se pudo inicializar app_settings");
    }
    return created;
  }

  async updateHourlyRate(
    hourlyRateCents: number
  ): Promise<{ settings: AppSettingsRecord; updatedCatalogCount: number }> {
    const parsed = PricingSettingsInputSchema.parse({ hourly_rate_cents: hourlyRateCents });
    await this.getAppSettings();
    const now = Date.now();
    let updatedCatalogCount = 0;

    await this.executor.inTransaction(async (tx) => {
      const dynamicRows = await tx.query<{
        id: string;
        description: string;
        estimated_hours_thousandths: number;
        materials_cents: number;
      }>(
        `SELECT id, description, estimated_hours_thousandths, materials_cents
         FROM catalog_items
         WHERE pricing_mode = 'hourly_plus_materials'`
      );

      const updates: Array<{ id: string; unitPriceCents: number }> = [];
      for (const row of dynamicRows) {
        const nextPrice = computeCatalogUnitPriceCents({
          pricing_mode: "hourly_plus_materials",
          estimated_hours_thousandths: Number(row.estimated_hours_thousandths ?? 0),
          materials_cents: Number(row.materials_cents ?? 0),
          hourly_rate_cents: parsed.hourly_rate_cents,
          fixed_price_cents: 0,
        });
        if (!Number.isInteger(nextPrice) || nextPrice <= 0) {
          throw new Error(
            `SCHEMA_VALIDATION_ERROR: La partida '${row.description}' quedaría con importe <= 0`
          );
        }
        updates.push({ id: row.id, unitPriceCents: nextPrice });
      }

      await tx.run(
        `UPDATE app_settings SET hourly_rate_cents = ?, updated_at_ms = ? WHERE id = 1`,
        [parsed.hourly_rate_cents, now]
      );

      for (const item of updates) {
        await tx.run(
          `UPDATE catalog_items SET unit_price_cents = ?, updated_at_ms = ? WHERE id = ?`,
          [item.unitPriceCents, now, item.id]
        );
      }
      updatedCatalogCount = updates.length;
    });

    return {
      settings: await this.getAppSettings(),
      updatedCatalogCount,
    };
  }

  async updateTaxSettings(input: TaxSettingsInput): Promise<AppSettingsRecord> {
    const parsed = TaxSettingsInputSchema.parse(input);
    const now = Date.now();
    await this.getAppSettings();
    await this.executor.run(
      `UPDATE app_settings
       SET default_vat_rate = ?, irpf_reserve_rate = ?, updated_at_ms = ?
       WHERE id = 1`,
      [parsed.default_vat_rate, parsed.irpf_reserve_rate, now]
    );
    return this.getAppSettings();
  }

  async updateEmitterProfile(input: EmitterProfileInput): Promise<AppSettingsRecord> {
    const parsed = EmitterProfileInputSchema.parse(input);
    const now = Date.now();
    await this.getAppSettings();
    if (parsed.emitter_logo_data_url !== undefined) {
      await this.executor.run(
        `UPDATE app_settings
         SET emitter_name = ?, emitter_nif = ?, emitter_fiscal_address = ?, emitter_phone = ?,
             emitter_iban = ?, emitter_logo_data_url = ?, updated_at_ms = ?
         WHERE id = 1`,
        [
          parsed.emitter_name,
          parsed.emitter_nif,
          parsed.emitter_fiscal_address,
          parsed.emitter_phone,
          parsed.emitter_iban,
          parsed.emitter_logo_data_url,
          now,
        ]
      );
    } else {
      await this.executor.run(
        `UPDATE app_settings
         SET emitter_name = ?, emitter_nif = ?, emitter_fiscal_address = ?, emitter_phone = ?,
             emitter_iban = ?, updated_at_ms = ?
         WHERE id = 1`,
        [
          parsed.emitter_name,
          parsed.emitter_nif,
          parsed.emitter_fiscal_address,
          parsed.emitter_phone,
          parsed.emitter_iban,
          now,
        ]
      );
    }
    return this.getAppSettings();
  }

  async updateEmitterLogo(logoDataUrl: string | null): Promise<AppSettingsRecord> {
    const current = await this.getAppSettings();
    return this.updateEmitterProfile({
      emitter_name: current.emitter_name,
      emitter_nif: current.emitter_nif,
      emitter_fiscal_address: current.emitter_fiscal_address,
      emitter_phone: current.emitter_phone,
      emitter_iban: current.emitter_iban,
      emitter_logo_data_url: logoDataUrl,
    });
  }

  async setLastActiveThreadId(threadId: string | null): Promise<void> {
    await this.getAppSettings();
    await this.executor.run(
      `UPDATE app_settings SET last_active_thread_id = ?, updated_at_ms = ? WHERE id = 1`,
      [threadId, Date.now()]
    );
  }

  async setPendingCameraContext(ctx: PendingCameraContext | null): Promise<void> {
    await this.getAppSettings();
    await this.executor.run(
      `UPDATE app_settings SET pending_camera_context_json = ?, updated_at_ms = ? WHERE id = 1`,
      [ctx ? JSON.stringify(ctx) : null, Date.now()]
    );
  }

  async setLocalLlmConfig(
    enabled: boolean,
    modelUri: string | null
  ): Promise<AppSettingsRecord> {
    await this.getAppSettings();
    await this.executor.run(
      `UPDATE app_settings SET llm_enabled = ?, llm_model_uri = ?, updated_at_ms = ? WHERE id = 1`,
      [enabled ? 1 : 0, modelUri, Date.now()]
    );
    return this.getAppSettings();
  }

  async getAdminLlmConfig(): Promise<AdminLlmConfigRecord> {
    const readRow = async (): Promise<AdminLlmConfigRecord | null> => {
      const rows = await this.executor.query<{
        id: number;
        strategy_override: LlmStrategyOverride;
        android_270m_url: string;
        android_270m_companion_url: string;
        android_1b_url: string;
        android_1b_companion_url: string;
        custom_model_uri: string;
        max_tokens: number;
        temperature_thousandths: number;
        topk: number;
        updated_at_ms: number;
      }>(`SELECT * FROM admin_llm_config WHERE id = 1 LIMIT 1`);
      const r = rows[0];
      if (!r) return null;
      return {
        id: 1,
        strategy_override: r.strategy_override,
        android_270m_url: r.android_270m_url,
        android_270m_companion_url: r.android_270m_companion_url,
        android_1b_url: r.android_1b_url,
        android_1b_companion_url: r.android_1b_companion_url,
        custom_model_uri: r.custom_model_uri,
        max_tokens: Number(r.max_tokens),
        temperature_thousandths: Number(r.temperature_thousandths),
        topk: Number(r.topk),
        updated_at_ms: Number(r.updated_at_ms),
      };
    };

    const existing = await readRow();
    if (existing) return existing;

    const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
    const now = Date.now();
    await this.executor.run(
      `INSERT OR IGNORE INTO admin_llm_config (
        id, strategy_override, android_270m_url, android_270m_companion_url,
        android_1b_url, android_1b_companion_url, custom_model_uri,
        max_tokens, temperature_thousandths, topk, updated_at_ms
      ) VALUES (1, 'auto', ?, ?, ?, ?, '', 512, 100, 8, ?)`,
      [
        env.VITE_LLM_ANDROID_270M_URL ?? "",
        env.VITE_LLM_ANDROID_270M_COMPANION_URL ?? "",
        env.VITE_LLM_ANDROID_1B_URL ?? "",
        env.VITE_LLM_ANDROID_1B_COMPANION_URL ?? "",
        now,
      ]
    );
    const created = await readRow();
    if (!created) {
      throw new Error("SQLITE_QUERY_ERROR: no se pudo inicializar admin_llm_config");
    }
    return created;
  }

  async updateAdminLlmConfig(input: AdminLlmConfigInput): Promise<AdminLlmConfigRecord> {
    const parsed = AdminLlmConfigInputSchema.parse(input);
    const now = Date.now();
    await this.getAdminLlmConfig();
    await this.executor.run(
      `UPDATE admin_llm_config
       SET strategy_override = ?,
           android_270m_url = ?,
           android_270m_companion_url = ?,
           android_1b_url = ?,
           android_1b_companion_url = ?,
           custom_model_uri = ?,
           max_tokens = ?,
           temperature_thousandths = ?,
           topk = ?,
           updated_at_ms = ?
       WHERE id = 1`,
      [
        parsed.strategy_override,
        parsed.android_270m_url,
        parsed.android_270m_companion_url,
        parsed.android_1b_url,
        parsed.android_1b_companion_url,
        parsed.custom_model_uri,
        parsed.max_tokens,
        parsed.temperature_thousandths,
        parsed.topk,
        now,
      ]
    );
    return this.getAdminLlmConfig();
  }

  async listSequences(fiscalYear?: number): Promise<z.infer<typeof SequenceRowSchema>[]> {
    if (fiscalYear !== undefined) {
      return this.executor.query<z.infer<typeof SequenceRowSchema>>(
        `SELECT series_type, fiscal_year, last_seq, updated_at_ms
         FROM sequences WHERE fiscal_year = ? ORDER BY series_type ASC`,
        [fiscalYear]
      );
    }
    return this.executor.query<z.infer<typeof SequenceRowSchema>>(
      `SELECT series_type, fiscal_year, last_seq, updated_at_ms
       FROM sequences ORDER BY fiscal_year DESC, series_type ASC`
    );
  }

  async getMaxIssuedForSeries(seriesType: SeriesType, fiscalYear: number): Promise<number> {
    const prefix = `${seriesType}-${fiscalYear}-`;
    let maxVal = 0;
    if (seriesType === "OBR") {
      const rows = await this.executor.query<{ job_code: string }>(
        `SELECT job_code FROM jobs WHERE job_code LIKE ?`,
        [`${prefix}%`]
      );
      for (const r of rows) {
        maxVal = Math.max(maxVal, extractNumericSuffix(r.job_code, prefix));
      }
    } else if (seriesType === "PRE") {
      const rows = await this.executor.query<{ quote_code: string }>(
        `SELECT quote_code FROM quotes WHERE quote_code LIKE ?`,
        [`${prefix}%`]
      );
      for (const r of rows) {
        maxVal = Math.max(maxVal, extractNumericSuffix(r.quote_code, prefix));
      }
    } else {
      const rows = await this.executor.query<{ invoice_number: string }>(
        `SELECT invoice_number FROM invoices WHERE series_type = ? AND fiscal_year = ?`,
        [seriesType, fiscalYear]
      );
      for (const r of rows) {
        maxVal = Math.max(maxVal, extractNumericSuffix(r.invoice_number, prefix));
      }
    }
    return maxVal;
  }

  async configureSequences(
    fiscalYear: number,
    overrides: Partial<Record<SeriesType, number>>
  ): Promise<void> {
    if (!Number.isInteger(fiscalYear) || fiscalYear < 2020 || fiscalYear > 2100) {
      throw new Error("SCHEMA_VALIDATION_ERROR: Año fiscal fuera de rango 2020..2100");
    }
    const entries = Object.entries(overrides) as Array<[SeriesType, number | undefined]>;
    for (const [seriesType, val] of entries) {
      if (val === undefined) continue;
      if (!Number.isInteger(val) || val < 0) {
        throw new Error(`SCHEMA_VALIDATION_ERROR: Contador inválido para ${seriesType}`);
      }
      const maxIssued = await this.getMaxIssuedForSeries(seriesType, fiscalYear);
      if (val < maxIssued) {
        throw new Error(
          `INVALID_STATE_TRANSITION: El contador ${seriesType}-${fiscalYear} (${val}) no puede ser inferior al máximo emitido (${maxIssued})`
        );
      }
    }
    const now = Date.now();
    await this.executor.inTransaction(async (tx) => {
      for (const [seriesType, val] of entries) {
        if (val === undefined) continue;
        await tx.run(
          `INSERT INTO sequences (series_type, fiscal_year, last_seq, updated_at_ms)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(series_type, fiscal_year) DO UPDATE SET
             last_seq = excluded.last_seq,
             updated_at_ms = excluded.updated_at_ms`,
          [seriesType, fiscalYear, val, now]
        );
      }
    });
  }

  async listActiveRecoveredDrafts(): Promise<RecoveredDraft[]> {
    const rows = await this.executor.query<RawRecoveredDraftRow>(
      `SELECT * FROM recovered_drafts WHERE dismissed = 0 ORDER BY recovered_at_ms DESC`
    );
    return rows.map((row) => ({
      id: row.id,
      thread_id: row.thread_id,
      original_schema_version: row.original_schema_version,
      pending_gate: row.pending_gate,
      widget_json: JSON.parse(row.widget_json) as RecoveredDraft["widget_json"],
      active_job_id: row.active_job_id,
      active_quote_id: row.active_quote_id,
      dismissed: row.dismissed === 1,
      recovered_at_ms: row.recovered_at_ms,
    }));
  }

  async getRecoveredDraftById(draftId: string): Promise<RecoveredDraft | null> {
    const rows = await this.executor.query<RawRecoveredDraftRow>(
      `SELECT * FROM recovered_drafts WHERE id = ? LIMIT 1`,
      [draftId]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      thread_id: row.thread_id,
      original_schema_version: row.original_schema_version,
      pending_gate: row.pending_gate,
      widget_json: JSON.parse(row.widget_json) as RecoveredDraft["widget_json"],
      active_job_id: row.active_job_id,
      active_quote_id: row.active_quote_id,
      dismissed: row.dismissed === 1,
      recovered_at_ms: row.recovered_at_ms,
    };
  }

  async dismissRecoveredDraft(
    draftId: string,
    tx?: Pick<SqliteExecutor, "query" | "run">
  ): Promise<void> {
    const runner = tx ?? this.executor;
    await runner.run(`UPDATE recovered_drafts SET dismissed = 1 WHERE id = ?`, [draftId]);
  }
}
