import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type {
  ActualRankingItem,
  EvalRun,
  ExpectedRankingItem,
} from "@newsletter/shared/types/eval-ranking";

vi.mock("../../src/api/eval", async () => {
  const actual =
    await vi.importActual<typeof import("../../src/api/eval")>(
      "../../src/api/eval",
    );
  return {
    ...actual,
    getEvalRun: vi.fn(),
  };
});

import { RunDetailDrawer } from "../../src/components/eval/RunDetailDrawer";
import { getEvalRun } from "../../src/api/eval";

const getEvalRunMock = vi.mocked(getEvalRun);

function makeRun(overrides: Partial<EvalRun> = {}): EvalRun {
  return {
    id: "abc123def456",
    mode: "scored",
    fixtureId: "manual-curated-may-21",
    date: null,
    windowSize: null,
    draftPromptHash: "b8e7f203abcd",
    draftPromptSnapshot:
      "You are ranking AI news items.\nLine 2\nLine 3\nLine 4",
    savedPromptHash: null,
    savedPromptSnapshot: null,
    status: "done",
    startedAt: "2026-05-21T19:14:08.000Z",
    finishedAt: "2026-05-21T19:14:26.000Z",
    // Real jsonb shape returned by the API (see Stage B SPEC REQ-3):
    //   scoreBreakdown = { aggregate: { meanNdcgAt10 }, perFixture: [...] }
    //   costBreakdown  = { totalUsd, perFixture: [{ fixtureId, cost: {...} }] }
    scoreBreakdown: {
      aggregate: { meanNdcgAt10: 0.912 },
      perFixture: [
        {
          fixtureId: "manual-curated-may-21",
          status: "done",
          error: null,
          score: {
            ndcgAt10: 0.912,
            ndcgAt5: 0.943,
            precisionAt10: 0.8,
            mustIncludeRecall: 1.0,
            rankOneIsMustInclude: true,
          },
          cost: { usd: 0.014, tokensIn: 14283, tokensOut: 2847, cacheHit: false, promptHash: "b8e7f203abcd" },
        },
      ],
    },
    costBreakdown: {
      totalUsd: 0.014,
      perFixture: [
        {
          fixtureId: "manual-curated-may-21",
          cost: { usd: 0.014, tokensIn: 14283, tokensOut: 2847, cacheHit: false, promptHash: "b8e7f203abcd" },
        },
      ],
    },
    errorMessage: null,
    ...overrides,
  };
}

function renderDrawer(runId: string | null = "abc123def456"): {
  onClose: ReturnType<typeof vi.fn>;
} {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onClose = vi.fn();
  function Wrapper(): ReactElement {
    return (
      <QueryClientProvider client={client}>
        <RunDetailDrawer runId={runId} onClose={onClose} />
      </QueryClientProvider>
    );
  }
  render(<Wrapper />);
  return { onClose };
}

