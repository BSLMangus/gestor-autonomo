import { ActaPuestaEnMarchaDataSchema } from "../../contracts/schemas";
import type {
  ActaPuestaEnMarchaData,
  ActaRow,
  ClientRow,
  EspecialidadActa,
  EstadoActa,
  JobRow,
  LocalFileBridge,
  MemoryCoordinator,
  QuoteItemRow,
  QuoteRow,
  SqliteExecutor,
  TipoActuacionActa,
} from "../../contracts/types";
import { getFiscalYearFromIso, getLocalTodayIso, isValidIsoDate } from "../../fiscal/dateQuarter";
import type { PdfActaDocumentInput, PdfPort } from "../../ports/mediaPorts";
import { normalizeSpanishText } from "../../text/spanishText";
import { readActaPhotoAsPdfDataUrl } from "../../../features/actas/actaImageHelper";
import { buildDefaultActaData } from "../../../features/actas/actaTemplates";
import {
  allocateNextSequence,
  rewindSequenceIfLatest,
  SettingsRepository,
} from "./settingsRepo";

export interface ActaWithContextSummary extends ActaRow {
  job_code: string | null;
  job_title: string | null;
  client_name: string | null;
}

export interface CreateActaFromContextInput {
  jobId?: string | null;
  quoteId?: string | null;
  clientId?: string | null;
  activeAccountEmail?: string | null;
  especialidad?: EspecialidadActa;
  tipoActuacion?: TipoActuacionActa;
  fechaEmisionIso?: string;
}

function inferFromQuoteItems(items: QuoteItemRow[]): {
  especialidad: EspecialidadActa;
  receptoresSugeridos: string;
  equiposSanitariosSugeridos: string;
} {
  const elecItems: string[] = [];
  const fontItems: string[] = [];
  const generalItems: string[] = [];

  for (const item of items) {
    const desc = item.description.trim();
    if (!desc) continue;
    if (item.category === "Electricidad") {
      elecItems.push(desc);
    } else if (item.category === "Fontanería") {
      fontItems.push(desc);
    } else {
      generalItems.push(desc);
    }
  }

  let especialidad: EspecialidadActa = "electricidad";
  if (elecItems.length > 0 && fontItems.length > 0) {
    especialidad = "mixta";
  } else if (fontItems.length > 0) {
    especialidad = "fontaneria";
  }

  const fallbackAll = generalItems.join(", ");
  return {
    especialidad,
    receptoresSugeridos: elecItems.length > 0 ? elecItems.join(", ") : fallbackAll,
    equiposSanitariosSugeridos: fontItems.length > 0 ? fontItems.join(", ") : fallbackAll,
  };
}

function parseStoredActaData(row: ActaRow): ActaPuestaEnMarchaData {
  const raw = JSON.parse(row.datos_json) as unknown;
  return ActaPuestaEnMarchaDataSchema.parse(raw);
}

export class ActasRepository {
  constructor(
    private readonly executor: SqliteExecutor,
    private readonly memoryCoordinator?: MemoryCoordinator
  ) {}

