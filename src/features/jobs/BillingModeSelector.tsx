import { useEffect, useRef, useState } from "react";
import type {
  BillingMode,
  BillingModeConfig,
  LaborOnlySubMode,
} from "../../core/contracts/types";
import { formatCentsEs } from "../../core/fiscal/fiscalEngine";
import {
  centsToInitialPriceText,
  eurInputToCents,
  formatPriceInputOnBlur,
  sanitizeDecimalPriceInput,
  shouldClearPriceOnFocus,
} from "../chat/widgets/priceInputUtils";

export type { BillingModeConfig };

export const BILLING_MODE_OPTIONS: ReadonlyArray<{
  id: BillingMode;
  title: string;
  shortLabel: string;
  description: string;
}> = [
  {
    id: "solo_partidas",
    title: "Solo partidas / Tarifario",
    shortLabel: "Solo partidas",
    description: "Presupuesto clásico sumando partidas con su precio unitario.",
  },
  {
    id: "partidas_mas_horas",
    title: "Partidas + Precio por hora",
    shortLabel: "Partidas + Horas",
    description: "Suma las partidas más las horas estimadas de mano de obra.",
  },
  {
    id: "partidas_mas_fijo_mano_obra",
    title: "Partidas + Fijo de mano de obra",
    shortLabel: "Partidas + Fijo MO",
    description: "Suma las partidas más un importe cerrado de mano de obra.",
  },
  {
    id: "solo_mano_obra",
    title: "Solo mano de obra",
    shortLabel: "Solo mano de obra",
    description: "Cobra por horas o precio cerrado ocultando precios unitarios.",
  },
];

export function getBillingModeBadgeLabel(
  mode?: BillingMode | null,
  subMode?: LaborOnlySubMode | null
): string {
  switch (mode) {
    case "partidas_mas_horas":
      return "Partidas + Horas";
    case "partidas_mas_fijo_mano_obra":
      return "Partidas + Fijo MO";
    case "solo_mano_obra":
      return subMode === "precio_cerrado" ? "Solo MO · Cerrado" : "Solo MO · Horas";
    case "solo_partidas":
    default:
      return "Solo partidas";
  }
}

export function createDefaultBillingModeConfig(
  defaultHourlyRateCents = 3800
): BillingModeConfig {
  return {
    modalidad_cobro: "solo_partidas",
    solo_mano_obra_submodo: "por_horas",
    horas_estimadas_thousandths: 0,
    tarifa_hora_cents: defaultHourlyRateCents,
    mano_obra_fija_cents: 0,
  };
}

interface BillingPriceInputProps {
  valueCents: number;
  disabled?: boolean;
  testId: string;
  ariaLabel: string;
  onChangeCents: (cents: number) => void;
}

function BillingPriceInput({
  valueCents,
  disabled = false,
  testId,
  ariaLabel,
  onChangeCents,
}: BillingPriceInputProps) {
  const [text, setText] = useState<string>(() => centsToInitialPriceText(valueCents));
  const isFocusedRef = useRef(false);

  useEffect(() => {
    if (isFocusedRef.current) return;
    if (valueCents === 0) {
      if (eurInputToCents(text) !== 0) {
        setText("");
      }
      return;
    }
    if (eurInputToCents(text) !== valueCents || text.trim() === "") {
      setText((valueCents / 100).toFixed(2));
    }
  }, [valueCents, text]);

  return (
    <div className="relative flex items-center">
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0.00"
        data-testid={testId}
        aria-label={ariaLabel}
        disabled={disabled}
        value={text}
        onFocus={() => {
          isFocusedRef.current = true;
          if (shouldClearPriceOnFocus(text)) {
            setText("");
          }
        }}
        onChange={(e) => {
          const cleaned = sanitizeDecimalPriceInput(e.target.value);
          setText(cleaned);
          onChangeCents(eurInputToCents(cleaned));
        }}
        onBlur={() => {
          isFocusedRef.current = false;
          const { display, cents } = formatPriceInputOnBlur(text);
          setText(display);
          onChangeCents(cents);
        }}
        className="min-h-[44px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 pr-7 text-[13px] font-mono tabular-nums text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none disabled:bg-[#F5F1E6] disabled:opacity-60"
      />
      <span className="pointer-events-none absolute right-2.5 text-[12px] font-semibold text-[#6B6860]">
        €
      </span>
    </div>
  );
}

function hoursThousandthsToText(thousandths: number): string {
  if (!thousandths || thousandths <= 0) return "";
  return String(Number((thousandths / 1000).toFixed(2)));
}

function parseHoursTextToThousandths(raw: string): number {
  const cleaned = sanitizeDecimalPriceInput(raw).trim();
  if (!cleaned || cleaned === ".") return 0;
  const val = Number.parseFloat(cleaned);
  if (!Number.isFinite(val) || val < 0) return 0;
  return Math.min(10_000_000, Math.round(val * 1000));
}

