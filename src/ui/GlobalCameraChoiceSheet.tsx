import { Camera, ChevronRight, ReceiptText, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { LocalFileBridge } from "../core/contracts/types";

interface GlobalCameraChoiceSheetProps {
  mediaUri: string | null;
  fileBridge: LocalFileBridge;
  isSubmitting: boolean;
  onChooseTicket: (mediaUri: string) => Promise<void>;
  onChooseSiteLog: (mediaUri: string) => void;
  onCancel: (mediaUri: string) => Promise<void>;
}

export function GlobalCameraChoiceSheet({
  mediaUri,
  fileBridge,
  isSubmitting,
  onChooseTicket,
  onChooseSiteLog,
  onCancel,
}: GlobalCameraChoiceSheetProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let revoker: (() => void) | null = null;
    if (!mediaUri) {
      setPreviewUrl(null);
      return;
    }
    fileBridge
      .resolveDisplayUrl(mediaUri)
      .then((res) => {
        if (!active) {
          res?.revoke();
          return;
        }
        revoker = res?.revoke ?? null;
        setPreviewUrl(res?.url ?? null);
      })
      .catch(() => {
        if (active) setPreviewUrl(null);
      });
    return () => {
      active = false;
      revoker?.();
    };
  }, [fileBridge, mediaUri]);

  if (!mediaUri) return null;

  return (
    <div
      data-testid="global-camera-choice-sheet"
      role="dialog"
      aria-modal="true"
      aria-label="¿Cómo quieres usar esta fotografía?"
      className="fixed inset-0 z-50 flex flex-col justify-end bg-secondary/45 backdrop-blur-[1px]"
    >
      <div className="mx-auto w-full max-w-md rounded-t-[24px] border-t border-outline-variant bg-surface-container-lowest p-4 pb-6 shadow-2xl space-y-4">
        <div className="mx-auto h-1.5 w-10 rounded-full bg-outline-variant" />

        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-[16px] font-semibold text-on-surface">¿Qué quieres capturar?</h3>
            <p className="text-[13px] text-on-surface-variant">
              Todo se procesa y guarda en tu teléfono
            </p>
          </div>
          <button
            type="button"
            data-testid="camera-choice-cancel-btn"
            disabled={isSubmitting}
            onClick={() => void onCancel(mediaUri)}
            aria-label="Descartar fotografía"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {previewUrl && (
          <img
            src={previewUrl}
            alt="Previsualización capturada"
            className="max-h-44 w-full rounded-2xl border border-outline-variant object-cover"
          />
        )}

        <div className="flex flex-col gap-3">
          <button
            type="button"
            data-testid="camera-choice-ticket-btn"
            disabled={isSubmitting}
            onClick={() => void onChooseTicket(mediaUri)}
            className="flex min-h-[76px] items-center justify-between gap-3 rounded-2xl border border-outline-variant bg-surface-warm-card p-4 text-left hover:border-terracotta transition-colors disabled:opacity-50 cursor-pointer"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-terracotta-soft text-on-primary-container">
                <ReceiptText className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="text-[15px] font-semibold text-on-surface">
                  Escanear Ticket de Gasto
                </div>
                <div className="text-[12px] text-on-surface-variant">
                  Lee importes e IVA offline para revisarlo y archivarlo en Hacienda
                </div>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-outline" />
          </button>

          <button
            type="button"
            data-testid="camera-choice-sitelog-btn"
            disabled={isSubmitting}
            onClick={() => onChooseSiteLog(mediaUri)}
            className="flex min-h-[76px] items-center justify-between gap-3 rounded-2xl border border-outline-variant bg-surface-warm-card p-4 text-left hover:border-terracotta transition-colors disabled:opacity-50 cursor-pointer"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-success-container text-on-success-container">
                <Camera className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="text-[15px] font-semibold text-on-surface">
                  Foto para Diario de Obra
                </div>
                <div className="text-[12px] text-on-surface-variant">
                  Sella fecha, hora y obra vinculada como respaldo visual
                </div>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-outline" />
          </button>
        </div>
      </div>
    </div>
  );
}
