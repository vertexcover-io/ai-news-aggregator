import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { useTriggerSocialPost } from "../../../src/hooks/useTriggerSocialPost";

vi.mock("../../../src/api/runs", () => ({
  triggerSocialPost: vi.fn(),
}));

import { triggerSocialPost } from "../../../src/api/runs";

const mockTriggerSocialPost = triggerSocialPost as ReturnType<typeof vi.fn>;

function makeWrapper(qc: QueryClient): ({ children }: { children: React.ReactNode }) => React.ReactElement {
  return ({ children }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  mockTriggerSocialPost.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useTriggerSocialPost (REQ-013, REQ-014)", () => {
  it("calls triggerSocialPost with runId and channel on mutate", async () => {
    mockTriggerSocialPost.mockResolvedValueOnce(undefined);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(
      () => useTriggerSocialPost("run-123"),
      { wrapper: makeWrapper(qc) },
    );

    act(() => {
      result.current.mutate("linkedin");
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(mockTriggerSocialPost).toHaveBeenCalledWith("run-123", "linkedin");
  });

  it("exposes error on failure", async () => {
    mockTriggerSocialPost.mockRejectedValueOnce(new Error("already posted"));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

    const { result } = renderHook(
      () => useTriggerSocialPost("run-abc"),
      { wrapper: makeWrapper(qc) },
    );

    act(() => {
      result.current.mutate("linkedin");
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error?.message).toBe("already posted");
  });
});