  async createDraftFromContext(
    input: CreateActaFromContextInput = {}
  ): Promise<{ row: ActaRow; data: ActaPuestaEnMarchaData }> {
    const fechaEmisionIso = input.fechaEmisionIso ?? getLocalTodayIso();
    if (!isValidIsoDate(fechaEmisionIso)) {
      throw new Error(`SCHEMA_VALIDATION_ERROR: Fecha de emisión inválida '${fechaEmisionIso}'`);
    }

    const settings = await new SettingsRepository(this.executor).getAppSettings();

    let resolvedQuote: QuoteRow | null = null;
    if (input.quoteId) {
      const qRows = await this.executor.query<QuoteRow>(
        `SELECT * FROM quotes WHERE id = ? LIMIT 1`,
        [input.quoteId]
      );
      resolvedQuote = qRows[0] ?? null;
    }

    const resolvedJobId = input.jobId ?? resolvedQuote?.job_id ?? null;
    let resolvedJob: JobRow | null = null;
    if (resolvedJobId) {
      const jRows = await this.executor.query<JobRow>(
        `SELECT * FROM jobs WHERE id = ? LIMIT 1`,
        [resolvedJobId]
      );
      resolvedJob = jRows[0] ?? null;
    }

    if (!resolvedQuote && resolvedJob) {
      const activeQuotes = await this.executor.query<QuoteRow>(
        `SELECT * FROM quotes WHERE job_id = ? AND status != 'rechazado' LIMIT 1`,
        [resolvedJob.id]
      );
      resolvedQuote = activeQuotes[0] ?? null;
    }

    const resolvedClientId =
      input.clientId ?? resolvedQuote?.client_id ?? resolvedJob?.client_id ?? null;
    let resolvedClient: ClientRow | null = null;
    if (resolvedClientId) {
      const cRows = await this.executor.query<ClientRow>(
        `SELECT * FROM clients WHERE id = ? LIMIT 1`,
        [resolvedClientId]
      );
      resolvedClient = cRows[0] ?? null;
    }

    const quoteItems = resolvedQuote
      ? await this.executor.query<QuoteItemRow>(
          `SELECT * FROM quote_items WHERE quote_id = ? ORDER BY line_order ASC`,
          [resolvedQuote.id]
        )
      : [];

    const inferred = inferFromQuoteItems(quoteItems);
    const especialidad = input.especialidad ?? inferred.especialidad;
    const tipoActuacion = input.tipoActuacion ?? "reforma_integral";

    const alcanceParts = [resolvedJob?.title, resolvedJob?.address].filter(
      (part): part is string => Boolean(part && part.trim().length > 0)
    );
    const alcanceUbicacion = alcanceParts.join(" · ");

    const clienteNombre =
      resolvedClient?.name || resolvedQuote?.client_name_snapshot || "";
    const clienteNif =
      resolvedClient?.nif || resolvedQuote?.client_nif_snapshot || "";
    const clienteDireccion =
      resolvedJob?.address ||
      resolvedClient?.fiscal_address ||
      resolvedQuote?.client_address_snapshot ||
      "";
    const clienteTelefono =
      resolvedClient?.phone || resolvedQuote?.client_phone_snapshot || "";
    const clienteEmail = resolvedClient?.email || "";

    const installerEmail =
      settings.emitter_email.trim() || input.activeAccountEmail?.trim() || "";

    const fiscalYear = getFiscalYearFromIso(fechaEmisionIso);
    const now = Date.now();
    const actaId = `act_${crypto.randomUUID().slice(0, 12)}`;

    const created = await this.executor.inTransaction(async (tx) => {
      const { code: codigoActa } = await allocateNextSequence(tx, "ACT", fiscalYear, now);

      const data = ActaPuestaEnMarchaDataSchema.parse(
        buildDefaultActaData({
          codigoActa,
          fechaEmisionIso,
          especialidad,
          tipoActuacion,
          alcanceUbicacion,
          instalador: {
            nombre_razon_social: settings.emitter_name,
            nif_cif: settings.emitter_nif,
            domicilio_fiscal: settings.emitter_fiscal_address,
            telefono: settings.emitter_phone,
            email: installerEmail,
            num_registro_empresa: settings.emitter_registry_number || undefined,
            tecnico_nombre: settings.emitter_tech_name,
            tecnico_dni: settings.emitter_tech_dni,
            num_carne_instalador: settings.emitter_installer_card || undefined,
          },
          cliente: {
            nombre_razon_social: clienteNombre,
            nif_cif: clienteNif,
            direccion_emplazamiento: clienteDireccion,
            telefono: clienteTelefono || undefined,
            email: clienteEmail || undefined,
          },
          plazoGarantiaMeses: settings.default_acta_warranty_months,
          receptoresSugeridos: inferred.receptoresSugeridos,
          equiposSanitariosSugeridos: inferred.equiposSanitariosSugeridos,
        })
      );

      const datosJson = JSON.stringify(data);
      const firmaInstalador = settings.emitter_signature_data_url ?? null;

      await tx.run(
        `INSERT INTO actas_puesta_en_marcha (
          id, codigo_acta, job_id, quote_id, client_id, especialidad, tipo_actuacion,
          estado, fecha_emision_iso, datos_json, firma_cliente_base64,
          firma_instalador_base64, pdf_uri, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'borrador', ?, ?, NULL, ?, NULL, ?, ?)`,
        [
          actaId,
          codigoActa,
          resolvedJob?.id ?? null,
          resolvedQuote?.id ?? null,
          resolvedClient?.id ?? null,
          data.especialidad,
          data.tipo_actuacion,
          data.fecha_emision,
          datosJson,
          firmaInstalador,
          now,
          now,
        ]
      );

      const row: ActaRow = {
        id: actaId,
        codigo_acta: codigoActa,
        job_id: resolvedJob?.id ?? null,
        quote_id: resolvedQuote?.id ?? null,
        client_id: resolvedClient?.id ?? null,
        especialidad: data.especialidad,
        tipo_actuacion: data.tipo_actuacion,
        estado: "borrador",
        fecha_emision_iso: data.fecha_emision,
        datos_json: datosJson,
        firma_cliente_base64: null,
        firma_instalador_base64: firmaInstalador,
        pdf_uri: null,
        created_at_ms: now,
        updated_at_ms: now,
      };
      return { row, data };
    });

    return created;
  }

