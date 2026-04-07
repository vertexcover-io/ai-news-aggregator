import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import { useRunPolling } from "../../src/hooks/useRunPolling";
import type { RunStateResponse } from "../../src/api/runs";

vi.mock("../../src/api/runs", () => ({
  getRun: vi.fn(),
}));

import { getRun } from "../../src/api/runs";

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

const baseRunState: RunStateResponse = {
  id: "run-1",
  status: "completed",
  stage: "completed",
  topN: 10,
  startedAt: "2026-04-07T00:00:00Z",
  updatedAt: "2026-04-07T00:00:10Z",
  completedAt: "2026-04-07T00:00:10Z",
  sources: { hn: { status: "completed", itemsFetched: 5, errors: [] } },
  rankedItems: [],
  warnings: [],
  error: null,
};

describe("useRunPolling", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops polling when status is terminal (completed)", async () => {
    vi.mocked(getRun).mockResolvedValue(baseRunState);

    const { result } = renderHook(() => useRunPolling("run-1"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data?.status).toBe("completed");
    });

    const callsAfterFirstResolve = vi.mocked(getRun).mock.calls.length;
    await vi.advanceTimersByTimeAsync(6000);
    expect(vi.mocked(getRun).mock.calls.length).toBe(callsAfterFirstResolve);
  });

  it("stops polling when getRun returns null (404, REQ-114)", async () => {
    vi.mocked(getRun).mockResolvedValue(null);

    const { result } = renderHook(() => useRunPolling("run-missing"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isFetched).toBe(true);
    });
    expect(result.current.data).toBeNull();

    const callsAfterFirstResolve = vi.mocked(getRun).mock.calls.length;
    await vi.advanceTimersByTimeAsync(6000);
    expect(vi.mocked(getRun).mock.calls.length).toBe(callsAfterFirstResolve);
  });
});
