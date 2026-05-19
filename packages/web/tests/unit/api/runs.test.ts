import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunSummary, RunState } from "@newsletter/shared";
import { cancelRun, listRuns, triggerRunNow } from "../../../src/api/runs";

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
  isDryRun: false,
  costBreakdown: null,
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

  it("sends body { dryRun: true } when opts.dryRun is true", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ runId: "r2" }), { status: 202 }),
    );
    await triggerRunNow({ dryRun: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/runs/now");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ dryRun: true }));
  });

  it("omits body when opts is undefined", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ runId: "r3" }), { status: 202 }),
    );
    await triggerRunNow();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeUndefined();
  });
});

const cancelledRunState: RunState = {
  id: "r-cancel",
  status: "cancelling",
  stage: "collecting",
  topN: 10,
  startedAt: "2026-04-15T08:00:00Z",
  updatedAt: "2026-04-15T08:00:05Z",
  completedAt: null,
  sources: {},
  rankedItems: null,
  warnings: [],
  error: null,
};

describe("cancelRun (REQ-01, EDGE-02)", () => {
  it("POSTs /api/runs/:runId/cancel and returns { status: 'ok', run } on 200", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ run: cancelledRunState }), { status: 200 }),
    );
    const out = await cancelRun("r-cancel");
    expect(out.status).toBe("ok");
    if (out.status === "ok") {
      expect(out.run.status).toBe("cancelling");
    }
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/runs/r-cancel/cancel");
    expect(init.method).toBe("POST");
  });

  it("resolves { status: 'already-terminal' } on 409 — run already terminal (EDGE-02)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "run is not cancellable", status: "completed" }), { status: 409 }),
    );
    const result = await cancelRun("r-cancel");
    expect(result.status).toBe("already-terminal");
  });

  it("409 result does not have a run property", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "run is not cancellable", status: "completed" }), { status: 409 }),
    );
    const result = await cancelRun("r-cancel");
    expect(result.status).toBe("already-terminal");
    expect("run" in result).toBe(false);
  });

  it("throws on non-200/409 responses", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "not found" }), { status: 404 }),
    );
    await expect(cancelRun("r-missing")).rejects.toThrow("not found");
  });
});
