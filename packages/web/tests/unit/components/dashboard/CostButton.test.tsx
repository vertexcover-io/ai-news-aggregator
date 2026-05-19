import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { RunCostBreakdown } from "@newsletter/shared";
import { CostButton } from "../../../../src/components/dashboard/CostButton";

afterEach(() => {
  cleanup();
});

function makeBreakdown(overrides: Partial<RunCostBreakdown> = {}): RunCostBreakdown {
  return {
    schemaVersion: 1,
    totalCostUsd: 0.637,
    stages: {},
    unknownModels: [],
    generatedAt: "2026-05-19T00:00:00Z",
    ...overrides,
  };
}

describe("CostButton (REQ-061..REQ-063)", () => {
  it("REQ-063: label is 'Cost' when costBreakdown is null", () => {
    render(<CostButton costBreakdown={null} onClick={() => undefined} />);
    const btn = screen.getByTestId("cost-button");
    expect(btn.textContent).toContain("Cost");
    expect(btn.textContent).not.toContain("$");
    expect(btn.textContent).not.toContain("?");
    expect(screen.queryByTestId("cost-warning")).toBeNull();
  });

  it("REQ-061: label is 'Cost: $0.637' when totalCostUsd is 0.637", () => {
    render(
      <CostButton
        costBreakdown={makeBreakdown({ totalCostUsd: 0.637 })}
        onClick={() => undefined}
      />,
    );
    const btn = screen.getByTestId("cost-button");
    expect(btn.textContent).toContain("Cost: $0.637");
    expect(screen.queryByTestId("cost-warning")).toBeNull();
  });

  it("REQ-062: label is 'Cost: ?' with warning indicator when totalCostUsd is null", () => {
    render(
      <CostButton
        costBreakdown={makeBreakdown({ totalCostUsd: null })}
        onClick={() => undefined}
      />,
    );
    const btn = screen.getByTestId("cost-button");
    expect(btn.textContent).toContain("Cost: ?");
    expect(screen.getByTestId("cost-warning")).toBeTruthy();
  });

  it("invokes onClick when clicked", () => {
    const onClick = vi.fn();
    render(<CostButton costBreakdown={null} onClick={onClick} />);
    fireEvent.click(screen.getByTestId("cost-button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
