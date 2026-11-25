import { ArrowLeft, CheckCircle2, FileText, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalInferenceAdapterImpl } from "../../agent/inference/localInferenceAdapter";
import type {
  ActaPuestaEnMarchaData,
  ActaRow,
  AppSettingsRecord,
  ClientRow,
  EstadoActa,
  LocalFileBridge,
  MemoryCoordinator,
  SqliteExecutor,
} from "../../core/contracts/types";
import { ActasRepository } from "../../core/db/repositories/actasRepo";
import { ClientsRepository } from "../../core/db/repositories/clientsRepo";
import { SettingsRepository } from "../../core/db/repositories/settingsRepo";
import type { DocumentOpenerService } from "../../core/files/documentOpener";
import type { CameraAdapter } from "../../core/hardware/cameraAdapter";
import type { VoiceInputAdapter } from "../../core/hardware/voiceAdapter";
import type { PdfPort } from "../../core/ports/mediaPorts";
import { ConfirmDeleteDialog } from "../../ui/ConfirmDeleteDialog";
import { ActaFreeFormBlocks } from "./ActaFreeFormBlocks";
import { ActaGuidedChatPanel } from "./ActaGuidedChatPanel";
import { computeActaCompletion } from "./actaTemplates";
import { SignaturePadModal } from "./SignaturePadModal";

interface ActaPuestaEnMarchaViewProps {
  actaId: string;
  initialMode?: "guided" | "free";
  executor: SqliteExecutor;
  fileBridge: LocalFileBridge;
  cameraAdapter?: CameraAdapter;
  pdfPort: PdfPort;
  documentOpener: DocumentOpenerService;
  memoryCoordinator?: MemoryCoordinator;
  voiceAdapter?: VoiceInputAdapter;
  inferenceAdapter?: LocalInferenceAdapterImpl;
  refreshTick: number;
  registerBackHandler?: (priority: number, handler: () => boolean) => () => void;
  onBack: () => void;
  onDataChanged: () => Promise<void>;
}

const ESTADO_LABELS: Record<EstadoActa, { label: string; cls: string }> = {
  borrador: {
    label: "Borrador",
    cls: "bg-terracotta-soft text-on-primary-container",
  },
  completada: {
    label: "Completada",
    cls: "bg-info-container text-on-info-container",
  },
  firmada: {
    label: "Firmada",
    cls: "bg-success-container text-on-success-container",
  },
};

