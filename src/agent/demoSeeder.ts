import contractsAndSeed from "../../docs/03_CONTRATOS_API_Y_SEED.json";
import { ResetService } from "../core/backup/resetService";
import type {
  Gate1QuoteDraftPayload,
  InputPayload,
  SqliteExecutor,
} from "../core/contracts/types";
import type { SeedOverrides } from "../core/ports/mediaPorts";
import type { SeedGraphFreezerPort } from "../core/ports/seedFreezerPort";
import type { GraphRunner } from "./graphRunner";

type RawSeedThread = (typeof contractsAndSeed.seedData.seedThreads)[number];

function findSeedThread(threadId: string): RawSeedThread {
  const found = contractsAndSeed.seedData.seedThreads.find((t) => t.thread_id === threadId);
  if (!found) {
    throw new Error(`DEMO_SEED_ERROR: hilo semilla '${threadId}' no encontrado en contratos`);
  }
  return found;
}

/**
 * Congelador desacoplado de las 2 puertas HITL iniciales (`thr-seed-01-gate1` y `thr-seed-02-gate2`)
 * vía `compiledGraph.invoke` + `seed_override`, sin OCR WASM ni red.
 */
export class DemoSeeder implements SeedGraphFreezerPort {
  private readonly resetService: ResetService;

  constructor(
    private readonly executor: SqliteExecutor,
    private readonly graphRunner: GraphRunner
  ) {
    this.resetService = new ResetService(executor);
  }

  /**
   * Comprueba si la BD está recién creada (0 secuencias y 0 hilos) e inicializa Demo o Limpio.
   */
  async ensureInitialBoot(
    requestedMode?: "demo" | "clean"
  ): Promise<"demo_seeded" | "already_ready" | "clean_initialized"> {
    const counts = await this.executor.query<{ seq_count: number; thr_count: number }>(
      `SELECT
        (SELECT COUNT(*) FROM sequences) AS seq_count,
        (SELECT COUNT(*) FROM chat_threads) AS thr_count`
    );
    const seqCount = Number(counts[0]?.seq_count ?? 0);
    const thrCount = Number(counts[0]?.thr_count ?? 0);

    if (seqCount > 0 || thrCount > 0) {
      return "already_ready";
    }

    const mode = requestedMode ?? "clean";

    if (mode === "clean") {
      await this.resetService.startFromScratch({ PRE: 0, ANT: 0, FAC: 0, OBR: 0 });
      return "clean_initialized";
    }

    await this.resetService.restoreDemoData(this);
    return "demo_seeded";
  }

  /**
   * Fase 1 + Fase 2 completa para restaurar los datos demo desde cualquier estado.
   */
  async restoreDemoData(): Promise<void> {
    await this.resetService.restoreDemoData(this);
  }

  /**
   * Fase 2 (fuera de inTransaction): congela thr-seed-01-gate1 y thr-seed-02-gate2 en
   * lg_checkpoints + lg_checkpoint_writes y genera trazas pre_interrupt tr_seed_01_pre / tr_seed_02_pre.
   */
  async freezeDemoGates(): Promise<void> {
    const gate1Seed = findSeedThread("thr-seed-01-gate1");
    const gate2Seed = findSeedThread("thr-seed-02-gate2");

    const freezeSingle = async (
      threadSeed: RawSeedThread,
      seedOverride: SeedOverrides,
      replayInputRaw: Record<string, unknown>
    ): Promise<void> => {
      const threadId = threadSeed.thread_id;
      const traceId = seedOverride.traceIdOverride;

      // Garantiza idempotencia si freezeDemoGates() se invoca de forma aislada sobre BD ya congelada
      await this.executor.inTransaction(async (tx) => {
        await tx.run(`DELETE FROM lg_checkpoint_writes WHERE thread_id = ?`, [threadId]);
        await tx.run(`DELETE FROM lg_checkpoints WHERE thread_id = ?`, [threadId]);
        if (traceId) {
          await tx.run(`DELETE FROM agent_traces WHERE trace_id = ?`, [traceId]);
        }
      });

      const replayInput = replayInputRaw as unknown as InputPayload;
      const initialActiveJobId = threadSeed.threadRecord.active_job_id ?? null;
      const initialActiveQuoteId = threadSeed.threadRecord.active_quote_id ?? null;

      await this.graphRunner.runSerialized(async () => {
        await this.graphRunner.compiledGraph.invoke(
          {
            input_payload: replayInput,
            messages: [],
            active_job_id: initialActiveJobId,
            active_quote_id: initialActiveQuoteId,
          },
          {
            configurable: {
              thread_id: threadId,
              seed_override: seedOverride,
            },
          }
        );
      });

      const snapshot = await this.graphRunner.compiledGraph.getState({
        configurable: { thread_id: threadId },
      });
      const activeInterrupt = snapshot.tasks?.[0]?.interrupts?.[0]?.value;
      if (!activeInterrupt) {
        throw new Error(
          `DEMO_SEED_ERROR: hilo semilla '${threadId}' no quedó pausado con InterruptPayload activo`
        );
      }

      await this.executor.run(
        `UPDATE chat_threads
         SET status = 'interrupted',
             pending_gate = ?,
             last_node = ?,
             active_job_id = ?,
             active_quote_id = ?,
             updated_at_ms = ?
         WHERE thread_id = ?`,
        [
          threadSeed.threadRecord.pending_gate,
          threadSeed.threadRecord.last_node,
          threadSeed.threadRecord.active_job_id,
          threadSeed.threadRecord.active_quote_id,
          threadSeed.threadRecord.updated_at_ms,
          threadId,
        ]
      );
    };

    const g1 = gate1Seed as RawSeedThread & {
      replayInputToFreeze: Record<string, unknown>;
      quoteFixtureOverride: {
        trace_id: string;
        summary_es: string;
        proposed_payload: Gate1QuoteDraftPayload;
      };
    };

    const g2 = gate2Seed as RawSeedThread & {
      replayInputToFreeze: Record<string, unknown>;
      ocrFixtureOverride: {
        trace_id: string;
        summary_es?: string;
        rawText: string;
        parsed: {
          supplierName: string | null;
          supplierNif: string | null;
          issueDateIso: string | null;
          vatRate?: 0 | 4 | 10 | 21 | "mixed";
          baseCents: number | null;
          vatCents: number | null;
          totalCents: number | null;
        };
        confidence: number;
      };
    };

    await freezeSingle(
      gate1Seed,
      {
        traceIdOverride: g1.quoteFixtureOverride.trace_id,
        quoteFixtureOverride: {
          summary_es: g1.quoteFixtureOverride.summary_es,
          proposed_payload: g1.quoteFixtureOverride.proposed_payload,
        },
      },
      g1.replayInputToFreeze
    );

    await freezeSingle(
      gate2Seed,
      {
        traceIdOverride: g2.ocrFixtureOverride.trace_id,
        ocrFixtureOverride: {
          summary_es: g2.ocrFixtureOverride.summary_es,
          rawText: g2.ocrFixtureOverride.rawText,
          parsed: g2.ocrFixtureOverride.parsed,
          confidence: g2.ocrFixtureOverride.confidence,
        },
      },
      g2.replayInputToFreeze
    );
  }
}
