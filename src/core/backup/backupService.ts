import {
  SymmetricBackupEnvelopeSchema,
  SymmetricBackupPlaintextSchema,
} from "../contracts/schemas";
import type {
  ActaRow,
  CatalogItemRow,
  ClientRow,
  ExpenseTicketRow,
  FeedbackCorrectionRow,
  InvoiceRow,
  JobRow,
  QuoteItemRow,
  QuoteRow,
  ScheduleEntryRow,
  SequenceRow,
  SiteLogRow,
  SqliteExecutor,
  SymmetricBackupEnvelope,
  SymmetricBackupPlaintext,
  TaxAlertDismissalRow,
  TaxObligationStateRow,
} from "../contracts/types";
import { CheckpointsRepository } from "../db/repositories/checkpointsRepo";
import { ScheduleRepository } from "../db/repositories/scheduleRepo";
import { SettingsRepository } from "../db/repositories/settingsRepo";

const PBKDF2_ITERATIONS = 210000;

function uint8ToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    parts.push(String.fromCharCode(...slice));
  }
  return btoa(parts.join(""));
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

async function deriveAesKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("SCHEMA_VALIDATION_ERROR: WebCrypto SubtleCrypto no disponible");
  }
  const keyMaterial = await subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: new Uint8Array(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function purgeDomainAndCheckpointsInTx(
  tx: Pick<SqliteExecutor, "query" | "run">,
  checkpointsRepo: CheckpointsRepository
): Promise<void> {
  await tx.run(`DELETE FROM chat_messages`);
  await tx.run(`DELETE FROM chat_threads`);
  await tx.run(`DELETE FROM recovered_drafts`);
  await tx.run(`DELETE FROM agent_traces`);
  await checkpointsRepo.purgeAllCheckpoints(tx);
  await tx.run(`DELETE FROM feedback_corrections`);
  await tx.run(`DELETE FROM site_logs`);
  await tx.run(`DELETE FROM schedule_entries`);
  await tx.run(`DELETE FROM work_schedule_defaults`);
  await tx.run(`DELETE FROM tax_alert_dismissals`);
  await tx.run(`DELETE FROM tax_obligation_states`);
  await tx.run(`DELETE FROM actas_puesta_en_marcha`);
  await tx.run(`DELETE FROM expense_tickets`);
  await tx.run(`DELETE FROM quote_items`);
  await tx.run(`DELETE FROM invoices`);
  await tx.run(`DELETE FROM quotes`);
  await tx.run(`DELETE FROM jobs`);
  await tx.run(`DELETE FROM clients`);
  await tx.run(`DELETE FROM catalog_items`);
  await tx.run(`DELETE FROM sequences`);
}

export class BackupService {
  private readonly checkpointsRepo: CheckpointsRepository;
  private readonly settingsRepo: SettingsRepository;
  private readonly scheduleRepo: ScheduleRepository;

  constructor(private readonly executor: SqliteExecutor) {
    this.checkpointsRepo = new CheckpointsRepository(executor);
    this.settingsRepo = new SettingsRepository(executor);
    this.scheduleRepo = new ScheduleRepository(executor);
  }

  async exportBackupJson(password?: string): Promise<SymmetricBackupEnvelope> {
    const settings = await this.settingsRepo.getAppSettings();
    const sequences = await this.executor.query<SequenceRow>(`SELECT * FROM sequences`);
    const clients = await this.executor.query<ClientRow>(`SELECT * FROM clients`);
    const catalogItems = await this.executor.query<CatalogItemRow>(`SELECT * FROM catalog_items`);
    const jobs = await this.executor.query<JobRow>(`SELECT * FROM jobs`);
    const quotes = await this.executor.query<QuoteRow>(`SELECT * FROM quotes`);
    const quoteItems = await this.executor.query<QuoteItemRow>(`SELECT * FROM quote_items`);
    const invoices = await this.executor.query<InvoiceRow>(
      `SELECT * FROM invoices ORDER BY created_at_ms ASC`
    );
    const expenseTickets = await this.executor.query<ExpenseTicketRow>(
      `SELECT * FROM expense_tickets`
    );
    const siteLogs = await this.executor.query<SiteLogRow>(`SELECT * FROM site_logs`);
    const feedbackCorrections = await this.executor.query<FeedbackCorrectionRow>(
      `SELECT * FROM feedback_corrections`
    );
    const workScheduleDefaults = await this.scheduleRepo.getWorkScheduleDefaults();
    const scheduleEntries = await this.scheduleRepo.listAllEntries();
    const taxObligationStates = await this.executor.query<TaxObligationStateRow>(
      `SELECT * FROM tax_obligation_states`
    );
    const taxAlertDismissals = await this.executor.query<TaxAlertDismissalRow>(
      `SELECT * FROM tax_alert_dismissals`
    );
    const actasPuestaEnMarcha = await this.executor.query<ActaRow>(
      `SELECT * FROM actas_puesta_en_marcha ORDER BY created_at_ms ASC`
    );

    const plaintext: SymmetricBackupPlaintext = SymmetricBackupPlaintextSchema.parse({
      app_settings_emitter: {
        emitter_name: settings.emitter_name,
        emitter_nif: settings.emitter_nif,
        emitter_fiscal_address: settings.emitter_fiscal_address,
        emitter_phone: settings.emitter_phone,
        emitter_iban: settings.emitter_iban,
        emitter_bank_name: settings.emitter_bank_name,
        emitter_email: settings.emitter_email,
        emitter_logo_data_url: settings.emitter_logo_data_url,
      },
      app_settings_installer_acta: {
        emitter_email: settings.emitter_email,
        emitter_registry_number: settings.emitter_registry_number,
        emitter_tech_name: settings.emitter_tech_name,
        emitter_tech_dni: settings.emitter_tech_dni,
        emitter_installer_card: settings.emitter_installer_card,
        default_acta_warranty_months: settings.default_acta_warranty_months,
        emitter_signature_data_url: settings.emitter_signature_data_url,
      },
      app_settings_tax: {
        default_vat_rate: settings.default_vat_rate,
        irpf_reserve_rate: settings.irpf_reserve_rate,
      },
      app_settings_pricing: {
        hourly_rate_cents: settings.hourly_rate_cents,
      },
      app_settings_quote_defaults: {
        default_quote_validity_days: settings.default_quote_validity_days,
        default_payment_methods: settings.default_payment_methods,
        default_payment_schedule: settings.default_payment_schedule,
      },
      app_settings_tax_models: settings.active_tax_models,
      work_schedule_defaults: workScheduleDefaults,
      sequences,
      clients,
      catalog_items: catalogItems,
      jobs,
      quotes,
      quote_items: quoteItems,
      invoices,
      expense_tickets: expenseTickets,
      site_logs: siteLogs,
      feedback_corrections: feedbackCorrections,
      schedule_entries: scheduleEntries,
      tax_obligation_states: taxObligationStates,
      tax_alert_dismissals: taxAlertDismissals,
      actas_puesta_en_marcha: actasPuestaEnMarcha,
    });

    const trimmedPass = password?.trim() ?? "";
    if (trimmedPass.length === 0) {
      return SymmetricBackupEnvelopeSchema.parse({
        version: "1.0.0",
        format: "obralocal-backup-v1",
        encrypted: false,
        kdf: null,
        cipher: null,
        iterations: null,
        salt_b64: null,
        iv_b64: null,
        payload: plaintext,
      });
    }

    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveAesKey(trimmedPass, salt);
    const encoded = new TextEncoder().encode(JSON.stringify(plaintext));
    const cipherBuf = await globalThis.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: new Uint8Array(iv) },
      key,
      encoded
    );

    return SymmetricBackupEnvelopeSchema.parse({
      version: "1.0.0",
      format: "obralocal-backup-v1",
      encrypted: true,
      kdf: "PBKDF2-SHA256",
      cipher: "AES-256-GCM",
      iterations: PBKDF2_ITERATIONS,
      salt_b64: uint8ToBase64(salt),
      iv_b64: uint8ToBase64(iv),
      ciphertext_b64: uint8ToBase64(new Uint8Array(cipherBuf)),
    });
  }

  async importBackupJson(
    envelopeOrRaw: SymmetricBackupEnvelope | string,
    password?: string
  ): Promise<{ ok: true; restoredCounts: Record<string, number> }> {
    let rawObj: unknown = envelopeOrRaw;
    if (typeof envelopeOrRaw === "string") {
      try {
        rawObj = JSON.parse(envelopeOrRaw);
      } catch {
        throw new Error("SCHEMA_VALIDATION_ERROR: El archivo de respaldo no es JSON válido");
      }
    }

    const envelope = SymmetricBackupEnvelopeSchema.parse(rawObj);
    let plaintext: SymmetricBackupPlaintext;

    if (!envelope.encrypted) {
      plaintext = SymmetricBackupPlaintextSchema.parse(envelope.payload);
    } else {
      const trimmedPass = password?.trim() ?? "";
      if (!trimmedPass) {
        throw new Error("SCHEMA_VALIDATION_ERROR: Se requiere contraseña para descifrar el respaldo");
      }
      try {
        const salt = base64ToUint8(envelope.salt_b64);
        const iv = base64ToUint8(envelope.iv_b64);
        const ciphertext = base64ToUint8(envelope.ciphertext_b64);
        const key = await deriveAesKey(trimmedPass, salt);
        const plainBuf = await globalThis.crypto.subtle.decrypt(
          { name: "AES-GCM", iv: new Uint8Array(iv) },
          key,
          new Uint8Array(ciphertext)
        );
        const decoded = new TextDecoder().decode(plainBuf);
        plaintext = SymmetricBackupPlaintextSchema.parse(JSON.parse(decoded));
      } catch (err) {
        throw new Error(
          `SCHEMA_VALIDATION_ERROR: No se pudo descifrar el respaldo (contraseña incorrecta o archivo corrupto): ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    const now = Date.now();
    await this.executor.inTransaction(async (tx) => {
      await purgeDomainAndCheckpointsInTx(tx, this.checkpointsRepo);

      await tx.run(
        `INSERT INTO app_settings (
          id, emitter_name, emitter_nif, emitter_fiscal_address, emitter_phone,
          emitter_iban, emitter_bank_name, emitter_logo_data_url,
          last_active_thread_id, pending_camera_context_json, llm_enabled, llm_model_uri,
          default_vat_rate, irpf_reserve_rate, hourly_rate_cents, boot_mode,
          default_quote_validity_days, default_payment_methods_json, default_payment_schedule_json, active_tax_models_json,
          emitter_email, emitter_registry_number, emitter_tech_name, emitter_tech_dni,
          emitter_installer_card, emitter_signature_data_url, default_acta_warranty_months,
          updated_at_ms
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 1, NULL, ?, ?, ?, 'clean', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          emitter_name = excluded.emitter_name,
          emitter_nif = excluded.emitter_nif,
          emitter_fiscal_address = excluded.emitter_fiscal_address,
          emitter_phone = excluded.emitter_phone,
          emitter_iban = excluded.emitter_iban,
          emitter_bank_name = excluded.emitter_bank_name,
          emitter_logo_data_url = excluded.emitter_logo_data_url,
          last_active_thread_id = NULL,
          pending_camera_context_json = NULL,
          llm_enabled = 1,
          llm_model_uri = NULL,
          default_vat_rate = excluded.default_vat_rate,
          irpf_reserve_rate = excluded.irpf_reserve_rate,
          hourly_rate_cents = excluded.hourly_rate_cents,
          boot_mode = 'clean',
          default_quote_validity_days = excluded.default_quote_validity_days,
          default_payment_methods_json = excluded.default_payment_methods_json,
          default_payment_schedule_json = excluded.default_payment_schedule_json,
          active_tax_models_json = excluded.active_tax_models_json,
          emitter_email = excluded.emitter_email,
          emitter_registry_number = excluded.emitter_registry_number,
          emitter_tech_name = excluded.emitter_tech_name,
          emitter_tech_dni = excluded.emitter_tech_dni,
          emitter_installer_card = excluded.emitter_installer_card,
          emitter_signature_data_url = excluded.emitter_signature_data_url,
          default_acta_warranty_months = excluded.default_acta_warranty_months,
          updated_at_ms = excluded.updated_at_ms`,
        [
          plaintext.app_settings_emitter.emitter_name,
          plaintext.app_settings_emitter.emitter_nif,
          plaintext.app_settings_emitter.emitter_fiscal_address,
          plaintext.app_settings_emitter.emitter_phone,
          plaintext.app_settings_emitter.emitter_iban ?? "",
          plaintext.app_settings_emitter.emitter_bank_name ?? "",
          plaintext.app_settings_emitter.emitter_logo_data_url ?? null,
          plaintext.app_settings_tax?.default_vat_rate ?? 21,
          plaintext.app_settings_tax?.irpf_reserve_rate ?? 20,
          plaintext.app_settings_pricing?.hourly_rate_cents ?? 3800,
          plaintext.app_settings_quote_defaults?.default_quote_validity_days ?? 30,
          JSON.stringify(
            plaintext.app_settings_quote_defaults?.default_payment_methods ?? ["transferencia"]
          ),
          JSON.stringify(plaintext.app_settings_quote_defaults?.default_payment_schedule ?? []),
          JSON.stringify(plaintext.app_settings_tax_models ?? ["303", "130", "390", "347", "100"]),
          plaintext.app_settings_emitter.emitter_email ||
            plaintext.app_settings_installer_acta?.emitter_email ||
            "",
          plaintext.app_settings_installer_acta?.emitter_registry_number ?? "",
          plaintext.app_settings_installer_acta?.emitter_tech_name ?? "",
          plaintext.app_settings_installer_acta?.emitter_tech_dni ?? "",
          plaintext.app_settings_installer_acta?.emitter_installer_card ?? "",
          plaintext.app_settings_installer_acta?.emitter_signature_data_url ?? null,
          plaintext.app_settings_installer_acta?.default_acta_warranty_months ?? 24,
          now,
        ]
      );

      for (const s of plaintext.sequences) {
        await tx.run(
          `INSERT INTO sequences (series_type, fiscal_year, last_seq, updated_at_ms)
           VALUES (?, ?, ?, ?)`,
          [s.series_type, s.fiscal_year, s.last_seq, s.updated_at_ms]
        );
      }

      for (const c of plaintext.clients) {
        await tx.run(
          `INSERT INTO clients (
            id, name, nif, fiscal_address, phone, email, notes, created_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            c.id,
            c.name,
            c.nif,
            c.fiscal_address,
            c.phone,
            c.email,
            c.notes,
            c.created_at_ms,
            c.updated_at_ms,
          ]
        );
      }

      for (const ci of plaintext.catalog_items) {
        await tx.run(
          `INSERT INTO catalog_items (
            id, description, category, unit, unit_price_cents, pricing_mode,
            estimated_hours_thousandths, materials_cents, default_vat_rate,
            active, created_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            ci.id,
            ci.description,
            ci.category,
            ci.unit,
            ci.unit_price_cents,
            ci.pricing_mode ?? "fixed",
            ci.estimated_hours_thousandths ?? 0,
            ci.materials_cents ?? 0,
            ci.default_vat_rate,
            ci.active,
            ci.created_at_ms,
            ci.updated_at_ms,
          ]
        );
      }

      for (const j of plaintext.jobs) {
        await tx.run(
          `INSERT INTO jobs (
            id, job_code, client_id, title, address, status,
            start_date_iso, end_date_iso,
            modalidad_cobro, solo_mano_obra_submodo, horas_estimadas_thousandths,
            tarifa_hora_cents, mano_obra_fija_cents,
            created_at_iso, created_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            j.id,
            j.job_code,
            j.client_id,
            j.title,
            j.address,
            j.status,
            j.start_date_iso ?? null,
            j.end_date_iso ?? null,
            j.modalidad_cobro ?? "solo_partidas",
            j.solo_mano_obra_submodo ?? "por_horas",
            j.horas_estimadas_thousandths ?? 0,
            j.tarifa_hora_cents ?? null,
            j.mano_obra_fija_cents ?? 0,
            j.created_at_iso,
            j.created_at_ms,
            j.updated_at_ms,
          ]
        );
      }

      for (const q of plaintext.quotes) {
        await tx.run(
          `INSERT INTO quotes (
            id, quote_code, job_id, client_id, client_name_snapshot, client_nif_snapshot,
            client_address_snapshot, client_phone_snapshot, vat_rate, subtotal_cents,
            vat_cents, total_cents, status, general_description, estimated_duration_value,
            estimated_duration_unit, validity_days, payment_methods_json,
            payment_schedule_json, payment_terms_text, iban_override, bank_name,
            show_iban, notes, attachments_json, pdf_uri, sent_at_iso,
            modalidad_cobro, solo_mano_obra_submodo, horas_estimadas_thousandths,
            tarifa_hora_cents, mano_obra_fija_cents,
            created_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            q.id,
            q.quote_code,
            q.job_id,
            q.client_id,
            q.client_name_snapshot,
            q.client_nif_snapshot,
            q.client_address_snapshot,
            q.client_phone_snapshot,
            q.vat_rate,
            q.subtotal_cents,
            q.vat_cents,
            q.total_cents,
            q.status,
            q.general_description ?? "",
            q.estimated_duration_value ?? null,
            q.estimated_duration_unit ?? "dias_laborables",
            q.validity_days ?? null,
            q.payment_methods_json ?? "[]",
            q.payment_schedule_json ?? "[]",
            q.payment_terms_text ?? "",
            q.iban_override ?? "",
            q.bank_name ?? "",
            q.show_iban ?? 1,
            q.notes,
            q.attachments_json ?? "[]",
            q.pdf_uri,
            q.sent_at_iso,
            q.modalidad_cobro ?? "solo_partidas",
            q.solo_mano_obra_submodo ?? "por_horas",
            q.horas_estimadas_thousandths ?? 0,
            q.tarifa_hora_cents ?? null,
            q.mano_obra_fija_cents ?? 0,
            q.created_at_ms,
            q.updated_at_ms,
          ]
        );
      }

      for (const qi of plaintext.quote_items) {
        await tx.run(
          `INSERT INTO quote_items (
            id, quote_id, line_order, catalog_item_id, description, category,
            unit, quantity_thousandths, unit_price_cents, line_subtotal_cents
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            qi.id,
            qi.quote_id,
            qi.line_order,
            qi.catalog_item_id,
            qi.description,
            qi.category,
            qi.unit,
            qi.quantity_thousandths,
            qi.unit_price_cents,
            qi.line_subtotal_cents,
          ]
        );
      }

      for (const inv of plaintext.invoices) {
        await tx.run(
          `INSERT INTO invoices (
            id, invoice_number, series_type, fiscal_year, kind, job_id, quote_id, client_id,
            emitter_nif_snapshot, emitter_name_snapshot, emitter_address_snapshot,
            client_name_snapshot, client_nif_snapshot, client_address_snapshot,
            client_phone_snapshot, issued_at_iso, due_at_iso, quarter,
            paid_at_iso, paid_quarter, sent_at_iso, vat_rate, base_cents, vat_cents,
            total_cents, advance_deducted_base_cents, advance_deducted_vat_cents,
            advance_invoice_id, status, notes, pdf_uri, created_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            inv.id,
            inv.invoice_number,
            inv.series_type,
            inv.fiscal_year,
            inv.kind,
            inv.job_id,
            inv.quote_id,
            inv.client_id,
            inv.emitter_nif_snapshot,
            inv.emitter_name_snapshot,
            inv.emitter_address_snapshot,
            inv.client_name_snapshot,
            inv.client_nif_snapshot,
            inv.client_address_snapshot,
            inv.client_phone_snapshot,
            inv.issued_at_iso,
            inv.due_at_iso,
            inv.quarter,
            inv.paid_at_iso,
            inv.paid_quarter,
            inv.sent_at_iso,
            inv.vat_rate,
            inv.base_cents,
            inv.vat_cents,
            inv.total_cents,
            inv.advance_deducted_base_cents,
            inv.advance_deducted_vat_cents,
            inv.advance_invoice_id,
            inv.status,
            inv.notes,
            inv.pdf_uri,
            inv.created_at_ms,
            inv.updated_at_ms,
          ]
        );
      }

      for (const tkt of plaintext.expense_tickets) {
        await tx.run(
          `INSERT INTO expense_tickets (
            id, job_id, supplier_name, supplier_nif, issue_date_iso, quarter,
            category, vat_rate_label, base_cents, vat_cents, total_cents,
            ocr_confidence, image_uri, created_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            tkt.id,
            tkt.job_id,
            tkt.supplier_name,
            tkt.supplier_nif,
            tkt.issue_date_iso,
            tkt.quarter,
            tkt.category,
            tkt.vat_rate_label,
            tkt.base_cents,
            tkt.vat_cents,
            tkt.total_cents,
            tkt.ocr_confidence,
            tkt.image_uri,
            tkt.created_at_ms,
            tkt.updated_at_ms,
          ]
        );
      }

      for (const sl of plaintext.site_logs) {
        await tx.run(
          `INSERT INTO site_logs (
            id, job_id, category, note_text, photo_uri,
            stamp_job_code, stamp_client_name, created_at_iso, created_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            sl.id,
            sl.job_id,
            sl.category,
            sl.note_text,
            sl.photo_uri,
            sl.stamp_job_code,
            sl.stamp_client_name,
            sl.created_at_iso,
            sl.created_at_ms,
          ]
        );
      }

      for (const fb of plaintext.feedback_corrections) {
        await tx.run(
          `INSERT INTO feedback_corrections (
            id, catalog_item_id, quote_id, old_unit_price_cents, new_unit_price_cents, created_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?)`,
          [
            fb.id,
            fb.catalog_item_id,
            fb.quote_id,
            fb.old_unit_price_cents,
            fb.new_unit_price_cents,
            fb.created_at_ms,
          ]
        );
      }

      if (plaintext.work_schedule_defaults) {
        const wd = plaintext.work_schedule_defaults;
        await tx.run(
          `INSERT INTO work_schedule_defaults (
            id, work_days_json, morning_start, morning_end, afternoon_start, afternoon_end,
            auto_apply_to_jobs, updated_at_ms
          ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            work_days_json = excluded.work_days_json,
            morning_start = excluded.morning_start,
            morning_end = excluded.morning_end,
            afternoon_start = excluded.afternoon_start,
            afternoon_end = excluded.afternoon_end,
            auto_apply_to_jobs = excluded.auto_apply_to_jobs,
            updated_at_ms = excluded.updated_at_ms`,
          [
            JSON.stringify(wd.work_days),
            wd.morning_start,
            wd.morning_end,
            wd.afternoon_start,
            wd.afternoon_end,
            wd.auto_apply_to_jobs ? 1 : 0,
            wd.updated_at_ms ?? now,
          ]
        );
      }

      for (const se of (plaintext.schedule_entries ?? []) as ScheduleEntryRow[]) {
        await tx.run(
          `INSERT INTO schedule_entries (
            id, job_id, date_iso, planned_start, planned_end, planned_hours_thousandths,
            actual_start, actual_end, actual_hours_thousandths, status, deviation_reason,
            notes, created_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            se.id,
            se.job_id,
            se.date_iso,
            se.planned_start,
            se.planned_end,
            se.planned_hours_thousandths,
            se.actual_start,
            se.actual_end,
            se.actual_hours_thousandths,
            se.status,
            se.deviation_reason,
            se.notes,
            se.created_at_ms,
            se.updated_at_ms,
          ]
        );
      }

      for (const st of plaintext.tax_obligation_states ?? []) {
        await tx.run(
          `INSERT INTO tax_obligation_states (
            obligation_key, model_code, fiscal_year, period_code, status,
            presented_at_iso, notes, updated_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            st.obligation_key,
            st.model_code,
            st.fiscal_year,
            st.period_code,
            st.status,
            st.presented_at_iso,
            st.notes,
            st.updated_at_ms,
          ]
        );
      }

      for (const d of plaintext.tax_alert_dismissals ?? []) {
        await tx.run(
          `INSERT INTO tax_alert_dismissals (alert_key, dismissed_at_ms) VALUES (?, ?)`,
          [d.alert_key, d.dismissed_at_ms]
        );
      }

      for (const act of plaintext.actas_puesta_en_marcha ?? []) {
        await tx.run(
          `INSERT INTO actas_puesta_en_marcha (
            id, codigo_acta, job_id, quote_id, client_id, especialidad, tipo_actuacion,
            estado, fecha_emision_iso, datos_json, firma_cliente_base64,
            firma_instalador_base64, pdf_uri, created_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            act.id,
            act.codigo_acta,
            act.job_id,
            act.quote_id,
            act.client_id,
            act.especialidad,
            act.tipo_actuacion,
            act.estado,
            act.fecha_emision_iso,
            act.datos_json,
            act.firma_cliente_base64,
            act.firma_instalador_base64,
            act.pdf_uri,
            act.created_at_ms,
            act.updated_at_ms,
          ]
        );
      }
    });

    return {
      ok: true,
      restoredCounts: {
        sequences: plaintext.sequences.length,
        clients: plaintext.clients.length,
        catalog_items: plaintext.catalog_items.length,
        jobs: plaintext.jobs.length,
        quotes: plaintext.quotes.length,
        quote_items: plaintext.quote_items.length,
        invoices: plaintext.invoices.length,
        expense_tickets: plaintext.expense_tickets.length,
        site_logs: plaintext.site_logs.length,
        feedback_corrections: plaintext.feedback_corrections.length,
        schedule_entries: plaintext.schedule_entries?.length ?? 0,
        actas_puesta_en_marcha: plaintext.actas_puesta_en_marcha?.length ?? 0,
      },
    };
  }
}
