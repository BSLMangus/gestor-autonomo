import { X } from "lucide-react";
import type {
  ActiveWidgetEnvelope,
  DocumentImportReviewDraft,
  HumanDecision,
  PendingGate,
  QuickAction,
  TurnExecutionResult,
} from "../../../core/contracts/types";
import { ContextualVoiceDock, OverlayVoiceProvider } from "../../../ui/ContextualVoiceDock";
import { DocumentImportReviewWidget } from "./DocumentImportReviewWidget";
import { WidgetDispatcher } from "./WidgetDispatcher";
import type { WidgetRuntimeContext } from "./widgetTypes";

export type ProtagonistOverlayState =
  | {
      kind: "a2ui";
      badge: string;
      title: string;
      widget: ActiveWidgetEnvelope;
      isActiveGate: boolean;
      activePendingGate: PendingGate | null;
      source?: "thread" | "direct";
    }
  | {
      kind: "document_import";
      badge: string;
      title: string;
      draft: DocumentImportReviewDraft;
      currentHourlyRateCents: number;
    };

export function GenerativeWidgetOverlay(props: {
  overlay: ProtagonistOverlayState | null;
  overlayError: string | null;
  isSubmitting: boolean;
  runtime: WidgetRuntimeContext;
  onResumeDecision: (decision: HumanDecision) => Promise<TurnExecutionResult | null>;
  onQuickAction: (action: QuickAction) => Promise<void>;
  onDocumentImportCommitted: (result: {
    savedCount: number;
    appliedHourlyRateCents: number | null;
    appliedTaxDefaults: boolean;
  }) => Promise<void> | void;
  onCloseOrReject: () => void;
}) {
  const {
    overlay,
    overlayError,
    isSubmitting,
    runtime,
    onResumeDecision,
    onQuickAction,
    onDocumentImportCommitted,
    onCloseOrReject,
  } = props;

  if (!overlay) return null;

  return (
    <OverlayVoiceProvider>
      <div
        data-testid="generative-widget-overlay"
        role="dialog"
        aria-modal="true"
        aria-label={overlay.title}
        className="fixed inset-0 z-50 flex w-full max-w-full flex-col overflow-x-hidden bg-surface text-on-surface"
      >
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-outline-variant bg-surface-container-lowest px-4 py-3 shadow-[0_2px_10px_rgba(15,23,42,0.04)]">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wide text-on-primary-container">
              {overlay.badge}
            </div>
            <h2 className="truncate text-[15px] font-semibold text-on-surface">{overlay.title}</h2>
          </div>
          <button
            type="button"
            data-testid="overlay-close-btn"
            aria-label="Cerrar asistente interactivo"
            disabled={isSubmitting}
            onClick={onCloseOrReject}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-outline-variant bg-surface-container-low text-on-surface hover:bg-surface-container disabled:opacity-50 cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {overlayError && (
          <div
            role="alert"
            data-testid="overlay-error-banner"
            className="mx-auto mt-3 w-full max-w-2xl px-4"
          >
            <div className="rounded-2xl border border-coral-alert/30 bg-error-container px-3.5 py-2.5 text-xs font-semibold text-on-error-container">
              {overlayError}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto overflow-x-hidden no-scrollbar px-4 py-4 pb-8">
          <div className="mx-auto w-full max-w-2xl">
            {overlay.kind === "document_import" ? (
              <DocumentImportReviewWidget
                initialDraft={overlay.draft}
                currentHourlyRateCents={overlay.currentHourlyRateCents}
                executor={runtime.executor}
                onCommitted={onDocumentImportCommitted}
                onCancel={onCloseOrReject}
              />
            ) : (
              <WidgetDispatcher
                widget={overlay.widget}
                isActiveGate={overlay.isActiveGate && !overlayError}
                activePendingGate={overlay.activePendingGate}
                isSubmitting={isSubmitting}
                runtime={runtime}
                onResumeDecision={onResumeDecision}
                onQuickAction={onQuickAction}
              />
            )}
          </div>
        </div>

        <ContextualVoiceDock
          voiceAdapter={runtime.voiceAdapter}
          isSubmitting={isSubmitting}
          registerBackHandler={runtime.registerBackHandler}
        />
      </div>
    </OverlayVoiceProvider>
  );
}
