import { useEffect, useRef, useState } from "react";
import type { LocalInferenceAdapterImpl } from "../../agent/inference/localInferenceAdapter";
import { BackupService } from "../../core/backup/backupService";
import { ResetService } from "../../core/backup/resetService";
import { TEXT_LIMITS } from "../../core/contracts/textLimits";
import type {
  AppSettingsRecord,
  DocumentImportReviewDraft,
  LocalAccountRecord,
  MemoryCoordinator,
  SeriesType,
  SqliteExecutor,
} from "../../core/contracts/types";
import { SettingsRepository } from "../../core/db/repositories/settingsRepo";
import { resizeLogoFileToDataUrl } from "../../core/files/logoImageHelper";
import { getFiscalYearFromIso, getLocalTodayIso } from "../../core/fiscal/dateQuarter";
import type { VoiceInputAdapter } from "../../core/hardware/voiceAdapter";
import { BACK_PRIORITY } from "../../core/navigation/routes";
import type { OcrPort } from "../../core/ports/mediaPorts";
import { useZoomTextEditor } from "../../ui/zoomTextEditorContext";
import { ZoomableTextField } from "../../ui/ZoomableTextField";
import {
  ApkUpdaterService,
  type AvailableUpdateInfo,
  type InstalledAppVersion,
} from "../../core/updates/apkUpdaterService";
import type { CapacitorLlmAdapter } from "../llm/capacitorLlmAdapter";
import type { MediaPipeLlmAdapter } from "../llm/mediaPipeAdapter";
import { PricingCatalogPanel } from "../pricing/PricingCatalogPanel";
import { UpdateBanner } from "../updates/UpdateBanner";
import { QuoteDefaultsCard } from "./QuoteDefaultsCard";
import { InstallerActaSettingsCard } from "./InstallerActaSettingsCard";
import { isUsingDevSuperAdminPin, verifySuperAdminPin } from "./superAdminAuth";
import { SuperAdminLlmPanel } from "./SuperAdminLlmPanel";
import { TaxCalendarSettingsCard } from "./TaxCalendarSettingsCard";

interface SettingsSheetProps {
  executor: SqliteExecutor;
  inferenceAdapter: LocalInferenceAdapterImpl;
  mediaPipeAdapter: MediaPipeLlmAdapter;
  capacitorLlmAdapter: CapacitorLlmAdapter;
  memoryCoordinator: MemoryCoordinator;
  ocrPort: OcrPort;
  voiceAdapter?: VoiceInputAdapter;
  refreshTick: number;
  activeSection: "general" | "personalizacion";
  activeAccount: LocalAccountRecord | null;
  onSelectSection: (section: "general" | "personalizacion") => void;
  onOpenDocumentImport: (draft: DocumentImportReviewDraft, currentHourlyRateCents: number) => void;
  superAdminUnlocked: boolean;
  onSetSuperAdminUnlocked: (unlocked: boolean) => void;
  onDataRebuilt: (options?: { resetRoute?: boolean }) => Promise<void>;
  onReopenOnboarding: () => Promise<void>;
  onLogout: () => Promise<void>;
  apkUpdaterService?: ApkUpdaterService;
  onUpdateFound?: (update: AvailableUpdateInfo) => void;
  registerBackHandler?: (priority: number, handler: () => boolean) => () => void;
}

