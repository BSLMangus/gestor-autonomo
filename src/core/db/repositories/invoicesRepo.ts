import { deriveFiscalQuarter, getLocalTodayIso, isValidIsoDate } from "../../fiscal/dateQuarter";
import type { PdfInvoiceDocumentInput, PdfPort } from "../../ports/mediaPorts";
import { deriveInvoiceAdvancePercent } from "../../fiscal/fiscalEngine";
import type {
  InvoiceRow,
  JobRow,
  LocalFileBridge,
  MemoryCoordinator,
  QuoteRow,
  SqliteExecutor,
} from "../../contracts/types";
import { rewindSequenceIfLatest } from "./settingsRepo";

export class InvoicesRepository {
  constructor(
    private readonly executor: SqliteExecutor,
    private readonly memoryCoordinator?: MemoryCoordinator
  ) {}

  async syncOverdueOnRead(localTodayIso = getLocalTodayIso()): Promise<void> {
    if (!isValidIsoDate(localTodayIso)) {
      throw new Error(`SCHEMA_VALIDATION_ERROR: Fecha local inválida '${localTodayIso}'`);
    }
    await this.executor.run(
      `UPDATE invoices
       SET status = 'vencido', updated_at_ms = ?
       WHERE status = 'pendiente_cobro' AND due_at_iso < ?`,
      [Date.now(), localTodayIso]
    );
  }