  async getById(id: string): Promise<{ row: ActaRow; data: ActaPuestaEnMarchaData } | null> {
    const rows = await this.executor.query<ActaRow>(
      `SELECT * FROM actas_puesta_en_marcha WHERE id = ? LIMIT 1`,
      [id]
    );
    const row = rows[0];
    if (!row) return null;
    return { row, data: parseStoredActaData(row) };
  }

  async listPaginated(opts?: {
    search?: string;
    estado?: EstadoActa;
    jobId?: string;
    clientId?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: ActaWithContextSummary[]; totalCount: number }> {
    const limit = Math.max(1, Math.min(100, opts?.limit ?? 30));
    const offset = Math.max(0, opts?.offset ?? 0);
    const where: string[] = [];
    const params: unknown[] = [];

    if (opts?.estado) {
      where.push("a.estado = ?");
      params.push(opts.estado);
    }
    if (opts?.jobId) {
      where.push("a.job_id = ?");
      params.push(opts.jobId);
    }
    if (opts?.clientId) {
      where.push("a.client_id = ?");
      params.push(opts.clientId);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const rows = await this.executor.query<ActaWithContextSummary & Record<string, unknown>>(
      `SELECT a.*, j.job_code AS job_code, j.title AS job_title, c.name AS client_name
       FROM actas_puesta_en_marcha a
       LEFT JOIN jobs j ON j.id = a.job_id
       LEFT JOIN clients c ON c.id = a.client_id
       ${whereSql}
       ORDER BY a.updated_at_ms DESC, a.created_at_ms DESC`,
      params
    );

    const searchNorm = opts?.search ? normalizeSpanishText(opts.search) : "";
    const filtered = searchNorm
      ? rows.filter((r) => {
          const haystack = normalizeSpanishText(
            `${r.codigo_acta} ${r.job_code ?? ""} ${r.job_title ?? ""} ${r.client_name ?? ""} ${r.especialidad} ${r.datos_json}`
          );
          return haystack.includes(searchNorm);
        })
      : rows;

    return {
      items: filtered.slice(offset, offset + limit),
      totalCount: filtered.length,
    };
  }

  async listByJobId(jobId: string): Promise<ActaRow[]> {
    return this.executor.query<ActaRow>(
      `SELECT * FROM actas_puesta_en_marcha WHERE job_id = ? ORDER BY updated_at_ms DESC, created_at_ms DESC`,
      [jobId]
    );
  }

  async listByClientId(clientId: string): Promise<ActaRow[]> {
    return this.executor.query<ActaRow>(
      `SELECT * FROM actas_puesta_en_marcha WHERE client_id = ? ORDER BY updated_at_ms DESC, created_at_ms DESC`,
      [clientId]
    );
  }

  async saveDraft(
    id: string,
    input: {
      data: ActaPuestaEnMarchaData;
      estado?: EstadoActa;
      clientId?: string | null;
      jobId?: string | null;
      quoteId?: string | null;
      firmaClienteBase64?: string | null;
      firmaInstaladorBase64?: string | null;
    }
  ): Promise<{ row: ActaRow; data: ActaPuestaEnMarchaData }> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new Error("INVALID_STATE_TRANSITION: Acta no encontrada");
    }

    const validated = ActaPuestaEnMarchaDataSchema.parse({
      ...input.data,
      codigo_acta: existing.row.codigo_acta,
    });
    const nextEstado = input.estado ?? existing.row.estado;
    const nextClientId =
      input.clientId !== undefined ? input.clientId : existing.row.client_id;
    const nextJobId = input.jobId !== undefined ? input.jobId : existing.row.job_id;
    const nextQuoteId = input.quoteId !== undefined ? input.quoteId : existing.row.quote_id;
    const nextFirmaCliente =
      input.firmaClienteBase64 !== undefined
        ? input.firmaClienteBase64
        : existing.row.firma_cliente_base64;
    const nextFirmaInstalador =
      input.firmaInstaladorBase64 !== undefined
        ? input.firmaInstaladorBase64
        : existing.row.firma_instalador_base64;

    const now = Date.now();
    const datosJson = JSON.stringify(validated);

    await this.executor.run(
      `UPDATE actas_puesta_en_marcha
       SET job_id = ?,
           quote_id = ?,
           client_id = ?,
           especialidad = ?,
           tipo_actuacion = ?,
           estado = ?,
           fecha_emision_iso = ?,
           datos_json = ?,
           firma_cliente_base64 = ?,
           firma_instalador_base64 = ?,
           updated_at_ms = ?
       WHERE id = ?`,
      [
        nextJobId,
        nextQuoteId,
        nextClientId,
        validated.especialidad,
        validated.tipo_actuacion,
        nextEstado,
        validated.fecha_emision,
        datosJson,
        nextFirmaCliente,
        nextFirmaInstalador,
        now,
        id,
      ]
    );

    const reloaded = await this.getById(id);
    if (!reloaded) {
      throw new Error("SQLITE_QUERY_ERROR: No se pudo recargar el acta tras guardar");
    }
    return reloaded;
  }