interface BillingHoursInputProps {
  valueThousandths: number;
  disabled?: boolean;
  testId: string;
  ariaLabel: string;
  onChangeThousandths: (thousandths: number) => void;
}

function BillingHoursInput({
  valueThousandths,
  disabled = false,
  testId,
  ariaLabel,
  onChangeThousandths,
}: BillingHoursInputProps) {
  const [text, setText] = useState<string>(() => hoursThousandthsToText(valueThousandths));
  const isFocusedRef = useRef(false);

  useEffect(() => {
    if (isFocusedRef.current) return;
    if (valueThousandths === 0) {
      if (parseHoursTextToThousandths(text) !== 0) {
        setText("");
      }
      return;
    }
    if (parseHoursTextToThousandths(text) !== valueThousandths || text.trim() === "") {
      setText(hoursThousandthsToText(valueThousandths));
    }
  }, [valueThousandths, text]);

  return (
    <div className="relative flex items-center">
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0"
        data-testid={testId}
        aria-label={ariaLabel}
        disabled={disabled}
        value={text}
        onFocus={() => {
          isFocusedRef.current = true;
          if (text.trim() === "0") {
            setText("");
          }
        }}
        onChange={(e) => {
          const cleaned = sanitizeDecimalPriceInput(e.target.value);
          setText(cleaned);
          onChangeThousandths(parseHoursTextToThousandths(cleaned));
        }}
        onBlur={() => {
          isFocusedRef.current = false;
          const next = parseHoursTextToThousandths(text);
          setText(next > 0 ? hoursThousandthsToText(next) : "");
          onChangeThousandths(next);
        }}
        className="min-h-[44px] w-full rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 pr-7 text-[13px] font-mono tabular-nums text-[#2C2621] placeholder:text-[#6B6860] focus:border-[#EA580C] focus:outline-none disabled:bg-[#F5F1E6] disabled:opacity-60"
      />
      <span className="pointer-events-none absolute right-2.5 text-[12px] font-semibold text-[#6B6860]">
        h
      </span>
    </div>
  );
}

export interface BillingModeSelectorProps {
  value: BillingModeConfig;
  onChange: (next: BillingModeConfig) => void;
  defaultHourlyRateCents: number;
  compact?: boolean;
  disabled?: boolean;
  showLaborInputs?: boolean;
}

