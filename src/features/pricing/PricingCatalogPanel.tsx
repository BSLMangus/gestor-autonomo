import { Calculator, Clock, FileUp, Plus, Sliders, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { LocalInferenceAdapterImpl } from "../../agent/inference/localInferenceAdapter";
import {
  patchCatalogItemByVoice,
  patchWorkScheduleDefaultsByVoice,
  type CatalogItemFormState,
} from "../../agent/voiceFormPatcher";
import type {
  CatalogCategory,
  CatalogItemRow,
  CatalogPricingMode,
  DocumentImportReviewDraft,
  QuoteVatRate,
  SqliteExecutor,
  WorkScheduleDefaults,
} from "../../core/contracts/types";
import { CatalogRepository } from "../../core/db/repositories/catalogRepo";
import {
  computeDailyWorkHoursBreakdown,
  ScheduleRepository,
} from "../../core/db/repositories/scheduleRepo";
import { SettingsRepository } from "../../core/db/repositories/settingsRepo";
import { formatCentsEs } from "../../core/fiscal/fiscalEngine";
import type { VoiceInputAdapter } from "../../core/hardware/voiceAdapter";
import type { OcrPort } from "../../core/ports/mediaPorts";
import { InlineVoiceFormTrigger } from "../../ui/ContextualVoiceDock";
import {
  computeTemplatePreviewPriceCents,
  findMatchingCatalogItemForTemplate,
  PREDEFINED_CATALOG_TEMPLATES,
  type PredefinedCatalogTemplate,
} from "../../core/pricing/predefinedCatalog";
import {
  computeCatalogUnitPriceCents,
  formatPricingBreakdown,
} from "../../core/pricing/pricingEngine";
import { analyzeDocumentsForCatalog } from "./documentImportPipeline";

interface PricingCatalogPanelProps {
  executor: SqliteExecutor;
  ocrPort: OcrPort;
  refreshTick: number;
  voiceAdapter?: VoiceInputAdapter;
  inferenceAdapter?: LocalInferenceAdapterImpl;
  registerBackHandler?: (priority: number, handler: () => boolean) => () => void;
  onOpenDocumentImport: (draft: DocumentImportReviewDraft, currentHourlyRateCents: number) => void;
  onDataChanged: () => Promise<void>;
}

const CATEGORIES: CatalogCategory[] = [
  "Fontanería",
  "Electricidad",
  "Albañilería",
  "Pintura",
  "General",
];

function centsToEurInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

function eurToCents(raw: string): number {
  const parsed = Number.parseFloat(raw.replace(",", ".").trim());
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100);
}

function hoursToThousandths(raw: string): number {
  const parsed = Number.parseFloat(raw.replace(",", ".").trim());
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 1000);
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

const DEFAULT_WORK_SCHEDULE: WorkScheduleDefaults = {
  work_days: [1, 2, 3, 4, 5],
  morning_start: "08:00",
  morning_end: "14:00",
  afternoon_start: "15:00",
  afternoon_end: "17:00",
  auto_apply_to_jobs: true,
};

function formatThousandthsHours(thousandths: number): string {
  const hrs = thousandths / 1000;
  return `${hrs.toFixed(1).replace(/\.0$/, "").replace(".", ",")} h`;
}

