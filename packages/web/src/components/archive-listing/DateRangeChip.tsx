import { useState, type ReactElement } from "react";
import { formatRangeLabel, type DateRangeValue } from "../../lib/dateRange";
import { DateRangePopover } from "./DateRangePopover";

interface DateRangeChipProps {
  value: DateRangeValue | undefined;
  onChange: (next: DateRangeValue | undefined) => void;
}

export function DateRangeChip({ value, onChange }: DateRangeChipProps): ReactElement {
  const [open, setOpen] = useState(false);
  const label = formatRangeLabel(value?.from, value?.to);

  const handleApply = (range: DateRangeValue): void => {
    onChange(range);
  };

  const handleClear = (): void => {
    onChange(undefined);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={(): void => {
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        className="inline-flex items-center gap-2 min-h-[44px] px-3 py-2 font-mono text-xs uppercase tracking-widest text-neutral-700 border border-neutral-300 rounded hover:border-neutral-900"
      >
        <span className="text-neutral-500">DATE:</span>
        <span className="text-neutral-900">{label}</span>
        <span aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>
      {open ? (
        <DateRangePopover
          value={value}
          onApply={handleApply}
          onClear={handleClear}
          onClose={(): void => {
            setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
