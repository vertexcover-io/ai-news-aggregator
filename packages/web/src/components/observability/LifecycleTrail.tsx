import type { ReactElement } from "react";
import type { RunSourceItem } from "@newsletter/shared/types";

interface LifecycleTrailProps {
  item: RunSourceItem;
  live: boolean;
}

type StepTone = "pass" | "skip" | "fail" | "stop" | "pending";

interface TrailStep {
  label: string;
  tone: StepTone;
}

const STEP_CLASS: Record<StepTone, string> = {
  pass: "bg-[#e7f0e7] text-[#3f7d4f]",
  skip: "bg-chip text-mute",
  fail: "bg-[#f6e3df] text-[#9d2f22]",
  stop: "bg-[#f6e3df] font-medium text-[#9d2f22]",
  pending: "border border-dashed border-line-strong text-mute-2",
};

function buildSteps(item: RunSourceItem, live: boolean): TrailStep[] {
  const steps: TrailStep[] = [{ label: "Fetched", tone: "pass" }];
  const { lifecycle } = item;

  if (lifecycle.enrich.status === "ok") {
    steps.push({ label: "Enriched", tone: "pass" });
  } else if (lifecycle.enrich.status === "skipped") {
    steps.push({ label: "Enrich-skipped", tone: "skip" });
  } else if (lifecycle.enrich.status === "failed") {
    steps.push({ label: "Enrich-failed", tone: "fail" });
  }

  if (lifecycle.dedup?.status === "dropped") {
    steps.push({ label: "Dedup-dropped", tone: "stop" });
    return steps;
  }
  if (lifecycle.dedup?.status === "survived") {
    steps.push({ label: "Survived", tone: "pass" });
  }

  if (lifecycle.shortlisted === true) {
    steps.push({ label: "Shortlisted", tone: "pass" });
  } else if (lifecycle.shortlisted === false) {
    steps.push({ label: "Not shortlisted", tone: "skip" });
  } else if (live) {
    steps.push({ label: "Pending", tone: "pending" });
  }

  if (lifecycle.rank !== null) {
    steps.push({ label: `Ranked #${String(lifecycle.rank)}`, tone: "pass" });
  } else if (live) {
    steps.push({ label: "Pending", tone: "pending" });
  }

  return steps;
}

export function LifecycleTrail({ item, live }: LifecycleTrailProps): ReactElement {
  const steps = buildSteps(item, live);

  return (
    <div
      data-testid={`lifecycle-trail-${String(item.id)}`}
      className="flex max-w-[430px] flex-wrap items-center justify-end gap-1"
    >
      {steps.map((step, index) => (
        <span key={`${step.label}-${String(index)}`} className="contents">
          {index > 0 ? (
            <span className="font-mono text-[10px] text-line-strong">-&gt;</span>
          ) : null}
          <span
            className={`rounded-[4px] px-[7px] py-0.5 font-mono text-[9.5px] uppercase tracking-[0.05em] whitespace-nowrap ${STEP_CLASS[step.tone]}`}
          >
            {step.label}
          </span>
        </span>
      ))}
    </div>
  );
}
