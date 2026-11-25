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
      className={`paper-sheet w-full max-w-full overflow-x-hidden rounded-2xl border border-[#E5DFD2] bg-[#FFFDF7] p-3.5 text-xs text-[#2C2621] ${className}`.trim()}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="status-mustard inline-flex rounded-full px-2.5 py-0.5 font-mono text-[10px] font-bold tabular-nums">
              Nueva versión v{update.remoteVersionName}
            </span>
            <span className="font-mono text-[11px] font-medium text-[#6B6860] tabular-nums">
              Instalada: v{update.installedVersionName}
            </span>
          </div>
          <p className="break-words [overflow-wrap:anywhere] font-semibold text-[#2C2621]">
            Hay una actualización lista para Gestor Autónomo.
          </p>
          {update.releaseNotes && (
            <p className="break-words [overflow-wrap:anywhere] whitespace-pre-line text-[11px] text-[#6B6860]">
              {update.releaseNotes}
            </p>
          )}
        </div>
      </div>

      {phase === "downloading" && (
        <div className="mt-2.5 space-y-1.5">
          <div className="h-2 w-full overflow-hidden rounded-full bg-[#EFECE4]">
            <div
              className="h-full rounded-full chart-gold transition-all duration-150"
              style={{ width: `${Math.max(4, Math.min(100, progress.percent))}%` }}
            />
          </div>
          <div className="font-mono text-[11px] font-semibold text-[#78350F] tabular-nums">
            {progress.totalBytes > 0
              ? `Descargando actualización... ${progress.percent} % (${downloadedMb} MB)`
              : `Descargando actualización... ${downloadedMb} MB`}
          </div>
        </div>
      )}

      {phase === "permission_required" && (
        <div className="mt-2.5 space-y-2 rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] p-2.5">
          <p className="break-words [overflow-wrap:anywhere] text-[11px] text-[#2C2621]">
            Activa <strong>«Permitir desde esta fuente»</strong> para Gestor Autónomo en el ajuste
            que se acaba de abrir y después pulsa <strong>«Instalar actualización»</strong>.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="update-banner-retry-install-btn"
              onClick={() => void handleInstall()}
              className="min-h-10 flex-1 rounded-xl bg-[#EA580C] hover:bg-[#D04B00] px-3 font-bold text-[#FFFDF9] cursor-pointer transition-colors"
            >
              Instalar actualización
            </button>
            {!update.mandatory && onDismiss && (
              <button
                type="button"
                data-testid="update-banner-dismiss-btn"
                onClick={onDismiss}
                className="min-h-10 rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 font-semibold text-[#6B6860] cursor-pointer"
              >
                Más tarde
              </button>
            )}
          </div>
        </div>
      )}

      {phase === "error" && (
        <div className="mt-2.5 space-y-2 rounded-xl border border-[#DC2626]/30 bg-[#FAD2D8] p-2.5">
          <p className="break-words [overflow-wrap:anywhere] text-[11px] text-[#5A121C]">
            No se pudo completar la actualización: {errorMsg || "error de red"}.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleInstall()}
              className="min-h-10 flex-1 rounded-xl bg-[#4B7094] hover:bg-[#3F5F7E] px-3 font-bold text-[#FFFDF9] cursor-pointer transition-colors"
            >
              Reintentar
            </button>
            {!update.mandatory && onDismiss && (
              <button
                type="button"
                data-testid="update-banner-dismiss-btn"
                onClick={onDismiss}
                className="min-h-10 rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 font-semibold text-[#6B6860] cursor-pointer"
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
            className="min-h-10 flex-1 rounded-xl bg-[#EA580C] hover:bg-[#D04B00] px-3 font-bold text-[#FFFDF9] cursor-pointer transition-colors"
          >
            Actualizar ahora
          </button>
          {!update.mandatory && onDismiss && (
            <button
              type="button"
              data-testid="update-banner-dismiss-btn"
              onClick={onDismiss}
              className="min-h-10 rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 font-semibold text-[#6B6860] cursor-pointer"
            >
              Más tarde
            </button>
          )}
        </div>
      )}
    </div>
  );
}
