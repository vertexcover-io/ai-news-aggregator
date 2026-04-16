import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import type { RankedItem } from "@newsletter/shared";
import type { RunStateResponse } from "../../../src/api/runs";
import { useReview } from "../../../src/hooks/useReview";

vi.mock("../../../src/api/runs", async () => {
  const actual = await vi.importActual<typeof import("../../../src/api/runs")>(
    "../../../src/api/runs",
  );
  return {
    ...actual,
    getArchive: vi.fn(),
  };
});

import { getArchive } from "../../../src/api/runs";

function makeItem(id: number, url: string): RankedItem {
  return {
    id,
    rawItemId: id,
    title: `T${String(id)}`,
    url,
    sourceType: "hn",
    author: null,
    publishedAt: null,
    engagement: { points: 0, commentCount: 0 },
    score: 1,
    rationale: "r",
    content: null,
    imageUrl: null,
    recap: null,
  };
}

function wrapper(): (props: { children: ReactNode }) => ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }): ReactElement {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

const items: RankedItem[] = [
  makeItem(1, "https://a.com"),
  makeItem(2, "https://b.com"),
  makeItem(3, "https://c.com"),
];

const completedResponse: RunStateResponse = {
  id: "run-1",
  status: "completed",
  stage: "completed",
  topN: 10,
  startedAt: "2026-04-14T00:00:00Z",
  updatedAt: "2026-04-14T00:00:00Z",
  completedAt: "2026-04-14T00:00:00Z",
  sources: {},
  rankedItems: items,
  warnings: [],
  error: null,
};

describe("useReview", () => {
  beforeEach(() => {
    vi.mocked(getArchive).mockReset();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("hydrates initial + current from server response", async () => {
    vi.mocked(getArchive).mockResolvedValue(completedResponse);
    const { result } = renderHook(() => useReview("run-1"), {
      wrapper: wrapper(),
    });
    await waitFor(() => {
      expect(result.current.state.current.map((i) => i.id)).toEqual([1, 2, 3]);
    });
    expect(result.current.state.initial.map((i) => i.id)).toEqual([1, 2, 3]);
    expect(result.current.isDirty).toBe(false);
  });

  it("reorder swaps positions and marks dirty", async () => {
    vi.mocked(getArchive).mockResolvedValue(completedResponse);
    const { result } = renderHook(() => useReview("run-1"), {
      wrapper: wrapper(),
    });
    await waitFor(() => {
      expect(result.current.state.current).toHaveLength(3);
    });
    act(() => {
      result.current.reorder(0, 2);
    });
    expect(result.current.state.current.map((i) => i.id)).toEqual([2, 3, 1]);
    expect(result.current.isDirty).toBe(true);
  });

  it("remove drops an item and marks dirty", async () => {
    vi.mocked(getArchive).mockResolvedValue(completedResponse);
    const { result } = renderHook(() => useReview("run-1"), {
      wrapper: wrapper(),
    });
    await waitFor(() => {
      expect(result.current.state.current).toHaveLength(3);
    });
    act(() => {
      result.current.remove(2);
    });
    expect(result.current.state.current.map((i) => i.id)).toEqual([1, 3]);
    expect(result.current.isDirty).toBe(true);
  });

  it("addPending -> resolvePending appends an added card and marks dirty", async () => {
    vi.mocked(getArchive).mockResolvedValue(completedResponse);
    const { result } = renderHook(() => useReview("run-1"), {
      wrapper: wrapper(),
    });
    await waitFor(() => {
      expect(result.current.state.current).toHaveLength(3);
    });
    act(() => {
      result.current.addPending({
        tempId: "t1",
        url: "https://x.com",
      });
    });
    expect(result.current.state.pending).toHaveLength(1);
    expect(result.current.isDirty).toBe(true);
    const added = makeItem(99, "https://x.com");
    act(() => {
      result.current.resolvePending("t1", added);
    });
    expect(result.current.state.pending).toHaveLength(0);
    expect(result.current.state.current.map((i) => i.id)).toEqual([1, 2, 3, 99]);
    expect(result.current.state.addedIds.has(99)).toBe(true);
  });

  it("failPending removes the pending entry", async () => {
    vi.mocked(getArchive).mockResolvedValue(completedResponse);
    const { result } = renderHook(() => useReview("run-1"), {
      wrapper: wrapper(),
    });
    await waitFor(() => {
      expect(result.current.state.current).toHaveLength(3);
    });
    act(() => {
      result.current.addPending({
        tempId: "t1",
        url: "https://y.com",
      });
    });
    act(() => {
      result.current.failPending("t1");
    });
    expect(result.current.state.pending).toHaveLength(0);
  });

  it("discard resets current back to initial and clears pending", async () => {
    vi.mocked(getArchive).mockResolvedValue(completedResponse);
    const { result } = renderHook(() => useReview("run-1"), {
      wrapper: wrapper(),
    });
    await waitFor(() => {
      expect(result.current.state.current).toHaveLength(3);
    });
    act(() => {
      result.current.reorder(0, 2);
      result.current.remove(3);
    });
    expect(result.current.isDirty).toBe(true);
    act(() => {
      result.current.discard();
    });
    expect(result.current.state.current.map((i) => i.id)).toEqual([1, 2, 3]);
    expect(result.current.isDirty).toBe(false);
  });

  it("hasUrl matches existing items and pending URLs", async () => {
    vi.mocked(getArchive).mockResolvedValue(completedResponse);
    const { result } = renderHook(() => useReview("run-1"), {
      wrapper: wrapper(),
    });
    await waitFor(() => {
      expect(result.current.state.current).toHaveLength(3);
    });
    expect(result.current.hasUrl("https://a.com")).toBe(true);
    expect(result.current.hasUrl("https://A.COM  ")).toBe(true);
    expect(result.current.hasUrl("https://nope.com")).toBe(false);
    act(() => {
      result.current.addPending({
        tempId: "t1",
        url: "https://pending.com",
      });
    });
    expect(result.current.hasUrl("https://pending.com")).toBe(true);
  });

  // REQ-009: updateItemField updates recap.summary
  it("updateItemField summary updates current item recap.summary", async () => {
    vi.mocked(getArchive).mockResolvedValue(completedResponse);
    const { result } = renderHook(() => useReview("run-1"), {
      wrapper: wrapper(),
    });
    await waitFor(() => {
      expect(result.current.state.current).toHaveLength(3);
    });
    act(() => {
      result.current.updateItemField(1, "summary", "new summary");
    });
    expect(result.current.state.current[0]?.recap?.summary).toBe("new summary");
  });

  // REQ-009: updateItemField sets isDirty = true
  it("updateItemField on any field sets isDirty = true", async () => {
    vi.mocked(getArchive).mockResolvedValue(completedResponse);
    const { result } = renderHook(() => useReview("run-1"), {
      wrapper: wrapper(),
    });
    await waitFor(() => {
      expect(result.current.state.current).toHaveLength(3);
    });
    expect(result.current.isDirty).toBe(false);
    act(() => {
      result.current.updateItemField(2, "bottomLine", "updated bottom line");
    });
    expect(result.current.isDirty).toBe(true);
  });

  // REQ-016: field edit survives reorder
  it("updateItemField edit is preserved after reorder", async () => {
    vi.mocked(getArchive).mockResolvedValue(completedResponse);
    const { result } = renderHook(() => useReview("run-1"), {
      wrapper: wrapper(),
    });
    await waitFor(() => {
      expect(result.current.state.current).toHaveLength(3);
    });
    act(() => {
      result.current.updateItemField(1, "summary", "edited summary");
    });
    act(() => {
      result.current.reorder(0, 2);
    });
    // item with id=1 should now be at index 2 (moved from 0 to 2)
    const editedItem = result.current.state.current.find((i) => i.id === 1);
    expect(editedItem?.recap?.summary).toBe("edited summary");
  });

  // discard reverts field edits
  it("discard reverts field edits back to initial", async () => {
    vi.mocked(getArchive).mockResolvedValue(completedResponse);
    const { result } = renderHook(() => useReview("run-1"), {
      wrapper: wrapper(),
    });
    await waitFor(() => {
      expect(result.current.state.current).toHaveLength(3);
    });
    act(() => {
      result.current.updateItemField(1, "summary", "temporary edit");
    });
    expect(result.current.isDirty).toBe(true);
    act(() => {
      result.current.discard();
    });
    expect(result.current.state.current[0]?.recap).toBeNull();
    expect(result.current.isDirty).toBe(false);
  });

  // EDGE-003: empty string summary is a valid edit (isDirty = true)
  it("EDGE-003: empty string summary is a valid edit that sets isDirty = true", async () => {
    const itemWithRecap = { ...makeItem(1, "https://a.com"), recap: { summary: "original", bullets: [], bottomLine: "" } };
    const responseWithRecap: RunStateResponse = {
      ...completedResponse,
      rankedItems: [
        itemWithRecap,
        makeItem(2, "https://b.com"),
        makeItem(3, "https://c.com"),
      ],
    };
    vi.mocked(getArchive).mockResolvedValue(responseWithRecap);
    const { result } = renderHook(() => useReview("run-1"), {
      wrapper: wrapper(),
    });
    await waitFor(() => {
      expect(result.current.state.current).toHaveLength(3);
    });
    expect(result.current.isDirty).toBe(false);
    act(() => {
      result.current.updateItemField(1, "summary", "");
    });
    expect(result.current.isDirty).toBe(true);
  });

  // updateItemField imageUrl
  it("updateItemField imageUrl updates item.imageUrl", async () => {
    vi.mocked(getArchive).mockResolvedValue(completedResponse);
    const { result } = renderHook(() => useReview("run-1"), {
      wrapper: wrapper(),
    });
    await waitFor(() => {
      expect(result.current.state.current).toHaveLength(3);
    });
    act(() => {
      result.current.updateItemField(1, "imageUrl", "https://img.example.com/photo.jpg");
    });
    expect(result.current.state.current[0]?.imageUrl).toBe("https://img.example.com/photo.jpg");
    expect(result.current.isDirty).toBe(true);
  });

  // --- Promote lifecycle tests ---

  it("addPromotePending adds to pendingPromotes array", async () => {
    vi.mocked(getArchive).mockResolvedValue(completedResponse);
    const { result } = renderHook(() => useReview("run-1"), {
      wrapper: wrapper(),
    });
    await waitFor(() => {
      expect(result.current.state.current).toHaveLength(3);
    });
    act(() => {
      result.current.addPromotePending({
        tempId: "p1",
        rawItemId: 42,
        title: "Promoted Item",
      });
    });
    expect(result.current.state.pendingPromotes).toHaveLength(1);
    expect(result.current.state.pendingPromotes[0]?.tempId).toBe("p1");
    expect(result.current.state.pendingPromotes[0]?.rawItemId).toBe(42);
    expect(result.current.state.pendingPromotes[0]?.title).toBe("Promoted Item");
  });

  it("resolvePromotePending removes from pendingPromotes and adds item to current", async () => {
    vi.mocked(getArchive).mockResolvedValue(completedResponse);
    const { result } = renderHook(() => useReview("run-1"), {
      wrapper: wrapper(),
    });
    await waitFor(() => {
      expect(result.current.state.current).toHaveLength(3);
    });
    act(() => {
      result.current.addPromotePending({
        tempId: "p1",
        rawItemId: 42,
        title: "Promoted Item",
      });
    });
    expect(result.current.state.pendingPromotes).toHaveLength(1);
    const promoted = makeItem(42, "https://promoted.com");
    act(() => {
      result.current.resolvePromotePending("p1", promoted);
    });
    expect(result.current.state.pendingPromotes).toHaveLength(0);
    expect(result.current.state.current.map((i) => i.id)).toEqual([1, 2, 3, 42]);
    expect(result.current.state.addedIds.has(42)).toBe(true);
  });

  it("failPromotePending removes from pendingPromotes", async () => {
    vi.mocked(getArchive).mockResolvedValue(completedResponse);
    const { result } = renderHook(() => useReview("run-1"), {
      wrapper: wrapper(),
    });
    await waitFor(() => {
      expect(result.current.state.current).toHaveLength(3);
    });
    act(() => {
      result.current.addPromotePending({
        tempId: "p1",
        rawItemId: 42,
        title: "Promoted Item",
      });
    });
    act(() => {
      result.current.failPromotePending("p1");
    });
    expect(result.current.state.pendingPromotes).toHaveLength(0);
  });

  it("isDirty is true when pendingPromotes is non-empty", async () => {
    vi.mocked(getArchive).mockResolvedValue(completedResponse);
    const { result } = renderHook(() => useReview("run-1"), {
      wrapper: wrapper(),
    });
    await waitFor(() => {
      expect(result.current.state.current).toHaveLength(3);
    });
    expect(result.current.isDirty).toBe(false);
    act(() => {
      result.current.addPromotePending({
        tempId: "p1",
        rawItemId: 42,
        title: "Promoted Item",
      });
    });
    expect(result.current.isDirty).toBe(true);
  });
});
