import { Trash2 } from "lucide-react";
import type {
  ActiveWidgetEnvelope,
  ChatMessageRecord,
  InterruptPayload,
  PendingGate,
  QuickAction,
} from "../../core/contracts/types";
import { getOverlayMetaForWidget } from "./widgets/widgetTypes";

interface ChatTimelineViewProps {
  threadTitle: string;
  messages: ChatMessageRecord[];
  checkpointStatus: "idle" | "interrupted";
  activeInterrupt: InterruptPayload | null;
  isSubmitting: boolean;
  canDeleteThread?: boolean;
  onRequestDeleteThread?: () => void;
  onQuickAction: (action: QuickAction) => Promise<void>;
  onOpenWidget: (params: {
    widget: ActiveWidgetEnvelope;
    isActiveGate: boolean;
    activePendingGate: PendingGate | null;
  }) => void;
}

export function ChatTimelineView({
  threadTitle,
  messages,
  checkpointStatus,
  activeInterrupt,
  isSubmitting,
  canDeleteThread = false,
  onRequestDeleteThread,
  onQuickAction,
  onOpenWidget,
}: ChatTimelineViewProps) {
  const activeGateId: PendingGate | null =
    checkpointStatus === "interrupted" && activeInterrupt ? activeInterrupt.gate_id : null;

  let lastMatchingWidgetMsgId: string | null = null;
  if (activeInterrupt) {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m?.widget_json?.ui_widget_type === activeInterrupt.ui_widget_type) {
        lastMatchingWidgetMsgId = m.id;
        break;
      }
    }
  }

  return (
    <div
      data-testid="chat-timeline"
      className="flex-1 overflow-y-auto no-scrollbar px-4 py-4 space-y-3 bg-[#F9F7F2] cotton-paper text-[#2C2621] font-sans"
    >
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 className="min-w-0 truncate text-[12px] font-semibold uppercase tracking-wide text-[#6B6860]">
          {threadTitle}
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          {checkpointStatus === "interrupted" && activeInterrupt && (
            <span
              data-testid="active-hitl-pill"
              className="rounded-full status-tangerine px-2.5 py-0.5 text-[11px] font-semibold"
            >
              Pendiente de tu confirmación
            </span>
          )}
          {canDeleteThread && onRequestDeleteThread && (
            <button
              type="button"
              data-testid="chat-header-delete-thread-btn"
              aria-label="Eliminar conversación actual"
              title="Eliminar conversación"
              disabled={isSubmitting}
              onClick={onRequestDeleteThread}
              className="flex h-8 w-8 items-center justify-center rounded-xl border border-[#DC2626]/25 bg-[#FAD2D8]/55 text-[#DC2626] hover:bg-[#FAD2D8] transition-colors cursor-pointer disabled:opacity-40"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {messages.length === 0 ? (
        <article
          data-testid="assistant-empty-state"
          className="paper-sheet rounded-[20px] border border-[#E5DFD2] bg-[#FFFDF7] p-4 text-[14px] leading-relaxed text-[#2C2621]"
        >
          <p className="font-semibold text-[#2C2621]">
            Conversación lista. Escribe abajo, pulsa el micrófono para dictar o usa la cámara para escanear un documento.
          </p>
          <p className="mt-1.5 text-[12px] text-[#6B6860]">
            Cuando generes un presupuesto, parte de agenda, ticket, ficha de cliente o entrada de diario se abrirá directamente en pantalla completa para que lo revises y confirmes.
          </p>
        </article>
      ) : (
        messages.map((msg, msgIdx) => {
          const isUser = msg.role === "user";
          const isLatestMessage = msgIdx === messages.length - 1;
          const isThisActiveGate =
            activeGateId !== null && msg.id === lastMatchingWidgetMsgId;
          const contextualActions = (msg.quick_actions_json ?? []).filter((qa) => {
            if (qa.action_type === "resolve_disambiguation") return true;
            if (!isLatestMessage || isUser) return false;
            return (
              qa.action_type === "start_empty_quote" ||
              qa.action_type === "manual_ticket_entry" ||
              qa.action_type === "start_empty_client" ||
              qa.action_type === "open_fiscal_piggybank" ||
              qa.action_type === "open_schedule_log"
            );
          });
          const widgetMeta = msg.widget_json
            ? getOverlayMetaForWidget(msg.widget_json)
            : null;

          return (
            <article
              key={msg.id}
              data-testid={`chat-msg-${msg.role}`}
              className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}
            >
              <div
                className={`max-w-[92%] rounded-[20px] px-4 py-3 text-[14px] leading-relaxed ${
                  isUser
                    ? "bg-[#FFD6B0] border border-[#E5DFD2] text-[#2C2621] rounded-br-sm shadow-[0_2px_8px_rgba(44,38,33,0.06)]"
                    : "paper-sheet bg-[#FFFDF7] border border-[#E5DFD2] text-[#2C2621] rounded-bl-sm w-full"
                }`}
              >
                <p className="whitespace-pre-wrap">{msg.content}</p>

                {/* Resumen compacto clicable en el historial: despliega la tarjeta en vista protagonista */}
                {msg.widget_json && widgetMeta && (
                  <div className="mt-3 flex items-center justify-between gap-2.5 rounded-2xl border border-[#E5DFD2] bg-[#F5F1E6] px-3.5 py-2.5">
                    <div className="min-w-0">
                      <div
                        className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                          isThisActiveGate ? "status-tangerine" : "status-cobalt"
                        }`}
                      >
                        {widgetMeta.badge}
                      </div>
                      <div className="mt-0.5 truncate text-[13px] font-semibold text-[#2C2621]">
                        {widgetMeta.title}
                      </div>
                    </div>
                    <button
                      type="button"
                      data-testid={`open-msg-widget-${msg.id}`}
                      onClick={() =>
                        onOpenWidget({
                          widget: msg.widget_json!,
                          isActiveGate: isThisActiveGate,
                          activePendingGate: isThisActiveGate ? activeGateId : null,
                        })
                      }
                      className="min-h-[40px] shrink-0 rounded-xl bg-[#EA580C] hover:bg-[#D04B00] px-3.5 text-xs font-semibold text-white cursor-pointer transition-colors"
                    >
                      {isThisActiveGate ? "Revisar" : "Abrir"}
                    </button>
                  </div>
                )}

                {/* Chips de desambiguación y acciones contextuales del último turno */}
                {contextualActions.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {contextualActions.map((qa) => (
                      <button
                        key={qa.id}
                        type="button"
                        data-testid={`quick-action-${qa.id}`}
                        disabled={isSubmitting || checkpointStatus === "interrupted"}
                        onClick={() => void onQuickAction(qa)}
                        className="min-h-[42px] rounded-xl border border-[#E5DFD2] bg-[#FFD6B0] px-3.5 py-1.5 text-xs font-semibold text-[#2C2621] hover:border-[#EA580C] disabled:opacity-50 cursor-pointer transition-colors"
                      >
                        {qa.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </article>
          );
        })
      )}
    </div>
  );
}