  async getById(id: string): Promise<InvoiceRow | null> {
    await this.syncOverdueOnRead();
    const rows = await this.executor.query<InvoiceRow>(
      `SELECT * FROM invoices WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows[0] ?? null;
  }

  async listByJobId(jobId: string): Promise<InvoiceRow[]> {
    await this.syncOverdueOnRead();
    return this.executor.query<InvoiceRow>(
      `SELECT * FROM invoices WHERE job_id = ? ORDER BY issued_at_iso ASC, created_at_ms ASC`,
      [jobId]
    );
  }

  async listByQuarter(quarter: string): Promise<InvoiceRow[]> {
    await this.syncOverdueOnRead();
    return this.executor.query<InvoiceRow>(
      `SELECT * FROM invoices WHERE quarter = ? ORDER BY issued_at_iso DESC, created_at_ms DESC`,
      [quarter]
    );
  }

  async listAll(): Promise<InvoiceRow[]> {
    await this.syncOverdueOnRead();
    return this.listAllWithoutSync();
  }

  async listAllWithoutSync(): Promise<InvoiceRow[]> {
    return this.executor.query<InvoiceRow>(
      `SELECT * FROM invoices ORDER BY issued_at_iso DESC, created_at_ms DESC`
    );
  }

  async markPaid(invoiceId: string, paidAtIso: string | null): Promise<InvoiceRow> {
    const existing = await this.getById(invoiceId);
    if (!existing) {
      throw new Error("INVALID_STATE_TRANSITION: Factura no encontrada");
    }
    const now = Date.now();
    if (paidAtIso !== null) {
      if (!isValidIsoDate(paidAtIso)) {
        throw new Error(`SCHEMA_VALIDATION_ERROR: Fecha de cobro inválida '${paidAtIso}'`);
      }
      const paidQuarter = deriveFiscalQuarter(paidAtIso);
      await this.executor.run(
        `UPDATE invoices
         SET status = 'pagado', paid_at_iso = ?, paid_quarter = ?, updated_at_ms = ?
         WHERE id = ?`,
        [paidAtIso, paidQuarter, now, invoiceId]
      );
    } else {
      const todayIso = getLocalTodayIso();
      const revertedStatus = existing.due_at_iso < todayIso ? "vencido" : "pendiente_cobro";
      await this.executor.run(
        `UPDATE invoices
         SET status = ?, paid_at_iso = NULL, paid_quarter = NULL, updated_at_ms = ?
         WHERE id = ?`,
        [revertedStatus, now, invoiceId]
      );
    }
    const updated = await this.getById(invoiceId);
    if (!updated) throw new Error("SQLITE_QUERY_ERROR: error actualizando cobro de factura");
    return updated;
  }

  async markSentManually(invoiceId: string, sentAtIso = getLocalTodayIso()): Promise<InvoiceRow> {
    if (!isValidIsoDate(sentAtIso)) {
      throw new Error(`SCHEMA_VALIDATION_ERROR: Fecha de envío inválida '${sentAtIso}'`);
    }
    const existing = await this.getById(invoiceId);
    if (!existing) {
      throw new Error("INVALID_STATE_TRANSITION: Factura no encontrada");
    }
    await this.executor.run(
      `UPDATE invoices SET sent_at_iso = ?, updated_at_ms = ? WHERE id = ?`,
      [sentAtIso, Date.now(), invoiceId]
    );
    const updated = await this.getById(invoiceId);
    if (!updated) throw new Error("SQLITE_QUERY_ERROR: error actualizando sent_at_iso");
    return updated;
  }

  async regeneratePdfOnDemand(
    invoiceId: string,
    pdfPort: PdfPort,
    fileBridge: LocalFileBridge
  ): Promise<string> {
    const invoice = await this.getById(invoiceId);
    if (!invoice) {
      throw new Error("INVALID_STATE_TRANSITION: Factura no encontrada");
    }
    const jobRows = await this.executor.query<JobRow>(
      `SELECT * FROM jobs WHERE id = ? LIMIT 1`,
      [invoice.job_id]
    );
    const job = jobRows[0];
    const quoteRows = await this.executor.query<QuoteRow>(
      `SELECT * FROM quotes WHERE id = ? LIMIT 1`,
      [invoice.quote_id]
    );
    const quote = quoteRows[0];
    const settingsRows = await this.executor.query<{
      emitter_phone: string;
      emitter_iban?: string;
      emitter_logo_data_url?: string | null;
    }>(`SELECT emitter_phone, emitter_iban, emitter_logo_data_url FROM app_settings WHERE id = 1`);
    const emitterPhone = settingsRows[0]?.emitter_phone ?? "";
    const emitterIban = settingsRows[0]?.emitter_iban ?? "";
    const emitterLogoDataUrl = settingsRows[0]?.emitter_logo_data_url ?? null;

    const pdfInput: PdfInvoiceDocumentInput = {
      kind: "invoice",
      invoiceNumber: invoice.invoice_number,
      invoiceKind: invoice.kind,
      advancePercent: deriveInvoiceAdvancePercent(invoice, quote),
      issuedAtIso: invoice.issued_at_iso,
      dueAtIso: invoice.due_at_iso,
      emitter: {
        name: invoice.emitter_name_snapshot,
        nif: invoice.emitter_nif_snapshot,
        fiscalAddress: invoice.emitter_address_snapshot,
        phone: emitterPhone,
        iban: emitterIban,
        logoDataUrl: emitterLogoDataUrl,
      },
      client: {
        name: invoice.client_name_snapshot,
        nif: invoice.client_nif_snapshot,
        fiscalAddress: invoice.client_address_snapshot,
        phone: invoice.client_phone_snapshot,
      },
      jobCode: job?.job_code ?? "",
      jobTitle: job?.title ?? "",
      quoteCode: quote?.quote_code ?? "",
      vatRate: invoice.vat_rate,
      baseCents: invoice.base_cents,
      vatCents: invoice.vat_cents,
      totalCents: invoice.total_cents,
      advanceDeductedBaseCents: invoice.advance_deducted_base_cents,
      advanceDeductedVatCents: invoice.advance_deducted_vat_cents,
      notes: invoice.notes,
    };

    const release = this.memoryCoordinator
      ? await this.memoryCoordinator.acquireHeavyTask("pdf")
      : async () => undefined;
    try {
      const { pdfBytes, fileName } = await pdfPort.buildDocumentPdf(pdfInput);
      const pdfUri = await fileBridge.savePdf(pdfBytes, fileName);
      await this.executor.run(`UPDATE invoices SET pdf_uri = ?, updated_at_ms = ? WHERE id = ?`, [
        pdfUri,
        Date.now(),
        invoiceId,
      ]);
      return pdfUri;
    } finally {
      await release();
    }
  }

  async delete(id: string, fileBridge: LocalFileBridge): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) return;

    await this.executor.inTransaction(async (tx) => {
      const dependentFinals = await tx.query<{ invoice_number: string }>(
        `SELECT invoice_number FROM invoices WHERE advance_invoice_id = ? ORDER BY invoice_number ASC`,
        [id]
      );
      if (dependentFinals.length > 0) {
        throw new Error(
          `INVALID_STATE_TRANSITION: No se puede eliminar este anticipo porque está descontado en la factura final (${dependentFinals.map((i) => i.invoice_number).join(", ")}). Elimina primero la factura final.`
        );
      }

      await tx.run(`DELETE FROM invoices WHERE id = ?`, [id]);
      await rewindSequenceIfLatest(
        tx,
        existing.series_type,
        existing.fiscal_year,
        existing.invoice_number,
        Date.now()
      );
    });

    await fileBridge.deletePdf(existing.pdf_uri);
  }
}
