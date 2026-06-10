import { type ReactElement } from "react";
import { STEPS } from "./types";
import { cn } from "@/lib/utils";

interface StepRailProps {
  current: number;
  furthest: number;
  onGo: (index: number) => void;
}

export function StepRail({ current, furthest, onGo }: StepRailProps): ReactElement {
  return (
    <nav className="hidden border-r border-[#e7e2d6] p-5 sm:block">
      <ol className="m-0 list-none p-0">
        {STEPS.map((step, i) => {
          const active = i === current;
          const done = i < current;
          const reachable = i <= furthest;
          return (
            <li key={step.key}>
              <button
                type="button"
                disabled={!reachable}
                onClick={() => { onGo(i); }}
                className={cn(
                  "flex w-full items-start gap-3 rounded-lg px-2 py-2.5 text-left transition-colors",
                  reachable ? "hover:bg-black/[.03]" : "cursor-not-allowed opacity-50",
                  active && "bg-[#efe9dc]",
                )}
              >
                <span
                  className={cn(
                    "grid size-[22px] shrink-0 place-items-center rounded-full border font-mono text-[11px]",
                    active && "border-[#8c3a1e] bg-[#8c3a1e] text-white",
                    done && "border-[#3f7d4e] bg-[#3f7d4e] text-white",
                    !active && !done && "border-[#c9c0ad] bg-[#f7f3ea] text-[#6b6557]",
                  )}
                >
                  {done ? "✓" : i + 1}
                </span>
                <span>
                  <span
                    className={cn(
                      "block text-[13px]",
                      active ? "font-semibold text-[#14110d]" : "text-[#39342b]",
                    )}
                  >
                    {step.label}
                  </span>
                  <span className="mt-px block font-mono text-[8.5px] tracking-[0.1em] uppercase text-[#9b9384]">
                    {step.req}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
