import { Gate2TicketCommitPayloadSchema } from "../../contracts/schemas";
import { deriveFiscalQuarter } from "../../fiscal/dateQuarter";
import { deriveRateOrMixed } from "../../fiscal/fiscalEngine";
import type {
  ExpenseTicketRow,
  LocalFileBridge,
  SqliteExecutor,
  TicketVatRate,
} from "../../contracts/types";

export class TicketsRepository {
  constructor(private readonly executor: SqliteExecutor) {}

  async listByQuarterOrJob(opts?: {
    quarter?: string;
    jobId?: string | null;
    limit?: number;
    offset?: number;
  }): Promise<{ items: ExpenseTicketRow[]; totalCount: number }> {
    const limit = Math.max(1, Math.min(100, opts?.limit ?? 25));
    const offset = Math.max(0, opts?.offset ?? 0);
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (opts?.quarter) {
      clauses.push("quarter = ?");
      params.push(opts.quarter);
    }
    if (opts?.jobId === null) {
      clauses.push("job_id IS NULL");
    } else if (opts?.jobId !== undefined) {
      clauses.push("job_id = ?");
      params.push(opts.jobId);
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const countRows = await this.executor.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM expense_tickets ${whereClause}`,
      params
    );
    const items = await this.executor.query<ExpenseTicketRow>(
      `SELECT * FROM expense_tickets ${whereClause}
       ORDER BY issue_date_iso DESC, created_at_ms DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return { items, totalCount: countRows[0]?.cnt ?? 0 };
  }

  async listAll(): Promise<ExpenseTicketRow[]> {
    return this.executor.query<ExpenseTicketRow>(
      `SELECT * FROM expense_tickets ORDER BY issue_date_iso DESC, created_at_ms DESC`
    );
  }

  async getById(id: string): Promise<ExpenseTicketRow | null> {
    const rows = await this.executor.query<ExpenseTicketRow>(
      `SELECT * FROM expense_tickets WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows[0] ?? null;
  }

  async checkDuplicate(params: {
    issueDateIso: string;
    totalCents: number;
    supplierNif: string;
    excludeTicketId?: string;
  }): Promise<ExpenseTicketRow[]> {
    const cleanNif = params.supplierNif.trim().toUpperCase();
    const excludeClause = params.excludeTicketId ? "AND id != ?" : "";
    const excludeArgs = params.excludeTicketId ? [params.excludeTicketId] : [];

    if (cleanNif.length > 0) {
      return this.executor.query<ExpenseTicketRow>(
        `SELECT * FROM expense_tickets
         WHERE UPPER(TRIM(supplier_nif)) = ?
           AND issue_date_iso = ?
           AND total_cents = ?
           ${excludeClause}
         ORDER BY created_at_ms DESC`,
        [cleanNif, params.issueDateIso, params.totalCents, ...excludeArgs]
      );
    }

    return this.executor.query<ExpenseTicketRow>(
      `SELECT * FROM expense_tickets
       WHERE issue_date_iso = ?
         AND total_cents = ?
         ${excludeClause}
       ORDER BY created_at_ms DESC`,
      [params.issueDateIso, params.totalCents, ...excludeArgs]
    );
  }

  async updateWithin2Cents(
    id: string,
    patch: {
      supplier_name?: string;
      supplier_nif?: string;
      issue_date_iso?: string;
      base_cents?: number;
      vat_cents?: number;
      total_cents?: number;
      vat_rate?: TicketVatRate;
      job_id?: string | null;
      category?: string;
    }
  ): Promise<ExpenseTicketRow> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new Error("INVALID_STATE_TRANSITION: Ticket no encontrado");
    }

    const issueDateIso = patch.issue_date_iso ?? existing.issue_date_iso;
    const quarter = deriveFiscalQuarter(issueDateIso);
    const baseCents = patch.base_cents ?? existing.base_cents;
    const vatCents = patch.vat_cents ?? existing.vat_cents;
    const totalCents = patch.total_cents ?? existing.total_cents;

    const validated = Gate2TicketCommitPayloadSchema.parse({
      supplier_name: patch.supplier_name ?? existing.supplier_name,
      supplier_nif: patch.supplier_nif ?? existing.supplier_nif,
      issue_date_iso: issueDateIso,
      quarter,
      base_cents: baseCents,
      vat_rate: patch.vat_rate,
      vat_cents: vatCents,
      total_cents: totalCents,
      ocr_confidence: existing.ocr_confidence,
      job_id: patch.job_id !== undefined ? patch.job_id : existing.job_id,
      category: patch.category ?? existing.category,
      media_uri: existing.image_uri,
    });

    const vatRateLabel = String(
      patch.vat_rate ?? deriveRateOrMixed(validated.base_cents, validated.vat_cents)
    );

    await this.executor.run(
      `UPDATE expense_tickets
       SET supplier_name = ?, supplier_nif = ?, issue_date_iso = ?, quarter = ?,
           category = ?, vat_rate_label = ?, base_cents = ?, vat_cents = ?,
           total_cents = ?, job_id = ?, updated_at_ms = ?
       WHERE id = ?`,
      [
        validated.supplier_name,
        validated.supplier_nif,
        validated.issue_date_iso,
        validated.quarter,
        validated.category,
        vatRateLabel,
        validated.base_cents,
        validated.vat_cents,
        validated.total_cents,
        validated.job_id,
        Date.now(),
        id,
      ]
    );

    const updated = await this.getById(id);
    if (!updated) throw new Error("SQLITE_QUERY_ERROR: error actualizando ticket");
    return updated;
  }

  async delete(id: string, fileBridge: LocalFileBridge): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) return;
    await this.executor.run(`DELETE FROM expense_tickets WHERE id = ?`, [id]);
    await fileBridge.deleteCommittedMedia(existing.image_uri);
  }
}
