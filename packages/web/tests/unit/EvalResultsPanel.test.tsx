import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  EvalResultsPanel,
  type EvalProgressRow,
} from "../../src/components/eval/EvalResultsPanel";
import type {
  EvalScore,
  PerFixtureCost,
} from "@newsletter/shared/types/eval-ranking";

afterEach(() => {
  cleanup();
});

function score(over: Partial<EvalScore> = {}): EvalScore {
  return {
    fixtureId: "fx-1",
    ndcgAt10: 0.8,
    precisionAt10: 0.6,
    mustIncludeRecall: 0.5,
    rankOneIsMustInclude: true,
    perItemDiff: [],
    ranAt: "2026-05-22T00:00:00Z",
    promptHash: "abc",
    model: "claude-haiku-4-5-20251001",
    ...over,
  };
}

function cost(over: Partial<PerFixtureCost> = {}): PerFixtureCost {
  return {
    promptHash: "abc",
    tokensIn: 100,
    tokensOut: 50,
    usd: 0.01,
    cacheHit: false,
    ...over,
  };
}

describe("EvalResultsPanel", () => {
  it("renders aggregate + per-fixture rows", () => {
    const rows: EvalProgressRow[] = [
      {
        fixtureId: "fx-1",
        status: "done",
        score: score({ fixtureId: "fx-1", ndcgAt10: 0.8 }),
        cost: cost({ usd: 0.01 }),
      },
      {
        fixtureId: "fx-2",
        status: "done",
        score: score({ fixtureId: "fx-2", ndcgAt10: 0.6 }),
        cost: cost({ usd: 0.02, cacheHit: true }),
      },
    ];
    render(
      <EvalResultsPanel rows={rows} totalUsd={0.03} running={false} />,
    );
    expect(screen.getAllByTestId("eval-result-row")).toHaveLength(2);
    expect(screen.getByTestId("eval-results-aggregate").textContent).toContain(
      "0.700",
    );
    expect(screen.getByTestId("eval-results-aggregate").textContent).toContain(
      "$0.0300",
    );
  });

  it("renders empty state when no rows", () => {
    render(<EvalResultsPanel rows={[]} totalUsd={null} running={false} />);
    expect(screen.getByText(/no runs yet/i)).toBeTruthy();
  });
});
