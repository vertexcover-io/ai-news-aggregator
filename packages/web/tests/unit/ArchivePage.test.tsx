import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactElement, ReactNode } from "react";
import { ArchivePage } from "../../src/pages/ArchivePage";
import type { RunStateResponse } from "../../src/api/runs";

vi.mock("../../src/hooks/useRunState", () => ({
  useRunState: vi.fn(),
}));

import { useRunState } from "../../src/hooks/useRunState";

function renderWithClient(ui: ReactElement, runId = "run-123"): ReturnType<typeof render> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/archive/${runId}`]}>
        <Routes>
          <Route path="/archive/:runId" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(ui, { wrapper });
}

const baseCompletedRun: RunStateResponse = {
  id: "run-123",
  status: "completed",
  stage: "completed",
  topN: 10,
  startedAt: "2026-04-13T10:00:00Z",
  updatedAt: "2026-04-13T10:00:10Z",
  completedAt: "2026-04-13T10:00:10Z",
  sources: { hn: { status: "completed", itemsFetched: 5, errors: [] } },
  rankedItems: [
    {
      id: 1,
      rawItemId: 101,
      score: 0.95,
      title: "Test Story One",
      url: "https://example.com/1",
      sourceType: "hn",
      author: "alice",
      publishedAt: "2026-04-13T09:00:00Z",
      content: "Some content",
      engagement: { points: 100, commentCount: 20 },
      rationale: "This is very relevant",
      imageUrl: null,
      recap: null,
    },
    {
      id: 2,
      rawItemId: 102,
      score: 0.80,
      title: "Test Story Two",
      url: "https://example.com/2",
      sourceType: "reddit",
      author: null,
      publishedAt: null,
      content: null,
      engagement: { points: 50, commentCount: 10 },
      rationale: "Also relevant",
      imageUrl: null,
      recap: null,
    },
  ],
  warnings: [],
  error: null,
};

describe("ArchivePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows loading state while fetching (REQ-005)", () => {
    vi.mocked(useRunState).mockReturnValue({
      isLoading: true,
      data: undefined,
      error: null,
      isError: false,
      isPending: true,
      isFetching: true,
      isSuccess: false,
      status: "pending",
    } as ReturnType<typeof useRunState>);

    renderWithClient(<ArchivePage />);
    expect(screen.getByText(/loading/i)).toBeTruthy();
  });

  it("shows 'Run not found — it may have expired.' when data is null (REQ-006)", () => {
    vi.mocked(useRunState).mockReturnValue({
      isLoading: false,
      data: null,
      error: null,
      isError: false,
      isPending: false,
      isFetching: false,
      isSuccess: true,
      status: "success",
    } as ReturnType<typeof useRunState>);

    renderWithClient(<ArchivePage />);
    expect(
      screen.getByText("Run not found — it may have expired."),
    ).toBeTruthy();
  });

  it("shows 'Run is still in progress — check back soon.' when status is 'running' (REQ-007)", () => {
    const runningRun: RunStateResponse = {
      ...baseCompletedRun,
      status: "running",
      stage: "collecting",
      completedAt: null,
      rankedItems: null,
    };
    vi.mocked(useRunState).mockReturnValue({
      isLoading: false,
      data: runningRun,
      error: null,
      isError: false,
      isPending: false,
      isFetching: false,
      isSuccess: true,
      status: "success",
    } as ReturnType<typeof useRunState>);

    renderWithClient(<ArchivePage />);
    expect(
      screen.getByText("Run is still in progress — check back soon."),
    ).toBeTruthy();
  });

  it("shows 'Run is still in progress — check back soon.' when status is 'failed' (EDGE-009)", () => {
    const failedRun: RunStateResponse = {
      ...baseCompletedRun,
      status: "failed",
      stage: "failed",
      completedAt: null,
      rankedItems: null,
    };
    vi.mocked(useRunState).mockReturnValue({
      isLoading: false,
      data: failedRun,
      error: null,
      isError: false,
      isPending: false,
      isFetching: false,
      isSuccess: true,
      status: "success",
    } as ReturnType<typeof useRunState>);

    renderWithClient(<ArchivePage />);
    expect(
      screen.getByText("Run is still in progress — check back soon."),
    ).toBeTruthy();
  });

  it("shows back link to /run when run is not completed (REQ-007)", () => {
    const runningRun: RunStateResponse = {
      ...baseCompletedRun,
      status: "running",
      stage: "collecting",
      completedAt: null,
      rankedItems: null,
    };
    vi.mocked(useRunState).mockReturnValue({
      isLoading: false,
      data: runningRun,
      error: null,
      isError: false,
      isPending: false,
      isFetching: false,
      isSuccess: true,
      status: "success",
    } as ReturnType<typeof useRunState>);

    renderWithClient(<ArchivePage />);
    const backLink = screen.getByRole("link", { name: /back/i });
    expect(backLink).toBeTruthy();
    expect(backLink.getAttribute("href")).toBe("/run");
  });

  it("renders ArchivePageHeader and story cards when completed (REQ-008, REQ-009)", () => {
    vi.mocked(useRunState).mockReturnValue({
      isLoading: false,
      data: baseCompletedRun,
      error: null,
      isError: false,
      isPending: false,
      isFetching: false,
      isSuccess: true,
      status: "success",
    } as ReturnType<typeof useRunState>);

    renderWithClient(<ArchivePage />);
    expect(screen.getByRole("heading", { name: "AI Newsletter" })).toBeTruthy();
    const articles = screen.getAllByRole("article");
    expect(articles).toHaveLength(2);
  });

  it("renders correct number of cards matching rankedItems length (REQ-009)", () => {
    vi.mocked(useRunState).mockReturnValue({
      isLoading: false,
      data: baseCompletedRun,
      error: null,
      isError: false,
      isPending: false,
      isFetching: false,
      isSuccess: true,
      status: "success",
    } as ReturnType<typeof useRunState>);

    renderWithClient(<ArchivePage />);
    const articles = screen.getAllByRole("article");
    expect(articles).toHaveLength(
      (baseCompletedRun.rankedItems ?? []).length,
    );
  });

  it("renders 0 cards and header shows '0 stories' when rankedItems is [] (EDGE-002)", () => {
    const emptyRun: RunStateResponse = {
      ...baseCompletedRun,
      rankedItems: [],
    };
    vi.mocked(useRunState).mockReturnValue({
      isLoading: false,
      data: emptyRun,
      error: null,
      isError: false,
      isPending: false,
      isFetching: false,
      isSuccess: true,
      status: "success",
    } as ReturnType<typeof useRunState>);

    renderWithClient(<ArchivePage />);
    expect(screen.getByText(/0 stories/)).toBeTruthy();
    expect(screen.queryAllByRole("article")).toHaveLength(0);
  });

  it("uses max-w-2xl centered layout when completed (REQ-021)", () => {
    vi.mocked(useRunState).mockReturnValue({
      isLoading: false,
      data: baseCompletedRun,
      error: null,
      isError: false,
      isPending: false,
      isFetching: false,
      isSuccess: true,
      status: "success",
    } as ReturnType<typeof useRunState>);

    const { container } = renderWithClient(<ArchivePage />);
    const centeredDiv = container.querySelector(".max-w-2xl.mx-auto");
    expect(centeredDiv).not.toBeNull();
  });

  it("shows generic error when network request throws (EDGE-008)", () => {
    vi.mocked(useRunState).mockReturnValue({
      isLoading: false,
      data: undefined,
      error: new Error("Network failure"),
      isError: true,
      isPending: false,
      isFetching: false,
      isSuccess: false,
      status: "error",
    } as ReturnType<typeof useRunState>);

    renderWithClient(<ArchivePage />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /back/i }),
    ).toBeTruthy();
  });
});
