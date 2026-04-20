import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactElement, ReactNode } from "react";
import { ArchivePage } from "../../src/pages/ArchivePage";
import type { RunStateResponse } from "../../src/api/runs";

vi.mock("../../src/hooks/useArchive", () => ({
  useArchive: vi.fn(),
}));

import { useArchive } from "../../src/hooks/useArchive";

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
    document.title = "";
  });

  afterEach(() => {
    cleanup();
  });

  it("loading state: element with role=status and aria-busy=true renders (REQ-020, EDGE-016)", () => {
    vi.mocked(useArchive).mockReturnValue({
      isLoading: true,
      data: undefined,
      error: null,
      isError: false,
      isPending: true,
      isFetching: true,
      isSuccess: false,
      status: "pending",
    } as ReturnType<typeof useArchive>);

    renderWithClient(<ArchivePage />);
    const skeleton = screen.getByRole("status");
    expect(skeleton).toBeTruthy();
    expect(skeleton.getAttribute("aria-busy")).toBe("true");
  });

  it("error state: ERROR eyebrow, Couldn't load this issue headline, and ← All issues link (REQ-021, EDGE-013)", () => {
    vi.mocked(useArchive).mockReturnValue({
      isLoading: false,
      data: undefined,
      error: new Error("Network failure"),
      isError: true,
      isPending: false,
      isFetching: false,
      isSuccess: false,
      status: "error",
    } as ReturnType<typeof useArchive>);

    renderWithClient(<ArchivePage />);
    expect(screen.getByText("ERROR")).toBeTruthy();
    expect(screen.getByText("Couldn't load this issue")).toBeTruthy();
    const link = screen.getByRole("link", { name: "← All issues" });
    expect(link.getAttribute("href")).toBe("/");
  });

  it("not-found state: This issue isn't here and subtitle text (REQ-022, EDGE-017)", () => {
    vi.mocked(useArchive).mockReturnValue({
      isLoading: false,
      data: null,
      error: null,
      isError: false,
      isPending: false,
      isFetching: false,
      isSuccess: true,
      status: "success",
    } as ReturnType<typeof useArchive>);

    renderWithClient(<ArchivePage />);
    expect(screen.getByText("This issue isn't here")).toBeTruthy();
    expect(screen.getByText("It may have been removed or never existed.")).toBeTruthy();
  });

  it("in-progress state (status=running): IN PROGRESS eyebrow and Today's issue is still being curated. (REQ-023)", () => {
    const runningRun: RunStateResponse = {
      ...baseCompletedRun,
      status: "running",
      stage: "collecting",
      completedAt: null,
      rankedItems: null,
    };
    vi.mocked(useArchive).mockReturnValue({
      isLoading: false,
      data: runningRun,
      error: null,
      isError: false,
      isPending: false,
      isFetching: false,
      isSuccess: true,
      status: "success",
    } as ReturnType<typeof useArchive>);

    renderWithClient(<ArchivePage />);
    expect(screen.getByText("IN PROGRESS")).toBeTruthy();
    expect(screen.getByText("Today's issue is still being curated.")).toBeTruthy();
  });

  it("cancelled state: This issue was cancelled. (EDGE-015)", () => {
    const cancelledRun: RunStateResponse = {
      ...baseCompletedRun,
      status: "cancelled",
      stage: "cancelled",
      completedAt: null,
      rankedItems: null,
    };
    vi.mocked(useArchive).mockReturnValue({
      isLoading: false,
      data: cancelledRun,
      error: null,
      isError: false,
      isPending: false,
      isFetching: false,
      isSuccess: true,
      status: "success",
    } as ReturnType<typeof useArchive>);

    renderWithClient(<ArchivePage />);
    expect(screen.getByText("This issue was cancelled.")).toBeTruthy();
  });

  it("completed with 2 stories: getAllByRole(article) length === 2 and rank counters present (REQ-006)", () => {
    vi.mocked(useArchive).mockReturnValue({
      isLoading: false,
      data: baseCompletedRun,
      error: null,
      isError: false,
      isPending: false,
      isFetching: false,
      isSuccess: true,
      status: "success",
    } as ReturnType<typeof useArchive>);

    renderWithClient(<ArchivePage />);
    const articles = screen.getAllByRole("article");
    expect(articles).toHaveLength(2);
    expect(screen.getByText("01 / 02")).toBeTruthy();
    expect(screen.getByText("02 / 02")).toBeTruthy();
  });

  it("completed with 0 stories: No stories in this issue. rendered; no article roles (EDGE-001)", () => {
    const emptyRun: RunStateResponse = {
      ...baseCompletedRun,
      rankedItems: [],
    };
    vi.mocked(useArchive).mockReturnValue({
      isLoading: false,
      data: emptyRun,
      error: null,
      isError: false,
      isPending: false,
      isFetching: false,
      isSuccess: true,
      status: "success",
    } as ReturnType<typeof useArchive>);

    renderWithClient(<ArchivePage />);
    expect(screen.getByText("No stories in this issue.")).toBeTruthy();
    expect(screen.queryAllByRole("article")).toHaveLength(0);
  });

  it("document.title updated to Issue — <formatted date> after completed render (REQ-028)", () => {
    vi.mocked(useArchive).mockReturnValue({
      isLoading: false,
      data: baseCompletedRun,
      error: null,
      isError: false,
      isPending: false,
      isFetching: false,
      isSuccess: true,
      status: "success",
    } as ReturnType<typeof useArchive>);

    renderWithClient(<ArchivePage />);
    expect(document.title).toContain("Issue —");
  });

  it("bottom-of-page ← All issues link present on completed state (REQ-024)", () => {
    vi.mocked(useArchive).mockReturnValue({
      isLoading: false,
      data: baseCompletedRun,
      error: null,
      isError: false,
      isPending: false,
      isFetching: false,
      isSuccess: true,
      status: "success",
    } as ReturnType<typeof useArchive>);

    renderWithClient(<ArchivePage />);
    // There should be at least two ← All issues links (from header + bottom)
    const allIssuesLinks = screen.getAllByRole("link", { name: "← All issues" });
    expect(allIssuesLinks.length).toBeGreaterThanOrEqual(2);
    for (const link of allIssuesLinks) {
      expect(link.getAttribute("href")).toBe("/");
    }
  });
});
