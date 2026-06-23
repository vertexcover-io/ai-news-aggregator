import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunSourceItemsResponse } from "@newsletter/shared/types";
import { useRunSourceItems } from "../../../src/hooks/useRunSourceItems";

vi.mock("../../../src/api/runs", () => ({
  getRunSourceItems: vi.fn(),
}));

import { getRunSourceItems } from "../../../src/api/runs";

function makeWrapper(client: QueryClient): (props: { children: ReactNode }) => ReactElement {
  return function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function makeResponse(): RunSourceItemsResponse {
  return {
    runId: "run-1",
    sourceKey: "reddit:r/AI_Agents",
    live: false,
    summary: {
      ranked: 0,
      shortlisted: 0,
      dedupedSurvivors: 0,
      dedupDropped: 0,
      enrichFailed: 0,
    },
    steps: [],
    items: [],
    logs: [],
  };
}

describe("useRunSourceItems", () => {
  beforeEach(() => {
    vi.mocked(getRunSourceItems).mockReset();
  });

  it("REQ-003: does not fetch until the row is expanded", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    vi.mocked(getRunSourceItems).mockResolvedValue(makeResponse());

    const { rerender, result } = renderHook(
      ({ expanded }) =>
        useRunSourceItems("run-1", "reddit:r/AI_Agents", expanded),
      {
        initialProps: { expanded: false },
        wrapper: makeWrapper(client),
      },
    );

    expect(result.current.fetchStatus).toBe("idle");
    expect(getRunSourceItems).not.toHaveBeenCalled();

    rerender({ expanded: true });

    await waitFor(() => {
      expect(getRunSourceItems).toHaveBeenCalledWith("run-1", "reddit:r/AI_Agents");
    });
    expect(
      client.getQueryData(["run-source-items", "run-1", "reddit:r/AI_Agents"]),
    ).toEqual(makeResponse());
  });
});
