import {
  DailyWorkLogInputSchema,
  IsoDateSchema,
  ScheduleEntryRowSchema,
  TimeHHMMSchema,
  WorkScheduleDefaultsSchema,
} from "../../contracts/schemas";
import type {
  DailyWorkLogInput,
  JobScheduleDeviationSummary,
  ScheduleEntryRow,
  SqliteExecutor,
  WorkScheduleDefaults,
} from "../../contracts/types";
import { addDaysIso, getLocalTodayIso, isValidIsoDate } from "../../fiscal/dateQuarter";

interface RawWorkScheduleDefaultsRow extends Record<string, unknown> {
  id: number;
  work_days_json: string;
  morning_start: string;
  morning_end: string;
  afternoon_start: string;
  afternoon_end: string;
  auto_apply_to_jobs: number;
  updated_at_ms: number;
}

interface RawScheduleEntryRow extends Record<string, unknown> {
  id: string;
  job_id: string | null;
  date_iso: string;
  planned_start: string;
  planned_end: string;
  planned_hours_thousandths: number;
  actual_start: string | null;
  actual_end: string | null;
  actual_hours_thousandths: number | null;
  status: string;
  deviation_reason: string;
  notes: string;
  created_at_ms: number;
  updated_at_ms: number;
}

export function parseHHMMToMinutes(hhmm: string): number {
  const [hStr, mStr] = hhmm.split(":");
  const h = Number(hStr ?? 0);
  const m = Number(mStr ?? 0);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

export function minutesToHHMM(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(totalMinutes)));
  const hh = String(Math.floor(clamped / 60)).padStart(2, "0");
  const mm = String(clamped % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function computeDailyWorkHoursBreakdown(defaults: Pick<
  WorkScheduleDefaults,
  "morning_start" | "morning_end" | "afternoon_start" | "afternoon_end"
>): {
  morningThousandths: number;
  afternoonThousandths: number;
  totalThousandths: number;
} {
  const morningMin = Math.max(
    0,
    parseHHMMToMinutes(defaults.morning_end) - parseHHMMToMinutes(defaults.morning_start)
  );
  const afternoonMin = Math.max(
    0,
    parseHHMMToMinutes(defaults.afternoon_end) - parseHHMMToMinutes(defaults.afternoon_start)
  );
  const morningThousandths = Math.round((morningMin * 1000) / 60);
  const afternoonThousandths = Math.round((afternoonMin * 1000) / 60);
  return {
    morningThousandths,
    afternoonThousandths,
    totalThousandths: morningThousandths + afternoonThousandths,
  };
}

export function computeDailyWorkHoursThousandths(
  defaults: Pick<
    WorkScheduleDefaults,
    "morning_start" | "morning_end" | "afternoon_start" | "afternoon_end"
  >
): number {
  return computeDailyWorkHoursBreakdown(defaults).totalThousandths;
}

/**
 * Devuelve el día de la semana ISO (1 = Lunes .. 7 = Domingo) sin depender de zona horaria local.
 */
export function getIsoWeekday(dateIso: string): number {
  if (!isValidIsoDate(dateIso)) {
    throw new Error(`SCHEMA_VALIDATION_ERROR: Fecha ISO inválida '${dateIso}'`);
  }
  const [y, m, d] = dateIso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  const jsDay = dt.getUTCDay(); // 0=Dom .. 6=Sab
  return jsDay === 0 ? 7 : jsDay;
}

function mapDefaultsRow(row: RawWorkScheduleDefaultsRow): WorkScheduleDefaults {
  let parsedDays: number[] = [1, 2, 3, 4, 5];
  try {
    const raw = JSON.parse(row.work_days_json);
    if (Array.isArray(raw)) {
      parsedDays = raw
        .map((n) => Number(n))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
    }
  } catch {
    parsedDays = [1, 2, 3, 4, 5];
  }
  return WorkScheduleDefaultsSchema.parse({
    work_days: parsedDays,
    morning_start: row.morning_start,
    morning_end: row.morning_end,
    afternoon_start: row.afternoon_start,
    afternoon_end: row.afternoon_end,
    auto_apply_to_jobs: Number(row.auto_apply_to_jobs) === 1,
    updated_at_ms: Number(row.updated_at_ms),
  });
}

function mapEntryRow(row: RawScheduleEntryRow): ScheduleEntryRow {
  return ScheduleEntryRowSchema.parse({
    id: row.id,
    job_id: row.job_id ?? null,
    date_iso: row.date_iso,
    planned_start: row.planned_start,
    planned_end: row.planned_end,
    planned_hours_thousandths: Number(row.planned_hours_thousandths),
    actual_start: row.actual_start ?? null,
    actual_end: row.actual_end ?? null,
    actual_hours_thousandths:
      row.actual_hours_thousandths === null || row.actual_hours_thousandths === undefined
        ? null
        : Number(row.actual_hours_thousandths),
    status: row.status,
    deviation_reason: row.deviation_reason ?? "",
    notes: row.notes ?? "",
    created_at_ms: Number(row.created_at_ms),
    updated_at_ms: Number(row.updated_at_ms),
  });
}

export class ScheduleRepository {
  constructor(private readonly executor: SqliteExecutor) {}

  async getWorkScheduleDefaults(): Promise<WorkScheduleDefaults> {
    const rows = await this.executor.query<RawWorkScheduleDefaultsRow>(
      `SELECT * FROM work_schedule_defaults WHERE id = 1 LIMIT 1`
    );
    if (rows[0]) {
      return mapDefaultsRow(rows[0]);
    }

    const now = Date.now();
    await this.executor.run(
      `INSERT OR IGNORE INTO work_schedule_defaults (
        id, work_days_json, morning_start, morning_end, afternoon_start, afternoon_end,
        auto_apply_to_jobs, updated_at_ms
      ) VALUES (1, '[1,2,3,4,5]', '08:00', '14:00', '15:00', '17:00', 1, ?)`,
      [now]
    );
    const createdRows = await this.executor.query<RawWorkScheduleDefaultsRow>(
      `SELECT * FROM work_schedule_defaults WHERE id = 1 LIMIT 1`
    );
    if (!createdRows[0]) {
      throw new Error("SQLITE_QUERY_ERROR: No se pudo inicializar work_schedule_defaults");
    }
    return mapDefaultsRow(createdRows[0]);
  }

  async updateWorkScheduleDefaults(
    input: Omit<WorkScheduleDefaults, "updated_at_ms"> | WorkScheduleDefaults
  ): Promise<WorkScheduleDefaults> {
    const parsed = WorkScheduleDefaultsSchema.parse(input);
    const uniqueDays = Array.from(new Set(parsed.work_days)).sort((a, b) => a - b);
    const now = Date.now();
    await this.getWorkScheduleDefaults();
    await this.executor.run(
      `UPDATE work_schedule_defaults
       SET work_days_json = ?,
           morning_start = ?,
           morning_end = ?,
           afternoon_start = ?,
           afternoon_end = ?,
           auto_apply_to_jobs = ?,
           updated_at_ms = ?
       WHERE id = 1`,
      [
        JSON.stringify(uniqueDays),
        parsed.morning_start,
        parsed.morning_end,
        parsed.afternoon_start,
        parsed.afternoon_end,
        parsed.auto_apply_to_jobs ? 1 : 0,
        now,
      ]
    );
    return this.getWorkScheduleDefaults();
  }

  async listAllEntries(): Promise<ScheduleEntryRow[]> {
    const rows = await this.executor.query<RawScheduleEntryRow>(
      `SELECT * FROM schedule_entries ORDER BY date_iso ASC, planned_start ASC`
    );
    return rows.map(mapEntryRow);
  }

  async listEntriesByDateRange(startIso: string, endIso: string): Promise<ScheduleEntryRow[]> {
    IsoDateSchema.parse(startIso);
    IsoDateSchema.parse(endIso);
    const rows = await this.executor.query<RawScheduleEntryRow>(
      `SELECT * FROM schedule_entries
       WHERE date_iso >= ? AND date_iso <= ?
       ORDER BY date_iso ASC, planned_start ASC`,
      [startIso, endIso]
    );
    return rows.map(mapEntryRow);
  }

  async listEntriesByJob(jobId: string): Promise<ScheduleEntryRow[]> {
    const rows = await this.executor.query<RawScheduleEntryRow>(
      `SELECT * FROM schedule_entries WHERE job_id = ? ORDER BY date_iso ASC, planned_start ASC`,
      [jobId]
    );
    return rows.map(mapEntryRow);
  }

  async getEntryById(entryId: string): Promise<ScheduleEntryRow | null> {
    const rows = await this.executor.query<RawScheduleEntryRow>(
      `SELECT * FROM schedule_entries WHERE id = ? LIMIT 1`,
      [entryId]
    );
    return rows[0] ? mapEntryRow(rows[0]) : null;
  }

  async getEntryByJobAndDate(jobId: string, dateIso: string): Promise<ScheduleEntryRow | null> {
    const rows = await this.executor.query<RawScheduleEntryRow>(
      `SELECT * FROM schedule_entries WHERE job_id = ? AND date_iso = ? LIMIT 1`,
      [jobId, dateIso]
    );
    return rows[0] ? mapEntryRow(rows[0]) : null;
  }

  async createSingleEntry(input: {
    job_id: string | null;
    date_iso: string;
    planned_start: string;
    planned_end: string;
    planned_hours_thousandths?: number;
    notes?: string;
  }): Promise<ScheduleEntryRow> {
    const dateIso = IsoDateSchema.parse(input.date_iso);
    const plannedStart = TimeHHMMSchema.parse(input.planned_start);
    const plannedEnd = TimeHHMMSchema.parse(input.planned_end);
    const diffMin = parseHHMMToMinutes(plannedEnd) - parseHHMMToMinutes(plannedStart);
    if (diffMin <= 0) {
      throw new Error(
        "SCHEMA_VALIDATION_ERROR: La hora de fin debe ser posterior a la hora de inicio"
      );
    }
    const plannedThousandths =
      input.planned_hours_thousandths !== undefined
        ? Math.max(1, Math.round(input.planned_hours_thousandths))
        : Math.round((diffMin * 1000) / 60);
    const now = Date.now();
    const id = `sch_${crypto.randomUUID().slice(0, 12)}`;

    await this.executor.inTransaction(async (tx) => {
      await tx.run(
        `INSERT INTO schedule_entries (
          id, job_id, date_iso, planned_start, planned_end, planned_hours_thousandths,
          actual_start, actual_end, actual_hours_thousandths, status, deviation_reason,
          notes, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'previsto', '', ?, ?, ?)`,
        [
          id,
          input.job_id,
          dateIso,
          plannedStart,
          plannedEnd,
          plannedThousandths,
          (input.notes ?? "").trim(),
          now,
          now,
        ]
      );

      if (input.job_id) {
        const jobRows = await tx.query<{
          start_date_iso: string | null;
          end_date_iso: string | null;
        }>(`SELECT start_date_iso, end_date_iso FROM jobs WHERE id = ? LIMIT 1`, [input.job_id]);
        const jobRow = jobRows[0];
        if (jobRow) {
          const nextStart =
            !jobRow.start_date_iso || dateIso < jobRow.start_date_iso
              ? dateIso
              : jobRow.start_date_iso;
          const nextEnd =
            !jobRow.end_date_iso || dateIso > jobRow.end_date_iso ? dateIso : jobRow.end_date_iso;
          if (nextStart !== jobRow.start_date_iso || nextEnd !== jobRow.end_date_iso) {
            await tx.run(
              `UPDATE jobs SET start_date_iso = ?, end_date_iso = ?, updated_at_ms = ? WHERE id = ?`,
              [nextStart, nextEnd, now, input.job_id]
            );
          }
        }
      }
    });

    const created = await this.getEntryById(id);
    if (!created) {
      throw new Error("SQLITE_QUERY_ERROR: Error creando cita en agenda");
    }
    return created;
  }

  async deleteEntry(entryId: string): Promise<void> {
    await this.executor.run(`DELETE FROM schedule_entries WHERE id = ?`, [entryId]);
  }

  async generateEntriesForJobDateRange(
    jobId: string,
    startDateIso: string,
    endDateIso: string,
    opts?: {
      forceIncludeAllDays?: boolean;
      plannedStart?: string;
      plannedEnd?: string;
      plannedHoursThousandths?: number;
      replaceSingleDayHours?: boolean;
    }
  ): Promise<ScheduleEntryRow[]> {
    const start = IsoDateSchema.parse(startDateIso);
    const end = IsoDateSchema.parse(endDateIso);
    if (end < start) {
      throw new Error("SCHEMA_VALIDATION_ERROR: La fecha fin no puede ser anterior a la fecha inicio");
    }

    const defaults = await this.getWorkScheduleDefaults();
    const workDaySet = new Set(
      defaults.work_days.length > 0 ? defaults.work_days : [1, 2, 3, 4, 5]
    );
    const defaultStart = defaults.morning_start;
    const defaultEnd = defaults.afternoon_end || defaults.morning_end;
    const plannedStart = opts?.plannedStart
      ? TimeHHMMSchema.parse(opts.plannedStart)
      : defaultStart;
    const plannedEnd = opts?.plannedEnd
      ? TimeHHMMSchema.parse(opts.plannedEnd)
      : defaultEnd;
    const spanMinutes = parseHHMMToMinutes(plannedEnd) - parseHHMMToMinutes(plannedStart);
    if (spanMinutes <= 0) {
      throw new Error(
        "SCHEMA_VALIDATION_ERROR: La hora de fin debe ser posterior a la hora de inicio"
      );
    }
    const plannedThousandths =
      opts?.plannedHoursThousandths !== undefined
        ? Math.max(1, Math.round(opts.plannedHoursThousandths))
        : plannedStart === defaultStart && plannedEnd === defaultEnd
          ? computeDailyWorkHoursThousandths(defaults)
          : Math.round((spanMinutes * 1000) / 60);

    const isSameDay = start === end;
    const targetDates: string[] = [];
    let cursor = start;
    let safety = 0;
    while (cursor <= end && safety < 366) {
      const weekday = getIsoWeekday(cursor);
      if (opts?.forceIncludeAllDays || isSameDay || workDaySet.has(weekday)) {
        targetDates.push(cursor);
      }
      cursor = addDaysIso(cursor, 1);
      safety += 1;
    }

    const now = Date.now();
    await this.executor.inTransaction(async (tx) => {
      await tx.run(
        `UPDATE jobs SET start_date_iso = ?, end_date_iso = ?, updated_at_ms = ? WHERE id = ?`,
        [start, end, now, jobId]
      );

      for (const dateIso of targetDates) {
        const existing = await tx.query<{ id: string }>(
          `SELECT id FROM schedule_entries WHERE job_id = ? AND date_iso = ? LIMIT 1`,
          [jobId, dateIso]
        );
        if (existing.length > 0) {
          if (opts?.replaceSingleDayHours && isSameDay) {
            await tx.run(
              `UPDATE schedule_entries
               SET planned_start = ?, planned_end = ?, planned_hours_thousandths = ?, updated_at_ms = ?
               WHERE id = ?`,
              [plannedStart, plannedEnd, plannedThousandths, now, existing[0]!.id]
            );
          }
          continue;
        }

        const id = `sch_${crypto.randomUUID().slice(0, 12)}`;
        await tx.run(
          `INSERT INTO schedule_entries (
            id, job_id, date_iso, planned_start, planned_end, planned_hours_thousandths,
            actual_start, actual_end, actual_hours_thousandths, status, deviation_reason,
            notes, created_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'previsto', '', '', ?, ?)`,
          [id, jobId, dateIso, plannedStart, plannedEnd, plannedThousandths, now, now]
        );
      }
    });

    return this.listEntriesByJob(jobId);
  }

  async recordDailyWorkLog(
    entryIdOrDate: string,
    input: DailyWorkLogInput,
    opts?: { jobId?: string | null }
  ): Promise<ScheduleEntryRow> {
    const parsed = DailyWorkLogInputSchema.parse(input);
    const defaults = await this.getWorkScheduleDefaults();
    const now = Date.now();
    let updatedEntryId = "";

    await this.executor.inTransaction(async (tx) => {
      let existingRow: RawScheduleEntryRow | undefined;

      if (isValidIsoDate(entryIdOrDate)) {
        if (opts?.jobId) {
          const byJobDate = await tx.query<RawScheduleEntryRow>(
            `SELECT * FROM schedule_entries WHERE job_id = ? AND date_iso = ? LIMIT 1`,
            [opts.jobId, entryIdOrDate]
          );
          existingRow = byJobDate[0];
        } else {
          const byDate = await tx.query<RawScheduleEntryRow>(
            `SELECT * FROM schedule_entries WHERE date_iso = ? ORDER BY created_at_ms ASC LIMIT 1`,
            [entryIdOrDate]
          );
          existingRow = byDate[0];
        }
      } else {
        const byId = await tx.query<RawScheduleEntryRow>(
          `SELECT * FROM schedule_entries WHERE id = ? LIMIT 1`,
          [entryIdOrDate]
        );
        existingRow = byId[0];
      }

      if (!existingRow) {
        if (!isValidIsoDate(entryIdOrDate)) {
          throw new Error("INVALID_STATE_TRANSITION: Parte de agenda no encontrado");
        }
        const newId = `sch_${crypto.randomUUID().slice(0, 12)}`;
        const plannedStart = parsed.actual_start ?? defaults.morning_start;
        const plannedEnd = defaults.afternoon_end || defaults.morning_end;
        const plannedThousandths = computeDailyWorkHoursThousandths(defaults);

        await tx.run(
          `INSERT INTO schedule_entries (
            id, job_id, date_iso, planned_start, planned_end, planned_hours_thousandths,
            actual_start, actual_end, actual_hours_thousandths, status, deviation_reason,
            notes, created_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            newId,
            opts?.jobId ?? null,
            entryIdOrDate,
            plannedStart,
            plannedEnd,
            plannedThousandths,
            parsed.actual_start ?? plannedStart,
            parsed.actual_end,
            parsed.actual_hours_thousandths,
            parsed.status,
            parsed.deviation_reason,
            parsed.notes,
            now,
            now,
          ]
        );
        updatedEntryId = newId;
        existingRow = {
          id: newId,
          job_id: opts?.jobId ?? null,
          date_iso: entryIdOrDate,
          planned_start: plannedStart,
          planned_end: plannedEnd,
          planned_hours_thousandths: plannedThousandths,
          actual_start: parsed.actual_start ?? plannedStart,
          actual_end: parsed.actual_end,
          actual_hours_thousandths: parsed.actual_hours_thousandths,
          status: parsed.status,
          deviation_reason: parsed.deviation_reason,
          notes: parsed.notes,
          created_at_ms: now,
          updated_at_ms: now,
        };
      } else {
        updatedEntryId = existingRow.id;
        await tx.run(
          `UPDATE schedule_entries
           SET actual_start = ?,
               actual_end = ?,
               actual_hours_thousandths = ?,
               status = ?,
               deviation_reason = ?,
               notes = ?,
               updated_at_ms = ?
           WHERE id = ?`,
          [
            parsed.actual_start ?? existingRow.actual_start ?? existingRow.planned_start,
            parsed.actual_end,
            parsed.actual_hours_thousandths,
            parsed.status,
            parsed.deviation_reason,
            parsed.notes,
            now,
            existingRow.id,
          ]
        );
      }

      const targetJobId = existingRow.job_id ?? opts?.jobId ?? null;
      if (parsed.also_log_in_site_logs && targetJobId) {
        const jobRows = await tx.query<{ job_code: string; client_name: string | null }>(
          `SELECT j.job_code, c.name AS client_name
           FROM jobs j
           LEFT JOIN clients c ON c.id = j.client_id
           WHERE j.id = ? LIMIT 1`,
          [targetJobId]
        );
        const jobMeta = jobRows[0];
        if (jobMeta) {
          const hoursLabel = `${(parsed.actual_hours_thousandths / 1000)
            .toFixed(1)
            .replace(/\.0$/, "")
            .replace(".", ",")} h`;
          const summaryParts = [
            `Parte ${existingRow.date_iso}: ${hoursLabel} (salida ${parsed.actual_end})`,
            parsed.deviation_reason ? `Motivo: ${parsed.deviation_reason}` : "",
            parsed.notes.trim(),
          ].filter(Boolean);

          await tx.run(
            `INSERT INTO site_logs (
              id, job_id, category, note_text, photo_uri,
              stamp_job_code, stamp_client_name, created_at_iso, created_at_ms
            ) VALUES (?, ?, 'nota', ?, NULL, ?, ?, ?, ?)`,
            [
              `sl_${crypto.randomUUID().slice(0, 12)}`,
              targetJobId,
              summaryParts.join(" · "),
              jobMeta.job_code,
              jobMeta.client_name?.trim() || "Sin cliente asignado",
              existingRow.date_iso || getLocalTodayIso(),
              now,
            ]
          );
        }
      }
    });

    const saved = await this.getEntryById(updatedEntryId);
    if (!saved) {
      throw new Error("SQLITE_QUERY_ERROR: Error recuperando parte guardado");
    }
    return saved;
  }

  async getJobScheduleDeviationSummary(jobId: string): Promise<JobScheduleDeviationSummary> {
    const [entries, settingsRows] = await Promise.all([
      this.listEntriesByJob(jobId),
      this.executor.query<{ hourly_rate_cents: number }>(
        `SELECT hourly_rate_cents FROM app_settings WHERE id = 1 LIMIT 1`
      ),
    ]);
    const hourlyRateCents = Number(settingsRows[0]?.hourly_rate_cents ?? 3800);

    let plannedHoursThousandths = 0;
    let loggedPlannedHoursThousandths = 0;
    let actualHoursThousandths = 0;
    const plannedDateSet = new Set<string>();
    const loggedDateSet = new Set<string>();

    for (const entry of entries) {
      plannedDateSet.add(entry.date_iso);
      plannedHoursThousandths += entry.planned_hours_thousandths;
      if (entry.actual_hours_thousandths !== null) {
        loggedDateSet.add(entry.date_iso);
        loggedPlannedHoursThousandths += entry.planned_hours_thousandths;
        actualHoursThousandths += entry.actual_hours_thousandths;
      }
    }

    const deviationHoursThousandths = actualHoursThousandths - loggedPlannedHoursThousandths;
    const economicImpactCents = Math.round((deviationHoursThousandths / 1000) * hourlyRateCents);

    return {
      job_id: jobId,
      planned_days: plannedDateSet.size,
      logged_days: loggedDateSet.size,
      planned_hours_thousandths: plannedHoursThousandths,
      logged_planned_hours_thousandths: loggedPlannedHoursThousandths,
      actual_hours_thousandths: actualHoursThousandths,
      deviation_hours_thousandths: deviationHoursThousandths,
      hourly_rate_cents: hourlyRateCents,
      economic_impact_cents: economicImpactCents,
    };
  }
}
