import type { RecoveredDraft } from "../core/contracts/types";

interface GuardBannersProps {
  storageError: string | null;
  recoveredDrafts: RecoveredDraft[];
  onReopenDraft: (draftId: string) => Promise<void>;
  onDismissDraft: (draftId: string) => Promise<void>;
}

export function GuardBanners({
  storageError,
  recoveredDrafts,
  onReopenDraft,
  onDismissDraft,
}: GuardBannersProps) {
  if (!storageError && recoveredDrafts.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2 bg-surface px-4 pt-2">
      {storageError && (
        <div
          role="alert"
          data-testid="storage-error-banner"
          className="rounded-2xl border border-coral-alert/30 bg-error-container px-3.5 py-2.5 text-xs font-semibold text-on-error-container"
        >
          {storageError}
        </div>
      )}

      {recoveredDrafts.map((draft) => (
        <div
          key={draft.id}
          data-testid={`recovered-draft-banner-${draft.id}`}
          className="rounded-2xl border border-outline-variant bg-warning-container p-3 text-xs text-on-warning-container"
        >
          <div className="font-bold">
            Borrador pendiente recuperado ({draft.pending_gate === "gate_1_quote" ? "Presupuesto" : "Ticket de gasto"})
          </div>
          <div className="mt-0.5 text-[11px] opacity-90">
            Hilo: {draft.thread_id} · Versión previa: {draft.original_schema_version}
          </div>
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              data-testid={`reopen-draft-${draft.id}`}
              onClick={() => void onReopenDraft(draft.id)}
              className="min-h-[40px] rounded-xl bg-amber-tax px-3.5 text-xs font-semibold text-white cursor-pointer"
            >
              Reabrir borrador
            </button>
            <button
              type="button"
              data-testid={`dismiss-draft-${draft.id}`}
              onClick={() => void onDismissDraft(draft.id)}
              className="min-h-[40px] rounded-xl border border-outline-variant bg-surface-container-lowest px-3.5 text-xs font-semibold text-on-warning-container cursor-pointer"
            >
              Descartar
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
