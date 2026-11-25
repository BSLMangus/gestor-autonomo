import { Check, Mic, PenTool, Save, Send, Share2, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { LocalInferenceAdapterImpl } from "../../agent/inference/localInferenceAdapter";
import { InstallerActaProfileInputSchema } from "../../core/contracts/schemas";
import type {
  ActaPuestaEnMarchaData,
  AppSettingsRecord,
  LocalFileBridge,
  SqliteExecutor,
} from "../../core/contracts/types";
import { SettingsRepository } from "../../core/db/repositories/settingsRepo";
import type { CameraAdapter } from "../../core/hardware/cameraAdapter";
import type { VoiceInputAdapter } from "../../core/hardware/voiceAdapter";
import { BACK_PRIORITY } from "../../core/navigation/routes";
import { GlobalVoiceOverlay } from "../../ui/GlobalVoiceOverlay";
import {
  getStepExamples,
  getStepQuickChips,
  type GuidedStep,
} from "./actaDeterministicParser";
import {
  buildStepOpeningPrompt,
  ORDERED_GUIDED_STEPS,
  processActaGuidedTurn,
  resolveInitialGuidedStep,
  STEP_META,
} from "./actaGuidedOrchestrator";
import { ActaPhotosSection } from "./ActaPhotosSection";
import { isInstallerActaProfileComplete } from "./actaTemplates";

interface GuidedChatMessage {
  id: string;
  role: "assistant" | "user";
  content: string;
  appliedLabels?: string[];
}

interface ActaGuidedChatPanelProps {
  actaId: string;
  jobId: string | null;
  executor: SqliteExecutor;
  data: ActaPuestaEnMarchaData;
  appSettings: AppSettingsRecord | null;
  fileBridge: LocalFileBridge;
  cameraAdapter?: CameraAdapter;
  voiceAdapter?: VoiceInputAdapter;
  inferenceAdapter?: LocalInferenceAdapterImpl;
  firmaClienteBase64: string | null;
  firmaInstaladorBase64: string | null;
  pdfBusy: boolean;
  registerBackHandler?: (priority: number, handler: () => boolean) => () => void;
  onApplyData: (nextData: ActaPuestaEnMarchaData) => void;
  onSettingsUpdated: (settings: AppSettingsRecord) => void;
  onOpenClientSignature: () => void;
  onOpenInstallerSignature: () => void;
  onClearClientSignature: () => void;
  onGenerateAndSharePdf: () => Promise<void>;
  onSwitchToFreeMode: () => void;
}

export function ActaGuidedChatPanel({
  actaId,
  jobId,
  executor,
  data,
  appSettings,
  fileBridge,
  cameraAdapter,
  voiceAdapter,
  inferenceAdapter,
  firmaClienteBase64,
  firmaInstaladorBase64,
  pdfBusy,
  registerBackHandler,
  onApplyData,
  onSettingsUpdated,
  onOpenClientSignature,
  onOpenInstallerSignature,
  onClearClientSignature,
  onGenerateAndSharePdf,
  onSwitchToFreeMode,
}: ActaGuidedChatPanelProps) {
  const [step2Confirmed, setStep2Confirmed] = useState<boolean>(false);
  const [currentStep, setCurrentStep] = useState<GuidedStep>(() =>
    resolveInitialGuidedStep(data, false)
  );
  const [messages, setMessages] = useState<GuidedChatMessage[]>(() => {
    const initialStep = resolveInitialGuidedStep(data, false);
    return [
      {
        id: "guided_init",
        role: "assistant",
        content: buildStepOpeningPrompt(initialStep, data),
      },
    ];
  });
  const [inputText, setInputText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [savingInstaller, setSavingInstaller] = useState(false);
  const [installerSaveMsg, setInstallerSaveMsg] = useState<string | null>(null);
  const [installerSaveErr, setInstallerSaveErr] = useState<string | null>(null);

  const dataRef = useRef(data);
  const stepRef = useRef(currentStep);
  const step2ConfirmedRef = useRef(step2Confirmed);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  dataRef.current = data;
  stepRef.current = currentStep;
  step2ConfirmedRef.current = step2Confirmed;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, currentStep]);

  useEffect(() => {
    if (!voiceOpen || !registerBackHandler) return;
    return registerBackHandler(BACK_PRIORITY.CONTEXTUAL_VOICE, () => {
      void voiceAdapter?.stop?.();
      setVoiceOpen(false);
      return true;
    });
  }, [voiceOpen, registerBackHandler, voiceAdapter]);

  const submitTurn = async (rawText: string) => {
    const clean = rawText.trim();
    if (!clean || submitting) return;

    setSubmitting(true);
    setInputText("");
    const userMsg: GuidedChatMessage = {
      id: `usr_${crypto.randomUUID().slice(0, 8)}`,
      role: "user",
      content: clean,
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await processActaGuidedTurn({
        currentStep: stepRef.current,
        data: dataRef.current,
        userText: clean,
        inferenceAdapter,
        step2Confirmed: step2ConfirmedRef.current,
      });

      dataRef.current = res.nextData;
      stepRef.current = res.nextStep;
      step2ConfirmedRef.current = res.step2Confirmed;

      onApplyData(res.nextData);
      setStep2Confirmed(res.step2Confirmed);
      setCurrentStep(res.nextStep);

      setMessages((prev) => [
        ...prev,
        {
          id: `ast_${crypto.randomUUID().slice(0, 8)}`,
          role: "assistant",
          content: res.assistantReply,
          appliedLabels: res.appliedLabels,
        },
      ]);
    } finally {
      setSubmitting(false);
    }
  };

  const handleJumpStep = (targetStep: GuidedStep) => {
    if (submitting || targetStep === currentStep) return;
    setCurrentStep(targetStep);
    stepRef.current = targetStep;
    setMessages((prev) => [
      ...prev,
      {
        id: `jmp_${crypto.randomUUID().slice(0, 8)}`,
        role: "assistant",
        content: buildStepOpeningPrompt(targetStep, dataRef.current),
      },
    ]);
  };

  const handleSaveInstallerInline = async () => {
    setInstallerSaveErr(null);
    setInstallerSaveMsg(null);
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
      setInstallerSaveErr(
        parsed.error.issues[0]?.message ?? "Completa nombre, NIF y DNI técnico antes de guardar."
      );
      return;
    }
    setSavingInstaller(true);
    try {
      const updated = await new SettingsRepository(executor).updateInstallerActaProfile(parsed.data);
      onSettingsUpdated(updated);
      setInstallerSaveMsg("Ficha habitual de instalador guardada.");
    } catch (err) {
      setInstallerSaveErr(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingInstaller(false);
    }
  };

  const activeStepMeta = STEP_META[currentStep];
  const quickChips = getStepQuickChips(currentStep, data.especialidad);
  const stepExamples = getStepExamples(currentStep, data.especialidad);
  const installerSaved = appSettings ? isInstallerActaProfileComplete(appSettings) : false;

  return (
    <div
      data-testid="acta-guided-chat-panel"
      className="flex flex-1 flex-col min-h-0 bg-surface"
    >
      {/* Indicador visual de los 5 pasos */}
      <div className="shrink-0 border-b border-outline-variant bg-surface-container-lowest px-3 py-2.5 space-y-2">
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span
            data-testid="acta-guided-step-label"
            className="inline-flex items-center gap-1 font-bold text-on-surface"
          >
            <Sparkles className="h-3.5 w-3.5 text-terracotta shrink-0" />
            <span>
              Paso {activeStepMeta.index} de 5 · {activeStepMeta.label}
            </span>
          </span>
          <button
            type="button"
            onClick={onSwitchToFreeMode}
            className="font-semibold text-on-primary-container cursor-pointer"
          >
            Ver formulario completo
          </button>
        </div>

        <div className="grid grid-cols-5 gap-1">
          {ORDERED_GUIDED_STEPS.map((st) => {
            const meta = STEP_META[st];
            const isCurrent = st === currentStep;
            const isPast = meta.index < activeStepMeta.index;
            return (
              <button
                key={st}
                type="button"
                data-testid={`acta-guided-step-pill-${meta.index}`}
                onClick={() => handleJumpStep(st)}
                className={`min-h-[30px] rounded-lg px-1 text-[10px] font-semibold truncate cursor-pointer ${
                  isCurrent
                    ? "bg-terracotta text-white"
                    : isPast
                      ? "bg-success-container text-on-success-container"
                      : "bg-surface-container text-on-surface-variant"
                }`}
              >
                {meta.index}. {meta.shortTitle}
              </button>
            );
          })}
        </div>
      </div>

      {/* Historial conversacional + Cierre en Paso 5 */}
      <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar p-4 space-y-3">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[12px] leading-relaxed shadow-xs space-y-1.5 ${
                msg.role === "user"
                  ? "bg-secondary text-on-secondary rounded-br-sm"
                  : "border border-outline-variant bg-surface-container-lowest text-on-surface rounded-bl-sm"
              }`}
            >
              <div className="whitespace-pre-wrap break-words">{msg.content}</div>
              {msg.appliedLabels && msg.appliedLabels.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {msg.appliedLabels.map((lbl) => (
                    <span
                      key={lbl}
                      className="inline-flex items-center gap-1 rounded-full bg-success-container px-2 py-0.5 text-[10px] font-semibold text-on-success-container"
                    >
                      <Check className="h-3 w-3 shrink-0" />
                      <span>{lbl}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {currentStep === "STEP_2_INTERVINIENTES" && !installerSaved && (
          <div className="rounded-2xl border border-amber-300 bg-warning-container p-3 space-y-2">
            <div className="text-[11px] font-semibold text-on-warning-container">
              Aún no tienes guardada tu ficha habitual de instalador. Si acabas de rellenarla, guárdala aquí para próximas actas.
            </div>
            {installerSaveErr && (
              <div className="text-[11px] font-semibold text-coral-alert">{installerSaveErr}</div>
            )}
            {installerSaveMsg && (
              <div className="text-[11px] font-semibold text-on-success-container">
                {installerSaveMsg}
              </div>
            )}
            <button
              type="button"
              data-testid="acta-guided-save-installer-btn"
              disabled={savingInstaller}
              onClick={() => void handleSaveInstallerInline()}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-white px-3 text-[11px] font-bold text-on-surface border border-outline-variant cursor-pointer"
            >
              <Save className="h-3.5 w-3.5" />
              <span>
                {savingInstaller
                  ? "Guardando..."
                  : "Guardar en mi perfil de instalador"}
              </span>
            </button>
          </div>
        )}

        {currentStep === "STEP_5_FOTOS_Y_FIRMA" && (
          <div
            data-testid="acta-guided-closure-panel"
            className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-3.5 space-y-3"
          >
            <div className="text-[13px] font-bold text-on-surface">
              Paso final: Evidencia fotográfica y firma táctil
            </div>

            <ActaPhotosSection
              actaId={actaId}
              jobId={jobId}
              fotos={data.fotos}
              fileBridge={fileBridge}
              cameraAdapter={cameraAdapter}
              onChangeFotos={(nextFotos) => onApplyData({ ...data, fotos: nextFotos })}
            />

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                data-testid="acta-guided-installer-sig-btn"
                onClick={onOpenInstallerSignature}
                className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border border-outline-variant bg-surface-container-low px-3 text-[12px] font-semibold text-on-surface cursor-pointer"
              >
                <PenTool className="h-3.5 w-3.5" />
                <span>
                  {firmaInstaladorBase64 ? "Cambiar firma instalador" : "Firmar instalador"}
                </span>
              </button>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  data-testid="acta-guided-client-sig-btn"
                  onClick={onOpenClientSignature}
                  className="inline-flex min-h-[42px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-terracotta/40 bg-terracotta-soft px-3 text-[12px] font-bold text-on-primary-container cursor-pointer"
                >
                  <PenTool className="h-3.5 w-3.5" />
                  <span>
                    {firmaClienteBase64 ? "Repetir firma cliente" : "Firma del cliente *"}
                  </span>
                </button>
                {firmaClienteBase64 && (
                  <button
                    type="button"
                    onClick={onClearClientSignature}
                    className="min-h-[42px] rounded-xl border border-outline-variant bg-white px-2.5 text-[11px] font-semibold text-coral-alert cursor-pointer"
                  >
                    Borrar
                  </button>
                )}
              </div>
            </div>

            <button
              type="button"
              data-testid="acta-guided-generate-pdf-btn"
              disabled={pdfBusy}
              onClick={() => void onGenerateAndSharePdf()}
              className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-terracotta px-4 text-[13px] font-bold text-white shadow-sm disabled:opacity-50 cursor-pointer"
            >
              <Share2 className="h-4 w-4 shrink-0" />
              <span>{pdfBusy ? "Generando PDF A4..." : "Generar y Compartir PDF"}</span>
            </button>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Chips rápidos + barra inferior dual voz/texto */}
      <div className="shrink-0 border-t border-outline-variant bg-surface-container-lowest px-3 py-2.5 pb-safe space-y-2">
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          {quickChips.map((chip) => (
            <button
              key={chip}
              type="button"
              disabled={submitting}
              onClick={() => void submitTurn(chip)}
              className="shrink-0 rounded-full border border-outline-variant bg-surface-container-low px-3 py-1.5 text-[11px] font-semibold text-on-surface hover:border-terracotta disabled:opacity-45 cursor-pointer"
            >
              {chip}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitTurn(inputText);
          }}
          className="flex items-center gap-2"
        >
          {voiceAdapter && (
            <button
              type="button"
              data-testid="acta-guided-mic-btn"
              disabled={submitting}
              onClick={() => setVoiceOpen(true)}
              aria-label="Dictar por voz"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-terracotta text-white shadow-xs disabled:opacity-45 cursor-pointer"
            >
              <Mic className="h-5 w-5" />
            </button>
          )}

          <input
            type="text"
            data-testid="acta-guided-input"
            disabled={submitting}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Escribe o dicta los datos de este paso..."
            className="min-h-[44px] min-w-0 flex-1 rounded-full border border-outline-variant bg-surface-container-low px-4 text-xs text-on-surface"
          />

          <button
            type="submit"
            data-testid="acta-guided-send-btn"
            disabled={submitting || !inputText.trim()}
            aria-label="Enviar respuesta"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary text-on-secondary disabled:opacity-45 cursor-pointer"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>

      {voiceAdapter && (
        <GlobalVoiceOverlay
          open={voiceOpen}
          voiceAdapter={voiceAdapter}
          isSubmitting={submitting}
          title={`Dictado · ${activeStepMeta.label}`}
          subtitle="Habla con naturalidad; el asistente rellena el acta automáticamente"
          examples={stepExamples}
          placeholder={stepExamples[0]}
          zIndexClass="z-[60]"
          testIdPrefix="acta-guided-voice"
          onSubmitTranscript={async (transcript) => {
            setVoiceOpen(false);
            await submitTurn(transcript);
          }}
          onClose={() => setVoiceOpen(false)}
        />
      )}
    </div>
  );
}
