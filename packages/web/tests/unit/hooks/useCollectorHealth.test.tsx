import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import type { CollectorHealthSnapshot } from "@newsletter/shared/types";
import { useCollectorHealth } from "../../../src/hooks/useCollectorHealth";

vi.mock("../../../src/api/collector-health", () => ({
  getCollectorHealthSnapshot: vi.fn(),
  triggerCollectorHealth: vi.fn(),
}));

import { getCollectorHealthSnapshot } from "../../../src/api/collector-health";

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

function makeSnapshot(statuses: ("never" | "running" | "healthy" | "failed")[]): CollectorHealthSnapshot {
  const collectors = statuses.map((status, i) => ({
    collector: (["hn", "reddit", "twitter", "blog", "web_search"] as const)[i % 5],
    status,
    trigger: status === "never" ? null : ("manual" as const),
    checkedAt: status === "never" ? null : "2026-06-03T10:00:00Z",
    durationMs: status === "never" || status === "running" ? null : 500,
    reason: status === "failed" ? "Connection refused" : null,
    detail: null,
  }));
  return { collectors };
}

describe("useCollectorHealth — REQ-019", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(getCollectorHealthSnapshot).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("REQ-019: returns 2000ms interval when a running entry is present", async () => {
    const snap = makeSnapshot(["running", "healthy"]);
    vi.mocked(getCollectorHealthSnapshot).mockResolvedValue(snap);

    const { result } = renderHook(() => useCollectorHealth(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data?.collectors[0]?.status).toBe("running");
    });

    const callsBefore = vi.mocked(getCollectorHealthSnapshot).mock.calls.length;
    await vi.advanceTimersByTimeAsync(2100);
    expect(vi.mocked(getCollectorHealthSnapshot).mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("REQ-019: stops polling (returns false) when all collectors are terminal", async () => {
    const snap = makeSnapshot(["healthy", "failed", "never"]);
    vi.mocked(getCollectorHealthSnapshot).mockResolvedValue(snap);

    const { result } = renderHook(() => useCollectorHealth(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isFetched).toBe(true);
    });

    const callsAfterSettle = vi.mocked(getCollectorHealthSnapshot).mock.calls.length;
    await vi.advanceTimersByTimeAsync(6000);
    // Should not poll again — all statuses are terminal (never, healthy, failed)
    expect(vi.mocked(getCollectorHealthSnapshot).mock.calls.length).toBe(callsAfterSettle);
  });

  it("REQ-019: stops polling when snapshot has all-healthy collectors", async () => {
    const snap = makeSnapshot(["healthy", "healthy"]);
    vi.mocked(getCollectorHealthSnapshot).mockResolvedValue(snap);

    const { result } = renderHook(() => useCollectorHealth(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isFetched).toBe(true);
    });

    const callsAfterSettle = vi.mocked(getCollectorHealthSnapshot).mock.calls.length;
    await vi.advanceTimersByTimeAsync(6000);
    expect(vi.mocked(getCollectorHealthSnapshot).mock.calls.length).toBe(callsAfterSettle);
  });
});
