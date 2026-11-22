import contractsAndSeed from "../../../docs/03_CONTRATOS_API_Y_SEED.json";
import type { SeriesType, SqliteExecutor } from "../contracts/types";
import { CheckpointsRepository } from "../db/repositories/checkpointsRepo";
import { getFiscalYearFromIso, getLocalTodayIso } from "../fiscal/dateQuarter";
import type { SeedGraphFreezerPort } from "../ports/seedFreezerPort";
import { purgeDomainAndCheckpointsInTx } from "./backupService";

const HISTORICAL_SEED_TRACE_IDS = new Set([
  "tr_seed_03_pre",
  "tr_seed_03_post",
  "tr_seed_04_qa",
  "tr_seed_04_fiscal",
  "tr_seed_05_sl",
]);

export class ResetService {
  private readonly checkpointsRepo: CheckpointsRepository;

  constructor(private readonly executor: SqliteExecutor) {
    this.checkpointsRepo = new CheckpointsRepository(executor);
  }

  /**
   * Fase 1 dentro de inTransaction vía tx: purga tablas/checkpoints e inserta maestro, dominio,
   * los 5 chat_threads, chat_messages y trazas históricas tr_seed_03..05.
   * Fase 2 fuera de inTransaction tras COMMIT: invoca freezer.freezeDemoGates().
   */
  async restoreDemoData(freezer: SeedGraphFreezerPort): Promise<void> {
    const seed = contractsAndSeed.seedData;

    await this.executor.inTransaction(async (tx) => {
      await purgeDomainAndCheckpointsInTx(tx, this.checkpointsRepo);

      const s = seed.app_settings;
      await tx.run(
        `INSERT INTO app_settings (
          id, emitter_name, emitter_nif, emitter_fiscal_address, emitter_phone,
          last_active_thread_id, pending_camera_context_json, llm_enabled, llm_model_uri,
          default_vat_rate, irpf_reserve_rate, hourly_rate_cents, boot_mode, updated_at_ms
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, 21, 20, 3800, 'demo', ?)
        ON CONFLICT(id) DO UPDATE SET
          emitter_name = excluded.emitter_name,
          emitter_nif = excluded.emitter_nif,
          emitter_fiscal_address = excluded.emitter_fiscal_address,
          emitter_phone = excluded.emitter_phone,
          last_active_thread_id = excluded.last_active_thread_id,
          pending_camera_context_json = excluded.pending_camera_context_json,
          llm_enabled = excluded.llm_enabled,
          llm_model_uri = excluded.llm_model_uri,
          default_vat_rate = 21,
          irpf_reserve_rate = 20,
          hourly_rate_cents = 3800,
          boot_mode = 'demo',
          updated_at_ms = excluded.updated_at_ms`,
        [
          s.emitter_name,
          s.emitter_nif,
          s.emitter_fiscal_address,
          s.emitter_phone,
          s.last_active_thread_id,
          s.pending_camera_context_json,
          s.llm_enabled,
          s.llm_model_uri,
          s.updated_at_ms,
        ]
      );

      for (const seq of seed.sequences) {
        await tx.run(
          `INSERT INTO sequences (series_type, fiscal_year, last_seq, updated_at_ms)
           VALUES (?, ?, ?, ?)`,
          [seq.series_type, seq.fiscal_year, seq.last_seq, seq.updated_at_ms]
        );
      }

      for (const c of seed.clients) {
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

      for (const ci of seed.catalog_items) {
        await tx.run(
          `INSERT INTO catalog_items (
            id, description, category, unit, unit_price_cents, pricing_mode,
            estimated_hours_thousandths, materials_cents, default_vat_rate,
            active, created_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, ?, ?, 'fixed', 0, 0, ?, ?, ?, ?)`,
          [
            ci.id,
            ci.description,
            ci.category,
            ci.unit,
            ci.unit_price_cents,
            ci.default_vat_rate,
            ci.active,
            ci.created_at_ms,
            ci.updated_at_ms,
          ]
        );
      }

      for (const j of seed.jobs) {
        await tx.run(
          `INSERT INTO jobs (
            id, job_code, client_id, title, address, status,
            created_at_iso, created_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            j.id,
            j.job_code,
            j.client_id,
            j.title,
            j.address,
            j.status,
            j.created_at_iso,
            j.created_at_ms,
            j.updated_at_ms,
          ]
        );
      }

      for (const q of seed.quotes) {
        await tx.run(
          `INSERT INTO quotes (
            id, quote_code, job_id, client_id, client_name_snapshot, client_nif_snapshot,
            client_address_snapshot, client_phone_snapshot, vat_rate, subtotal_cents,
            vat_cents, total_cents, status, notes, pdf_uri, sent_at_iso,
            created_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            q.notes,
            q.pdf_uri,
            q.sent_at_iso,
            q.created_at_ms,
            q.updated_at_ms,
          ]
        );
      }

      for (const qi of seed.quote_items) {
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

      for (const inv of seed.invoices) {
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

      for (const tkt of seed.expense_tickets) {
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

      for (const sl of seed.site_logs) {
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

      for (const fb of seed.feedback_corrections) {
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

      for (const thr of seed.seedThreads) {
        const rec = thr.threadRecord;
        await tx.run(
          `INSERT INTO chat_threads (
            thread_id, title, status, active_job_id, active_quote_id,
            pending_gate, last_node, is_seed, created_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            rec.thread_id,
            rec.title,
            rec.status,
            rec.active_job_id,
            rec.active_quote_id,
            rec.pending_gate,
            rec.last_node,
            rec.is_seed,
            rec.created_at_ms,
            rec.updated_at_ms,
          ]
        );

        for (const msg of thr.messages) {
          await tx.run(
            `INSERT INTO chat_messages (
              id, thread_id, client_turn_id, role, content,
              widget_json, quick_actions_json, trace_id, created_at_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              msg.id,
              msg.thread_id,
              msg.client_turn_id,
              msg.role,
              msg.content,
              msg.widget_json ? JSON.stringify(msg.widget_json) : null,
              msg.quick_actions_json ? JSON.stringify(msg.quick_actions_json) : null,
              msg.trace_id,
              msg.created_at_ms,
            ]
          );
        }
      }

      for (const tr of seed.agent_traces) {
        if (!HISTORICAL_SEED_TRACE_IDS.has(tr.trace_id)) continue;
        await tx.run(
          `INSERT INTO agent_traces (
            trace_id, parent_trace_id, thread_id, turn_id, turn_phase,
            routed_intent, node_sequence_json, inference_engine, latency_ms,
            rag_snippets_json, validated_widget_json, hitl_gate_id, hitl_outcome,
            rejection_reason, error_code, cloud_cost_eur, created_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.0, ?)`,
          [
            tr.trace_id,
            tr.parent_trace_id,
            tr.thread_id,
            tr.turn_id,
            tr.turn_phase,
            tr.routed_intent,
            JSON.stringify(tr.node_sequence_json),
            tr.inference_engine,
            tr.latency_ms,
            JSON.stringify(tr.rag_snippets_json),
            tr.validated_widget_json ? JSON.stringify(tr.validated_widget_json) : null,
            tr.hitl_gate_id,
            tr.hitl_outcome,
            tr.rejection_reason,
            tr.error_code,
            tr.created_at_ms,
          ]
        );
      }
    });

    await freezer.freezeDemoGates();
  }

  async startFromScratch(seedSequences?: Partial<Record<SeriesType, number>>): Promise<void> {
    const now = Date.now();
    const fiscalYear = getFiscalYearFromIso(getLocalTodayIso());

    if (seedSequences) {
      for (const [series, val] of Object.entries(seedSequences)) {
        if (val !== undefined && (!Number.isInteger(val) || val < 0)) {
          throw new Error(`SCHEMA_VALIDATION_ERROR: Contador inicial inválido para ${series}`);
        }
      }
    }

    await this.executor.inTransaction(async (tx) => {
      await purgeDomainAndCheckpointsInTx(tx, this.checkpointsRepo);

      await tx.run(
        `INSERT INTO app_settings (
          id, emitter_name, emitter_nif, emitter_fiscal_address, emitter_phone,
          emitter_iban, emitter_logo_data_url,
          last_active_thread_id, pending_camera_context_json, llm_enabled, llm_model_uri,
          default_vat_rate, irpf_reserve_rate, hourly_rate_cents, boot_mode, updated_at_ms
        ) VALUES (1, '', '', '', '', '', NULL, NULL, NULL, 1, NULL, 21, 20, 3800, 'clean', ?)
        ON CONFLICT(id) DO UPDATE SET
          emitter_name = '',
          emitter_nif = '',
          emitter_fiscal_address = '',
          emitter_phone = '',
          emitter_iban = '',
          emitter_logo_data_url = NULL,
          last_active_thread_id = NULL,
          pending_camera_context_json = NULL,
          llm_enabled = 1,
          llm_model_uri = NULL,
          default_vat_rate = 21,
          irpf_reserve_rate = 20,
          hourly_rate_cents = 3800,
          boot_mode = 'clean',
          updated_at_ms = excluded.updated_at_ms`,
        [now]
      );

      if (seedSequences) {
        const seriesList: SeriesType[] = ["PRE", "ANT", "FAC", "OBR"];
        for (const series of seriesList) {
          const val = seedSequences[series];
          if (val !== undefined) {
            await tx.run(
              `INSERT INTO sequences (series_type, fiscal_year, last_seq, updated_at_ms)
               VALUES (?, ?, ?, ?)`,
              [series, fiscalYear, val, now]
            );
          }
        }
      }
    });
  }
}
