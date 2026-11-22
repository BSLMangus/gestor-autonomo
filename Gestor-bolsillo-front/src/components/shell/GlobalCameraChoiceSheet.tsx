import React from 'react';
import { Camera, ChevronRight, ReceiptText, X } from 'lucide-react';
import { IMG_PLUMBING_PIPE, IMG_TICKET_RECEIPT, useAppStore } from '../../services/mockStore';

export function GlobalCameraChoiceSheet() {
  const { cameraSheetOpen, setCameraSheetOpen, openOverlay, state } = useAppStore();

  if (!cameraSheetOpen) return null;

  const activeJobId = state.jobs.find((j) => j.status === 'en_curso')?.id ?? state.jobs[0]?.id ?? '';

  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Cerrar opciones de cámara"
        onClick={() => setCameraSheetOpen(false)}
        className="absolute inset-0 bg-secondary/45 backdrop-blur-[1px]"
      />

      <div className="relative z-10 bg-surface-container-lowest border-t border-outline-variant rounded-t-[24px] p-4 pb-6 shadow-2xl flex flex-col gap-4">
        <div className="w-10 h-1.5 bg-outline-variant rounded-full mx-auto" />

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[16px] font-semibold text-on-surface">
              ¿Qué quieres capturar?
            </h2>
            <p className="text-[13px] text-on-surface-variant">
              Todo se procesa y guarda en tu teléfono
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCameraSheetOpen(false)}
            aria-label="Cerrar"
            className="w-11 h-11 rounded-full hover:bg-surface-container flex items-center justify-center text-on-surface-variant"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => {
              setCameraSheetOpen(false);
              openOverlay({
                kind: 'ticket',
                initialJobId: activeJobId,
                initialSupplier: 'Saneamientos García S.L.',
                initialCategory: 'Material',
                initialTotalCents: 6600,
                initialVatRate: 21,
                initialImageUrl: IMG_TICKET_RECEIPT,
              });
            }}
            className="min-h-[76px] p-4 rounded-2xl bg-surface-warm-card border border-outline-variant hover:border-terracotta flex items-center justify-between gap-3 text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-terracotta-soft text-on-primary-container flex items-center justify-center shrink-0">
                <ReceiptText className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-[15px] font-semibold text-on-surface">
                  Escanear Ticket de Gasto
                </h3>
                <p className="text-[13px] text-on-surface-variant">
                  Extrae base e IVA 21% y súmalo a tu Hucha Fiscal
                </p>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-outline shrink-0" />
          </button>

          <button
            type="button"
            onClick={() => {
              setCameraSheetOpen(false);
              openOverlay({
                kind: 'photo',
                initialJobId: activeJobId,
                initialCaption: 'Avance de instalación y comprobación de obra',
                initialImageUrl: IMG_PLUMBING_PIPE,
              });
            }}
            className="min-h-[76px] p-4 rounded-2xl bg-surface-warm-card border border-outline-variant hover:border-terracotta flex items-center justify-between gap-3 text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-success-container text-on-success-container flex items-center justify-center shrink-0">
                <Camera className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-[15px] font-semibold text-on-surface">
                  Foto para Diario de Obra
                </h3>
                <p className="text-[13px] text-on-surface-variant">
                  Sella fecha, hora y ubicación como respaldo visual
                </p>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-outline shrink-0" />
          </button>
        </div>
      </div>
    </div>
  );
}
