import type { ReactElement } from "react";

export interface FilterChipProps {
  id: string;
  label: string;
  count: number;
  active: boolean;
  onClick: (id: string) => void;
}

export function FilterChip({
  id,
  label,
  count,
  active,
  onClick,
}: FilterChipProps): ReactElement {
  return (
    <button
      type="button"
      data-filter-chip="true"
      data-active={active ? "true" : undefined}
      onClick={() => { onClick(id); }}
      className={
        active
          ? "inline-flex items-center gap-1 rounded-full px-3 py-1 font-mono text-xs font-medium bg-neutral-900 text-white"
          : "inline-flex items-center gap-1 rounded-full border border-neutral-300 px-3 py-1 font-mono text-xs font-medium text-neutral-700 hover:border-neutral-500"
      }
    >
      {label}
      <span className="opacity-60">{count}</span>
    </button>
  );
}
