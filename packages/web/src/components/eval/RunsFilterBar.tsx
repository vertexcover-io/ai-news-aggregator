import type { ReactElement } from "react";
import type { EvalRunStatus } from "@newsletter/shared/types/eval-ranking";
import type { RunsFilterValue, RunsMode } from "../../hooks/useEvalRuns";

export interface RunsFilterBarProps {
  value: RunsFilterValue;
  onChange: (next: RunsFilterValue) => void;
  total: number;
}

interface SegmentOption<T extends string> {
  value: T | "";
  label: string;
}

const MODE_OPTIONS: SegmentOption<RunsMode>[] = [
  { value: "", label: "All modes" },
  { value: "scored", label: "Mode A" },
  { value: "ab", label: "Mode B" },
];

const STATUS_OPTIONS: SegmentOption<EvalRunStatus>[] = [
  { value: "", label: "All status" },
  { value: "done", label: "Done" },
  { value: "failed", label: "Failed" },
  { value: "running", label: "Running" },
];

interface SegmentProps<T extends string> {
  options: SegmentOption<T>[];
  active: T | "";
  onSelect: (value: T | "") => void;
  testIdPrefix: string;
}

function Segment<T extends string>({
  options,
  active,
  onSelect,
  testIdPrefix,
}: SegmentProps<T>): ReactElement {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-neutral-300 bg-white">
      {options.map((opt, idx) => {
        const isActive = opt.value === active;
        return (
          <button
            key={`${opt.value}-${String(idx)}`}
            type="button"
            data-testid={`${testIdPrefix}-${opt.value === "" ? "all" : opt.value}`}
            data-active={isActive ? "true" : "false"}
            onClick={() => {
              onSelect(opt.value);
            }}
            className={`px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
              idx < options.length - 1 ? "border-r border-neutral-200" : ""
            } ${
              isActive
                ? "bg-neutral-900 text-white"
                : "text-neutral-500 hover:text-neutral-800"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function RunsFilterBar({
  value,
  onChange,
  total,
}: RunsFilterBarProps): ReactElement {
  return (
    <div
      className="mb-5 flex items-center gap-3 rounded-lg border border-neutral-200 bg-white px-4 py-3"
      data-testid="runs-filter-bar"
    >
      <div className="flex flex-1 items-center gap-3">
        <input
          type="text"
          data-testid="runs-search-input"
          placeholder="search · prompt hash, fixture id, run id"
          value={value.q}
          onChange={(e) => {
            onChange({ ...value, q: e.target.value });
          }}
          className="h-8 w-[280px] rounded-md border border-neutral-300 bg-white px-3 font-mono text-xs text-neutral-800 placeholder:text-neutral-400 focus:border-[#8c3a1e] focus:outline-none"
        />
        <Segment
          options={MODE_OPTIONS}
          active={value.mode}
          onSelect={(next) => {
            onChange({ ...value, mode: next });
          }}
          testIdPrefix="runs-filter-mode"
        />
        <Segment
          options={STATUS_OPTIONS}
          active={value.status}
          onSelect={(next) => {
            onChange({ ...value, status: next });
          }}
          testIdPrefix="runs-filter-status"
        />
      </div>
      <div className="font-mono text-[11px] uppercase tracking-wider text-neutral-500">
        <span data-testid="runs-filter-total">{total}</span> runs
      </div>
    </div>
  );
}
