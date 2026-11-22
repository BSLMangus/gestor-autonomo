import { HumanMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph/web";
import { HumanDecisionSchema, InputPayloadSchema } from "../core/contracts/schemas";
import type {
  ActiveWidgetEnvelope,
  ChatMessageRecord,
  ChatThreadRecord,
  Gate1QuoteDraftPayload,
  Gate2TicketDraftPayload,
  HumanDecision,
  InputPayload,
  InterruptPayload,
  LocalStreamEvent,
  RecoveredDraft,
  TurnExecutionResult,
} from "../core/contracts/types";
import { ChatRepository } from "../core/db/repositories/chatRepo";
import { CheckpointsRepository } from "../core/db/repositories/checkpointsRepo";
import { SettingsRepository } from "../core/db/repositories/settingsRepo";
import { CHECKPOINT_SCHEMA_VERSION } from "./checkpointer";
import { buildObraLocalGraph, type CompiledObraLocalGraph } from "./graph";
import type { GraphDependencies, SeedOverrides } from "./ports";
import type { ObraLocalGraphState } from "./state";

export type StorageMode = "capacitor_wal" | "web_opfs_worker" | "memory";

function describeUserTurn(input: InputPayload): string {
  if (input.text.trim().length > 0) return input.text.trim();
  switch (input.action_type) {
    case "scan_ticket":
      return "[Ticket escaneado]";
    case "manual_ticket_entry":
      return "[Alta manual de ticket]";
    case "start_empty_quote":
      return "[Nuevo presupuesto vacío]";
    case "start_job_quote":
      return "[Presupuesto de obra]";
    case "request_advance_gate":
      return "[Solicitar anticipo 40 %]";
    case "request_invoice_gate":
      return "[Solicitar factura correlativa]";
    case "request_share_gate":
      return "[Enviar documento al cliente]";
    case "open_job_overview":
      return "[Resumen de obra]";
    case "open_fiscal_piggybank":
      return "[Consultar Hucha Fiscal]";
    case "open_schedule_log":
      return "[Parte de jornada / Agenda]";
    case "resolve_disambiguation":
      return "[Selección rápida]";
    default:
      return "[Turno de voz/texto]";
  }
}

function getLatestAssistantText(state: ObraLocalGraphState | undefined): string {
  if (!state?.messages?.length) return "";
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    const msg = state.messages[i];
    if (msg && msg._getType() === "ai") {
      return typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
    }
  }
  return "";
}

function stripRecoveredPayload(
  widget: RecoveredDraft["widget_json"]
): Gate1QuoteDraftPayload | Gate2TicketDraftPayload {
  if (widget.ui_widget_type === "QuoteBuilderWidget") {
    const { subtotal_cents: _s, vat_cents: _v, total_cents: _t, ...draft } =
      widget.widget_payload;
    return draft;
  }
  const { ocr_fallback_reason: _r, ...draft } = widget.widget_payload;
  return draft;
}

export class GraphRunner {
  readonly compiledGraph: CompiledObraLocalGraph;
  private readonly chatRepo: ChatRepository;
  private readonly checkpointsRepo: CheckpointsRepository;
  private readonly settingsRepo: SettingsRepository;
  private readonly listeners = new Set<(ev: LocalStreamEvent) => void>();
  private fifoMutex: Promise<void> = Promise.resolve();

  constructor(
    private readonly deps: GraphDependencies,
    private readonly storageMode: StorageMode = "memory"
  ) {
    this.compiledGraph = buildObraLocalGraph(deps);
    this.chatRepo = new ChatRepository(deps.executor);
    this.checkpointsRepo = new CheckpointsRepository(deps.executor);
    this.settingsRepo = new SettingsRepository(deps.executor);
  }

