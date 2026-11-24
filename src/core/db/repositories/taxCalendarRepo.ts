import { TaxModelCodeSchema, TaxObligationStatusSchema } from "../../contracts/schemas";
import type {
  SqliteExecutor,
  TaxAlertDismissalRow,
  TaxModelCode,
  TaxObligationStateRow,
  TaxObligationStatus,
} from "../../contracts/types";

export class TaxCalendarRepository {
  constructor(private readonly executor: SqliteExecutor) {}

  async listAllStates(): Promise<Map<string, TaxObligationStateRow>> {
    const rows = await this.executor.query<TaxObligationStateRow>(
      `SELECT * FROM tax_obligation_states`
    );
    return new Map(rows.map((r) => [r.obligation_key, r]));
  }

  async setObligationStatus(input: {
    obligation_key: string;
    model_code: TaxModelCode;
    fiscal_year: number;
    period_code: string;
    status: TaxObligationStatus;
    presented_at_iso?: string | null;
    notes?: string;
  }): Promise<TaxObligationStateRow> {
    const modelCode = TaxModelCodeSchema.parse(input.model_code);
    const status = TaxObligationStatusSchema.parse(input.status);
    const now = Date.now();
    const presentedAt =
      status === "presentado" ? input.presented_at_iso ?? null : null;

    await this.executor.run(
      `INSERT INTO tax_obligation_states (
        obligation_key, model_code, fiscal_year, period_code, status,
        presented_at_iso, notes, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(obligation_key) DO UPDATE SET
        status = excluded.status,
        presented_at_iso = excluded.presented_at_iso,
        notes = excluded.notes,
        updated_at_ms = excluded.updated_at_ms`,
      [
        input.obligation_key,
        modelCode,
        input.fiscal_year,
        input.period_code,
        status,
        presentedAt,
        input.notes ?? "",
        now,
      ]
    );

    const rows = await this.executor.query<TaxObligationStateRow>(
      `SELECT * FROM tax_obligation_states WHERE obligation_key = ? LIMIT 1`,
      [input.obligation_key]
    );
    if (!rows[0]) {
      throw new Error("SQLITE_QUERY_ERROR: Error guardando estado fiscal del modelo");
    }
    return rows[0];
  }

  async listDismissedAlertKeys(): Promise<Set<string>> {
    const rows = await this.executor.query<TaxAlertDismissalRow>(
      `SELECT alert_key, dismissed_at_ms FROM tax_alert_dismissals`
    );
    return new Set(rows.map((r) => r.alert_key));
  }

  async dismissAlert(alertKey: string): Promise<void> {
    await this.executor.run(
      `INSERT INTO tax_alert_dismissals (alert_key, dismissed_at_ms)
       VALUES (?, ?)
       ON CONFLICT(alert_key) DO UPDATE SET dismissed_at_ms = excluded.dismissed_at_ms`,
      [alertKey, Date.now()]
    );
  }

  async clearAllDismissals(): Promise<void> {
    await this.executor.run(`DELETE FROM tax_alert_dismissals`);
  }
}
