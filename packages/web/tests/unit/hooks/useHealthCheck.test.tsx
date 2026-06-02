import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { useTriggerHealthCheck, useHealthCheckStatus } from "../../../src/hooks/useHealthCheck";

vi.mock("../../../src/api/health-check", () => ({
  triggerHealthCheck: vi.fn(),
  triggerHealthCheckAll: vi.fn(),
  fetchHealthCheckStatus: vi.fn(),
}));

import { triggerHealthCheck, fetchHealthCheckStatus } from "../../../src/api/health-check";

const mockTriggerHealthCheck = triggerHealthCheck as ReturnType<typeof vi.fn>;
const mockFetchHealthCheckStatus = fetchHealthCheckStatus as ReturnType<typeof vi.fn>;

function makeWrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  mockTriggerHealthCheck.mockReset();
  mockFetchHealthCheckStatus.mockReset();
  mockFetchHealthCheckStatus.mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useTriggerHealthCheck", () => {
  it("calls triggerHealthCheck with the collector type on mutate", async () => {
    mockTriggerHealthCheck.mockResolvedValueOnce({ jobId: "job-1" });
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useTriggerHealthCheck("hn"), {
      wrapper: makeWrapper(qc),
    });

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(mockTriggerHealthCheck).toHaveBeenCalledWith("hn");
  });

  it("exposes data on success", async () => {
    mockTriggerHealthCheck.mockResolvedValueOnce({ jobId: "job-2" });
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useTriggerHealthCheck("reddit"), {
      wrapper: makeWrapper(qc),
    });

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual({ jobId: "job-2" });
  });

  it("exposes error on failure", async () => {
    mockTriggerHealthCheck.mockRejectedValueOnce(
      new Error("Health check failed: 500"),
    );
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const { result } = renderHook(() => useTriggerHealthCheck("twitter"), {
      wrapper: makeWrapper(qc),
    });

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error?.message).toBe("Health check failed: 500");
  });
});

describe("useHealthCheckStatus", () => {
  it("returns null report when no status is stored", async () => {
    mockFetchHealthCheckStatus.mockResolvedValueOnce(null);
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useHealthCheckStatus(), {
      wrapper: makeWrapper(qc),
    });

    await waitFor(() => {
      expect(result.current.report).toBeNull();
    });
  });

  it("returns report with results", async () => {
    const report = {
      results: [{ collector: "hn", status: "healthy", durationMs: 100, itemsFound: 1 }],
      totalDurationMs: 500,
      failedCount: 0,
      healthyCount: 1,
      skippedCount: 0,
      storedAt: "2026-06-02T12:00:00Z",
    };
    mockFetchHealthCheckStatus.mockResolvedValueOnce(report);
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useHealthCheckStatus(), {
      wrapper: makeWrapper(qc),
    });

    await waitFor(() => {
      expect(result.current.report?.healthyCount).toBe(1);
    });
  });
});
