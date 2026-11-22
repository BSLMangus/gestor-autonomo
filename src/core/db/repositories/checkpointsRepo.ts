import { ActiveWidgetEnvelopeSchema } from "../../contracts/schemas";
import type { RecoveredDraft, SqliteExecutor } from "../../contracts/types";

interface IncompatibleThreadRow extends Record<string, unknown> {
  thread_id: string;
}

interface LatestCheckpointRow extends Record<string, unknown> {
  checkpoint_id: string;
  schema_version: string;
  checkpoint_data: string;
  has_pending_interrupt: number;
}

interface RawRecoveredDraftRow extends Record<string, unknown> {
  id: string;
  thread_id: string;
  original_schema_version: string;
  pending_gate: "gate_1_quote" | "gate_2_ticket";
  widget_json: string;
  active_job_id: string | null;
  active_quote_id: string | null;
  dismissed: number;
  recovered_at_ms: number;
}

function decodeBase64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

function decodeCheckpointJson(data: string): Record<string, unknown> | null {
  try {
    const text = data.startsWith("b64:")
      ? new TextDecoder().decode(decodeBase64ToBytes(data.slice(4)))
      : data;
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export class CheckpointsRepository {
  constructor(private readonly executor: SqliteExecutor) {}

  async deleteThreadCheckpoints(
    threadId: string,
    tx?: Pick<SqliteExecutor, "query" | "run">
  ): Promise<void> {
    const runner = tx ?? this.executor;
    await runner.run(`DELETE FROM lg_checkpoints WHERE thread_id = ?`, [threadId]);
  }

  async purgeAllCheckpoints(tx?: Pick<SqliteExecutor, "query" | "run">): Promise<void> {
    const runner = tx ?? this.executor;
    await runner.run(`DELETE FROM lg_checkpoint_writes`);
    await runner.run(`DELETE FROM lg_checkpoints`);
  }

  /**
   * Ejecución única al arrancar (nunca desde getTuple/list).
   * Inspecciona únicamente el checkpoint más reciente por thread_id con schema_version incompatible.
   * Si tiene has_pending_interrupt = 1 en Gate 1 o Gate 2, rescata el borrador en recovered_drafts.
   */
  async migrateIncompatibleCheckpoints(expectedSchemaVersion: string): Promise<RecoveredDraft[]> {
    const now = Date.now();
    await this.executor.inTransaction(async (tx) => {
      const threads = await tx.query<IncompatibleThreadRow>(
        `SELECT DISTINCT thread_id FROM lg_checkpoints WHERE schema_version != ?`,
        [expectedSchemaVersion]
      );

      for (const { thread_id } of threads) {
        const latestRows = await tx.query<LatestCheckpointRow>(
          `SELECT checkpoint_id, schema_version, checkpoint_data, has_pending_interrupt
           FROM lg_checkpoints
           WHERE thread_id = ?
           ORDER BY checkpoint_id DESC, rowid DESC
           LIMIT 1`,
          [thread_id]
        );

        const latest = latestRows[0];
        if (
          latest &&
          latest.schema_version !== expectedSchemaVersion &&
          latest.has_pending_interrupt === 1
        ) {
          const decoded = decodeCheckpointJson(latest.checkpoint_data);
          const channelValues =
            decoded && typeof decoded.channel_values === "object" && decoded.channel_values !== null
              ? (decoded.channel_values as Record<string, unknown>)
              : null;

          const pendingGate = channelValues?.pending_gate;
          if (pendingGate === "gate_1_quote" || pendingGate === "gate_2_ticket") {
            const widgetParsed = ActiveWidgetEnvelopeSchema.safeParse(channelValues?.active_widget);
            if (
              widgetParsed.success &&
              ((pendingGate === "gate_1_quote" &&
                widgetParsed.data.ui_widget_type === "QuoteBuilderWidget") ||
                (pendingGate === "gate_2_ticket" &&
                  widgetParsed.data.ui_widget_type === "TicketOcrValidatorWidget"))
            ) {
              const activeJobId =
                typeof channelValues?.active_job_id === "string"
                  ? channelValues.active_job_id
                  : null;
              const activeQuoteId =
                typeof channelValues?.active_quote_id === "string"
                  ? channelValues.active_quote_id
                  : null;
              const draftId = `rec_${thread_id}_${now}`;
              await tx.run(
                `INSERT OR IGNORE INTO recovered_drafts (
                  id, thread_id, original_schema_version, pending_gate,
                  widget_json, active_job_id, active_quote_id, dismissed, recovered_at_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
                [
                  draftId,
                  thread_id,
                  latest.schema_version,
                  pendingGate,
                  JSON.stringify(widgetParsed.data),
                  activeJobId,
                  activeQuoteId,
                  now,
                ]
              );
            }
          }
        }

        await tx.run(
          `UPDATE chat_threads
           SET status = 'idle', pending_gate = NULL, updated_at_ms = ?
           WHERE thread_id = ?`,
          [now, thread_id]
        );
      }

      if (threads.length > 0) {
        await tx.run(`DELETE FROM lg_checkpoints WHERE schema_version != ?`, [
          expectedSchemaVersion,
        ]);
      }
    });

    const rows = await this.executor.query<RawRecoveredDraftRow>(
      `SELECT * FROM recovered_drafts WHERE dismissed = 0 ORDER BY recovered_at_ms DESC`
    );
    return rows.map((row) => ({
      id: row.id,
      thread_id: row.thread_id,
      original_schema_version: row.original_schema_version,
      pending_gate: row.pending_gate,
      widget_json: JSON.parse(row.widget_json) as RecoveredDraft["widget_json"],
      active_job_id: row.active_job_id,
      active_quote_id: row.active_quote_id,
      dismissed: row.dismissed === 1,
      recovered_at_ms: row.recovered_at_ms,
    }));
  }
}