export function ActaPuestaEnMarchaView({
  actaId,
  initialMode = "free",
  executor,
  fileBridge,
  cameraAdapter,
  pdfPort,
  documentOpener,
  memoryCoordinator,
  voiceAdapter,
  inferenceAdapter,
  refreshTick,
  registerBackHandler,
  onBack,
  onDataChanged,
}: ActaPuestaEnMarchaViewProps) {
  const [loading, setLoading] = useState(true);
  const [actaRow, setActaRow] = useState<ActaRow | null>(null);
  const [formData, setFormData] = useState<ActaPuestaEnMarchaData | null>(null);
  const [estado, setEstado] = useState<EstadoActa>("borrador");
  const [linkedClientId, setLinkedClientId] = useState<string | null>(null);
  const [firmaClienteBase64, setFirmaClienteBase64] = useState<string | null>(null);
  const [firmaInstaladorBase64, setFirmaInstaladorBase64] = useState<string | null>(null);
  const [allClients, setAllClients] = useState<ClientRow[]>([]);
  const [appSettings, setAppSettings] = useState<AppSettingsRecord | null>(null);

  const [mode, setMode] = useState<"guided" | "free">(initialMode);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [activeSignatureTarget, setActiveSignatureTarget] = useState<
    "client" | "installer" | null
  >(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestDraftRef = useRef<{
    data: ActaPuestaEnMarchaData | null;
    estado: EstadoActa;
    clientId: string | null;
    firmaClienteBase64: string | null;
    firmaInstaladorBase64: string | null;
  }>({
    data: null,
    estado: "borrador",
    clientId: null,
    firmaClienteBase64: null,
    firmaInstaladorBase64: null,
  });

  latestDraftRef.current = {
    data: formData,
    estado,
    clientId: linkedClientId,
    firmaClienteBase64,
    firmaInstaladorBase64,
  };

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode, actaId]);

  useEffect(() => {
    let active = true;
    const loadAll = async () => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const [loaded, settings, clientsRes] = await Promise.all([
          new ActasRepository(executor).getById(actaId),
          new SettingsRepository(executor).getAppSettings(),
          new ClientsRepository(executor).listPaginated({ limit: 100, offset: 0 }),
        ]);
        if (!active) return;
        if (!loaded) {
          setActaRow(null);
          setFormData(null);
          return;
        }
        setActaRow(loaded.row);
        setFormData(loaded.data);
        setEstado(loaded.row.estado);
        setLinkedClientId(loaded.row.client_id);
        setFirmaClienteBase64(loaded.row.firma_cliente_base64);
        setFirmaInstaladorBase64(
          loaded.row.firma_instalador_base64 ?? settings.emitter_signature_data_url ?? null
        );
        setAppSettings(settings);
        setAllClients(clientsRes.items);
        setDirty(false);
      } catch (err) {
        if (active) {
          setErrorMsg(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void loadAll();
    return () => {
      active = false;
    };
  }, [actaId, executor, refreshTick]);

  const flushSave = useCallback(
    async (notifyUser = false) => {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const snapshot = latestDraftRef.current;
      if (!snapshot.data) return;

      setSaving(true);
      setErrorMsg(null);
      try {
        const saved = await new ActasRepository(executor, memoryCoordinator).saveDraft(actaId, {
          data: snapshot.data,
          estado: snapshot.estado,
          clientId: snapshot.clientId,
          firmaClienteBase64: snapshot.firmaClienteBase64,
          firmaInstaladorBase64: snapshot.firmaInstaladorBase64,
        });
        setActaRow(saved.row);
        setDirty(false);
        if (notifyUser) {
          setStatusMsg("Borrador guardado localmente.");
        }
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    },
    [actaId, executor, memoryCoordinator]
  );

  useEffect(() => {
    if (!dirty || !formData) return;
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void flushSave(false);
    }, 700);
    return () => {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [dirty, formData, estado, linkedClientId, firmaClienteBase64, firmaInstaladorBase64, flushSave]);

  const handleBack = async () => {
    if (dirty) {
      await flushSave(false);
    }
    await onDataChanged();
    onBack();
  };

  const handleModeSwitch = async (nextMode: "guided" | "free") => {
    if (nextMode === mode) return;
    if (dirty) {
      await flushSave(false);
    }
    setMode(nextMode);
  };

  const handlePreviewPdf = async () => {
    setErrorMsg(null);
    setStatusMsg(null);
    setPdfBusy(true);
    try {
      await flushSave(false);
      await documentOpener.openPdf(null, "acta", actaId, pdfPort, { forceRegenerate: true });
      const fresh = await new ActasRepository(executor, memoryCoordinator).getById(actaId);
      if (fresh) setActaRow(fresh.row);
      setStatusMsg("PDF A4 generado correctamente.");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setPdfBusy(false);
    }
  };

  const handleGenerateAndSharePdf = async () => {
    setErrorMsg(null);
    setStatusMsg(null);
    if (!firmaClienteBase64) {
      setErrorMsg("Recoge primero la firma táctil de conformidad del cliente.");
      setActiveSignatureTarget("client");
      return;
    }
    setPdfBusy(true);
    try {
      await flushSave(false);
      const repo = new ActasRepository(executor, memoryCoordinator);
      const signed = await repo.markSigned(actaId, {
        data: latestDraftRef.current.data ?? undefined,
        firmaClienteBase64,
        firmaInstaladorBase64,
      });
      setActaRow(signed.row);
      setEstado(signed.row.estado);

      await documentOpener.openPdf(null, "acta", actaId, pdfPort, { forceRegenerate: true });
      const fresh = await repo.getById(actaId);
      if (fresh) setActaRow(fresh.row);
      await onDataChanged();
      setStatusMsg("Acta firmada y PDF A4 preparado para compartir.");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setPdfBusy(false);
    }
  };

  const handleConfirmDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    try {
      await new ActasRepository(executor).delete(actaId, fileBridge);
      setConfirmDeleteOpen(false);
      await onDataChanged();
      onBack();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  if (loading && !formData) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-xs text-on-surface-variant">
        Cargando acta de puesta en marcha...
      </div>
    );
  }

  if (!actaRow || !formData) {
    return (
      <div
        data-testid="acta-not-found-view"
        className="flex flex-1 flex-col items-center justify-center p-6 text-center space-y-3"
      >
        <p className="text-sm font-bold text-on-surface">Acta no encontrada</p>
        <p className="text-xs text-on-surface-variant">
          Es posible que se haya eliminado o restaurado la base de datos.
        </p>
        <button
          type="button"
          onClick={onBack}
          className="min-h-[44px] rounded-xl bg-secondary px-4 text-xs font-semibold text-on-secondary cursor-pointer"
        >
          Volver a Actas
        </button>
      </div>
    );
  }

  const completion = computeActaCompletion(formData, {
    cliente: firmaClienteBase64,
    instalador: firmaInstaladorBase64,
  });
  const progressPct = Math.round((completion.completedBlocks / completion.totalBlocks) * 100);
  const badge = ESTADO_LABELS[estado];

  return (
    <div
      data-testid="acta-editor-view"
      className="flex flex-1 flex-col w-full max-w-full overflow-hidden bg-surface text-xs"
    >
      {/* Cabecera fija con selector de modo */}
      <div className="shrink-0 border-b border-outline-variant bg-surface-container-lowest px-4 py-3 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            data-testid="acta-back-btn"
            onClick={() => void handleBack()}
            className="inline-flex min-h-[40px] items-center gap-1 rounded-full border border-outline-variant bg-white px-3 text-[12px] font-semibold text-on-surface cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Actas</span>
          </button>

          <div className="flex items-center gap-1.5 min-w-0">
            <span
              data-testid="acta-header-code"
              className="font-mono text-[13px] font-bold text-on-surface truncate"
            >
              {actaRow.codigo_acta}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.cls}`}>
              {badge.label}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              data-testid="acta-preview-pdf-btn"
              disabled={pdfBusy}
              onClick={() => void handlePreviewPdf()}
              aria-label="Vista previa PDF"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-outline-variant bg-white text-on-surface disabled:opacity-50 cursor-pointer"
            >
              <FileText className="h-4 w-4" />
            </button>
            <button
              type="button"
              data-testid="acta-delete-btn"
              onClick={() => {
                setDeleteError(null);
                setConfirmDeleteOpen(true);
              }}
              aria-label="Eliminar acta"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-coral-alert/30 bg-white text-coral-alert cursor-pointer"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Segmented Control */}
        <div
          data-testid="acta-mode-segmented"
          className="grid grid-cols-2 gap-1 rounded-full border border-outline-variant bg-surface-container-low p-1"
        >
          <button
            type="button"
            data-testid="acta-mode-guided-btn"
            onClick={() => void handleModeSwitch("guided")}
            className={`min-h-[38px] rounded-full text-[12px] font-semibold transition-colors cursor-pointer ${
              mode === "guided"
                ? "bg-secondary text-on-secondary"
                : "text-on-surface-variant"
            }`}
          >
            Modo Guiado (Asistente)
          </button>
          <button
            type="button"
            data-testid="acta-mode-free-btn"
            onClick={() => void handleModeSwitch("free")}
            className={`min-h-[38px] rounded-full text-[12px] font-semibold transition-colors cursor-pointer ${
              mode === "free"
                ? "bg-secondary text-on-secondary"
                : "text-on-surface-variant"
            }`}
          >
            Rellenar Libremente
          </button>
        </div>

        {/* Indicador de progreso y autoguardado */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <span data-testid="acta-progress-label" className="font-semibold text-on-surface">
              {completion.completedBlocks}/{completion.totalBlocks} bloques completados
            </span>
            <button
              type="button"
              data-testid="acta-save-now-btn"
              disabled={saving}
              onClick={() => void flushSave(true)}
              className="inline-flex items-center gap-1 font-semibold text-on-primary-container cursor-pointer disabled:opacity-50"
            >
              <Save className="h-3 w-3" />
              <span>
                {saving ? "Guardando..." : dirty ? "Guardar cambios" : "Guardado local"}
              </span>
            </button>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container">
            <div
              className="h-full rounded-full bg-terracotta transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Área principal */}
      {mode === "guided" ? (
        <div className="min-h-0 flex-1 flex flex-col">
          {(errorMsg || statusMsg) && (
            <div className="shrink-0 px-4 pt-2 space-y-2">
              {errorMsg && (
                <div
                  role="alert"
                  className="rounded-xl border border-coral-alert/30 bg-error-container px-3 py-2 text-xs font-semibold text-on-error-container"
                >
                  {errorMsg}
                </div>
              )}
              {statusMsg && (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-outline-variant bg-success-container px-3 py-2 text-xs font-semibold text-on-success-container">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    <span>{statusMsg}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setStatusMsg(null)}
                    className="font-bold cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          )}
          <ActaGuidedChatPanel
            actaId={actaId}
            jobId={actaRow.job_id}
            executor={executor}
            data={formData}
            appSettings={appSettings}
            fileBridge={fileBridge}
            cameraAdapter={cameraAdapter}
            voiceAdapter={voiceAdapter}
            inferenceAdapter={inferenceAdapter}
            firmaClienteBase64={firmaClienteBase64}
            firmaInstaladorBase64={firmaInstaladorBase64}
            pdfBusy={pdfBusy}
            registerBackHandler={registerBackHandler}
            onApplyData={(nextData) => {
              setStatusMsg(null);
              setFormData(nextData);
              setDirty(true);
            }}
            onSettingsUpdated={(updated) => {
              setAppSettings(updated);
              void onDataChanged();
            }}
            onOpenClientSignature={() => setActiveSignatureTarget("client")}
            onOpenInstallerSignature={() => setActiveSignatureTarget("installer")}
            onClearClientSignature={() => {
              setFirmaClienteBase64(null);
              setDirty(true);
            }}
            onGenerateAndSharePdf={handleGenerateAndSharePdf}
            onSwitchToFreeMode={() => void handleModeSwitch("free")}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar p-4 space-y-3">
          {errorMsg && (
            <div
              role="alert"
              className="rounded-xl border border-coral-alert/30 bg-error-container px-3 py-2 text-xs font-semibold text-on-error-container"
            >
              {errorMsg}
            </div>
          )}
          {statusMsg && (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-outline-variant bg-success-container px-3 py-2 text-xs font-semibold text-on-success-container">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                <span>{statusMsg}</span>
              </span>
              <button
                type="button"
                onClick={() => setStatusMsg(null)}
                className="font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>
          )}

          <ActaFreeFormBlocks
            actaId={actaId}
            jobId={actaRow.job_id}
            executor={executor}
            fileBridge={fileBridge}
            cameraAdapter={cameraAdapter}
            data={formData}
            estado={estado}
            linkedClientId={linkedClientId}
            allClients={allClients}
            appSettings={appSettings}
            blockStates={completion.blockStates}
            firmaClienteBase64={firmaClienteBase64}
            firmaInstaladorBase64={firmaInstaladorBase64}
            pdfBusy={pdfBusy}
            voiceAdapter={voiceAdapter}
            registerBackHandler={registerBackHandler}
            onChangeData={(updater) => {
              setStatusMsg(null);
              setFormData((prev) => (prev ? updater(prev) : prev));
              setDirty(true);
            }}
            onChangeEstado={(next) => {
              setStatusMsg(null);
              setEstado(next);
              setDirty(true);
            }}
            onLinkClient={(clientId, clientPatch) => {
              setLinkedClientId(clientId);
              if (clientPatch) {
                setFormData((prev) =>
                  prev
                    ? {
                        ...prev,
                        cliente: { ...prev.cliente, ...clientPatch },
                      }
                    : prev
                );
              }
              setDirty(true);
            }}
            onClientsUpdated={setAllClients}
            onSettingsUpdated={(updated) => {
              setAppSettings(updated);
              void onDataChanged();
            }}
            onOpenClientSignature={() => setActiveSignatureTarget("client")}
            onOpenInstallerSignature={() => setActiveSignatureTarget("installer")}
            onClearClientSignature={() => {
              setFirmaClienteBase64(null);
              setDirty(true);
            }}
            onGenerateAndSharePdf={handleGenerateAndSharePdf}
          />
        </div>
      )}

      <SignaturePadModal
        open={activeSignatureTarget !== null}
        title={
          activeSignatureTarget === "installer"
            ? "Firma del instalador autorizado"
            : "Firma de conformidad del cliente"
        }
        subtitle={
          activeSignatureTarget === "installer"
            ? "Firma técnica de la empresa instaladora para esta acta."
            : "Al firmar, el titular confirma la recepción e instrucciones básicas de la instalación."
        }
        showSaveAsDefaultOption={activeSignatureTarget === "installer"}
        defaultSaveAsDefault={
          activeSignatureTarget === "installer" && !appSettings?.emitter_signature_data_url
        }
        registerBackHandler={registerBackHandler}
        onClose={() => setActiveSignatureTarget(null)}
        onConfirm={async (dataUrl, saveAsDefault) => {
          if (activeSignatureTarget === "client") {
            setFirmaClienteBase64(dataUrl);
            setDirty(true);
            setActiveSignatureTarget(null);
            return;
          }
          if (activeSignatureTarget === "installer") {
            setFirmaInstaladorBase64(dataUrl);
            setDirty(true);
            if (saveAsDefault && appSettings) {
              const updated = await new SettingsRepository(executor).updateInstallerActaProfile({
                emitter_email: appSettings.emitter_email,
                emitter_registry_number: appSettings.emitter_registry_number,
                emitter_tech_name: appSettings.emitter_tech_name,
                emitter_tech_dni: appSettings.emitter_tech_dni,
                emitter_installer_card: appSettings.emitter_installer_card,
                default_acta_warranty_months: appSettings.default_acta_warranty_months,
                emitter_signature_data_url: dataUrl,
              });
              setAppSettings(updated);
              await onDataChanged();
            }
            setActiveSignatureTarget(null);
          }
        }}
      />

      <ConfirmDeleteDialog
        open={confirmDeleteOpen}
        title={`¿Eliminar acta ${actaRow.codigo_acta}?`}
        description="Se eliminará el acta técnica, sus mediciones y documentos asociados. Esta acción no se puede deshacer."
        errorMsg={deleteError}
        busy={deleting}
        confirmTestId="acta-confirm-delete-btn"
        registerBackHandler={registerBackHandler}
        onCancel={() => {
          if (!deleting) {
            setConfirmDeleteOpen(false);
            setDeleteError(null);
          }
        }}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