  async markSigned(
    id: string,
    input: {
      data?: ActaPuestaEnMarchaData;
      firmaClienteBase64: string;
      firmaInstaladorBase64?: string | null;
      pdfUri?: string | null;
    }
  ): Promise<{ row: ActaRow; data: ActaPuestaEnMarchaData }> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new Error("INVALID_STATE_TRANSITION: Acta no encontrada");
    }
    if (!input.firmaClienteBase64.trim()) {
      throw new Error("SCHEMA_VALIDATION_ERROR: La firma del cliente es obligatoria para cerrar el acta");
    }

    const validated = ActaPuestaEnMarchaDataSchema.parse({
      ...(input.data ?? existing.data),
      codigo_acta: existing.row.codigo_acta,
    });
    const nextFirmaInstalador =
      input.firmaInstaladorBase64 !== undefined
        ? input.firmaInstaladorBase64
        : existing.row.firma_instalador_base64;
    const nextPdfUri = input.pdfUri !== undefined ? input.pdfUri : existing.row.pdf_uri;
    const now = Date.now();

    await this.executor.run(
      `UPDATE actas_puesta_en_marcha
       SET especialidad = ?,
           tipo_actuacion = ?,
           estado = 'firmada',
           fecha_emision_iso = ?,
           datos_json = ?,
           firma_cliente_base64 = ?,
           firma_instalador_base64 = ?,
           pdf_uri = ?,
           updated_at_ms = ?
       WHERE id = ?`,
      [
        validated.especialidad,
        validated.tipo_actuacion,
        validated.fecha_emision,
        JSON.stringify(validated),
        input.firmaClienteBase64,
        nextFirmaInstalador,
        nextPdfUri,
        now,
        id,
      ]
    );

    const reloaded = await this.getById(id);
    if (!reloaded) {
      throw new Error("SQLITE_QUERY_ERROR: No se pudo recargar el acta tras firmar");
    }
    return reloaded;
  }

  async regeneratePdfOnDemand(
    actaId: string,
    pdfPort: PdfPort,
    fileBridge: LocalFileBridge
  ): Promise<string> {
    const loaded = await this.getById(actaId);
    if (!loaded) {
      throw new Error("INVALID_STATE_TRANSITION: Acta no encontrada");
    }

    const settings = await new SettingsRepository(this.executor).getAppSettings();
    const resolvedFotos: Array<{ dataUrl: string; pieFoto: string }> = [];
    for (const foto of loaded.data.fotos) {
      const dataUrl = await readActaPhotoAsPdfDataUrl(fileBridge, foto.uri);
      if (dataUrl) {
        resolvedFotos.push({ dataUrl, pieFoto: foto.pie_foto });
      }
    }

    const pdfInput: PdfActaDocumentInput = {
      kind: "acta",
      codigoActa: loaded.row.codigo_acta,
      estado: loaded.row.estado,
      data: loaded.data,
      emitterLogoDataUrl: settings.emitter_logo_data_url ?? null,
      firmaInstaladorDataUrl:
        loaded.row.firma_instalador_base64 ?? settings.emitter_signature_data_url ?? null,
      firmaClienteDataUrl: loaded.row.firma_cliente_base64 ?? null,
      resolvedFotos,
    };

    const release = this.memoryCoordinator
      ? await this.memoryCoordinator.acquireHeavyTask("pdf")
      : async () => undefined;
    try {
      const { pdfBytes, fileName } = await pdfPort.buildDocumentPdf(pdfInput);
      const pdfUri = await fileBridge.savePdf(pdfBytes, fileName);
      await this.executor.run(
        `UPDATE actas_puesta_en_marcha SET pdf_uri = ?, updated_at_ms = ? WHERE id = ?`,
        [pdfUri, Date.now(), actaId]
      );
      return pdfUri;
    } finally {
      await release();
    }
  }

  async delete(
    id: string,
    fileBridge?: Pick<LocalFileBridge, "deleteCommittedMedia" | "deletePdf">
  ): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) return;

    await this.executor.inTransaction(async (tx) => {
      await tx.run(`DELETE FROM actas_puesta_en_marcha WHERE id = ?`, [id]);

      const match = /^ACT-(\d{4})-\d+$/.exec(existing.row.codigo_acta);
      if (match) {
        await rewindSequenceIfLatest(
          tx,
          "ACT",
          Number(match[1]),
          existing.row.codigo_acta,
          Date.now()
        );
      }
    });

    if (fileBridge) {
      await fileBridge.deletePdf(existing.row.pdf_uri).catch(() => undefined);
      for (const foto of existing.data.fotos) {
        await fileBridge.deleteCommittedMedia(foto.uri).catch(() => undefined);
      }
    }
  }
}
