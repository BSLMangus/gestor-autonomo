import { BillingModeSchema, IsoDateSchema, LaborOnlySubModeSchema } from "../../contracts/schemas";
import { getFiscalYearFromIso, getLocalTodayIso } from "../../fiscal/dateQuarter";
import type {
  BillingMode,
  BillingModeConfig,
  JobRow,
  JobStatus,
  LaborOnlySubMode,
  SqliteExecutor,
} from "../../contracts/types";
import { sanitizeFts5Query } from "../sqliteExecutor";
import { allocateNextSequence } from "./settingsRepo";

const VALID_JOB_TRANSITIONS: Record<JobStatus, ReadonlyArray<JobStatus>> = {
  pendiente: ["en_curso", "cancelado"],
  en_curso: ["finalizado", "cancelado"],
  finalizado: [],
  cancelado: [],
};

export class JobsRepository {
  constructor(private readonly executor: SqliteExecutor) {}

  async listPaginated(opts?: {
    search?: string;
    status?: JobStatus;
    limit?: number;
    offset?: number;
  }): Promise<{ items: JobRow[]; totalCount: number }> {
    const limit = Math.max(1, Math.min(100, opts?.limit ?? 25));
    const offset = Math.max(0, opts?.offset ?? 0);
    const fts = opts?.search ? sanitizeFts5Query(opts.search) : "";
    const statusParams: unknown[] = [];
    const statusClause = opts?.status ? "AND j.status = ?" : "";
    if (opts?.status) statusParams.push(opts.status);

    if (fts.length > 0) {
      const countRows = await this.executor.query<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt
         FROM jobs j
         JOIN jobs_fts f ON j.rowid = f.rowid
         WHERE jobs_fts MATCH ? ${statusClause}`,
        [fts, ...statusParams]
      );
      const items = await this.executor.query<JobRow>(
        `SELECT j.*, bm25(jobs_fts) AS rank_score
         FROM jobs j
         JOIN jobs_fts f ON j.rowid = f.rowid
         WHERE jobs_fts MATCH ? ${statusClause}
         ORDER BY rank_score ASC, j.updated_at_ms DESC
         LIMIT ? OFFSET ?`,
        [fts, ...statusParams, limit, offset]
      );
      return { items, totalCount: countRows[0]?.cnt ?? 0 };
    }

    const plainStatusClause = opts?.status ? "WHERE status = ?" : "";
    const countRows = await this.executor.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM jobs ${plainStatusClause}`,
      statusParams
    );
    const items = await this.executor.query<JobRow>(
      `SELECT * FROM jobs ${plainStatusClause} ORDER BY updated_at_ms DESC LIMIT ? OFFSET ?`,
      [...statusParams, limit, offset]
    );
    return { items, totalCount: countRows[0]?.cnt ?? 0 };
  }

  async searchFts5WithScore(
    search: string,
    limit = 5
  ): Promise<Array<JobRow & { bm25_score: number }>> {
    const fts = sanitizeFts5Query(search);
    if (!fts) return [];
    return this.executor.query<JobRow & { bm25_score: number }>(
      `SELECT j.*, bm25(jobs_fts) AS bm25_score
       FROM jobs j
       JOIN jobs_fts f ON j.rowid = f.rowid
       WHERE jobs_fts MATCH ?
       ORDER BY bm25_score ASC
       LIMIT ?`,
      [fts, limit]
    );
  }

  async listAll(): Promise<JobRow[]> {
    return this.executor.query<JobRow>(`SELECT * FROM jobs ORDER BY updated_at_ms DESC`);
  }

