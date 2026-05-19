import type { ReactElement } from "react";
import type { RunCostBreakdown } from "@newsletter/shared";
import { Button } from "@/components/ui/button";
import { formatCostUsd } from "./cost-format";

interface CostButtonProps {
  costBreakdown: RunCostBreakdown | null;
  onClick: () => void;
}

export function CostButton({
  costBreakdown,
  onClick,
}: CostButtonProps): ReactElement {
  const label =
    costBreakdown === null
      ? "Cost"
      : costBreakdown.totalCostUsd === null
        ? "Cost: ?"
        : `Cost: ${formatCostUsd(costBreakdown.totalCostUsd)}`;
  const showWarning =
    costBreakdown !== null && costBreakdown.totalCostUsd === null;
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
