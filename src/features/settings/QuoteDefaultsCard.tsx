import { CalendarClock, CheckCircle2, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { QuoteDefaultsInputSchema } from "../../core/contracts/schemas";
import type {
  AppSettingsRecord,
  QuotePaymentInstallment,
  QuotePaymentMethod,
  SqliteExecutor,
} from "../../core/contracts/types";
import { SettingsRepository } from "../../core/db/repositories/settingsRepo";
import {
  isScheduleSumValid,
  QuotePaymentValidityEditor,
} from "../quotes/QuotePaymentValidityEditor";

interface QuoteDefaultsCardProps {
  executor: SqliteExecutor;
  settings: AppSettingsRecord | null;
  onSettingsUpdated: (updated: AppSettingsRecord) => Promise<void>;
}

export function QuoteDefaultsCard({
  executor,
  settings,
  onSettingsUpdated,
}: QuoteDefaultsCardProps) {
  const [validityDays, setValidityDays] = useState<number>(
    settings?.default_quote_validity_days ?? 30
  );
  const [paymentMethods, setPaymentMethods] = useState<QuotePaymentMethod[]>(
    settings?.default_payment_methods ?? ["transferencia"]
  );
  const [paymentSchedule, setPaymentSchedule] = useState<QuotePaymentInstallment[]>(
    settings?.default_payment_schedule ?? []
  );
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) return;
    setValidityDays(settings.default_quote_validity_days);
    setPaymentMethods(settings.default_payment_methods);
    setPaymentSchedule(settings.default_payment_schedule);
  }, [settings]);

  const handleSave = async () => {
    setErrorMsg(null);
    setSavedMsg(null);
    if (!isScheduleSumValid(paymentSchedule)) {
      setErrorMsg("Los porcentajes de pago deben sumar exactamente 100 %.");
      return;
    }
    const parsed = QuoteDefaultsInputSchema.safeParse({
      default_quote_validity_days: validityDays,
      default_payment_methods: paymentMethods,
      default_payment_schedule: paymentSchedule,
    });
    if (!parsed.success) {
      setErrorMsg(parsed.error.issues[0]?.message ?? "Configuración de presupuesto inválida");
      return;
    }
    setSaving(true);
    try {
      const updated = await new SettingsRepository(executor).updateQuoteDefaults(parsed.data);
      await onSettingsUpdated(updated);
      setSavedMsg("Preferencias predeterminadas de presupuestos guardadas.");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      data-testid="quote-defaults-card"
      className="paper-sheet rounded-2xl border border-[#E5DFD2] bg-[#FFFDF7] p-3.5 space-y-3 font-sans"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wide text-[#2C2621] flex items-center gap-1.5">
            <CalendarClock className="h-3.5 w-3.5 text-[#EA580C]" />
            <span>Presupuestos: validez y pagos por defecto</span>
          </h3>
          <p className="mt-0.5 text-[11px] text-[#6B6860]">
            Se aplicará automáticamente al crear cada presupuesto nuevo (editable en cada presupuesto).
          </p>
        </div>
      </div>

      <QuotePaymentValidityEditor
        validityDays={validityDays}
        onChangeValidityDays={setValidityDays}
        paymentMethods={paymentMethods}
        onChangePaymentMethods={setPaymentMethods}
        paymentSchedule={paymentSchedule}
        onChangePaymentSchedule={setPaymentSchedule}
        emitterIban={settings?.emitter_iban ?? ""}
        disabled={saving}
        testIdPrefix="settings-quote-defaults"
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
        data-testid="save-quote-defaults-btn"
        disabled={saving || !isScheduleSumValid(paymentSchedule)}
        onClick={() => void handleSave()}
        className="min-h-[44px] w-full rounded-xl bg-[#4B7094] px-3 text-xs font-bold text-[#FFFDF9] flex items-center justify-center gap-1.5 disabled:opacity-45 cursor-pointer"
      >
        <Save className="h-3.5 w-3.5" />
        <span>{saving ? "Guardando..." : "Guardar validez y pagos predeterminados"}</span>
      </button>
    </div>
  );
}
