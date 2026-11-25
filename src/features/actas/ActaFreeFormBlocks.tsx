import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  PenTool,
  Plus,
  RotateCcw,
  Save,
  Share2,
  Trash2,
  UserPlus,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  InstallerActaProfileInputSchema,
  SpanishTaxIdSchema,
} from "../../core/contracts/schemas";
import { TEXT_LIMITS } from "../../core/contracts/textLimits";
import type {
  ActaPuestaEnMarchaData,
  AppSettingsRecord,
  CircuitoElectrico,
  ClientRow,
  EspecialidadActa,
  EstadoActa,
  LocalFileBridge,
  RedFontaneria,
  SqliteExecutor,
  TipoActuacionActa,
} from "../../core/contracts/types";
import { ClientsRepository } from "../../core/db/repositories/clientsRepo";
import { SettingsRepository } from "../../core/db/repositories/settingsRepo";
import type { CameraAdapter } from "../../core/hardware/cameraAdapter";
import type { VoiceInputAdapter } from "../../core/hardware/voiceAdapter";
import { InlineVoiceFormTrigger } from "../../ui/ContextualVoiceDock";
import { ZoomableTextField } from "../../ui/ZoomableTextField";
import { ActaPhotosSection } from "./ActaPhotosSection";
import {
  ACTA_CONFORMIDAD_TEMPLATE,
  buildActaRecepcionTemplate,
  createDefaultMemoriaElectricidad,
  createDefaultMemoriaFontaneria,
  createDefaultPruebasElectricidad,
  createDefaultPruebasFontaneria,
  getActaMantenimientoTemplate,
  isDefaultMantenimientoText,
  isDefaultRecepcionText,
  isInstallerActaProfileComplete,
} from "./actaTemplates";

interface ActaFreeFormBlocksProps {
  actaId: string;
  jobId: string | null;
  executor: SqliteExecutor;
  fileBridge: LocalFileBridge;
  cameraAdapter?: CameraAdapter;
  data: ActaPuestaEnMarchaData;
  estado: EstadoActa;
  linkedClientId: string | null;
  allClients: ClientRow[];
  appSettings: AppSettingsRecord | null;
  blockStates: boolean[];
  firmaClienteBase64: string | null;
  firmaInstaladorBase64: string | null;
  pdfBusy: boolean;
  voiceAdapter?: VoiceInputAdapter;
  registerBackHandler?: (priority: number, handler: () => boolean) => () => void;
  onChangeData: (updater: (prev: ActaPuestaEnMarchaData) => ActaPuestaEnMarchaData) => void;
  onChangeEstado: (next: EstadoActa) => void;
  onLinkClient: (clientId: string | null, clientDataPatch?: Partial<ActaPuestaEnMarchaData["cliente"]>) => void;
  onClientsUpdated: (clients: ClientRow[]) => void;
  onSettingsUpdated: (settings: AppSettingsRecord) => void;
  onOpenClientSignature: () => void;
  onOpenInstallerSignature: () => void;
  onClearClientSignature: () => void;
  onGenerateAndSharePdf: () => Promise<void>;
}

const TIPO_ACTUACION_OPTIONS: Array<{ value: TipoActuacionActa; label: string }> = [
  { value: "obra_nueva", label: "Obra nueva" },
  { value: "reforma_integral", label: "Reforma integral" },
  { value: "modificacion_parcial", label: "Modificación parcial" },
  { value: "reparacion_sustitucion", label: "Reparación / Sustitución" },
];

const REDES_FONTANERIA: RedFontaneria[] = ["AFCH", "ACS", "Retorno", "Saneamiento"];

const CIRCUIT_PRESETS: CircuitoElectrico[] = [
  { nombre: "C1 Iluminación", calibre_a: 10, seccion_mm2: 1.5 },
  { nombre: "C2 Tomas uso general", calibre_a: 16, seccion_mm2: 2.5 },
  { nombre: "C3 Cocina / Horno", calibre_a: 25, seccion_mm2: 6 },
  { nombre: "C4 Lavadora / Termo", calibre_a: 20, seccion_mm2: 4 },
];

const MATERIAL_CHIPS = ["Multicapa PEX-Al-PEX", "Cobre", "PVC", "PPR"];

