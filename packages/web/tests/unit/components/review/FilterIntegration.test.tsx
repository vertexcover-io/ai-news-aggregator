/**
 * Filter integration tests for ReviewPage/PoolSection.
 *
 * Corrected contract (per user feedback 2026-05-26):
 * - The "Shortlisted only" toggle and "Source" filter live INSIDE the Item Pool
 *   section and apply to the POOL ONLY (server-side, via usePool).
 * - The ranked list is NEVER filtered by these controls, and drag-to-reorder is
 *   always enabled regardless of toggle state.
 * - EDGE-001: shortlist toggle disabled when shortlistedItemIds is null.
 * - REQ-019/020: pool cards expand inline; ranked cards have no expand control.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import type { RankedItem, PoolItem } from "@newsletter/shared/types";
import { ReviewPage } from "../../../../src/pages/ReviewPage";
import type { RunStateResponse } from "../../../../src/api/runs";
import type { UsePoolReturn } from "../../../../src/hooks/usePool";
import type { SourceFacetGroup } from "../../../../src/hooks/useSourceFacets";

vi.mock("../../../../src/api/runs", async () => {
  const actual = await vi.importActual<typeof import("../../../../src/api/runs")>(
    "../../../../src/api/runs",
  );
  return { ...actual, getAdminArchive: vi.fn() };
});

vi.mock("../../../../src/api/archives", async () => {
  const actual = await vi.importActual<typeof import("../../../../src/api/archives")>(
    "../../../../src/api/archives",
  );
  return {
    ...actual,
    getSourceFacets: vi.fn().mockResolvedValue([]),
  };
});

import { getAdminArchive } from "../../../../src/api/runs";

const mockSetSort = vi.fn();
const mockSetSource = vi.fn();
const mockSetSourceTypes = vi.fn();
const mockSetQ = vi.fn();
const mockLoadMore = vi.fn();
const mockAddPromotedId = vi.fn();
const mockSetSources = vi.fn();
const mockSetShortlisted = vi.fn();

const defaultPoolReturn: UsePoolReturn = {
  items: [],
  total: 0,
  sort: "engagement",
  source: undefined,
  sourceTypes: [],
  sources: [],
  shortlisted: false,
  q: "",
  offset: 0,
  isLoading: false,
  hasMore: false,
  promotedIds: new Set(),
  setSort: mockSetSort,
  setSource: mockSetSource,
  setSourceTypes: mockSetSourceTypes,
  setSources: mockSetSources,
  setShortlisted: mockSetShortlisted,
  setQ: mockSetQ,
  loadMore: mockLoadMore,
  addPromotedId: mockAddPromotedId,
  isError: false,
  refetch: vi.fn(),
};

let poolReturnOverride: Partial<UsePoolReturn> = {};

vi.mock("../../../../src/hooks/usePool", () => ({
  usePool: () => ({ ...defaultPoolReturn, ...poolReturnOverride }),
}));

vi.mock("../../../../src/hooks/useSourceFacets", () => ({
  useSourceFacets: (_runId: string) => ({
    facets: [] as SourceFacetGroup[],
    isLoading: false,
  }),
}));

const noPreview = { kind: "none" as const };

function makeRankedItem(
  id: number,
  title: string,
  sourceIdentifier = "hn.com",
): RankedItem {
  return {
    id,
    rawItemId: id,
    title,
    url: `https://example.com/${String(id)}`,
    sourceType: "hn",
    author: null,
    publishedAt: null,
    engagement: { points: 10, commentCount: 2 },
    score: 0.85,
    rationale: "because",
    content: null,
    imageUrl: null,
    recap: null,
    enrichedSource: null,
    sourceIdentifier,
    preview: noPreview,
  };
}

function makePoolItem(id: number, title: string, sourceIdentifier = "example.com"): PoolItem {
  return {
    id,
    title,
    url: `https://pool.com/${String(id)}`,
    sourceType: "blog",
    author: null,
    publishedAt: null,
    engagement: { points: 0, commentCount: 0 },
    imageUrl: null,
    sourceIdentifier,
    preview: noPreview,
    recapSummary: null,
  };
}

function renderAt(runId: string): ReturnType<typeof render> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const router = createMemoryRouter(
    [{ path: "/admin/review/:runId", element: <ReviewPage /> }],
    { initialEntries: [`/admin/review/${runId}`] },
  );
  const tree: ReactElement = (
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return render(tree);
}

beforeEach(() => {
  vi.mocked(getAdminArchive).mockReset();
  poolReturnOverride = {};
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeCompletedResponse(
  items: RankedItem[],
  shortlistedItemIds: number[] | null = null,
): RunStateResponse {
  return {
    id: "run-1",
    status: "completed",
    stage: "completed",
    topN: 10,
    startedAt: "2026-04-14T00:00:00Z",
    updatedAt: "2026-04-14T00:00:00Z",
    completedAt: "2026-04-14T00:00:00Z",
    sources: {},
    rankedItems: items,
    shortlistedItemIds,
    warnings: [],
    error: null,
  };
}

/** A completed response that also carries sourceTypes so the pool renders. */
function makeCompletedResponseWithPool(
  items: RankedItem[],
  shortlistedItemIds: number[] | null = null,
): RunStateResponse {
  const base = makeCompletedResponse(items, shortlistedItemIds);
  return { ...base, sourceTypes: ["hn", "blog"] } as RunStateResponse;
}

