import {
  ArrowLeft,
  Copy,
  ExternalLink,
  FileWarning,
  Loader2,
  Maximize2,
  Minus,
  Plus,
  RotateCcw,
  Share2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MemoryCoordinator } from "../../core/contracts/types";
import { BACK_PRIORITY } from "../../core/navigation/routes";
import {
  openPdfCanvasDocument,
  zeroOutCanvas,
  type PdfCanvasSession,
  type PdfPageBaseSize,
} from "./pdfCanvasRenderer";

export interface DocumentPreviewRequest {
  docKind: "quote" | "invoice" | "acta" | "work_order";
  title: string;
  subtitle?: string;
  isDraft?: boolean;
  loadBytes: () => Promise<{ pdfBytes: Uint8Array; fileName: string }>;
  onDownloadOrShare: (bytes: Uint8Array, fileName: string) => Promise<void>;
  secondaryAction?: {
    label: string;
    icon?: "duplicate" | "rectify";
    onClick: () => void | Promise<void>;
    testId?: string;
  };
  openDetailAction?: {
    label: string;
    onClick: () => void;
    testId?: string;
  };
}

export interface DocumentPreviewModalProps {
  request: DocumentPreviewRequest | null;
  memoryCoordinator?: MemoryCoordinator;
  registerBackHandler?: (priority: number, handler: () => boolean) => () => void;
  onClose: () => void;
}

const MIN_ZOOM = 0.75;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.25;
const DOUBLE_TAP_ZOOM = 1.75;
const A4_ASPECT_RATIO = 1.4142;

function clampZoom(z: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(z * 100) / 100));
}

function getTouchDistance(touches: React.TouchList): number {
  if (touches.length < 2) return 0;
  const t0 = touches[0]!;
  const t1 = touches[1]!;
  const dx = t0.clientX - t1.clientX;
  const dy = t0.clientY - t1.clientY;
  return Math.hypot(dx, dy);
}

