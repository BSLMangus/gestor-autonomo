import { parseQuoteAttachmentsJson } from "../../contracts/schemas";
import { formatLocalDateIso, getLocalTodayIso, isValidIsoDate } from "../../fiscal/dateQuarter";
import {
  computeQuoteTotalsByBillingMode,
  computeQuoteValidUntilIso,
  parseQuotePaymentMethodsJson,
  parseQuotePaymentScheduleJson,
} from "../../fiscal/fiscalEngine";
import type { PdfPort, PdfQuoteDocumentInput } from "../../ports/mediaPorts";
import type {
  BillingMode,
  ClientRow,
  Gate1QuoteDraftPayload,
  JobRow,
  JobStatus,
  LaborOnlySubMode,
  LocalFileBridge,
  MemoryCoordinator,
  QuoteItemRow,
  QuoteRow,
  QuoteStatus,
  QuoteVatRate,
  SqliteExecutor,
} from "../../contracts/types";
import { sanitizeQuoteItemDescription } from "../../text/quoteDescriptionSanitizer";
import { normalizeSpanishText } from "../../text/spanishText";
import { rewindSequenceIfLatest } from "./settingsRepo";

export interface QuoteWithJobSummary extends QuoteRow {
  job_code: string;
  job_title: string;
  job_status: JobStatus;
}

export class QuotesRepository {
  constructor(
    private readonly executor: SqliteExecutor,
    private readonly memoryCoordinator?: MemoryCoordinator
  ) {}

