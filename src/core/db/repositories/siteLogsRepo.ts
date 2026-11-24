import { SiteLogInputSchema } from "../../contracts/schemas";
import { getFiscalYearFromIso, getLocalTodayIso } from "../../fiscal/dateQuarter";
import type { LocalFileBridge, SiteLogInput, SiteLogRecord, SqliteExecutor } from "../../contracts/types";
import { allocateNextSequence } from "./settingsRepo";

export class SiteLogsRepository {
  constructor(private readonly executor: SqliteExecutor) {}

  async listByJobId(jobId: string, limit = 50, offset = 0): Promise<SiteLogRecord[]> {
    return this.executor.query<SiteLogRecord & Record<string, unknown>>(
      `SELECT * FROM site_logs WHERE job_id = ? ORDER BY created_at_ms DESC LIMIT ? OFFSET ?`,
      [jobId, limit, offset]
    );
  }

  async listAll(limit = 100): Promise<SiteLogRecord[]> {
    return this.executor.query<SiteLogRecord & Record<string, unknown>>(
      `SELECT * FROM site_logs ORDER BY created_at_ms DESC LIMIT ?`,
      [limit]
    );
  }

  async insertWithOptionalNewJob(params: {
    input: SiteLogInput;
    committedPhotoUri: string | null;
    nowMs?: number;
    todayIso?: string;
  }): Promise<SiteLogRecord> {
    const validated = SiteLogInputSchema.parse(params.input);
    const now = params.nowMs ?? Date.now();
    const todayIso = params.todayIso ?? getLocalTodayIso();
    const fiscalYear = getFiscalYearFromIso(todayIso);
    const logId = `sl_${crypto.randomUUID().slice(0, 12)}`;

    await this.executor.inTransaction(async (tx) => {
      let targetJobId = validated.job_id;
      let stampJobCode = "";
      let stampClientName = "Sin cliente asignado";

      if (validated.new_job) {
        const { code } = await allocateNextSequence(tx, "OBR", fiscalYear, now);
        targetJobId = `job_${crypto.randomUUID().slice(0, 12)}`;
        stampJobCode = code;
        await tx.run(
          `INSERT INTO jobs (
            id, job_code, client_id, title, address, status,
            created_at_iso, created_at_ms, updated_at_ms
          ) VALUES (?, ?, NULL, ?, ?, 'pendiente', ?, ?, ?)`,
          [targetJobId, code, validated.new_job.title, validated.new_job.address ?? "", todayIso, now, now]
        );
      } else if (targetJobId) {
        const jobRows = await tx.query<{
          job_code: string;
          client_name: string | null;
        }>(
          `SELECT j.job_code, c.name AS client_name
           FROM jobs j
           LEFT JOIN clients c ON c.id = j.client_id
           WHERE j.id = ? LIMIT 1`,
          [targetJobId]
        );
        const jobRow = jobRows[0];
        if (!jobRow) {
          throw new Error("INVALID_STATE_TRANSITION: Obra seleccionada no encontrada");
        }
        stampJobCode = jobRow.job_code;
        stampClientName = jobRow.client_name?.trim() || "Sin cliente asignado";
      }

      await tx.run(
        `INSERT INTO site_logs (
          id, job_id, category, note_text, photo_uri,
          stamp_job_code, stamp_client_name, created_at_iso, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          logId,
          targetJobId,
          validated.category,
          validated.note_text.trim(),
          params.committedPhotoUri,
          stampJobCode,
          stampClientName,
          todayIso,
          now,
        ]
      );
    });

    const rows = await this.executor.query<SiteLogRecord & Record<string, unknown>>(
      `SELECT * FROM site_logs WHERE id = ? LIMIT 1`,
      [logId]
    );
    const created = rows[0];
    if (!created) throw new Error("SQLITE_QUERY_ERROR: error guardando diario de obra");
    return created;
  }

  async getById(id: string): Promise<SiteLogRecord | null> {
    const rows = await this.executor.query<SiteLogRecord & Record<string, unknown>>(
      `SELECT * FROM site_logs WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows[0] ?? null;
  }

  async delete(id: string, fileBridge: LocalFileBridge): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) return;
    await this.executor.run(`DELETE FROM site_logs WHERE id = ?`, [id]);
    await fileBridge.deleteCommittedMedia(existing.photo_uri);
  }
}
