import React from 'react';
import { ArrowLeft, CheckCircle2, Info, Menu, Settings, SquarePen, X } from 'lucide-react';
import { useAppStore } from '../../services/mockStore';
import { AppNavigationDrawer } from './AppNavigationDrawer';
import { GlobalBottomNav } from './GlobalBottomNav';
import { GlobalCameraChoiceSheet } from './GlobalCameraChoiceSheet';
import { GlobalVoiceOverlay } from './GlobalVoiceOverlay';
import { GenerativeWidgetOverlay } from './GenerativeWidgetOverlay';
import { PrintableDocumentModal } from './PrintableDocumentModal';

interface MobileShellProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export function MobileShell({ title, subtitle, children }: MobileShellProps) {
  const {
    route,
    navigate,
    setDrawerOpen,
    startNewConversation,
    toasts,
  } = useAppStore();

  const isChat = route === '#/asistente';
  const isSettings = route === '#/ajustes';
  const isClientProfile = route.startsWith('#/clientes/');
  const showBack = isSettings || isClientProfile;

  const handleBack = () => {
    if (isClientProfile) {
      navigate('#/clientes');
    } else {
      navigate('#/');
    }
  };

  return (
    <div className="min-h-dvh w-full bg-[#E5E0D8] flex items-center justify-center sm:py-4">
      <div className="relative w-full max-w-[412px] h-dvh sm:h-[844px] sm:max-h-[calc(100dvh-2rem)] bg-surface flex flex-col overflow-hidden sm:rounded-[28px] sm:border sm:border-outline-variant sm:shadow-[0_24px_64px_rgba(15,23,42,0.18)]">
        {/* Cabecera superior fija (56px) */}
        <header className="shrink-0 h-[56px] bg-surface border-b border-outline-variant px-4 flex items-center justify-between z-30">
          {isChat ? (
            <button
              type="button"
              onClick={() => navigate('#/')}
              aria-label="Cerrar asistente"
              className="w-12 h-12 -ml-2 rounded-full text-on-surface inline-flex items-center justify-center hover:bg-surface-container transition-colors cursor-pointer"
            >
              <X className="w-6 h-6" aria-hidden="true" />
            </button>
          ) : showBack ? (
            <button
              type="button"
              onClick={handleBack}
              aria-label="Volver"
              className="w-12 h-12 -ml-2 rounded-full text-on-surface inline-flex items-center justify-center hover:bg-surface-container transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-6 h-6" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Abrir menú lateral"
              className="w-12 h-12 -ml-2 rounded-full text-on-surface inline-flex items-center justify-center hover:bg-surface-container transition-colors cursor-pointer"
            >
              <Menu className="w-6 h-6" aria-hidden="true" />
            </button>
          )}

          <div className="flex flex-col items-center min-w-0 px-2">
            <h1 className="text-[16px] leading-[22px] font-semibold text-on-surface truncate">
              {title}
            </h1>
            {subtitle && (
              <span className="text-[11px] leading-[14px] font-semibold text-on-success-container truncate">
                {subtitle}
              </span>
            )}
          </div>

          {isChat ? (
            <button
              type="button"
              onClick={() => startNewConversation()}
              aria-label="Nueva conversación"
              className="w-12 h-12 -mr-2 rounded-full text-on-surface-variant inline-flex items-center justify-center hover:bg-surface-container transition-colors cursor-pointer"
            >
              <SquarePen className="w-[21px] h-[21px]" aria-hidden="true" />
            </button>
          ) : isSettings ? (
            <span className="w-12" />
          ) : (
            <button
              type="button"
              onClick={() => navigate('#/ajustes')}
              aria-label="Ajustes"
              className="w-12 h-12 -mr-2 rounded-full text-on-surface-variant inline-flex items-center justify-center hover:bg-surface-container transition-colors cursor-pointer"
            >
              <Settings className="w-[21px] h-[21px]" aria-hidden="true" />
            </button>
          )}
        </header>

        {/* Contenido principal con scroll independiente */}
        <div className="flex-1 overflow-y-auto no-scrollbar">
          {children}
        </div>

        {/* Barra inferior global (oculta en Asistente que lleva su propio BottomQuickBar) */}
        {!isChat && <GlobalBottomNav />}

        {/* Capas interactivas globales */}
        <AppNavigationDrawer />
        <GlobalVoiceOverlay />
        <GlobalCameraChoiceSheet />
        <GenerativeWidgetOverlay />
        <PrintableDocumentModal />

        {/* Toast flotante */}
        {toasts.length > 0 && (
          <div className="pointer-events-none absolute top-[66px] left-4 right-4 z-[70] flex flex-col gap-2">
            {toasts.map((toast) => (
              <div
                key={toast.id}
                className={`px-3.5 py-2.5 rounded-xl shadow-lg border text-[13px] font-semibold flex items-center gap-2 ${
                  toast.tone === 'success'
                    ? 'bg-secondary text-white border-secondary'
                    : toast.tone === 'warning'
                      ? 'bg-warning-container text-on-warning-container border-outline-variant'
                      : 'bg-surface-container-lowest text-on-surface border-outline-variant'
                }`}
              >
                {toast.tone === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <Info className="w-4 h-4 shrink-0" />
                )}
                <span className="truncate">{toast.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
