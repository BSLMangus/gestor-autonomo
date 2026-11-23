import { createContext, useContext, useEffect, useRef } from "react";

export interface OverlayVoiceDisambiguation {
  prompt: string;
  options: Array<{ id: string; label: string; subtitle?: string }>;
  onSelect: (id: string) => void;
  onDismiss?: () => void;
}

export interface OverlayVoiceRegistration {
  enabled: boolean;
  title: string;
  subtitle?: string;
  placeholder: string;
  examples: string[];
  buttonLabel?: string;
  onTranscript: (text: string) => Promise<void> | void;
  lastChanges?: string[];
  lastWarnings?: string[];
  canUndo?: boolean;
  onUndo?: () => void;
  disambiguation?: OverlayVoiceDisambiguation | null;
}

export interface OverlayVoiceContextValue {
  registration: OverlayVoiceRegistration | null;
  setRegistration: (reg: OverlayVoiceRegistration | null) => void;
}

export const OverlayVoiceContext = createContext<OverlayVoiceContextValue | null>(null);

/**
 * Permite que cualquier widget dentro de GenerativeWidgetOverlay registre su adaptador de dictado
 * incremental sin provocar bucles de render ni cierres obsoletos.
 */
export function useRegisterOverlayVoice(reg: OverlayVoiceRegistration | null) {
  const ctx = useContext(OverlayVoiceContext);
  const latestRef = useRef<OverlayVoiceRegistration | null>(reg);
  latestRef.current = reg;

  const serialKey = reg
    ? JSON.stringify({
        enabled: reg.enabled,
        title: reg.title,
        subtitle: reg.subtitle ?? "",
        placeholder: reg.placeholder,
        examples: reg.examples,
        buttonLabel: reg.buttonLabel ?? "",
        lastChanges: reg.lastChanges ?? [],
        lastWarnings: reg.lastWarnings ?? [],
        canUndo: Boolean(reg.canUndo),
        disambigPrompt: reg.disambiguation?.prompt ?? null,
        disambigOptions: reg.disambiguation?.options ?? null,
      })
    : "null";

  useEffect(() => {
    if (!ctx) return;
    const current = latestRef.current;
    if (!current || !current.enabled) {
      ctx.setRegistration(null);
      return;
    }

    ctx.setRegistration({
      ...current,
      onTranscript: async (text: string) => {
        await latestRef.current?.onTranscript(text);
      },
      onUndo: current.onUndo
        ? () => {
            latestRef.current?.onUndo?.();
          }
        : undefined,
      disambiguation: current.disambiguation
        ? {
            ...current.disambiguation,
            onSelect: (id: string) => {
              latestRef.current?.disambiguation?.onSelect(id);
            },
            onDismiss: current.disambiguation.onDismiss
              ? () => {
                  latestRef.current?.disambiguation?.onDismiss?.();
                }
              : undefined,
          }
        : null,
    });
  }, [ctx, serialKey]);

  useEffect(() => {
    return () => {
      ctx?.setRegistration(null);
    };
  }, [ctx]);
}
