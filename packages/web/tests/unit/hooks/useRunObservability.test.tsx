import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import type { RunObservability } from "@newsletter/shared/types";
import { useRunObservability } from "../../../src/hooks/useRunObservability";

vi.mock("../../../src/api/runs", () => ({
  getRunObservability: vi.fn(),
}));

import { getRunObservability } from "../../../src/api/runs";

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

function makePayload(
  overrides: Partial<RunObservability["run"]>,
): RunObservability {
  return {
    run: {
      runId: "run-1",
      status: "running",
      stage: "ranking",
      startedAt: "2026-05-25T09:02:14Z",
      completedAt: null,
      isDryRun: false,
      reviewed: false,
      ...overrides,
    },
    funnel: { collected: null, deduped: null, shortlisted: null, ranked: null },
    sources: [],
    enrichment: null,
    stages: [],
    cost: null,
    logs: [],
    failures: [],
    live: true,
  };
}

describe("useRunObservability", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(getRunObservability).mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("REQ-032: polls every 2s while the run is non-terminal", async () => {
    vi.mocked(getRunObservability).mockResolvedValue(
      makePayload({ status: "running" }),
    );
    const { result } = renderHook(() => useRunObservability("run-1"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(result.current.data?.run.status).toBe("running");
    });
    const callsAfter = vi.mocked(getRunObservability).mock.calls.length;
    await vi.advanceTimersByTimeAsync(2100);
    expect(
      vi.mocked(getRunObservability).mock.calls.length,
    ).toBeGreaterThan(callsAfter);
  });

  it("REQ-032: stops polling once the run is terminal (completed)", async () => {
    vi.mocked(getRunObservability).mockResolvedValue(
      makePayload({ status: "completed" }),
    );
    const { result } = renderHook(() => useRunObservability("run-1"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(result.current.data?.run.status).toBe("completed");
    });
    const callsAfter = vi.mocked(getRunObservability).mock.calls.length;
    await vi.advanceTimersByTimeAsync(6000);
    expect(vi.mocked(getRunObservability).mock.calls.length).toBe(callsAfter);
  });

  it("REQ-032: stops polling on failed status", async () => {
    vi.mocked(getRunObservability).mockResolvedValue(
      makePayload({ status: "failed" }),
    );
    const { result } = renderHook(() => useRunObservability("run-1"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(result.current.data?.run.status).toBe("failed");
    });
    const callsAfter = vi.mocked(getRunObservability).mock.calls.length;
    await vi.advanceTimersByTimeAsync(6000);
    expect(vi.mocked(getRunObservability).mock.calls.length).toBe(callsAfter);
  });

  it("REQ-032: stops polling on cancelled status", async () => {
    vi.mocked(getRunObservability).mockResolvedValue(
      makePayload({ status: "cancelled" }),
    );
    const { result } = renderHook(() => useRunObservability("run-1"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(result.current.data?.run.status).toBe("cancelled");
    });
    const callsAfter = vi.mocked(getRunObservability).mock.calls.length;
    await vi.advanceTimersByTimeAsync(6000);
    expect(vi.mocked(getRunObservability).mock.calls.length).toBe(callsAfter);
  });

  it("REQ-024: does not poll after a 404 returns null", async () => {
    vi.mocked(getRunObservability).mockResolvedValue(null);
    const { result } = renderHook(() => useRunObservability("run-missing"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(result.current.isFetched).toBe(true);
    });
    expect(result.current.data).toBeNull();
    const callsAfter = vi.mocked(getRunObservability).mock.calls.length;
    await vi.advanceTimersByTimeAsync(6000);
    expect(vi.mocked(getRunObservability).mock.calls.length).toBe(callsAfter);
  });
});
