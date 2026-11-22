import React, { useState } from 'react';
import { Mic, Send, Sparkles, Square, X } from 'lucide-react';
import { useAppStore } from '../../services/mockStore';

const QUICK_SCENARIOS = [
  {
    label: 'Apuntar 1,5 h extra hoy en baño de Marta',
    prompt: 'Apunta 1,5 horas extra hoy en el baño de Marta Ruiz por ajuste de grifería empotrada.',
  },
  {
    label: 'Presupuesto alicatado para Elena Navarro',
    prompt: 'Prepara presupuesto para Elena Navarro de 10 m2 de alicatado porcelánico y 6 horas de remates.',
  },
  {
    label: 'Ticket gasoil Repsol de 84,50 €',
    prompt: 'Añade un ticket de gasoil en Repsol de 84,50 euros con IVA incluido.',
  },
];

export function GlobalVoiceOverlay() {
  const { voiceOpen, setVoiceOpen, submitVoiceOrChatPrompt, navigate } = useAppStore();
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);

  if (!voiceOpen) return null;

  const handleTrigger = (prompt: string, viaVoice: boolean) => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    submitVoiceOrChatPrompt(trimmed, viaVoice);
    setText('');
    setListening(false);
    setVoiceOpen(false);
    navigate('#/asistente');
  };

  const toggleSimulatedMic = () => {
    if (listening) {
      setListening(false);
      if (!text.trim()) {
        setText(
          'Apunta 2 horas extra hoy en la obra de Marta Ruiz por el codo de desagüe y prepara presupuesto de pintura para Elena.',
        );
      }
    } else {
      setListening(true);
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Cerrar asistente de voz"
        onClick={() => {
          setListening(false);
          setVoiceOpen(false);
        }}
        className="absolute inset-0 bg-secondary/45 backdrop-blur-[1px]"
      />

      <div className="relative z-10 bg-surface-container-lowest border-t border-outline-variant rounded-t-[24px] p-4 pb-6 shadow-2xl flex flex-col gap-4">
        <div className="w-10 h-1.5 bg-outline-variant rounded-full mx-auto" />

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-2xl bg-terracotta text-white flex items-center justify-center">
              <Sparkles className="w-4 h-4" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-[16px] font-semibold text-on-surface">
                Asistente por voz
              </h2>
              <p className="text-[12px] text-on-success-container font-semibold">
                100% Local · Funciona sin cobertura
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setListening(false);
              setVoiceOpen(false);
            }}
            aria-label="Cerrar"
            className="w-11 h-11 rounded-full hover:bg-surface-container flex items-center justify-center text-on-surface-variant"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Botón de simulación de escucha */}
        <div className="bg-surface-warm-card border border-outline-variant rounded-2xl p-4 flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={toggleSimulatedMic}
            className={`w-16 h-16 rounded-full flex items-center justify-center text-white shadow-md transition-transform active:scale-95 cursor-pointer ${
              listening ? 'bg-coral-alert ring-4 ring-error-container' : 'bg-terracotta'
            }`}
            aria-label={listening ? 'Detener dictado' : 'Iniciar dictado'}
          >
            {listening ? <Square className="w-6 h-6 fill-current" /> : <Mic className="w-7 h-7" />}
          </button>
          <p className="text-[13px] text-center text-on-surface-variant">
            {listening
              ? 'Escuchando en local… pulsa de nuevo para transcribir'
              : 'Pulsa el micrófono para simular dictado, elige un ejemplo o escribe abajo'}
          </p>
        </div>

        {/* Ejemplos de un toque */}
        <div className="flex flex-col gap-2">
          <span className="text-[12px] font-semibold text-on-surface-variant">
            Prueba en un toque
          </span>
          <div className="flex flex-col gap-1.5">
            {QUICK_SCENARIOS.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => handleTrigger(item.prompt, true)}
                className="min-h-[44px] px-3 py-2 rounded-xl bg-surface-container-low border border-outline-variant hover:border-terracotta text-left text-[13px] font-medium text-on-surface transition-colors cursor-pointer"
              >
                “{item.label}”
              </button>
            ))}
          </div>
        </div>

        {/* Entrada libre */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleTrigger(text, listening);
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="O escribe aquí tu nota de obra..."
            className="flex-1 min-h-[48px] rounded-xl bg-surface-container-low border border-outline-variant px-3.5 text-[14px] text-on-surface placeholder:text-outline focus:outline-none focus:border-terracotta focus:ring-1 focus:ring-terracotta"
          />
          <button
            type="submit"
            disabled={!text.trim()}
            aria-label="Enviar al asistente"
            className="min-h-[48px] min-w-[48px] rounded-xl bg-primary text-white flex items-center justify-center disabled:opacity-40 cursor-pointer"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>
      </div>
    </div>
  );
}
