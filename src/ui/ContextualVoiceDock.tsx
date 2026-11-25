import { Check, Mic, RotateCcw, X } from "lucide-react";
import { useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { VoiceInputAdapter } from "../core/hardware/voiceAdapter";
import { BACK_PRIORITY } from "../core/navigation/routes";
import { GlobalVoiceOverlay } from "./GlobalVoiceOverlay";
import {
  OverlayVoiceContext,
  type OverlayVoiceDisambiguation,
  type OverlayVoiceRegistration,
} from "./overlayVoiceContext";

export function OverlayVoiceProvider({ children }: { children: ReactNode }) {
  const [registration, setRegistration] = useState<OverlayVoiceRegistration | null>(null);
  const value = useMemo(() => ({ registration, setRegistration }), [registration]);
  return <OverlayVoiceContext.Provider value={value}>{children}</OverlayVoiceContext.Provider>;
}

function VoiceFeedbackStrip({
  lastChanges,
  lastWarnings,
  canUndo,
  onUndo,
  disambiguation,
  testIdPrefix,
}: {
  lastChanges?: string[];
  lastWarnings?: string[];
  canUndo?: boolean;
  onUndo?: () => void;
  disambiguation?: OverlayVoiceDisambiguation | null;
  testIdPrefix: string;
}) {
  const hasChanges = Boolean(lastChanges && lastChanges.length > 0);
  const hasWarnings = Boolean(lastWarnings && lastWarnings.length > 0);
  const hasDisambig = Boolean(disambiguation && disambiguation.options.length > 0);

  if (!hasChanges && !hasWarnings && !hasDisambig) {
    return null;
  }

  return (
    <div
      data-testid={`${testIdPrefix}-feedback`}
      className="w-full max-w-full overflow-hidden space-y-1.5 text-[11px]"
    >
      {(hasChanges || hasWarnings) && (
        <div className="flex flex-wrap items-center justify-between gap-1.5 rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 py-1.5 shadow-xs">
          <div className="min-w-0 flex-1 flex flex-wrap items-center gap-1">
            {lastChanges?.map((ch, idx) => (
              <span
                key={`${ch}-${idx}`}
                className="inline-flex max-w-full items-center gap-1 rounded-full status-emerald px-2 py-0.5 font-semibold break-words"
              >
                <Check className="h-3 w-3 shrink-0" />
                <span className="truncate">{ch}</span>
              </span>
            ))}
            {lastWarnings?.map((w, idx) => (
              <span
                key={`${w}-${idx}`}
                className="inline-flex max-w-full items-center rounded-full status-mustard px-2 py-0.5 font-semibold break-words"
              >
                {w}
              </span>
            ))}
          </div>
          {canUndo && onUndo && (
            <button
              type="button"
              data-testid={`${testIdPrefix}-undo-btn`}
              onClick={onUndo}
              className="inline-flex min-h-[30px] shrink-0 items-center gap-1 rounded-lg border border-[#E5DFD2] bg-[#F5F1E6] px-2.5 text-[11px] font-bold text-[#2C2621] hover:border-terracotta cursor-pointer"
            >
              <RotateCcw className="h-3 w-3 shrink-0" />
              <span>Deshacer</span>
            </button>
          )}
        </div>
      )}

      {hasDisambig && disambiguation && (
        <div
          data-testid={`${testIdPrefix}-disambiguation`}
          className="rounded-xl border border-[#EA580C]/35 bg-[#FFD6B0]/70 p-2 space-y-1.5"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 flex-1 font-semibold text-[#4A2500]">
              {disambiguation.prompt}
            </span>
            {disambiguation.onDismiss && (
              <button
                type="button"
                aria-label="Descartar sugerencias"
                onClick={disambiguation.onDismiss}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[#4A2500] hover:bg-[#FFFDF7]/70 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {disambiguation.options.map((opt) => (
              <button
                key={opt.id}
                type="button"
                data-testid={`${testIdPrefix}-disambig-${opt.id}`}
                onClick={() => disambiguation.onSelect(opt.id)}
                className="min-h-[34px] max-w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 py-1 text-left text-[11px] font-semibold text-[#2C2621] hover:border-terracotta cursor-pointer"
              >
                <span className="block truncate">{opt.label}</span>
                {opt.subtitle && (
                  <span className="block truncate text-[10px] font-normal text-[#6B6860]">
                    {opt.subtitle}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Barra inferior fija de dictado contextual dentro de GenerativeWidgetOverlay.
 */
export function ContextualVoiceDock({
  voiceAdapter,
  isSubmitting,
  registerBackHandler,
}: {
  voiceAdapter?: VoiceInputAdapter;
  isSubmitting: boolean;
  registerBackHandler?: (priority: number, handler: () => boolean) => () => void;
}) {
  const ctx = useContext(OverlayVoiceContext);
  const reg = ctx?.registration ?? null;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!reg || !reg.enabled) {
      setOpen(false);
    }
  }, [reg]);

  useEffect(() => {
    if (!open || !registerBackHandler) return;
    return registerBackHandler(BACK_PRIORITY.CONTEXTUAL_VOICE, () => {
      void voiceAdapter?.stop?.();
      setOpen(false);
      return true;
    });
  }, [open, registerBackHandler, voiceAdapter]);

  if (!reg || !reg.enabled || !voiceAdapter) {
    return null;
  }

  const handleSubmit = async (text: string) => {
    setBusy(true);
    try {
      await reg.onTranscript(text);
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <>
      <div
        data-testid="contextual-voice-dock"
        className="shrink-0 w-full max-w-full overflow-x-hidden border-t border-[#E2DDD0] bg-[#F5F1E6] px-4 py-2.5 pb-safe shadow-[0_-4px_16px_rgba(44,38,33,0.06)]"
      >
        <div className="mx-auto w-full max-w-2xl space-y-2">
          <VoiceFeedbackStrip
            lastChanges={reg.lastChanges}
            lastWarnings={reg.lastWarnings}
            canUndo={reg.canUndo}
            onUndo={reg.onUndo}
            disambiguation={reg.disambiguation}
            testIdPrefix="contextual-voice"
          />

          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-[#6B6860]">
              Puedes seguir rellenando o corrigiendo campos por audio
            </span>
            <button
              type="button"
              data-testid="overlay-voice-trigger-btn"
              disabled={isSubmitting || busy}
              onClick={() => setOpen(true)}
              className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-full bg-terracotta px-4 text-[13px] font-semibold text-white shadow-sm hover:bg-primary active:scale-[0.98] disabled:opacity-45 cursor-pointer"
            >
              <Mic className="h-4 w-4 shrink-0" />
              <span>{reg.buttonLabel ?? "Dictar campos"}</span>
            </button>
          </div>
        </div>
      </div>

      <GlobalVoiceOverlay
        open={open}
        voiceAdapter={voiceAdapter}
        isSubmitting={isSubmitting || busy}
        title={reg.title}
        subtitle={reg.subtitle ?? "Dictado incremental · No borra lo ya relleno"}
        examples={reg.examples}
        placeholder={reg.placeholder}
        zIndexClass="z-[60]"
        testIdPrefix="contextual-voice-overlay"
        onSubmitTranscript={handleSubmit}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

/**
 * Botón compacto autocontenido de dictado incremental para modales o formularios fuera del overlay.
 */
export function InlineVoiceFormTrigger({
  voiceAdapter,
  registerBackHandler,
  title,
  subtitle = "Dictado incremental · Solo modifica lo mencionado",
  placeholder,
  examples,
  buttonLabel = "Dictar",
  disabled = false,
  testId = "inline-voice-trigger-btn",
  onTranscript,
  lastChanges,
  lastWarnings,
  canUndo,
  onUndo,
  disambiguation,
}: {
  voiceAdapter?: VoiceInputAdapter;
  registerBackHandler?: (priority: number, handler: () => boolean) => () => void;
  title: string;
  subtitle?: string;
  placeholder: string;
  examples: string[];
  buttonLabel?: string;
  disabled?: boolean;
  testId?: string;
  onTranscript: (text: string) => Promise<void> | void;
  lastChanges?: string[];
  lastWarnings?: string[];
  canUndo?: boolean;
  onUndo?: () => void;
  disambiguation?: OverlayVoiceDisambiguation | null;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !registerBackHandler) return;
    return registerBackHandler(BACK_PRIORITY.CONTEXTUAL_VOICE, () => {
      void voiceAdapter?.stop?.();
      setOpen(false);
      return true;
    });
  }, [open, registerBackHandler, voiceAdapter]);

  if (!voiceAdapter) return null;

  const handleSubmit = async (text: string) => {
    setBusy(true);
    try {
      await onTranscript(text);
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <>
      <div className="w-full max-w-full space-y-1.5">
        <div className="flex items-center justify-end">
          <button
            type="button"
            data-testid={testId}
            disabled={disabled || busy}
            onClick={() => setOpen(true)}
            className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-full border border-[#EA580C]/40 bg-[#FFD6B0] px-3.5 text-[12px] font-semibold text-[#4A2500] hover:border-terracotta disabled:opacity-45 cursor-pointer"
          >
            <Mic className="h-3.5 w-3.5 shrink-0" />
            <span>{buttonLabel}</span>
          </button>
        </div>

        <VoiceFeedbackStrip
          lastChanges={lastChanges}
          lastWarnings={lastWarnings}
          canUndo={canUndo}
          onUndo={onUndo}
          disambiguation={disambiguation}
          testIdPrefix={testId}
        />
      </div>

      <GlobalVoiceOverlay
        open={open}
        voiceAdapter={voiceAdapter}
        isSubmitting={busy}
        title={title}
        subtitle={subtitle}
        examples={examples}
        placeholder={placeholder}
        zIndexClass="z-[60]"
        testIdPrefix={`${testId}-sheet`}
        onSubmitTranscript={handleSubmit}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