describe("ReviewPage — toolbar is pool-scoped, ranked list is never filtered", () => {
  it("toggling 'Shortlisted only' leaves the ranked list untouched", async () => {
    const items = [
      makeRankedItem(1, "Shortlisted Item"),
      makeRankedItem(2, "Non-shortlisted Item"),
    ];
    poolReturnOverride = {
      items: [makePoolItem(99, "Pool Item")],
      total: 1,
      isLoading: false,
    };
    vi.mocked(getAdminArchive).mockResolvedValue(
      makeCompletedResponseWithPool(items, [1]),
    );
    renderAt("run-1");

    await screen.findByText("Shortlisted Item");
    expect(screen.getByText("Non-shortlisted Item")).toBeTruthy();

    const toggle = screen.getByRole("checkbox", { name: /shortlisted/i });
    fireEvent.click(toggle);

    // BOTH ranked items remain visible — the toggle does not filter the ranked list.
    expect(screen.getByText("Shortlisted Item")).toBeTruthy();
    expect(screen.getByText("Non-shortlisted Item")).toBeTruthy();
  });

  it("toggling 'Shortlisted only' drives the pool's server-side filter", async () => {
    poolReturnOverride = {
      items: [makePoolItem(99, "Pool Item")],
      total: 1,
      isLoading: false,
    };
    vi.mocked(getAdminArchive).mockResolvedValue(
      makeCompletedResponseWithPool([makeRankedItem(1, "Ranked Item")], [1]),
    );
    renderAt("run-1");
    await screen.findByText("Pool Item");

    const toggle = screen.getByRole("checkbox", { name: /shortlisted/i });
    fireEvent.click(toggle);

    expect(mockSetShortlisted).toHaveBeenCalledWith(true);
  });

  it("EDGE-001: shortlist toggle disabled when shortlistedItemIds is null", async () => {
    poolReturnOverride = {
      items: [makePoolItem(99, "Pool Item")],
      total: 1,
      isLoading: false,
    };
    vi.mocked(getAdminArchive).mockResolvedValue(
      makeCompletedResponseWithPool([makeRankedItem(1, "Item")], null),
    );
    renderAt("run-1");
    await screen.findByText("Pool Item");

    const toggle = screen.getByRole("checkbox", { name: /shortlisted/i });
    expect(toggle.hasAttribute("disabled")).toBe(true);
  });

  it("the toolbar is not rendered when the pool is empty", async () => {
    poolReturnOverride = { items: [], total: 0, isLoading: false };
    vi.mocked(getAdminArchive).mockResolvedValue(
      makeCompletedResponseWithPool([makeRankedItem(1, "Ranked Item")], [1]),
    );
    renderAt("run-1");
    await screen.findByText("Ranked Item");

    // Pool collapses to null when empty, so its toolbar (shortlist toggle) is gone.
    expect(screen.queryByRole("checkbox", { name: /shortlisted/i })).toBeNull();
  });

  it("REQ-020: ranked cards have no expand button", async () => {
    vi.mocked(getAdminArchive).mockResolvedValue(
      makeCompletedResponse([makeRankedItem(1, "Ranked Item")], null),
    );
    renderAt("run-1");
    await screen.findByText("Ranked Item");

    expect(screen.queryByRole("button", { name: /expand/i })).toBeNull();
  });
});