export function DocumentPreviewModal({
  request,
  memoryCoordinator,
  registerBackHandler,
  onClose,
}: DocumentPreviewModalProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const pageContainerRefs = useRef<Array<HTMLDivElement | null>>([]);
  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([]);
  const sessionRef = useRef<PdfCanvasSession | null>(null);
  const loadedBytesRef = useRef<{ pdfBytes: Uint8Array; fileName: string } | null>(null);

  const pinchRef = useRef<{ initialDistance: number; initialZoom: number } | null>(null);
  const lastTapRef = useRef<{ timeMs: number; x: number; y: number } | null>(null);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const [pageSizes, setPageSizes] = useState<PdfPageBaseSize[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [baseFitWidthPx, setBaseFitWidthPx] = useState(340);

  const [zoom, setZoom] = useState(1);
  const [settledZoom, setSettledZoom] = useState(1);

  const [sharingBusy, setSharingBusy] = useState(false);
  const [secondaryBusy, setSecondaryBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const clearAllCanvases = useCallback(() => {
    for (const canvas of canvasRefs.current) {
      zeroOutCanvas(canvas);
    }
    canvasRefs.current = [];
    pageContainerRefs.current = [];
  }, []);

  // Register Android / hardware back handler while preview is open
  useEffect(() => {
    if (!request || !registerBackHandler) return;
    return registerBackHandler(BACK_PRIORITY.DOCUMENT_PREVIEW, () => {
      onClose();
      return true;
    });
  }, [request, registerBackHandler, onClose]);

  // Escape key closes modal on desktop/keyboard
  useEffect(() => {
    if (!request || typeof window === "undefined") return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [request, onClose]);

  // Compute responsive A4 base fit width inside viewport
  useEffect(() => {
    if (!request) return;
    const measure = () => {
      const el = scrollContainerRef.current;
      const availableW = el ? el.clientWidth - 24 : typeof window !== "undefined" ? window.innerWidth - 24 : 340;
      setBaseFitWidthPx(Math.max(240, Math.min(760, availableW)));
    };
    measure();
    if (typeof window === "undefined") return;
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [request]);

  // Debounce zoom settling so pinch/button gestures re-render crisply after settling
  useEffect(() => {
    if (!request) return;
    const timer = setTimeout(() => {
      setSettledZoom(zoom);
    }, 180);
    return () => clearTimeout(timer);
  }, [request, zoom]);

  // Load PDF bytes & initialize pdf.js session
  useEffect(() => {
    if (!request) {
      loadedBytesRef.current = null;
      setPageSizes([]);
      setCurrentPage(1);
      setZoom(1);
      setSettledZoom(1);
      setErrorMsg(null);
      setActionError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setErrorMsg(null);
    setActionError(null);
    setPageSizes([]);
    setCurrentPage(1);
    setZoom(1);
    setSettledZoom(1);

    const load = async () => {
      try {
        const prevSession = sessionRef.current;
        sessionRef.current = null;
        if (prevSession) {
          await prevSession.destroy();
        }
        clearAllCanvases();

        const loaded = await request.loadBytes();
        if (cancelled) return;

        // Keep an intact slice for Download / Share
        const safeBytes = loaded.pdfBytes.slice();
        loadedBytesRef.current = { pdfBytes: safeBytes, fileName: loaded.fileName };

        const session = await openPdfCanvasDocument(safeBytes, memoryCoordinator);
        if (cancelled) {
          await session.destroy();
          return;
        }
        sessionRef.current = session;

        const sizes: PdfPageBaseSize[] = [];
        for (let pageNo = 1; pageNo <= session.numPages; pageNo += 1) {
          if (cancelled) return;
          sizes.push(await session.getPageBaseSize(pageNo));
        }

        if (!cancelled) {
          setPageSizes(sizes);
          setCurrentPage(1);
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(
            err instanceof Error
              ? err.message
              : "No se pudo cargar la vista previa del documento PDF."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
      const activeSession = sessionRef.current;
      sessionRef.current = null;
      if (activeSession) {
        void activeSession.destroy();
      }
      clearAllCanvases();
    };
  }, [request, memoryCoordinator, reloadNonce, clearAllCanvases]);

  // Render pages at crisp settledZoom resolution
  useEffect(() => {
    const session = sessionRef.current;
    if (!request || !session || pageSizes.length === 0) return;

    const controller = new AbortController();
    const targetWidthPx = Math.round(baseFitWidthPx * settledZoom);

    const renderPages = async () => {
      for (let idx = 0; idx < pageSizes.length; idx += 1) {
        if (controller.signal.aborted) break;
        const pageNo = idx + 1;
        const canvas = canvasRefs.current[idx];
        if (!canvas) continue;
        try {
          await session.renderPageToCanvas({
            pageNumber: pageNo,
            canvas,
            targetWidthPx,
            signal: controller.signal,
          });
        } catch {
          // Ignore individual page abort or cleanup race
        }
      }
    };

    void renderPages();

    return () => {
      controller.abort();
    };
  }, [request, pageSizes, baseFitWidthPx, settledZoom]);

  const handleViewportScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || pageSizes.length === 0) return;
    const containerRect = container.getBoundingClientRect();
    const viewportMidY = containerRect.top + containerRect.height * 0.4;

    let bestPage = 1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < pageSizes.length; i += 1) {
      const pageEl = pageContainerRefs.current[i];
      if (!pageEl) continue;
      const rect = pageEl.getBoundingClientRect();
      const pageMidY = rect.top + rect.height / 2;
      const dist = Math.abs(pageMidY - viewportMidY);
      if (dist < bestDistance) {
        bestDistance = dist;
        bestPage = i + 1;
      }
    }
    setCurrentPage(bestPage);
  }, [pageSizes.length]);

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2) {
      pinchRef.current = {
        initialDistance: getTouchDistance(e.touches),
        initialZoom: zoom,
      };
      lastTapRef.current = null;
      return;
    }
    if (e.touches.length === 1) {
      const touch = e.touches[0]!;
      const now = Date.now();
      const prev = lastTapRef.current;
      if (
        prev &&
        now - prev.timeMs < 300 &&
        Math.hypot(touch.clientX - prev.x, touch.clientY - prev.y) < 30
      ) {
        lastTapRef.current = null;
        setZoom((z) => (Math.abs(z - 1) < 0.08 ? DOUBLE_TAP_ZOOM : 1));
      } else {
        lastTapRef.current = { timeMs: now, x: touch.clientX, y: touch.clientY };
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2 && pinchRef.current && pinchRef.current.initialDistance > 0) {
      const currentDist = getTouchDistance(e.touches);
      if (currentDist > 0) {
        const nextZoom = clampZoom(
          pinchRef.current.initialZoom * (currentDist / pinchRef.current.initialDistance)
        );
        setZoom(nextZoom);
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length < 2) {
      pinchRef.current = null;
    }
  };

  const handleDoubleClick = () => {
    setZoom((z) => (Math.abs(z - 1) < 0.08 ? DOUBLE_TAP_ZOOM : 1));
  };

  const handleDownloadOrShareClick = async () => {
    if (!request || sharingBusy) return;
    setActionError(null);
    setSharingBusy(true);
    try {
      let payload = loadedBytesRef.current;
      if (!payload) {
        const loaded = await request.loadBytes();
        payload = { pdfBytes: loaded.pdfBytes.slice(), fileName: loaded.fileName };
        loadedBytesRef.current = payload;
      }
      await request.onDownloadOrShare(payload.pdfBytes.slice(), payload.fileName);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "No se pudo descargar o compartir el PDF."
      );
    } finally {
      setSharingBusy(false);
    }
  };

  const handleSecondaryClick = async () => {
    if (!request?.secondaryAction || secondaryBusy) return;
    setActionError(null);
    setSecondaryBusy(true);
    try {
      await request.secondaryAction.onClick();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Error ejecutando la acción.");
    } finally {
      setSecondaryBusy(false);
    }
  };

  if (!request) return null;

  const totalPages = Math.max(1, pageSizes.length);
  const zoomPercent = Math.round(zoom * 100);

  return (
    <div
      data-testid="document-preview-modal"
      role="dialog"
      aria-modal="true"
      aria-label={`Vista previa: ${request.title}`}
      className="fixed inset-0 z-[85] flex flex-col bg-[#24201C] text-[#2C2621] font-sans"
    >
      {/* Top Bar */}
      <header className="shrink-0 border-b border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2.5 shadow-sm">
        <div className="mx-auto flex max-w-4xl flex-col gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="doc-preview-close-btn"
              onClick={onClose}
              aria-label="Cerrar vista previa"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] text-[#2C2621] hover:bg-[#EFECE4] cursor-pointer"
            >
              <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <h2 className="truncate text-sm font-bold text-[#2C2621]">{request.title}</h2>
                {request.isDraft && (
                  <span
                    data-testid="doc-preview-draft-badge"
                    className="inline-flex items-center rounded-full border border-[#E6B84C]/60 bg-[#FFF3A1] px-2 py-0.5 text-[10px] font-bold tracking-wide text-[#3E3300]"
                  >
                    BORRADOR
                  </span>
                )}
              </div>
              {request.subtitle && (
                <p className="truncate text-[11px] text-[#6B6860]">{request.subtitle}</p>
              )}
            </div>

            <div
              data-testid="doc-preview-page-indicator"
              className="shrink-0 rounded-lg border border-[#E5DFD2] bg-[#F5F1E6] px-2.5 py-1 text-[11px] font-semibold tabular-nums text-[#2C2621]"
            >
              Pág. {Math.min(currentPage, totalPages)} / {totalPages}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="doc-preview-share-btn"
              disabled={loading || sharingBusy}
              onClick={() => void handleDownloadOrShareClick()}
              className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#EA580C] px-3 text-xs font-semibold text-white hover:bg-[#D04B00] disabled:opacity-50 cursor-pointer transition-colors"
            >
              <Share2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{sharingBusy ? "Preparando PDF..." : "Descargar / Compartir PDF"}</span>
            </button>

            {request.secondaryAction && (
              <button
                type="button"
                data-testid={request.secondaryAction.testId ?? "doc-preview-secondary-btn"}
                disabled={secondaryBusy}
                onClick={() => void handleSecondaryClick()}
                className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] px-3 text-xs font-semibold text-[#2C2621] hover:bg-[#EFECE4] disabled:opacity-50 cursor-pointer"
              >
                {request.secondaryAction.icon === "rectify" ? (
                  <FileWarning className="h-4 w-4 shrink-0 text-[#D97706]" aria-hidden="true" />
                ) : (
                  <Copy className="h-4 w-4 shrink-0 text-[#4B7094]" aria-hidden="true" />
                )}
                <span>{secondaryBusy ? "Abriendo..." : request.secondaryAction.label}</span>
              </button>
            )}

            {request.openDetailAction && (
              <button
                type="button"
                data-testid={request.openDetailAction.testId ?? "doc-preview-detail-btn"}
                onClick={request.openDetailAction.onClick}
                className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 text-xs font-semibold text-[#2C2621] hover:bg-[#F5F1E6] cursor-pointer"
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[#6B6860]" aria-hidden="true" />
                <span>{request.openDetailAction.label}</span>
              </button>
            )}
          </div>

          {actionError && (
            <div
              role="alert"
              className="rounded-xl border border-[#DC2626]/30 bg-[#FAD2D8] px-3 py-2 text-[11px] font-medium text-[#5A121C]"
            >
              {actionError}
            </div>
          )}
        </div>
      </header>

      {/* Scrollable 2D Canvas Viewport */}
      <div
        ref={scrollContainerRef}
        data-testid="doc-preview-viewport"
        onScroll={handleViewportScroll}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onDoubleClick={handleDoubleClick}
        className="relative flex-1 overflow-auto p-3 sm:p-5"
        style={{ touchAction: "pan-x pan-y" }}
      >
        {loading && (
          <div className="flex h-full min-h-[260px] flex-col items-center justify-center gap-3 text-[#FFFDF7]">
            <Loader2 className="h-8 w-8 animate-spin text-[#EA580C]" aria-hidden="true" />
            <p className="text-xs font-medium text-[#EFECE4]">Renderizando documento PDF...</p>
          </div>
        )}

        {!loading && errorMsg && (
          <div className="mx-auto mt-10 max-w-md rounded-2xl border border-[#DC2626]/40 bg-[#FFFDF7] p-5 text-center space-y-3">
            <p className="text-sm font-bold text-[#DC2626]">No se pudo mostrar el PDF</p>
            <p className="text-xs text-[#6B6860] break-words">{errorMsg}</p>
            <div className="flex justify-center gap-2">
              <button
                type="button"
                onClick={() => setReloadNonce((n) => n + 1)}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[#EA580C] px-4 text-xs font-semibold text-white cursor-pointer"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                <span>Reintentar</span>
              </button>
            </div>
          </div>
        )}

        {!loading && !errorMsg && pageSizes.length > 0 && (
          <div className="flex min-w-full flex-col items-center gap-4 pb-20">
            {pageSizes.map((size, idx) => {
              const aspect = size.width > 0 ? size.height / size.width : A4_ASPECT_RATIO;
              const displayW = Math.round(baseFitWidthPx * zoom);
              const displayH = Math.round(displayW * aspect);

              return (
                <div
                  key={size.pageNumber}
                  ref={(el) => {
                    pageContainerRefs.current[idx] = el;
                  }}
                  data-testid={`doc-preview-page-${size.pageNumber}`}
                  className="shrink-0 overflow-hidden rounded-sm bg-white shadow-[0_8px_28px_rgba(0,0,0,0.45)] ring-1 ring-black/15"
                  style={{ width: `${displayW}px`, height: `${displayH}px` }}
                >
                  <canvas
                    ref={(el) => {
                      canvasRefs.current[idx] = el;
                    }}
                    className="block h-full w-full"
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Floating Zoom Controls */}
      {!loading && !errorMsg && pageSizes.length > 0 && (
        <div
          data-testid="doc-preview-zoom-controls"
          className="pointer-events-auto fixed bottom-4 left-1/2 z-[86] flex -translate-x-1/2 items-center gap-1 rounded-full border border-[#E5DFD2] bg-[#FFFDF7]/95 px-2 py-1.5 shadow-lg backdrop-blur-sm"
        >
          <button
            type="button"
            data-testid="doc-preview-zoom-out-btn"
            aria-label="Alejar"
            disabled={zoom <= MIN_ZOOM}
            onClick={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#2C2621] hover:bg-[#EFECE4] disabled:opacity-35 cursor-pointer"
          >
            <Minus className="h-4 w-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            data-testid="doc-preview-zoom-reset-btn"
            aria-label="Restablecer zoom al 100%"
            onClick={() => setZoom(1)}
            className="min-w-[52px] rounded-full px-2 py-1 text-center text-xs font-bold tabular-nums text-[#2C2621] hover:bg-[#EFECE4] cursor-pointer"
          >
            {zoomPercent}%
          </button>

          <button
            type="button"
            data-testid="doc-preview-zoom-in-btn"
            aria-label="Acercar"
            disabled={zoom >= MAX_ZOOM}
            onClick={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#2C2621] hover:bg-[#EFECE4] disabled:opacity-35 cursor-pointer"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>

          <div className="mx-0.5 h-4 w-px bg-[#E5DFD2]" aria-hidden="true" />

          <button
            type="button"
            data-testid="doc-preview-zoom-fit-btn"
            onClick={() => setZoom(1)}
            className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-semibold text-[#2C2621] hover:bg-[#EFECE4] cursor-pointer"
          >
            <Maximize2 className="h-3.5 w-3.5 text-[#6B6860]" aria-hidden="true" />
            <span>Ajustar</span>
          </button>
        </div>
      )}
    </div>
  );
}
