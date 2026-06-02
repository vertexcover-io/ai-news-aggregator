import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  triggerHealthCheck,
  triggerHealthCheckAll,
} from "../../../src/api/health-check";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("triggerHealthCheck", () => {
  it("POSTs /api/admin/health-check/:type for a specific collector", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ jobId: "job-1" }), { status: 202 }),
    );
    const out = await triggerHealthCheck("hn");
    expect(out).toEqual({ jobId: "job-1" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/health-check/hn");
    expect(init.method).toBe("POST");
  });

  it("throws server error on 4xx", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "not found" }), { status: 404 }),
    );
    await expect(triggerHealthCheck("hn")).rejects.toThrow(
      "Health check failed: 404",
    );
  });

  it("works for all collector types", async () => {
    const types = ["hn", "reddit", "twitter", "web_search", "blog"] as const;
    for (const t of types) {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ jobId: `job-${t}` }), { status: 202 }),
      );
      const out = await triggerHealthCheck(t);
      expect(out.jobId).toBe(`job-${t}`);
      const [url] = fetchMock.mock.calls[
        fetchMock.mock.calls.length - 1
      ] as [string];
      expect(url).toBe(`/api/admin/health-check/${t}`);
    }
  });
});

describe("triggerHealthCheckAll", () => {
  it("POSTs /api/admin/health-check for all collectors", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ jobId: "job-all" }), { status: 202 }),
    );
    const out = await triggerHealthCheckAll();
    expect(out).toEqual({ jobId: "job-all" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/health-check");
    expect(init.method).toBe("POST");
  });

  it("throws server error on failure", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "server error" }), {
        status: 500,
      }),
    );
    await expect(triggerHealthCheckAll()).rejects.toThrow(
      "Health check failed: 500",
    );
  });
});