export function BillingModeSelector({
  value,
  onChange,
  defaultHourlyRateCents,
  compact = false,
  disabled = false,
  showLaborInputs = true,
}: BillingModeSelectorProps) {
  const effectiveRateCents = value.tarifa_hora_cents ?? defaultHourlyRateCents;
  const usesHours =
    value.modalidad_cobro === "partidas_mas_horas" ||
    (value.modalidad_cobro === "solo_mano_obra" && value.solo_mano_obra_submodo === "por_horas");
  const usesFixedLabor =
    value.modalidad_cobro === "partidas_mas_fijo_mano_obra" ||
    (value.modalidad_cobro === "solo_mano_obra" &&
      value.solo_mano_obra_submodo === "precio_cerrado");

  const estimatedHoursLaborCents = Math.floor(
    (Math.max(0, value.horas_estimadas_thousandths) * Math.max(0, effectiveRateCents) * 2 + 1000) /
      2000
  );

  const handleSelectMode = (mode: BillingMode) => {
    if (disabled) return;
    onChange({
      ...value,
      modalidad_cobro: mode,
      tarifa_hora_cents:
        value.tarifa_hora_cents !== null && value.tarifa_hora_cents !== undefined
          ? value.tarifa_hora_cents
          : defaultHourlyRateCents,
    });
  };

  const handleSelectSubMode = (subMode: LaborOnlySubMode) => {
    if (disabled) return;
    onChange({
      ...value,
      solo_mano_obra_submodo: subMode,
      tarifa_hora_cents:
        value.tarifa_hora_cents !== null && value.tarifa_hora_cents !== undefined
          ? value.tarifa_hora_cents
          : defaultHourlyRateCents,
    });
  };

  return (
    <div
      data-testid="billing-mode-selector"
      className={`rounded-2xl border border-[#E5DFD2] bg-[#F5F1E6]/75 ${
        compact ? "p-2.5 space-y-2" : "p-3 space-y-2.5"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-bold text-[#2C2621]">
          Modalidad de presupuesto / cobro
        </span>
      </div>

      <div className={`grid gap-1.5 ${compact ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-2"}`}>
        {BILLING_MODE_OPTIONS.map((opt) => {
          const active = value.modalidad_cobro === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              disabled={disabled}
              data-testid={`billing-mode-option-${opt.id}`}
              aria-pressed={active}
              onClick={() => handleSelectMode(opt.id)}
              className={`min-h-[44px] rounded-xl border text-left transition-colors cursor-pointer disabled:opacity-60 ${
                compact ? "px-2.5 py-2" : "px-3 py-2.5"
              } ${
                active
                  ? "border-[#D04B00] bg-[#FFFDF7] ring-1 ring-[#D04B00] shadow-xs"
                  : "border-[#E5DFD2] bg-[#FFFDF7]/70 hover:border-[#EA580C]"
              }`}
            >
              <div className="flex items-center justify-between gap-1.5">
                <span
                  className={`font-semibold text-[#2C2621] ${
                    compact ? "text-[11px]" : "text-[12px]"
                  }`}
                >
                  {opt.title}
                </span>
                {active && (
                  <span className="h-2 w-2 shrink-0 rounded-full bg-[#D04B00]" aria-hidden="true" />
                )}
              </div>
              {!compact && (
                <p className="mt-0.5 text-[11px] leading-snug text-[#6B6860]">{opt.description}</p>
              )}
            </button>
          );
        })}
      </div>

      {value.modalidad_cobro === "solo_mano_obra" && (
        <div className="space-y-2 pt-0.5">
          <div className="grid grid-cols-2 gap-1 rounded-full border border-[#E5DFD2] bg-[#FFFDF7] p-1">
            <button
              type="button"
              disabled={disabled}
              data-testid="billing-submode-por_horas"
              aria-pressed={value.solo_mano_obra_submodo === "por_horas"}
              onClick={() => handleSelectSubMode("por_horas")}
              className={`min-h-[38px] rounded-full text-[11px] font-semibold cursor-pointer transition-colors ${
                value.solo_mano_obra_submodo === "por_horas"
                  ? "bg-[#4B7094] text-[#FFFDF9]"
                  : "text-[#6B6860] hover:bg-[#F5F1E6]"
              }`}
            >
              Por horas
            </button>
            <button
              type="button"
              disabled={disabled}
              data-testid="billing-submode-precio_cerrado"
              aria-pressed={value.solo_mano_obra_submodo === "precio_cerrado"}
              onClick={() => handleSelectSubMode("precio_cerrado")}
              className={`min-h-[38px] rounded-full text-[11px] font-semibold cursor-pointer transition-colors ${
                value.solo_mano_obra_submodo === "precio_cerrado"
                  ? "bg-[#4B7094] text-[#FFFDF9]"
                  : "text-[#6B6860] hover:bg-[#F5F1E6]"
              }`}
            >
              Precio cerrado
            </button>
          </div>
          <div className="rounded-xl border border-[#E5DFD2] bg-[#FFF3A1]/45 px-3 py-2 text-[11px] font-medium text-[#3E3300]">
            Solo mano de obra: los precios unitarios de las partidas quedan ocultos en el
            presupuesto y en el PDF; solo figurará el importe de mano de obra.
          </div>
        </div>
      )}

      {showLaborInputs && usesHours && (
        <div className="grid grid-cols-2 gap-2 pt-0.5">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-[#6B6860]">Horas estimadas</span>
            <BillingHoursInput
              valueThousandths={value.horas_estimadas_thousandths}
              disabled={disabled}
              testId="billing-hours-input"
              ariaLabel="Horas estimadas de mano de obra"
              onChangeThousandths={(horas_estimadas_thousandths) =>
                onChange({ ...value, horas_estimadas_thousandths })
              }
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-[#6B6860]">Tarifa por hora</span>
            <BillingPriceInput
              valueCents={effectiveRateCents}
              disabled={disabled}
              testId="billing-hourly-rate-input"
              ariaLabel="Tarifa por hora en euros"
              onChangeCents={(tarifa_hora_cents) => onChange({ ...value, tarifa_hora_cents })}
            />
          </label>
          <div className="col-span-2 flex items-center justify-between rounded-xl border border-[#E5DFD2] bg-[#FFFDF7] px-3 py-1.5 text-[11px]">
            <span className="font-medium text-[#6B6860]">Mano de obra calculada</span>
            <span className="font-mono font-semibold tabular-nums text-[#2C2621]">
              {formatCentsEs(estimatedHoursLaborCents)}
            </span>
          </div>
        </div>
      )}

      {showLaborInputs && usesFixedLabor && (
        <label className="flex flex-col gap-1 pt-0.5">
          <span className="text-[11px] font-semibold text-[#6B6860]">
            Importe fijo mano de obra (sin IVA)
          </span>
          <BillingPriceInput
            valueCents={value.mano_obra_fija_cents}
            disabled={disabled}
            testId="billing-fixed-labor-input"
            ariaLabel="Importe fijo de mano de obra en euros"
            onChangeCents={(mano_obra_fija_cents) =>
              onChange({ ...value, mano_obra_fija_cents })
            }
          />
        </label>
      )}
    </div>
  );
}
