import React from 'react';
import { Camera, Home, Mic } from 'lucide-react';
import { useAppStore } from '../../services/mockStore';

export function GlobalBottomNav() {
  const { route, navigate, setVoiceOpen, setCameraSheetOpen } = useAppStore();
  const isHome = route === '#/';

  return (
    <nav
      aria-label="Navegación principal"
      className="shrink-0 h-[64px] bg-surface-container-lowest border-t border-outline-variant px-6 flex items-center justify-between z-30"
    >
      <button
        type="button"
        onClick={() => navigate('#/')}
        aria-current={isHome ? 'page' : undefined}
        className={`min-w-[64px] min-h-[48px] flex flex-col items-center justify-center gap-0.5 transition-colors ${
          isHome
            ? 'text-on-primary-container'
            : 'text-on-surface-variant hover:text-on-surface'
        }`}
      >
        <Home
          className="w-[22px] h-[22px]"
          strokeWidth={isHome ? 2.4 : 1.9}
          aria-hidden="true"
        />
        <span className="text-[11px] leading-[14px] font-semibold tracking-[0.2px]">
          Inicio
        </span>
      </button>

      <button
        type="button"
        onClick={() => setVoiceOpen(true)}
        className="-mt-5 min-h-[52px] px-6 rounded-full bg-terracotta hover:bg-primary text-white font-semibold text-[14px] inline-flex items-center justify-center gap-2 shadow-[0_6px_18px_rgba(234,88,12,0.32)] active:scale-[0.97] transition-transform cursor-pointer"
      >
        <Mic className="w-[20px] h-[20px]" strokeWidth={2.2} aria-hidden="true" />
        <span>Voz</span>
      </button>

      <button
        type="button"
        onClick={() => setCameraSheetOpen(true)}
        className="min-w-[64px] min-h-[48px] flex flex-col items-center justify-center gap-0.5 text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
      >
        <Camera className="w-[22px] h-[22px]" strokeWidth={1.9} aria-hidden="true" />
        <span className="text-[11px] leading-[14px] font-semibold tracking-[0.2px]">
          Cámara
        </span>
      </button>
    </nav>
  );
}
