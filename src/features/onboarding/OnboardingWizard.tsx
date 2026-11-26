import {
  ArrowLeft,
  ArrowRight,
  Calculator,
  Check,
  ChevronDown,
  Clock,
  FileUp,
  ImagePlus,
  Landmark,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ZodError } from "zod";
import { BackupService } from "../../core/backup/backupService";
import { TEXT_LIMITS } from "../../core/contracts/textLimits";
import type {
  CatalogItemRow,
  DocumentImportReviewDraft,
  LocalAccountRecord,
  SqliteExecutor,
  WorkScheduleDefaults,
} from "../../core/contracts/types";
import { AuthRepository } from "../../core/db/repositories/authRepo";
import { ZoomableTextField } from "../../ui/ZoomableTextField";
import { CatalogRepository } from "../../core/db/repositories/catalogRepo";
import {
  computeDailyWorkHoursBreakdown,
  ScheduleRepository,
} from "../../core/db/repositories/scheduleRepo";
import { SettingsRepository } from "../../core/db/repositories/settingsRepo";
import { resizeLogoFileToDataUrl } from "../../core/files/logoImageHelper";
import { formatCentsEs } from "../../core/fiscal/fiscalEngine";
import type { OcrPort } from "../../core/ports/mediaPorts";
import {
  computeTemplatePreviewPriceCents,
  findMatchingCatalogItemForTemplate,
  PREDEFINED_CATALOG_TEMPLATES,
  type PredefinedCatalogTemplate,
} from "../../core/pricing/predefinedCatalog";
import { formatPricingBreakdown } from "../../core/pricing/pricingEngine";
import { DocumentImportReviewWidget } from "../chat/widgets/DocumentImportReviewWidget";
import { analyzeDocumentsForCatalog } from "../pricing/documentImportPipeline";

interface OnboardingWizardProps {
  account: LocalAccountRecord;
  executor: SqliteExecutor;
  ocrPort: OcrPort;
  onFinished: () => Promise<void>;
}

const WEEKDAY_BUTTONS = [
  { id: 1, label: "L" },
  { id: 2, label: "M" },
  { id: 3, label: "X" },
  { id: 4, label: "J" },
  { id: 5, label: "V" },
  { id: 6, label: "S" },
  { id: 7, label: "D" },
] as const;

const DEFAULT_SCHEDULE: WorkScheduleDefaults = {
  work_days: [1, 2, 3, 4, 5],
  morning_start: "08:00",
  morning_end: "14:00",
  afternoon_start: "15:00",
  afternoon_end: "17:00",
  auto_apply_to_jobs: true,
};

function centsToEurInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

function eurToCents(raw: string): number {
  const parsed = Number.parseFloat(raw.replace(",", ".").trim());
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100);
}

function formatError(err: unknown): string {
  if (err instanceof ZodError) {
    return err.issues.map((i) => i.message).join(" · ");
  }
  return err instanceof Error ? err.message : String(err);
}

