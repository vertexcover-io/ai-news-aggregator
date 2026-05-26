import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import type { PoolItem, RankedItem } from "@newsletter/shared";
import { SourcesPreviewPage } from "../../../src/pages/SourcesPreviewPage";
import type { RunStateResponse } from "../../../src/api/runs";

vi.mock("../../../src/api/runs", async () => {
  const actual = await vi.importActual<typeof import("../../../src/api/runs")>(
    "../../../src/api/runs",
  );
  return { ...actual, getAdminArchive: vi.fn() };
});

vi.mock("../../../src/api/archives", async () => {
  const actual = await vi.importActual<
    typeof import("../../../src/api/archives")
  >("../../../src/api/archives");
  return { ...actual, getPool: vi.fn() };
});

import { getPool } from "../../../src/api/archives";
import { getAdminArchive } from "../../../src/api/runs";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  vi.mocked(getAdminArchive).mockReset();
  vi.mocked(getPool).mockReset();
});

function makeRankedItem(overrides: Partial<RankedItem> = {}): RankedItem {
  return {
    id: 1,
    rawItemId: 1,
    title: "Ranked story",
    url: "https://example.com/ranked",
    sourceType: "hn",
    author: "alice",
    publishedAt: "2026-05-12T00:00:00Z",
    engagement: { points: 42, commentCount: 7 },
    score: 0.92,
    rationale: "Strong signal",
    content: null,
    imageUrl: null,
    recap: null,
    enrichedSource: null,
    sourceIdentifier: "news.ycombinator.com",
    preview: { kind: "none" },
    ...overrides,
  };
}

function makePoolItem(overrides: Partial<PoolItem> = {}): PoolItem {
  return {
    id: 10,
    title: "Pool story",
    url: "https://example.com/pool",
    sourceType: "reddit",
    author: "bob",
    publishedAt: "2026-05-12T00:00:00Z",
    engagement: { points: 12, commentCount: 3 },
    imageUrl: null,
    sourceIdentifier: "r/LocalLLaMA",
    preview: { kind: "none" },
    recapSummary: null,
    ...overrides,
  };
}

function makeRun(
  overrides: Partial<RunStateResponse> = {},
): RunStateResponse {
  return {
    id: "run-1",
    status: "completed",
    stage: "completed",
    topN: 10,
    startedAt: "2026-05-12T00:00:00Z",
    updatedAt: "2026-05-12T00:01:00Z",
    completedAt: "2026-05-12T00:02:00Z",
    sources: {},
    rankedItems: [makeRankedItem()],
    shortlistedItemIds: null,
    warnings: [],
    error: null,
    sourceTypes: ["hn", "reddit", "blog"],
    ...overrides,
  };
}

function renderPage(runId = "run-1"): ReturnType<typeof render> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const router = createMemoryRouter(
    [{ path: "/admin/sources/:runId", element: <SourcesPreviewPage /> }],
    { initialEntries: [`/admin/sources/${runId}`] },
  );
  const tree: ReactElement = (
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return render(tree);
}

describe("SourcesPreviewPage", () => {
  it("renders not-found state when the archive is missing", async () => {
    vi.mocked(getAdminArchive).mockResolvedValue(null);
    renderPage("missing");
    await screen.findByText("This run was not found.");
    expect(
      screen.getByRole("link", { name: /back to dashboard/i }).getAttribute("href"),
    ).toBe("/admin");
    expect(vi.mocked(getPool)).not.toHaveBeenCalled();
  });

  it("renders not-ready state for non-completed runs", async () => {
    vi.mocked(getAdminArchive).mockResolvedValue(
      makeRun({
        status: "running",
        stage: "collecting",
        completedAt: null,
        rankedItems: null,
      }),
    );
    renderPage();
    await screen.findByText("This run is not ready for source preview yet.");
    expect(vi.mocked(getPool)).not.toHaveBeenCalled();
  });

  it("renders ranked items above the source pool for completed runs", async () => {
    vi.mocked(getAdminArchive).mockResolvedValue(
      makeRun({
        rankedItems: [
          makeRankedItem({
            title: "Top ranked story",
            recap: {
              title: "Top ranked story",
              summary: "A concise recap",
              bullets: ["first point", "second point"],
              bottomLine: "Watch this closely",
            },
          }),
        ],
      }),
    );
    vi.mocked(getPool).mockResolvedValue({
      items: [makePoolItem({ title: "Non-ranked story" })],
      total: 1,
    });

    renderPage();
    const rankedHeading = await screen.findByRole("heading", {
      name: /ranked items/i,
    });
    const poolHeading = await screen.findByRole("heading", {
      name: /source pool/i,
    });
    expect(
      rankedHeading.compareDocumentPosition(poolHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText("Top ranked story")).toBeTruthy();
    expect(screen.getByText("A concise recap")).toBeTruthy();
    expect(screen.getByText("first point")).toBeTruthy();
    expect(screen.getByText("Watch this closely")).toBeTruthy();
    expect(screen.getByText("Non-ranked story")).toBeTruthy();
  });

  it("renders rationale fallback for ranked items without recap", async () => {
    vi.mocked(getAdminArchive).mockResolvedValue(
      makeRun({
        rankedItems: [
          makeRankedItem({
            title: "Rationale story",
            recap: null,
            rationale: "Ranked because it is actionable",
          }),
        ],
      }),
    );
    vi.mocked(getPool).mockResolvedValue({ items: [], total: 0 });
    renderPage();
    await screen.findByText("Rationale story");
    expect(screen.getByText("Ranked because it is actionable")).toBeTruthy();
  });

  it("renders pool filters/search/sort and sends pool query changes", async () => {
    vi.mocked(getAdminArchive).mockResolvedValue(makeRun());
    vi.mocked(getPool).mockResolvedValue({
      items: [makePoolItem({ title: "Pool story" })],
      total: 1,
    });
    renderPage();

    const search = await screen.findByPlaceholderText("Search pool items...");
    expect(screen.getByRole("button", { name: "Engagement" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Recent" }));
    fireEvent.click(screen.getByRole("button", { name: "Reddit" }));
    fireEvent.change(search, { target: { value: "agents" } });

    await waitFor(() => {
      expect(vi.mocked(getPool)).toHaveBeenCalledWith(
        "run-1",
        expect.objectContaining({
          sort: "recency",
          source: "reddit",
          q: "agents",
        }),
      );
    });
  });

  it("renders pool source open links with safe external attributes", async () => {
    vi.mocked(getAdminArchive).mockResolvedValue(makeRun());
    vi.mocked(getPool).mockResolvedValue({
      items: [
        makePoolItem({
          title: "External pool story",
          url: "https://example.com/source",
        }),
      ],
      total: 1,
    });
    renderPage();
    await screen.findByText("External pool story");
    const link = await screen.findByRole("link", {
      name: "Open External pool story",
    });
    expect(link.getAttribute("href")).toBe("https://example.com/source");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("does not render review mutation controls", async () => {
    vi.mocked(getAdminArchive).mockResolvedValue(makeRun());
    vi.mocked(getPool).mockResolvedValue({
      items: [makePoolItem({ title: "Read-only pool story" })],
      total: 1,
    });
    renderPage();
    await screen.findByText("Ranked story");
    await screen.findByText("Read-only pool story");
    expect(screen.queryByLabelText(/drag to reorder/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /promote/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /discard/i })).toBeNull();
    expect(screen.queryByText(/add post/i)).toBeNull();
  });
});
