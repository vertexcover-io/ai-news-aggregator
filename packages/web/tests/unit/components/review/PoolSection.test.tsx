import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { PoolItem } from "@newsletter/shared";
import { PoolSection } from "../../../../src/components/review/PoolSection";
import type { UsePoolReturn } from "../../../../src/hooks/usePool";

const mockSetSort = vi.fn();
const mockSetSource = vi.fn();
const mockSetSourceTypes = vi.fn();
const mockSetSources = vi.fn();
const mockSetShortlisted = vi.fn();
const mockSetQ = vi.fn();
const mockLoadMore = vi.fn();
const mockAddPromotedId = vi.fn();
const mockRefetch = vi.fn();

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
  isError: false,
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
  refetch: mockRefetch,
};

let poolReturnOverride: Partial<UsePoolReturn> = {};

vi.mock("../../../../src/hooks/usePool", () => ({
  usePool: () => ({ ...defaultPoolReturn, ...poolReturnOverride }),
}));

const sampleItems: PoolItem[] = [
  {
    id: 1,
    title: "Post A",
    url: "https://example.com/a",
    sourceType: "hn",
    author: "alice",
    publishedAt: "2026-04-15T12:00:00Z",
    engagement: { points: 100, commentCount: 10 },
    imageUrl: null,
    sourceIdentifier: "news.ycombinator.com",
    preview: { kind: "none" },
    recapSummary: null,
  },
  {
    id: 2,
    title: "Post B",
    url: "https://example.com/b",
    sourceType: "reddit",
    author: "bob",
    publishedAt: null,
    engagement: { points: 50, commentCount: 5 },
    imageUrl: null,
    sourceIdentifier: "r/LocalLLaMA",
    preview: { kind: "none" },
    recapSummary: null,
  },
];

const baseProps = {
  runId: "run-1",
  isSaveInFlight: false,
  onPromote: vi.fn(),
  promotingIds: new Set<number>(),
  startedAt: "2026-04-15T10:00:00Z",
  sourceTypes: ["hn", "reddit"] as string[],
  shortlistedOnly: false,
  toggleShortlisted: vi.fn(),
  selectedSourceTypes: new Set<string>(),
  toggleSourceType: vi.fn(),
  selectedSources: new Set<string>(),
  toggleSource: vi.fn(),
  clearAll: vi.fn(),
  isFiltered: false,
  shortlistedItemIds: null as number[] | null,
  facets: [],
  facetsLoading: false,
  facetsError: false,
  onRetryFacets: vi.fn(),
};