export function SettingsSheet({
  executor,
  inferenceAdapter,
  mediaPipeAdapter,
  capacitorLlmAdapter,
  memoryCoordinator,
  ocrPort,
  voiceAdapter,
  refreshTick,
  activeSection,
  activeAccount,
  onSelectSection,
  onOpenDocumentImport,
  superAdminUnlocked,
  onSetSuperAdminUnlocked,
  onDataRebuilt,
  onReopenOnboarding,
  onLogout,
  apkUpdaterService,
  onUpdateFound,
  registerBackHandler,
}: SettingsSheetProps) {
  const fiscalYear = getFiscalYearFromIso(getLocalTodayIso());
  const [emitterName, setEmitterName] = useState("");
  const [emitterNif, setEmitterNif] = useState("");
  const [emitterAddr, setEmitterAddr] = useState("");
  const [emitterPhone, setEmitterPhone] = useState("");
  const [emitterEmail, setEmitterEmail] = useState("");
  const [emitterIban, setEmitterIban] = useState("");
  const [emitterBankName, setEmitterBankName] = useState("");
  const [emitterLogoDataUrl, setEmitterLogoDataUrl] = useState<string | null>(null);
  const [defaultVatRate, setDefaultVatRate] = useState("21");
  const [irpfReserveRate, setIrpfReserveRate] = useState("20");
  const [loadedSettings, setLoadedSettings] = useState<AppSettingsRecord | null>(null);

  const [seqPRE, setSeqPRE] = useState("0");
  const [seqANT, setSeqANT] = useState("0");
  const [seqFAC, setSeqFAC] = useState("0");
  const [seqOBR, setSeqOBR] = useState("0");
  const [seqACT, setSeqACT] = useState("0");

  const [backupPassword, setBackupPassword] = useState("");

  const [showAdminModal, setShowAdminModal] = useState(false);
  const [adminPinInput, setAdminPinInput] = useState("");
  const [adminAuthError, setAdminAuthError] = useState<string | null>(null);
  const tapTimestampsRef = useRef<number[]>([]);

  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const updater = useRef<ApkUpdaterService>(apkUpdaterService ?? new ApkUpdaterService()).current;
  const { enabled: expandLongTextInputs, setEnabled: setExpandLongTextInputs } = useZoomTextEditor();
  const [savingExpandToggle, setSavingExpandToggle] = useState(false);
  const [installedVersion, setInstalledVersion] = useState<InstalledAppVersion | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateCheckInfo, setUpdateCheckInfo] = useState<string | null>(null);
  const [foundUpdateInSettings, setFoundUpdateInSettings] = useState<AvailableUpdateInfo | null>(
    null
  );

  useEffect(() => {
    let active = true;
    void updater.getInstalledVersion().then((ver) => {
      if (active && ver) setInstalledVersion(ver);
    });
    return () => {
      active = false;
    };
  }, [updater]);

  const handleCheckUpdates = async () => {
    setCheckingUpdates(true);
    setUpdateCheckInfo(null);
    try {
      const res = await updater.checkForUpdate();
      if (res.status === "unsupported") {
        setUpdateCheckInfo("La comprobación automática de APK se ejecuta en la app Android.");
        return;
      }
      if (res.status === "available") {
        setFoundUpdateInSettings(res.update);
        onUpdateFound?.(res.update);
        return;
      }
      if (res.status === "up_to_date") {
        setFoundUpdateInSettings(null);
        setUpdateCheckInfo(
          `Tu app está en la última versión (v${res.installedVersionName}).`
        );
        return;
      }
      setUpdateCheckInfo(
        "No se pudo comprobar (sin conexión o sin versión publicada todavía)."
      );
    } finally {
      setCheckingUpdates(false);
    }
  };

  const loadSettings = async () => {
    const repo = new SettingsRepository(executor);
    const [settings, sequences] = await Promise.all([
      repo.getAppSettings(),
      repo.listSequences(fiscalYear),
    ]);
    setEmitterName(settings.emitter_name);
    setEmitterNif(settings.emitter_nif);
    setEmitterAddr(settings.emitter_fiscal_address);
    setEmitterPhone(settings.emitter_phone);
    setEmitterEmail(settings.emitter_email);
    setEmitterIban(settings.emitter_iban);
    setEmitterBankName(settings.emitter_bank_name);
    setEmitterLogoDataUrl(settings.emitter_logo_data_url);
    setDefaultVatRate(String(settings.default_vat_rate));
    setIrpfReserveRate(String(settings.irpf_reserve_rate));
    setLoadedSettings(settings);

    const mapSeq = new Map<SeriesType, number>();
    for (const s of sequences) mapSeq.set(s.series_type, s.last_seq);
    setSeqPRE(String(mapSeq.get("PRE") ?? 0));
    setSeqANT(String(mapSeq.get("ANT") ?? 0));
    setSeqFAC(String(mapSeq.get("FAC") ?? 0));
    setSeqOBR(String(mapSeq.get("OBR") ?? 0));
    setSeqACT(String(mapSeq.get("ACT") ?? 0));
  };

  useEffect(() => {
    void loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executor, refreshTick]);

  useEffect(() => {
    if (!showAdminModal || !registerBackHandler) return;
    return registerBackHandler(BACK_PRIORITY.MODAL_SECONDARY, () => {
      setShowAdminModal(false);
      return true;
    });
  }, [showAdminModal, registerBackHandler]);

  const handleSaveEmitter = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    setBusy(true);
    try {
      await new SettingsRepository(executor).updateEmitterProfile({
        emitter_name: emitterName,
        emitter_nif: emitterNif,
        emitter_fiscal_address: emitterAddr,
        emitter_phone: emitterPhone,
        emitter_email: emitterEmail,
        emitter_iban: emitterIban,
        emitter_bank_name: emitterBankName,
        emitter_logo_data_url: emitterLogoDataUrl,
      });
      await onDataRebuilt({ resetRoute: false });
      setStatusMsg("Perfil fiscal emisor guardado.");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleLogoFileSelected = async (file: File | undefined) => {
    if (!file) return;
    setErrorMsg(null);
    setStatusMsg(null);
    setBusy(true);
    try {
      const nextUrl = await resizeLogoFileToDataUrl(file);
      setEmitterLogoDataUrl(nextUrl);
      await new SettingsRepository(executor).updateEmitterProfile({
        emitter_name: emitterName,
        emitter_nif: emitterNif,
        emitter_fiscal_address: emitterAddr,
        emitter_phone: emitterPhone,
        emitter_email: emitterEmail,
        emitter_iban: emitterIban,
        emitter_bank_name: emitterBankName,
        emitter_logo_data_url: nextUrl,
      });
      setStatusMsg("Logotipo actualizado para tus PDFs.");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveTaxSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    setBusy(true);
    try {
      const vat = Number.parseFloat(defaultVatRate.replace(",", "."));
      const irpf = Number.parseFloat(irpfReserveRate.replace(",", "."));
      await new SettingsRepository(executor).updateTaxSettings({
        default_vat_rate: Number.isFinite(vat) ? vat : 21,
        irpf_reserve_rate: Number.isFinite(irpf) ? irpf : 20,
      });
      await loadSettings();
      setStatusMsg("Impuestos por defecto guardados.");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveSequences = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    setBusy(true);
    try {
      await new SettingsRepository(executor).configureSequences(fiscalYear, {
        PRE: Number.parseInt(seqPRE, 10) || 0,
        ANT: Number.parseInt(seqANT, 10) || 0,
        FAC: Number.parseInt(seqFAC, 10) || 0,
        OBR: Number.parseInt(seqOBR, 10) || 0,
        ACT: Number.parseInt(seqACT, 10) || 0,
      });
      setStatusMsg(`Contadores de serie ${fiscalYear} actualizados.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleExportBackup = async () => {
    setErrorMsg(null);
    setStatusMsg(null);
    setBusy(true);
    try {
      const envelope = await new BackupService(executor).exportBackupJson(
        backupPassword.trim() || undefined
      );
      const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `obralocal-backup-${getLocalTodayIso()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setStatusMsg(
        envelope.encrypted
          ? "Copia cifrada AES-256-GCM exportada localmente."
          : "Copia de seguridad exportada localmente."
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleImportBackup = async (file: File) => {
    setErrorMsg(null);
    setStatusMsg(null);
    setBusy(true);
    try {
      const raw = await file.text();
      const res = await new BackupService(executor).importBackupJson(
        raw,
        backupPassword.trim() || undefined
      );
      await loadSettings();
      await onDataRebuilt({ resetRoute: true });
      setStatusMsg(
        `Copia restaurada: ${res.restoredCounts.jobs ?? 0} obras, ${res.restoredCounts.invoices ?? 0} facturas.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleStartClean = async () => {
    setErrorMsg(null);
    setStatusMsg(null);
    setBusy(true);
    try {
      await new ResetService(executor).startFromScratch({ PRE: 0, ANT: 0, FAC: 0, OBR: 0, ACT: 0 });
      await loadSettings();
      await onDataRebuilt({ resetRoute: true });
      setStatusMsg("Base de datos reiniciada en limpio con contadores a 0.");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleVersionTap = () => {
    if (superAdminUnlocked) return;
    const now = Date.now();
    const recent = tapTimestampsRef.current.filter((t) => now - t <= 4000);
    recent.push(now);
    tapTimestampsRef.current = recent;
    if (recent.length >= 7) {
      tapTimestampsRef.current = [];
      setAdminPinInput("");
      setAdminAuthError(null);
      setShowAdminModal(true);
    }
  };

  const handleAdminUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminAuthError(null);
    const ok = await verifySuperAdminPin(adminPinInput);
    if (!ok) {
      setAdminAuthError("PIN incorrecto.");
      return;
    }
    setAdminPinInput("");
    setShowAdminModal(false);
    onSetSuperAdminUnlocked(true);
  };

  return (
    <div data-testid="settings-view" className="flex flex-1 flex-col overflow-y-auto no-scrollbar p-4 space-y-4 text-xs font-sans cotton-paper bg-[#F9F7F2] text-[#2C2621]">
      {/* Selector superior: General | Personalización */}
      <div className="grid grid-cols-2 gap-1.5 rounded-full border border-[#E5DFD2] bg-[#EFECE4] p-1">
        <button
          type="button"
          data-testid="settings-tab-general"
          onClick={() => onSelectSection("general")}
          className={`min-h-[40px] rounded-full text-xs font-semibold cursor-pointer transition-colors ${
            activeSection === "general" ? "bg-[#4B7094] text-[#FFFDF9]" : "text-[#6B6860]"
          }`}
        >
          General y Fiscal
        </button>
        <button
          type="button"
          data-testid="settings-tab-personalizacion"
          onClick={() => onSelectSection("personalizacion")}
          className={`min-h-[40px] rounded-full text-xs font-semibold cursor-pointer transition-colors ${
            activeSection === "personalizacion" ? "bg-[#4B7094] text-[#FFFDF9]" : "text-[#6B6860]"
          }`}
        >
          Personalización y Tarifario
        </button>
      </div>

      {activeSection === "personalizacion" ? (
        <PricingCatalogPanel
          executor={executor}
          ocrPort={ocrPort}
          refreshTick={refreshTick}
          voiceAdapter={voiceAdapter}
          inferenceAdapter={inferenceAdapter}
          registerBackHandler={registerBackHandler}
          onOpenDocumentImport={onOpenDocumentImport}
          onDataChanged={async () => {
            await loadSettings();
            await onDataRebuilt({ resetRoute: false });
          }}
        />
      ) : (
        <>
          {errorMsg && (
        <div role="alert" className="rounded-xl border border-[#DC2626]/30 bg-[#FAD2D8] p-2.5 font-semibold text-[#5A121C]">
          {errorMsg}
        </div>
      )}
      {statusMsg && (
        <div
          data-testid="settings-status-banner"
          className="rounded-xl status-emerald p-2.5 font-semibold"
        >
          {statusMsg}
        </div>
      )}

      <form
        onSubmit={(e) => void handleSaveEmitter(e)}
        className="paper-sheet rounded-2xl border border-[#E5DFD2] bg-[#FFFDF7] p-3.5 space-y-2.5"
      >
        <div className="text-sm font-bold text-[#2C2621]">Mis datos de facturación</div>
        <input
          type="text"
          placeholder="Nombre / Razón social"
          value={emitterName}
          onChange={(e) => setEmitterName(e.target.value)}
          className="min-h-[44px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            type="text"
            placeholder="NIF/CIF"
            value={emitterNif}
            onChange={(e) => setEmitterNif(e.target.value.toUpperCase())}
            className="min-h-[44px] rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 font-mono tabular-nums text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
          />
          <input
            type="tel"
            placeholder="Teléfono"
            value={emitterPhone}
            onChange={(e) => setEmitterPhone(e.target.value)}
            className="min-h-[44px] rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 font-mono tabular-nums text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
          />
        </div>
        <ZoomableTextField
          as="input"
          multiline={false}
          maxLength={TEXT_LIMITS.ADDRESS}
          zoomLabel="Domicilio fiscal completo"
          placeholder="Domicilio fiscal completo"
          value={emitterAddr}
          onValueChange={setEmitterAddr}
          className="min-h-[44px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
        />
        <input
          type="email"
          data-testid="settings-emitter-email-input"
          placeholder="Email profesional (opcional)"
          value={emitterEmail}
          onChange={(e) => setEmitterEmail(e.target.value)}
          className="min-h-[44px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
        />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input
            type="text"
            data-testid="settings-emitter-iban-input"
            placeholder="Cuenta bancaria IBAN (opcional)"
            value={emitterIban}
            onChange={(e) => setEmitterIban(e.target.value.toUpperCase())}
            className="min-h-[44px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 font-mono tabular-nums text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
          />
          <input
            type="text"
            data-testid="settings-emitter-bank-input"
            placeholder="Entidad bancaria (ej. CaixaBank, BBVA)"
            value={emitterBankName}
            onChange={(e) => setEmitterBankName(e.target.value)}
            className="min-h-[44px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
          />
        </div>
        <div className="rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] p-2.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-[#2C2621]">
              Logotipo para presupuestos y facturas PDF
            </span>
            {emitterLogoDataUrl && (
              <button
                type="button"
                data-testid="settings-remove-logo-btn"
                onClick={() => setEmitterLogoDataUrl(null)}
                className="text-[11px] font-semibold text-[#DC2626] cursor-pointer"
              >
                Quitar logo
              </button>
            )}
          </div>
          {emitterLogoDataUrl ? (
            <img
              src={emitterLogoDataUrl}
              alt="Logotipo del emisor"
              className="max-h-12 max-w-[140px] rounded bg-[#FFFDF7] p-1 border border-[#E5DFD2] object-contain"
            />
          ) : (
            <label className="flex min-h-10 cursor-pointer items-center justify-center rounded-lg border border-dashed border-[#E5DFD2] bg-[#FFFDF7] px-3 text-[11px] font-semibold text-[#2C2621]">
              Subir logotipo (PNG / JPG)
              <input
                type="file"
                data-testid="settings-emitter-logo-input"
                accept="image/png,image/jpeg,image/webp"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  void handleLogoFileSelected(file);
                  e.target.value = "";
                }}
                className="hidden"
              />
            </label>
          )}
        </div>
        <button
          type="submit"
          disabled={busy}
          className="min-h-[44px] w-full rounded-xl bg-[#EA580C] hover:bg-[#D04B00] font-bold text-white cursor-pointer transition-colors"
        >
          Guardar mis datos
        </button>
      </form>

      <form
        onSubmit={(e) => void handleSaveTaxSettings(e)}
        className="ruled-notebook rounded-2xl border border-[#E5DFD2] bg-[#FFFDF7] p-3.5 space-y-2.5"
      >
        <div>
          <div className="text-sm font-bold text-[#2C2621]">
            Impuestos por defecto (IVA e IRPF)
          </div>
          <p className="mt-0.5 text-[11px] text-[#6B6860]">
            IVA predeterminado para nuevos presupuestos y porcentaje de reserva de IRPF en la Hucha Fiscal.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] p-2.5 space-y-1">
            <label
              htmlFor="tax-default-vat"
              className="block text-[11px] font-bold text-[#2C2621]"
            >
              IVA por defecto (%)
            </label>
            <input
              id="tax-default-vat"
              data-testid="settings-default-vat-input"
              type="number"
              step="0.5"
              min="0"
              max="100"
              value={defaultVatRate}
              onChange={(e) => setDefaultVatRate(e.target.value)}
              className="min-h-[42px] w-full rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 py-1.5 font-mono-nums text-xs font-bold text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
            />
          </div>
          <div className="rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] p-2.5 space-y-1">
            <label
              htmlFor="tax-irpf-rate"
              className="block text-[11px] font-bold text-[#2C2621]"
            >
              Reserva IRPF (%)
            </label>
            <input
              id="tax-irpf-rate"
              data-testid="settings-irpf-rate-input"
              type="number"
              step="0.5"
              min="0"
              max="100"
              value={irpfReserveRate}
              onChange={(e) => setIrpfReserveRate(e.target.value)}
              className="min-h-[42px] w-full rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 py-1.5 font-mono-nums text-xs font-bold text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
            />
          </div>
        </div>
        <button
          type="submit"
          data-testid="settings-save-tax-btn"
          disabled={busy}
          className="min-h-[44px] w-full rounded-xl bg-[#4B7094] font-bold text-[#FFFDF9] cursor-pointer"
        >
          Guardar impuestos
        </button>
      </form>

      <QuoteDefaultsCard
        executor={executor}
        settings={loadedSettings}
        onSettingsUpdated={async (updated) => {
          setLoadedSettings(updated);
          await onDataRebuilt({ resetRoute: false });
        }}
      />

      <InstallerActaSettingsCard
        executor={executor}
        settings={loadedSettings}
        activeAccountEmail={activeAccount?.email ?? ""}
        registerBackHandler={registerBackHandler}
        onSettingsUpdated={async (updated) => {
          setLoadedSettings(updated);
          await onDataRebuilt({ resetRoute: false });
        }}
      />

      <TaxCalendarSettingsCard
        executor={executor}
        settings={loadedSettings}
        onSettingsUpdated={async (updated) => {
          setLoadedSettings(updated);
          await onDataRebuilt({ resetRoute: false });
        }}
      />

      <div className="paper-sheet rounded-2xl border border-[#E5DFD2] bg-[#FFFDF7] p-3.5 space-y-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-[#2C2621]">Comodidad de escritura</div>
            <div className="mt-0.5 text-[11px] font-semibold text-[#2C2621]">
              Ampliar campos largos al escribir
            </div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-[#6B6860]">
              Al tocar descripciones de partidas, notas o direcciones, el campo se amplía en una
              tarjeta flotante para escribir más cómodo.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={expandLongTextInputs}
            aria-label="Ampliar campos largos al escribir"
            data-testid="settings-expand-inputs-toggle"
            disabled={busy || savingExpandToggle}
            onClick={async () => {
              setErrorMsg(null);
              setSavingExpandToggle(true);
              try {
                const next = !expandLongTextInputs;
                await setExpandLongTextInputs(next);
                setStatusMsg(
                  next
                    ? "Ampliación de campos largos activada."
                    : "Ampliación de campos largos desactivada."
                );
              } catch (err) {
                setErrorMsg(err instanceof Error ? err.message : String(err));
              } finally {
                setSavingExpandToggle(false);
              }
            }}
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors cursor-pointer disabled:opacity-50 ${
              expandLongTextInputs ? "bg-[#EA580C]" : "bg-[#E5DFD2]"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-[#FFFDF7] shadow transition-transform ${
                expandLongTextInputs ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
      </div>

      <form
        onSubmit={(e) => void handleSaveSequences(e)}
        className="ruled-notebook rounded-2xl border border-[#E5DFD2] bg-[#FFFDF7] p-3.5 space-y-2.5"
      >
        <div>
          <div className="text-sm font-bold text-[#2C2621]">
            Contadores correlativos (<span className="font-mono-nums">{fiscalYear}</span>)
          </div>
          <p className="mt-0.5 text-[11px] text-[#6B6860]">
            Último número usado este año en cada tipo de documento. El siguiente sumará 1 automáticamente.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[
            {
              code: "PRE",
              name: "Presupuestos",
              desc: `Ej. PRE-${fiscalYear}-001`,
              val: seqPRE,
              set: setSeqPRE,
            },
            {
              code: "ANT",
              name: "Facturas de anticipo",
              desc: `Adelantos 40 % (ANT-${fiscalYear}-001)`,
              val: seqANT,
              set: setSeqANT,
            },
            {
              code: "FAC",
              name: "Facturas finales",
              desc: `Liquidaciones (FAC-${fiscalYear}-001)`,
              val: seqFAC,
              set: setSeqFAC,
            },
            {
              code: "OBR",
              name: "Obras / Expedientes",
              desc: `Trabajos abiertos (OBR-${fiscalYear}-001)`,
              val: seqOBR,
              set: setSeqOBR,
            },
            {
              code: "ACT",
              name: "Actas técnicas",
              desc: `Puesta en marcha (ACT-${fiscalYear}-001)`,
              val: seqACT,
              set: setSeqACT,
            },
          ].map((s) => (
            <div
              key={s.code}
              className="rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] p-2.5 space-y-1"
            >
              <label
                htmlFor={`seq-${s.code}`}
                className="block text-[11px] font-bold text-[#2C2621]"
              >
                <span className="font-mono">{s.code}</span> · {s.name}
              </label>
              <div className="font-mono text-[10px] text-[#6B6860]">{s.desc}</div>
              <input
                id={`seq-${s.code}`}
                type="number"
                min="0"
                value={s.val}
                onChange={(e) => s.set(e.target.value)}
                className="min-h-[40px] w-full rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 py-1.5 font-mono-nums text-xs font-bold text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
              />
            </div>
          ))}
        </div>
        <button
          type="submit"
          disabled={busy}
          className="min-h-[44px] w-full rounded-xl bg-[#4B7094] font-bold text-[#FFFDF9] cursor-pointer"
        >
          Actualizar numeración
        </button>
      </form>

      <div className="paper-sheet rounded-2xl border border-[#E5DFD2] bg-[#FFFDF7] p-3.5 space-y-2.5">
        <div className="text-sm font-bold text-[#2C2621]">
          Copia de seguridad de tus datos
        </div>
        <input
          type="password"
          data-testid="backup-password-input"
          placeholder="Contraseña opcional para proteger la copia"
          value={backupPassword}
          onChange={(e) => setBackupPassword(e.target.value)}
          className="min-h-[44px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
        />
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            data-testid="export-backup-btn"
            disabled={busy}
            onClick={() => void handleExportBackup()}
            className="min-h-[44px] rounded-xl bg-[#4B7094] font-bold text-[#FFFDF9] cursor-pointer"
          >
            Exportar copia
          </button>
          <label className="flex min-h-[44px] cursor-pointer items-center justify-center rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] font-bold text-[#2C2621]">
            Importar copia
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImportBackup(file);
              }}
            />
          </label>
        </div>
      </div>

      <div className="paper-sheet rounded-2xl border border-[#E5DFD2] bg-[#FFFDF7] p-3.5 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-[#2C2621]">Actualizaciones de la app</div>
            <div className="font-mono text-[11px] text-[#6B6860]">
              {installedVersion
                ? `Versión instalada: v${installedVersion.versionName} (compilación ${installedVersion.versionCode})`
                : "Versión instalada: v1.0.0"}
            </div>
          </div>
        </div>
        <button
          type="button"
          data-testid="settings-check-updates-btn"
          disabled={busy || checkingUpdates}
          onClick={() => void handleCheckUpdates()}
          className="min-h-[44px] w-full rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] font-bold text-[#2C2621] cursor-pointer"
        >
          {checkingUpdates ? "Comprobando actualizaciones..." : "Buscar actualizaciones"}
        </button>
        {updateCheckInfo && (
          <div className="rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] p-2.5 text-[11px] text-[#2C2621]">
            {updateCheckInfo}
          </div>
        )}
        {foundUpdateInSettings && (
          <UpdateBanner
            update={foundUpdateInSettings}
            updaterService={updater}
            onDismiss={
              foundUpdateInSettings.mandatory
                ? undefined
                : () => setFoundUpdateInSettings(null)
            }
          />
        )}
      </div>

      <div className="paper-sheet rounded-2xl border border-[#E5DFD2] bg-[#FFFDF7] p-3.5 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-bold text-[#2C2621]">Cuenta y sesión</div>
            {activeAccount && (
              <div className="text-[11px] text-[#6B6860]">
                {activeAccount.display_name} · {activeAccount.email}
              </div>
            )}
          </div>
        </div>
        <button
          type="button"
          data-testid="settings-reopen-onboarding-btn"
          disabled={busy}
          onClick={() => void onReopenOnboarding()}
          className="min-h-[44px] w-full rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] font-bold text-[#2C2621] cursor-pointer"
        >
          Asistente de configuración inicial
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            data-testid="settings-logout-btn"
            disabled={busy}
            onClick={() => void onLogout()}
            className="min-h-[44px] rounded-xl bg-[#4B7094] font-bold text-[#FFFDF9] cursor-pointer"
          >
            Cerrar sesión
          </button>
          <button
            type="button"
            data-testid="start-clean-btn"
            disabled={busy}
            onClick={() => void handleStartClean()}
            className="min-h-[44px] rounded-xl border border-[#DC2626]/30 bg-[#FAD2D8] font-bold text-[#5A121C] cursor-pointer"
          >
            Empezar en limpio
          </button>
        </div>
      </div>

      {superAdminUnlocked && (
        <SuperAdminLlmPanel
          executor={executor}
          inferenceAdapter={inferenceAdapter}
          mediaPipeAdapter={mediaPipeAdapter}
          capacitorLlmAdapter={capacitorLlmAdapter}
          memoryCoordinator={memoryCoordinator}
          onLockAdminSession={() => onSetSuperAdminUnlocked(false)}
        />
      )}

      {showAdminModal && (
        <div
          data-testid="superadmin-login-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#2C2621]/55 p-4"
        >
          <form
            onSubmit={(e) => void handleAdminUnlockSubmit(e)}
            className="clipboard-panel w-full max-w-xs rounded-2xl p-4 space-y-3"
          >
            <div className="text-sm font-bold text-[#2C2621]">Acceso Super Admin</div>
            <p className="text-[11px] text-[#6B6860]">
              Introduce el PIN de administrador para configurar modelos locales.
              {isUsingDevSuperAdminPin() ? " (PIN dev por defecto: 246800)" : ""}
            </p>
            {adminAuthError && (
              <div role="alert" className="rounded-xl border border-[#DC2626]/30 bg-[#FAD2D8] p-2 text-[11px] font-semibold text-[#5A121C]">
                {adminAuthError}
              </div>
            )}
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              data-testid="superadmin-pin-input"
              placeholder="PIN de administrador"
              value={adminPinInput}
              onChange={(e) => setAdminPinInput(e.target.value)}
              className="min-h-[44px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 font-mono-nums text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowAdminModal(false)}
                className="min-h-[44px] flex-1 rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] font-bold text-[#2C2621] cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                data-testid="superadmin-pin-submit"
                className="min-h-[44px] flex-1 rounded-xl bg-[#4B7094] font-bold text-[#FFFDF9] cursor-pointer"
              >
                Entrar
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="pt-2 pb-4 text-center">
        <button
          type="button"
          data-testid="settings-version-trigger"
          onClick={handleVersionTap}
          className="font-mono text-[10px] font-medium text-[#6B6860] select-none cursor-pointer"
        >
          Gestor Autónomo · v{installedVersion?.versionName ?? "1.0.0"}
        </button>
      </div>
        </>
      )}
    </div>
  );
}
