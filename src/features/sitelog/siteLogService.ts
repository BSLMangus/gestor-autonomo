import { SiteLogInputSchema } from "../../core/contracts/schemas";
import type {
  LocalFileBridge,
  SiteLogInput,
  SiteLogRecord,
  SqliteExecutor,
} from "../../core/contracts/types";
import { ClientsRepository } from "../../core/db/repositories/clientsRepo";
import { JobsRepository } from "../../core/db/repositories/jobsRepo";
import { peekNextSequenceCode } from "../../core/db/repositories/settingsRepo";
import { SiteLogsRepository } from "../../core/db/repositories/siteLogsRepo";
import {
  formatLocalDateTimeIso,
  getFiscalYearFromIso,
  getLocalTodayIso,
} from "../../core/fiscal/dateQuarter";
import type { WatermarkPort } from "../../core/ports/mediaPorts";

/**
 * Servicio directo para el Diario de Obra (`site_logs`) sin pasar por HITL LangGraph.
 * Garantiza creación atómica de `new_job` XOR `job_id` dentro de `inTransaction`
 * y sellado de foto con rollback completo ante fallos de BD.
 */
export class SiteLogService {
  private readonly clientsRepo: ClientsRepository;
  private readonly jobsRepo: JobsRepository;
  private readonly siteLogsRepo: SiteLogsRepository;

  constructor(
    private readonly executor: SqliteExecutor,
    private readonly fileBridge: LocalFileBridge,
    private readonly watermarkPort: WatermarkPort
  ) {
    this.clientsRepo = new ClientsRepository(executor);
    this.jobsRepo = new JobsRepository(executor);
    this.siteLogsRepo = new SiteLogsRepository(executor);
  }

  async commitSiteLog(rawInput: SiteLogInput): Promise<{ siteLog: SiteLogRecord; jobCode: string }> {
    const input = SiteLogInputSchema.parse(rawInput);
    const nowMs = Date.now();
    const todayIso = getLocalTodayIso();
    const nowIso = formatLocalDateTimeIso(nowMs);
    const fiscalYear = getFiscalYearFromIso(todayIso);

    let stampJobCode = "OBR-NUEVA";
    let stampClientName = "Sin cliente asignado";

    if (input.job_id) {
      const existingJob = await this.jobsRepo.getById(input.job_id);
      if (!existingJob) {
        throw new Error(`INVALID_STATE_TRANSITION: Obra '${input.job_id}' no encontrada`);
      }
      stampJobCode = existingJob.job_code;
      if (existingJob.client_id) {
        const client = await this.clientsRepo.getById(existingJob.client_id);
        stampClientName = client?.name?.trim() || "Sin cliente asignado";
      }
    } else if (input.new_job) {
      stampJobCode = await peekNextSequenceCode(this.executor, "OBR", fiscalYear);
      stampClientName = input.new_job.title;
    }

    let committedPhotoUri: string | null = null;
    if (input.raw_media_uri) {
      try {
        const mime = input.raw_media_uri.toLowerCase().endsWith(".png")
          ? "image/png"
          : "image/jpeg";
        const file = await this.fileBridge.readAsFile(
          input.raw_media_uri,
          `raw-sitelog.${mime === "image/png" ? "png" : "jpg"}`,
          mime
        );
        const rawBytes = new Uint8Array(await file.arrayBuffer());
        const stamped = await this.watermarkPort.compressAndStamp({
          imageBytes: rawBytes,
          mimeType: mime,
          stamp: {
            jobCode: stampJobCode,
            clientName: stampClientName,
            timestampIso: nowIso,
          },
        });
        const stampedTempUri = await this.fileBridge.saveTempMedia(stamped.jpegBytes, "jpg");
        try {
          committedPhotoUri = await this.fileBridge.commitMedia(stampedTempUri, "sitelogs");
        } finally {
          await this.fileBridge.deleteIfTemp(stampedTempUri);
        }
      } catch (err) {
        throw new Error(
          `IMAGE_PROCESS_ERROR: No se pudo sellar la fotografía de obra (${err instanceof Error ? err.message : String(err)})`
        );
      }
    }

    try {
      const siteLog = await this.siteLogsRepo.insertWithOptionalNewJob({
        input,
        committedPhotoUri,
        nowMs,
        todayIso,
      });

      if (input.raw_media_uri) {
        await this.fileBridge.deleteIfTemp(input.raw_media_uri);
      }

      return { siteLog, jobCode: siteLog.stamp_job_code };
    } catch (err) {
      if (committedPhotoUri) {
        await this.fileBridge.rollbackCommittedMedia(committedPhotoUri);
      }
      throw err;
    }
  }
}
