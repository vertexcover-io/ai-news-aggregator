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
});