export function PricingCatalogPanel({
  executor,
  ocrPort,
  refreshTick,
  voiceAdapter,
  inferenceAdapter,
  registerBackHandler,
  onOpenDocumentImport,
  onDataChanged,
}: PricingCatalogPanelProps) {
  const [hourlyRateCents, setHourlyRateCents] = useState(3800);
  const [hourlyRateInput, setHourlyRateInput] = useState("38.00");
  const [defaultVatRate, setDefaultVatRate] = useState<QuoteVatRate>(21);
  const [catalogItems, setCatalogItems] = useState<CatalogItemRow[]>([]);
  const [allCatalogRows, setAllCatalogRows] = useState<CatalogItemRow[]>([]);
  const [workSchedule, setWorkSchedule] = useState<WorkScheduleDefaults>(DEFAULT_WORK_SCHEDULE);

  const [search, setSearch] = useState("");
  const [showPredefined, setShowPredefined] = useState(true);
  const [showCustomForm, setShowCustomForm] = useState(false);

  // Estado formulario crear / editar partida
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [formDesc, setFormDesc] = useState("");
  const [formCat, setFormCat] = useState<CatalogCategory>("General");
  const [formUnit, setFormUnit] = useState("ud");
  const [formMode, setFormMode] = useState<CatalogPricingMode>("hourly_plus_materials");
  const [formHoursInput, setFormHoursInput] = useState("1");
  const [formMaterialsInput, setFormMaterialsInput] = useState("0.00");
  const [formFixedPriceInput, setFormFixedPriceInput] = useState("38.00");
  const [formVatInput, setFormVatInput] = useState("21");

  const [busy, setBusy] = useState(false);
  const [importingDocs, setImportingDocs] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [schedUndoStack, setSchedUndoStack] = useState<WorkScheduleDefaults[]>([]);
  const [schedVoiceChanges, setSchedVoiceChanges] = useState<string[]>([]);
  const [schedVoiceWarnings, setSchedVoiceWarnings] = useState<string[]>([]);
  const [catUndoStack, setCatUndoStack] = useState<CatalogItemFormState[]>([]);
  const [catVoiceChanges, setCatVoiceChanges] = useState<string[]>([]);
  const [catVoiceWarnings, setCatVoiceWarnings] = useState<string[]>([]);

  const loadData = async () => {
    const [settings, filteredRes, fullRes, scheduleDefaults] = await Promise.all([
      new SettingsRepository(executor).getAppSettings(),
      new CatalogRepository(executor).listPaginated({
        search: search.trim() || undefined,
        includeInactive: false,
        limit: 100,
        offset: 0,
      }),
      new CatalogRepository(executor).listPaginated({
        includeInactive: true,
        limit: 100,
        offset: 0,
      }),
      new ScheduleRepository(executor).getWorkScheduleDefaults(),
    ]);

    setHourlyRateCents(settings.hourly_rate_cents);
    setHourlyRateInput(centsToEurInput(settings.hourly_rate_cents));
    setDefaultVatRate(settings.default_vat_rate);
    setFormVatInput(String(settings.default_vat_rate));
    setCatalogItems(filteredRes.items);
    setAllCatalogRows(fullRes.items);
    setWorkSchedule(scheduleDefaults);
  };

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executor, search, refreshTick]);

  const handleSaveHourlyRate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    const nextCents = eurToCents(hourlyRateInput);
    if (nextCents < 100) {
      setErrorMsg("Introduce una tarifa por hora válida (mínimo 1,00 €/h).");
      return;
    }
    setBusy(true);
    try {
      const res = await new SettingsRepository(executor).updateHourlyRate(nextCents);
      await loadData();
      await onDataChanged();
      setStatusMsg(
        `Tarifa base actualizada a ${formatCentsEs(res.settings.hourly_rate_cents)}/h (${res.updatedCatalogCount} partida(s) dinámicas recalculadas).`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const resetCustomForm = () => {
    setEditingItemId(null);
    setFormDesc("");
    setFormCat("General");
    setFormUnit("ud");
    setFormMode("hourly_plus_materials");
    setFormHoursInput("1");
    setFormMaterialsInput("0.00");
    setFormFixedPriceInput(centsToEurInput(hourlyRateCents));
    setFormVatInput(String(defaultVatRate));
    setShowCustomForm(false);
  };

  const handleEditItem = (item: CatalogItemRow) => {
    setEditingItemId(item.id);
    setFormDesc(item.description);
    setFormCat(item.category);
    setFormUnit(item.unit);
    setFormMode(item.pricing_mode);
    setFormHoursInput(
      item.estimated_hours_thousandths > 0 ? String(item.estimated_hours_thousandths / 1000) : "1"
    );
    setFormMaterialsInput(centsToEurInput(item.materials_cents));
    setFormFixedPriceInput(centsToEurInput(item.unit_price_cents));
    setFormVatInput(String(item.default_vat_rate));
    setShowCustomForm(true);
  };

  const formLivePriceCents = computeCatalogUnitPriceCents({
    pricing_mode: formMode,
    estimated_hours_thousandths: hoursToThousandths(formHoursInput),
    materials_cents: eurToCents(formMaterialsInput),
    hourly_rate_cents: hourlyRateCents,
    fixed_price_cents: eurToCents(formFixedPriceInput),
  });

  const handleSaveCatalogItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    setBusy(true);
    try {
      const repo = new CatalogRepository(executor);
      const vatNum = Number.parseFloat(formVatInput.replace(",", "."));
      const payload = {
        description: formDesc.trim(),
        category: formCat,
        unit: formUnit.trim() || "ud",
        pricing_mode: formMode,
        estimated_hours_thousandths:
          formMode === "hourly_plus_materials" ? hoursToThousandths(formHoursInput) : 0,
        materials_cents:
          formMode === "hourly_plus_materials" ? eurToCents(formMaterialsInput) : 0,
        unit_price_cents: formLivePriceCents,
        default_vat_rate: Number.isFinite(vatNum) ? Math.max(0, Math.min(100, vatNum)) : 21,
      };
      if (editingItemId) {
        await repo.update(editingItemId, payload);
        setStatusMsg("Partida del tarifario actualizada.");
      } else {
        await repo.create(payload);
        setStatusMsg("Nueva partida añadida al tarifario.");
      }
      resetCustomForm();
      await loadData();
      await onDataChanged();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleActivateTemplate = async (tpl: PredefinedCatalogTemplate) => {
    setErrorMsg(null);
    setStatusMsg(null);
    setBusy(true);
    try {
      const res = await new CatalogRepository(executor).activatePredefinedTemplate(
        tpl,
        hourlyRateCents
      );
      await loadData();
      await onDataChanged();
      setStatusMsg(
        res.createdOrReactivated
          ? `Partida «${res.item.description}» activada en tu tarifario (${formatCentsEs(res.item.unit_price_cents)}).`
          : `«${res.item.description}» ya estaba activa en tu tarifario.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDeactivateItem = async (id: string) => {
    setErrorMsg(null);
    setStatusMsg(null);
    setBusy(true);
    try {
      await new CatalogRepository(executor).deactivate(id);
      await loadData();
      await onDataChanged();
      setStatusMsg("Partida desactivada del tarifario.");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
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
      const files = Array.from(fileList);
      const draft = await analyzeDocumentsForCatalog({
        files,
        ocrPort,
        currentHourlyRateCents: hourlyRateCents,
        existingCatalog: allCatalogRows,
      });
      onOpenDocumentImport(draft, hourlyRateCents);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setImportingDocs(false);
    }
  };

  const handleUpdateWorkSchedule = async (next: WorkScheduleDefaults) => {
    setErrorMsg(null);
    setWorkSchedule(next);
    try {
      const saved = await new ScheduleRepository(executor).updateWorkScheduleDefaults(next);
      setWorkSchedule(saved);
      await onDataChanged();
      setStatusMsg("Horario habitual guardado en SQLite.");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const dailyScheduleBreakdown = computeDailyWorkHoursBreakdown(workSchedule);

  return (
    <div data-testid="pricing-catalog-panel" className="w-full max-w-full overflow-x-hidden space-y-4 text-xs">
      {errorMsg && (
        <div role="alert" className="rounded-2xl border border-coral-alert/30 bg-error-container p-3 text-on-error-container">
          {errorMsg}
        </div>
      )}
      {statusMsg && (
        <div
          data-testid="pricing-status-banner"
          className="rounded-2xl border border-outline-variant bg-success-container p-3 font-semibold text-on-success-container"
        >
          {statusMsg}
        </div>
      )}

      {/* 1. Tarifa Base por Hora destacada */}
      <form
        data-testid="pricing-hourly-rate-card"
        onSubmit={(e) => void handleSaveHourlyRate(e)}
        className="rounded-[20px] border border-outline-variant bg-terracotta-soft p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] space-y-3"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <span className="inline-flex items-center gap-1 rounded-full bg-terracotta px-2.5 py-0.5 text-[10px] font-bold text-white">
              <Calculator className="h-3 w-3" />
              Tarifa Principal
            </span>
            <h3 className="mt-1.5 text-[15px] font-semibold text-on-surface">
              Precio Base por Hora (€/hora)
            </h3>
            <p className="mt-0.5 text-[11px] text-on-surface-variant">
              Las partidas configuradas por tiempo se recalculan automáticamente: duración (h) × tarifa/hora + materiales.
            </p>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[10px] font-semibold text-on-surface-variant">Vigente</div>
            <div
              data-testid="pricing-current-hourly-badge"
              className="font-mono text-[17px] font-bold text-on-primary-container tabular-nums"
            >
              {formatCentsEs(hourlyRateCents)}/h
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-1.5">
            <input
              type="number"
              step="0.5"
              min="1"
              data-testid="pricing-hourly-rate-input"
              disabled={busy}
              value={hourlyRateInput}
              onChange={(e) => setHourlyRateInput(e.target.value)}
              className="w-24 font-mono text-[15px] font-bold text-on-surface tabular-nums focus:outline-none"
            />
            <span className="text-xs font-semibold text-on-surface-variant">€/h</span>
          </div>
          <button
            type="submit"
            data-testid="pricing-save-hourly-btn"
            disabled={busy}
            className="min-h-[46px] flex-1 rounded-xl bg-primary hover:bg-terracotta px-3 text-[13px] font-semibold text-white disabled:opacity-50 cursor-pointer"
          >
            Guardar tarifa y recalcular
          </button>
        </div>
      </form>

      {/* 1b. Mi Horario Habitual de Trabajo (vinculado al Calendario) */}
      <section
        data-testid="pricing-work-schedule-section"
        className="rounded-[20px] border border-outline-variant bg-surface-container-lowest p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col gap-3"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-on-primary-container" />
            <h3 className="text-[15px] font-semibold text-on-surface">
              Mi Horario Habitual de Trabajo
            </h3>
          </div>
          <span
            data-testid="pricing-schedule-daily-hours"
            className="font-mono text-[11px] font-semibold text-on-success-container bg-success-container px-2.5 py-0.5 rounded-full tabular-nums"
          >
            {formatThousandthsHours(dailyScheduleBreakdown.totalThousandths)}/día
          </span>
        </div>

        <InlineVoiceFormTrigger
          voiceAdapter={voiceAdapter}
          registerBackHandler={registerBackHandler}
          testId="work-schedule-voice-btn"
          title="Dictar horario habitual"
          placeholder="Ej: De lunes a viernes, mañanas de 8 a 14 y tardes de 15 a 18"
          examples={[
            "De lunes a sábado, mañanas de 8 a 14 y tardes de 15 a 18",
            "Jornada continua de 8 a 15 sin tardes",
            "Añade los sábados y cambia salida a las 18:00",
          ]}
          buttonLabel="Dictar horario"
          disabled={busy}
          lastChanges={schedVoiceChanges}
          lastWarnings={schedVoiceWarnings}
          canUndo={schedUndoStack.length > 0}
          onUndo={() => {
            const prev = schedUndoStack[schedUndoStack.length - 1];
            if (!prev) return;
            setSchedUndoStack((s) => s.slice(0, -1));
            setSchedVoiceChanges(["Último dictado deshecho"]);
            setSchedVoiceWarnings([]);
            void handleUpdateWorkSchedule(prev);
          }}
          onTranscript={async (text) => {
            const snap: WorkScheduleDefaults = {
              ...workSchedule,
              work_days: [...workSchedule.work_days],
            };
            const res = await patchWorkScheduleDefaultsByVoice(snap, text, {
              executor,
              inferenceAdapter,
            });
            if (res.changed) {
              setSchedUndoStack((s) => [...s.slice(-9), snap]);
              setSchedVoiceChanges(res.appliedChanges);
              setSchedVoiceWarnings(res.warnings);
              await handleUpdateWorkSchedule(res.nextState);
            } else {
              setSchedVoiceChanges([]);
              setSchedVoiceWarnings([
                "No detecté días u horas. Prueba: «De lunes a viernes de 8 a 14 y de 15 a 18».",
              ]);
            }
          }}
        />

        <div className="grid grid-cols-7 gap-1.5">
          {WEEKDAY_BUTTONS.map((day) => {
            const active = workSchedule.work_days.includes(day.id);
            return (
              <button
                key={day.id}
                type="button"
                data-testid={`schedule-weekday-${day.id}`}
                onClick={() => {
                  const nextDays = active
                    ? workSchedule.work_days.filter((d) => d !== day.id)
                    : [...workSchedule.work_days, day.id].sort((a, b) => a - b);
                  void handleUpdateWorkSchedule({ ...workSchedule, work_days: nextDays });
                }}
                aria-pressed={active}
                className={`min-h-[42px] rounded-xl font-semibold text-[12px] cursor-pointer transition-colors ${
                  active
                    ? "bg-secondary text-on-secondary"
                    : "bg-surface-container-low border border-outline-variant text-on-surface-variant"
                }`}
              >
                {day.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between bg-surface-container-low rounded-2xl p-2.5">
            <div className="flex flex-col pl-1">
              <span className="text-[12px] font-semibold text-on-surface">Mañana</span>
              <span className="text-[11px] text-on-surface-variant">
                {formatThousandthsHours(dailyScheduleBreakdown.morningThousandths)}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="time"
                aria-label="Inicio mañana"
                value={workSchedule.morning_start}
                onChange={(e) =>
                  void handleUpdateWorkSchedule({ ...workSchedule, morning_start: e.target.value })
                }
                className="min-h-[40px] px-2 rounded-xl bg-surface-container-lowest border border-outline-variant font-mono text-[12px] tabular-nums"
              />
              <span className="text-outline">–</span>
              <input
                type="time"
                aria-label="Fin mañana"
                value={workSchedule.morning_end}
                onChange={(e) =>
                  void handleUpdateWorkSchedule({ ...workSchedule, morning_end: e.target.value })
                }
                className="min-h-[40px] px-2 rounded-xl bg-surface-container-lowest border border-outline-variant font-mono text-[12px] tabular-nums"
              />
            </div>
          </div>

          <div className="flex items-center justify-between bg-surface-container-low rounded-2xl p-2.5">
            <div className="flex flex-col pl-1">
              <span className="text-[12px] font-semibold text-on-surface">Tarde</span>
              <span className="text-[11px] text-on-surface-variant">
                {formatThousandthsHours(dailyScheduleBreakdown.afternoonThousandths)}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="time"
                aria-label="Inicio tarde"
                value={workSchedule.afternoon_start}
                onChange={(e) =>
                  void handleUpdateWorkSchedule({ ...workSchedule, afternoon_start: e.target.value })
                }
                className="min-h-[40px] px-2 rounded-xl bg-surface-container-lowest border border-outline-variant font-mono text-[12px] tabular-nums"
              />
              <span className="text-outline">–</span>
              <input
                type="time"
                aria-label="Fin tarde"
                value={workSchedule.afternoon_end}
                onChange={(e) =>
                  void handleUpdateWorkSchedule({ ...workSchedule, afternoon_end: e.target.value })
                }
                className="min-h-[40px] px-2 rounded-xl bg-surface-container-lowest border border-outline-variant font-mono text-[12px] tabular-nums"
              />
            </div>
          </div>
        </div>

        <label className="flex items-center justify-between gap-3 min-h-[46px] px-3 py-2 rounded-xl bg-terracotta-soft border border-outline-variant cursor-pointer">
          <span className="text-[12px] font-medium text-on-primary-container">
            Aplicar automáticamente este horario al crear una obra con fechas
          </span>
          <input
            type="checkbox"
            data-testid="schedule-auto-apply-checkbox"
            checked={workSchedule.auto_apply_to_jobs}
            onChange={(e) =>
              void handleUpdateWorkSchedule({
                ...workSchedule,
                auto_apply_to_jobs: e.target.checked,
              })
            }
            className="w-5 h-5 rounded border-outline accent-terracotta shrink-0"
          />
        </label>
      </section>

      {/* 2. Importador IA Local de Documentos Existentes */}
      <section
        data-testid="pricing-document-importer"
        className="rounded-2xl border border-indigo-200 bg-white p-3.5 shadow-xs space-y-2.5"
      >
        <div className="flex items-start gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-800">
            <Sparkles className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-extrabold text-slate-900">
              Importador IA de Tarifas y Presupuestos Previos
            </h3>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600">
              Sube PDFs antiguos, facturas, listados de precios (CSV/TXT) o imágenes. El motor offline extraerá partidas, precios, tarifa/hora e IVA para revisarlos antes de guardar.
            </p>
          </div>
        </div>

        <label className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-indigo-300 bg-indigo-50/70 px-3 py-2 text-xs font-bold text-indigo-900 active:bg-indigo-100">
          <FileUp className="h-4 w-4 shrink-0" />
          <span>
            {importingDocs
              ? "Analizando documentos offline..."
              : "Seleccionar PDF, imagen o CSV/TXT"}
          </span>
          <input
            type="file"
            data-testid="pricing-import-file-input"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.csv,.tsv,application/pdf,image/*,text/plain,text/csv"
            multiple
            disabled={importingDocs || busy}
            onChange={(e) => {
              const files = e.target.files;
              void handleFilesSelected(files);
              e.target.value = "";
            }}
            className="hidden"
          />
        </label>
      </section>

      {/* 3. Partidas predefinidas del sector */}
      <section className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-xs space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-extrabold text-slate-900">
              Catálogo Predefinido de Oficios
            </h3>
            <p className="text-[11px] text-slate-500">
              Activa o ajusta partidas habituales con cálculo conectado a tu tarifa base.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowPredefined((v) => !v)}
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-700"
          >
            {showPredefined ? "Ocultar" : "Mostrar"}
          </button>
        </div>

        {showPredefined && (
          <div className="space-y-1.5">
            {PREDEFINED_CATALOG_TEMPLATES.map((tpl) => {
              const matched = findMatchingCatalogItemForTemplate(tpl, allCatalogRows);
              const isActive = matched !== null && matched.active === 1;
              const previewPrice = computeTemplatePreviewPriceCents(tpl, hourlyRateCents);

              return (
                <div
                  key={tpl.template_id}
                  data-testid={`predefined-tpl-${tpl.template_id}`}
                  className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50 px-2.5 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="break-words [overflow-wrap:anywhere] font-bold text-slate-900">
                      {tpl.description}
                    </div>
                    <div className="break-words text-[10px] text-slate-500">
                      {tpl.category} · {tpl.unit} · IVA {tpl.default_vat_rate} % ·{" "}
                      {formatPricingBreakdown({
                        pricing_mode: tpl.pricing_mode,
                        estimated_hours_thousandths: tpl.estimated_hours_thousandths,
                        materials_cents: tpl.materials_cents,
                        hourly_rate_cents: hourlyRateCents,
                        unit_price_cents: previewPrice,
                      })}
                    </div>
                  </div>
                  {isActive ? (
                    <span className="shrink-0 rounded-lg bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-900">
                      Activa
                    </span>
                  ) : (
                    <button
                      type="button"
                      data-testid={`activate-tpl-${tpl.template_id}`}
                      disabled={busy}
                      onClick={() => void handleActivateTemplate(tpl)}
                      className="shrink-0 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] font-bold text-white"
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

      {/* 4. Tarifario activo + Partida personalizada */}
      <section className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-xs space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Sliders className="h-4 w-4 text-slate-700" />
            <h3 className="text-sm font-extrabold text-slate-900">
              Mi Tarifario ({catalogItems.length})
            </h3>
          </div>
          <button
            type="button"
            data-testid="pricing-new-custom-btn"
            onClick={() => {
              if (showCustomForm && !editingItemId) {
                resetCustomForm();
              } else {
                resetCustomForm();
                setShowCustomForm(true);
              }
            }}
            className="inline-flex items-center gap-1 rounded-xl bg-orange-600 px-3 py-1.5 text-xs font-bold text-white"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Partida personalizada</span>
          </button>
        </div>

        {showCustomForm && (
          <form
            data-testid="pricing-custom-form"
            onSubmit={(e) => void handleSaveCatalogItem(e)}
            className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2.5"
          >
            <div className="font-bold text-slate-900">
              {editingItemId ? "Editar partida" : "Nueva partida personalizada"}
            </div>
            <InlineVoiceFormTrigger
              voiceAdapter={voiceAdapter}
              registerBackHandler={registerBackHandler}
              testId="catalog-item-voice-btn"
              title={editingItemId ? "Dictar cambios de partida" : "Dictar nueva partida"}
              placeholder="Ej: Pintura plástica m2, categoría pintura, precio fijo 14 euros"
              examples={[
                "Descripción Alicatado suelo, categoría albañilería, en m2, 2 horas y materiales 15 euros",
                "Precio fijo 65 euros, IVA 10 %",
              ]}
              buttonLabel="Dictar partida"
              disabled={busy}
              lastChanges={catVoiceChanges}
              lastWarnings={catVoiceWarnings}
              canUndo={catUndoStack.length > 0}
              onUndo={() => {
                const prev = catUndoStack[catUndoStack.length - 1];
                if (!prev) return;
                setCatUndoStack((s) => s.slice(0, -1));
                setFormDesc(prev.desc);
                setFormCat(prev.cat);
                setFormUnit(prev.unit);
                setFormMode(prev.mode);
                setFormHoursInput(prev.hoursInput);
                setFormMaterialsInput(prev.materialsInput);
                setFormFixedPriceInput(prev.fixedPriceInput);
                setFormVatInput(prev.vatInput);
                setCatVoiceChanges(["Último dictado deshecho"]);
                setCatVoiceWarnings([]);
              }}
              onTranscript={async (text) => {
                const snap: CatalogItemFormState = {
                  desc: formDesc,
                  cat: formCat,
                  unit: formUnit,
                  mode: formMode,
                  hoursInput: formHoursInput,
                  materialsInput: formMaterialsInput,
                  fixedPriceInput: formFixedPriceInput,
                  vatInput: formVatInput,
                };
                const res = await patchCatalogItemByVoice(snap, text, {
                  executor,
                  inferenceAdapter,
                });
                if (res.changed) {
                  setCatUndoStack((s) => [...s.slice(-9), snap]);
                  setFormDesc(res.nextState.desc);
                  setFormCat(res.nextState.cat);
                  setFormUnit(res.nextState.unit);
                  setFormMode(res.nextState.mode);
                  setFormHoursInput(res.nextState.hoursInput);
                  setFormMaterialsInput(res.nextState.materialsInput);
                  setFormFixedPriceInput(res.nextState.fixedPriceInput);
                  setFormVatInput(res.nextState.vatInput);
                  setCatVoiceChanges(res.appliedChanges);
                  setCatVoiceWarnings(res.warnings);
                } else {
                  setCatVoiceChanges([]);
                  setCatVoiceWarnings(["No detecté cambios claros para la partida."]);
                }
              }}
            />
            <input
              type="text"
              data-testid="pricing-custom-desc-input"
              placeholder="Descripción técnica de la partida *"
              value={formDesc}
              onChange={(e) => setFormDesc(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-xs"
            />
            <div className="grid grid-cols-3 gap-2">
              <select
                value={formCat}
                onChange={(e) => setFormCat(e.target.value as CatalogCategory)}
                className="rounded-xl border border-slate-300 bg-white px-2 py-2 text-xs"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Unidad (ud, m2...)"
                value={formUnit}
                onChange={(e) => setFormUnit(e.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-xs"
              />
              <input
                type="number"
                step="0.5"
                min="0"
                max="100"
                placeholder="IVA %"
                value={formVatInput}
                onChange={(e) => setFormVatInput(e.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-xs"
              />
            </div>

            <div className="flex gap-1.5">
              <button
                type="button"
                data-testid="pricing-mode-hourly-btn"
                onClick={() => setFormMode("hourly_plus_materials")}
                className={`flex-1 rounded-xl px-2.5 py-2 text-[11px] font-bold ${
                  formMode === "hourly_plus_materials"
                    ? "bg-slate-900 text-white"
                    : "border border-slate-300 bg-white text-slate-700"
                }`}
              >
                Horas × Tarifa + Materiales
              </button>
              <button
                type="button"
                data-testid="pricing-mode-fixed-btn"
                onClick={() => setFormMode("fixed")}
                className={`flex-1 rounded-xl px-2.5 py-2 text-[11px] font-bold ${
                  formMode === "fixed"
                    ? "bg-slate-900 text-white"
                    : "border border-slate-300 bg-white text-slate-700"
                }`}
              >
                Importe fijo
              </button>
            </div>

            {formMode === "hourly_plus_materials" ? (
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[10px] text-slate-600">Duración (horas)</label>
                  <input
                    type="number"
                    step="0.25"
                    min="0"
                    data-testid="pricing-custom-hours-input"
                    value={formHoursInput}
                    onChange={(e) => setFormHoursInput(e.target.value)}
                    className="mt-0.5 w-full rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-600">Materiales (€)</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    data-testid="pricing-custom-materials-input"
                    value={formMaterialsInput}
                    onChange={(e) => setFormMaterialsInput(e.target.value)}
                    className="mt-0.5 w-full rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold"
                  />
                </div>
                <div className="flex flex-col justify-end text-right">
                  <span className="text-[10px] text-slate-500">Precio resultante</span>
                  <span data-testid="pricing-custom-preview-total" className="text-sm font-extrabold text-orange-700">
                    {formatCentsEs(formLivePriceCents)}
                  </span>
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-[10px] text-slate-600">Precio unitario fijo (€)</label>
                <input
                  type="number"
                  step="0.5"
                  min="0.01"
                  data-testid="pricing-custom-fixed-input"
                  value={formFixedPriceInput}
                  onChange={(e) => setFormFixedPriceInput(e.target.value)}
                  className="mt-0.5 w-full rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-xs font-bold"
                />
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={resetCustomForm}
                className="min-h-10 rounded-xl border border-slate-300 bg-white px-3 font-semibold text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="submit"
                data-testid="pricing-custom-save-btn"
                disabled={busy}
                className="min-h-10 flex-1 rounded-xl bg-slate-900 font-bold text-white"
              >
                {editingItemId ? "Guardar cambios" : "Guardar partida"}
              </button>
            </div>
          </form>
        )}

        <input
          type="search"
          data-testid="catalog-search-input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar en tu tarifario..."
          className="min-h-10 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-xs"
        />

        <div className="space-y-2">
          {catalogItems.map((item) => (
            <div
              key={item.id}
              data-testid={`catalog-item-${item.id}`}
              className="rounded-xl border border-slate-200 bg-slate-50/70 p-2.5 space-y-1.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="break-words [overflow-wrap:anywhere] font-bold text-slate-900">
                    {item.description}
                  </div>
                  <div className="break-words text-[11px] text-slate-500">
                    {item.category} · {item.unit} · IVA {item.default_vat_rate} %
                  </div>
                  <div className="break-words text-[10px] font-medium text-slate-600">
                    {formatPricingBreakdown({
                      pricing_mode: item.pricing_mode,
                      estimated_hours_thousandths: item.estimated_hours_thousandths,
                      materials_cents: item.materials_cents,
                      hourly_rate_cents: hourlyRateCents,
                      unit_price_cents: item.unit_price_cents,
                    })}
                  </div>
                </div>
                <div className="shrink-0 text-sm font-extrabold text-slate-900">
                  {formatCentsEs(item.unit_price_cents)}
                </div>
              </div>
              <div className="flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => handleEditItem(item)}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700"
                >
                  Editar
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleDeactivateItem(item.id)}
                  className="rounded-lg border border-rose-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-rose-700"
                >
                  Desactivar
                </button>
              </div>
            </div>
          ))}
          {catalogItems.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500">
              Aún no hay partidas activas que coincidan con tu búsqueda.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
