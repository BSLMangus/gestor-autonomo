import { AlertCircle, Check } from "lucide-react";
import { TEXT_LIMITS } from "../../core/contracts/textLimits";
import type { QuotePaymentInstallment, QuotePaymentMethod } from "../../core/contracts/types";
import {
  computePaymentScheduleAmounts,
  formatCentsEs,
  formatPercentEs,
} from "../../core/fiscal/fiscalEngine";

export const PAYMENT_METHOD_OPTIONS: Array<{
  id: QuotePaymentMethod;
  label: string;
}> = [
  { id: "transferencia", label: "Transferencia bancaria" },
  { id: "efectivo", label: "Efectivo" },
  { id: "bizum", label: "Bizum" },
  { id: "tarjeta", label: "Tarjeta" },
];

export const PAYMENT_METHOD_LABELS: Record<QuotePaymentMethod, string> = {
  transferencia: "Transferencia bancaria",
  efectivo: "Efectivo",
  bizum: "Bizum",
  tarjeta: "Tarjeta",
};

const VALIDITY_PRESETS = [15, 30, 60, 90] as const;

const INSTALLMENT_TEMPLATES: Record<0 | 1 | 2 | 3 | 4, QuotePaymentInstallment[]> = {
  0: [],
  1: [{ label: "Pago único (100 %)", percentage: 100 }],
  2: [
    { label: "Al aceptar / inicio de obra", percentage: 40 },
    { label: "Al finalizar la obra", percentage: 60 },
  ],
  3: [
    { label: "Antes de empezar (adelanto)", percentage: 30 },
    { label: "A mitad de obra", percentage: 40 },
    { label: "Al finalizar la obra", percentage: 30 },
  ],
  4: [
    { label: "Al aceptar el presupuesto", percentage: 25 },
    { label: "Al comenzar la obra", percentage: 25 },
    { label: "A mitad de obra", percentage: 25 },
    { label: "Al finalizar la obra", percentage: 25 },
  ],
};

interface QuotePaymentValidityEditorProps {
  validityDays: number;
  onChangeValidityDays: (days: number) => void;
  paymentMethods: QuotePaymentMethod[];
  onChangePaymentMethods: (methods: QuotePaymentMethod[]) => void;
  paymentSchedule: QuotePaymentInstallment[];
  onChangePaymentSchedule: (schedule: QuotePaymentInstallment[]) => void;
  emitterIban?: string;
  totalCentsForPreview?: number;
  disabled?: boolean;
  testIdPrefix?: string;
}

export function getScheduleSumBps(schedule: ReadonlyArray<{ percentage: number }>): number {
  return schedule.reduce(
    (acc, item) => acc + Math.round((Number.isFinite(item.percentage) ? item.percentage : 0) * 100),
    0
  );
}

export function isScheduleSumValid(schedule: ReadonlyArray<{ percentage: number }>): boolean {
  if (schedule.length === 0) return true;
  if (schedule.some((s) => !Number.isFinite(s.percentage) || s.percentage <= 0 || s.percentage > 100)) {
    return false;
  }
  return Math.abs(getScheduleSumBps(schedule) - 10_000) <= 1;
}

