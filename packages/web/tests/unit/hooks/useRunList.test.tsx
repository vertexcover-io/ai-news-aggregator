import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import type { RunSummary } from "@newsletter/shared";
import { useRunList } from "../../../src/hooks/useRunList";

vi.mock("../../../src/api/runs", () => ({
  listRuns: vi.fn(),
}));

import { listRuns } from "../../../src/api/runs";

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

const completed: RunSummary = {
  runId: "r-done",
  startedAt: "2026-04-14T00:00:00Z",
  completedAt: "2026-04-14T00:01:00Z",
  status: "completed",
  itemCount: 10,
  reviewed: false,
  isDryRun: false,
};

const running: RunSummary = {
  runId: "r-active",
  startedAt: "2026-04-14T00:02:00Z",
  completedAt: null,
  status: "running",
  itemCount: 0,
  reviewed: false,
  isDryRun: false,
};

describe("useRunList", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(listRuns).mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does NOT poll when all runs are terminal (REQ-052)", async () => {
    vi.mocked(listRuns).mockResolvedValue([completed]);
    const { result } = renderHook(() => useRunList(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(result.current.data).toEqual([completed]);
    });
    const callsAfter = vi.mocked(listRuns).mock.calls.length;
    await vi.advanceTimersByTimeAsync(6000);
    expect(vi.mocked(listRuns).mock.calls.length).toBe(callsAfter);
  });

  it("polls every 2s when an active run exists (REQ-052)", async () => {
    vi.mocked(listRuns).mockResolvedValue([running]);
    const { result } = renderHook(() => useRunList(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(result.current.data).toEqual([running]);
    });
    const callsAfter = vi.mocked(listRuns).mock.calls.length;
    await vi.advanceTimersByTimeAsync(2100);
    expect(vi.mocked(listRuns).mock.calls.length).toBeGreaterThan(callsAfter);
  });
});
