import { useEffect, useMemo, useState } from "react";
import {
  patchClientProfileByVoice,
  type ClientProfileFormState,
} from "../../../agent/voiceFormPatcher";
import { ClientProfileCommitSchema } from "../../../core/contracts/schemas";
import { TEXT_LIMITS } from "../../../core/contracts/textLimits";
import { useRegisterOverlayVoice } from "../../../ui/overlayVoiceContext";
import { ZoomableTextField } from "../../../ui/ZoomableTextField";
import type { ActiveWidgetEnvelope } from "../../../core/contracts/types";
import { ClientsRepository } from "../../../core/db/repositories/clientsRepo";
import type { WidgetCommonProps } from "./widgetTypes";

type ClientWidget = Extract<ActiveWidgetEnvelope, { ui_widget_type: "ClientProfileWidget" }>;

export function ClientProfileWidget({ widget, runtime, isSubmitting }: WidgetCommonProps) {
  const payload = (widget as ClientWidget).widget_payload;
  const payloadKey = useMemo(() => JSON.stringify(payload), [payload]);

  const [name, setName] = useState(payload.name);
  const [phone, setPhone] = useState(payload.phone);
  const [nif, setNif] = useState(payload.nif);
  const [fiscalAddress, setFiscalAddress] = useState(payload.fiscal_address);
  const [email, setEmail] = useState(payload.email);
  const [notes, setNotes] = useState(payload.notes);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<ClientProfileFormState[]>([]);
  const [voiceChanges, setVoiceChanges] = useState<string[]>([]);
  const [voiceWarnings, setVoiceWarnings] = useState<string[]>([]);

  useEffect(() => {
    setName(payload.name);
    setPhone(payload.phone);
    setNif(payload.nif);
    setFiscalAddress(payload.fiscal_address);
    setEmail(payload.email);
    setNotes(payload.notes);
    setErrorMsg(null);
    setUndoStack([]);
    setVoiceChanges([]);
    setVoiceWarnings([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payloadKey]);

  const isEditing = payload.client_id !== null;
  const disabled = busy || isSubmitting;

  const applyClientFormState = (st: ClientProfileFormState) => {
    setName(st.name);
    setPhone(st.phone);
    setNif(st.nif);
    setFiscalAddress(st.fiscalAddress);
    setEmail(st.email);
    setNotes(st.notes);
  };

  useRegisterOverlayVoice({
    enabled: !disabled,
    title: isEditing ? "Dictar cambios del cliente" : "Dictar datos del cliente",
    placeholder: "Ej: Teléfono 611223344, NIF 12345678Z, calle Mayor 10",
    examples: [
      "Teléfono 611 22 33 44 y NIF 12345678Z",
      "Domicilio fiscal calle Alcalá 45, Madrid",
      "Correo laura arroba reformas punto es",
    ],
    buttonLabel: "Dictar cliente",
    lastChanges: voiceChanges,
    lastWarnings: voiceWarnings,
    canUndo: undoStack.length > 0,
    onUndo: () => {
      const prev = undoStack[undoStack.length - 1];
      if (!prev) return;
      setUndoStack((s) => s.slice(0, -1));
      applyClientFormState(prev);
      setVoiceChanges(["Último dictado deshecho"]);
      setVoiceWarnings([]);
    },
    onTranscript: async (text) => {
      const snapshot: ClientProfileFormState = {
        name,
        phone,
        nif,
        fiscalAddress,
        email,
        notes,
      };
      const res = await patchClientProfileByVoice(snapshot, text, {
        executor: runtime.executor,
        inferenceAdapter: runtime.inferenceAdapter,
      });
      if (res.changed) {
        setUndoStack((s) => [...s.slice(-9), snapshot]);
        applyClientFormState(res.nextState);
        setVoiceChanges(res.appliedChanges);
        setVoiceWarnings(res.warnings);
      } else {
        setVoiceChanges([]);
        setVoiceWarnings(["No detecté campos nuevos. Indica nombre, teléfono, NIF, dirección o email."]);
      }
    },
  });

  const handleSave = async () => {
    setErrorMsg(null);
    const parsed = ClientProfileCommitSchema.safeParse({
      client_id: payload.client_id,
      name,
      phone,
      nif,
      fiscal_address: fiscalAddress,
      email,
      notes,
    });
    if (!parsed.success) {
      setErrorMsg(parsed.error.issues.map((i) => i.message).join(" · "));
      return;
    }

    setBusy(true);
    try {
      const repo = new ClientsRepository(runtime.executor);
      const saved =
        payload.client_id !== null
          ? await repo.update(payload.client_id, {
              name: parsed.data.name,
              phone: parsed.data.phone,
              nif: parsed.data.nif,
              fiscal_address: parsed.data.fiscal_address,
              email: parsed.data.email,
              notes: parsed.data.notes,
            })
          : await repo.create({
              name: parsed.data.name,
              phone: parsed.data.phone,
              nif: parsed.data.nif,
              fiscal_address: parsed.data.fiscal_address,
              email: parsed.data.email,
              notes: parsed.data.notes,
            });
      await runtime.onDataMutated?.();
      runtime.onClientSaved?.(saved, !isEditing);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      data-testid="client-profile-widget"
      className="w-full max-w-full overflow-x-hidden ruled-index rounded-2xl border border-[#E5DFD2] bg-[#FFFDF7] p-4 text-[#2C2621] font-sans space-y-3"
    >
      <div className="border-b border-[#E5DFD2] pb-2.5">
        <span className="inline-flex items-center rounded-sm paper-stamp status-violet px-2.5 py-0.5 text-[11px] font-semibold">
          {isEditing ? "Editar ficha de cliente" : "Alta de cliente"}
        </span>
        <h3 className="mt-1.5 text-base font-bold text-[#2C2621]">
          {name.trim() || "Nuevo cliente"}
        </h3>
      </div>

      {payload.validation_hint && (
        <div className="rounded-xl border border-[#D97706]/35 bg-[#FFF3A1] p-2.5 text-xs font-medium text-[#3E3300]">
          {payload.validation_hint}
        </div>
      )}

      <div className="space-y-2.5">
        <div>
          <label className="block text-xs font-semibold text-[#2C2621]" htmlFor="cpw-name">
            Nombre o razón social *
          </label>
          <input
            id="cpw-name"
            data-testid="client-widget-name-input"
            type="text"
            disabled={disabled}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej: Laura Méndez Ruiz"
            className="mt-1 w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 text-sm text-[#2C2621] disabled:bg-[#F5F1E6]"
          />
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-semibold text-[#2C2621]" htmlFor="cpw-phone">
              Teléfono
            </label>
            <input
              id="cpw-phone"
              data-testid="client-widget-phone-input"
              type="tel"
              disabled={disabled}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+34 600 123 456"
              className="mt-1 w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 text-sm font-mono-nums text-[#2C2621] disabled:bg-[#F5F1E6]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#2C2621]" htmlFor="cpw-nif">
              NIF / NIE / CIF (opcional)
            </label>
            <input
              id="cpw-nif"
              data-testid="client-widget-nif-input"
              type="text"
              disabled={disabled}
              value={nif}
              onChange={(e) => setNif(e.target.value.toUpperCase())}
              placeholder="Ej: 12345678Z"
              className="mt-1 w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 text-sm font-mono-nums text-[#2C2621] disabled:bg-[#F5F1E6]"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#2C2621]" htmlFor="cpw-address">
            Domicilio fiscal / obra
          </label>
          <ZoomableTextField
            id="cpw-address"
            as="input"
            multiline={false}
            maxLength={TEXT_LIMITS.ADDRESS}
            zoomLabel="Domicilio fiscal / obra"
            data-testid="client-widget-address-input"
            disabled={disabled}
            value={fiscalAddress}
            onValueChange={setFiscalAddress}
            placeholder="Calle, número, código postal y ciudad"
            className="mt-1 w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 text-sm text-[#2C2621] disabled:bg-[#F5F1E6]"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#2C2621]" htmlFor="cpw-email">
            Correo electrónico
          </label>
          <input
            id="cpw-email"
            data-testid="client-widget-email-input"
            type="email"
            disabled={disabled}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="cliente@ejemplo.local"
            className="mt-1 w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 text-sm text-[#2C2621] disabled:bg-[#F5F1E6]"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#2C2621]" htmlFor="cpw-notes">
            Notas internas
          </label>
          <ZoomableTextField
            id="cpw-notes"
            as="textarea"
            multiline
            maxLength={TEXT_LIMITS.NOTES}
            zoomLabel="Notas internas del cliente"
            data-testid="client-widget-notes-input"
            rows={2}
            disabled={disabled}
            value={notes}
            onValueChange={setNotes}
            placeholder="Horarios de acceso, preferencias de facturación..."
            className="mt-1 w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 text-xs text-[#2C2621] disabled:bg-[#F5F1E6]"
          />
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-xl border border-[#DC2626]/30 bg-[#FAD2D8] p-2.5 text-xs font-medium text-[#5A121C]"
        >
          {errorMsg}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          data-testid="client-widget-cancel-btn"
          disabled={disabled}
          onClick={() => runtime.onDismissOverlay?.()}
          className="min-h-12 rounded-xl border border-[#DC2626]/40 bg-[#FFFDF7] px-4 text-xs font-bold text-[#9A2D08]"
        >
          Cancelar
        </button>
        <button
          type="button"
          data-testid="client-widget-save-btn"
          disabled={disabled}
          onClick={() => void handleSave()}
          className="min-h-12 flex-1 rounded-xl bg-[#EA580C] hover:bg-[#D04B00] px-4 text-sm font-bold text-white shadow-sm disabled:opacity-50"
        >
          {busy ? "Guardando ficha..." : isEditing ? "Guardar cambios" : "Guardar cliente"}
        </button>
      </div>
    </section>
  );
}
