import type { ReactElement } from "react";
import type { RunCostBreakdown } from "@newsletter/shared/types";
import { formatCostUsd, formatTokens } from "../dashboard/cost-format";

interface CostStripProps {
  cost: RunCostBreakdown | null;
  live: boolean;
}

interface CostCell {
  key: string;
  value: string;
  rust?: boolean;
}

export function CostStrip({ cost, live }: CostStripProps): ReactElement {
  const shortlist = cost?.stages.shortlist;
  const rank = cost?.stages.rank;

  let inputTokens = 0;
  let outputTokens = 0;
  if (cost) {
    for (const stage of Object.values(cost.stages)) {
      for (const model of stage.byModel) {
        inputTokens += model.inputTokens;
        outputTokens += model.outputTokens;
      }
    }
  }

  const totalLabel = live ? "Cost · so far" : "Cost · total";
  const cells: CostCell[] = [
    {
      key: totalLabel,
      value: cost === null ? "?" : formatCostUsd(cost.totalCostUsd),
      rust: true,
    },
    {
      key: "Shortlist",
      value: shortlist ? formatCostUsd(shortlist.costUsd) : "—",
    },
    {
      key: "Rank",
      value: rank
        ? `${formatCostUsd(rank.costUsd)}${live ? "*" : ""}`
        : "—",
    },
    {
      key: "Tokens in/out",
      value:
        cost === null
          ? "—"
          : `${formatTokens(inputTokens)} / ${formatTokens(outputTokens)}`,
    },
  ];

  return (
    <div
      data-testid="cost-strip"
      className="mt-3.5 flex overflow-hidden rounded border border-line bg-cream-elev"
    >
      {cells.map((cell) => (
        <div
          key={cell.key}
          className="flex-1 border-r border-line px-3.5 py-3 last:border-r-0"
        >
          <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-mute-2">
            {cell.key}
          </div>
          <div
            className={
              cell.rust
                ? "mt-1.5 font-mono text-[17px] text-rust-deep"
                : "mt-1.5 font-mono text-[17px] text-ink"
            }
          >
            {cell.value}
          </div>
        </div>
      ))}
    </div>
  );
}
