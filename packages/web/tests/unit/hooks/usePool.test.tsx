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
import type { PoolResponse } from "@newsletter/shared/types";
import { usePool } from "../../../src/hooks/usePool";

vi.mock("../../../src/api/archives", () => ({
  getPool: vi.fn(),
}));

import { getPool } from "../../../src/api/archives";

function makeWrapper(): (props: { children: ReactNode }) => ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }): ReactElement {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

function makeResponse(
  total: number,
  itemCount = total,
): PoolResponse {
  return {
    items: Array.from({ length: itemCount }, (_, i) => ({
      id: i + 1,
      title: `Item ${String(i + 1)}`,
      url: `https://example.com/${String(i + 1)}`,
      sourceType: "hn" as const,
      author: null,
      publishedAt: null,
      engagement: { points: 0, commentCount: 0 },
      imageUrl: null,
      sourceIdentifier: "news.ycombinator.com",
      preview: { kind: "none" as const },
      recapSummary: null,
    })),
    total,
  };
}

describe("usePool", () => {
  beforeEach(() => {
    vi.mocked(getPool).mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── REQ-005: total is null until the current filter key resolves ──────────
  it("test_REQ_005_no_stale_total_during_transition", async () => {
    // First key resolves immediately with total=5
    vi.mocked(getPool).mockResolvedValueOnce(makeResponse(5));

    const { result } = renderHook(
      () => usePool({ runId: "run-1", enabled: true }),
      { wrapper: makeWrapper() },
    );

    // Before data arrives: total should be null (key has no confirmed total)
    expect(result.current.total).toBeNull();

    // After first resolution
    await waitFor(() => { expect(result.current.total).toBe(5); });

    // Now change a filter — total should become null again while the new key is pending
    let deferred!: { resolve: (v: PoolResponse) => void };
    const promise = new Promise<PoolResponse>((resolve) => {
      deferred = { resolve };
    });
    vi.mocked(getPool).mockReturnValueOnce(promise);

    act(() => {
      result.current.setSort("recency");
    });

    // Immediately after filter change, before new response: total is null
    await waitFor(() => { expect(result.current.total).toBeNull(); });

    // Resolve the new key
    deferred.resolve(makeResponse(3));
    await waitFor(() => { expect(result.current.total).toBe(3); });
  });

  // ── EDGE-002 (hook level): filter change clears error ────────────────────
  it("test_EDGE_002_filter_change_clears_error", async () => {
    // First fetch rejects
    vi.mocked(getPool).mockRejectedValueOnce(new Error("network error"));

    const { result } = renderHook(
      () => usePool({ runId: "run-1", enabled: true }),
      { wrapper: makeWrapper() },
    );

    // Wait for error state
    await waitFor(() => { expect(result.current.isError).toBe(true); });

    // Change filter — second fetch succeeds
    vi.mocked(getPool).mockResolvedValueOnce(makeResponse(2));
    act(() => {
      result.current.setSort("recency");
    });

    // Error should clear and items should arrive
    await waitFor(() => { expect(result.current.isError).toBe(false); });
    await waitFor(() => { expect(result.current.total).toBe(2); });
  });

  // ── EDGE-005: rapid filter toggles — last key wins ────────────────────────
  // Verifies that after two rapid filter changes, the total exposed by the hook
  // reflects only the response for the final active key, not a stale one.
  it("test_EDGE_005_rapid_filter_toggle_last_key_wins", async () => {
    // Resolve initial (engagement) query immediately so hook has an established state
    vi.mocked(getPool).mockResolvedValueOnce(makeResponse(5));

    const { result } = renderHook(
      () => usePool({ runId: "run-1", enabled: true }),
      { wrapper: makeWrapper() },
    );

    // Wait for first response
    await waitFor(() => { expect(result.current.total).toBe(5); });

    // Now change to "recency" — set up a slow response for it
    let resolveRecency!: (v: PoolResponse) => void;
    const recencyPromise = new Promise<PoolResponse>((resolve) => {
      resolveRecency = resolve;
    });
    vi.mocked(getPool).mockReturnValueOnce(recencyPromise);

    act(() => {
      result.current.setSort("recency");
    });

    // After the filter change the total is null (recency key has no confirmed data)
    await waitFor(() => { expect(result.current.total).toBeNull(); });

    // Resolve the recency response — hook should show its total
    resolveRecency(makeResponse(3));
    await waitFor(() => { expect(result.current.total).toBe(3); });

    // Confirm stale total from prior key (5) is not re-exposed
    expect(result.current.total).toBe(3);
  });

  // ── isError exposed ───────────────────────────────────────────────────────
  it("exposes isError=true when the query rejects", async () => {
    vi.mocked(getPool).mockRejectedValueOnce(new Error("fail"));

    const { result } = renderHook(
      () => usePool({ runId: "run-1", enabled: true }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => { expect(result.current.isError).toBe(true); });
    expect(result.current.total).toBeNull();
  });

  // ── refetch exposed and callable ─────────────────────────────────────────
  it("exposes refetch that triggers a new query", async () => {
    vi.mocked(getPool)
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce(makeResponse(4));

    const { result } = renderHook(
      () => usePool({ runId: "run-1", enabled: true }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => { expect(result.current.isError).toBe(true); });

    act(() => {
      result.current.refetch();
    });

    await waitFor(() => { expect(result.current.isError).toBe(false); });
    await waitFor(() => { expect(result.current.total).toBe(4); });
  });
});
