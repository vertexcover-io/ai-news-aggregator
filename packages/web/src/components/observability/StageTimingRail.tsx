import type { ReactElement } from "react";
import type { RunObservabilityStage } from "@newsletter/shared/types";
import { formatDuration } from "./format";

interface StageTimingRailProps {
  stages: RunObservabilityStage[];
}

type StagePhase = "done" | "running" | "pending";

function phaseFor(stage: RunObservabilityStage): StagePhase {
  if (stage.endedAt !== null) return "done";
  if (stage.startedAt !== null) return "running";
  return "pending";
}

function Glyph({ phase }: { phase: StagePhase }): ReactElement {
  if (phase === "running") {
    return (
      <span
        data-testid="stage-glyph-running"
        className="relative h-[13px] w-[13px] rounded-full border-2 border-rust bg-transparent"
      >
        <span className="absolute inset-[2px] animate-pulse rounded-full bg-rust" />
      </span>
    );
  }
  if (phase === "pending") {
    return (
      <span
        data-testid="stage-glyph-pending"
        className="h-[13px] w-[13px] rounded-full border-2 border-line-strong bg-transparent"
      />
    );
  }
  return (
    <span
      data-testid="stage-glyph-done"
      className="h-[13px] w-[13px] rounded-full border-2 border-[#3f6f43] bg-[#3f6f43]"
    />
  );
}

export function StageTimingRail({ stages }: StageTimingRailProps): ReactElement {
  return (
    <div
      data-testid="stage-timing-rail"
      className="rounded border border-line bg-cream-elev px-[18px] pb-3.5 pt-1.5"
    >
      {stages.map((stage) => {
        const phase = phaseFor(stage);
        return (
          <div
            key={stage.stage}
            data-testid={`stage-row-${stage.stage}`}
            className="grid grid-cols-[16px_1fr_auto] items-center gap-3 border-b border-line py-3 last:border-b-0"
          >
            <Glyph phase={phase} />
            <div className="font-mono text-[13px] capitalize text-ink-2">
              {stage.stage}
            </div>
            <div className="text-right font-mono text-[12.5px] text-mute">
              {phase === "running" ? (
                <span>
                  <b className="font-medium text-ink">running</b> · live
                </span>
              ) : phase === "pending" ? (
                "pending"
              ) : (
                <b className="font-medium text-ink">
                  {formatDuration(stage.durationMs)}
                </b>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
