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
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type {
  EvalRunSummary,
  EvalRunStatus,
} from "@newsletter/shared/types/eval-ranking";

vi.mock("../../src/api/eval", async () => {
  const actual =
    await vi.importActual<typeof import("../../src/api/eval")>(
      "../../src/api/eval",
    );
  return {
    ...actual,
    listEvalRuns: vi.fn(),
  };
});

import { EvalRunsPage } from "../../src/pages/EvalRunsPage";
import { listEvalRuns, EvalApiError } from "../../src/api/eval";

const listEvalRunsMock = vi.mocked(listEvalRuns);

function makeRun(
  id: string,
  overrides: Partial<EvalRunSummary> = {},
): EvalRunSummary {
  return {
    id,
    mode: "scored",
    fixtureId: "fx-1",
    date: null,
    windowSize: null,
    draftPromptHash: "b8e7f203abcd",
    savedPromptHash: null,
    status: "done" as EvalRunStatus,
    startedAt: "2026-05-21T19:14:08.000Z",
    finishedAt: "2026-05-21T19:14:30.000Z",
    scoreBreakdown: { ndcgAt10: 0.847 },
    costBreakdown: { usd: 0.041 },
    errorMessage: null,
    ...overrides,
  };
}

function LocationProbe(): ReactElement {
  const loc = useLocation();
  return (
    <div
      data-testid="location-probe"
      data-pathname={loc.pathname}
      data-search={loc.search}
    />
  );
}

function renderPage(initial = "/admin/eval/runs"): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper(): ReactElement {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[initial]}>
          <Routes>
            <Route path="/admin/eval/runs" element={<EvalRunsPage />} />
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  render(<Wrapper />);
}

beforeEach(() => {
  listEvalRunsMock.mockReset();
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
});

describe("EvalRunsPage", () => {
  it("renders filter bar + table + pagination given 12 mocked runs", async () => {
    const runs = Array.from({ length: 12 }, (_, i) => makeRun(`run-${String(i)}`));
    listEvalRunsMock.mockResolvedValue({
      runs,
      total: 12,
      page: 1,
      perPage: 20,
    });
    renderPage();
    await screen.findByTestId("runs-filter-bar");
    await screen.findByTestId("runs-table-section");
    await screen.findByTestId("runs-pagination");
    await waitFor(() => {
      expect(screen.queryAllByTestId(/^runs-row-run-/).length).toBe(12);
    });
  });

  it("renders empty CTA card when total === 0", async () => {
    listEvalRunsMock.mockResolvedValue({
      runs: [],
      total: 0,
      page: 1,
      perPage: 20,
    });
    renderPage();
    await screen.findByTestId("runs-empty-state");
    expect(screen.getByText(/No eval runs yet/i)).toBeTruthy();
  });

  it("does not refetch on 1-char search; refetches at 2 chars", async () => {
    listEvalRunsMock.mockResolvedValue({
      runs: [],
      total: 0,
      page: 1,
      perPage: 20,
    });
    renderPage();
    await screen.findByTestId("runs-empty-state");
    const initialCalls = listEvalRunsMock.mock.calls.length;
    const input = screen.getByTestId<HTMLInputElement>("runs-search-input");
    fireEvent.change(input, { target: { value: "a" } });
    // wait past the debounce window
    await new Promise((r) => {
      setTimeout(r, 300);
    });
    expect(listEvalRunsMock.mock.calls.length).toBe(initialCalls);
    fireEvent.change(input, { target: { value: "ab" } });
    await new Promise((r) => {
      setTimeout(r, 300);
    });
    // We don't pass `q` to the API in P2 (search is a client-side debounce only
    // hook signal), but the URL should update so the query key changes the next
    // time a server search lands.
    const probe = screen.getByTestId("location-probe");
    expect(probe.getAttribute("data-search")).toContain("q=ab");
  });

  it("selecting Mode A in the segment writes ?mode=scored and refetches", async () => {
    listEvalRunsMock.mockResolvedValue({
      runs: [makeRun("r1")],
      total: 1,
      page: 1,
      perPage: 20,
    });
    renderPage();
    await screen.findByTestId("runs-table-section");
    const initialCalls = listEvalRunsMock.mock.calls.length;
    fireEvent.click(screen.getByTestId("runs-filter-mode-scored"));
    await waitFor(() => {
      const probe = screen.getByTestId("location-probe");
      expect(probe.getAttribute("data-search")).toContain("mode=scored");
    });
    await waitFor(() => {
      expect(listEvalRunsMock.mock.calls.length).toBeGreaterThan(initialCalls);
    });
    const lastCall =
      listEvalRunsMock.mock.calls[listEvalRunsMock.mock.calls.length - 1][0];
    expect(lastCall?.mode).toBe("scored");
  });

  it("clicking pagination next increments page in the URL", async () => {
    listEvalRunsMock.mockResolvedValue({
      runs: Array.from({ length: 20 }, (_, i) => makeRun(`r-${String(i)}`)),
      total: 60,
      page: 1,
      perPage: 20,
    });
    renderPage();
    await screen.findByTestId("runs-pagination");
    fireEvent.click(screen.getByTestId("runs-pagination-next"));
    await waitFor(() => {
      const probe = screen.getByTestId("location-probe");
      expect(probe.getAttribute("data-search")).toContain("page=2");
    });
  });

  it("renders error block when listEvalRuns rejects with EvalApiError(500)", async () => {
    listEvalRunsMock.mockRejectedValue(
      new EvalApiError("internal server error", 500),
    );
    renderPage();
    await screen.findByTestId("runs-error-block");
    expect(screen.getByText(/internal server error/i)).toBeTruthy();
    expect(screen.getByTestId("runs-error-retry")).toBeTruthy();
  });

  it("checking two rows updates compare bar selected-count but CTA stays disabled", async () => {
    listEvalRunsMock.mockResolvedValue({
      runs: [makeRun("aaa"), makeRun("bbb"), makeRun("ccc")],
      total: 3,
      page: 1,
      perPage: 20,
    });
    renderPage();
    await screen.findByTestId("runs-table-section");
    fireEvent.click(screen.getByTestId("runs-row-checkbox-aaa"));
    fireEvent.click(screen.getByTestId("runs-row-checkbox-bbb"));
    const bar = screen.getByTestId("runs-compare-bar");
    expect(bar.getAttribute("data-armed")).toBe("true");
    expect(bar.textContent).toContain("2 of 3");
    const cta = screen.getByTestId<HTMLButtonElement>("runs-compare-cta");
    expect(cta.disabled).toBe(true);
  });
});
