import { CheckCircle2, ChevronDown, ChevronUp, PenTool, Save, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { InstallerActaProfileInputSchema } from "../../core/contracts/schemas";
import { TEXT_LIMITS } from "../../core/contracts/textLimits";
import type { AppSettingsRecord, SqliteExecutor } from "../../core/contracts/types";
import { SettingsRepository } from "../../core/db/repositories/settingsRepo";
import { SignaturePadModal } from "../actas/SignaturePadModal";

interface InstallerActaSettingsCardProps {
  executor: SqliteExecutor;
  settings: AppSettingsRecord | null;
  activeAccountEmail?: string;
  registerBackHandler?: (priority: number, handler: () => boolean) => () => void;
  onSettingsUpdated: (updated: AppSettingsRecord) => Promise<void>;
}

export function InstallerActaSettingsCard({
  executor,
  settings,
  activeAccountEmail = "",
  registerBackHandler,
  onSettingsUpdated,
}: InstallerActaSettingsCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [signatureModalOpen, setSignatureModalOpen] = useState(false);
  const [emitterEmail, setEmitterEmail] = useState(settings?.emitter_email ?? "");
  const [registryNumber, setRegistryNumber] = useState(settings?.emitter_registry_number ?? "");
  const [techName, setTechName] = useState(settings?.emitter_tech_name ?? "");
  const [techDni, setTechDni] = useState(settings?.emitter_tech_dni ?? "");
  const [installerCard, setInstallerCard] = useState(settings?.emitter_installer_card ?? "");
  const [warrantyMonths, setWarrantyMonths] = useState<string>(
    String(settings?.default_acta_warranty_months ?? 24)
  );
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(
    settings?.emitter_signature_data_url ?? null
  );
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) return;
    setEmitterEmail(settings.emitter_email);
    setRegistryNumber(settings.emitter_registry_number);
    setTechName(settings.emitter_tech_name);
    setTechDni(settings.emitter_tech_dni);
    setInstallerCard(settings.emitter_installer_card);
    setWarrantyMonths(String(settings.default_acta_warranty_months));
    setSignatureDataUrl(settings.emitter_signature_data_url);
  }, [settings]);

  const handleSave = async () => {
    setErrorMsg(null);
    setSavedMsg(null);
    const parsedMonths = Number.parseInt(warrantyMonths, 10);
    const parsed = InstallerActaProfileInputSchema.safeParse({
      emitter_email: emitterEmail,
      emitter_registry_number: registryNumber,
      emitter_tech_name: techName,
      emitter_tech_dni: techDni,
      emitter_installer_card: installerCard,
      default_acta_warranty_months: Number.isFinite(parsedMonths) ? parsedMonths : 24,
      emitter_signature_data_url: signatureDataUrl,
    });

    if (!parsed.success) {
      setErrorMsg(parsed.error.issues[0]?.message ?? "Datos de instalador inválidos.");
      return;
    }

    setSaving(true);
    try {
      const updated = await new SettingsRepository(executor).updateInstallerActaProfile(parsed.data);
      await onSettingsUpdated(updated);
      setSavedMsg("Ficha técnica de instalador y actas guardada.");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const hasSavedProfile = Boolean(techName.trim() || registryNumber.trim() || techDni.trim());

  return (
    <div
      data-testid="installer-acta-settings-card"
      className="paper-sheet rounded-2xl border border-[#E5DFD2] bg-[#FFFDF7] p-3.5 space-y-3 font-sans"
    >
      <button
        type="button"
        data-testid="installer-acta-settings-toggle"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-start justify-between gap-2 text-left cursor-pointer"
      >
        <div className="min-w-0 flex-1">
          <h3 className="text-xs font-bold uppercase tracking-wide text-[#2C2621] flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-[#EA580C]" />
            <span>Datos de instalador y actas técnicas</span>
          </h3>
          <p className="mt-0.5 text-[11px] text-[#6B6860]">
            {hasSavedProfile
              ? `${techName || "Técnico sin nombre"}${registryNumber ? ` · Reg. ${registryNumber}` : ""} · Garantía ${warrantyMonths || "24"} meses`
              : "REIE/RII, técnico responsable, carné y garantía predeterminada para tus actas."}
          </p>
        </div>
        <span className="mt-0.5 text-[#6B6860]">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>

      {expanded && (
        <div className="space-y-2.5 pt-2 border-t border-[#E5DFD2]">
          <div className="space-y-1">
            <label
              htmlFor="installer-email"
              className="block text-[11px] font-bold text-[#2C2621]"
            >
              Correo electrónico profesional
            </label>
            <input
              id="installer-email"
              data-testid="installer-acta-email-input"
              type="email"
              maxLength={TEXT_LIMITS.EMAIL}
              placeholder={activeAccountEmail || "instalador@empresa.es"}
              value={emitterEmail}
              onChange={(e) => setEmitterEmail(e.target.value)}
              className="min-h-[42px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label
                htmlFor="installer-registry"
                className="block text-[11px] font-bold text-[#2C2621]"
              >
                Nº registro empresa (REIE / RII)
              </label>
              <input
                id="installer-registry"
                data-testid="installer-acta-registry-input"
                type="text"
                maxLength={TEXT_LIMITS.SHORT_LABEL}
                placeholder="Ej. REIE-28-04192"
                value={registryNumber}
                onChange={(e) => setRegistryNumber(e.target.value)}
                className="min-h-[42px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 font-mono tabular-nums text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="installer-card"
                className="block text-[11px] font-bold text-[#2C2621]"
              >
                Nº carné instalador
              </label>
              <input
                id="installer-card"
                data-testid="installer-acta-card-input"
                type="text"
                maxLength={TEXT_LIMITS.SHORT_LABEL}
                placeholder="Ej. CI-BT-11420"
                value={installerCard}
                onChange={(e) => setInstallerCard(e.target.value)}
                className="min-h-[42px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 font-mono tabular-nums text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label
                htmlFor="installer-tech-name"
                className="block text-[11px] font-bold text-[#2C2621]"
              >
                Técnico responsable
              </label>
              <input
                id="installer-tech-name"
                data-testid="installer-acta-tech-name-input"
                type="text"
                maxLength={TEXT_LIMITS.NAME}
                placeholder="Nombre y apellidos"
                value={techName}
                onChange={(e) => setTechName(e.target.value)}
                className="min-h-[42px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="installer-tech-dni"
                className="block text-[11px] font-bold text-[#2C2621]"
              >
                DNI / NIE técnico
              </label>
              <input
                id="installer-tech-dni"
                data-testid="installer-acta-tech-dni-input"
                type="text"
                maxLength={TEXT_LIMITS.TAX_ID}
                placeholder="Ej. 12345678Z"
                value={techDni}
                onChange={(e) => setTechDni(e.target.value.toUpperCase())}
                className="min-h-[42px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 font-mono tabular-nums text-xs text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none"
              />
            </div>
          </div>

          <div className="rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] p-2.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="installer-warranty-months"
                className="text-[11px] font-bold text-[#2C2621]"
              >
                Garantía por defecto (meses)
              </label>
              <div className="flex items-center gap-1">
                {[12, 24, 36].map((months) => (
                  <button
                    key={months}
                    type="button"
                    onClick={() => setWarrantyMonths(String(months))}
                    className={`rounded-lg px-2 py-1 font-mono-nums text-[11px] font-bold cursor-pointer ${
                      Number.parseInt(warrantyMonths, 10) === months
                        ? "bg-[#4B7094] text-[#FFFDF9]"
                        : "bg-[#FFFDF7] border border-[#E5DFD2] text-[#6B6860]"
                    }`}
                  >
                    {months}m
                  </button>
                ))}
              </div>
            </div>
            <input
              id="installer-warranty-months"
              data-testid="installer-acta-warranty-input"
              type="number"
              min="1"
              max="120"
              value={warrantyMonths}
              onChange={(e) => setWarrantyMonths(e.target.value)}
              className="min-h-[40px] w-full rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] px-2.5 py-1.5 font-mono-nums text-xs font-bold text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
            />
          </div>

          {signatureDataUrl ? (
            <div className="rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-[#2C2621]">
                  Firma habitual del instalador guardada
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSignatureModalOpen(true)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#4B7094] cursor-pointer"
                  >
                    <PenTool className="h-3 w-3" />
                    <span>Cambiar</span>
                  </button>
                  <button
                    type="button"
                    data-testid="installer-acta-clear-signature-btn"
                    onClick={() => setSignatureDataUrl(null)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#DC2626] cursor-pointer"
                  >
                    <Trash2 className="h-3 w-3" />
                    <span>Borrar firma</span>
                  </button>
                </div>
              </div>
              <img
                src={signatureDataUrl}
                alt="Firma habitual del instalador"
                className="max-h-16 rounded border border-[#E5DFD2] bg-[#FFFDF7] p-1 object-contain"
              />
            </div>
          ) : (
            <button
              type="button"
              data-testid="installer-acta-open-signature-btn"
              onClick={() => setSignatureModalOpen(true)}
              className="flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#E5DFD2] bg-[#F5F1E6] px-3 text-[11px] font-semibold text-[#2C2621] cursor-pointer"
            >
              <PenTool className="h-3.5 w-3.5" />
              <span>Dibujar firma habitual del instalador</span>
            </button>
          )}

          <SignaturePadModal
            open={signatureModalOpen}
            title="Firma habitual del instalador"
            subtitle="Se aplicará automáticamente en tus próximas actas de puesta en marcha."
            registerBackHandler={registerBackHandler}
            onClose={() => setSignatureModalOpen(false)}
            onConfirm={(dataUrl) => {
              setSignatureDataUrl(dataUrl);
              setSignatureModalOpen(false);
            }}
          />

          {errorMsg && (
            <div
              role="alert"
              className="rounded-xl border border-[#DC2626]/30 bg-[#FAD2D8] px-3 py-2 text-xs font-semibold text-[#5A121C]"
            >
              {errorMsg}
            </div>
          )}

          {savedMsg && (
            <div className="flex items-center gap-1.5 rounded-xl status-emerald px-3 py-2 text-xs font-semibold">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              <span>{savedMsg}</span>
            </div>
          )}

          <button
            type="button"
            data-testid="save-installer-acta-btn"
            disabled={saving}
            onClick={() => void handleSave()}
            className="min-h-[44px] w-full rounded-xl bg-[#4B7094] px-3 text-xs font-bold text-[#FFFDF9] flex items-center justify-center gap-1.5 disabled:opacity-45 cursor-pointer"
          >
            <Save className="h-3.5 w-3.5" />
            <span>{saving ? "Guardando..." : "Guardar ficha de instalador"}</span>
          </button>
        </div>
      )}
    </div>
  );
}
