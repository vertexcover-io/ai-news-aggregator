import type { ReactElement } from "react";

export const PIPELINE_STAGES: readonly {
  name: string;
  caption: string;
}[] = [
  { name: "BRAINSTORM", caption: "Argue with itself about the design before any code." },
  { name: "SPEC", caption: "Turn the design into testable acceptance criteria." },
  { name: "PLAN", caption: "Break the spec into ordered implementation steps." },
  { name: "TDD", caption: "Write a failing test, make it pass, refactor." },
  { name: "REVIEW", caption: "Two independent passes over the diff." },
  { name: "VERIFY", caption: "Boot the app, run the feature end-to-end." },
  { name: "SHIP", caption: "Commit, push, open PR with all artifacts attached." },
];

export function PipelineDiagram(): ReactElement {
  return (
    <div data-section="pipeline">
      <div
        role="img"
        aria-label="Pipeline: brainstorm to spec to plan to TDD to review to verify to ship"
        className="flex flex-wrap md:flex-nowrap items-stretch justify-between gap-1.5 md:gap-0 mb-7"
      >
        {PIPELINE_STAGES.map((stage, idx) => (
          <div key={stage.name} className="contents">
            <div className="flex-1 basis-[calc(50%-3px)] md:basis-0 border border-[#e7e2d6] py-[14px] px-2 text-center font-mono text-[12px] tracking-[0.16em] uppercase text-[#14110d]">
              {stage.name}
            </div>
            {idx < PIPELINE_STAGES.length - 1 ? (
              <div className="hidden md:flex flex-none w-7 items-center justify-center font-mono text-[#6b6557] text-[14px]">
                →
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-7 gap-[18px] md:gap-0 mt-2">
        {PIPELINE_STAGES.map((stage) => (
          <div
            key={stage.name}
            className="px-0 md:px-2 font-mono text-[11px] leading-[1.55] text-[#6b6557] text-left"
          >
            <span className="block text-[#14110d] tracking-[0.16em] uppercase mb-[6px] text-[10.5px]">
              {stage.name}
            </span>
            {stage.caption}
          </div>
        ))}
      </div>
    </div>
  );
}
