import { Menu } from "lucide-react";
import type { ReactNode } from "react";
import type { AppRoute } from "../core/navigation/routes";
import { GlobalBottomNav } from "./GlobalBottomNav";

interface MobileShellProps {
  currentRoute: AppRoute;
  headerTitle: string;
  isSubmitting: boolean;
  onOpenDrawer: () => void;
  onNavigateHome: () => void;
  onOpenVoice: () => void;
  onTriggerCamera: () => void;
  children: ReactNode;
  banners?: ReactNode;
  bottomComposer?: ReactNode;
}

export function MobileShell({
  currentRoute,
  headerTitle,
  isSubmitting,
  onOpenDrawer,
  onNavigateHome,
  onOpenVoice,
  onTriggerCamera,
  children,
  banners,
  bottomComposer,
}: MobileShellProps) {
  return (
    <div className="mx-auto flex h-dvh w-full max-w-full sm:max-w-md flex-col bg-surface text-on-surface sm:my-2 sm:h-[calc(100dvh-1rem)] sm:rounded-[28px] sm:border sm:border-outline-variant sm:shadow-[0_24px_64px_rgba(15,23,42,0.12)] overflow-hidden overflow-x-hidden">
      {/* Franja superior mínima segura para notch/status bar */}
      <header className="relative z-20 shrink-0 bg-surface pt-safe">
        <div className="flex h-11 items-center px-3 text-on-surface">
          <button
            type="button"
            data-testid="open-threads-drawer-btn"
            aria-label="Abrir menú lateral"
            onClick={onOpenDrawer}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-outline-variant/80 bg-surface-container-lowest text-[#0F172A] shadow-[0_1px_2px_rgba(15,23,42,0.06)] hover:bg-surface-container active:scale-95 transition-colors cursor-pointer"
          >
            <Menu className="h-5 w-5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          </button>

          <h1 data-testid="shell-header-title" className="sr-only">
            {headerTitle}
          </h1>
        </div>
      </header>

      {/* Banners persistentes */}
      {banners && <div className="shrink-0">{banners}</div>}

      {/* Área central scrollable */}
      <main className="flex min-h-0 w-full max-w-full flex-1 flex-col overflow-hidden overflow-x-hidden bg-surface">
        {children}
      </main>

      {/* Compositor limpio (solo en Asistente / Chat) */}
      {bottomComposer && <div className="shrink-0">{bottomComposer}</div>}

      {/* Barra inferior minimalista de 3 acciones globales: Inicio | Voz | Cámara */}
      <GlobalBottomNav
        currentRoute={currentRoute}
        isSubmitting={isSubmitting}
        onNavigateHome={onNavigateHome}
        onOpenVoice={onOpenVoice}
        onTriggerCamera={onTriggerCamera}
      />
    </div>
  );
}