  subscribe(listener: (ev: LocalStreamEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(ev: LocalStreamEvent): void {
    for (const listener of this.listeners) {
      listener(ev);
    }
  }

  /**
   * Cola FIFO única para toda invocación activa del grafo, garantizando que
   * BrowserAsyncLocalStorage nunca sufra solapamiento de pila entre hilos paralelos.
   */
  runSerialized<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.fifoMutex.then(() => fn());
    this.fifoMutex = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  async bootstrapStorage(): Promise<{
    ok: boolean;
    recoveredDrafts: RecoveredDraft[];
    storageMode: StorageMode;
  }> {
    const recoveredDrafts = await this.checkpointsRepo.migrateIncompatibleCheckpoints(
      CHECKPOINT_SCHEMA_VERSION
    );
    await this.chatRepo.reconcileInterruptedRunningThreads();
    return {
      ok: true,
      recoveredDrafts,
      storageMode: this.storageMode,
    };
  }

  async createThread(params?: {
    title?: string;
    active_job_id?: string | null;
    active_quote_id?: string | null;
  }): Promise<ChatThreadRecord> {
    const thread = await this.chatRepo.createThread(params);
    await this.settingsRepo.setLastActiveThreadId(thread.thread_id);
    return thread;
  }

  async switchThread(threadId: string): Promise<void> {
    const thread = await this.chatRepo.getThread(threadId);
    if (!thread) {
      throw new Error(`INVALID_STATE_TRANSITION: Hilo '${threadId}' no encontrado`);
    }
    await this.settingsRepo.setLastActiveThreadId(threadId);
  }

  async getThreadState(threadId: string): Promise<{
    thread: ChatThreadRecord;
    checkpointStatus: "idle" | "interrupted";
    activeInterrupt: InterruptPayload | null;
    messages: ChatMessageRecord[];
  }> {
    const thread = await this.chatRepo.getThread(threadId);
    if (!thread) {
      throw new Error(`INVALID_STATE_TRANSITION: Hilo '${threadId}' no encontrado`);
    }
    const messages = await this.chatRepo.listMessages(threadId);
    const snapshot = await this.compiledGraph.getState({
      configurable: { thread_id: threadId },
    });
    const activeInterrupt =
      (snapshot.tasks?.[0]?.interrupts?.[0]?.value as InterruptPayload | undefined) ?? null;

    return {
      thread,
      checkpointStatus: activeInterrupt ? "interrupted" : "idle",
      activeInterrupt,
      messages,
    };
  }

  async rehydrateActiveThread(): Promise<{
    threadId: string | null;
    activeInterrupt: InterruptPayload | null;
    recoveredDrafts: RecoveredDraft[];
  }> {
    const [settings, recoveredDrafts] = await Promise.all([
      this.settingsRepo.getAppSettings(),
      this.settingsRepo.listActiveRecoveredDrafts(),
    ]);
    let threadId = settings.last_active_thread_id;
    if (threadId) {
      const exists = await this.chatRepo.getThread(threadId);
      if (!exists) threadId = null;
    }
    if (!threadId) {
      const threads = await this.chatRepo.listThreads();
      threadId = threads[0]?.thread_id ?? null;
    }
    if (!threadId) {
      return { threadId: null, activeInterrupt: null, recoveredDrafts };
    }
    const snapshot = await this.compiledGraph.getState({
      configurable: { thread_id: threadId },
    });
    const activeInterrupt =
      (snapshot.tasks?.[0]?.interrupts?.[0]?.value as InterruptPayload | undefined) ?? null;
    return {
      threadId,
      activeInterrupt,
      recoveredDrafts,
    };
  }

  async runTurn(
    threadId: string,
    rawInput: InputPayload,
    seedOverride?: SeedOverrides
  ): Promise<TurnExecutionResult> {
    const input = InputPayloadSchema.parse(rawInput);

    // Idempotencia por client_turn_id
    const existingMsg = await this.chatRepo.getMessageByClientTurnId(input.client_turn_id);
    if (existingMsg) {
      const state = await this.getThreadState(threadId);
      const latestAssistant =
        [...state.messages].reverse().find((m) => m.role === "assistant") ?? null;
      return {
        thread_id: threadId,
        trace_id: latestAssistant?.trace_id ?? "",
        checkpoint_status: state.checkpointStatus,
        active_interrupt: state.activeInterrupt,
        active_widget: latestAssistant?.widget_json ?? null,
        quick_actions: latestAssistant?.quick_actions_json ?? null,
        assistant_message: latestAssistant,
        active_job_id: state.thread.active_job_id,
        active_quote_id: state.thread.active_quote_id,
        error_code: null,
      };
    }

    const thread = await this.chatRepo.getThread(threadId);
    if (!thread) {
      throw new Error(`INVALID_STATE_TRANSITION: Hilo '${threadId}' no encontrado`);
    }

    const startedAtMs = Date.now();
    await this.chatRepo.insertMessage({
      thread_id: threadId,
      client_turn_id: input.client_turn_id,
      role: "user",
      content: describeUserTurn(input),
      created_at_ms: startedAtMs,
    });
    await this.chatRepo.updateThread(threadId, { status: "running" });
    await this.settingsRepo.setLastActiveThreadId(threadId);

    this.emit({
      event: "turn_started",
      payload: {
        thread_id: threadId,
        turn_id: input.client_turn_id,
        client_turn_id: input.client_turn_id,
        started_at_ms: startedAtMs,
      },
    });

    return this.runSerialized(async () => {
      try {
        const invokeInput = {
          input_payload: input,
          messages: input.text.trim().length > 0 ? [new HumanMessage(input.text.trim())] : [],
          active_job_id:
            input.session_context !== undefined
              ? input.session_context.active_job_id
              : thread.active_job_id,
          active_quote_id:
            input.session_context !== undefined
              ? input.session_context.active_quote_id
              : thread.active_quote_id,
        };

        await this.compiledGraph.invoke(invokeInput, {
          configurable: {
            thread_id: threadId,
            ...(seedOverride ? { seed_override: seedOverride } : {}),
          },
        });

        const snapshot = await this.compiledGraph.getState({
          configurable: { thread_id: threadId },
        });
        const values = snapshot.values as ObraLocalGraphState;
        const activeInterrupt =
          (snapshot.tasks?.[0]?.interrupts?.[0]?.value as InterruptPayload | undefined) ?? null;

        if (values.rag_snippets?.length) {
          this.emit({
            event: "rag_hits",
            payload: {
              thread_id: threadId,
              turn_id: input.client_turn_id,
              snippets: values.rag_snippets,
            },
          });
        }

        const assistantContent =
          getLatestAssistantText(values) || activeInterrupt?.summary_es || "Listo.";
        const traceId = values.turn_trace?.trace_id ?? "";
        const activeWidget: ActiveWidgetEnvelope | null = values.active_widget ?? null;
        const quickActions = values.quick_actions ?? null;

        const assistantMessage = await this.chatRepo.insertMessage({
          thread_id: threadId,
          client_turn_id: null,
          role: "assistant",
          content: assistantContent,
          widget_json: activeWidget,
          quick_actions_json: quickActions,
          trace_id: traceId || null,
          created_at_ms: Date.now(),
        });

        await this.chatRepo.updateThread(threadId, {
          status: activeInterrupt ? "interrupted" : "idle",
          pending_gate: activeInterrupt ? activeInterrupt.gate_id : null,
          last_node: activeInterrupt ? values.turn_trace.node_sequence.at(-1) ?? null : "__end__",
          active_job_id: values.active_job_id ?? null,
          active_quote_id: values.active_quote_id ?? null,
        });

        if (activeInterrupt) {
          this.emit({
            event: "hitl_interrupt",
            payload: {
              thread_id: threadId,
              turn_id: input.client_turn_id,
              interruptPayload: activeInterrupt,
              trace_id: traceId,
            },
          });
        } else {
          this.emit({
            event: "widget_ready",
            payload: {
              thread_id: threadId,
              turn_id: input.client_turn_id,
              active_widget: activeWidget,
              quick_actions: quickActions,
            },
          });
        }

        this.emit({
          event: "turn_completed",
          payload: {
            thread_id: threadId,
            turn_id: input.client_turn_id,
            trace_id: traceId,
            latency_ms: Math.max(0, Date.now() - startedAtMs),
            cloud_cost_eur: 0,
          },
        });

        return {
          thread_id: threadId,
          trace_id: traceId,
          checkpoint_status: activeInterrupt ? "interrupted" : "idle",
          active_interrupt: activeInterrupt,
          active_widget: activeWidget,
          quick_actions: quickActions,
          assistant_message: assistantMessage,
          active_job_id: values.active_job_id ?? null,
          active_quote_id: values.active_quote_id ?? null,
          error_code: values.turn_trace?.error_code ?? null,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await this.chatRepo.updateThread(threadId, { status: "error", pending_gate: null });
        this.emit({
          event: "turn_error",
          payload: {
            thread_id: threadId,
            turn_id: input.client_turn_id,
            error_code: "SQLITE_QUERY_ERROR",
            message_es: msg,
            recoverable: true,
          },
        });
        throw err;
      }
    });
  }

  async resumeGate(threadId: string, rawDecision: HumanDecision): Promise<TurnExecutionResult> {
    const decision = HumanDecisionSchema.parse(rawDecision);

    return this.runSerialized(async () => {
      const snapshotBefore = await this.compiledGraph.getState({
        configurable: { thread_id: threadId },
      });
      const pendingInterrupt =
        (snapshotBefore.tasks?.[0]?.interrupts?.[0]?.value as InterruptPayload | undefined) ?? null;

      if (!pendingInterrupt || pendingInterrupt.gate_id !== decision.gate_id) {
        throw new Error(
          `INVALID_STATE_TRANSITION: El hilo '${threadId}' no tiene pausa activa para '${decision.gate_id}'`
        );
      }

      const startedAtMs = Date.now();
      await this.chatRepo.updateThread(threadId, { status: "running" });

      try {
        await this.compiledGraph.invoke(new Command({ resume: decision }), {
          configurable: { thread_id: threadId },
        });

        const snapshotAfter = await this.compiledGraph.getState({
          configurable: { thread_id: threadId },
        });
        const values = snapshotAfter.values as ObraLocalGraphState;
        const activeInterrupt =
          (snapshotAfter.tasks?.[0]?.interrupts?.[0]?.value as InterruptPayload | undefined) ?? null;
        const assistantContent = getLatestAssistantText(values) || "Operación completada.";
        const traceId = values.turn_trace?.trace_id ?? "";
        const activeWidget = values.active_widget ?? null;
        const quickActions = values.quick_actions ?? null;

        const assistantMessage = await this.chatRepo.insertMessage({
          thread_id: threadId,
          client_turn_id: null,
          role: "assistant",
          content: assistantContent,
          widget_json: activeWidget,
          quick_actions_json: quickActions,
          trace_id: traceId || null,
          created_at_ms: Date.now(),
        });

        await this.chatRepo.updateThread(threadId, {
          status: activeInterrupt ? "interrupted" : "idle",
          pending_gate: activeInterrupt ? activeInterrupt.gate_id : null,
          last_node: "__end__",
          active_job_id: values.active_job_id ?? null,
          active_quote_id: values.active_quote_id ?? null,
        });

        this.emit({
          event: "widget_ready",
          payload: {
            thread_id: threadId,
            turn_id: values.turn_trace?.turn_id ?? "",
            active_widget: activeWidget,
            quick_actions: quickActions,
          },
        });

        this.emit({
          event: "turn_completed",
          payload: {
            thread_id: threadId,
            turn_id: values.turn_trace?.turn_id ?? "",
            trace_id: traceId,
            latency_ms: Math.max(0, Date.now() - startedAtMs),
            cloud_cost_eur: 0,
          },
        });

        return {
          thread_id: threadId,
          trace_id: traceId,
          checkpoint_status: activeInterrupt ? "interrupted" : "idle",
          active_interrupt: activeInterrupt,
          active_widget: activeWidget,
          quick_actions: quickActions,
          assistant_message: assistantMessage,
          active_job_id: values.active_job_id ?? null,
          active_quote_id: values.active_quote_id ?? null,
          error_code: values.turn_trace?.error_code ?? null,
        };
      } catch (err) {
        await this.chatRepo.updateThread(threadId, { status: "error", pending_gate: null });
        throw err;
      }
    });
  }

  /**
   * Reabre un borrador rescatado tras migración de checkpoints creando un hilo nuevo
   * congelado vía recoveredDraftOverride fuera de inTransaction antes de marcar dismissed=1.
   */
  async reopenRecoveredDraft(draftId: string): Promise<TurnExecutionResult> {
    const draft = await this.settingsRepo.getRecoveredDraftById(draftId);
    if (!draft) {
      throw new Error(`INVALID_STATE_TRANSITION: Borrador recuperado '${draftId}' no encontrado`);
    }

    const newThread = await this.chatRepo.createThread({
      title:
        draft.pending_gate === "gate_1_quote"
          ? "Borrador recuperado: Presupuesto"
          : "Borrador recuperado: Ticket gasto",
      active_job_id: draft.active_job_id,
      active_quote_id: draft.active_quote_id,
    });

    const summaryEs =
      draft.pending_gate === "gate_1_quote"
        ? "Borrador de presupuesto recuperado tras actualización de esquema."
        : "Borrador de ticket recuperado tras actualización de esquema.";

    const actionType =
      draft.pending_gate === "gate_1_quote" ? "start_empty_quote" : "manual_ticket_entry";
    const clientTurnId = `rec_turn_${crypto.randomUUID().slice(0, 10)}`;

    const snapshot = await this.runSerialized(async () => {
      await this.compiledGraph.invoke(
        {
          input_payload: {
            client_turn_id: clientTurnId,
            text: "",
            action_type: actionType,
            session_context: {
              active_job_id: draft.active_job_id,
              active_quote_id: draft.active_quote_id,
            },
          },
          messages: [],
          active_job_id: draft.active_job_id,
          active_quote_id: draft.active_quote_id,
        },
        {
          configurable: {
            thread_id: newThread.thread_id,
            seed_override: {
              recoveredDraftOverride: {
                pending_gate: draft.pending_gate,
                summary_es: summaryEs,
                proposed_payload: stripRecoveredPayload(draft.widget_json),
              },
            },
          },
        }
      );

      return this.compiledGraph.getState({
        configurable: { thread_id: newThread.thread_id },
      });
    });

    const values = snapshot.values as ObraLocalGraphState;
    const activeInterrupt =
      (snapshot.tasks?.[0]?.interrupts?.[0]?.value as InterruptPayload | undefined) ?? null;
    const traceId = values.turn_trace?.trace_id ?? "";
    const activeWidget = values.active_widget ?? null;
    let assistantMessage: ChatMessageRecord | null = null;

    await this.deps.executor.inTransaction(async (tx) => {
      await this.chatRepo.insertMessage(
        {
          thread_id: newThread.thread_id,
          client_turn_id: clientTurnId,
          role: "user",
          content: "[Reabrir borrador recuperado]",
        },
        tx
      );
      assistantMessage = await this.chatRepo.insertMessage(
        {
          thread_id: newThread.thread_id,
          client_turn_id: null,
          role: "assistant",
          content: getLatestAssistantText(values) || summaryEs,
          widget_json: activeWidget,
          quick_actions_json: values.quick_actions ?? null,
          trace_id: traceId || null,
        },
        tx
      );
      await this.chatRepo.updateThread(
        newThread.thread_id,
        {
          status: activeInterrupt ? "interrupted" : "idle",
          pending_gate: activeInterrupt ? activeInterrupt.gate_id : null,
          last_node: draft.pending_gate === "gate_1_quote" ? "quote_commit" : "ocr_commit",
          active_job_id: draft.active_job_id,
          active_quote_id: draft.active_quote_id,
        },
        tx
      );
      await this.settingsRepo.dismissRecoveredDraft(draft.id, tx);
    });

    await this.settingsRepo.setLastActiveThreadId(newThread.thread_id);

    return {
      thread_id: newThread.thread_id,
      trace_id: traceId,
      checkpoint_status: activeInterrupt ? "interrupted" : "idle",
      active_interrupt: activeInterrupt,
      active_widget: activeWidget,
      quick_actions: values.quick_actions ?? null,
      assistant_message: assistantMessage,
      active_job_id: draft.active_job_id,
      active_quote_id: draft.active_quote_id,
      error_code: null,
    };
  }
}
