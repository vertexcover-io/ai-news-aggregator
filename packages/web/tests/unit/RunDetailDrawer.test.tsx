import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { EvalRun } from "@newsletter/shared/types/eval-ranking";

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
    scoreBreakdown: {
      ndcgAt10: 0.912,
      ndcgAt5: 0.943,
      precisionAt10: 0.8,
      mustIncludeRecall: 1.0,
      rankOneIsMustInclude: true,
    },
    costBreakdown: { tokensIn: 14283, tokensOut: 2847, usd: 0.014 },
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
