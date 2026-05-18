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
import { useDeleteArchive } from "../../../src/hooks/useDeleteArchive";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function makeWrapper(
  client: QueryClient,
): (props: { children: ReactNode }) => ReactElement {
  return function Wrapper({ children }): ReactElement {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

describe("useDeleteArchive", () => {
  it("issues a DELETE to /api/admin/archives/:runId", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = makeClient();
    const { result } = renderHook(() => useDeleteArchive(), {
      wrapper: makeWrapper(client),
    });
    result.current.mutate("some-uuid");
    await waitFor(() => {
      expect(result.current.status).toBe("success");
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/archives/some-uuid");
    expect(init.method).toBe("DELETE");
  });

  it("invalidates the [\"runs\"] query on success", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useDeleteArchive(), {
      wrapper: makeWrapper(client),
    });
    result.current.mutate("run-1");
    await waitFor(() => {
      expect(result.current.status).toBe("success");
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["runs"] });
  });

  it("reports an error when the server returns a failure status", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const client = makeClient();
    const { result } = renderHook(() => useDeleteArchive(), {
      wrapper: makeWrapper(client),
    });
    result.current.mutate("missing-id");
    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });
    expect(result.current.error).toBeInstanceOf(Error);
  });
});