  async getById(id: string): Promise<JobRow | null> {
    const rows = await this.executor.query<JobRow>(
      `SELECT * FROM jobs WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows[0] ?? null;
  }

  async createDirectJob(input: {
    title: string;
    address?: string;
    client_id?: string | null;
    start_date_iso?: string | null;
    end_date_iso?: string | null;
    modalidad_cobro?: BillingMode;
    solo_mano_obra_submodo?: LaborOnlySubMode;
    horas_estimadas_thousandths?: number;
    tarifa_hora_cents?: number | null;
    mano_obra_fija_cents?: number;
  }): Promise<JobRow> {
    const title = input.title.trim();
    if (!title) {
      throw new Error("SCHEMA_VALIDATION_ERROR: El título de obra es obligatorio");
    }
    const startDateIso = input.start_date_iso ? IsoDateSchema.parse(input.start_date_iso) : null;
    const endDateIso = input.end_date_iso ? IsoDateSchema.parse(input.end_date_iso) : null;
    if (startDateIso && endDateIso && endDateIso < startDateIso) {
      throw new Error("SCHEMA_VALIDATION_ERROR: La fecha de fin no puede ser anterior al inicio");
    }
    const modalidadCobro = BillingModeSchema.parse(input.modalidad_cobro ?? "solo_partidas");
    const submodo = LaborOnlySubModeSchema.parse(input.solo_mano_obra_submodo ?? "por_horas");
    const horasThousandths = Math.max(0, Math.round(input.horas_estimadas_thousandths ?? 0));
    const tarifaHoraCents =
      input.tarifa_hora_cents === undefined || input.tarifa_hora_cents === null
        ? null
        : Math.max(0, Math.round(input.tarifa_hora_cents));
    const manoObraFijaCents = Math.max(0, Math.round(input.mano_obra_fija_cents ?? 0));
    const todayIso = getLocalTodayIso();
    const fiscalYear = getFiscalYearFromIso(todayIso);
    const now = Date.now();
    const id = `job_${crypto.randomUUID().slice(0, 12)}`;

    await this.executor.inTransaction(async (tx) => {
      const { code } = await allocateNextSequence(tx, "OBR", fiscalYear, now);
      await tx.run(
        `INSERT INTO jobs (
          id, job_code, client_id, title, address, status, start_date_iso, end_date_iso,
          modalidad_cobro, solo_mano_obra_submodo, horas_estimadas_thousandths,
          tarifa_hora_cents, mano_obra_fija_cents,
          created_at_iso, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, 'pendiente', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          code,
          input.client_id ?? null,
          title,
          (input.address ?? "").trim(),
          startDateIso,
          endDateIso,
          modalidadCobro,
          submodo,
          horasThousandths,
          tarifaHoraCents,
          manoObraFijaCents,
          todayIso,
          now,
          now,
        ]
      );
    });

    const created = await this.getById(id);
    if (!created) throw new Error("SQLITE_QUERY_ERROR: error creando obra directa");
    return created;
  }

  async updateBillingConfig(
    jobId: string,
    config: Partial<BillingModeConfig>
  ): Promise<JobRow> {
    const existing = await this.getById(jobId);
    if (!existing) {
      throw new Error("INVALID_STATE_TRANSITION: Obra no encontrada");
    }

    const modalidadCobro = BillingModeSchema.parse(
      config.modalidad_cobro ?? existing.modalidad_cobro ?? "solo_partidas"
    );
    const submodo = LaborOnlySubModeSchema.parse(
      config.solo_mano_obra_submodo ?? existing.solo_mano_obra_submodo ?? "por_horas"
    );
    const horasThousandths = Math.max(
      0,
      Math.round(
        config.horas_estimadas_thousandths ?? existing.horas_estimadas_thousandths ?? 0
      )
    );
    const tarifaHoraCents =
      config.tarifa_hora_cents === undefined
        ? (existing.tarifa_hora_cents ?? null)
        : config.tarifa_hora_cents === null
          ? null
          : Math.max(0, Math.round(config.tarifa_hora_cents));
    const manoObraFijaCents = Math.max(
      0,
      Math.round(config.mano_obra_fija_cents ?? existing.mano_obra_fija_cents ?? 0)
    );

    await this.executor.run(
      `UPDATE jobs
       SET modalidad_cobro = ?,
           solo_mano_obra_submodo = ?,
           horas_estimadas_thousandths = ?,
           tarifa_hora_cents = ?,
           mano_obra_fija_cents = ?,
           updated_at_ms = ?
       WHERE id = ?`,
      [
        modalidadCobro,
        submodo,
        horasThousandths,
        tarifaHoraCents,
        manoObraFijaCents,
        Date.now(),
        jobId,
      ]
    );

    const updated = await this.getById(jobId);
    if (!updated) throw new Error("SQLITE_QUERY_ERROR: error actualizando modalidad de obra");
    return updated;
  }

  async updateJobScheduleDates(
    jobId: string,
    startDateIso: string | null,
    endDateIso: string | null
  ): Promise<JobRow> {
    const start = startDateIso ? IsoDateSchema.parse(startDateIso) : null;
    const end = endDateIso ? IsoDateSchema.parse(endDateIso) : null;
    if (start && end && end < start) {
      throw new Error("SCHEMA_VALIDATION_ERROR: La fecha de fin no puede ser anterior al inicio");
    }
    const existing = await this.getById(jobId);
    if (!existing) {
      throw new Error("INVALID_STATE_TRANSITION: Obra no encontrada");
    }
    await this.executor.run(
      `UPDATE jobs SET start_date_iso = ?, end_date_iso = ?, updated_at_ms = ? WHERE id = ?`,
      [start, end, Date.now(), jobId]
    );
    const updated = await this.getById(jobId);
    if (!updated) throw new Error("SQLITE_QUERY_ERROR: error actualizando fechas de obra");
    return updated;
  }

  async transitionStatus(jobId: string, nextStatus: JobStatus): Promise<JobRow> {
    const existing = await this.getById(jobId);
    if (!existing) {
      throw new Error("INVALID_STATE_TRANSITION: Obra no encontrada");
    }
    const allowed = VALID_JOB_TRANSITIONS[existing.status];
    if (!allowed.includes(nextStatus)) {
      throw new Error(
        `INVALID_STATE_TRANSITION: Transición inválida ${existing.status} -> ${nextStatus}`
      );
    }

    const now = Date.now();
    await this.executor.inTransaction(async (tx) => {
      if (nextStatus === "cancelado") {
        const invRows = await tx.query<{ cnt: number }>(
          `SELECT COUNT(*) AS cnt FROM invoices WHERE job_id = ?`,
          [jobId]
        );
        if ((invRows[0]?.cnt ?? 0) > 0) {
          throw new Error(
            "INVALID_STATE_TRANSITION: Prohibido cancelar obra que ya tiene facturas emitidas"
          );
        }
        await tx.run(
          `UPDATE quotes SET status = 'rechazado', updated_at_ms = ?
           WHERE job_id = ? AND status != 'rechazado'`,
          [now, jobId]
        );
      }
      await tx.run(`UPDATE jobs SET status = ?, updated_at_ms = ? WHERE id = ?`, [
        nextStatus,
        now,
        jobId,
      ]);
    });

    const updated = await this.getById(jobId);
    if (!updated) throw new Error("SQLITE_QUERY_ERROR: error actualizando estado de obra");
    return updated;
  }
}
