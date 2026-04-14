import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunSummary } from "@newsletter/shared";
import { listRuns, triggerRunNow } from "../../../src/api/runs";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const summary: RunSummary = {
  runId: "abc",
  startedAt: "2026-04-14T07:00:00Z",
  completedAt: "2026-04-14T07:02:00Z",
  status: "completed",
  itemCount: 12,
  reviewed: false,
};

describe("listRuns", () => {
  it("fetches /api/runs and returns runs array", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ runs: [summary] }), { status: 200 }),
    );
    const out = await listRuns();
    expect(out).toEqual([summary]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/runs");
  });

  it("appends limit query param", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ runs: [] }), { status: 200 }),
    );
    await listRuns(5);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/runs?limit=5");
  });

  it("throws with server error on 4xx", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "bad" }), { status: 400 }),
    );
    await expect(listRuns()).rejects.toThrow("bad");
  });
});

describe("triggerRunNow", () => {
  it("POSTs /api/runs/now and returns runId", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ runId: "r1" }), { status: 202 }),
    );
    const out = await triggerRunNow();
    expect(out).toEqual({ runId: "r1" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/runs/now");
    expect(init.method).toBe("POST");
  });

  it("throws server error message on 4xx (REQ-053)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "settings not configured" }), {
        status: 409,
      }),
    );
    await expect(triggerRunNow()).rejects.toThrow("settings not configured");
  });
});
