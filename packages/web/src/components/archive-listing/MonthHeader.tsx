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
    <div className="flex items-baseline justify-between border-b border-neutral-200 pb-2 mb-4">
      <h2 className="font-serif text-xl font-medium text-neutral-900">
        {monthLabel}
      </h2>
      <span className="font-mono text-xs text-neutral-500">
        {issueCount} {issueCount === 1 ? "issue" : "issues"}
      </span>
    </div>
  );
}