function CollapsibleBlockCard({
  index,
  title,
  subtitle,
  completed,
  expanded,
  onToggle,
  testId,
  children,
}: {
  index: number;
  title: string;
  subtitle: string;
  completed: boolean;
  expanded: boolean;
  onToggle: () => void;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section
      data-testid={testId}
      className="paper-sheet rounded-2xl border border-[#E5DFD2] bg-[#FFFDF7] overflow-hidden font-sans"
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex min-h-[56px] w-full items-center justify-between gap-2.5 px-3.5 py-2.5 text-left cursor-pointer"
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono-nums text-[12px] font-bold ${
              completed
                ? "status-emerald"
                : "bg-[#EFECE4] text-[#6B6860] border border-[#E5DFD2]"
            }`}
          >
            {completed ? <Check className="h-4 w-4" /> : index}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-bold text-[#2C2621]">{title}</div>
            <div className="truncate text-[11px] text-[#6B6860]">{subtitle}</div>
          </div>
        </div>
        <span className="shrink-0 text-[#6B6860]">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-[#E5DFD2] p-3.5 space-y-3">{children}</div>
      )}
    </section>
  );
}

function YesNoToggle({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
  testId?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] px-3 py-2">
      <span className="min-w-0 flex-1 text-[12px] font-semibold text-[#2C2621]">{label}</span>
      <div className="flex shrink-0 gap-1">
        <button
          type="button"
          data-testid={testId ? `${testId}-si` : undefined}
          onClick={() => onChange(true)}
          className={`min-h-[36px] min-w-[46px] rounded-lg px-2.5 text-[12px] font-bold cursor-pointer ${
            value
              ? "bg-[#059669] text-white"
              : "border border-[#E5DFD2] bg-[#FFFDF7] text-[#6B6860]"
          }`}
        >
          Sí
        </button>
        <button
          type="button"
          data-testid={testId ? `${testId}-no` : undefined}
          onClick={() => onChange(false)}
          className={`min-h-[36px] min-w-[46px] rounded-lg px-2.5 text-[12px] font-bold cursor-pointer ${
            !value
              ? "bg-[#DC2626] text-white"
              : "border border-[#E5DFD2] bg-[#FFFDF7] text-[#6B6860]"
          }`}
        >
          No
        </button>
      </div>
    </div>
  );
}

function UnitNumberInput({
  label,
  unit,
  value,
  onChange,
  step = "any",
  placeholder = "—",
  testId,
}: {
  label: string;
  unit: string;
  value: number | null | undefined;
  onChange: (next: number | null) => void;
  step?: string;
  placeholder?: string;
  testId?: string;
}) {
  return (
    <label className="space-y-1">
      <span className="block text-[11px] font-semibold text-[#6B6860]">{label}</span>
      <div className="flex min-h-[44px] items-center overflow-hidden rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] focus-within:border-[#EA580C]">
        <input
          type="number"
          step={step}
          min="0"
          data-testid={testId}
          placeholder={placeholder}
          value={value ?? ""}
          onChange={(e) => {
            const raw = e.target.value.trim();
            if (!raw) {
              onChange(null);
              return;
            }
            const parsed = Number.parseFloat(raw.replace(",", "."));
            onChange(Number.isFinite(parsed) && parsed >= 0 ? parsed : null);
          }}
          className="min-w-0 flex-1 bg-transparent px-3 py-2 font-mono-nums text-xs font-semibold text-[#2C2621] outline-none"
        />
        <span className="shrink-0 border-l border-[#E5DFD2] bg-[#F5F1E6] px-2.5 py-2 font-mono text-[11px] font-bold text-[#6B6860]">
          {unit}
        </span>
      </div>
    </label>
  );
}

export function ActaFreeFormBlocks({
  actaId,
  jobId,
  executor,
  fileBridge,
  cameraAdapter,
  data,
  estado,
  linkedClientId,
  allClients,
  appSettings,
  blockStates,
  firmaClienteBase64,
  firmaInstaladorBase64,
  pdfBusy,
  voiceAdapter,
  registerBackHandler,
  onChangeData,
  onChangeEstado,
  onLinkClient,
  onClientsUpdated,
  onSettingsUpdated,
  onOpenClientSignature,
  onOpenInstallerSignature,
  onClearClientSignature,
  onGenerateAndSharePdf,
}: ActaFreeFormBlocksProps) {
  const installerProfileAlreadySaved = appSettings
    ? isInstallerActaProfileComplete(appSettings)
    : false;

  const [openBlocks, setOpenBlocks] = useState<Record<number, boolean>>({
    1: true,
    2: !installerProfileAlreadySaved || !linkedClientId,
    3: true,
    4: false,
    5: false,
    6: false,
    7: false,
  });

  const [savingInstallerProfile, setSavingInstallerProfile] = useState(false);
  const [installerMsg, setInstallerMsg] = useState<string | null>(null);
  const [installerErr, setInstallerErr] = useState<string | null>(null);

  const [savingInlineClient, setSavingInlineClient] = useState(false);
  const [clientMsg, setClientMsg] = useState<string | null>(null);
  const [clientErr, setClientErr] = useState<string | null>(null);

  const toggleBlock = (idx: number) => {
    setOpenBlocks((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const handleSpecialtyChange = (nextEsp: EspecialidadActa) => {
    onChangeData((prev) => {
      const needsElec = nextEsp === "electricidad" || nextEsp === "mixta";
      const needsFont = nextEsp === "fontaneria" || nextEsp === "mixta";
      const nextMaint = isDefaultMantenimientoText(prev.instrucciones_mantenimiento)
        ? getActaMantenimientoTemplate(nextEsp)
        : prev.instrucciones_mantenimiento;

      return {
        ...prev,
        especialidad: nextEsp,
        memoria_electricidad: needsElec
          ? prev.memoria_electricidad ?? createDefaultMemoriaElectricidad()
          : prev.memoria_electricidad,
        pruebas_electricidad: needsElec
          ? prev.pruebas_electricidad ?? createDefaultPruebasElectricidad()
          : prev.pruebas_electricidad,
        memoria_fontaneria: needsFont
          ? prev.memoria_fontaneria ?? createDefaultMemoriaFontaneria()
          : prev.memoria_fontaneria,
        pruebas_fontaneria: needsFont
          ? prev.pruebas_fontaneria ?? createDefaultPruebasFontaneria()
          : prev.pruebas_fontaneria,
        instrucciones_mantenimiento: nextMaint,
      };
    });
  };

  const handleSaveInstallerAsDefault = async () => {
    setInstallerErr(null);
    setInstallerMsg(null);
    const parsed = InstallerActaProfileInputSchema.safeParse({
      emitter_name: data.instalador.nombre_razon_social,
      emitter_nif: data.instalador.nif_cif,
      emitter_fiscal_address: data.instalador.domicilio_fiscal,
      emitter_phone: data.instalador.telefono,
      emitter_email: data.instalador.email,
      emitter_registry_number: data.instalador.num_registro_empresa ?? "",
      emitter_tech_name: data.instalador.tecnico_nombre,
      emitter_tech_dni: data.instalador.tecnico_dni,
      emitter_installer_card: data.instalador.num_carne_instalador ?? "",
      default_acta_warranty_months: data.plazo_garantia_meses,
    });
    if (!parsed.success) {
      setInstallerErr(parsed.error.issues[0]?.message ?? "Revisa los datos del instalador.");
      return;
    }
    setSavingInstallerProfile(true);
    try {
      const updated = await new SettingsRepository(executor).updateInstallerActaProfile(parsed.data);
      onSettingsUpdated(updated);
      setInstallerMsg("Ficha habitual de instalador guardada para próximas actas.");
    } catch (err) {
      setInstallerErr(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingInstallerProfile(false);
    }
  };

  const handleCreateInlineClient = async () => {
    setClientErr(null);
    setClientMsg(null);
    const name = data.cliente.nombre_razon_social.trim();
    if (!name) {
      setClientErr("Introduce al menos el nombre o razón social del cliente.");
      return;
    }
    const nifTrimmed = data.cliente.nif_cif.trim().toUpperCase();
    if (nifTrimmed && !SpanishTaxIdSchema.safeParse(nifTrimmed).success) {
      setClientErr("El NIF/NIE/CIF del cliente no supera la validación.");
      return;
    }

    setSavingInlineClient(true);
    try {
      const created = await new ClientsRepository(executor).create({
        name,
        nif: nifTrimmed,
        fiscal_address: data.cliente.direccion_emplazamiento.trim(),
        phone: data.cliente.telefono?.trim() ?? "",
        email: data.cliente.email?.trim() ?? "",
      });
      const updatedList = (
        await new ClientsRepository(executor).listPaginated({ limit: 100, offset: 0 })
      ).items;
      onClientsUpdated(updatedList);
      onLinkClient(created.id, {
        nombre_razon_social: created.name,
        nif_cif: created.nif,
        direccion_emplazamiento: created.fiscal_address,
        telefono: created.phone || undefined,
        email: created.email || undefined,
      });
      setClientMsg(`Cliente «${created.name}» creado y vinculado a esta acta.`);
    } catch (err) {
      setClientErr(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingInlineClient(false);
    }
  };

  const needsElec = data.especialidad === "electricidad" || data.especialidad === "mixta";
  const needsFont = data.especialidad === "fontaneria" || data.especialidad === "mixta";

  const memElec = data.memoria_electricidad ?? createDefaultMemoriaElectricidad();
  const memFont = data.memoria_fontaneria ?? createDefaultMemoriaFontaneria();
  const pruElec = data.pruebas_electricidad ?? createDefaultPruebasElectricidad();
  const pruFont = data.pruebas_fontaneria ?? createDefaultPruebasFontaneria();

  const updateMemElec = (
    patch: Partial<NonNullable<ActaPuestaEnMarchaData["memoria_electricidad"]>>
  ) => {
    onChangeData((prev) => ({
      ...prev,
      memoria_electricidad: {
        ...(prev.memoria_electricidad ?? createDefaultMemoriaElectricidad()),
        ...patch,
      },
    }));
  };

  const updateMemFont = (
    patch: Partial<NonNullable<ActaPuestaEnMarchaData["memoria_fontaneria"]>>
  ) => {
    onChangeData((prev) => ({
      ...prev,
      memoria_fontaneria: {
        ...(prev.memoria_fontaneria ?? createDefaultMemoriaFontaneria()),
        ...patch,
      },
    }));
  };

  const updatePruElec = (
    patch: Partial<NonNullable<ActaPuestaEnMarchaData["pruebas_electricidad"]>>
  ) => {
    onChangeData((prev) => ({
      ...prev,
      pruebas_electricidad: {
        ...(prev.pruebas_electricidad ?? createDefaultPruebasElectricidad()),
        ...patch,
      },
    }));
  };

  const updatePruFont = (
    patch: Partial<NonNullable<ActaPuestaEnMarchaData["pruebas_fontaneria"]>>
  ) => {
    onChangeData((prev) => ({
      ...prev,
      pruebas_fontaneria: {
        ...(prev.pruebas_fontaneria ?? createDefaultPruebasFontaneria()),
        ...patch,
      },
    }));
  };

  return (
    <div className="space-y-3 pb-6 font-sans text-[#2C2621]">
      {/* Bloque 1: Identificación y Trazabilidad */}
      <CollapsibleBlockCard
        index={1}
        title="Identificación y trazabilidad"
        subtitle={`${data.especialidad.toUpperCase()} · ${data.fecha_emision}`}
        completed={blockStates[0] ?? false}
        expanded={Boolean(openBlocks[1])}
        onToggle={() => toggleBlock(1)}
        testId="acta-block-1"
      >
        <div className="space-y-1.5">
          <span className="block text-[11px] font-semibold text-[#6B6860]">
            Especialidad técnica
          </span>
          <div className="grid grid-cols-3 gap-1.5">
            {(
              [
                { id: "electricidad", label: "Electricidad" },
                { id: "fontaneria", label: "Fontanería" },
                { id: "mixta", label: "Mixta" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                data-testid={`acta-esp-${opt.id}`}
                onClick={() => handleSpecialtyChange(opt.id)}
                className={`min-h-[44px] rounded-xl border text-[12px] font-bold cursor-pointer ${
                  data.especialidad === opt.id
                    ? "border-[#EA580C] bg-[#FFD6B0] text-[#4A2500]"
                    : "border-[#E5DFD2] bg-[#F5F1E6] text-[#2C2621]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <span className="block text-[11px] font-semibold text-[#6B6860]">
            Tipo de actuación
          </span>
          <div className="grid grid-cols-2 gap-1.5">
            {TIPO_ACTUACION_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                data-testid={`acta-tipo-${opt.value}`}
                onClick={() =>
                  onChangeData((prev) => ({ ...prev, tipo_actuacion: opt.value }))
                }
                className={`min-h-[42px] rounded-xl border px-2.5 text-[11px] font-semibold cursor-pointer ${
                  data.tipo_actuacion === opt.value
                    ? "border-[#4B7094] bg-[#4B7094] text-[#FFFDF9]"
                    : "border-[#E5DFD2] bg-[#F5F1E6] text-[#2C2621]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <label className="block space-y-1">
          <span className="block text-[11px] font-semibold text-[#6B6860]">
            Fecha de emisión
          </span>
          <input
            type="date"
            data-testid="acta-fecha-emision-input"
            value={data.fecha_emision}
            onChange={(e) => {
              if (e.target.value) {
                onChangeData((prev) => ({ ...prev, fecha_emision: e.target.value }));
              }
            }}
            className="min-h-[44px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 font-mono-nums text-xs text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
          />
        </label>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-[#6B6860]">
              Alcance y ubicación exacta en obra
            </span>
          </div>
          <ZoomableTextField
            zoomLabel="Alcance y ubicación exacta"
            data-testid="acta-alcance-input"
            rows={2}
            maxLength={TEXT_LIMITS.DESCRIPTION}
            placeholder="Ej. Reforma parcial de baño principal y cuadro eléctrico en Vivienda 3º 2ª"
            value={data.alcance_ubicacion}
            onValueChange={(next) =>
              onChangeData((prev) => ({ ...prev, alcance_ubicacion: next }))
            }
            className="w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
          />
          <InlineVoiceFormTrigger
            voiceAdapter={voiceAdapter}
            registerBackHandler={registerBackHandler}
            title="Dictar alcance y ubicación"
            placeholder="Describe la zona y alcance de la instalación..."
            examples={[
              "Reforma integral de fontanería y cuadro eléctrico en vivienda 3º 2ª",
              "Sustitución de cuadro general de protección y circuito de cocina",
            ]}
            buttonLabel="Dictar alcance"
            testId="acta-voice-alcance"
            onTranscript={(text) =>
              onChangeData((prev) => ({
                ...prev,
                alcance_ubicacion: prev.alcance_ubicacion.trim()
                  ? `${prev.alcance_ubicacion.trim()} ${text.trim()}`
                  : text.trim(),
              }))
            }
          />
        </div>
      </CollapsibleBlockCard>

      {/* Bloque 2: Intervinientes (Instalador + Cliente con creación inline) */}
      <CollapsibleBlockCard
        index={2}
        title="Intervinientes (Instalador y Cliente)"
        subtitle={
          data.cliente.nombre_razon_social
            ? `${data.instalador.nombre_razon_social || "Instalador sin completar"} → ${data.cliente.nombre_razon_social}`
            : "Completa instalador y titular de la instalación"
        }
        completed={blockStates[1] ?? false}
        expanded={Boolean(openBlocks[2])}
        onToggle={() => toggleBlock(2)}
        testId="acta-block-2"
      >
        {/* Sub-bloque Instalador */}
        <div className="rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-bold text-[#2C2621]">
              Empresa / Profesional Instalador
            </span>
            {installerProfileAlreadySaved && (
              <span className="paper-stamp status-emerald rounded-full px-2.5 py-0.5 text-[10px] font-bold">
                Ficha habitual cargada
              </span>
            )}
          </div>

          {!installerProfileAlreadySaved && (
            <div
              data-testid="acta-inline-installer-banner"
              className="postit-note postit-yellow border border-[#D97706]/30 p-2.5 text-[11px] font-semibold text-[#3E3300]"
            >
              Aún no tienes tu ficha de instalador guardada. Rellénala aquí mismo y guárdala para que las próximas actas salgan autorrellenadas.
            </div>
          )}

          <input
            type="text"
            data-testid="acta-installer-name-input"
            placeholder="Nombre o razón social *"
            value={data.instalador.nombre_razon_social}
            onChange={(e) =>
              onChangeData((prev) => ({
                ...prev,
                instalador: { ...prev.instalador, nombre_razon_social: e.target.value },
              }))
            }
            className="min-h-[42px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
          />

          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              data-testid="acta-installer-nif-input"
              placeholder="NIF / CIF *"
              value={data.instalador.nif_cif}
              onChange={(e) =>
                onChangeData((prev) => ({
                  ...prev,
                  instalador: { ...prev.instalador, nif_cif: e.target.value.toUpperCase() },
                }))
              }
              className="min-h-[42px] rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 font-mono-nums text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
            />
            <input
              type="tel"
              placeholder="Teléfono"
              value={data.instalador.telefono}
              onChange={(e) =>
                onChangeData((prev) => ({
                  ...prev,
                  instalador: { ...prev.instalador, telefono: e.target.value },
                }))
              }
              className="min-h-[42px] rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 font-mono-nums text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
            />
          </div>

          <input
            type="text"
            placeholder="Domicilio fiscal"
            value={data.instalador.domicilio_fiscal}
            onChange={(e) =>
              onChangeData((prev) => ({
                ...prev,
                instalador: { ...prev.instalador, domicilio_fiscal: e.target.value },
              }))
            }
            className="min-h-[42px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
          />

          <div className="grid grid-cols-2 gap-2">
            <input
              type="email"
              placeholder="Email profesional"
              value={data.instalador.email}
              onChange={(e) =>
                onChangeData((prev) => ({
                  ...prev,
                  instalador: { ...prev.instalador, email: e.target.value },
                }))
              }
              className="min-h-[42px] rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
            />
            <input
              type="text"
              data-testid="acta-installer-reg-input"
              placeholder="Nº Registro (REIE/RII)"
              value={data.instalador.num_registro_empresa ?? ""}
              onChange={(e) =>
                onChangeData((prev) => ({
                  ...prev,
                  instalador: { ...prev.instalador, num_registro_empresa: e.target.value },
                }))
              }
              className="min-h-[42px] rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 font-mono-nums text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              data-testid="acta-installer-tech-name-input"
              placeholder="Técnico responsable *"
              value={data.instalador.tecnico_nombre}
              onChange={(e) =>
                onChangeData((prev) => ({
                  ...prev,
                  instalador: { ...prev.instalador, tecnico_nombre: e.target.value },
                }))
              }
              className="min-h-[42px] rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
            />
            <input
              type="text"
              data-testid="acta-installer-tech-dni-input"
              placeholder="DNI técnico *"
              value={data.instalador.tecnico_dni}
              onChange={(e) =>
                onChangeData((prev) => ({
                  ...prev,
                  instalador: { ...prev.instalador, tecnico_dni: e.target.value.toUpperCase() },
                }))
              }
              className="min-h-[42px] rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 font-mono-nums text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
            />
          </div>

          <input
            type="text"
            placeholder="Nº carné instalador autorizado (opcional)"
            value={data.instalador.num_carne_instalador ?? ""}
            onChange={(e) =>
              onChangeData((prev) => ({
                ...prev,
                instalador: { ...prev.instalador, num_carne_instalador: e.target.value },
              }))
            }
            className="min-h-[42px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 font-mono-nums text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
          />

          {installerErr && (
            <div role="alert" className="rounded-xl border border-[#DC2626]/30 bg-[#FAD2D8] px-3 py-2 text-[11px] font-semibold text-[#5A121C]">
              {installerErr}
            </div>
          )}
          {installerMsg && (
            <div className="flex items-center gap-1.5 rounded-xl status-emerald px-3 py-2 text-[11px] font-semibold">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              <span>{installerMsg}</span>
            </div>
          )}

          <button
            type="button"
            data-testid="acta-save-installer-profile-btn"
            disabled={savingInstallerProfile}
            onClick={() => void handleSaveInstallerAsDefault()}
            className="inline-flex min-h-[42px] w-full items-center justify-center gap-1.5 rounded-xl border border-[#4B7094]/30 bg-[#FFFDF7] px-3 text-[12px] font-bold text-[#2C2621] hover:border-[#EA580C] disabled:opacity-50 cursor-pointer"
          >
            <Save className="h-3.5 w-3.5 shrink-0" />
            <span>
              {savingInstallerProfile
                ? "Guardando ficha..."
                : installerProfileAlreadySaved
                  ? "Actualizar mi ficha habitual de instalador"
                  : "Guardar también como mi ficha habitual de instalador"}
            </span>
          </button>
        </div>

        {/* Sub-bloque Cliente */}
        <div className="rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-bold text-[#2C2621]">
              Titular / Cliente de la instalación
            </span>
            {linkedClientId && (
              <span className="paper-stamp status-emerald rounded-full px-2.5 py-0.5 text-[10px] font-bold">
                Vinculado a cliente
              </span>
            )}
          </div>

          {!linkedClientId && (
            <div
              data-testid="acta-inline-client-bar"
              className="rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] p-2.5 space-y-2"
            >
              <label className="block space-y-1">
                <span className="block text-[11px] font-semibold text-[#6B6860]">
                  Seleccionar cliente existente o rellenar datos abajo para crearlo
                </span>
                <select
                  data-testid="acta-select-existing-client"
                  value=""
                  onChange={(e) => {
                    const chosen = allClients.find((c) => c.id === e.target.value);
                    if (!chosen) return;
                    onLinkClient(chosen.id, {
                      nombre_razon_social: chosen.name,
                      nif_cif: chosen.nif,
                      direccion_emplazamiento:
                        data.cliente.direccion_emplazamiento.trim() || chosen.fiscal_address,
                      telefono: chosen.phone || undefined,
                      email: chosen.email || undefined,
                    });
                  }}
                  className="min-h-[40px] w-full rounded-lg border border-[#E5DFD2] bg-[#F5F1E6] px-2.5 text-xs text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
                >
                  <option value="">Elegir cliente del directorio...</option>
                  {allClients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.nif ? ` (${c.nif})` : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <input
            type="text"
            data-testid="acta-client-name-input"
            placeholder="Nombre o razón social del titular *"
            value={data.cliente.nombre_razon_social}
            onChange={(e) =>
              onChangeData((prev) => ({
                ...prev,
                cliente: { ...prev.cliente, nombre_razon_social: e.target.value },
              }))
            }
            className="min-h-[42px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
          />

          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              data-testid="acta-client-nif-input"
              placeholder="NIF / CIF titular"
              value={data.cliente.nif_cif}
              onChange={(e) =>
                onChangeData((prev) => ({
                  ...prev,
                  cliente: { ...prev.cliente, nif_cif: e.target.value.toUpperCase() },
                }))
              }
              className="min-h-[42px] rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 font-mono-nums text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
            />
            <input
              type="tel"
              placeholder="Teléfono"
              value={data.cliente.telefono ?? ""}
              onChange={(e) =>
                onChangeData((prev) => ({
                  ...prev,
                  cliente: { ...prev.cliente, telefono: e.target.value || undefined },
                }))
              }
              className="min-h-[42px] rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 font-mono-nums text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
            />
          </div>

          <input
            type="text"
            data-testid="acta-client-address-input"
            placeholder="Dirección del emplazamiento de la obra *"
            value={data.cliente.direccion_emplazamiento}
            onChange={(e) =>
              onChangeData((prev) => ({
                ...prev,
                cliente: { ...prev.cliente, direccion_emplazamiento: e.target.value },
              }))
            }
            className="min-h-[42px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
          />

          <input
            type="email"
            placeholder="Email del cliente (opcional)"
            value={data.cliente.email ?? ""}
            onChange={(e) =>
              onChangeData((prev) => ({
                ...prev,
                cliente: { ...prev.cliente, email: e.target.value || undefined },
              }))
            }
            className="min-h-[42px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
          />

          {clientErr && (
            <div role="alert" className="rounded-xl border border-[#DC2626]/30 bg-[#FAD2D8] px-3 py-2 text-[11px] font-semibold text-[#5A121C]">
              {clientErr}
            </div>
          )}
          {clientMsg && (
            <div className="flex items-center gap-1.5 rounded-xl status-emerald px-3 py-2 text-[11px] font-semibold">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              <span>{clientMsg}</span>
            </div>
          )}

          {!linkedClientId && (
            <button
              type="button"
              data-testid="acta-create-inline-client-btn"
              disabled={savingInlineClient}
              onClick={() => void handleCreateInlineClient()}
              className="inline-flex min-h-[42px] w-full items-center justify-center gap-1.5 rounded-xl bg-[#4B7094] px-3 text-[12px] font-bold text-[#FFFDF9] disabled:opacity-50 cursor-pointer"
            >
              <UserPlus className="h-3.5 w-3.5 shrink-0" />
              <span>
                {savingInlineClient ? "Guardando cliente..." : "Crear y guardar en mi directorio de clientes"}
              </span>
            </button>
          )}
        </div>
      </CollapsibleBlockCard>

      {/* Bloque 3: Memoria Descriptiva Técnica */}
      <CollapsibleBlockCard
        index={3}
        title="Memoria descriptiva técnica"
        subtitle={
          needsElec && needsFont
            ? "Electricidad + Fontanería / ACS"
            : needsElec
              ? `${memElec.tension_nominal} · ${memElec.circuitos.length} circuitos`
              : `${memFont.material_tuberias || "Fontanería"}`
        }
        completed={blockStates[2] ?? false}
        expanded={Boolean(openBlocks[3])}
        onToggle={() => toggleBlock(3)}
        testId="acta-block-3"
      >
        {needsElec && (
          <div className="ruled-notebook space-y-3 rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] p-3">
            <div className="text-[12px] font-bold text-[#2C2621]">Instalación Eléctrica</div>

            <div className="grid grid-cols-2 gap-1.5">
              {(["230V Monofásica", "400V Trifásica"] as const).map((tens) => (
                <button
                  key={tens}
                  type="button"
                  onClick={() => updateMemElec({ tension_nominal: tens })}
                  className={`min-h-[42px] rounded-xl border text-[12px] font-bold cursor-pointer ${
                    memElec.tension_nominal === tens
                      ? "border-[#EA580C] bg-[#FFD6B0] text-[#4A2500]"
                      : "border-[#E5DFD2] bg-[#F5F1E6] text-[#2C2621]"
                  }`}
                >
                  {tens}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <UnitNumberInput
                label="Calibre IGA"
                unit="A"
                value={memElec.iga_amperios}
                onChange={(v) => updateMemElec({ iga_amperios: v ?? 0 })}
                testId="acta-iga-input"
              />
              <label className="space-y-1">
                <span className="block text-[11px] font-semibold text-[#6B6860]">
                  Diferencial (calibre)
                </span>
                <input
                  type="text"
                  value={memElec.diferencial_calibre}
                  onChange={(e) => updateMemElec({ diferencial_calibre: e.target.value })}
                  placeholder="40A / 30mA Clase A"
                  className="min-h-[44px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 font-mono-nums text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
                />
              </label>
            </div>

            <YesNoToggle
              label="Protector contra sobretensiones"
              value={memElec.protector_sobretensiones}
              onChange={(next) => updateMemElec({ protector_sobretensiones: next })}
              testId="acta-sobretensiones"
            />

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-[#6B6860]">
                  Circuitos del cuadro (<span className="font-mono-nums">{memElec.circuitos.length}</span>)
                </span>
                <button
                  type="button"
                  data-testid="acta-add-circuit-btn"
                  onClick={() =>
                    updateMemElec({
                      circuitos: [
                        ...memElec.circuitos,
                        {
                          nombre: `C${memElec.circuitos.length + 1} Circuito`,
                          calibre_a: 16,
                          seccion_mm2: 2.5,
                        },
                      ],
                    })
                  }
                  className="inline-flex min-h-[34px] items-center gap-1 rounded-lg bg-[#4B7094] px-2.5 text-[11px] font-bold text-[#FFFDF9] cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Añadir circuito</span>
                </button>
              </div>

              <div className="flex flex-wrap gap-1">
                {CIRCUIT_PRESETS.map((preset) => (
                  <button
                    key={preset.nombre}
                    type="button"
                    onClick={() =>
                      updateMemElec({ circuitos: [...memElec.circuitos, { ...preset }] })
                    }
                    className="rounded-full border border-[#E5DFD2] bg-[#F5F1E6] px-2.5 py-1 text-[10px] font-semibold text-[#2C2621] hover:border-[#EA580C] cursor-pointer"
                  >
                    + {preset.nombre} (<span className="font-mono-nums">{preset.calibre_a}A / {preset.seccion_mm2}mm²</span>)
                  </button>
                ))}
              </div>

              {memElec.circuitos.map((circ, idx) => (
                <div
                  key={`circ-${idx}`}
                  className="grid grid-cols-12 gap-1.5 rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] p-2"
                >
                  <input
                    type="text"
                    placeholder="Nombre circuito"
                    value={circ.nombre}
                    onChange={(e) => {
                      const next = [...memElec.circuitos];
                      next[idx] = { ...circ, nombre: e.target.value };
                      updateMemElec({ circuitos: next });
                    }}
                    className="col-span-5 min-h-[38px] rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] px-2 text-[11px] text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
                  />
                  <input
                    type="number"
                    min="0"
                    placeholder="A"
                    value={circ.calibre_a}
                    onChange={(e) => {
                      const next = [...memElec.circuitos];
                      next[idx] = {
                        ...circ,
                        calibre_a: Number.parseFloat(e.target.value) || 0,
                      };
                      updateMemElec({ circuitos: next });
                    }}
                    className="col-span-3 min-h-[38px] rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] px-2 font-mono-nums text-[11px] text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
                  />
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    placeholder="mm²"
                    value={circ.seccion_mm2}
                    onChange={(e) => {
                      const next = [...memElec.circuitos];
                      next[idx] = {
                        ...circ,
                        seccion_mm2: Number.parseFloat(e.target.value) || 0,
                      };
                      updateMemElec({ circuitos: next });
                    }}
                    className="col-span-3 min-h-[38px] rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] px-2 font-mono-nums text-[11px] text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
                  />
                  <button
                    type="button"
                    aria-label="Eliminar circuito"
                    onClick={() =>
                      updateMemElec({
                        circuitos: memElec.circuitos.filter((_, i) => i !== idx),
                      })
                    }
                    className="col-span-1 flex items-center justify-center rounded-lg text-[#DC2626] hover:bg-[#FAD2D8] cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              <span className="block text-[11px] font-semibold text-[#6B6860]">
                Receptores y equipos conectados
              </span>
              <ZoomableTextField
                zoomLabel="Receptores conectados"
                rows={2}
                maxLength={TEXT_LIMITS.DESCRIPTION}
                placeholder="Ej. Alumbrado LED, tomas de cocina, termo eléctrico, aire acondicionado..."
                value={memElec.receptores_conectados}
                onValueChange={(next) => updateMemElec({ receptores_conectados: next })}
                className="w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
              />
              <InlineVoiceFormTrigger
                voiceAdapter={voiceAdapter}
                registerBackHandler={registerBackHandler}
                title="Dictar receptores conectados"
                placeholder="Enumera los equipos o receptores conectados..."
                examples={["Alumbrado LED, placa de inducción, horno, termo 80L y tomas de baño"]}
                buttonLabel="Dictar receptores"
                testId="acta-voice-receptores"
                onTranscript={(text) =>
                  updateMemElec({
                    receptores_conectados: memElec.receptores_conectados.trim()
                      ? `${memElec.receptores_conectados.trim()}, ${text.trim()}`
                      : text.trim(),
                  })
                }
              />
            </div>
          </div>
        )}

        {needsFont && (
          <div className="ruled-notebook space-y-3 rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] p-3">
            <div className="text-[12px] font-bold text-[#2C2621]">
              Instalación de Fontanería y ACS
            </div>

            <div className="space-y-1">
              <span className="block text-[11px] font-semibold text-[#6B6860]">
                Redes intervenidas
              </span>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {REDES_FONTANERIA.map((red) => {
                  const active = memFont.redes_intervenidas.includes(red);
                  return (
                    <button
                      key={red}
                      type="button"
                      onClick={() => {
                        const next = active
                          ? memFont.redes_intervenidas.filter((r) => r !== red)
                          : [...memFont.redes_intervenidas, red];
                        updateMemFont({ redes_intervenidas: next });
                      }}
                      className={`min-h-[40px] rounded-xl border text-[12px] font-bold cursor-pointer ${
                        active
                          ? "border-[#EA580C] bg-[#FFD6B0] text-[#4A2500]"
                          : "border-[#E5DFD2] bg-[#F5F1E6] text-[#2C2621]"
                      }`}
                    >
                      {red}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="block text-[11px] font-semibold text-[#6B6860]">
                Material de tuberías
              </span>
              <div className="flex flex-wrap gap-1">
                {MATERIAL_CHIPS.map((mat) => (
                  <button
                    key={mat}
                    type="button"
                    onClick={() => updateMemFont({ material_tuberias: mat })}
                    className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold cursor-pointer ${
                      memFont.material_tuberias === mat
                        ? "border-[#4B7094] bg-[#4B7094] text-[#FFFDF9]"
                        : "border-[#E5DFD2] bg-[#F5F1E6] text-[#2C2621]"
                    }`}
                  >
                    {mat}
                  </button>
                ))}
              </div>
              <input
                type="text"
                data-testid="acta-material-tuberias-input"
                placeholder="Ej. Multicapa PEX-Al-PEX / Cobre"
                value={memFont.material_tuberias}
                onChange={(e) => updateMemFont({ material_tuberias: e.target.value })}
                className="min-h-[42px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
              />
            </div>

            <input
              type="text"
              placeholder="Diámetros instalados (ej. 20mm montante, 16mm derivaciones)"
              value={memFont.diametros_mm}
              onChange={(e) => updateMemFont({ diametros_mm: e.target.value })}
              className="min-h-[42px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
            />

            <input
              type="text"
              placeholder="Ubicación de llaves de corte (ej. Falso techo baño y cocina)"
              value={memFont.ubicacion_llaves_corte}
              onChange={(e) => updateMemFont({ ubicacion_llaves_corte: e.target.value })}
              className="min-h-[42px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
            />

            <div className="space-y-1.5">
              <span className="block text-[11px] font-semibold text-[#6B6860]">
                Equipos sanitarios y aparataje instalado
              </span>
              <ZoomableTextField
                zoomLabel="Equipos sanitarios"
                rows={2}
                maxLength={TEXT_LIMITS.DESCRIPTION}
                placeholder="Ej. Termo eléctrico 80L, plato de ducha, lavabo, inodoro, grifería..."
                value={memFont.equipos_sanitarios}
                onValueChange={(next) => updateMemFont({ equipos_sanitarios: next })}
                className="w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
              />
              <InlineVoiceFormTrigger
                voiceAdapter={voiceAdapter}
                registerBackHandler={registerBackHandler}
                title="Dictar equipos sanitarios"
                placeholder="Describe los equipos instalados..."
                examples={["Termo eléctrico 80 litros, plato de ducha termostático, inodoro y lavabo"]}
                buttonLabel="Dictar equipos"
                testId="acta-voice-equipos"
                onTranscript={(text) =>
                  updateMemFont({
                    equipos_sanitarios: memFont.equipos_sanitarios.trim()
                      ? `${memFont.equipos_sanitarios.trim()}, ${text.trim()}`
                      : text.trim(),
                  })
                }
              />
            </div>
          </div>
        )}
      </CollapsibleBlockCard>

      {/* Bloque 4: Protocolo de Verificación y Pruebas en Obra */}
      <CollapsibleBlockCard
        index={4}
        title="Protocolo de verificación y pruebas en obra"
        subtitle="Mediciones reglamentarias y dictamen APTO"
        completed={blockStates[3] ?? false}
        expanded={Boolean(openBlocks[4])}
        onToggle={() => toggleBlock(4)}
        testId="acta-block-4"
      >
        {needsElec && (
          <div className="space-y-2.5 rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] p-3">
            <div className="text-[12px] font-bold text-[#2C2621]">Pruebas Eléctricas</div>
            <YesNoToggle
              label="Inspección visual de bornes y etiquetado"
              value={pruElec.inspeccion_visual_bornes_etiquetado}
              onChange={(v) => updatePruElec({ inspeccion_visual_bornes_etiquetado: v })}
            />
            <YesNoToggle
              label="Continuidad de protección y equipotencial"
              value={pruElec.continuidad_proteccion_equipotencial}
              onChange={(v) => updatePruElec({ continuidad_proteccion_equipotencial: v })}
            />
            <div className="grid grid-cols-2 gap-2">
              <UnitNumberInput
                label="Resistencia aislamiento"
                unit="MΩ"
                value={pruElec.resistencia_aislamiento_mohm}
                onChange={(v) => updatePruElec({ resistencia_aislamiento_mohm: v })}
                testId="acta-aislamiento-input"
              />
              <UnitNumberInput
                label="Resistencia de tierra"
                unit="Ω"
                value={pruElec.resistencia_tierra_ohm}
                onChange={(v) => updatePruElec({ resistencia_tierra_ohm: v })}
                testId="acta-tierra-input"
              />
              <UnitNumberInput
                label="Disparo diferencial"
                unit="ms"
                value={pruElec.disparo_diferencial_ms}
                onChange={(v) => updatePruElec({ disparo_diferencial_ms: v })}
                testId="acta-disparo-input"
              />
              <UnitNumberInput
                label="Tensión comprobada"
                unit="V"
                value={pruElec.tension_comprobada_v}
                onChange={(v) => updatePruElec({ tension_comprobada_v: v })}
                testId="acta-tension-comprobada-input"
              />
            </div>
            <YesNoToggle
              label="Dictamen verificación eléctrica: APTO"
              value={pruElec.resultado_apto}
              onChange={(v) => updatePruElec({ resultado_apto: v })}
            />
          </div>
        )}

        {needsFont && (
          <div className="space-y-2.5 rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] p-3">
            <div className="text-[12px] font-bold text-[#2C2621]">
              Pruebas de Estanqueidad y Fontanería
            </div>
            <div className="grid grid-cols-2 gap-2">
              <UnitNumberInput
                label="Presión de prueba"
                unit="bar"
                value={pruFont.presion_prueba_bar}
                onChange={(v) => updatePruFont({ presion_prueba_bar: v })}
                testId="acta-presion-prueba-input"
              />
              <UnitNumberInput
                label="Duración prueba"
                unit="min"
                step="1"
                value={pruFont.duracion_prueba_min}
                onChange={(v) => updatePruFont({ duracion_prueba_min: v })}
                testId="acta-duracion-prueba-input"
              />
              <UnitNumberInput
                label="Presión de servicio"
                unit="bar"
                value={pruFont.presion_servicio_bar}
                onChange={(v) => updatePruFont({ presion_servicio_bar: v })}
              />
              <UnitNumberInput
                label="Consigna ACS"
                unit="°C"
                step="1"
                value={pruFont.temperatura_consigna_acs_c}
                onChange={(v) => updatePruFont({ temperatura_consigna_acs_c: v })}
              />
            </div>
            <YesNoToggle
              label="Estanqueidad comprobada sin fugas"
              value={pruFont.estanqueidad_sin_fugas}
              onChange={(v) => updatePruFont({ estanqueidad_sin_fugas: v })}
            />
            <YesNoToggle
              label="Comprobación de desagües y válvulas"
              value={pruFont.comprobacion_desagues_valvulas}
              onChange={(v) => updatePruFont({ comprobacion_desagues_valvulas: v })}
            />
            <YesNoToggle
              label="Dictamen verificación fontanería: APTO"
              value={pruFont.resultado_apto}
              onChange={(v) => updatePruFont({ resultado_apto: v })}
            />
          </div>
        )}
      </CollapsibleBlockCard>

      {/* Bloque 5: Anexo Fotográfico */}
      <CollapsibleBlockCard
        index={5}
        title="Anexo fotográfico (2 a 4 fotos)"
        subtitle={`${data.fotos.length}/4 fotos adjuntas`}
        completed={blockStates[4] ?? false}
        expanded={Boolean(openBlocks[5])}
        onToggle={() => toggleBlock(5)}
        testId="acta-block-5"
      >
        <ActaPhotosSection
          actaId={actaId}
          jobId={jobId}
          fotos={data.fotos}
          fileBridge={fileBridge}
          cameraAdapter={cameraAdapter}
          onChangeFotos={(nextFotos) =>
            onChangeData((prev) => ({ ...prev, fotos: nextFotos }))
          }
        />
      </CollapsibleBlockCard>

      {/* Bloque 6: Textos Legales, Mantenimiento y Garantía */}
      <CollapsibleBlockCard
        index={6}
        title="Textos legales, mantenimiento y garantía"
        subtitle={`Garantía: ${data.plazo_garantia_meses} meses`}
        completed={blockStates[5] ?? false}
        expanded={Boolean(openBlocks[6])}
        onToggle={() => toggleBlock(6)}
        testId="acta-block-6"
      >
        <div className="rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] p-2.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-[#6B6860]">
              Plazo de garantía (meses)
            </span>
            <div className="flex gap-1">
              {[12, 24, 36].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() =>
                    onChangeData((prev) => ({
                      ...prev,
                      plazo_garantia_meses: m,
                      clausula_recepcion_cliente: isDefaultRecepcionText(
                        prev.clausula_recepcion_cliente
                      )
                        ? buildActaRecepcionTemplate(m)
                        : prev.clausula_recepcion_cliente,
                    }))
                  }
                  className={`rounded-lg px-2.5 py-1 font-mono-nums text-[11px] font-bold cursor-pointer ${
                    data.plazo_garantia_meses === m
                      ? "bg-[#4B7094] text-[#FFFDF9]"
                      : "border border-[#E5DFD2] bg-[#FFFDF7] text-[#2C2621]"
                  }`}
                >
                  {m}m
                </button>
              ))}
            </div>
          </div>
          <UnitNumberInput
            label="Meses personalizados"
            unit="meses"
            step="1"
            value={data.plazo_garantia_meses}
            onChange={(v) => {
              const safe = Math.max(1, Math.min(120, Math.round(v ?? 24)));
              onChangeData((prev) => ({
                ...prev,
                plazo_garantia_meses: safe,
                clausula_recepcion_cliente: isDefaultRecepcionText(
                  prev.clausula_recepcion_cliente
                )
                  ? buildActaRecepcionTemplate(safe)
                  : prev.clausula_recepcion_cliente,
              }));
            }}
          />
        </div>

        <label className="block space-y-1">
          <span className="block text-[11px] font-semibold text-[#6B6860]">
            Instrucciones básicas de uso y mantenimiento
          </span>
          <ZoomableTextField
            zoomLabel="Instrucciones de mantenimiento"
            rows={3}
            maxLength={TEXT_LIMITS.NOTES}
            value={data.instrucciones_mantenimiento}
            onValueChange={(next) =>
              onChangeData((prev) => ({ ...prev, instrucciones_mantenimiento: next }))
            }
            className="w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 text-xs text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
          />
        </label>

        <label className="block space-y-1">
          <span className="block text-[11px] font-semibold text-[#6B6860]">
            Declaración de conformidad (REBT / CTE)
          </span>
          <ZoomableTextField
            zoomLabel="Declaración de conformidad"
            rows={3}
            maxLength={TEXT_LIMITS.NOTES}
            value={data.clausula_conformidad}
            onValueChange={(next) =>
              onChangeData((prev) => ({ ...prev, clausula_conformidad: next }))
            }
            className="w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 text-xs text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
          />
        </label>

        <label className="block space-y-1">
          <span className="block text-[11px] font-semibold text-[#6B6860]">
            Cláusula de recepción y garantía
          </span>
          <ZoomableTextField
            zoomLabel="Recepción y garantía"
            rows={3}
            maxLength={TEXT_LIMITS.NOTES}
            value={data.clausula_recepcion_cliente}
            onValueChange={(next) =>
              onChangeData((prev) => ({ ...prev, clausula_recepcion_cliente: next }))
            }
            className="w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 text-xs text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
          />
        </label>

        <button
          type="button"
          onClick={() =>
            onChangeData((prev) => ({
              ...prev,
              instrucciones_mantenimiento: getActaMantenimientoTemplate(prev.especialidad),
              clausula_conformidad: ACTA_CONFORMIDAD_TEMPLATE,
              clausula_recepcion_cliente: buildActaRecepcionTemplate(prev.plazo_garantia_meses),
            }))
          }
          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] px-3 text-[11px] font-semibold text-[#6B6860] cursor-pointer"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span>Restaurar plantillas oficiales</span>
        </button>
      </CollapsibleBlockCard>

      {/* Bloque 7: Firmas y Cierre PDF */}
      <CollapsibleBlockCard
        index={7}
        title="Firmas y cierre del acta"
        subtitle={
          estado === "firmada"
            ? "Acta firmada"
            : firmaClienteBase64
              ? "Firma del cliente lista para generar PDF"
              : "Pendiente de firma táctil del cliente"
        }
        completed={blockStates[6] ?? false}
        expanded={Boolean(openBlocks[7])}
        onToggle={() => toggleBlock(7)}
        testId="acta-block-7"
      >
        {estado !== "firmada" && (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onChangeEstado("borrador")}
              className={`min-h-[42px] rounded-xl border text-[12px] font-bold cursor-pointer ${
                estado === "borrador"
                  ? "border-[#EA580C] bg-[#FFD6B0] text-[#4A2500]"
                  : "border-[#E5DFD2] bg-[#F5F1E6] text-[#2C2621]"
              }`}
            >
              En borrador
            </button>
            <button
              type="button"
              onClick={() => onChangeEstado("completada")}
              className={`min-h-[42px] rounded-xl border text-[12px] font-bold cursor-pointer ${
                estado === "completada"
                  ? "border-[#4B7094] bg-[#4B7094] text-[#FFFDF9]"
                  : "border-[#E5DFD2] bg-[#F5F1E6] text-[#2C2621]"
              }`}
            >
              Marcar completada
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <div className="rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold text-[#2C2621]">
                Firma del instalador
              </span>
              {firmaInstaladorBase64 && (
                <span className="paper-stamp status-emerald rounded-full px-2.5 py-0.5 text-[10px] font-bold">
                  Lista
                </span>
              )}
            </div>
            {firmaInstaladorBase64 && (
              <img
                src={firmaInstaladorBase64}
                alt="Firma del instalador"
                className="h-20 w-full rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] p-1 object-contain"
              />
            )}
            <button
              type="button"
              data-testid="acta-open-installer-signature-btn"
              onClick={onOpenInstallerSignature}
              className="inline-flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 text-[12px] font-semibold text-[#2C2621] cursor-pointer"
            >
              <PenTool className="h-3.5 w-3.5" />
              <span>{firmaInstaladorBase64 ? "Cambiar firma instalador" : "Firmar instalador"}</span>
            </button>
          </div>

          <div className="rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold text-[#2C2621]">
                Firma del cliente *
              </span>
              {firmaClienteBase64 && (
                <button
                  type="button"
                  onClick={onClearClientSignature}
                  className="text-[10px] font-semibold text-[#DC2626] cursor-pointer"
                >
                  Borrar
                </button>
              )}
            </div>
            {firmaClienteBase64 && (
              <img
                src={firmaClienteBase64}
                alt="Firma del cliente"
                className="h-20 w-full rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] p-1 object-contain"
              />
            )}
            <button
              type="button"
              data-testid="acta-open-client-signature-btn"
              onClick={onOpenClientSignature}
              className="inline-flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-xl border border-[#EA580C]/40 bg-[#FFD6B0] px-3 text-[12px] font-bold text-[#4A2500] cursor-pointer"
            >
              <PenTool className="h-3.5 w-3.5" />
              <span>{firmaClienteBase64 ? "Repetir firma cliente" : "Recoger firma del cliente"}</span>
            </button>
          </div>
        </div>

        <button
          type="button"
          data-testid="acta-generate-share-pdf-btn"
          disabled={pdfBusy}
          onClick={() => void onGenerateAndSharePdf()}
          className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[#EA580C] hover:bg-[#D04B00] px-4 text-[13px] font-bold text-white shadow-sm disabled:opacity-50 cursor-pointer transition-colors"
        >
          <Share2 className="h-4 w-4 shrink-0" />
          <span>{pdfBusy ? "Generando PDF A4..." : "Generar y Compartir PDF"}</span>
        </button>
      </CollapsibleBlockCard>
    </div>
  );
}