  async getById(id: string): Promise<QuoteRow | null> {
    const rows = await this.executor.query<QuoteRow>(
      `SELECT * FROM quotes WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows[0] ?? null;
  }

  async listPaginated(opts?: {
    search?: string;
    status?: QuoteStatus;
    limit?: number;
    offset?: number;
  }): Promise<{ items: QuoteWithJobSummary[]; totalCount: number }> {
    const limit = Math.max(1, Math.min(100, opts?.limit ?? 30));
    const offset = Math.max(0, opts?.offset ?? 0);
    const params: unknown[] = [];
    const statusClause = opts?.status ? "WHERE q.status = ?" : "";
    if (opts?.status) params.push(opts.status);

    const rows = await this.executor.query<QuoteWithJobSummary & Record<string, unknown>>(
      `SELECT q.*, j.job_code AS job_code, j.title AS job_title, j.status AS job_status
       FROM quotes q
       JOIN jobs j ON j.id = q.job_id
       ${statusClause}
       ORDER BY q.updated_at_ms DESC, q.created_at_ms DESC`,
      params
    );

    const searchNorm = opts?.search ? normalizeSpanishText(opts.search) : "";
    const filtered = searchNorm
      ? rows.filter((r) => {
          const haystack = normalizeSpanishText(
            `${r.quote_code} ${r.client_name_snapshot} ${r.job_code} ${r.job_title} ${r.general_description ?? ""} ${r.notes}`
          );
          return haystack.includes(searchNorm);
        })
      : rows;

    return {
      items: filtered.slice(offset, offset + limit),
      totalCount: filtered.length,
    };
  }

  async getActiveByJobId(jobId: string): Promise<QuoteRow | null> {
    const rows = await this.executor.query<QuoteRow>(
      `SELECT * FROM quotes WHERE job_id = ? AND status != 'rechazado' LIMIT 1`,
      [jobId]
    );
    return rows[0] ?? null;
  }

  async listByJobId(jobId: string): Promise<QuoteRow[]> {
    return this.executor.query<QuoteRow>(
      `SELECT * FROM quotes WHERE job_id = ? ORDER BY created_at_ms DESC`,
      [jobId]
    );
  }

  async getItems(quoteId: string): Promise<QuoteItemRow[]> {
    const rows = await this.executor.query<QuoteItemRow>(
      `SELECT * FROM quote_items WHERE quote_id = ? ORDER BY line_order ASC`,
      [quoteId]
    );
    return rows.map((item) => ({
      ...item,
      description: sanitizeQuoteItemDescription(item.description, {
        knownPricesCents: [item.unit_price_cents, item.line_subtotal_cents],
      }),
    }));
  }

  async getDuplicateDraftData(quoteId: string): Promise<Gate1QuoteDraftPayload> {
    const quote = await this.getById(quoteId);
    if (!quote) {
      throw new Error("INVALID_STATE_TRANSITION: Presupuesto no encontrado");
    }
    const [items, jobRows] = await Promise.all([
      this.getItems(quoteId),
      this.executor.query<JobRow>(`SELECT * FROM jobs WHERE id = ? LIMIT 1`, [quote.job_id]),
    ]);
    const job = jobRows[0] ?? null;

    const billingMode: BillingMode =
      quote.modalidad_cobro ?? job?.modalidad_cobro ?? "solo_partidas";
    const laborSubMode: LaborOnlySubMode =
      quote.solo_mano_obra_submodo ?? job?.solo_mano_obra_submodo ?? "por_horas";
    const horasEstimadasThousandths =
      quote.horas_estimadas_thousandths ?? job?.horas_estimadas_thousandths ?? 0;
    const tarifaHoraCents =
      quote.tarifa_hora_cents !== undefined
        ? quote.tarifa_hora_cents
        : (job?.tarifa_hora_cents ?? null);
    const manoObraFijaCents =
      quote.mano_obra_fija_cents ?? job?.mano_obra_fija_cents ?? 0;

    return {
      quote_id: null,
      client_id: quote.client_id,
      ...(!quote.client_id && quote.client_name_snapshot.trim()
        ? {
            new_client: {
              name: quote.client_name_snapshot.trim(),
              ...(quote.client_nif_snapshot ? { nif: quote.client_nif_snapshot } : {}),
              ...(quote.client_address_snapshot
                ? { fiscal_address: quote.client_address_snapshot }
                : {}),
              ...(quote.client_phone_snapshot ? { phone: quote.client_phone_snapshot } : {}),
            },
          }
        : {}),
      job_id: null,
      job_title: job?.title ?? "",
      general_description: quote.general_description ?? "",
      estimated_duration_value: quote.estimated_duration_value ?? null,
      estimated_duration_unit: quote.estimated_duration_unit ?? "dias_laborables",
      vat_rate: quote.vat_rate,
      validity_days: quote.validity_days ?? null,
      payment_methods: parseQuotePaymentMethodsJson(quote.payment_methods_json),
      payment_schedule: parseQuotePaymentScheduleJson(quote.payment_schedule_json),
      payment_terms_text: quote.payment_terms_text ?? "",
      iban_override: quote.iban_override ?? "",
      bank_name: quote.bank_name ?? "",
      show_iban: quote.show_iban !== undefined ? quote.show_iban !== 0 : true,
      notes: quote.notes ?? "",
      attachments: parseQuoteAttachmentsJson(quote.attachments_json),
      modalidad_cobro: billingMode,
      solo_mano_obra_submodo: laborSubMode,
      horas_estimadas_thousandths: horasEstimadasThousandths,
      tarifa_hora_cents: tarifaHoraCents,
      mano_obra_fija_cents: manoObraFijaCents,
      lines: items.map((item) => ({
        catalog_item_id: item.catalog_item_id,
        description: sanitizeQuoteItemDescription(item.description, {
          knownPricesCents: [item.unit_price_cents, item.line_subtotal_cents],
        }),
        category: item.category,
        unit: item.unit,
        quantity_thousandths: item.quantity_thousandths,
        unit_price_cents: item.unit_price_cents,
        original_unit_price_cents: item.unit_price_cents,
        save_to_catalog: false,
      })),
    };
  }

  async markSentManually(quoteId: string, sentAtIso = getLocalTodayIso()): Promise<QuoteRow> {
    if (!isValidIsoDate(sentAtIso)) {
      throw new Error(`SCHEMA_VALIDATION_ERROR: Fecha de envío inválida '${sentAtIso}'`);
    }
    const existing = await this.getById(quoteId);
    if (!existing) {
      throw new Error("INVALID_STATE_TRANSITION: Presupuesto no encontrado");
    }
    if (existing.status === "rechazado") {
      throw new Error("INVALID_STATE_TRANSITION: No se puede marcar como enviado un presupuesto rechazado");
    }
    const nextStatus = existing.status === "borrador" ? "enviado" : existing.status;
    await this.executor.run(
      `UPDATE quotes SET status = ?, sent_at_iso = ?, updated_at_ms = ? WHERE id = ?`,
      [nextStatus, sentAtIso, Date.now(), quoteId]
    );
    const updated = await this.getById(quoteId);
    if (!updated) throw new Error("SQLITE_QUERY_ERROR: error actualizando presupuesto");
    return updated;
  }

  async acceptOrReject(
    quoteId: string,
    targetStatus: "aceptado" | "rechazado"
  ): Promise<QuoteRow> {
    const existing = await this.getById(quoteId);
    if (!existing) {
      throw new Error("INVALID_STATE_TRANSITION: Presupuesto no encontrado");
    }
    if (existing.status === "rechazado") {
      throw new Error(
        "INVALID_STATE_TRANSITION: Un presupuesto rechazado no puede cambiar de estado; crea uno nuevo"
      );
    }
    if (targetStatus === "rechazado") {
      const invRows = await this.executor.query<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM invoices WHERE quote_id = ?`,
        [quoteId]
      );
      if ((invRows[0]?.cnt ?? 0) > 0) {
        throw new Error(
          "INVALID_STATE_TRANSITION: Prohibido rechazar un presupuesto con facturas emitidas"
        );
      }
    }
    await this.executor.run(
      `UPDATE quotes SET status = ?, updated_at_ms = ? WHERE id = ?`,
      [targetStatus, Date.now(), quoteId]
    );
    const updated = await this.getById(quoteId);
    if (!updated) throw new Error("SQLITE_QUERY_ERROR: error actualizando estado de presupuesto");
    return updated;
  }

  async regeneratePdfOnDemand(
    quoteId: string,
    pdfPort: PdfPort,
    fileBridge: LocalFileBridge
  ): Promise<string> {
    const quote = await this.getById(quoteId);
    if (!quote) {
      throw new Error("INVALID_STATE_TRANSITION: Presupuesto no encontrado");
    }
    const items = await this.getItems(quoteId);
    const jobRows = await this.executor.query<JobRow>(
      `SELECT * FROM jobs WHERE id = ? LIMIT 1`,
      [quote.job_id]
    );
    const job = jobRows[0];
    if (!job) {
      throw new Error("SQLITE_QUERY_ERROR: Obra vinculada al presupuesto no encontrada");
    }
    const settingsRows = await this.executor.query<{
      emitter_name: string;
      emitter_nif: string;
      emitter_fiscal_address: string;
      emitter_phone: string;
      emitter_email?: string;
      emitter_iban?: string;
      emitter_bank_name?: string;
      emitter_logo_data_url?: string | null;
    }>(
      `SELECT emitter_name, emitter_nif, emitter_fiscal_address, emitter_phone,
              emitter_email, emitter_iban, emitter_bank_name, emitter_logo_data_url
       FROM app_settings WHERE id = 1`
    );
    const emitter = settingsRows[0] ?? {
      emitter_name: "",
      emitter_nif: "",
      emitter_fiscal_address: "",
      emitter_phone: "",
      emitter_email: "",
      emitter_iban: "",
      emitter_bank_name: "",
      emitter_logo_data_url: null,
    };

    const clientRows = quote.client_id
      ? await this.executor.query<ClientRow>(`SELECT * FROM clients WHERE id = ? LIMIT 1`, [
          quote.client_id,
        ])
      : [];
    const client = clientRows[0];

    const paymentMethods = parseQuotePaymentMethodsJson(quote.payment_methods_json);
    const paymentSchedule = parseQuotePaymentScheduleJson(quote.payment_schedule_json);
    const validityDays = quote.validity_days ?? null;
    const effectiveIban = (quote.iban_override ?? "").trim() || (emitter.emitter_iban ?? "").trim();
    const effectiveBankName =
      (quote.bank_name ?? "").trim() || (emitter.emitter_bank_name ?? "").trim();
    const showIban =
      quote.show_iban !== undefined ? quote.show_iban !== 0 : effectiveIban.length > 0;
    const attachments = parseQuoteAttachmentsJson(quote.attachments_json);
    const billingMode: BillingMode = quote.modalidad_cobro ?? job.modalidad_cobro ?? "solo_partidas";
    const laborSubMode: LaborOnlySubMode =
      quote.solo_mano_obra_submodo ?? job.solo_mano_obra_submodo ?? "por_horas";
    const laborHoursThousandths =
      quote.horas_estimadas_thousandths ?? job.horas_estimadas_thousandths ?? 0;
    const hourlyRateCents =
      quote.tarifa_hora_cents !== undefined
        ? quote.tarifa_hora_cents
        : (job.tarifa_hora_cents ?? null);
    const manoObraFijaCents = quote.mano_obra_fija_cents ?? job.mano_obra_fija_cents ?? 0;

    const computedTotals = computeQuoteTotalsByBillingMode({
      billingMode,
      laborSubMode,
      lines: items,
      vatRate: quote.vat_rate as QuoteVatRate,
      horasEstimadasThousandths: laborHoursThousandths,
      tarifaHoraCents: hourlyRateCents,
      manoObraFijaCents,
    });

    const pdfInput: PdfQuoteDocumentInput = {
      kind: "quote",
      quoteCode: quote.quote_code,
      issuedDateIso: formatLocalDateIso(quote.created_at_ms),
      validityDays,
      validUntilIso: computeQuoteValidUntilIso(quote.created_at_ms, validityDays),
      emitter: {
        name: emitter.emitter_name || "Autónomo",
        nif: emitter.emitter_nif,
        fiscalAddress: emitter.emitter_fiscal_address,
        phone: emitter.emitter_phone,
        email: emitter.emitter_email ?? "",
        iban: effectiveIban,
        bankName: effectiveBankName,
        logoDataUrl: emitter.emitter_logo_data_url ?? null,
      },
      client: {
        name: quote.client_name_snapshot || client?.name || "",
        nif: quote.client_nif_snapshot || client?.nif || "",
        fiscalAddress: quote.client_address_snapshot || client?.fiscal_address || "",
        phone: quote.client_phone_snapshot || client?.phone || "",
        email: client?.email ?? "",
      },
      jobTitle: job.title,
      generalDescription: quote.general_description ?? "",
      estimatedDurationValue: quote.estimated_duration_value ?? null,
      estimatedDurationUnit: quote.estimated_duration_unit ?? "dias_laborables",
      vatRate: quote.vat_rate,
      billingMode,
      laborSubMode,
      laborHoursThousandths,
      hourlyRateCents,
      laborCents: computedTotals.laborCents,
      itemsSubtotalCents: computedTotals.itemsSubtotalCents,
      subtotalCents: quote.subtotal_cents,
      vatCents: quote.vat_cents,
      totalCents: quote.total_cents,
      paymentMethods,
      paymentSchedule,
      paymentTermsText: quote.payment_terms_text ?? "",
      ibanOverride: quote.iban_override ?? "",
      bankName: effectiveBankName,
      showIban,
      notes: quote.notes,
      attachments,
      lines: items.map((item) => ({
        description: sanitizeQuoteItemDescription(item.description, {
          knownPricesCents: [item.unit_price_cents, item.line_subtotal_cents],
        }),
        unit: item.unit,
        quantityThousandths: item.quantity_thousandths,
        unitPriceCents: item.unit_price_cents,
        lineSubtotalCents: item.line_subtotal_cents,
      })),
    };

    const release = this.memoryCoordinator
      ? await this.memoryCoordinator.acquireHeavyTask("pdf")
      : async () => undefined;
    try {
      const { pdfBytes, fileName } = await pdfPort.buildDocumentPdf(pdfInput);
      const pdfUri = await fileBridge.savePdf(pdfBytes, fileName);
      await this.executor.run(`UPDATE quotes SET pdf_uri = ?, updated_at_ms = ? WHERE id = ?`, [
        pdfUri,
        Date.now(),
        quoteId,
      ]);
      return pdfUri;
    } finally {
      await release();
    }
  }

  async assignClient(
    quoteId: string,
    clientId: string,
    opts?: { pdfPort?: PdfPort; fileBridge?: LocalFileBridge }
  ): Promise<QuoteRow> {
    const hadPdf = Boolean((await this.getById(quoteId))?.pdf_uri);
    await this.executor.inTransaction(async (tx) => {
      const qRows = await tx.query<QuoteRow>(`SELECT * FROM quotes WHERE id = ? LIMIT 1`, [
        quoteId,
      ]);
      const quote = qRows[0];
      if (!quote) {
        throw new Error("INVALID_STATE_TRANSITION: Presupuesto no encontrado");
      }
      const cRows = await tx.query<ClientRow>(`SELECT * FROM clients WHERE id = ? LIMIT 1`, [
        clientId,
      ]);
      const client = cRows[0];
      if (!client) {
        throw new Error("SCHEMA_VALIDATION_ERROR: Cliente seleccionado no encontrado");
      }
      const now = Date.now();
      await tx.run(
        `UPDATE quotes
         SET client_id = ?,
             client_name_snapshot = ?,
             client_nif_snapshot = ?,
             client_address_snapshot = ?,
             client_phone_snapshot = ?,
             updated_at_ms = ?
         WHERE id = ?`,
        [
          client.id,
          client.name,
          client.nif,
          client.fiscal_address,
          client.phone,
          now,
          quoteId,
        ]
      );
      await tx.run(
        `UPDATE jobs SET client_id = ?, updated_at_ms = ? WHERE id = ? AND client_id IS NULL`,
        [client.id, now, quote.job_id]
      );
    });

    if (hadPdf && opts?.pdfPort && opts?.fileBridge) {
      await this.regeneratePdfOnDemand(quoteId, opts.pdfPort, opts.fileBridge);
    }

    const updated = await this.getById(quoteId);
    if (!updated) {
      throw new Error("SQLITE_QUERY_ERROR: Error al recargar presupuesto tras asignar cliente");
    }
    return updated;
  }

  async delete(id: string, fileBridge: LocalFileBridge): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) return;

    await this.executor.inTransaction(async (tx) => {
      const linkedInvoices = await tx.query<{ invoice_number: string }>(
        `SELECT invoice_number FROM invoices WHERE quote_id = ? ORDER BY invoice_number ASC`,
        [id]
      );
      if (linkedInvoices.length > 0) {
        throw new Error(
          `INVALID_STATE_TRANSITION: No se puede eliminar el presupuesto porque tiene factura(s) emitida(s) (${linkedInvoices.map((i) => i.invoice_number).join(", ")}). Elimina primero las facturas asociadas.`
        );
      }

      await tx.run(
        `UPDATE recovered_drafts SET active_quote_id = NULL WHERE active_quote_id = ?`,
        [id]
      );
      await tx.run(`DELETE FROM quotes WHERE id = ?`, [id]);

      const match = /^PRE-(\d{4})-\d+$/.exec(existing.quote_code);
      if (match) {
        await rewindSequenceIfLatest(tx, "PRE", Number(match[1]), existing.quote_code, Date.now());
      }
    });

    await fileBridge.deletePdf(existing.pdf_uri);
  }
}
