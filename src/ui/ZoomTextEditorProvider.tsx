import { Check, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import type { SqliteExecutor } from "../core/contracts/types";
import { SettingsRepository } from "../core/db/repositories/settingsRepo";
import { BACK_PRIORITY } from "../core/navigation/routes";
import {
  ZoomTextEditorContext,
  type ZoomEditorOpenRequest,
} from "./zoomTextEditorContext";

type EditorMode = "closed" | "editing" | "confirm_dirty_close";
type AnimPhase = "entering" | "open" | "closing";

interface ViewportMetrics {
  top: number;
  left: number;
  width: number;
  height: number;
}

function readViewportMetrics(): ViewportMetrics {
  if (typeof window === "undefined") {
    return { top: 0, left: 0, width: 360, height: 800 };
  }
  const vv = window.visualViewport;
  if (vv) {
    return {
      top: vv.offsetTop,
      left: vv.offsetLeft,
      width: vv.width,
      height: vv.height,
    };
  }
  return {
    top: 0,
    left: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function normalizeCommitValue(value: string, multiline: boolean, maxLength?: number): string {
  const normalized = multiline ? value : value.replace(/[\r\n]+/g, " ");
  return maxLength !== undefined ? normalized.slice(0, maxLength) : normalized;
}

function computeFlipTransform(sourceRect: DOMRect, vp: ViewportMetrics): string {
  const cardWidth = Math.min(Math.max(280, vp.width - 24), 440);
  const estCardHeight = Math.min(280, Math.max(220, vp.height * 0.42));
  const targetLeft = vp.left + (vp.width - cardWidth) / 2;
  const targetTop = vp.top + 14;

  const sourceCenterX = sourceRect.left + sourceRect.width / 2;
  const sourceCenterY = sourceRect.top + sourceRect.height / 2;
  const targetCenterX = targetLeft + cardWidth / 2;
  const targetCenterY = targetTop + estCardHeight / 2;

  const dx = Math.round(sourceCenterX - targetCenterX);
  const dy = Math.round(sourceCenterY - targetCenterY);
  const sx = Math.max(0.28, Math.min(1, sourceRect.width / cardWidth));
  const sy = Math.max(0.18, Math.min(1, sourceRect.height / estCardHeight));

  return `translate3d(${dx}px, ${dy}px, 0) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`;
}

export function ZoomTextEditorProvider({
  executor,
  refreshTick,
  registerBackHandler,
  children,
}: {
  executor: SqliteExecutor;
  refreshTick: number;
  registerBackHandler?: (priority: number, handler: () => boolean) => () => void;
  children: ReactNode;
}) {
  const [enabled, setEnabledState] = useState(true);
  const [mode, setMode] = useState<EditorMode>("closed");
  const [session, setSession] = useState<ZoomEditorOpenRequest | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [animPhase, setAnimPhase] = useState<AnimPhase>("open");
  const [transformCleared, setTransformCleared] = useState(false);
  const [viewport, setViewport] = useState<ViewportMetrics>(() => readViewportMetrics());

  const cardRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transitionFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);
  const modeRef = useRef<EditorMode>(mode);
  modeRef.current = mode;
  const sessionRef = useRef<ZoomEditorOpenRequest | null>(session);
  sessionRef.current = session;

  const settingsRepo = useMemo(() => new SettingsRepository(executor), [executor]);

  useEffect(() => {
    let active = true;
    void settingsRepo
      .getAppSettings()
      .then((settings) => {
        if (active) {
          setEnabledState(settings.expand_long_text_inputs);
        }
      })
      .catch(() => {
        // Mantiene valor por defecto true si la carga inicial falla
      });
    return () => {
      active = false;
    };
  }, [settingsRepo, refreshTick]);

  const setEnabled = useCallback(
    async (next: boolean) => {
      setEnabledState(next);
      await settingsRepo.updateExpandLongTextInputs(next);
    },
    [settingsRepo]
  );

  const clearTimers = useCallback(() => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (transitionFallbackTimerRef.current !== null) {
      clearTimeout(transitionFallbackTimerRef.current);
      transitionFallbackTimerRef.current = null;
    }
    if (rafRef.current !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  useEffect(() => {
    if (mode === "closed" || typeof window === "undefined") return;
    const syncViewport = () => {
      setViewport(readViewportMetrics());
    };
    syncViewport();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", syncViewport);
    vv?.addEventListener("scroll", syncViewport);
    window.addEventListener("resize", syncViewport);
    return () => {
      vv?.removeEventListener("resize", syncViewport);
      vv?.removeEventListener("scroll", syncViewport);
      window.removeEventListener("resize", syncViewport);
    };
  }, [mode]);

  const finalizeClose = useCallback(() => {
    clearTimers();
    setMode("closed");
    setSession(null);
    setDraftValue("");
    setAnimPhase("open");
    setTransformCleared(false);
  }, [clearTimers]);

  const closeWithAnimation = useCallback(() => {
    clearTimers();
    if (prefersReducedMotion()) {
      finalizeClose();
      return;
    }
    setTransformCleared(false);
    setAnimPhase("closing");
    closeTimerRef.current = setTimeout(() => {
      finalizeClose();
    }, 170);
  }, [clearTimers, finalizeClose]);

  const commitAndClose = useCallback(() => {
    if (!session) return;
    const finalVal = normalizeCommitValue(draftValue, session.multiline, session.maxLength);
    session.onCommit(finalVal);
    closeWithAnimation();
  }, [session, draftValue, closeWithAnimation]);

  const requestDismiss = useCallback(() => {
    if (mode === "closed" || !session) return;
    if (mode === "confirm_dirty_close") {
      setMode("editing");
      setTimeout(() => {
        textareaRef.current?.focus({ preventScroll: true });
      }, 0);
      return;
    }
    const normalizedDraft = normalizeCommitValue(draftValue, session.multiline, session.maxLength);
    const normalizedInitial = normalizeCommitValue(
      session.initialValue,
      session.multiline,
      session.maxLength
    );
    if (normalizedDraft === normalizedInitial) {
      closeWithAnimation();
      return;
    }
    setMode("confirm_dirty_close");
  }, [mode, session, draftValue, closeWithAnimation]);

  const abortField = useCallback(
    (fieldId: string) => {
      if (modeRef.current !== "closed" && sessionRef.current?.fieldId === fieldId) {
        finalizeClose();
      }
    },
    [finalizeClose]
  );

  const openEditor = useCallback(
    (req: ZoomEditorOpenRequest) => {
      if (!enabled) return;
      clearTimers();

      const reduced = prefersReducedMotion();
      const vpNow = readViewportMetrics();

      flushSync(() => {
        setViewport(vpNow);
        setSession(req);
        setDraftValue(req.initialValue);
        setMode("editing");
        setAnimPhase(reduced ? "open" : "entering");
        setTransformCleared(reduced);
      });

      const el = textareaRef.current;
      if (el) {
        el.focus({ preventScroll: true });
        const len = el.value.length;
        try {
          el.setSelectionRange(len, len);
        } catch {
          // ignore selection errors on unsupported environments
        }
      }

      if (!reduced && cardRef.current) {
        void cardRef.current.offsetHeight;
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          setAnimPhase("open");
          transitionFallbackTimerRef.current = setTimeout(() => {
            transitionFallbackTimerRef.current = null;
            setTransformCleared(true);
          }, 260);
        });
      }
    },
    [enabled, clearTimers]
  );

  useEffect(() => {
    if (mode === "closed" || !registerBackHandler) return;
    return registerBackHandler(BACK_PRIORITY.ZOOM_TEXT_EDITOR, () => {
      requestDismiss();
      return true;
    });
  }, [mode, registerBackHandler, requestDismiss]);

  useEffect(() => {
    if (mode === "closed" || typeof window === "undefined") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        requestDismiss();
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, [mode, requestDismiss]);

  const ctxValue = useMemo(
    () => ({
      enabled,
      setEnabled,
      openEditor,
      abortField,
    }),
    [enabled, setEnabled, openEditor, abortField]
  );

  const isClosing = animPhase === "closing";
  const isEntering = animPhase === "entering";

  const keyboardLikelyOpen =
    typeof window !== "undefined" && window.innerHeight - viewport.height > 100;
  const maxCardHeight = keyboardLikelyOpen
    ? Math.max(220, Math.floor(viewport.height - 24))
    : Math.max(240, Math.floor(Math.min(viewport.height * 0.48, 380)));

  const cardTransform =
    transformCleared
      ? undefined
      : (isEntering || isClosing) && session
        ? computeFlipTransform(session.sourceRect, viewport)
        : "translate3d(0, 0, 0) scale(1, 1)";

  const dialog =
    mode !== "closed" && session ? (
      <div
        data-testid="zoom-editor-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={session.label}
        style={{
          top: `${viewport.top}px`,
          left: `${viewport.left}px`,
          width: `${viewport.width}px`,
          height: `${viewport.height}px`,
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            requestDismiss();
          }
        }}
        className={`fixed z-[80] flex items-start justify-center px-3 pt-3 pt-safe transition-opacity duration-200 ${
          isEntering || isClosing ? "bg-secondary/0 opacity-0" : "bg-secondary/50 opacity-100"
        } backdrop-blur-[2px]`}
      >
        <div
          ref={cardRef}
          style={{
            maxHeight: `${maxCardHeight}px`,
            transform: cardTransform,
            transformOrigin: "center center",
            transition: prefersReducedMotion()
              ? "none"
              : "transform 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease-out",
          }}
          onTransitionEnd={(e) => {
            if (e.target === cardRef.current && e.propertyName === "transform" && animPhase === "open") {
              if (transitionFallbackTimerRef.current !== null) {
                clearTimeout(transitionFallbackTimerRef.current);
                transitionFallbackTimerRef.current = null;
              }
              setTransformCleared(true);
            }
          }}
          onClick={(e) => e.stopPropagation()}
          className="relative flex w-full max-w-[440px] flex-col overflow-hidden rounded-[22px] border-2 border-terracotta/45 bg-surface-container-lowest shadow-[0_24px_60px_rgba(15,23,42,0.3),0_10px_24px_rgba(15,23,42,0.16)]"
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-outline-variant bg-surface-warm-card px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-bold text-on-surface">{session.label}</div>
              {session.maxLength !== undefined && (
                <div className="text-[11px] font-medium text-on-surface-variant">
                  {draftValue.length} / {session.maxLength} caracteres
                </div>
              )}
            </div>
            <button
              type="button"
              data-testid="zoom-editor-header-cancel-btn"
              aria-label="Descartar cambios"
              onClick={closeWithAnimation}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-outline-variant bg-surface-container-lowest text-on-surface hover:border-coral-alert hover:text-coral-alert cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
            <textarea
              ref={textareaRef}
              data-testid="zoom-editor-textarea"
              rows={session.multiline ? 5 : 3}
              maxLength={session.maxLength}
              value={draftValue}
              placeholder={session.placeholder}
              onChange={(e) => {
                const raw = e.target.value;
                setDraftValue(session.multiline ? raw : raw.replace(/[\r\n]+/g, " "));
              }}
              onKeyDown={(e) => {
                if (!session.multiline && e.key === "Enter") {
                  e.preventDefault();
                } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  commitAndClose();
                }
              }}
              className="w-full min-h-[120px] resize-none rounded-xl border border-outline-variant bg-surface-container-low px-3.5 py-3 text-[18px] leading-relaxed text-on-surface placeholder:text-outline focus:border-terracotta focus:outline-none"
            />
          </div>

          <div className="flex shrink-0 items-center gap-2.5 border-t border-outline-variant bg-surface-container-lowest px-4 py-3">
            <button
              type="button"
              data-testid="zoom-editor-cancel-btn"
              onClick={closeWithAnimation}
              className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-outline-variant bg-surface-container-low px-4 text-[14px] font-semibold text-on-surface hover:border-coral-alert hover:text-coral-alert cursor-pointer"
            >
              <X className="h-4 w-4 shrink-0" />
              <span>Cancelar</span>
            </button>
            <button
              type="button"
              data-testid="zoom-editor-confirm-btn"
              onClick={commitAndClose}
              className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-[14px] font-bold text-white shadow-sm hover:bg-terracotta cursor-pointer"
            >
              <Check className="h-4 w-4 shrink-0" />
              <span>Confirmar</span>
            </button>
          </div>

          {mode === "confirm_dirty_close" && !isClosing && (
            <div
              data-testid="zoom-editor-unsaved-prompt"
              role="alertdialog"
              aria-modal="true"
              aria-label="¿Desea guardar los cambios realizados?"
              className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-surface-container-lowest/96 p-5 text-center space-y-4"
            >
              <div className="space-y-1.5">
                <h4 className="text-[16px] font-bold text-on-surface">
                  ¿Desea guardar los cambios realizados?
                </h4>
                <p className="text-[12px] text-on-surface-variant">
                  Has modificado el texto de «{session.label}».
                </p>
              </div>
              <div className="flex w-full max-w-[300px] items-center gap-3">
                <button
                  type="button"
                  data-testid="zoom-editor-discard-btn"
                  onClick={closeWithAnimation}
                  className="min-h-[48px] flex-1 rounded-xl border border-coral-alert/40 bg-error-container px-4 text-[14px] font-bold text-on-error-container cursor-pointer"
                >
                  No
                </button>
                <button
                  type="button"
                  data-testid="zoom-editor-save-btn"
                  onClick={commitAndClose}
                  className="min-h-[48px] flex-1 rounded-xl bg-primary px-4 text-[14px] font-bold text-white shadow-sm hover:bg-terracotta cursor-pointer"
                >
                  Sí
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    ) : null;

  return (
    <ZoomTextEditorContext.Provider value={ctxValue}>
      {children}
      {dialog && typeof document !== "undefined" ? createPortal(dialog, document.body) : dialog}
    </ZoomTextEditorContext.Provider>
  );
}
