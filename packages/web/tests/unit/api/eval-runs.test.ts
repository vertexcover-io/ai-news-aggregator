import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  EvalRun,
  EvalRunSummary,
} from "@newsletter/shared/types/eval-ranking";
import {
  EvalApiError,
  getEvalRun,
  listEvalRuns,
} from "../../../src/api/eval";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const summary: EvalRunSummary = {
  id: "run-1",
  mode: "scored",
  fixtureId: "fx-1",
  date: "2026-05-01",
  windowSize: 10,
  draftPromptHash: "abc123",
  savedPromptHash: null,
  status: "done",
  startedAt: "2026-05-01T07:00:00Z",
  finishedAt: "2026-05-01T07:01:00Z",
  scoreBreakdown: null,
  costBreakdown: null,
  errorMessage: null,
};

const fullRun: EvalRun = {
  ...summary,
  draftPromptSnapshot: "draft prompt body",
  savedPromptSnapshot: null,
};

describe("listEvalRuns", () => {
  it("serializes defined params into the query string and returns body", async () => {
    const body: { runs: EvalRunSummary[]; total: number; page: number; perPage: number } = {
      runs: [summary],
      total: 1,
      page: 2,
      perPage: 5,
    };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status: 200 }),
    );
    const out = await listEvalRuns({
      page: 2,
      perPage: 5,
      mode: "scored",
      status: "done",
    });
    expect(out).toEqual(body);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/admin/eval/runs?page=2&perPage=5&mode=scored&status=done",
    );
  });

  it("hits /api/admin/eval/runs with no query string when no params provided", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ runs: [], total: 0, page: 1, perPage: 20 }),
        { status: 200 },
      ),
    );
    const out = await listEvalRuns();
    expect(out.runs).toEqual([]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/admin/eval/runs");
  });
});

describe("getEvalRun", () => {
  it("builds /api/admin/eval/runs/:id and returns the unwrapped EvalRun", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ run: fullRun }), { status: 200 }),
    );
    const out = await getEvalRun("abc-123");
    expect(out).toEqual(fullRun);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/admin/eval/runs/abc-123",
    );
  });

  it("throws EvalApiError with status 404 on a 404 response", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "not found" }), { status: 404 }),
    );
    await expect(getEvalRun("bad-id")).rejects.toMatchObject({
      name: "EvalApiError",
      status: 404,
    });
    // re-issue to assert instanceof
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "not found" }), { status: 404 }),
    );
    await expect(getEvalRun("bad-id")).rejects.toBeInstanceOf(EvalApiError);
  });
});
