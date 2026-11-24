import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GraphRunner } from "../src/agent/graphRunner";
import { DeterministicSpanishParser } from "../src/agent/inference/deterministicSpanishParser";
import { LocalInferenceAdapterImpl } from "../src/agent/inference/localInferenceAdapter";
import { BackupService } from "../src/core/backup/backupService";
import { ResetService } from "../src/core/backup/resetService";
import { NodeBetterSqliteExecutor } from "../src/core/db/nodeSqliteExecutor";
import { JobsRepository } from "../src/core/db/repositories/jobsRepo";
import {
  computeDailyWorkHoursThousandths,
  ScheduleRepository,
} from "../src/core/db/repositories/scheduleRepo";
import { SettingsRepository } from "../src/core/db/repositories/settingsRepo";
import { SiteLogsRepository } from "../src/core/db/repositories/siteLogsRepo";
import { TracesRepository } from "../src/core/db/repositories/tracesRepo";
import { initializeSchema } from "../src/core/db/sqliteExecutor";
import { MemoryFileBridge } from "../src/core/files/memoryFileBridge";
import { MemoryCoordinatorNoop } from "../src/core/memory/memoryCoordinator";
import { parseHashToRoute, routeToHash } from "../src/core/navigation/routes";
import {
  Gate1QuoteCommitPayloadSchema,
  RagSnippetSchema,
} from "../src/core/contracts/schemas";
import { MockFreezerPort, MockOcrPort, MockPdfPort } from "./mocks/ports";

