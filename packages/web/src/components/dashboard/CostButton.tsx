import type { ReactElement } from "react";
import type { RunCostBreakdown } from "@newsletter/shared";
import { Button } from "@/components/ui/button";
import { formatCostUsd } from "./cost-format";

interface CostButtonProps {
  costBreakdown: RunCostBreakdown | null | undefined;
  onClick: () => void;
}

export function CostButton({
  costBreakdown,
  onClick,
}: CostButtonProps): ReactElement {
  // Treat undefined as null: API responses from older deploys omit the field
  // entirely instead of returning `null`. Crashing the whole dashboard for one
  // missing field is worse than rendering the pre-feature "Cost" label.
  const cb = costBreakdown ?? null;
  const label =
    cb === null
      ? "Cost"
      : cb.totalCostUsd === null
        ? "Cost: ?"
        : `Cost: ${formatCostUsd(cb.totalCostUsd)}`;
  const showWarning = cb !== null && cb.totalCostUsd === null;
  return (
    <Button
      variant="outline"
      size="sm"
      data-testid="cost-button"
      onClick={onClick}
    >
      <span>{label}</span>
      {showWarning ? (
        <span
          data-testid="cost-warning"
          aria-label="Cost data incomplete"
          title="Cost data incomplete — some models have unknown pricing"
          className="ml-1.5 inline-block h-2 w-2 rounded-full bg-amber-500"
        />
      ) : null}
    </Button>
  );
}
