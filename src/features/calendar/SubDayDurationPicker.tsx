import type { WorkScheduleDefaults } from "../../core/contracts/types";
import {
  computeDailyWorkHoursThousandths,
  minutesToHHMM,
  parseHHMMToMinutes,
} from "../../core/db/repositories/scheduleRepo";

export interface SubDayDurationPickerProps {
  startTime: string;
  endTime: string;
  defaults: WorkScheduleDefaults;
  disabled?: boolean;
  onChange: (next: {
    startTime: string;
    endTime: string;
    hoursThousandths: number;
    isFullDay: boolean;
  }) => void;
}

const DURATION_PRESETS = [
  { id: "1h", label: "1 h", minutes: 60 },
  { id: "2h", label: "2 h", minutes: 120 },
  { id: "3h", label: "3 h", minutes: 180 },
  { id: "4h", label: "4 h", minutes: 240 },
] as const;

function computeHoursLabel(hoursThousandths: number): string {
  const hours = hoursThousandths / 1000;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1).replace(".", ",")} h`;
}

export function SubDayDurationPicker({
  startTime,
  endTime,
  defaults,
  disabled = false,
  onChange,
}: SubDayDurationPickerProps) {
  const startMin = parseHHMMToMinutes(startTime);
  const endMin = parseHHMMToMinutes(endTime);
  const rawDiffMin = Math.max(0, endMin - startMin);
  const fullDayStart = defaults.morning_start;
  const fullDayEnd = defaults.afternoon_end || defaults.morning_end;
  const fullDayThousandths = computeDailyWorkHoursThousandths(defaults);
  const isFullDay = startTime === fullDayStart && endTime === fullDayEnd;
  const effectiveHoursThousandths = isFullDay
    ? fullDayThousandths
    : Math.round((rawDiffMin * 1000) / 60);

  const handlePresetClick = (minutes: number) => {
    const baseStart = startTime || fullDayStart;
    const baseStartMin = parseHHMMToMinutes(baseStart);
    const nextEndMin = Math.min(23 * 60 + 59, baseStartMin + minutes);
    const actualMinutes = Math.max(0, nextEndMin - baseStartMin);
    onChange({
      startTime: baseStart,
      endTime: minutesToHHMM(nextEndMin),
      hoursThousandths: Math.round((actualMinutes * 1000) / 60),
      isFullDay: false,
    });
  };

  const handleFullDayClick = () => {
    onChange({
      startTime: fullDayStart,
      endTime: fullDayEnd,
      hoursThousandths: fullDayThousandths,
      isFullDay: true,
    });
  };

  return (
    <div className="space-y-2" data-testid="subday-duration-picker">
      <div className="flex flex-wrap gap-1.5">
        {DURATION_PRESETS.map((preset) => {
          const active = !isFullDay && rawDiffMin === preset.minutes;
          return (
            <button
              key={preset.id}
              type="button"
              disabled={disabled}
              data-testid={`duration-chip-${preset.id}`}
              onClick={() => handlePresetClick(preset.minutes)}
              className={`min-h-[36px] rounded-full border px-2.5 text-[11px] font-semibold transition-colors cursor-pointer disabled:opacity-50 ${
                active
                  ? "border-primary bg-primary text-white"
                  : "border-outline-variant bg-surface-container-low text-on-surface"
              }`}
            >
              {preset.label}
            </button>
          );
        })}
        <button
          type="button"
          disabled={disabled}
          data-testid="duration-chip-full"
          onClick={handleFullDayClick}
          className={`min-h-[36px] rounded-full border px-2.5 text-[11px] font-semibold transition-colors cursor-pointer disabled:opacity-50 ${
            isFullDay
              ? "border-primary bg-primary text-white"
              : "border-outline-variant bg-surface-container-low text-on-surface"
          }`}
        >
          Jornada completa ({computeHoursLabel(fullDayThousandths)})
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] font-semibold text-on-surface-variant mb-1">
            Hora inicio
          </label>
          <input
            type="time"
            disabled={disabled}
            data-testid="subday-start-time"
            value={startTime}
            onChange={(e) => {
              const nextStart = e.target.value;
              if (!nextStart) return;
              const nextStartMin = parseHHMMToMinutes(nextStart);
              let nextEnd = endTime;
              let nextEndMin = parseHHMMToMinutes(endTime);
              if (nextEndMin <= nextStartMin) {
                nextEndMin = Math.min(23 * 60 + 59, nextStartMin + Math.max(60, rawDiffMin || 120));
                nextEnd = minutesToHHMM(nextEndMin);
              }
              const fullDay = nextStart === fullDayStart && nextEnd === fullDayEnd;
              onChange({
                startTime: nextStart,
                endTime: nextEnd,
                hoursThousandths: fullDay
                  ? fullDayThousandths
                  : Math.round((Math.max(0, nextEndMin - nextStartMin) * 1000) / 60),
                isFullDay: fullDay,
              });
            }}
            className="min-h-[40px] w-full rounded-xl border border-outline-variant bg-surface-container-low px-2.5 text-[13px] font-semibold"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-on-surface-variant mb-1">
            Hora fin
          </label>
          <input
            type="time"
            disabled={disabled}
            data-testid="subday-end-time"
            value={endTime}
            onChange={(e) => {
              const nextEnd = e.target.value;
              if (!nextEnd) return;
              const nextEndMin = parseHHMMToMinutes(nextEnd);
              const fullDay = startTime === fullDayStart && nextEnd === fullDayEnd;
              onChange({
                startTime,
                endTime: nextEnd,
                hoursThousandths: fullDay
                  ? fullDayThousandths
                  : Math.round((Math.max(0, nextEndMin - startMin) * 1000) / 60),
                isFullDay: fullDay,
              });
            }}
            className="min-h-[40px] w-full rounded-xl border border-outline-variant bg-surface-container-low px-2.5 text-[13px] font-semibold"
          />
        </div>
      </div>

      <div className="text-[11px] font-medium text-on-surface-variant">
        Duración prevista:{" "}
        <strong className="text-on-surface">
          {rawDiffMin <= 0
            ? "Hora fin debe ser posterior a inicio"
            : computeHoursLabel(effectiveHoursThousandths)}
        </strong>
        {isFullDay ? " (descontando pausa)" : ""}
      </div>
    </div>
  );
}
