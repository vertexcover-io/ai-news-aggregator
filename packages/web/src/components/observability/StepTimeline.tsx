import type { ReactElement } from "react";
import type {
  RunSourceStep,
  SourceStepKey,
  SourceStepStatus,
} from "@newsletter/shared/types";
import { formatDuration } from "./format";

interface StepTimelineProps {
  steps: RunSourceStep[];
  selected: SourceStepKey | null;
  onSelect: (key: SourceStepKey | null) => void;
}

const ICON: Record<SourceStepStatus, string> = {
  done: "✓",
  failed: "✕",
  skipped: "–",
  running: "●",
  empty: "·",
};

const ICON_CLASS: Record<SourceStepStatus, string> = {
  done: "bg-[#3f6f3a] text-white",
  failed: "bg-[#9d2f22] text-white",
  skipped: "bg-mute-2 text-white",
  running: "bg-[#9a6a16] text-white",
  empty: "bg-line-strong text-mute",
};

function cardClass(status: SourceStepStatus, isSelected: boolean): string {
  const base =
    "relative flex-1 min-w-[116px] rounded-[3px] border bg-cream-elev px-3 py-2.5 text-left transition-colors";
  const tone =
    status === "failed"
      ? "border-[#e3c8c2] bg-[#f7ebe8]"
      : status === "skipped" || status === "empty"
        ? "border-line opacity-55"
        : "border-line hover:bg-[#faf8f2]";
  const ring = isSelected ? "border-ink shadow-[0_0_0_1px_var(--color-ink)]" : "";
  return `${base} ${tone} ${ring}`;
}

function detailLine(step: RunSourceStep): string {
  const bits: string[] = [];
  if (step.detail !== null) bits.push(step.detail);
  if (step.durationMs !== null) bits.push(formatDuration(step.durationMs));
  return bits.join(" · ");
}

export function StepTimeline({
  steps,
  selected,
  onSelect,
}: StepTimelineProps): ReactElement {
  return (
    <div data-testid="step-timeline">
      <div className="mb-3 font-mono text-[9.5px] uppercase tracking-[0.14em] text-mute-2">
        Extraction steps
      </div>
      <div className="flex items-stretch gap-6 overflow-x-auto pb-1">
        {steps.map((step, index) => {
          const isSelected = selected === step.key;
          const interactive = step.status !== "skipped" && step.status !== "empty";
          return (
            <div key={step.key} className="relative flex flex-1 items-center">
              <button
                type="button"
                data-testid={`step-${step.key}`}
                data-status={step.status}
                data-active={isSelected ? "true" : "false"}
                disabled={!interactive}
                onClick={() => {
                  onSelect(isSelected ? null : step.key);
                }}
                className={cardClass(step.status, isSelected)}
              >
                <div className="flex items-center gap-1.5 font-mono text-[11px] font-medium text-ink">
                  <span
                    className={`flex h-[14px] w-[14px] flex-none items-center justify-center rounded-full text-[9px] ${ICON_CLASS[step.status]}`}
                  >
                    {ICON[step.status]}
                  </span>
                  {step.label}
                </div>
                <div className="mt-1.5 font-mono text-[10.5px] text-mute">
                  {step.count !== null
                    ? step.count.toLocaleString("en-US")
                    : step.status === "skipped"
                      ? "skipped"
                      : step.status === "empty"
                        ? "—"
                        : ""}
                </div>
                {detailLine(step).length > 0 ? (
                  <div className="mt-0.5 font-mono text-[9.5px] text-mute-2">
                    {detailLine(step)}
                  </div>
                ) : null}
              </button>
              {index < steps.length - 1 ? (
                <span className="absolute -right-6 top-1/2 h-px w-6 bg-line-strong" />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
