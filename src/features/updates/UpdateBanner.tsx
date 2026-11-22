import { useState } from "react";
import type {
  ApkUpdaterService,
  AvailableUpdateInfo,
  DownloadProgress,
} from "../../core/updates/apkUpdaterService";

interface UpdateBannerProps {
  update: AvailableUpdateInfo;
  updaterService: ApkUpdaterService;
  onDismiss?: () => void;
  className?: string;
}

type BannerPhase = "idle" | "downloading" | "permission_required" | "error";

export function UpdateBanner({
  update,
  updaterService,
  onDismiss,
  className = "",
}: UpdateBannerProps) {
  const [phase, setPhase] = useState<BannerPhase>("idle");
  const [progress, setProgress] = useState<DownloadProgress>({
    percent: 0,
    downloadedBytes: 0,
    totalBytes: -1,
  });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleInstall = async () => {
    setErrorMsg(null);
    setPhase("downloading");
    setProgress({ percent: 0, downloadedBytes: 0, totalBytes: -1 });
    try {
      const result = await updaterService.downloadAndInstall(
        { apkUrl: update.apkUrl, sha256: update.sha256 },
        (p) => setProgress(p)
      );
      if (result.status === "permission_required") {
        setPhase("permission_required");
        return;
      }
      setPhase("idle");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  };

  const downloadedMb = (progress.downloadedBytes / (1024 * 1024)).toFixed(1);

  return (
    <div
      data-testid="apk-update-banner"
      role="region"
      aria-label="Actualización disponible"
      className={`w-full max-w-full overflow-x-hidden rounded-2xl border border-amber-300 bg-amber-50 p-3 text-xs text-slate-900 shadow-sm ${className}`.trim()}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex rounded-full bg-amber-600 px-2 py-0.5 text-[10px] font-bold text-white">
              Nueva versión v{update.remoteVersionName}
            </span>
            <span className="text-[11px] font-medium text-amber-900">
              Instalada: v{update.installedVersionName}
            </span>
          </div>
          <p className="break-words [overflow-wrap:anywhere] font-semibold text-slate-900">
            Hay una actualización lista para Gestor Autónomo.
          </p>
          {update.releaseNotes && (
            <p className="break-words [overflow-wrap:anywhere] whitespace-pre-line text-[11px] text-slate-700">
              {update.releaseNotes}
            </p>
          )}
        </div>
      </div>

      {phase === "downloading" && (
        <div className="mt-2.5 space-y-1.5">
          <div className="h-2 w-full overflow-hidden rounded-full bg-amber-200">
            <div
              className="h-full rounded-full bg-amber-600 transition-all duration-150"
              style={{ width: `${Math.max(4, Math.min(100, progress.percent))}%` }}
            />
          </div>
          <div className="text-[11px] font-semibold text-amber-900 tabular-nums">
            {progress.totalBytes > 0
              ? `Descargando actualización... ${progress.percent} % (${downloadedMb} MB)`
              : `Descargando actualización... ${downloadedMb} MB`}
          </div>
        </div>
      )}

      {phase === "permission_required" && (
        <div className="mt-2.5 space-y-2 rounded-xl border border-amber-300 bg-white p-2.5">
          <p className="break-words [overflow-wrap:anywhere] text-[11px] text-slate-800">
            Activa <strong>«Permitir desde esta fuente»</strong> para Gestor Autónomo en el ajuste
            que se acaba de abrir y después pulsa <strong>«Instalar actualización»</strong>.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="update-banner-retry-install-btn"
              onClick={() => void handleInstall()}
              className="min-h-10 flex-1 rounded-xl bg-amber-600 px-3 font-bold text-white cursor-pointer"
            >
              Instalar actualización
            </button>
            {!update.mandatory && onDismiss && (
              <button
                type="button"
                data-testid="update-banner-dismiss-btn"
                onClick={onDismiss}
                className="min-h-10 rounded-xl border border-slate-300 bg-white px-3 font-semibold text-slate-700 cursor-pointer"
              >
                Más tarde
              </button>
            )}
          </div>
        </div>
      )}

      {phase === "error" && (
        <div className="mt-2.5 space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-2.5">
          <p className="break-words [overflow-wrap:anywhere] text-[11px] text-rose-800">
            No se pudo completar la actualización: {errorMsg || "error de red"}.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleInstall()}
              className="min-h-10 flex-1 rounded-xl bg-slate-900 px-3 font-bold text-white cursor-pointer"
            >
              Reintentar
            </button>
            {!update.mandatory && onDismiss && (
              <button
                type="button"
                data-testid="update-banner-dismiss-btn"
                onClick={onDismiss}
                className="min-h-10 rounded-xl border border-slate-300 bg-white px-3 font-semibold text-slate-700 cursor-pointer"
              >
                Cerrar
              </button>
            )}
          </div>
        </div>
      )}

      {phase === "idle" && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="update-banner-install-btn"
            onClick={() => void handleInstall()}
            className="min-h-10 flex-1 rounded-xl bg-amber-600 px-3 font-bold text-white cursor-pointer"
          >
            Actualizar ahora
          </button>
          {!update.mandatory && onDismiss && (
            <button
              type="button"
              data-testid="update-banner-dismiss-btn"
              onClick={onDismiss}
              className="min-h-10 rounded-xl border border-slate-300 bg-white px-3 font-semibold text-slate-700 cursor-pointer"
            >
              Más tarde
            </button>
          )}
        </div>
      )}
    </div>
  );
}