export function OnboardingWizard({
  account,
  executor,
  ocrPort,
  onFinished,
}: OnboardingWizardProps) {
  const [step, setStep] = useState<1 | 2>(1);

  // Panel 1: Datos fiscales, cuenta bancaria y logotipo
  const [emitterName, setEmitterName] = useState(account.display_name);
  const [emitterNif, setEmitterNif] = useState("");
  const [emitterPhone, setEmitterPhone] = useState("");
  const [emitterAddress, setEmitterAddress] = useState("");
  const [emitterIban, setEmitterIban] = useState("");
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);

  // Panel 2: Tarifa, impuestos, horario, tarifario y copia de seguridad
  const [hourlyRateInput, setHourlyRateInput] = useState("38.00");
  const [defaultVatInput, setDefaultVatInput] = useState("21");
  const [irpfRateInput, setIrpfRateInput] = useState("20");
  const [workSchedule, setWorkSchedule] = useState<WorkScheduleDefaults>(DEFAULT_SCHEDULE);
  const [catalogRows, setCatalogRows] = useState<CatalogItemRow[]>([]);
  const [showTemplates, setShowTemplates] = useState(true);
  const [importDraft, setImportDraft] = useState<DocumentImportReviewDraft | null>(null);
  const [backupPassword, setBackupPassword] = useState("");

  const [busy, setBusy] = useState(false);
  const [importingDocs, setImportingDocs] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const editedFieldsRef = useRef<Set<string>>(new Set());

  const loadAllOnboardingData = async (forceOverwrite = false) => {
    if (forceOverwrite) {
      editedFieldsRef.current.clear();
    }
    const [settings, schedDefaults, catRes] = await Promise.all([
      new SettingsRepository(executor).getAppSettings(),
      new ScheduleRepository(executor).getWorkScheduleDefaults(),
      new CatalogRepository(executor).listPaginated({
        includeInactive: true,
        limit: 100,
        offset: 0,
      }),
    ]);

    const dirty = editedFieldsRef.current;
    if (forceOverwrite || !dirty.has("emitterName")) {
      setEmitterName(settings.emitter_name || account.display_name);
    }
    if (forceOverwrite || !dirty.has("emitterNif")) {
      setEmitterNif(settings.emitter_nif);
    }
    if (forceOverwrite || !dirty.has("emitterPhone")) {
      setEmitterPhone(settings.emitter_phone);
    }
    if (forceOverwrite || !dirty.has("emitterAddress")) {
      setEmitterAddress(settings.emitter_fiscal_address);
    }
    if (forceOverwrite || !dirty.has("emitterIban")) {
      setEmitterIban(settings.emitter_iban);
    }
    if (forceOverwrite || !dirty.has("logoDataUrl")) {
      setLogoDataUrl(settings.emitter_logo_data_url);
    }

    if (forceOverwrite || !dirty.has("hourlyRate")) {
      setHourlyRateInput(centsToEurInput(settings.hourly_rate_cents));
    }
    if (forceOverwrite || !dirty.has("defaultVat")) {
      setDefaultVatInput(String(settings.default_vat_rate));
    }
    if (forceOverwrite || !dirty.has("irpfRate")) {
      setIrpfRateInput(String(settings.irpf_reserve_rate));
    }
    if (forceOverwrite || !dirty.has("workSchedule")) {
      setWorkSchedule(schedDefaults);
    }
    setCatalogRows(catRes.items);
  };

  useEffect(() => {
    editedFieldsRef.current.clear();
    void loadAllOnboardingData(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executor, account.id]);

  const handleLogoChange = async (file: File | undefined) => {
    if (!file) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      const dataUrl = await resizeLogoFileToDataUrl(file);
      setLogoDataUrl(dataUrl);
      await new SettingsRepository(executor).updateEmitterProfile({
        emitter_name: emitterName,
        emitter_nif: emitterNif,
        emitter_fiscal_address: emitterAddress,
        emitter_phone: emitterPhone,
        emitter_iban: emitterIban,
        emitter_logo_data_url: dataUrl,
      });
      setStatusMsg("Logotipo guardado para tus presupuestos y facturas.");
    } catch (err) {
      setErrorMsg(formatError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveStep1AndNext = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    setBusy(true);
    try {
      await new SettingsRepository(executor).updateEmitterProfile({
        emitter_name: emitterName,
        emitter_nif: emitterNif,
        emitter_fiscal_address: emitterAddress,
        emitter_phone: emitterPhone,
        emitter_iban: emitterIban,
        emitter_logo_data_url: logoDataUrl,
      });
      setStep(2);
    } catch (err) {
      setErrorMsg(formatError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleActivateTemplate = async (tpl: PredefinedCatalogTemplate) => {
    setErrorMsg(null);
    setStatusMsg(null);
    setBusy(true);
    try {
      const rateCents = Math.max(100, eurToCents(hourlyRateInput) || 3800);
      const res = await new CatalogRepository(executor).activatePredefinedTemplate(tpl, rateCents);
      const catRes = await new CatalogRepository(executor).listPaginated({
        includeInactive: true,
        limit: 100,
        offset: 0,
      });
      setCatalogRows(catRes.items);
      setStatusMsg(
        res.createdOrReactivated
          ? `Partida «${res.item.description}» añadida a tu tarifario.`
          : `«${res.item.description}» ya está activa.`
      );
    } catch (err) {
      setErrorMsg(formatError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setErrorMsg(null);
    setStatusMsg(null);
    setImportingDocs(true);
    try {
      const currentRateCents = Math.max(100, eurToCents(hourlyRateInput) || 3800);
      const draft = await analyzeDocumentsForCatalog({
        files: Array.from(fileList),
        ocrPort,
        currentHourlyRateCents: currentRateCents,
        existingCatalog: catalogRows,
      });
      setImportDraft(draft);
    } catch (err) {
      setErrorMsg(formatError(err));
    } finally {
      setImportingDocs(false);
    }
  };

  const handleRestoreBackup = async (file: File | undefined) => {
    if (!file) return;
    setErrorMsg(null);
    setStatusMsg(null);
    setBusy(true);
    try {
      const raw = await file.text();
      const res = await new BackupService(executor).importBackupJson(
        raw,
        backupPassword.trim() || undefined
      );
      await loadAllOnboardingData(true);
      setStatusMsg(
        `Copia restaurada: ${res.restoredCounts.clients ?? 0} clientes, ${res.restoredCounts.quotes ?? 0} presupuestos y ${res.restoredCounts.catalog_items ?? 0} partidas.`
      );
    } catch (err) {
      setErrorMsg(formatError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleFinish = async () => {
    setErrorMsg(null);
    setStatusMsg(null);
    const rateCents = eurToCents(hourlyRateInput);
    if (rateCents < 100) {
      setErrorMsg("Introduce una tarifa base válida (mínimo 1,00 €/h).");
      return;
    }
    setBusy(true);
    try {
      const vat = Number.parseFloat(defaultVatInput.replace(",", "."));
      const irpf = Number.parseFloat(irpfRateInput.replace(",", "."));
      const settingsRepo = new SettingsRepository(executor);
      await settingsRepo.updateHourlyRate(rateCents);
      await settingsRepo.updateTaxSettings({
        default_vat_rate: Number.isFinite(vat) ? Math.max(0, Math.min(100, vat)) : 21,
        irpf_reserve_rate: Number.isFinite(irpf) ? Math.max(0, Math.min(100, irpf)) : 20,
      });
      await new ScheduleRepository(executor).updateWorkScheduleDefaults(workSchedule);
      await new AuthRepository(executor).completeOnboarding(account.id);
      await onFinished();
    } catch (err) {
      setErrorMsg(formatError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSkip = async () => {
    setBusy(true);
    try {
      await new AuthRepository(executor).completeOnboarding(account.id);
      await onFinished();
    } finally {
      setBusy(false);
    }
  };

  const liveRateCents = Math.max(100, eurToCents(hourlyRateInput) || 3800);
  const dailyBreakdown = computeDailyWorkHoursBreakdown(workSchedule);
  const activeCatalogCount = catalogRows.filter((c) => c.active === 1).length;

  return (
    <div
      data-testid="onboarding-wizard"
      className="min-h-dvh w-full cotton-paper text-[#2C2621] flex flex-col overflow-x-hidden"
    >
      {/* Cabecera fija con progreso */}
      <header className="sticky top-0 z-20 border-b border-[#E5DFD2] bg-[#FFFDF7] px-4 py-3">
        <div className="mx-auto flex w-full max-w-md items-center justify-between gap-2">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-[#D04B00]">
              Configuración inicial · Paso {step} de 2
            </div>
            <h1 className="font-sans text-[16px] font-bold text-[#2C2621]">
              {step === 1 ? "Tus datos y logotipo" : "Tarifa, horarios y tarifario"}
            </h1>
          </div>
          <button
            type="button"
            data-testid="onboarding-skip-btn"
            disabled={busy}
            onClick={() => void handleSkip()}
            className="min-h-[38px] rounded-full border border-[#E5DFD2] bg-[#FFFDF7] px-3 text-[11px] font-semibold text-[#6B6860] hover:text-[#2C2621] cursor-pointer"
          >
            Más tarde
          </button>
        </div>

        {/* Barra de progreso */}
        <div className="mx-auto mt-2.5 grid w-full max-w-md grid-cols-2 gap-1.5">
          <div className="h-1.5 rounded-full bg-[#EA580C]" />
          <div className={`h-1.5 rounded-full ${step === 2 ? "bg-[#EA580C]" : "bg-[#EFECE4]"}`} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-md flex-1 overflow-y-auto px-4 py-5 pb-10 space-y-4 text-xs">
        {errorMsg && (
          <div
            role="alert"
            className="paper-sheet rounded-2xl border border-[#DC2626]/30 bg-[#FAD2D8] p-3 font-medium text-[#5A121C] break-words"
          >
            {errorMsg}
          </div>
        )}
        {statusMsg && (
          <div
            role="status"
            className="paper-sheet rounded-2xl border border-[#1E8E5A]/30 bg-[#D4EDDA] p-3 font-semibold text-[#1B3A24] break-words"
          >
            {statusMsg}
          </div>
        )}

        {step === 1 ? (
          <form
            data-testid="onboarding-step-1"
            onSubmit={(e) => void handleSaveStep1AndNext(e)}
            className="space-y-4"
          >
            <div className="paper-sheet rounded-2xl border border-[#E5DFD2] bg-[#FFFDF7] p-4 space-y-3">
              <div className="flex items-start gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FFD6B0] text-[#4A2500]">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-[15px] font-bold text-[#2C2621]">
                    Datos fiscales de tu empresa o autónomo
                  </h2>
                  <p className="mt-0.5 text-[11px] text-[#6B6860]">
                    Se usarán automáticamente en la cabecera de tus presupuestos y facturas PDF.
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#6B6860] mb-1" htmlFor="onb-name">
                  Nombre completo o razón social
                </label>
                <input
                  id="onb-name"
                  data-testid="onboarding-emitter-name"
                  type="text"
                  disabled={busy}
                  value={emitterName}
                  onChange={(e) => {
                    editedFieldsRef.current.add("emitterName");
                    setEmitterName(e.target.value);
                  }}
                  placeholder="Ej: Carlos Morales García"
                  className="min-h-[44px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 text-[13px] text-[#2C2621] placeholder:text-[#6B6860]/70 focus:border-[#EA580C] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-[#6B6860] mb-1" htmlFor="onb-nif">
                    NIF / CIF
                  </label>
                  <input
                    id="onb-nif"
                    data-testid="onboarding-emitter-nif"
                    type="text"
                    disabled={busy}
                    value={emitterNif}
                    onChange={(e) => {
                      editedFieldsRef.current.add("emitterNif");
                      setEmitterNif(e.target.value.toUpperCase());
                    }}
                    placeholder="12345678Z"
                    className="min-h-[44px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 font-mono text-[13px] text-[#2C2621] placeholder:text-[#6B6860]/70 focus:border-[#EA580C] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#6B6860] mb-1" htmlFor="onb-phone">
                    Teléfono
                  </label>
                  <input
                    id="onb-phone"
                    data-testid="onboarding-emitter-phone"
                    type="tel"
                    disabled={busy}
                    value={emitterPhone}
                    onChange={(e) => {
                      editedFieldsRef.current.add("emitterPhone");
                      setEmitterPhone(e.target.value);
                    }}
                    placeholder="+34 600 000 000"
                    className="min-h-[44px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 font-mono text-[13px] text-[#2C2621] placeholder:text-[#6B6860]/70 focus:border-[#EA580C] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#6B6860] mb-1" htmlFor="onb-address">
                  Domicilio fiscal
                </label>
                <ZoomableTextField
                  id="onb-address"
                  as="input"
                  multiline={false}
                  maxLength={TEXT_LIMITS.ADDRESS}
                  zoomLabel="Domicilio fiscal"
                  data-testid="onboarding-emitter-address"
                  disabled={busy}
                  value={emitterAddress}
                  onValueChange={(next) => {
                    editedFieldsRef.current.add("emitterAddress");
                    setEmitterAddress(next);
                  }}
                  placeholder="Calle, número, código postal y ciudad"
                  className="min-h-[44px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 text-[13px] text-[#2C2621] placeholder:text-[#6B6860]/70 focus:border-[#EA580C] focus:outline-none"
                />
              </div>
            </div>

            <div className="paper-sheet rounded-2xl border border-[#E5DFD2] bg-[#FFFDF7] p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Landmark className="h-4 w-4 text-[#D04B00]" />
                <h2 className="text-[14px] font-bold text-[#2C2621]">
                  Cuenta bancaria y logotipo (opcional)
                </h2>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#6B6860] mb-1" htmlFor="onb-iban">
                  Cuenta bancaria (IBAN) para cobros
                </label>
                <input
                  id="onb-iban"
                  data-testid="onboarding-emitter-iban"
                  type="text"
                  disabled={busy}
                  value={emitterIban}
                  onChange={(e) => {
                    editedFieldsRef.current.add("emitterIban");
                    setEmitterIban(e.target.value.toUpperCase());
                  }}
                  placeholder="ES00 0000 0000 0000 0000 0000"
                  className="min-h-[44px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 font-mono text-[12px] text-[#2C2621] placeholder:text-[#6B6860]/70 focus:border-[#EA580C] focus:outline-none"
                />
              </div>

              <div className="space-y-2">
                <div className="text-[11px] font-semibold text-[#6B6860]">
                  Logotipo para tus PDFs
                </div>
                {logoDataUrl ? (
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] p-3">
                    <img
                      src={logoDataUrl}
                      alt="Logotipo seleccionado"
                      className="max-h-12 max-w-[140px] object-contain"
                    />
                    <button
                      type="button"
                      onClick={() => setLogoDataUrl(null)}
                      className="inline-flex items-center gap-1 rounded-xl border border-[#DC2626]/30 bg-[#FFFDF7] px-3 py-1.5 text-[11px] font-semibold text-[#DC2626] cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Quitar</span>
                    </button>
                  </div>
                ) : (
                  <label className="flex min-h-[48px] cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#E5DFD2] bg-[#F5F1E6] px-3 py-2 font-semibold text-[#2C2621] hover:border-[#EA580C]">
                    <ImagePlus className="h-4 w-4 text-[#D04B00]" />
                    <span>Subir logotipo (PNG / JPG)</span>
                    <input
                      type="file"
                      data-testid="onboarding-logo-input"
                      accept="image/png,image/jpeg,image/webp"
                      disabled={busy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        void handleLogoChange(file);
                        e.target.value = "";
                      }}
                      className="hidden"
                    />
                  </label>
                )}
              </div>
            </div>

            <button
              type="submit"
              data-testid="onboarding-next-btn"
              disabled={busy}
              className="inline-flex min-h-[50px] w-full items-center justify-center gap-2 rounded-2xl bg-[#D04B00] hover:bg-[#EA580C] px-4 text-[14px] font-semibold text-[#FFFDF9] shadow-sm cursor-pointer disabled:opacity-50 transition-colors"
            >
              <span>Guardar y continuar</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>
        ) : (
          <div data-testid="onboarding-step-2" className="space-y-4">
            {/* Tarifa base e impuestos */}
            <section className="postit-note postit-peach p-4 pt-5 space-y-3">
              <span className="washi-tape washi-peach" aria-hidden="true" />
              <div className="flex items-center gap-2">
                <Calculator className="h-4 w-4 text-[#4A2500]" />
                <h2 className="text-[15px] font-bold text-[#2C2621]">
                  Tarifa por hora e impuestos
                </h2>
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                <div className="rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] p-2.5">
                  <label className="block text-[11px] font-semibold text-[#6B6860]" htmlFor="onb-rate">
                    Tarifa base (€/h)
                  </label>
                  <input
                    id="onb-rate"
                    data-testid="onboarding-hourly-rate-input"
                    type="number"
                    step="0.5"
                    min="1"
                    disabled={busy}
                    value={hourlyRateInput}
                    onChange={(e) => {
                      editedFieldsRef.current.add("hourlyRate");
                      setHourlyRateInput(e.target.value);
                    }}
                    className="mt-1 w-full rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 py-1.5 font-mono text-[14px] font-bold text-[#2C2621] tabular-nums"
                  />
                </div>
                <div className="rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] p-2.5">
                  <label className="block text-[11px] font-semibold text-[#6B6860]" htmlFor="onb-vat">
                    IVA defecto (%)
                  </label>
                  <input
                    id="onb-vat"
                    data-testid="onboarding-vat-input"
                    type="number"
                    step="0.5"
                    min="0"
                    max="100"
                    disabled={busy}
                    value={defaultVatInput}
                    onChange={(e) => {
                      editedFieldsRef.current.add("defaultVat");
                      setDefaultVatInput(e.target.value);
                    }}
                    className="mt-1 w-full rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 py-1.5 font-mono text-[14px] font-bold text-[#2C2621] tabular-nums"
                  />
                </div>
                <div className="rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] p-2.5">
                  <label className="block text-[11px] font-semibold text-[#6B6860]" htmlFor="onb-irpf">
                    Reserva IRPF (%)
                  </label>
                  <input
                    id="onb-irpf"
                    data-testid="onboarding-irpf-input"
                    type="number"
                    step="0.5"
                    min="0"
                    max="100"
                    disabled={busy}
                    value={irpfRateInput}
                    onChange={(e) => {
                      editedFieldsRef.current.add("irpfRate");
                      setIrpfRateInput(e.target.value);
                    }}
                    className="mt-1 w-full rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 py-1.5 font-mono text-[14px] font-bold text-[#2C2621] tabular-nums"
                  />
                </div>
              </div>
            </section>

            {/* Horario habitual */}
            <section className="paper-sheet overflow-hidden rounded-2xl border border-[#E5DFD2] bg-[#FFFDF7] p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-[#D04B00]" />
                  <h2 className="text-[14px] font-bold text-[#2C2621]">
                    Horario habitual de trabajo
                  </h2>
                </div>
                <span className="status-emerald rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums">
                  {(dailyBreakdown.totalThousandths / 1000).toFixed(1).replace(/\.0$/, "")} h/día
                </span>
              </div>

              <div className="grid grid-cols-7 gap-1.5">
                {WEEKDAY_BUTTONS.map((day) => {
                  const active = workSchedule.work_days.includes(day.id);
                  return (
                    <button
                      key={day.id}
                      type="button"
                      onClick={() => {
                        const nextDays = active
                          ? workSchedule.work_days.filter((d) => d !== day.id)
                          : [...workSchedule.work_days, day.id].sort((a, b) => a - b);
                        setWorkSchedule((p) => ({ ...p, work_days: nextDays }));
                      }}
                      className={`min-h-[40px] rounded-xl text-[12px] font-semibold cursor-pointer ${
                        active
                          ? "bg-[#4B7094] text-[#FFFDF9]"
                          : "border border-[#E5DFD2] bg-[#F5F1E6] text-[#6B6860]"
                      }`}
                    >
                      {day.label}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2 w-full min-w-0 overflow-hidden bg-[#F5F1E6] border border-[#E5DFD2] rounded-2xl p-2.5">
                  <div className="flex flex-col pl-1 shrink-0 min-w-[52px]">
                    <span className="text-[12px] font-semibold text-[#2C2621]">Mañana</span>
                    <span className="text-[11px] font-mono tabular-nums text-[#6B6860]">
                      {(dailyBreakdown.morningThousandths / 1000).toFixed(1).replace(/\.0$/, "")} h
                    </span>
                  </div>
                  <div className="flex items-center justify-end gap-1.5 flex-1 min-w-0">
                    <div className="relative flex-1 min-w-0 max-w-[115px]">
                      <input
                        type="time"
                        aria-label="Inicio mañana"
                        value={workSchedule.morning_start}
                        onChange={(e) =>
                          setWorkSchedule((p) => ({ ...p, morning_start: e.target.value }))
                        }
                        className="time-pill-input w-full min-w-0 min-h-[40px] appearance-none rounded-xl bg-[#FFFDF7] border border-[#E5DFD2] pl-2.5 pr-6 py-2 font-mono text-[12px] font-medium text-[#2C2621] tabular-nums text-center focus:border-[#EA580C] focus:outline-none"
                      />
                      <ChevronDown
                        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#6B6860]"
                        aria-hidden="true"
                      />
                    </div>
                    <span className="shrink-0 text-[#6B6860]">–</span>
                    <div className="relative flex-1 min-w-0 max-w-[115px]">
                      <input
                        type="time"
                        aria-label="Fin mañana"
                        value={workSchedule.morning_end}
                        onChange={(e) =>
                          setWorkSchedule((p) => ({ ...p, morning_end: e.target.value }))
                        }
                        className="time-pill-input w-full min-w-0 min-h-[40px] appearance-none rounded-xl bg-[#FFFDF7] border border-[#E5DFD2] pl-2.5 pr-6 py-2 font-mono text-[12px] font-medium text-[#2C2621] tabular-nums text-center focus:border-[#EA580C] focus:outline-none"
                      />
                      <ChevronDown
                        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#6B6860]"
                        aria-hidden="true"
                      />
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 w-full min-w-0 overflow-hidden bg-[#F5F1E6] border border-[#E5DFD2] rounded-2xl p-2.5">
                  <div className="flex flex-col pl-1 shrink-0 min-w-[52px]">
                    <span className="text-[12px] font-semibold text-[#2C2621]">Tarde</span>
                    <span className="text-[11px] font-mono tabular-nums text-[#6B6860]">
                      {(dailyBreakdown.afternoonThousandths / 1000).toFixed(1).replace(/\.0$/, "")} h
                    </span>
                  </div>
                  <div className="flex items-center justify-end gap-1.5 flex-1 min-w-0">
                    <div className="relative flex-1 min-w-0 max-w-[115px]">
                      <input
                        type="time"
                        aria-label="Inicio tarde"
                        value={workSchedule.afternoon_start}
                        onChange={(e) =>
                          setWorkSchedule((p) => ({ ...p, afternoon_start: e.target.value }))
                        }
                        className="time-pill-input w-full min-w-0 min-h-[40px] appearance-none rounded-xl bg-[#FFFDF7] border border-[#E5DFD2] pl-2.5 pr-6 py-2 font-mono text-[12px] font-medium text-[#2C2621] tabular-nums text-center focus:border-[#EA580C] focus:outline-none"
                      />
                      <ChevronDown
                        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#6B6860]"
                        aria-hidden="true"
                      />
                    </div>
                    <span className="shrink-0 text-[#6B6860]">–</span>
                    <div className="relative flex-1 min-w-0 max-w-[115px]">
                      <input
                        type="time"
                        aria-label="Fin tarde"
                        value={workSchedule.afternoon_end}
                        onChange={(e) =>
                          setWorkSchedule((p) => ({ ...p, afternoon_end: e.target.value }))
                        }
                        className="time-pill-input w-full min-w-0 min-h-[40px] appearance-none rounded-xl bg-[#FFFDF7] border border-[#E5DFD2] pl-2.5 pr-6 py-2 font-mono text-[12px] font-medium text-[#2C2621] tabular-nums text-center focus:border-[#EA580C] focus:outline-none"
                      />
                      <ChevronDown
                        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#6B6860]"
                        aria-hidden="true"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Importador IA y partidas predefinidas */}
            <section className="paper-sheet rounded-2xl border border-[#E5DFD2] bg-[#FFFDF7] p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[#D04B00]" />
                  <div>
                    <h2 className="text-[14px] font-bold text-[#2C2621]">
                      Tu tarifario ({activeCatalogCount} partidas activas)
                    </h2>
                    <p className="text-[11px] text-[#6B6860]">
                      Sube presupuestos o tarifas anteriores, o activa partidas habituales.
                    </p>
                  </div>
                </div>
              </div>

              <label className="status-cobalt flex min-h-[48px] cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed px-3 py-2 text-xs font-bold">
                <FileUp className="h-4 w-4 shrink-0" />
                <span>
                  {importingDocs
                    ? "Analizando documentos offline..."
                    : "Importar tarifario o presupuesto anterior"}
                </span>
                <input
                  type="file"
                  data-testid="onboarding-import-file-input"
                  accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.csv,.tsv,application/pdf,image/*,text/plain,text/csv"
                  multiple
                  disabled={importingDocs || busy}
                  onChange={(e) => {
                    void handleFilesSelected(e.target.files);
                    e.target.value = "";
                  }}
                  className="hidden"
                />
              </label>

              <div className="flex items-center justify-between pt-1">
                <span className="font-semibold text-[#2C2621]">Catálogo predefinido de oficios</span>
                <button
                  type="button"
                  onClick={() => setShowTemplates((v) => !v)}
                  className="rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 py-1 text-[11px] font-semibold text-[#6B6860] cursor-pointer"
                >
                  {showTemplates ? "Ocultar" : "Mostrar"}
                </button>
              </div>

              {showTemplates && (
                <div className="max-h-56 overflow-y-auto space-y-1.5 pr-0.5">
                  {PREDEFINED_CATALOG_TEMPLATES.map((tpl) => {
                    const matched = findMatchingCatalogItemForTemplate(tpl, catalogRows);
                    const isActive = matched !== null && matched.active === 1;
                    const previewPrice = computeTemplatePreviewPriceCents(tpl, liveRateCents);
                    return (
                      <div
                        key={tpl.template_id}
                        className="flex items-center justify-between gap-2 rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] px-2.5 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="break-words [overflow-wrap:anywhere] font-semibold text-[#2C2621]">
                            {tpl.description}
                          </div>
                          <div className="text-[10px] text-[#6B6860]">
                            {tpl.category} ·{" "}
                            {formatPricingBreakdown({
                              pricing_mode: tpl.pricing_mode,
                              estimated_hours_thousandths: tpl.estimated_hours_thousandths,
                              materials_cents: tpl.materials_cents,
                              hourly_rate_cents: liveRateCents,
                              unit_price_cents: previewPrice,
                            })}
                          </div>
                        </div>
                        {isActive ? (
                          <span className="status-emerald shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-semibold">
                            Activa
                          </span>
                        ) : (
                          <button
                            type="button"
                            data-testid={`onboarding-activate-tpl-${tpl.template_id}`}
                            disabled={busy}
                            onClick={() => void handleActivateTemplate(tpl)}
                            className="shrink-0 rounded-lg bg-[#4B7094] px-2.5 py-1.5 text-[11px] font-semibold text-[#FFFDF9] cursor-pointer"
                          >
                            Activar
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Restaurar copia de seguridad */}
            <section className="paper-sheet rounded-2xl border border-[#E5DFD2] bg-[#FFFDF7] p-4 space-y-2.5">
              <div className="flex items-center gap-2">
                <Upload className="h-4 w-4 text-[#D04B00]" />
                <h2 className="text-[14px] font-bold text-[#2C2621]">
                  ¿Quieres recuperar una copia anterior?
                </h2>
              </div>
              <input
                type="password"
                data-testid="onboarding-backup-password"
                placeholder="Contraseña de la copia, si tiene"
                value={backupPassword}
                onChange={(e) => setBackupPassword(e.target.value)}
                className="w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 text-xs text-[#2C2621] placeholder:text-[#6B6860]/70 focus:border-[#EA580C] focus:outline-none"
              />
              <label className="flex min-h-[44px] cursor-pointer items-center justify-center rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] font-semibold text-[#2C2621] hover:border-[#EA580C]">
                Restaurar copia de seguridad
                <input
                  type="file"
                  data-testid="onboarding-backup-file-input"
                  accept="application/json,.json"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    void handleRestoreBackup(file);
                    e.target.value = "";
                  }}
                  className="hidden"
                />
              </label>
            </section>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                data-testid="onboarding-back-btn"
                disabled={busy}
                onClick={() => {
                  setErrorMsg(null);
                  setStatusMsg(null);
                  setStep(1);
                }}
                className="inline-flex min-h-[50px] items-center justify-center gap-1.5 rounded-2xl border border-[#E5DFD2] bg-[#FFFDF7] px-4 text-[13px] font-semibold text-[#2C2621] cursor-pointer"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Volver</span>
              </button>
              <button
                type="button"
                data-testid="onboarding-finish-btn"
                disabled={busy}
                onClick={() => void handleFinish()}
                className="inline-flex min-h-[50px] flex-1 items-center justify-center gap-1.5 rounded-2xl bg-[#D04B00] hover:bg-[#EA580C] px-4 text-[14px] font-semibold text-[#FFFDF9] shadow-sm cursor-pointer disabled:opacity-50 transition-colors"
              >
                <Check className="h-4 w-4" />
                <span>{busy ? "Guardando..." : "Finalizar y empezar"}</span>
              </button>
            </div>
          </div>
        )}
      </main>

      {importDraft && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Revisar importación de tarifario"
          className="fixed inset-0 z-50 flex flex-col cotton-paper overflow-y-auto p-4"
        >
          <div className="mx-auto w-full max-w-2xl">
            <DocumentImportReviewWidget
              initialDraft={importDraft}
              currentHourlyRateCents={liveRateCents}
              executor={executor}
              onCommitted={async (res) => {
                setImportDraft(null);
                await loadAllOnboardingData(true);
                setStatusMsg(
                  `Importación completada: ${res.savedCount} partida(s) guardadas${
                    res.appliedHourlyRateCents
                      ? ` y tarifa actualizada a ${formatCentsEs(res.appliedHourlyRateCents)}/h`
                      : ""
                  }.`
                );
              }}
              onCancel={() => setImportDraft(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