describe("Agenda, Calendario, Horario Habitual y ScheduleSpecialist", () => {
  let executor: NodeBetterSqliteExecutor;
  let scheduleRepo: ScheduleRepository;
  let jobsRepo: JobsRepository;
  let settingsRepo: SettingsRepository;
  let siteLogsRepo: SiteLogsRepository;
  let runner: GraphRunner;

  beforeEach(async () => {
    executor = new NodeBetterSqliteExecutor(":memory:");
    await initializeSchema(executor);
    scheduleRepo = new ScheduleRepository(executor);
    jobsRepo = new JobsRepository(executor);
    settingsRepo = new SettingsRepository(executor);
    siteLogsRepo = new SiteLogsRepository(executor);

    const reset = new ResetService(executor);
    await reset.restoreDemoData(new MockFreezerPort());

    runner = new GraphRunner(
      {
        executor,
        fileBridge: new MemoryFileBridge(),
        memoryCoordinator: new MemoryCoordinatorNoop(),
        inference: new LocalInferenceAdapterImpl(),
        ocrPort: new MockOcrPort(),
        pdfPort: new MockPdfPort(),
        traceRecorder: new TracesRepository(executor),
      },
      "memory"
    );
  });

  afterEach(async () => {
    await executor.close();
  });

  it("gestiona work_schedule_defaults y calcula horas diarias", async () => {
    const initial = await scheduleRepo.getWorkScheduleDefaults();
    expect(initial.work_days).toEqual([1, 2, 3, 4, 5]);
    expect(computeDailyWorkHoursThousandths(initial)).toBe(8000);

    const updated = await scheduleRepo.updateWorkScheduleDefaults({
      work_days: [1, 2, 3, 4, 5, 6],
      morning_start: "08:00",
      morning_end: "13:30",
      afternoon_start: "15:00",
      afternoon_end: "18:00",
      auto_apply_to_jobs: true,
    });
    expect(updated.work_days).toEqual([1, 2, 3, 4, 5, 6]);
    expect(computeDailyWorkHoursThousandths(updated)).toBe(8500);
  });

  it("genera bloques diarios filtrando días laborables y es idempotente", async () => {
    const createdJob = await jobsRepo.createDirectJob({
      title: "Reforma integral cocina",
      address: "C/ Velázquez 18",
    });

    // Del lunes 2026-11-23 al domingo 2026-11-29: 5 días laborables (L-V)
    const generated = await scheduleRepo.generateEntriesForJobDateRange(
      createdJob.id,
      "2026-11-23",
      "2026-11-29"
    );
    expect(generated).toHaveLength(5);
    expect(generated.every((e) => e.planned_hours_thousandths === 8000)).toBe(true);

    const refreshedJob = await jobsRepo.getById(createdJob.id);
    expect(refreshedJob?.start_date_iso).toBe("2026-11-23");
    expect(refreshedJob?.end_date_iso).toBe("2026-11-29");

    // Idempotencia: volver a generar en el mismo rango no duplica entradas
    const secondRun = await scheduleRepo.generateEntriesForJobDateRange(
      createdJob.id,
      "2026-11-23",
      "2026-11-29"
    );
    expect(secondRun).toHaveLength(5);
  });

  it("registra parte diario, enlaza en site_logs y calcula desviación económica con hourly_rate_cents", async () => {
    await settingsRepo.updateHourlyRate(4000); // 40,00 €/h
    const createdJob = await jobsRepo.createDirectJob({
      title: "Cambio bajante patio",
    });
    const entries = await scheduleRepo.generateEntriesForJobDateRange(
      createdJob.id,
      "2026-11-23",
      "2026-11-25"
    );
    expect(entries).toHaveLength(3);

    // Día 1: +2h extra (10h) vinculado al diario
    const updated1 = await scheduleRepo.recordDailyWorkLog(entries[0]!.id, {
      actual_start: "08:00",
      actual_end: "19:00",
      actual_hours_thousandths: 10000,
      status: "alargado",
      deviation_reason: "Imprevisto en instalación",
      notes: "Sustitución de codo antiguo corroído",
      also_log_in_site_logs: true,
    });
    expect(updated1.status).toBe("alargado");
    expect(updated1.actual_hours_thousandths).toBe(10000);

    // Día 2: -1h antes (7h) sin diario
    await scheduleRepo.recordDailyWorkLog(entries[1]!.id, {
      actual_start: "08:00",
      actual_end: "16:00",
      actual_hours_thousandths: 7000,
      status: "antes",
      deviation_reason: "Más rápido de lo previsto",
      notes: "Material ya cortado de taller",
      also_log_in_site_logs: false,
    });

    const siteLogs = await siteLogsRepo.listByJobId(createdJob.id);
    expect(siteLogs).toHaveLength(1);
    expect(siteLogs[0]?.note_text).toContain("Sustitución de codo antiguo corroído");

    // Desviación neta: +2h - 1h = +1h = +1000 thousandths => +4000 cents
    const summary = await scheduleRepo.getJobScheduleDeviationSummary(createdJob.id);
    expect(summary.planned_days).toBe(3);
    expect(summary.logged_days).toBe(2);
    expect(summary.planned_hours_thousandths).toBe(24000);
    expect(summary.logged_planned_hours_thousandths).toBe(16000);
    expect(summary.actual_hours_thousandths).toBe(17000);
    expect(summary.deviation_hours_thousandths).toBe(1000);
    expect(summary.economic_impact_cents).toBe(4000);
  });

  it("enruta dictados de planificación y parte diario a schedule_specialist -> ScheduleWorkLogWidget", async () => {
    const parser = new DeterministicSpanishParser();

    const p1 = parser.parse("Planifica la obra de Marta del 22 al 30 de noviembre");
    expect(p1.intent).toBe("schedule_specialist");
    expect(p1.entities.schedule?.mode).toBe("plan_range");
    expect(p1.entities.schedule?.start_date_iso).toMatch(/-11-22$/);
    expect(p1.entities.schedule?.end_date_iso).toMatch(/-11-30$/);

    const p2 = parser.parse("Hoy terminé 2 horas antes en la obra de Juan porque estaba todo listo");
    expect(p2.intent).toBe("schedule_specialist");
    expect(p2.entities.schedule?.mode).toBe("daily_log");
    expect(p2.entities.schedule?.delta_thousandths).toBe(-2000);

    const thr = await runner.createThread({ title: "Agenda voz" });
    const turn = await runner.runTurn(thr.thread_id, {
      client_turn_id: "t_sched_1",
      text: "Planifica la obra de Marta del 22 al 30 de noviembre",
      action_type: "free_text_or_voice",
    });

    expect(turn.checkpoint_status).toBe("idle");
    expect(turn.active_widget?.ui_widget_type).toBe("ScheduleWorkLogWidget");
    if (turn.active_widget?.ui_widget_type === "ScheduleWorkLogWidget") {
      expect(turn.active_widget.widget_payload.mode).toBe("plan_range");
      expect(turn.active_widget.widget_payload.start_date_iso).toMatch(/-11-22$/);
      expect(turn.active_widget.widget_payload.end_date_iso).toMatch(/-11-30$/);
      expect(turn.active_widget.widget_payload.job_id).toBeTruthy();
    }
  });

  it("mapea ruta #/calendario y preserva agenda en backup/migración", async () => {
    expect(parseHashToRoute("#/calendario")).toEqual({ name: "calendar" });
    expect(routeToHash({ name: "calendar" })).toBe("#/calendario");
    expect(parseHashToRoute("#/calendario?date=2026-11-25")).toEqual({
      name: "calendar",
      focusDateIso: "2026-11-25",
    });

    const job = await jobsRepo.createDirectJob({
      title: "Alicatado terraza",
      start_date_iso: "2026-11-24",
      end_date_iso: "2026-11-25",
    });
    await scheduleRepo.generateEntriesForJobDateRange(job.id, "2026-11-24", "2026-11-25");

    const backupService = new BackupService(executor);
    const exported = await backupService.exportBackupJson();

    const reset = new ResetService(executor);
    await reset.startFromScratch();
    expect(await scheduleRepo.listAllEntries()).toHaveLength(0);

    await backupService.importBackupJson(exported);
    const restoredEntries = await scheduleRepo.listEntriesByJob(job.id);
    expect(restoredEntries).toHaveLength(2);
  });

  it("permite citas de menos de un día, múltiples bloques en el mismo día y fines de semana puntuales", async () => {
    const job = await jobsRepo.createDirectJob({
      title: "Reparación rápida grifería",
    });

    await expect(
      scheduleRepo.createSingleEntry({
        job_id: job.id,
        date_iso: "2026-11-28",
        planned_start: "14:00",
        planned_end: "12:00",
      })
    ).rejects.toThrow("SCHEMA_VALIDATION_ERROR");

    const morning = await scheduleRepo.createSingleEntry({
      job_id: job.id,
      date_iso: "2026-11-28",
      planned_start: "09:00",
      planned_end: "11:00",
      notes: "Desmontaje grifo antiguo",
    });
    expect(morning.planned_hours_thousandths).toBe(2000);

    const syncedJob = await jobsRepo.getById(job.id);
    expect(syncedJob?.start_date_iso).toBe("2026-11-28");
    expect(syncedJob?.end_date_iso).toBe("2026-11-28");

    const afternoon = await scheduleRepo.createSingleEntry({
      job_id: job.id,
      date_iso: "2026-11-28",
      planned_start: "16:00",
      planned_end: "18:00",
      notes: "Prueba estanqueidad",
    });
    expect(afternoon.planned_hours_thousandths).toBe(2000);

    const summary = await scheduleRepo.getJobScheduleDeviationSummary(job.id);
    expect(summary.planned_days).toBe(1);
    expect(summary.planned_hours_thousandths).toBe(4000);

    await scheduleRepo.deleteEntry(afternoon.id);
    expect(await scheduleRepo.listEntriesByJob(job.id)).toHaveLength(1);

    // Obra puntual de 2 horas en sábado (start === end en fin de semana)
    const weekendJob = await jobsRepo.createDirectJob({ title: "Urgencia sábado" });
    const weekendEntries = await scheduleRepo.generateEntriesForJobDateRange(
      weekendJob.id,
      "2026-11-28",
      "2026-11-28",
      {
        plannedStart: "10:00",
        plannedEnd: "12:00",
        plannedHoursThousandths: 2000,
      }
    );
    expect(weekendEntries).toHaveLength(1);
    expect(weekendEntries[0]?.planned_hours_thousandths).toBe(2000);

    // replaceSingleDayHours actualiza duración del mismo día
    const updatedWeekend = await scheduleRepo.generateEntriesForJobDateRange(
      weekendJob.id,
      "2026-11-28",
      "2026-11-28",
      {
        plannedStart: "10:00",
        plannedEnd: "13:00",
        plannedHoursThousandths: 3000,
        replaceSingleDayHours: true,
      }
    );
    expect(updatedWeekend).toHaveLength(1);
    expect(updatedWeekend[0]?.planned_hours_thousandths).toBe(3000);
  });

  it("acepta descripciones y notas largas (>240 caracteres) manteniendo compactos los snippets RAG", () => {
    const longDescription = "Picado y desescombro completo ".repeat(40).trim(); // > 1000 chars
    const longNotes = "Condiciones detalladas de obra en vivienda habitada. ".repeat(15).trim(); // > 700 chars
    expect(longDescription.length).toBeGreaterThan(240);
    expect(longNotes.length).toBeGreaterThan(500);

    const parsed = Gate1QuoteCommitPayloadSchema.parse({
      quote_id: null,
      client_id: "cli-01",
      job_id: null,
      job_title: "Reforma completa con descripción extensa " + "detallada ".repeat(20),
      vat_rate: 10,
      notes: longNotes,
      lines: [
        {
          catalog_item_id: null,
          description: longDescription,
          category: "Albañilería",
          unit: "m2",
          quantity_thousandths: 10000,
          unit_price_cents: 4500,
          original_unit_price_cents: 4500,
          save_to_catalog: false,
        },
      ],
    });
    expect(parsed.lines[0]?.description.length).toBeGreaterThan(240);

    expect(() =>
      RagSnippetSchema.parse({
        source_table: "catalog_items",
        record_id: "cat-1",
        title: "Partida",
        snippet_text: "x".repeat(250),
        bm25_score: 1,
      })
    ).toThrow();
  });
});
