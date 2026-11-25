import { Check, Eraser, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { BACK_PRIORITY } from "../../core/navigation/routes";

interface SignaturePadModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  showSaveAsDefaultOption?: boolean;
  defaultSaveAsDefault?: boolean;
  saveAsDefaultLabel?: string;
  registerBackHandler?: (priority: number, handler: () => boolean) => () => void;
  onClose: () => void;
  onConfirm: (dataUrl: string, saveAsDefault: boolean) => Promise<void> | void;
}

export function SignaturePadModal({
  open,
  title,
  subtitle = "Dibuja tu firma con el dedo dentro del recuadro.",
  showSaveAsDefaultOption = false,
  defaultSaveAsDefault = false,
  saveAsDefaultLabel = "Guardar como mi firma habitual para próximas actas",
  registerBackHandler,
  onClose,
  onConfirm,
}: SignaturePadModalProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [hasStroke, setHasStroke] = useState(false);
  const [saveAsDefault, setSaveAsDefault] = useState(defaultSaveAsDefault);
  const [busy, setBusy] = useState(false);

  const resetCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(280, Math.round(rect.width || 320));
    const height = Math.max(180, Math.round(rect.height || 220));
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2.6;
    setHasStroke(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    setSaveAsDefault(defaultSaveAsDefault);
    const timer = setTimeout(() => {
      resetCanvas();
    }, 30);
    return () => clearTimeout(timer);
  }, [open, defaultSaveAsDefault, resetCanvas]);

  useEffect(() => {
    if (!open || !registerBackHandler) return;
    return registerBackHandler(BACK_PRIORITY.MODAL_SECONDARY, () => {
      if (!busy) onClose();
      return true;
    });
  }, [open, busy, registerBackHandler, onClose]);

  if (!open) return null;

  const getRelativePoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const pt = getRelativePoint(e);
    drawingRef.current = true;
    lastPointRef.current = pt;

    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 1.3, 0, Math.PI * 2);
      ctx.fillStyle = "#0f172a";
      ctx.fill();
      setHasStroke(true);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !lastPointRef.current) return;

    const pt = getRelativePoint(e);
    ctx.beginPath();
    ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    lastPointRef.current = pt;
    setHasStroke(true);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPointRef.current = null;
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // ignore if capture already released
    }
  };

  const handleConfirmClick = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasStroke) return;
    setBusy(true);
    try {
      const dataUrl = canvas.toDataURL("image/png");
      await onConfirm(dataUrl, saveAsDefault);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="signature-pad-modal"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-[1px]"
    >
      <div className="w-full max-w-lg rounded-2xl border border-outline-variant bg-surface-container-lowest p-4 shadow-2xl space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-[15px] font-bold text-on-surface">{title}</h3>
            <p className="text-[11px] text-on-surface-variant">{subtitle}</p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            aria-label="Cerrar firma"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-hidden rounded-2xl border-2 border-dashed border-outline-variant bg-white">
          <canvas
            ref={canvasRef}
            data-testid="signature-pad-canvas"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{ touchAction: "none" }}
            className="block h-56 w-full cursor-crosshair bg-white"
          />
        </div>

        {showSaveAsDefaultOption && (
          <label className="flex items-center gap-2 rounded-xl border border-outline-variant bg-surface-container-low px-3 py-2 text-[11px] font-semibold text-on-surface cursor-pointer">
            <input
              type="checkbox"
              data-testid="signature-save-default-checkbox"
              checked={saveAsDefault}
              onChange={(e) => setSaveAsDefault(e.target.checked)}
              className="h-4 w-4 accent-terracotta"
            />
            <span>{saveAsDefaultLabel}</span>
          </label>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            data-testid="signature-pad-clear-btn"
            disabled={busy}
            onClick={resetCanvas}
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-outline-variant bg-surface-container-low font-semibold text-on-surface cursor-pointer"
          >
            <Eraser className="h-4 w-4" />
            <span>Borrar</span>
          </button>
          <button
            type="button"
            data-testid="signature-pad-confirm-btn"
            disabled={busy || !hasStroke}
            onClick={() => void handleConfirmClick()}
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-terracotta font-semibold text-white disabled:opacity-45 cursor-pointer"
          >
            <Check className="h-4 w-4" />
            <span>{busy ? "Guardando..." : "Confirmar Firma"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
