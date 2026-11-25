import { AlertTriangle, Trash2 } from "lucide-react";
import { useEffect, useId } from "react";
import { BACK_PRIORITY } from "../core/navigation/routes";

export interface ConfirmDeleteDialogProps {
  open: boolean;
  title: string;
  description: string;
  warningNote?: string | null;
  errorMsg?: string | null;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  dialogTestId?: string;
  confirmTestId?: string;
  cancelTestId?: string;
  registerBackHandler?: (priority: number, handler: () => boolean) => () => void;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDeleteDialog({
  open,
  title,
  description,
  warningNote = null,
  errorMsg = null,
  confirmLabel = "Sí, eliminar",
  cancelLabel = "Cancelar",
  busy = false,
  dialogTestId = "confirm-delete-dialog",
  confirmTestId = "confirm-delete-btn",
  cancelTestId = "cancel-delete-btn",
  registerBackHandler,
  onCancel,
  onConfirm,
}: ConfirmDeleteDialogProps) {
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open || !registerBackHandler) return;
    return registerBackHandler(BACK_PRIORITY.MODAL_SECONDARY + 15, () => {
      if (!busy) {
        onCancel();
      }
      return true;
    });
  }, [open, busy, registerBackHandler, onCancel]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && !busy) {
        ev.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      data-testid={dialogTestId}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[#2C2621]/45 p-4 backdrop-blur-[1px]"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) {
          onCancel();
        }
      }}
    >
      <div className="clipboard-panel w-full max-w-sm rounded-[24px] border border-[#DFD9CA] bg-[#FFFDF7] p-5 space-y-3.5 text-xs">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#FAD2D8] text-[#DC2626]">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <h3
              id={titleId}
              className="text-[15px] font-bold leading-snug text-[#2C2621] break-words"
            >
              {title}
            </h3>
            <p
              id={descId}
              className="text-xs leading-relaxed text-[#6B6860] break-words"
            >
              {description}
            </p>
          </div>
        </div>

        {warningNote && (
          <div className="rounded-xl border border-[#E6B84C]/55 bg-[#FFF3A1] p-2.5 text-[11px] font-medium leading-relaxed text-[#3E3300] break-words">
            {warningNote}
          </div>
        )}

        {errorMsg && (
          <div
            role="alert"
            className="rounded-xl border border-[#DC2626]/30 bg-[#FAD2D8] p-2.5 text-[11px] leading-relaxed text-[#5A121C] break-words"
          >
            {errorMsg}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            data-testid={cancelTestId}
            disabled={busy}
            onClick={onCancel}
            className="min-h-[44px] flex-1 rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] px-3 text-xs font-semibold text-[#2C2621] hover:bg-[#EFECE4] cursor-pointer disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            data-testid={confirmTestId}
            disabled={busy}
            onClick={() => void onConfirm()}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#DC2626] px-3 text-xs font-semibold text-white cursor-pointer disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{busy ? "Eliminando..." : confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
