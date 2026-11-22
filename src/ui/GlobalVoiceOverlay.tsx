import { Mic, MicOff, Send, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { VoiceInputAdapter } from "../core/hardware/voiceAdapter";

interface GlobalVoiceOverlayProps {
  open: boolean;
  voiceAdapter: VoiceInputAdapter;
  isSubmitting: boolean;
  onSubmitTranscript: (text: string) => Promise<void>;
  onClose: () => void;
}

const VOICE_EXAMPLES = [
  "Planifica una obra del 22 al 30 de este mes",
  "Hoy terminé 2 horas antes en la obra porque estaba todo listo",
  "Presupuesto para reforma de baño: 1 plato de ducha",
];

export function GlobalVoiceOverlay({
  open,
  voiceAdapter,
  isSubmitting,
  onSubmitTranscript,
  onClose,
}: GlobalVoiceOverlayProps) {
  const [phase, setPhase] = useState<"listening" | "manual" | "processing">("listening");
  const [manualText, setManualText] = useState("");
  const [statusMessage, setStatusMessage] = useState<string>(
    "Escuchando en español... Dicta un presupuesto, parte de jornada, gasto, cliente o consulta."
  );
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!open) {
      cancelledRef.current = true;
      void voiceAdapter.stop?.();
      return;
    }

    cancelledRef.current = false;
    setPhase("listening");
    setManualText("");
    setStatusMessage("Escuchando en español... Habla ahora.");

    let mounted = true;
    voiceAdapter
      .listenOnceEsEs()
      .then(async (res) => {
        if (!mounted || cancelledRef.current) return;
        if (res.status === "ok" && res.text.trim()) {
          setPhase("processing");
          setStatusMessage(`Procesando: «${res.text.trim()}»`);
          await onSubmitTranscript(res.text.trim());
          return;
        }
        setPhase("manual");
        if (res.status === "permission_denied") {
          setStatusMessage(
            "Permiso de micrófono denegado. Puedes escribir tu orden directamente aquí."
          );
        } else if (res.status === "unavailable") {
          setStatusMessage(
            "Reconocimiento de voz offline no disponible en este dispositivo. Escribe tu orden aquí:"
          );
        } else if (res.status === "cancelled") {
          setStatusMessage("No se detectó voz o se canceló. Reintenta con el micrófono o escribe:");
        } else if (res.status === "error") {
          setStatusMessage(`Incidencia de audio (${res.reason}). Escribe o reintenta:`);
        } else {
          setStatusMessage("No se detectó voz. Reintenta con el micrófono o escribe:");
        }
      })
      .catch((err) => {
        if (!mounted || cancelledRef.current) return;
        setPhase("manual");
        setStatusMessage(err instanceof Error ? err.message : "No se pudo iniciar el micrófono.");
      });

    return () => {
      mounted = false;
      cancelledRef.current = true;
      void voiceAdapter.stop?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const handleClose = () => {
    cancelledRef.current = true;
    void voiceAdapter.stop?.();
    onClose();
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = manualText.trim();
    if (!trimmed || isSubmitting) return;
    setPhase("processing");
    await onSubmitTranscript(trimmed);
  };

  const handleRetryMic = async () => {
    cancelledRef.current = false;
    setPhase("listening");
    setStatusMessage("Escuchando en español... Habla ahora.");
    const res = await voiceAdapter.listenOnceEsEs();
    if (cancelledRef.current) return;
    if (res.status === "ok" && res.text.trim()) {
      setPhase("processing");
      await onSubmitTranscript(res.text.trim());
      return;
    }
    setPhase("manual");
    setStatusMessage("No se recibió audio; escribe o reintenta cuando quieras.");
  };

  return (
    <div
      data-testid="global-voice-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Asistente por voz"
      className="fixed inset-0 z-50 flex flex-col justify-end bg-secondary/45 backdrop-blur-[1px]"
    >
      <div className="mx-auto w-full max-w-md rounded-t-[24px] border-t border-outline-variant bg-surface-container-lowest p-4 pb-6 shadow-2xl space-y-3.5">
        <div className="mx-auto h-1.5 w-10 rounded-full bg-outline-variant" />

        <div className="flex items-center justify-between border-b border-outline-variant pb-3">
          <div className="flex items-center gap-2.5">
            <span
              className={`flex h-10 w-10 items-center justify-center rounded-2xl ${
                phase === "listening"
                  ? "animate-pulse bg-terracotta text-white shadow-sm"
                  : "bg-secondary text-white"
              }`}
            >
              {phase === "listening" ? <Mic className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
            </span>
            <div>
              <h3 className="text-[16px] font-semibold text-on-surface">Asistente por voz</h3>
              <p className="text-[12px] font-semibold text-on-success-container">
                100% Local · Funciona sin cobertura
              </p>
            </div>
          </div>
          <button
            type="button"
            data-testid="voice-overlay-close-btn"
            aria-label="Cerrar micrófono"
            onClick={handleClose}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="rounded-2xl border border-outline-variant bg-surface-warm-card p-3.5 text-center space-y-2">
          <p data-testid="voice-overlay-status" className="text-[13px] leading-relaxed text-on-surface">
            {statusMessage}
          </p>

          {phase === "listening" && (
            <button
              type="button"
              onClick={() => {
                cancelledRef.current = true;
                void voiceAdapter.stop?.();
                setPhase("manual");
                setStatusMessage("Dictado detenido. Escribe manualmente o pulsa micrófono:");
              }}
              className="min-h-[44px] rounded-xl border border-outline-variant bg-surface-container-lowest px-4 text-[13px] font-semibold text-on-surface hover:border-terracotta cursor-pointer"
            >
              Detener y escribir
            </button>
          )}
        </div>

        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold text-on-surface-variant">Ejemplos rápidos</div>
          <div className="flex flex-col gap-1.5">
            {VOICE_EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                disabled={phase === "processing" || isSubmitting}
                onClick={() => {
                  setPhase("processing");
                  void onSubmitTranscript(ex);
                }}
                className="min-h-[42px] rounded-xl border border-outline-variant bg-surface-container-low px-3 py-2 text-left text-[12px] font-medium text-on-surface hover:border-terracotta transition-colors cursor-pointer disabled:opacity-50"
              >
                “{ex}”
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={(e) => void handleManualSubmit(e)} className="flex items-center gap-2">
          <input
            type="text"
            data-testid="voice-overlay-manual-input"
            disabled={phase === "processing" || isSubmitting}
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
            placeholder="Ej: Presupuesto para reforma de baño: 1 plato de ducha"
            className="min-h-[48px] flex-1 rounded-xl border border-outline-variant bg-surface-container-low px-3.5 text-[14px] text-on-surface placeholder:text-outline focus:border-terracotta focus:outline-none"
          />
          {phase === "manual" && (
            <button
              type="button"
              aria-label="Reintentar voz"
              onClick={() => void handleRetryMic()}
              className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-outline-variant bg-terracotta-soft text-on-primary-container hover:border-terracotta cursor-pointer"
            >
              {phase === "manual" ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
            </button>
          )}
          <button
            type="submit"
            data-testid="voice-overlay-submit-btn"
            disabled={phase === "processing" || isSubmitting || manualText.trim().length === 0}
            className="inline-flex min-h-[48px] items-center gap-1.5 rounded-xl bg-primary px-4 text-[13px] font-semibold text-white hover:bg-terracotta disabled:opacity-45 cursor-pointer"
          >
            <Send className="h-4 w-4" />
            <span>Enviar</span>
          </button>
        </form>
      </div>
    </div>
  );
}
