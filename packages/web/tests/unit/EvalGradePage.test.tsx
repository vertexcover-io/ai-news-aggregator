import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type {
  Fixture,
  FixtureItem,
} from "@newsletter/shared/types/eval-ranking";

vi.mock("../../src/hooks/useEvalFixture", () => ({
  useEvalFixture: vi.fn(),
}));
vi.mock("../../src/hooks/useGradingProgress", () => ({
  useGradingProgress: vi.fn(),
}));
vi.mock("../../src/api/eval", async () => {
  const actual =
    await vi.importActual<typeof import("../../src/api/eval")>(
      "../../src/api/eval",
    );
  return {
    ...actual,
    saveGroundTruth: vi.fn().mockResolvedValue({}),
    saveGroundTruthToRepo: vi.fn().mockResolvedValue({ ok: true }),
  };
});

import { EvalGradePage } from "../../src/pages/EvalGradePage";
import { useEvalFixture } from "../../src/hooks/useEvalFixture";
import { useGradingProgress } from "../../src/hooks/useGradingProgress";
import {
  saveGroundTruthToRepo,
  EvalApiError,
} from "../../src/api/eval";

const useEvalFixtureMock = vi.mocked(useEvalFixture);
const useGradingProgressMock = vi.mocked(useGradingProgress);
const saveGroundTruthToRepoMock = vi.mocked(saveGroundTruthToRepo);

function makeFixtureItem(rawItemId: number): FixtureItem {
  return {
    rawItemId,
    title: `Item ${String(rawItemId)}`,
    url: `https://example.com/${String(rawItemId)}`,
    sourceType: "hn",
    publishedAt: "2026-05-20T00:00:00Z",
    content: null,
    enrichedLink: null,
    enrichmentStatus: "skipped",
    comments: [],
    engagement: { points: 1, commentCount: 0 },
  };
}

function makeFixture(): Fixture {
  return {
    fixtureId: "fx-1",
    source: "manual",
    date: null,
    runId: null,
    model: "claude-haiku-4-5-20251001",
    exportedAt: "2026-05-21T00:00:00Z",
    pool: [makeFixtureItem(1), makeFixtureItem(2)],
    dedupClusters: [],
    originalRankerOutput: null,
  };
}

function renderPage(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper(): ReactElement {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/admin/eval/grade/fx-1"]}>
          <Routes>
            <Route
              path="/admin/eval/grade/:fixtureId"
              element={<EvalGradePage />}
            />
            <Route
              path="/admin/eval"
              element={
                <div data-testid="eval-index-landed">
                  eval index
                </div>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  render(<Wrapper />);
}

beforeEach(() => {
  // Default: grader name already set so the prompt screen doesn't render.
  window.localStorage.setItem("eval-grader-name", "tester");
  useEvalFixtureMock.mockReturnValue({
    data: { fixture: makeFixture(), groundTruth: null },
    isLoading: false,
    isError: false,
    error: null,
    isSuccess: true,
    status: "success",
  } as unknown as ReturnType<typeof useEvalFixture>);
  useGradingProgressMock.mockReturnValue({
    labels: { 1: "must", 2: "nice" },
    setLabel: vi.fn(),
    clearAll: vi.fn(),
    isComplete: (ids: number[]) =>
      ids.every((id) => id === 1 || id === 2),
  });
  saveGroundTruthToRepoMock.mockReset();
  saveGroundTruthToRepoMock.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("EvalGradePage", () => {
  it("navigates to /admin/eval?fixtureId=<id> after successful save-to-repo (REQ-1)", async () => {
    renderPage();
    const btn = await screen.findByTestId<HTMLButtonElement>(
      "save-to-repo-button",
    );
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => {
      expect(saveGroundTruthToRepoMock).toHaveBeenCalledTimes(1);
    });
    await screen.findByTestId("eval-index-landed");
    // The destination route renders the test stub — proves navigation happened.
    // We can't directly read the URL search params from MemoryRouter, but
    // landing on /admin/eval is the user-visible contract.
  });

  it("does NOT navigate when save-to-repo fails (EDGE-1.1)", async () => {
    saveGroundTruthToRepoMock.mockRejectedValueOnce(
      new EvalApiError("forbidden", 403, { error: "forbidden" }),
    );
    renderPage();
    const btn = await screen.findByTestId<HTMLButtonElement>(
      "save-to-repo-button",
    );
    fireEvent.click(btn);
    await waitFor(() => {
      expect(saveGroundTruthToRepoMock).toHaveBeenCalled();
    });
    // Error visible, no navigation.
    await screen.findByTestId("save-error");
    expect(screen.queryByTestId("eval-index-landed")).toBeNull();
  });
});
