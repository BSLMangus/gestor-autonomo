import { Camera, Home, Mic } from "lucide-react";
import type { AppRoute } from "../core/navigation/routes";

interface GlobalBottomNavProps {
  currentRoute: AppRoute;
  isSubmitting: boolean;
  onNavigateHome: () => void;
  onOpenVoice: () => void;
  onTriggerCamera: () => void;
}

export function GlobalBottomNav({
  currentRoute,
  isSubmitting,
  onNavigateHome,
  onOpenVoice,
  onTriggerCamera,
}: GlobalBottomNavProps) {
  const isHome = currentRoute.name === "home";

  return (
    <nav
      data-testid="global-bottom-nav"
      aria-label="Acciones globales"
      className="flex h-16 shrink-0 items-center justify-between border-t border-outline-variant bg-surface-container-lowest px-6 pb-safe z-30"
    >
      <button
        type="button"
        data-testid="global-nav-home-btn"
        aria-current={isHome ? "page" : undefined}
        onClick={onNavigateHome}
        className={`flex min-w-[64px] min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-2xl transition-colors cursor-pointer ${
          isHome
            ? "text-on-primary-container"
            : "text-on-surface-variant hover:text-on-surface"
        }`}
      >
        <Home
          className="h-[22px] w-[22px]"
          strokeWidth={isHome ? 2.4 : 1.9}
          aria-hidden="true"
        />
        <span className="text-[11px] leading-[14px] font-semibold tracking-[0.2px]">
          Inicio
        </span>
      </button>

      <button
        type="button"
        data-testid="global-nav-voice-btn"
        disabled={isSubmitting}
        onClick={onOpenVoice}
        className="-mt-5 inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full bg-terracotta px-6 text-[14px] font-semibold text-white shadow-[0_6px_18px_rgba(234,88,12,0.32)] transition-transform hover:bg-primary active:scale-[0.97] disabled:opacity-45 cursor-pointer"
      >
        <Mic className="h-[20px] w-[20px]" strokeWidth={2.2} aria-hidden="true" />
        <span>Voz</span>
      </button>

      <button
        type="button"
        data-testid="global-nav-camera-btn"
        disabled={isSubmitting}
        onClick={onTriggerCamera}
        className="flex min-w-[64px] min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-2xl text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-45 cursor-pointer"
      >
        <Camera className="h-[22px] w-[22px]" strokeWidth={1.9} aria-hidden="true" />
        <span className="text-[11px] leading-[14px] font-semibold tracking-[0.2px]">
          Cámara
        </span>
      </button>
    </nav>
  );
}
