import React, { useRef, useState } from 'react';
import {
  Bot,
  CalendarClock,
  CheckCircle2,
  FileText,
  Mic,
  ReceiptText,
  Send,
} from 'lucide-react';
import { TODAY_ISO, useAppStore } from '../../services/mockStore';
import type { ChatActionCard, ExpenseCategory, QuoteLine } from '../../types/domain';

export function ChatTimelineView() {
  const {
    state,
    openOverlay,
    setVoiceOpen,
    submitVoiceOrChatPrompt,
  } = useAppStore();

  const [inputText, setInputText] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  const activeConv =
    state.conversations.find((c) => c.id === state.activeConversationId) ??
    state.conversations[0];

  const handleOpenCard = (card: ChatActionCard) => {
    const ref = { conversationId: activeConv.id, cardId: card.id };
    if (card.type === 'schedule') {
      const draft = card.draft_data ?? {};
      openOverlay({
        kind: 'schedule',
        entryId: card.payload_id,
        jobId: typeof draft.jobId === 'string' ? draft.jobId : state.jobs[0]?.id ?? 'job-001',
        dateIso: typeof draft.dateIso === 'string' ? draft.dateIso : TODAY_ISO,
        initialDeltaHours: typeof draft.deltaHours === 'number' ? draft.deltaHours : 2,
        initialReason: typeof draft.reason === 'string' ? draft.reason : 'Imprevisto en instalación',
        initialNotes: typeof draft.notes === 'string' ? draft.notes : undefined,
        chatCardRef: ref,
      });
    } else if (card.type === 'quote') {
      const draft = card.draft_data ?? {};
      openOverlay({
        kind: 'quote',
        quoteId: card.payload_id,
        initialClientId: typeof draft.clientId === 'string' ? draft.clientId : undefined,
        initialTitle: typeof draft.title === 'string' ? draft.title : undefined,
        voiceNote: typeof draft.voiceNote === 'string' ? draft.voiceNote : undefined,
        initialLines: Array.isArray(draft.lines) ? (draft.lines as QuoteLine[]) : undefined,
        chatCardRef: ref,
      });
    } else if (card.type === 'ticket') {
      const draft = card.draft_data ?? {};
      openOverlay({
        kind: 'ticket',
        initialSupplier: typeof draft.supplier === 'string' ? draft.supplier : undefined,
        initialCategory: (draft.category as ExpenseCategory | undefined) ?? 'Material',
        initialTotalCents: typeof draft.totalCents === 'number' ? draft.totalCents : 6600,
        initialVatRate: typeof draft.vatRate === 'number' ? draft.vatRate : 21,
        initialJobId: typeof draft.jobId === 'string' ? draft.jobId : undefined,
        initialImageUrl: typeof draft.imageUrl === 'string' ? draft.imageUrl : undefined,
        chatCardRef: ref,
      });
    }
  };

  const handleSend = (textToSend: string, viaVoice = false) => {
    if (!textToSend.trim()) return;
    submitVoiceOrChatPrompt(textToSend, viaVoice);
    setInputText('');
    window.setTimeout(() => {
      endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 60);
  };

  const getBadgeClasses = (tone: ChatActionCard['badge_tone']) => {
    switch (tone) {
      case 'warning':
        return 'bg-warning-container text-on-warning-container';
      case 'success':
        return 'bg-success-container text-on-success-container';
      case 'info':
        return 'bg-info-container text-on-info-container';
      default:
        return 'bg-terracotta-soft text-on-primary-container';
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Historial de mensajes */}
      <div className="flex-1 overflow-y-auto no-scrollbar px-4 pt-4 pb-4 flex flex-col gap-4">
        {activeConv.messages.map((msg) => {
          if (msg.sender === 'user') {
            return (
              <div
                key={msg.id}
                className="self-end max-w-[86%] bg-secondary text-on-secondary rounded-[20px] rounded-br-sm p-3.5 flex flex-col gap-1 shadow-xs"
              >
                <div className="flex items-center gap-1.5 opacity-80">
                  {msg.via_voice && <Mic className="w-3.5 h-3.5" aria-hidden="true" />}
                  <span className="text-[11px] font-semibold">{msg.timestamp_label}</span>
                </div>
                <p className="text-[14px] leading-[20px]">{msg.text}</p>
              </div>
            );
          }

          return (
            <div key={msg.id} className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-terracotta text-white flex items-center justify-center shrink-0">
                  <Bot className="w-4 h-4" aria-hidden="true" />
                </div>
                <span className="text-[12px] font-semibold text-on-surface leading-[17px]">
                  {msg.text}
                </span>
              </div>

              {msg.action_cards && msg.action_cards.length > 0 && (
                <div className="flex flex-col gap-3">
                  {msg.action_cards.map((card) => (
                    <article
                      key={card.id}
                      className="bg-surface-warm-card border border-outline-variant rounded-[20px] p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col gap-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[12px] text-on-surface-variant tabular-nums">
                          {card.code}
                        </span>
                        <span
                          className={`px-2.5 py-0.5 rounded-full font-semibold text-[11px] ${
                            card.resolved
                              ? 'bg-success-container text-on-success-container'
                              : getBadgeClasses(card.badge_tone)
                          }`}
                        >
                          {card.resolved ? 'Confirmado' : card.badge_label}
                        </span>
                      </div>

                      <h2 className="text-[15px] font-semibold text-on-surface">{card.title}</h2>
                      <p className="text-[13px] leading-[19px] text-on-surface-variant">
                        {card.description}
                      </p>

                      <button
                        type="button"
                        onClick={() => handleOpenCard(card)}
                        className={`min-h-[48px] w-full px-3 rounded-xl font-semibold text-[14px] flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                          card.resolved
                            ? 'bg-surface-container text-on-surface-variant'
                            : card.cta_variant === 'primary'
                              ? 'bg-primary hover:bg-terracotta text-white shadow-sm'
                              : 'bg-secondary hover:bg-secondary/90 text-white'
                        }`}
                      >
                        {card.resolved ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-free" />
                        ) : card.type === 'schedule' ? (
                          <CalendarClock className="w-4 h-4" />
                        ) : card.type === 'ticket' ? (
                          <ReceiptText className="w-4 h-4" />
                        ) : (
                          <FileText className="w-4 h-4" />
                        )}
                        <span>{card.resolved ? 'Ver o editar de nuevo' : card.cta_label}</span>
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {/* BottomQuickBar fijo */}
      <footer className="shrink-0 bg-surface-container-lowest border-t border-outline-variant p-3.5 shadow-[0_-4px_16px_rgba(15,23,42,0.06)] flex flex-col gap-2.5">
        {/* Chips rápidos */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() =>
              handleSend('Prepara presupuesto de pintura para Elena Navarro', false)
            }
            className="min-h-[34px] px-3 rounded-full bg-surface-container-low border border-outline-variant hover:border-terracotta font-semibold text-[11px] text-on-surface shrink-0 cursor-pointer"
          >
            Nuevo presupuesto
          </button>
          <button
            type="button"
            onClick={() =>
              handleSend('Registrar salida 1 hora más tarde hoy en baño Marta', false)
            }
            className="min-h-[34px] px-3 rounded-full bg-surface-container-low border border-outline-variant hover:border-terracotta font-semibold text-[11px] text-on-surface shrink-0 cursor-pointer"
          >
            Registrar salida
          </button>
          <button
            type="button"
            onClick={() => handleSend('Añadir gasto ticket ferretería de 74 euros', false)}
            className="min-h-[34px] px-3 rounded-full bg-surface-container-low border border-outline-variant hover:border-terracotta font-semibold text-[11px] text-on-surface shrink-0 cursor-pointer"
          >
            Añadir gasto
          </button>
        </div>

        {/* Entrada rápida de texto */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend(inputText, false);
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Escribe una orden rápida..."
            className="flex-1 min-h-[44px] rounded-xl bg-surface-container-low border border-outline-variant px-3 text-[13px] text-on-surface placeholder:text-outline focus:outline-none focus:border-terracotta"
          />
          <button
            type="submit"
            disabled={!inputText.trim()}
            aria-label="Enviar mensaje"
            className="min-h-[44px] min-w-[44px] rounded-xl bg-secondary text-white flex items-center justify-center disabled:opacity-40 cursor-pointer"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>

        {/* Botón protagonista de micrófono */}
        <button
          type="button"
          onClick={() => setVoiceOpen(true)}
          className="min-h-[52px] w-full px-6 rounded-full bg-terracotta hover:bg-primary text-white font-semibold text-[14px] flex items-center justify-center gap-2 shadow-md active:scale-[0.98] transition-transform cursor-pointer"
        >
          <Mic className="w-5 h-5" aria-hidden="true" />
          <span>Pulsa y habla sin conexión</span>
        </button>
      </footer>
    </div>
  );
}
