import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type {
  RunCostBreakdown,
  RunSummary,
  StageCost,
  ModelStageCost,
} from "@newsletter/shared";
import { CostDialog } from "../../../../src/components/dashboard/CostDialog";

afterEach(() => {
  cleanup();
});

function makeModel(overrides: Partial<ModelStageCost> = {}): ModelStageCost {
  return {
    modelId: "claude-haiku-4-5",
    calls: 1,
    costUsd: 0.05,
    inputTokens: 1000,
    outputTokens: 500,
    cachedInputTokens: 0,
    cacheCreation5mTokens: 0,
    cacheCreation1hTokens: 0,
    reasoningTokens: 0,
    ...overrides,
  };
}

function makeStage(overrides: Partial<StageCost> = {}): StageCost {
  const model = makeModel();
  return {
    calls: 1,
    costUsd: 0.05,
    costStatus: "ok",
    byModel: [model],
    ...overrides,
  };
}

function makeBreakdown(overrides: Partial<RunCostBreakdown> = {}): RunCostBreakdown {
  return {
    schemaVersion: 1,
    totalCostUsd: 0.637,
    stages: { rank: makeStage() },
    unknownModels: [],
    generatedAt: "2026-05-19T00:00:00Z",
    ...overrides,
  };
}

function makeRun(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    runId: "run-A",
    startedAt: "2026-05-19T12:00:00Z",
    completedAt: "2026-05-19T12:05:00Z",
    status: "completed",
    itemCount: 10,
    reviewed: true,
    isDryRun: false,
    costBreakdown: makeBreakdown(),
    ...overrides,
  };
}

describe("CostDialog (REQ-064..REQ-068, EDGE-005/010/011)", () => {
  it("REQ-064: renders eight column headers when breakdown is non-null", () => {
    render(
      <CostDialog open onOpenChange={() => undefined} run={makeRun()} />,
    );
    for (const header of [
      "Stage",
      "Calls",
      "In tok",
      "Out tok",
      "Cached",
      "Thinking",
      "Model",
      "Cost",
    ]) {
      expect(
        screen.getByRole("columnheader", { name: header }),
      ).toBeTruthy();
    }
  });

  it("REQ-065: renders empty-state copy referencing COST_TRACKING_LAUNCHED_AT when costBreakdown is null", () => {
    render(
      <CostDialog
        open
        onOpenChange={() => undefined}
        run={makeRun({ costBreakdown: null })}
      />,
    );
    expect(
      screen.getByText(/Cost tracking was added on/i),
    ).toBeTruthy();
    expect(screen.getByText(/2026-05-19/)).toBeTruthy();
  });

  it("EDGE-011: renders empty state when schemaVersion is not 1", () => {
    const bad = {
      ...makeBreakdown(),
      schemaVersion: 2 as unknown as 1,
    };
    render(
      <CostDialog
        open
        onOpenChange={() => undefined}
        run={makeRun({ costBreakdown: bad })}
      />,
    );
    expect(screen.getByText(/Cost tracking was added on/i)).toBeTruthy();
  });

  it("REQ-066, EDGE-005: stage with 2 byModel entries renders aggregate + 2 sub-rows", () => {
    const stage = makeStage({
      calls: 3,
      costUsd: 0.2,
      byModel: [
        makeModel({ modelId: "claude-haiku-4-5", calls: 2, costUsd: 0.1 }),
        makeModel({ modelId: "claude-sonnet-4-5", calls: 1, costUsd: 0.1 }),
      ],
    });
    render(
      <CostDialog
        open
        onOpenChange={() => undefined}
        run={makeRun({
          costBreakdown: makeBreakdown({ stages: { rank: stage } }),
        })}
      />,
    );
    const rows = document.querySelectorAll('tr[data-stage="rank"]');
    expect(rows.length).toBe(3);
  });

  it("REQ-067: zero-call stage renders dash placeholders in numeric cells", () => {
    render(
      <CostDialog
        open
        onOpenChange={() => undefined}
        run={makeRun({
          costBreakdown: makeBreakdown({ stages: {} }),
        })}
      />,
    );
    const rows = document.querySelectorAll('tr[data-stage]');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of Array.from(rows)) {
      expect(row.textContent).toContain("—");
    }
  });

  it("REQ-068: header shows 'Total: $0.637' for numeric total", () => {
    render(
      <CostDialog
        open
        onOpenChange={() => undefined}
        run={makeRun({ costBreakdown: makeBreakdown({ totalCostUsd: 0.637 }) })}
      />,
    );
    expect(screen.getByText(/Total:\s*\$0\.637/)).toBeTruthy();
  });

  it("REQ-068: header shows 'Total: ?' for null total", () => {
    render(
      <CostDialog
        open
        onOpenChange={() => undefined}
        run={makeRun({ costBreakdown: makeBreakdown({ totalCostUsd: null }) })}
      />,
    );
    expect(screen.getByText(/Total:\s*\?/)).toBeTruthy();
  });

  it("EDGE-010: switching from run A to run B shows run B's breakdown (no stale data)", () => {
    const runA = makeRun({
      runId: "A",
      costBreakdown: makeBreakdown({ totalCostUsd: 0.111 }),
    });
    const runB = makeRun({
      runId: "B",
      costBreakdown: makeBreakdown({ totalCostUsd: 0.222 }),
    });
    const { rerender } = render(
      <CostDialog open onOpenChange={() => undefined} run={runA} />,
    );
    expect(screen.getByText(/Total:\s*\$0\.111/)).toBeTruthy();
    rerender(<CostDialog open onOpenChange={() => undefined} run={runB} />);
    expect(screen.getByText(/Total:\s*\$0\.222/)).toBeTruthy();
    expect(screen.queryByText(/Total:\s*\$0\.111/)).toBeNull();
  });

  it("renders nothing when run is null", () => {
    const { container } = render(
      <CostDialog open onOpenChange={() => undefined} run={null} />,
    );
    expect(container.textContent).toBe("");
  });
});
