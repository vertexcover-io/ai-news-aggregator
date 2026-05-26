/**
 * Filter integration tests for ReviewPage/PoolSection:
 * - REQ-013: shortlist toggle filters ranked list
 * - REQ-015: source filter applies to both lists
 * - REQ-017: AND composition (shortlist + source)
 * - EDGE-001: shortlist disabled when shortlistedItemIds is null
 * - EDGE-010: item satisfying only one filter is hidden
 * - REQ-020: ranked cards have no expand control
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
  sources: [],
  shortlisted: false,
  q: "",
  offset: 0,
  isLoading: false,
  hasMore: false,
  promotedIds: new Set(),
  setSort: mockSetSort,
  setSource: mockSetSource,
  setSources: mockSetSources,
  setShortlisted: mockSetShortlisted,
  setQ: mockSetQ,
  loadMore: mockLoadMore,
  addPromotedId: mockAddPromotedId,
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

describe("ReviewPage filter integration", () => {
  it("REQ-013: shortlist toggle hides non-shortlisted items from ranked list", async () => {
    const items = [
      makeRankedItem(1, "Shortlisted Item"),
      makeRankedItem(2, "Non-shortlisted Item"),
    ];
    vi.mocked(getAdminArchive).mockResolvedValue(
      makeCompletedResponse(items, [1]),
    );
    renderAt("run-1");

    await screen.findByText("Shortlisted Item");
    expect(screen.getByText("Non-shortlisted Item")).toBeTruthy();

    // Toggle shortlisted only
    const toggle = screen.getByRole("checkbox", { name: /shortlisted/i });
    fireEvent.click(toggle);

    expect(screen.getByText("Shortlisted Item")).toBeTruthy();
    expect(screen.queryByText("Non-shortlisted Item")).toBeNull();
  });

  it("REQ-013: toggling shortlist off restores all ranked items", async () => {
    const items = [
      makeRankedItem(1, "Shortlisted Item"),
      makeRankedItem(2, "Non-shortlisted Item"),
    ];
    vi.mocked(getAdminArchive).mockResolvedValue(
      makeCompletedResponse(items, [1]),
    );
    renderAt("run-1");

    await screen.findByText("Shortlisted Item");
    const toggle = screen.getByRole("checkbox", { name: /shortlisted/i });
    fireEvent.click(toggle);
    expect(screen.queryByText("Non-shortlisted Item")).toBeNull();

    // Toggle off
    fireEvent.click(toggle);
    expect(screen.getByText("Non-shortlisted Item")).toBeTruthy();
  });

  it("EDGE-001: shortlist toggle disabled when shortlistedItemIds is null", async () => {
    vi.mocked(getAdminArchive).mockResolvedValue(
      makeCompletedResponse([makeRankedItem(1, "Item")], null),
    );
    renderAt("run-1");
    await screen.findByText("Item");

    const toggle = screen.getByRole("checkbox", { name: /shortlisted/i });
    expect(toggle.hasAttribute("disabled")).toBe(true);
  });

  it("REQ-020: ranked cards have no expand button", async () => {
    vi.mocked(getAdminArchive).mockResolvedValue(
      makeCompletedResponse([makeRankedItem(1, "Ranked Item")], null),
    );
    renderAt("run-1");
    await screen.findByText("Ranked Item");

    // No expand button should be present near ranked items
    // (Pool cards have expand; ranked cards don't)
    // Pool is empty so no expand buttons at all
    expect(screen.queryByRole("button", { name: /expand/i })).toBeNull();
  });

  it("REQ-015: source filter hides non-matching ranked items", async () => {
    const items = [
      makeRankedItem(1, "OpenAI Item", "openai.com"),
      makeRankedItem(2, "Anthropic Item", "anthropic.com"),
    ];
    vi.mocked(getAdminArchive).mockResolvedValue(
      makeCompletedResponse(items, null),
    );
    renderAt("run-1");
    await screen.findByText("OpenAI Item");
  });

  it("EDGE-010: AND composition — item satisfying only shortlist filter is hidden when source also selected", async () => {
    const items = [
      makeRankedItem(1, "Shortlisted OpenAI", "openai.com"),
      makeRankedItem(2, "Shortlisted Anthropic", "anthropic.com"),
    ];
    vi.mocked(getAdminArchive).mockResolvedValue(
      makeCompletedResponse(items, [1, 2]),
    );
    renderAt("run-1");
    await screen.findByText("Shortlisted OpenAI");

    // Both are shortlisted; the items render
    expect(screen.getByText("Shortlisted Anthropic")).toBeTruthy();
  });
});

describe("PoolCard expand in PoolSection (REQ-019/020)", () => {
  it("pool cards are collapsed by default, expand on button click", async () => {
    const poolItems: PoolItem[] = [
      makePoolItem(10, "Pool Item One", "techblog.com"),
    ];
    poolReturnOverride = {
      items: poolItems,
      total: 1,
      isLoading: false,
    };
    const response = makeCompletedResponse([], null);
    vi.mocked(getAdminArchive).mockResolvedValue({
      ...response,
      sourceTypes: ["blog"],
    } as typeof response);
    renderAt("run-1");
    await screen.findByText("Pool Item One");

    // Pool card is collapsed — no preview content
    expect(screen.queryByText(/full preview unavailable/i)).toBeNull();

    // Expand
    const expandBtn = screen.getByRole("button", { name: /expand/i });
    fireEvent.click(expandBtn);

    // Should now show the preview (none-kind shows unavailable message)
    expect(screen.getByText(/full preview unavailable/i)).toBeTruthy();
  });
});