beforeEach(() => {
  getEvalRunMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("RunDetailDrawer", () => {
  it("renders run id, snapshot pane, and score+cost breakdowns for a done Mode A run", async () => {
    getEvalRunMock.mockResolvedValue(makeRun());
    renderDrawer();
    await screen.findByTestId("drawer-run-id");
    expect(screen.getByTestId("drawer-run-id").textContent).toContain("r/abc123");
    await screen.findByTestId("drawer-snapshot-pane");
    await screen.findByTestId("drawer-score-breakdown");
    await screen.findByTestId("drawer-cost-breakdown");
    const score = screen.getByTestId("drawer-score-breakdown");
    expect(score.textContent).toContain("nDCG@10");
    expect(score.textContent).toContain("0.912");
    expect(score.textContent).toContain("Rank-1 = must");
  });

  it("shows running placeholders for a running run", async () => {
    getEvalRunMock.mockResolvedValue(
      makeRun({
        status: "running",
        finishedAt: null,
        scoreBreakdown: null,
        costBreakdown: null,
      }),
    );
    renderDrawer();
    await screen.findByTestId("drawer-snapshot-pane");
    await waitFor(() => {
      expect(screen.getByTestId("drawer-running-placeholder-score")).toBeTruthy();
      expect(screen.getByTestId("drawer-running-placeholder-cost")).toBeTruthy();
    });
  });

  it("renders the error_message banner prominently for a failed run", async () => {
    getEvalRunMock.mockResolvedValue(
      makeRun({
        status: "failed",
        finishedAt: "2026-05-21T19:14:30.000Z",
        errorMessage: "rerank stage threw: token limit exceeded",
      }),
    );
    renderDrawer();
    const banner = await screen.findByTestId("drawer-error-banner");
    expect(banner.textContent).toContain("token limit exceeded");
  });

  it("does not fetch when runId is null (drawer closed)", () => {
    renderDrawer(null);
    expect(getEvalRunMock).not.toHaveBeenCalled();
  });
});

// --- Report tab ------------------------------------------------------------

function actual(
  rank: number,
  rawItemId: number,
  title: string,
  score: number,
  extras: Partial<ActualRankingItem> = {},
): ActualRankingItem {
  return {
    rawItemId,
    url: `https://example.com/${String(rawItemId)}`,
    title,
    score,
    rationale: extras.rationale ?? `because ${String(rank)}`,
    summary: extras.summary ?? `summary ${String(rank)}`,
    bullets: extras.bullets ?? [`bullet a${String(rank)}`, `bullet b${String(rank)}`],
    bottomLine: extras.bottomLine ?? `bottom ${String(rank)}`,
  };
}

function expected(
  rank: number,
  rawItemId: number,
  title: string,
  tier: ExpectedRankingItem["tier"],
): ExpectedRankingItem {
  return {
    rawItemId,
    url: `https://example.com/${String(rawItemId)}`,
    title,
    tier,
    rank,
  };
}

function makeRunWithReport(): EvalRun {
  // Scenario chosen to exercise all four delta cases:
  //   rawItemId 101 — expected rank 1 (must), actual rank 1  → "—" unchanged
  //   rawItemId 102 — expected rank 2 (must), actual rank 4  → ↓2
  //   rawItemId 103 — expected rank 4 (nice), actual rank 2  → ↑2
  //   rawItemId 104 — expected rank 5 (nice), actual rank 3  → ↑2
  //   rawItemId 999 — NOT in expected,        actual rank 5  → NEW
  //   rawItemId 105 — expected rank 3 (must), NOT in actual  → DROPPED + missing-must
  const actualRanking: ActualRankingItem[] = [
    actual(1, 101, "Rank 1 thing", 0.95),
    actual(2, 103, "Rank 2 thing", 0.84),
    actual(3, 104, "Rank 3 thing", 0.71),
    actual(4, 102, "Rank 4 thing", 0.6),
    actual(5, 999, "Wildcard new item", 0.5),
  ];
  const expectedRanking: ExpectedRankingItem[] = [
    expected(1, 101, "Rank 1 thing", "must"),
    expected(2, 102, "Rank 4 thing", "must"),
    expected(3, 105, "Dropped must thing", "must"),
    expected(4, 103, "Rank 2 thing", "nice"),
    expected(5, 104, "Rank 3 thing", "nice"),
  ];
  return makeRun({
    scoreBreakdown: {
      aggregate: { meanNdcgAt10: 0.71 },
      perFixture: [
        {
          fixtureId: "manual-curated-may-21",
          status: "done",
          error: null,
          score: {
            ndcgAt10: 0.71,
            ndcgAt5: 0.74,
            precisionAt10: 0.8,
            mustIncludeRecall: 0.67,
            rankOneIsMustInclude: true,
          },
          cost: {
            usd: 0.014,
            tokensIn: 14283,
            tokensOut: 2847,
            cacheHit: false,
            promptHash: "b8e7f203abcd",
          },
          actualRanking,
          expectedRanking,
        },
      ],
    },
  });
}

describe("RunDetailDrawer — Report tab", () => {
  it("renders both tabs and defaults to Report for a Mode A done run with report data", async () => {
    getEvalRunMock.mockResolvedValue(makeRunWithReport());
    renderDrawer();
    await screen.findByTestId("drawer-tab-breakdown");
    await screen.findByTestId("drawer-tab-report");
    await waitFor(() => {
      expect(
        screen.getByTestId("drawer-tab-report").getAttribute("aria-selected"),
      ).toBe("true");
    });
    await screen.findByTestId("drawer-tab-panel-report");
    await screen.findByTestId("drawer-report-table");
  });

  it("renders score strip, missing-must banner, and delta markers (↑, ↓, NEW, DROPPED)", async () => {
    getEvalRunMock.mockResolvedValue(makeRunWithReport());
    renderDrawer();
    const strip = await screen.findByTestId("drawer-report-score-strip");
    expect(strip.textContent).toContain("0.710");
    expect(strip.textContent).toContain("nDCG@10");
    const banner = await screen.findByTestId(
      "drawer-report-missing-must-banner",
    );
    expect(banner.textContent).toContain("1 must-include item");
    expect(banner.textContent).toContain("Dropped must thing");

    const table = await screen.findByTestId("drawer-report-table");
    expect(table.textContent).toContain("↓2");
    expect(table.textContent).toContain("↑2");
    expect(table.textContent).toContain("NEW");
    expect(table.textContent).toContain("DROPPED");
  });

  it("expander toggles rationale / summary / bullets / bottom line for an actual row", async () => {
    getEvalRunMock.mockResolvedValue(makeRunWithReport());
    renderDrawer();
    const rowOne = await screen.findByTestId("drawer-report-row-101");
    // Body not visible before click.
    expect(screen.queryByTestId("drawer-report-rationale-101")).toBeNull();
    const button = rowOne.querySelector('button[aria-expanded="false"]');
    if (button === null) throw new Error("expected collapsed expander button");
    fireEvent.click(button);
    const body = await screen.findByTestId("drawer-report-rationale-101");
    expect(body.textContent).toContain("because 1");
    expect(body.textContent).toContain("summary 1");
    expect(body.textContent).toContain("bullet a1");
    expect(body.textContent).toContain("bottom 1");
  });

  it("legacy Mode A run without actualRanking renders the empty-state", async () => {
    getEvalRunMock.mockResolvedValue(makeRun());
    renderDrawer();
    // Legacy runs lack reportData so the drawer defaults to Breakdown.
    await screen.findByTestId("drawer-tab-breakdown");
    fireEvent.click(screen.getByTestId("drawer-tab-report"));
    await screen.findByTestId("drawer-report-empty");
    expect(
      screen.getByTestId("drawer-report-empty").textContent,
    ).toContain("No report available");
  });

  it("Mode B run hides the Report tab entirely", async () => {
    getEvalRunMock.mockResolvedValue(
      makeRun({
        mode: "ab",
        fixtureId: null,
        date: "2026-05-21",
        scoreBreakdown: { saved: [{ rank: 1 }], draft: [{ rank: 1 }] },
        costBreakdown: {
          totalUsd: 0.02,
          saved: { usd: 0.01, tokensIn: 100, tokensOut: 50, cacheHit: false },
          draft: { usd: 0.01, tokensIn: 100, tokensOut: 50, cacheHit: false },
        },
      }),
    );
    renderDrawer();
    await screen.findByTestId("drawer-tab-breakdown");
    expect(screen.queryByTestId("drawer-tab-report")).toBeNull();
  });

  it("preserves existing Breakdown test IDs after the tab refactor", async () => {
    getEvalRunMock.mockResolvedValue(makeRunWithReport());
    renderDrawer();
    fireEvent.click(await screen.findByTestId("drawer-tab-breakdown"));
    await screen.findByTestId("drawer-tab-panel-breakdown");
    await screen.findByTestId("drawer-score-breakdown");
    await screen.findByTestId("drawer-cost-breakdown");
  });
});
