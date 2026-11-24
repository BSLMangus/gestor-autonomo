import { Mic, Pause, Send, Sparkles, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TEXT_LIMITS } from "../core/contracts/textLimits";
import {
  joinTranscriptSegments,
  type ContinuousVoiceSession,
  type VoiceInputAdapter,
  type VoicePauseReason,
} from "../core/hardware/voiceAdapter";

interface GlobalVoiceOverlayProps {
  open: boolean;
  voiceAdapter: VoiceInputAdapter;
  isSubmitting: boolean;
  onSubmitTranscript: (text: string) => Promise<void>;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  examples?: string[];
  placeholder?: string;
  zIndexClass?: string;
  testIdPrefix?: string;
}

const VOICE_EXAMPLES = [
  "¿Qué puedo hacer con la app?",
  "Planifica una obra del 22 al 30 de este mes",
  "Presupuesto para reforma de baño: 1 plato de ducha",
];

function pauseReasonToMessage(reason: VoicePauseReason, fallbackMessage?: string): string {
  if (fallbackMessage && fallbackMessage.trim().length > 0) {
    return fallbackMessage;
  }
  switch (reason) {
    case "app_backgrounded":
      return "Dictado en pausa al salir de la app. Tu texto está guardado: pulsa Seguir o Enviar.";
    case "audio_focus_lost":
      return "Dictado pausado por otra fuente de audio. Tu texto está a salvo.";
    case "inactivity_timeout":
      return "Dictado pausado tras un silencio largo. Pulsa Seguir para continuar o Enviar.";
    case "error":
      return "Se pausó el micrófono. Puedes seguir editando el texto o reintentar.";
    case "user":
    default:
      return "Dictado en pausa. Edita el texto libremente, pulsa Seguir o pulsa Enviar.";
  }
}

