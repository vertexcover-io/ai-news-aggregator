import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { RunCostBreakdown } from "@newsletter/shared";
import { CostBreakdownCard } from "../../../src/components/admin/CostBreakdownCard";

afterEach(() => {
  cleanup();
});

const filledBreakdown: RunCostBreakdown = {
  stages: {
    webListing: {
      inputTokens: 1000,
      outputTokens: 200,
      callCount: 1,
      usdCost: 0.002,
      model: "claude-haiku-4-5-20251001",
    },
    webExtraction: {
      inputTokens: 4000,
      outputTokens: 600,
      callCount: 2,
      usdCost: 0.007,
      model: "claude-haiku-4-5-20251001",
    },
    rank: {
      inputTokens: 5000,
      outputTokens: 800,
      callCount: 1,
      usdCost: 0.009,
      model: "claude-haiku-4-5-20251001",
    },
    recap: {
      inputTokens: 2000,
      outputTokens: 400,
      callCount: 1,
      usdCost: 0.004,
      model: "claude-haiku-4-5-20251001",
    },
  },
  totalUsdCost: 0.022,
  totalInputTokens: 12000,
  totalOutputTokens: 2000,
  capturedAt: "2026-05-18T10:00:00.000Z",
};

describe("CostBreakdownCard", () => {
  it("renders empty state when costBreakdown is null", () => {
    render(<CostBreakdownCard costBreakdown={null} />);
    expect(
      screen.getByText("No cost data captured for this run."),
    ).toBeDefined();
  });

  it("renders all four stage rows and a total", () => {
    render(<CostBreakdownCard costBreakdown={filledBreakdown} />);
    expect(screen.getByText("Web listing")).toBeDefined();
    expect(screen.getByText("Web extraction")).toBeDefined();
    expect(screen.getByText("Rank")).toBeDefined();
    expect(screen.getByText("Recap")).toBeDefined();
    expect(screen.getByText("Total")).toBeDefined();
    expect(screen.getByText(/Rates as of 2026-05-18/)).toBeDefined();
  });

  it("shows a warning badge when a stage has missingUsageCallCount", () => {
    const withWarning: RunCostBreakdown = {
      ...filledBreakdown,
      stages: {
        ...filledBreakdown.stages,
        rank: {
          inputTokens: 0,
          outputTokens: 0,
          callCount: 1,
          usdCost: 0,
          model: "claude-haiku-4-5-20251001",
          missingUsageCallCount: 1,
        },
      },
    };
    render(<CostBreakdownCard costBreakdown={withWarning} />);
    expect(screen.getByText("warning")).toBeDefined();
    expect(screen.getByText(/missing usage/)).toBeDefined();
  });

  it("shows a warning when unknownModelCallCount > 0", () => {
    const withUnknown: RunCostBreakdown = {
      ...filledBreakdown,
      stages: {
        rank: {
          inputTokens: 100,
          outputTokens: 50,
          callCount: 1,
          usdCost: 0,
          model: "future-model",
          unknownModelCallCount: 1,
        },
      },
    };
    render(<CostBreakdownCard costBreakdown={withUnknown} />);
    expect(screen.getByText("warning")).toBeDefined();
    expect(screen.getByText(/unknown model/)).toBeDefined();
  });
});
