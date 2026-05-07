import { useEffect, useRef, useState, type ReactElement } from "react";
import { DayPicker, type DateRange } from "react-day-picker";
import {
  formatRangeLabel,
  presetRange,
  type DateRangeValue,
  type PresetName,
} from "../../lib/dateRange";

interface DateRangePopoverProps {
  value: DateRangeValue | undefined;
  onApply: (range: DateRangeValue) => void;
  onClear: () => void;
  onClose: () => void;
}

interface Preset {
  id: PresetName;
  label: string;
}

const PRESETS: Preset[] = [
  { id: "last-7-days", label: "Last 7 days" },
  { id: "last-30-days", label: "Last 30 days" },
  { id: "last-90-days", label: "Last 90 days" },
  { id: "this-year", label: "This year" },
  { id: "all-time", label: "All time" },
];

function toDateRange(v: DateRangeValue | undefined): DateRange | undefined {
  if (!v || (!v.from && !v.to)) return undefined;
  return { from: v.from, to: v.to };
}

export function DateRangePopover({
  value,
  onApply,
  onClear,
  onClose,
}: DateRangePopoverProps): ReactElement {
  const [range, setRange] = useState(value);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent): void {
      if (!ref.current) return;
      if (e.target instanceof Node && !ref.current.contains(e.target)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handler);
    return (): void => {
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  const selectedLabel =
    range?.from && range.to ? formatRangeLabel(range.from, range.to) : "—";
  const applyDisabled = !range?.from || !range.to;

  const handlePreset = (id: PresetName): void => {
    const next = presetRange(id);
    setRange(next);
  };

  const handleApply = (): void => {
    if (!range?.from || !range.to) return;
    onApply(range);
    onClose();
  };

  const handleClear = (): void => {
    setRange(undefined);
    onClear();
    onClose();
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Select date range"
      className="absolute z-50 mt-2 left-0 w-auto max-w-[calc(100vw-2rem)] rounded-md border border-neutral-200 bg-[#FAFAF7] p-4 shadow-lg sm:left-auto"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-xs uppercase tracking-widest text-neutral-500">
          SELECT RANGE
        </span>
        <span
          data-testid="range-selected-label"
          className="font-mono text-xs uppercase tracking-widest text-neutral-900"
        >
          {selectedLabel}
        </span>
      </div>

      <div className="ledger-rdp">
        <DayPicker
          mode="range"
          numberOfMonths={2}
          defaultMonth={range?.from ?? new Date()}
          selected={toDateRange(range)}
          onSelect={(r): void => {
            setRange(r ? { from: r.from, to: r.to } : undefined);
          }}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={(): void => {
              handlePreset(p.id);
            }}
            className="font-mono text-xs uppercase tracking-widest border border-neutral-300 rounded px-3 py-1 hover:border-[#8C3A1E] hover:text-[#8C3A1E]"
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-neutral-200 pt-3">
        <button
          type="button"
          onClick={handleClear}
          className="min-h-[44px] font-mono text-xs uppercase tracking-widest text-neutral-500 hover:text-neutral-900"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={handleApply}
          disabled={applyDisabled}
          className="min-h-[44px] font-mono text-xs uppercase tracking-widest rounded border border-[#8C3A1E] bg-[#8C3A1E] px-4 text-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Apply
        </button>
      </div>
    </div>
  );
}
