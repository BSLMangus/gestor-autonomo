import { Send } from "lucide-react";
import { useState } from "react";
import { TEXT_LIMITS } from "../core/contracts/textLimits";
import type { PendingGate } from "../core/contracts/types";

interface BottomQuickBarProps {
  isInterrupted: boolean;
  pendingGate: PendingGate | null;
  isSubmitting: boolean;
  onSendText: (text: string) => Promise<void>;
  onOpenActiveInterrupt?: () => void;
}

export function BottomQuickBar({
  isInterrupted,
  isSubmitting,
  onSendText,
  onOpenActiveInterrupt,
}: BottomQuickBarProps) {
  const [text, setText] = useState("");
  const locked = isInterrupted || isSubmitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || locked) return;
    setText("");
    await onSendText(trimmed);
  };

  return (
    <div
      data-testid="bottom-quick-bar"
      className="border-t border-outline-variant bg-surface-container-lowest px-3 py-2.5 space-y-2"
    >
      {isInterrupted && (
        <div
          data-testid="composer-interrupted-lock-banner"
          className="flex items-center justify-between gap-2 rounded-2xl border border-outline-variant bg-terracotta-soft px-3.5 py-2 text-[12px] font-semibold text-on-primary-container"
        >
          <span>Propuesta pendiente de revisión.</span>
          {onOpenActiveInterrupt && (
            <button
              type="button"
              data-testid="reopen-pending-widget-btn"
              onClick={onOpenActiveInterrupt}
              className="shrink-0 rounded-xl bg-primary px-3 py-1.5 text-[12px] font-semibold text-white cursor-pointer"
            >
              Abrir ficha
            </button>
          )}
        </div>
      )}

      <form onSubmit={(e) => void handleSubmit(e)} className="flex items-center gap-2">
        <input
          type="text"
          maxLength={TEXT_LIMITS.CHAT_INPUT}
          data-testid="chat-composer-input"
          disabled={locked}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            isInterrupted
              ? "Confirma o descarta la tarjeta para continuar..."
              : "Escribe qué necesitas (presupuesto, agenda, ticket, cliente)..."
          }
          className="min-h-[48px] flex-1 rounded-2xl border border-outline-variant bg-surface-container-low px-3.5 text-[14px] text-on-surface placeholder:text-outline focus:border-terracotta focus:outline-none disabled:bg-surface-container disabled:text-outline"
        />

        <button
          type="submit"
          data-testid="chat-send-btn"
          disabled={locked || text.trim().length === 0}
          className="inline-flex min-h-[48px] items-center gap-1.5 rounded-2xl bg-secondary px-4 text-[13px] font-semibold text-on-secondary transition-colors hover:bg-secondary/90 disabled:opacity-40 cursor-pointer"
        >
          <Send className="h-4 w-4" />
          <span>Enviar</span>
        </button>
      </form>
    </div>
  );
}