export function QuotePaymentValidityEditor({
  validityDays,
  onChangeValidityDays,
  paymentMethods,
  onChangePaymentMethods,
  paymentSchedule,
  onChangePaymentSchedule,
  emitterIban = "",
  totalCentsForPreview,
  disabled = false,
  testIdPrefix = "quote-pv",
}: QuotePaymentValidityEditorProps) {
  const sumBps = getScheduleSumBps(paymentSchedule);
  const sumPct = Math.round(sumBps) / 100;
  const scheduleValid = isScheduleSumValid(paymentSchedule);
  const amountsPreview =
    totalCentsForPreview !== undefined && paymentSchedule.length > 0 && scheduleValid
      ? computePaymentScheduleAmounts(totalCentsForPreview, paymentSchedule)
      : null;

  const toggleMethod = (id: QuotePaymentMethod) => {
    if (paymentMethods.includes(id)) {
      onChangePaymentMethods(paymentMethods.filter((m) => m !== id));
    } else {
      onChangePaymentMethods([...paymentMethods, id]);
    }
  };

  const applyTemplateCount = (count: 0 | 1 | 2 | 3 | 4) => {
    onChangePaymentSchedule(INSTALLMENT_TEMPLATES[count].map((item) => ({ ...item })));
  };

  const updateInstallment = (idx: number, patch: Partial<QuotePaymentInstallment>) => {
    onChangePaymentSchedule(
      paymentSchedule.map((item, i) => (i === idx ? { ...item, ...patch } : item))
    );
  };

  const activeCount = Math.min(4, paymentSchedule.length) as 0 | 1 | 2 | 3 | 4;

  return (
    <div className="space-y-3 font-sans text-[#2C2621]" data-testid={`${testIdPrefix}-editor`}>
      {/* Validez en días */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor={`${testIdPrefix}-validity-input`}
            className="text-xs font-semibold text-[#6B6860]"
          >
            Validez del presupuesto (días)
          </label>
          <div className="flex items-center gap-1">
            {VALIDITY_PRESETS.map((days) => (
              <button
                key={days}
                type="button"
                disabled={disabled}
                data-testid={`${testIdPrefix}-validity-${days}`}
                onClick={() => onChangeValidityDays(days)}
                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold cursor-pointer transition-colors ${
                  validityDays === days
                    ? "border-[#4B7094] bg-[#4B7094] text-[#FFFDF9]"
                    : "border-[#E5DFD2] bg-[#FFFDF7] text-[#2C2621] hover:border-[#EA580C]"
                }`}
              >
                {days} d
              </button>
            ))}
          </div>
        </div>
        <input
          id={`${testIdPrefix}-validity-input`}
          data-testid={`${testIdPrefix}-validity-input`}
          type="number"
          min={1}
          max={365}
          step={1}
          disabled={disabled}
          value={Number.isFinite(validityDays) ? validityDays : 30}
          onChange={(e) => {
            const val = Math.max(1, Math.min(365, Math.round(Number(e.target.value) || 30)));
            onChangeValidityDays(val);
          }}
          className="w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-2 text-xs font-mono font-mono-nums tabular-nums text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
        />
      </div>

      {/* Métodos de pago aceptados */}
      <div className="space-y-1.5">
        <div className="text-xs font-semibold text-[#6B6860]">Métodos de pago aceptados</div>
        <div className="flex flex-wrap gap-1.5">
          {PAYMENT_METHOD_OPTIONS.map((opt) => {
            const active = paymentMethods.includes(opt.id);
            return (
              <button
                key={opt.id}
                type="button"
                disabled={disabled}
                data-testid={`${testIdPrefix}-method-${opt.id}`}
                onClick={() => toggleMethod(opt.id)}
                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-[11px] font-semibold cursor-pointer transition-colors ${
                  active
                    ? "border-[#4B7094] bg-[#4B7094] text-[#FFFDF9]"
                    : "border-[#E5DFD2] bg-[#FFFDF7] text-[#2C2621] hover:border-[#EA580C]"
                }`}
              >
                {active && <Check className="h-3 w-3" />}
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
        {paymentMethods.includes("transferencia") && !emitterIban.trim() && (
          <div className="status-gold rounded-xl px-2.5 py-1.5 text-[11px]">
            Nota: No has configurado tu IBAN todavía; puedes añadirlo en Configuración o en tu perfil fiscal.
          </div>
        )}
        {paymentMethods.includes("efectivo") &&
          totalCentsForPreview !== undefined &&
          totalCentsForPreview >= 100_000 && (
            <div className="status-gold rounded-xl px-2.5 py-1.5 text-[11px]">
              Aviso legal (Ley 11/2021): para pagos entre empresario y profesional/particular recuerda el límite de pago en efectivo aplicable en operaciones con empresarios/profesionales (1.000 €).
            </div>
          )}
      </div>

      {/* Pagos fraccionados 1..4 */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <span className="text-xs font-semibold text-[#6B6860]">Forma de cobro (1 a 4 pagos)</span>
          {paymentSchedule.length > 0 && (
            <span
              data-testid={`${testIdPrefix}-schedule-sum`}
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold font-mono tabular-nums ${
                scheduleValid
                  ? "status-emerald"
                  : "status-tangerine"
              }`}
            >
              Suma: {formatPercentEs(sumPct)}
            </span>
          )}
        </div>

        <div className="grid grid-cols-5 gap-1">
          {(
            [
              { count: 0 as const, label: "Sin desgl." },
              { count: 1 as const, label: "1 pago" },
              { count: 2 as const, label: "2 pagos" },
              { count: 3 as const, label: "3 pagos" },
              { count: 4 as const, label: "4 pagos" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.count}
              type="button"
              disabled={disabled}
              data-testid={`${testIdPrefix}-count-${opt.count}`}
              onClick={() => applyTemplateCount(opt.count)}
              className={`min-h-[34px] rounded-xl border px-1 text-[10px] font-semibold cursor-pointer transition-colors ${
                activeCount === opt.count
                  ? "border-[#EA580C] bg-[#EA580C] text-white"
                  : "border-[#E5DFD2] bg-[#FFFDF7] text-[#2C2621] hover:border-[#EA580C]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {paymentSchedule.length === 2 && (
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                onChangePaymentSchedule([
                  { label: "Antes de empezar", percentage: 50 },
                  { label: "Al finalizar la obra", percentage: 50 },
                ])
              }
              className="rounded-lg border border-[#E5DFD2] bg-[#F5F1E6] px-2 py-1 text-[10px] font-semibold text-[#3D352E] cursor-pointer hover:border-[#EA580C]"
            >
              Preset 50 % / 50 %
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                onChangePaymentSchedule([
                  { label: "Antes de empezar (adelanto)", percentage: 40 },
                  { label: "Al finalizar la obra", percentage: 60 },
                ])
              }
              className="rounded-lg border border-[#E5DFD2] bg-[#F5F1E6] px-2 py-1 text-[10px] font-semibold text-[#3D352E] cursor-pointer hover:border-[#EA580C]"
            >
              Preset 40 % / 60 %
            </button>
          </div>
        )}

        {paymentSchedule.length > 0 && (
          <div className="space-y-1.5">
            {paymentSchedule.map((item, idx) => (
              <div
                key={idx}
                className="flex items-center gap-1.5 rounded-xl border border-[#E5DFD2] bg-[#F5F1E6] p-2"
              >
                <input
                  type="text"
                  maxLength={TEXT_LIMITS.PAYMENT_LABEL}
                  disabled={disabled}
                  data-testid={`${testIdPrefix}-installment-label-${idx}`}
                  value={item.label}
                  onChange={(e) => updateInstallment(idx, { label: e.target.value })}
                  placeholder={`Concepto pago ${idx + 1}`}
                  className="min-w-0 flex-1 rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] px-2 py-1 text-xs text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
                />
                <div className="flex items-center gap-1 shrink-0">
                  <input
                    type="number"
                    min={0.01}
                    max={100}
                    step="0.5"
                    disabled={disabled}
                    data-testid={`${testIdPrefix}-installment-pct-${idx}`}
                    value={item.percentage}
                    onChange={(e) =>
                      updateInstallment(idx, {
                        percentage: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                      })
                    }
                    className="w-16 rounded-lg border border-[#E5DFD2] bg-[#FFFDF7] px-2 py-1 text-right text-xs font-mono font-mono-nums tabular-nums text-[#2C2621] focus:border-[#EA580C] focus:outline-none"
                  />
                  <span className="text-xs font-semibold text-[#6B6860]">%</span>
                </div>
                {amountsPreview?.[idx] && (
                  <span className="w-20 text-right font-mono font-mono-nums text-[11px] font-bold text-[#2C2621] tabular-nums shrink-0">
                    {formatCentsEs(amountsPreview[idx]!.amount_cents)}
                  </span>
                )}
              </div>
            ))}

            {!scheduleValid && (
              <div className="flex items-center gap-1.5 rounded-xl border border-[#DC2626]/30 bg-[#FAD2D8] px-2.5 py-1.5 text-[11px] font-semibold text-[#5A121C]">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span>
                  Cada pago debe ser mayor que 0 % y los porcentajes deben sumar exactamente 100 %.
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