beforeEach(() => {
  poolReturnOverride = {};
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PoolSection", () => {
  // ── REQ-001: zero-match filter keeps toolbar ───────────────────────────────
  it("test_REQ_001_zero_match_filter_keeps_toolbar", () => {
    poolReturnOverride = { items: [], total: 0, isLoading: false };
    render(<PoolSection {...baseProps} isFiltered={true} />);
    // Toolbar (Source button) must be present
    expect(screen.getByText("Source")).toBeDefined();
    // Context-aware message
    expect(screen.getByText("No items match the current filters.")).toBeDefined();
    // Section must NOT be absent (old EDGE-002 behaviour deliberately updated)
  });

  // ── REQ-002: unconstrained empty pool hides section ────────────────────────
  it("test_REQ_002_unconstrained_empty_pool_hides_section", () => {
    poolReturnOverride = { items: [], total: 0, isLoading: false };
    // isFiltered=false (default), no search, no sourceType selection
    const { container } = render(<PoolSection {...baseProps} />);
    expect(container.innerHTML).toBe("");
  });

  // ── REQ-003: pool error shows retry alongside toolbar ─────────────────────
  it("test_REQ_003_pool_error_shows_retry_with_toolbar", () => {
    poolReturnOverride = { isError: true };
    render(<PoolSection {...baseProps} />);
    // Toolbar must still be present so filters can be changed (clears the error)
    expect(screen.getByText("Source")).toBeDefined();
    // Error alert and Retry button
    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByText("Failed to load pool items.")).toBeDefined();
    const retryBtn = screen.getByRole("button", { name: "Retry" });
    expect(retryBtn).toBeDefined();
    fireEvent.click(retryBtn);
    expect(mockRefetch).toHaveBeenCalledOnce();
  });

  // ── REQ-005: no stale total during transition (null while key pending) ─────
  // This behaviour is asserted at the hook level in usePool.test.tsx; here we
  // verify that the PoolSection renders "…" in the header when total is null.
  it("test_REQ_005_no_stale_total_during_transition", () => {
    poolReturnOverride = { items: [], total: null, isLoading: true };
    render(<PoolSection {...baseProps} />);
    // Header should show "…" (not a stale number)
    expect(screen.getByText("(…)")).toBeDefined();
  });

  // ── REQ-006: empty-state message is context-aware ─────────────────────────
  it("test_REQ_006_empty_state_message_context_aware", () => {
    // Constrained (filtered): "No items match the current filters."
    poolReturnOverride = { items: [], total: 5, isLoading: false };
    const { unmount } = render(<PoolSection {...baseProps} isFiltered={true} />);
    expect(screen.getByText("No items match the current filters.")).toBeDefined();
    unmount();

    // Unconstrained but total > 0 (all items already promoted out of visible list):
    // "All collected items are already ranked."
    poolReturnOverride = { items: [], total: 5, isLoading: false };
    render(<PoolSection {...baseProps} isFiltered={false} />);
    expect(screen.getByText("All collected items are already ranked.")).toBeDefined();
  });

  // ── REQ-017: clear filters also clears search input ───────────────────────
  it("test_REQ_017_clear_filters_clears_search", () => {
    poolReturnOverride = { items: sampleItems, total: 2 };
    const clearAll = vi.fn();
    render(<PoolSection {...baseProps} isFiltered={true} clearAll={clearAll} />);

    // Type into the search input
    const searchInput = screen.getByPlaceholderText("Search pool items...");
    fireEvent.change(searchInput, { target: { value: "something" } });
    expect((searchInput as HTMLInputElement).value).toBe("something");

    // Click Clear filters
    fireEvent.click(screen.getByText("Clear filters"));

    // Input must be cleared
    expect((searchInput as HTMLInputElement).value).toBe("");
    // setQ must have been called with ""
    expect(mockSetQ).toHaveBeenCalledWith("");
    // The upstream clearAll must have been called
    expect(clearAll).toHaveBeenCalled();
  });

  // ── EDGE-001: error wins over both empty states ────────────────────────────
  it("test_EDGE_001_error_wins_over_empty_states", () => {
    // Even with total === 0 and isFiltered === false, the error branch wins
    poolReturnOverride = { isError: true, total: 0, isLoading: false };
    const { container } = render(<PoolSection {...baseProps} />);
    // Section must NOT be null
    expect(container.innerHTML).not.toBe("");
    // Error message present
    expect(screen.getByText("Failed to load pool items.")).toBeDefined();
  });

  // ── EDGE-002 (deliberate update): filter change clears error via new key ───
  // The new behaviour is that EDGE-002 no longer pins "hides on 0 total" for the
  // constrained case — that was replaced by REQ-001. Instead, we verify that
  // changing a filter while an error is displayed triggers the normal branch
  // (because the new key re-fetches and isError becomes false with new data).
  it("test_EDGE_002_filter_change_clears_error", () => {
    // Start in error state with a filter active
    poolReturnOverride = { isError: true, total: 0 };
    const { rerender } = render(<PoolSection {...baseProps} isFiltered={true} />);
    expect(screen.getByText("Failed to load pool items.")).toBeDefined();

    // Simulate the filter change resolving: isError clears, new items arrive
    poolReturnOverride = { isError: false, items: sampleItems, total: 2 };
    rerender(<PoolSection {...baseProps} isFiltered={false} />);

    // Error message gone, items rendered
    expect(screen.queryByText("Failed to load pool items.")).toBeNull();
    expect(screen.getByText("Post A")).toBeDefined();
  });

  // ── EDGE-003: legacy run unavailable branch unchanged ─────────────────────
  it.each<{ field: "startedAt" | "sourceTypes" }>([
    { field: "startedAt" },
    { field: "sourceTypes" },
  ])(
    "test_EDGE_003_legacy_run_unavailable_branch_unchanged — $field is null",
    ({ field }) => {
      render(<PoolSection {...baseProps} {...{ [field]: null }} />);
      expect(screen.getByText("Pool unavailable for this run")).toBeDefined();
    },
  );

  // ── EDGE-005: rapid filter toggle — last key wins (no stale total rendered) -
  // This is the PoolSection surface of the EDGE-005 behaviour; the hook-level
  // assertion lives in usePool.test.tsx. Here we verify that total===null
  // renders "…" and not a stale value.
  it("test_EDGE_005_rapid_filter_toggle_last_key_wins", () => {
    // Simulate mid-transition: total is null (key mismatch)
    poolReturnOverride = { items: [], total: null, isLoading: true };
    render(<PoolSection {...baseProps} />);
    // The header must not render a stale number
    expect(screen.getByText("(…)")).toBeDefined();
  });

  // ── Existing happy-path regressions ──────────────────────────────────────
  it("renders pool items", () => {
    poolReturnOverride = { items: sampleItems, total: 2 };
    render(<PoolSection {...baseProps} />);
    expect(screen.getByText("Post A")).toBeDefined();
    expect(screen.getByText("Post B")).toBeDefined();
  });

  it("renders item count in header", () => {
    poolReturnOverride = { items: sampleItems, total: 50 };
    render(<PoolSection {...baseProps} />);
    expect(screen.getByText("(50 items)")).toBeDefined();
  });

  it("REQ-006: clicking Engagement sort calls setSort('engagement')", () => {
    poolReturnOverride = { items: sampleItems, total: 2, sort: "recency" };
    render(<PoolSection {...baseProps} />);
    fireEvent.click(screen.getByText("Engagement"));
    expect(mockSetSort).toHaveBeenCalledWith("engagement");
  });

  it("REQ-006: clicking Recent sort calls setSort('recency')", () => {
    poolReturnOverride = { items: sampleItems, total: 2, sort: "engagement" };
    render(<PoolSection {...baseProps} />);
    fireEvent.click(screen.getByText("Recent"));
    expect(mockSetSort).toHaveBeenCalledWith("recency");
  });

  it("REQ-007: search input renders", () => {
    poolReturnOverride = { items: sampleItems, total: 2 };
    render(<PoolSection {...baseProps} />);
    const input = screen.getByPlaceholderText("Search pool items...");
    expect(input).toBeDefined();
  });

  it("renders the filter toolbar inside the pool (shortlist toggle + source dropdown)", () => {
    poolReturnOverride = { items: sampleItems, total: 2 };
    render(<PoolSection {...baseProps} />);
    expect(screen.getByLabelText("Shortlisted only")).toBeDefined();
    expect(screen.getByText("Source")).toBeDefined();
  });

  it("toggling 'Shortlisted only' calls toggleShortlisted (pool-scoped)", () => {
    poolReturnOverride = { items: sampleItems, total: 2 };
    const toggleShortlisted = vi.fn();
    render(
      <PoolSection
        {...baseProps}
        shortlistedItemIds={[1]}
        toggleShortlisted={toggleShortlisted}
      />,
    );
    fireEvent.click(screen.getByLabelText("Shortlisted only"));
    expect(toggleShortlisted).toHaveBeenCalled();
  });

  it("REQ-008: Show more button visible when hasMore is true, shows remaining count", () => {
    poolReturnOverride = { items: sampleItems, total: 50, hasMore: true };
    render(<PoolSection {...baseProps} />);
    const btn = screen.getByText(/Show more/);
    expect(btn).toBeDefined();
    expect(btn.textContent).toContain("48 remaining");
  });

  it("REQ-008: Show more button hidden when hasMore is false", () => {
    poolReturnOverride = { items: sampleItems, total: 2, hasMore: false };
    render(<PoolSection {...baseProps} />);
    expect(screen.queryByText(/Show more/)).toBeNull();
  });

  it("REQ-008: clicking Show more calls loadMore", () => {
    poolReturnOverride = { items: sampleItems, total: 50, hasMore: true };
    render(<PoolSection {...baseProps} />);
    fireEvent.click(screen.getByText(/Show more/));
    expect(mockLoadMore).toHaveBeenCalled();
  });
});