export function GlobalVoiceOverlay({
  open,
  voiceAdapter,
  isSubmitting,
  onSubmitTranscript,
  onClose,
  title = "Asistente por voz",
  subtitle = "100% Local · Funciona sin cobertura",
  examples = VOICE_EXAMPLES,
  placeholder = "Ej: Presupuesto para reforma de baño: 1 plato de ducha",
  zIndexClass = "z-50",
  testIdPrefix,
}: GlobalVoiceOverlayProps) {
  const rootTestId = testIdPrefix ?? "global-voice-overlay";
  const prefix = testIdPrefix ?? "voice-overlay";

  const [phase, setPhase] = useState<"listening" | "paused" | "processing">("listening");
  const [committedText, setCommittedText] = useState("");
  const [interimText, setInterimText] = useState("");
  const [statusMessage, setStatusMessage] = useState<string>(
    "Escuchando en español... Habla con calma, nada se envía hasta pulsar Enviar."
  );
  const [maxSheetHeightPx, setMaxSheetHeightPx] = useState<number | null>(null);

  const sessionTokenRef = useRef(0);
  const activeSessionRef = useRef<ContinuousVoiceSession | null>(null);
  const committedRef = useRef("");
  const interimRef = useRef("");
  const hadExplicitErrorRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  committedRef.current = committedText;
  interimRef.current = interimText;

  const combinedText =
    phase === "listening"
      ? joinTranscriptSegments(committedText, interimText)
      : committedText;

  const stopActiveSessionAndConsolidate = useCallback(
    (nextPhase: "paused" | "processing", nextStatus?: string) => {
      sessionTokenRef.current += 1;
      const merged = joinTranscriptSegments(committedRef.current, interimRef.current);
      committedRef.current = merged;
      interimRef.current = "";
      setCommittedText(merged);
      setInterimText("");
      setPhase(nextPhase);
      if (nextStatus !== undefined) {
        setStatusMessage(nextStatus);
      }

      const active = activeSessionRef.current;
      activeSessionRef.current = null;
      if (active) {
        void active.stop();
      } else {
        void voiceAdapter.stop?.();
      }
      return merged;
    },
    [voiceAdapter]
  );

  const startListeningSession = useCallback(async () => {
    const token = (sessionTokenRef.current += 1);
    hadExplicitErrorRef.current = false;

    const prev = activeSessionRef.current;
    activeSessionRef.current = null;
    if (prev) {
      await prev.stop().catch(() => undefined);
    }
    if (sessionTokenRef.current !== token) return;

    setPhase("listening");
    setInterimText("");
    setStatusMessage(
      "Escuchando en español... Haz pausas sin miedo, nada se envía hasta pulsar Enviar."
    );

    if (typeof voiceAdapter.startContinuousEsEs === "function") {
      try {
        const session = await voiceAdapter.startContinuousEsEs((ev) => {
          if (sessionTokenRef.current !== token) return;
          if (ev.type === "listening") {
            setPhase("listening");
            return;
          }
          if (ev.type === "partial") {
            setInterimText(ev.text);
            return;
          }
          if (ev.type === "final") {
            const next = joinTranscriptSegments(committedRef.current, ev.text);
            committedRef.current = next;
            interimRef.current = "";
            setCommittedText(next);
            setInterimText("");
            return;
          }
          if (ev.type === "permission_denied") {
            sessionTokenRef.current += 1;
            activeSessionRef.current = null;
            setPhase("paused");
            setInterimText("");
            setStatusMessage(
              "Permiso de micrófono denegado. Puedes escribir tu orden directamente aquí."
            );
            return;
          }
          if (ev.type === "unavailable") {
            sessionTokenRef.current += 1;
            activeSessionRef.current = null;
            setPhase("paused");
            setInterimText("");
            setStatusMessage(
              "Dictado por voz no disponible en este contexto. Escribe tu orden aquí:"
            );
            return;
          }
          if (ev.type === "error") {
            hadExplicitErrorRef.current = true;
            setStatusMessage(ev.reason || "Incidencia de audio.");
            if (ev.fatal) {
              sessionTokenRef.current += 1;
              activeSessionRef.current = null;
              const merged = joinTranscriptSegments(committedRef.current, interimRef.current);
              committedRef.current = merged;
              interimRef.current = "";
              setCommittedText(merged);
              setInterimText("");
              setPhase("paused");
            }
            return;
          }
          if (ev.type === "paused") {
            sessionTokenRef.current += 1;
            activeSessionRef.current = null;
            const merged = joinTranscriptSegments(committedRef.current, interimRef.current);
            committedRef.current = merged;
            interimRef.current = "";
            setCommittedText(merged);
            setInterimText("");
            setPhase("paused");
            if (!(ev.reason === "error" && hadExplicitErrorRef.current && !ev.message)) {
              setStatusMessage(pauseReasonToMessage(ev.reason, ev.message));
            }
          }
        });

        if (sessionTokenRef.current !== token) {
          await session?.stop().catch(() => undefined);
          return;
        }
        activeSessionRef.current = session;
      } catch (err) {
        if (sessionTokenRef.current !== token) return;
        setPhase("paused");
        setStatusMessage(err instanceof Error ? err.message : "No se pudo iniciar el micrófono.");
      }
      return;
    }

    try {
      const res = await voiceAdapter.listenOnceEsEs();
      if (sessionTokenRef.current !== token) return;
      if (res.status === "ok" && res.text.trim()) {
        const next = joinTranscriptSegments(committedRef.current, res.text.trim());
        committedRef.current = next;
        setCommittedText(next);
        setPhase("paused");
        setStatusMessage("Texto dictado listo. Edítalo, sigue dictando o pulsa Enviar.");
        return;
      }
      setPhase("paused");
      if (res.status === "permission_denied") {
        setStatusMessage(
          "Permiso de micrófono denegado. Puedes escribir tu orden directamente aquí."
        );
      } else if (res.status === "unavailable") {
        setStatusMessage(
          "Reconocimiento de voz offline no disponible en este dispositivo. Escribe tu orden aquí:"
        );
      } else if (res.status === "error") {
        setStatusMessage(`Incidencia de audio (${res.reason}). Escribe o reintenta:`);
      } else {
        setStatusMessage("Dictado en pausa. Escribe o pulsa Seguir cuando quieras.");
      }
    } catch (err) {
      if (sessionTokenRef.current !== token) return;
      setPhase("paused");
      setStatusMessage(err instanceof Error ? err.message : "No se pudo iniciar el micrófono.");
    }
  }, [voiceAdapter]);

  useEffect(() => {
    if (!open) {
      sessionTokenRef.current += 1;
      const active = activeSessionRef.current;
      activeSessionRef.current = null;
      if (active) {
        void active.stop();
      } else {
        void voiceAdapter.stop?.();
      }
      return;
    }

    committedRef.current = "";
    interimRef.current = "";
    setCommittedText("");
    setInterimText("");
    void startListeningSession();

    return () => {
      sessionTokenRef.current += 1;
      const active = activeSessionRef.current;
      activeSessionRef.current = null;
      if (active) {
        void active.stop();
      } else {
        void voiceAdapter.stop?.();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || typeof window === "undefined") {
      setMaxSheetHeightPx(null);
      return;
    }
    const updateViewport = () => {
      const vpHeight = window.visualViewport?.height ?? window.innerHeight;
      setMaxSheetHeightPx(Math.max(260, Math.floor(vpHeight - 16)));
    };
    updateViewport();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", updateViewport);
    window.addEventListener("resize", updateViewport);
    return () => {
      vv?.removeEventListener("resize", updateViewport);
      window.removeEventListener("resize", updateViewport);
    };
  }, [open]);

  useEffect(() => {
    if (phase !== "listening" || !textareaRef.current) return;
    textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
  }, [phase, combinedText]);

  if (!open) return null;

  const handleClose = () => {
    stopActiveSessionAndConsolidate("paused");
    onClose();
  };

  const handleManualSubmit = async () => {
    if (phase === "processing" || isSubmitting) return;
    const candidate = joinTranscriptSegments(committedRef.current, interimRef.current).trim();
    if (!candidate) return;

    const finalText = stopActiveSessionAndConsolidate("processing", `Procesando: «${candidate}»`).trim();
    try {
      await onSubmitTranscript(finalText);
    } catch (err) {
      setPhase("paused");
      setStatusMessage(
        err instanceof Error ? err.message : "No se pudo procesar el mensaje. Reintenta Enviar."
      );
    }
  };

  const handleToggleMic = () => {
    if (phase === "processing" || isSubmitting) return;
    if (phase === "listening") {
      stopActiveSessionAndConsolidate(
        "paused",
        "Dictado en pausa. Puedes editar el texto, pulsar Seguir o Enviar."
      );
    } else {
      void startListeningSession();
    }
  };

  const handleClear = () => {
    if (phase === "processing" || isSubmitting) return;
    committedRef.current = "";
    interimRef.current = "";
    setCommittedText("");
    setInterimText("");
    if (phase === "paused") {
      setStatusMessage("Texto borrado. Pulsa Seguir dictando o escribe de nuevo.");
    }
  };

  const handleExampleClick = async (ex: string) => {
    if (phase === "processing" || isSubmitting) return;
    stopActiveSessionAndConsolidate("processing", `Procesando: «${ex}»`);
    try {
      await onSubmitTranscript(ex);
    } catch (err) {
      setPhase("paused");
      setStatusMessage(err instanceof Error ? err.message : "No se pudo enviar el ejemplo.");
    }
  };

  const hasText = combinedText.trim().length > 0;
  const locked = phase === "processing" || isSubmitting;

  const dialog = (
    <div
      data-testid={rootTestId}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className={`fixed inset-0 ${zIndexClass} flex flex-col justify-end bg-secondary/45 backdrop-blur-[1px]`}
    >
      <div
        style={maxSheetHeightPx ? { maxHeight: `${maxSheetHeightPx}px` } : undefined}
        className="mx-auto w-full max-w-md max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-t-[24px] border-t border-outline-variant bg-surface-container-lowest p-4 pb-6 shadow-2xl space-y-3"
      >
        <div className="mx-auto h-1.5 w-10 rounded-full bg-outline-variant" />

        <div className="flex items-center justify-between border-b border-outline-variant pb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${
                phase === "listening"
                  ? "animate-pulse bg-terracotta text-white shadow-sm"
                  : "bg-secondary text-white"
              }`}
            >
              {phase === "listening" ? <Mic className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-[16px] font-semibold text-on-surface">{title}</h3>
              <p className="truncate text-[12px] font-semibold text-on-success-container">
                {subtitle}
              </p>
            </div>
          </div>
          <button
            type="button"
            data-testid={`${prefix}-close-btn`}
            aria-label="Cerrar micrófono"
            onClick={handleClose}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="rounded-2xl border border-outline-variant bg-surface-warm-card px-3.5 py-2.5 text-center">
          <p data-testid={`${prefix}-status`} className="text-[12px] leading-relaxed text-on-surface">
            {statusMessage}
          </p>
        </div>

        {examples.length > 0 && !hasText && (
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold text-on-surface-variant">Ejemplos rápidos</div>
            <div className="flex flex-col gap-1.5">
              {examples.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  disabled={locked}
                  onClick={() => void handleExampleClick(ex)}
                  className="min-h-[40px] rounded-xl border border-outline-variant bg-surface-container-low px-3 py-2 text-left text-[12px] font-medium text-on-surface hover:border-terracotta transition-colors cursor-pointer disabled:opacity-50"
                >
                  “{ex}”
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2.5">
          <textarea
            ref={textareaRef}
            rows={3}
            maxLength={TEXT_LIMITS.CHAT_INPUT}
            data-testid={`${prefix}-manual-input`}
            disabled={locked}
            value={combinedText}
            onFocus={() => {
              if (phase === "listening") {
                stopActiveSessionAndConsolidate(
                  "paused",
                  "Dictado en pausa para editar. Pulsa Seguir para dictar más o Enviar."
                );
              }
            }}
            onChange={(e) => {
              const next = e.target.value;
              if (phase === "listening") {
                stopActiveSessionAndConsolidate(
                  "paused",
                  "Dictado en pausa para editar. Pulsa Seguir para dictar más o Enviar."
                );
              }
              committedRef.current = next;
              interimRef.current = "";
              setCommittedText(next);
              setInterimText("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                e.stopPropagation();
                void handleManualSubmit();
              }
            }}
            placeholder={placeholder}
            className="w-full min-h-[88px] resize-y rounded-xl border border-outline-variant bg-surface-container-low px-3.5 py-2.5 text-[14px] leading-relaxed text-on-surface placeholder:text-outline focus:border-terracotta focus:outline-none disabled:opacity-60"
          />

          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid={`${prefix}-toggle-mic-btn`}
              data-state={phase}
              aria-label={phase === "listening" ? "Pausar dictado" : "Seguir dictando"}
              disabled={locked}
              onClick={handleToggleMic}
              className={`inline-flex min-h-[46px] shrink-0 items-center justify-center gap-1.5 rounded-xl border px-3 text-[12px] font-semibold transition-colors cursor-pointer disabled:opacity-45 ${
                phase === "listening"
                  ? "border-terracotta bg-terracotta-soft text-on-primary-container"
                  : "border-outline-variant bg-surface-container-lowest text-on-surface hover:border-terracotta"
              }`}
            >
              {phase === "listening" ? (
                <>
                  <Pause className="h-4 w-4 shrink-0" />
                  <span>Pausar</span>
                </>
              ) : (
                <>
                  <Mic className="h-4 w-4 shrink-0" />
                  <span>{hasText ? "Seguir" : "Dictar"}</span>
                </>
              )}
            </button>

            <button
              type="button"
              data-testid={`${prefix}-clear-btn`}
              aria-label="Limpiar texto dictado"
              disabled={locked || !hasText}
              onClick={handleClear}
              className="inline-flex min-h-[46px] shrink-0 items-center justify-center gap-1 rounded-xl border border-outline-variant bg-surface-container-lowest px-3 text-[12px] font-semibold text-on-surface-variant hover:text-on-surface disabled:opacity-40 cursor-pointer"
            >
              <Trash2 className="h-4 w-4 shrink-0" />
              <span>Limpiar</span>
            </button>

            <button
              type="button"
              data-testid={`${prefix}-submit-btn`}
              disabled={locked || !hasText}
              onClick={() => void handleManualSubmit()}
              className="inline-flex min-h-[46px] min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-[13px] font-semibold text-white hover:bg-terracotta disabled:opacity-45 cursor-pointer"
            >
              <Send className="h-4 w-4 shrink-0" />
              <span>Enviar</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(dialog, document.body) : dialog;
}
