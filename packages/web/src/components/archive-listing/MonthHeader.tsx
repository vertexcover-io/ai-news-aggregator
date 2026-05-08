import type { ReactElement } from "react";

export interface MonthHeaderProps {
  monthLabel: string;
  issueCount: number;
}

export function MonthHeader({
  monthLabel,
  issueCount,
}: MonthHeaderProps): ReactElement {
  return (
    <div className="text-center mt-12 md:mt-14 mb-2">
      <h2 className="font-serif text-[22px] italic font-medium tracking-[-0.005em] text-[#14110d] m-0">
        {monthLabel}
      </h2>
      <span className="block mt-[6px] font-mono text-[10.5px] uppercase tracking-[0.14em] text-[#8a8472]">
        {issueCount} {issueCount === 1 ? "issue" : "issues"}
      </span>
    </div>
  );
}
