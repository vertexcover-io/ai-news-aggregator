import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { PoolItem } from "@newsletter/shared";
import { PoolSection } from "../../../../src/components/review/PoolSection";
import type { UsePoolReturn } from "../../../../src/hooks/usePool";

const mockSetSort = vi.fn();
const mockSetSource = vi.fn();
const mockSetSources = vi.fn();
const mockSetShortlisted = vi.fn();
const mockSetQ = vi.fn();
const mockLoadMore = vi.fn();
const mockAddPromotedId = vi.fn();

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
  selectedSources: new Set<string>(),
  shortlistedOnly: false,
  shortlistedItemIds: null as number[] | null,
};

beforeEach(() => {
  poolReturnOverride = {};
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PoolSection", () => {
  it("EDGE-002: renders nothing when total is 0 and not loading", () => {
    poolReturnOverride = { items: [], total: 0, isLoading: false };
    const { container } = render(<PoolSection {...baseProps} />);
    expect(container.innerHTML).toBe("");
  });

  it("EDGE-006: renders 'Pool unavailable for this run' when startedAt is null", () => {
    render(<PoolSection {...baseProps} startedAt={null} />);
    expect(screen.getByText("Pool unavailable for this run")).toBeDefined();
  });

  it("EDGE-006: renders 'Pool unavailable for this run' when sourceTypes is null", () => {
    render(<PoolSection {...baseProps} sourceTypes={null} />);
    expect(screen.getByText("Pool unavailable for this run")).toBeDefined();
  });

  it("EDGE-001: renders empty state message when items are empty and not loading", () => {
    poolReturnOverride = { items: [], total: 5, isLoading: false };
    render(<PoolSection {...baseProps} />);
    expect(screen.getByText("All collected items are already ranked.")).toBeDefined();
  });

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
