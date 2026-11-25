import { Camera, ImagePlus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { TEXT_LIMITS } from "../../core/contracts/textLimits";
import type {
  FotoAnexoActa,
  LocalFileBridge,
} from "../../core/contracts/types";
import type { CameraAdapter } from "../../core/hardware/cameraAdapter";

interface ActaPhotosSectionProps {
  actaId: string;
  jobId: string | null;
  fotos: FotoAnexoActa[];
  fileBridge: LocalFileBridge;
  cameraAdapter?: CameraAdapter;
  onChangeFotos: (next: FotoAnexoActa[]) => void;
}

function ActaPhotoThumbnail({
  fileBridge,
  uri,
  alt,
}: {
  fileBridge: LocalFileBridge;
  uri: string;
  alt: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let revoker: (() => void) | null = null;
    fileBridge
      .resolveDisplayUrl(uri)
      .then((res) => {
        if (!active) {
          res?.revoke();
          return;
        }
        revoker = res?.revoke ?? null;
        setUrl(res?.url ?? null);
      })
      .catch(() => {
        if (active) setUrl(null);
      });
    return () => {
      active = false;
      revoker?.();
    };
  }, [fileBridge, uri]);

  if (!url) {
    return (
      <div className="flex h-28 w-full items-center justify-center rounded-xl border border-outline-variant bg-surface-container text-[11px] text-on-surface-variant">
        Cargando imagen...
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={alt}
      className="h-28 w-full rounded-xl border border-outline-variant object-cover"
    />
  );
}

export function ActaPhotosSection({
  actaId,
  jobId,
  fotos,
  fileBridge,
  cameraAdapter,
  onChangeFotos,
}: ActaPhotosSectionProps) {
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleAddPhoto = async () => {
    if (!cameraAdapter || fotos.length >= 4) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      const capture = await cameraAdapter.captureOrPick("acta_photo", null, jobId, actaId);
      if (capture.status === "cancelled") return;
      if (capture.status === "permission_denied") {
        setErrorMsg("Permiso de cámara o galería denegado. Revisa los permisos de la app.");
        return;
      }
      if (capture.status === "error") {
        setErrorMsg(capture.reason);
        return;
      }
      const committedUri = await fileBridge.commitMedia(capture.media_uri, "actas");
      if (!committedUri) {
        setErrorMsg("No se pudo guardar la fotografía en el almacenamiento local.");
        return;
      }
      const nextFoto: FotoAnexoActa = {
        id: `foto_${crypto.randomUUID().slice(0, 8)}`,
        uri: committedUri,
        pie_foto: `Foto ${fotos.length + 1}`,
        timestamp: new Date().toISOString(),
      };
      onChangeFotos([...fotos, nextFoto]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRemovePhoto = async (foto: FotoAnexoActa) => {
    setErrorMsg(null);
    onChangeFotos(fotos.filter((f) => f.id !== foto.id));
    await fileBridge.deleteCommittedMedia(foto.uri).catch(() => undefined);
  };

  return (
    <div data-testid="acta-photos-section" className="space-y-3">
      <div className="flex items-center justify-between gap-2 text-[11px] text-on-surface-variant">
        <span>Recomendado de 2 a 4 fotografías de cuadro, tuberías o pruebas.</span>
        <span className="font-mono font-bold text-on-surface">{fotos.length}/4</span>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-xl bg-error-container px-3 py-2 text-[11px] font-semibold text-on-error-container"
        >
          {errorMsg}
        </div>
      )}

      {fotos.length > 0 && (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {fotos.map((foto, idx) => (
            <div
              key={foto.id}
              data-testid={`acta-photo-card-${foto.id}`}
              className="rounded-xl border border-outline-variant bg-surface-container-low/50 p-2.5 space-y-2"
            >
              <ActaPhotoThumbnail
                fileBridge={fileBridge}
                uri={foto.uri}
                alt={foto.pie_foto || `Foto ${idx + 1}`}
              />
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  maxLength={TEXT_LIMITS.SHORT_LABEL}
                  placeholder="Pie de foto..."
                  value={foto.pie_foto}
                  onChange={(e) => {
                    const next = fotos.map((f) =>
                      f.id === foto.id ? { ...f, pie_foto: e.target.value } : f
                    );
                    onChangeFotos(next);
                  }}
                  className="min-h-[38px] min-w-0 flex-1 rounded-lg border border-outline-variant bg-white px-2.5 text-[11px]"
                />
                <button
                  type="button"
                  data-testid={`acta-remove-photo-${foto.id}`}
                  aria-label="Eliminar foto"
                  onClick={() => void handleRemovePhoto(foto)}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-coral-alert/30 bg-white text-coral-alert hover:bg-error-container cursor-pointer"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {fotos.length < 4 && (
        <button
          type="button"
          data-testid="acta-add-photo-btn"
          disabled={busy || !cameraAdapter}
          onClick={() => void handleAddPhoto()}
          className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-dashed border-terracotta/50 bg-terracotta-soft px-4 text-[12px] font-bold text-on-primary-container disabled:opacity-50 cursor-pointer"
        >
          {fotos.length === 0 ? (
            <Camera className="h-4 w-4 shrink-0" />
          ) : (
            <ImagePlus className="h-4 w-4 shrink-0" />
          )}
          <span>{busy ? "Procesando foto..." : "Hacer / Elegir Foto"}</span>
        </button>
      )}
    </div>
  );
}
