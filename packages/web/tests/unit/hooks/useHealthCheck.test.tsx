import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { useHealthCheck } from "../../../src/hooks/useHealthCheck";

vi.mock("../../../src/api/health-check", () => ({
  triggerHealthCheck: vi.fn(),
}));

import { triggerHealthCheck } from "../../../src/api/health-check";

const mockTriggerHealthCheck = triggerHealthCheck as ReturnType<typeof vi.fn>;

function makeWrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  mockTriggerHealthCheck.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useHealthCheck", () => {
  it("calls triggerHealthCheck with the collector type on mutate", async () => {
    mockTriggerHealthCheck.mockResolvedValueOnce({ jobId: "job-1" });
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useHealthCheck("hn"), {
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
    const { result } = renderHook(() => useHealthCheck("reddit"), {
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
    const { result } = renderHook(() => useHealthCheck("twitter"), {
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
