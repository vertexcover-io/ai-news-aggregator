import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type { UserSettings } from "@newsletter/shared";
import type {
  CalendarRunDetail,
  Fixture,
  GroundTruth,
} from "@newsletter/shared/types/eval-ranking";
import { EvalRunRequestSchema } from "@newsletter/shared/types/eval-ranking-schemas";
import { createAdminEvalRouter } from "../admin-eval.js";
import { requireAdmin } from "../../auth/middleware.js";
import { issueToken, COOKIE_NAME } from "../../auth/session.js";
import type {
  CreateManualFixtureResult,
  RunEvalOutput,
} from "@newsletter/pipeline/eval";
import type { UserSettingsRepo } from "@api/repositories/user-settings.js";
import type { EvalRunsRepo } from "@api/repositories/eval-runs.js";

const SESSION_SECRET = "test-session-secret-32-chars-1234";

function authedHeaders(): Record<string, string> {
  const token = issueToken(SESSION_SECRET);
  return { cookie: `${COOKIE_NAME}=${token}` };
}

function makeFixture(id: string): Fixture {
  return {
    fixtureId: id,
    source: "manual",
    date: null,
    runId: null,
    model: "claude-haiku-4-5-20251001",
    exportedAt: "2026-05-01T00:00:00.000Z",
    pool: [
      {
        rawItemId: -1,
        title: "x",
        url: "https://x.com",
        sourceType: "web_search",
        publishedAt: null,
        content: null,
        enrichedLink: null,
        enrichmentStatus: "ok",
        comments: [],
        engagement: { points: 0, commentCount: 0 },
      },
    ],
    dedupClusters: [],
    originalRankerOutput: null,
  };
}

function makeSettings(): UserSettings {
  return {
    id: "singleton",
    topN: 10,
    halfLifeHours: 24,
    hnEnabled: false,
    hnConfig: null,
    redditEnabled: false,
    redditConfig: null,
    webEnabled: false,
    webConfig: null,
    twitterEnabled: false,
    twitterConfig: null,
    webSearchEnabled: false,
    webSearchConfig: null,
    posthogEnabled: false,
    posthogProjectToken: null,
    posthogHost: null,
    scheduleTime: "08:00",
    pipelineTime: "08:00",
    emailTime: "09:00",
    linkedinTime: "10:00",
    twitterTime: "10:30",
    scheduleTimezone: "UTC",
    scheduleEnabled: false,
    emailEnabled: false,
    linkedinEnabled: false,
    twitterPostEnabled: false,
    autoReview: false,
    rankingPrompt: "OLD PROMPT",
    updatedAt: new Date().toISOString(),
  };
}

function makeRouter(overrides: Partial<Parameters<typeof createAdminEvalRouter>[0]> = {}) {
  const settings = makeSettings();
  const upsert = vi.fn((input: Parameters<UserSettingsRepo["upsert"]>[0]) =>
    Promise.resolve({ ...settings, rankingPrompt: input.rankingPrompt }),
  );
  const repo: UserSettingsRepo = {
    get: () => Promise.resolve(settings),
    upsert,
  };
  const router = createAdminEvalRouter({
    getSettingsRepo: () => repo,
    listFixtures: vi.fn(() =>
      Promise.resolve([makeFixture("manual-a-1"), makeFixture("manual-b-2")]),
    ),
    readFixture: vi.fn((id: string) => Promise.resolve(makeFixture(id))),
    readGroundTruth: vi.fn((id: string): Promise<GroundTruth | null> =>
      Promise.resolve(
        id === "manual-a-1"
          ? { fixtureId: id, gradedBy: ["aman"], gradedAt: "now", labels: [] }
          : null,
      ),
    ),
    writeGroundTruth: vi.fn(() => Promise.resolve("/tmp/path")),
    createManualFixture: vi.fn(
      (urls: string[]): Promise<CreateManualFixtureResult> =>
        Promise.resolve({
          fixture: {
            ...makeFixture("manual-new-1"),
            pool: urls.map((u, i) => ({
              rawItemId: -(i + 1),
              title: u,
              url: u,
              sourceType: "web_search",
              publishedAt: null,
              content: null,
              enrichedLink: null,
              enrichmentStatus: "ok",
              comments: [],
              engagement: { points: 0, commentCount: 0 },
            })),
          },
          path: "/tmp/manual-new-1.json",
          enrichment: {
            attempted: urls.length,
            ok: urls.length,
            failed: 0,
            skipped: 0,
          },
        }),
    ),
    runEval: vi.fn(
      (): Promise<RunEvalOutput> =>
        Promise.resolve({
          rankedItems: [{ rawItemId: -1, score: 0.9, rationale: "ok" }],
          score: null,
          cost: {
            tokensIn: 100,
            tokensOut: 50,
            usd: 0.01,
            cacheHit: false,
            promptHash: "abc",
          },
        }),
    ),
    env: { NODE_ENV: "test" },
    ...overrides,
  });
  const app = new Hono();
  app.use("/api/admin/*", requireAdmin(SESSION_SECRET));
  app.route("/api/admin/eval", router);
  return { app, upsert };
}

function parseSseData(text: string, eventName: string): unknown[] {
  return text
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.includes(`event: ${eventName}`))
    .map((chunk) => {
      const dataLine = chunk
        .split("\n")
        .find((line) => line.startsWith("data: "));
      if (dataLine === undefined) return null;
      const parsed: unknown = JSON.parse(dataLine.slice("data: ".length));
      return parsed;
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

describe("admin-eval auth", () => {
  it("returns 401 without cookie on every route", async () => {
    const { app } = makeRouter();
    const paths: [string, { method: string; body?: string }][] = [
      ["/api/admin/eval/fixtures", { method: "GET" }],
      ["/api/admin/eval/fixtures/abc", { method: "GET" }],
      ["/api/admin/eval/fixtures", { method: "POST", body: "{}" }],
      ["/api/admin/eval/groundtruth/abc", { method: "POST", body: "{}" }],
      [
        "/api/admin/eval/groundtruth/abc/save-to-repo",
        { method: "POST", body: "{}" },
      ],
      ["/api/admin/eval/save-prompt", { method: "POST", body: "{}" }],
      ["/api/admin/eval/run", { method: "POST", body: "{}" }],
    ];
    for (const [path, init] of paths) {
      const res = await app.request(path, {
        method: init.method,
        headers: { "content-type": "application/json" },
        body: init.body,
      });
      expect(res.status, `unauth ${init.method} ${path}`).toBe(401);
    }
  });
});

describe("GET /fixtures", () => {
  it("returns list with grading status", async () => {
    const { app } = makeRouter();
    const res = await app.request("/api/admin/eval/fixtures", {
      headers: authedHeaders(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fixtures: { fixtureId: string; gradingStatus: string }[] };
    expect(body.fixtures).toHaveLength(2);
    const byId = Object.fromEntries(
      body.fixtures.map((f) => [f.fixtureId, f.gradingStatus]),
    );
    expect(byId["manual-a-1"]).toBe("graded");
    expect(byId["manual-b-2"]).toBe("ungraded");
  });
});

describe("POST /fixtures", () => {
  it("returns 422 on invalid URLs", async () => {
    const { app } = makeRouter();
    const res = await app.request("/api/admin/eval/fixtures", {
      method: "POST",
      headers: { ...authedHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ urls: ["not-a-url"] }),
    });
    expect(res.status).toBe(422);
  });
  it("creates manual fixture and returns id + count", async () => {
    const { app } = makeRouter();
    const res = await app.request("/api/admin/eval/fixtures", {
      method: "POST",
      headers: { ...authedHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        urls: ["https://example.com/a", "https://example.com/b"],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fixtureId: string; itemCount: number };
    expect(body.fixtureId).toBe("manual-new-1");
    expect(body.itemCount).toBe(2);
  });
});

describe("POST /groundtruth/:fixtureId", () => {
  it("422 on body fixtureId mismatch", async () => {
    const { app } = makeRouter();
    const res = await app.request("/api/admin/eval/groundtruth/aaa", {
      method: "POST",
      headers: { ...authedHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        fixtureId: "bbb",
        gradedBy: ["aman"],
        gradedAt: "now",
        labels: [],
      }),
    });
    expect(res.status).toBe(422);
  });
  it("writes ground truth", async () => {
    const writeFn = vi.fn(() => Promise.resolve("/tmp/aaa.json"));
    const { app } = makeRouter({
      writeGroundTruth: writeFn,
      readGroundTruth: vi.fn((id: string): Promise<GroundTruth> =>
        Promise.resolve({
          fixtureId: id,
          gradedBy: ["aman"],
          gradedAt: "now",
          labels: [],
        }),
      ),
    });
    const res = await app.request("/api/admin/eval/groundtruth/manual-a-1", {
      method: "POST",
      headers: { ...authedHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        fixtureId: "manual-a-1",
        gradedBy: ["aman"],
        gradedAt: "now",
        labels: [],
      }),
    });
    expect(res.status).toBe(200);
    expect(writeFn).toHaveBeenCalledOnce();
  });
});

describe("POST /groundtruth/:fixtureId/save-to-repo", () => {
  it("403 when env gate closed", async () => {
    const { app } = makeRouter({ env: { NODE_ENV: "production" } });
    const res = await app.request(
      "/api/admin/eval/groundtruth/manual-a-1/save-to-repo",
      {
        method: "POST",
        headers: { ...authedHeaders(), "content-type": "application/json" },
        body: JSON.stringify({
          fixtureId: "manual-a-1",
          gradedBy: ["aman"],
          gradedAt: "now",
          labels: [],
        }),
      },
    );
    expect(res.status).toBe(403);
  });
  it("200 when gate open", async () => {
    const writeFn = vi.fn(() => Promise.resolve("/repo/path"));
    const { app } = makeRouter({
      env: { NODE_ENV: "development", EVAL_WRITE_TO_REPO: "true" },
      writeGroundTruth: writeFn,
    });
    const res = await app.request(
      "/api/admin/eval/groundtruth/manual-a-1/save-to-repo",
      {
        method: "POST",
        headers: { ...authedHeaders(), "content-type": "application/json" },
        body: JSON.stringify({
          fixtureId: "manual-a-1",
          gradedBy: ["aman"],
          gradedAt: "now",
          labels: [],
        }),
      },
    );
    expect(res.status).toBe(200);
    expect(writeFn).toHaveBeenCalledOnce();
  });
});

describe("POST /save-prompt", () => {
  it("calls settings repo upsert with new prompt", async () => {
    const { app, upsert } = makeRouter();
    const res = await app.request("/api/admin/eval/save-prompt", {
      method: "POST",
      headers: { ...authedHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ prompt: "NEW PROMPT TEXT" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rankingPrompt: string };
    expect(body.rankingPrompt).toBe("NEW PROMPT TEXT");
    expect(upsert).toHaveBeenCalledOnce();
    expect(upsert.mock.calls[0][0].rankingPrompt).toBe("NEW PROMPT TEXT");
  });
  it("returns 422 on empty prompt", async () => {
    const { app } = makeRouter();
    const res = await app.request("/api/admin/eval/save-prompt", {
      method: "POST",
      headers: { ...authedHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ prompt: "" }),
    });
    expect(res.status).toBe(422);
  });
});

describe("POST /run SSE", () => {
  it("REQ-003 EDGE-002: rejects legacy Top-N scored request fields", async () => {
    const schemaResult = EvalRunRequestSchema.safeParse({
      mode: "scored",
      windowSize: 2,
      draftPrompt: "draft",
    });
    expect(schemaResult.success).toBe(false);

    const runEval = vi.fn();
    const { app } = makeRouter({ runEval });
    const res = await app.request("/api/admin/eval/run", {
      method: "POST",
      headers: { ...authedHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        mode: "scored",
        windowSize: 2,
        draftPrompt: "draft",
      }),
    });
    expect(res.status).toBe(422);
    expect(runEval).not.toHaveBeenCalled();
  });

  it("REQ-002: scored mode requires fixtureId", async () => {
    const runEval = vi.fn();
    const { app } = makeRouter({ runEval });
    const res = await app.request("/api/admin/eval/run", {
      method: "POST",
      headers: { ...authedHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        mode: "scored",
        draftPrompt: "draft",
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("event: error");
    expect(text).toContain("fixtureId required for scored mode");
    expect(runEval).not.toHaveBeenCalled();
  });

  it("streams progress + done events", async () => {
    const { app } = makeRouter();
    const res = await app.request("/api/admin/eval/run", {
      method: "POST",
      headers: { ...authedHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        mode: "scored",
        fixtureId: "manual-a-1",
        draftPrompt: "draft",
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const text = await res.text();
    expect(text).toContain("event: progress");
    expect(text).toContain('"status":"running"');
    expect(text).toContain('"status":"done"');
    expect(text).toContain("event: done");
    expect(text).toContain("sourcingReport");
  });

  it("REQ-004: successful scored progress event includes report payload", async () => {
    const { app } = makeRouter();
    const res = await app.request("/api/admin/eval/run", {
      method: "POST",
      headers: { ...authedHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        mode: "scored",
        fixtureId: "manual-a-1",
        draftPrompt: "draft",
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    const progressPayloads = parseSseData(text, "progress");
    const completedPayload = progressPayloads.find(
      (payload) => isRecord(payload) && payload.status === "done",
    );
    expect(completedPayload).toBeDefined();
    expect(completedPayload).toMatchObject({
      fixtureId: "manual-a-1",
      actualRanking: [
        {
          rawItemId: -1,
          url: "https://x.com",
          title: "x",
          score: 0.9,
          rationale: "ok",
        },
      ],
      expectedRanking: [],
    });
  });

  it("REQ-008 REQ-009 REQ-010 REQ-011: Mode B runs draft ranking for selected runs and persists reports", async () => {
    const detail: CalendarRunDetail = {
      runId: "run-1",
      completedAt: "2026-05-22T10:00:00.000Z",
      createdAt: "2026-05-22T09:55:00.000Z",
      startedAt: "2026-05-22T09:50:00.000Z",
      itemCount: 2,
      topN: 10,
      digestHeadline: null,
      digestSummary: null,
      sourceTypes: ["hn", "reddit"],
      previousRanking: [
        {
          rank: 1,
          rawItemId: 101,
          title: "Previous top",
          url: "https://example.com/a",
          sourceType: "hn",
          score: 0.99,
          rationale: "old",
          summary: "",
          bullets: [],
          bottomLine: "",
        },
      ],
      sourcePool: [
        {
          rawItemId: 101,
          title: "Previous top",
          url: "https://example.com/a",
          sourceType: "hn",
          publishedAt: null,
          content: null,
          enrichedLink: null,
          enrichmentStatus: "ok",
          comments: [],
          engagement: { points: 0, commentCount: 0 },
        },
        {
          rawItemId: 102,
          title: "Draft winner",
          url: "https://example.com/b",
          sourceType: "reddit",
          publishedAt: null,
          content: null,
          enrichedLink: null,
          enrichmentStatus: "ok",
          comments: [],
          engagement: { points: 0, commentCount: 0 },
        },
      ],
    };
    const getCalendarRunDetail = vi.fn(() => Promise.resolve(detail));
    const updateFinish = vi
      .fn<EvalRunsRepo["updateFinish"]>()
      .mockResolvedValue({ rowsAffected: 1 });
    const evalRunsRepo: EvalRunsRepo = {
      insert: vi.fn(() =>
        Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }),
      ),
      updateFinish,
      updateFailed: vi.fn(() => Promise.resolve({ rowsAffected: 1 })),
      getById: vi.fn(() => Promise.resolve(null)),
      list: vi.fn(() => Promise.resolve({ runs: [], total: 0 })),
    };
    const runEval = vi.fn(
      (): Promise<RunEvalOutput> =>
        Promise.resolve({
          rankedItems: [{ rawItemId: 102, score: 0.8, rationale: "new" }],
          score: null,
          cost: {
            tokensIn: 110,
            tokensOut: 55,
            usd: 0.012,
            cacheHit: false,
            promptHash: "h2",
          },
        }),
    );
    const { app } = makeRouter({
      getCalendarRunDetail,
      getEvalRunsRepo: () => evalRunsRepo,
      runEval,
    });
    const res = await app.request("/api/admin/eval/run", {
      method: "POST",
      headers: { ...authedHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        mode: "ab",
        date: "2026-05-22",
        runIds: ["run-1"],
        draftPrompt: "DRAFT",
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(getCalendarRunDetail).toHaveBeenCalledWith("run-1");
    expect(runEval).toHaveBeenCalledOnce();
    expect(runEval).toHaveBeenCalledWith(
      expect.objectContaining({
        groundTruth: null,
        prompt: "DRAFT",
      }),
    );
    expect(text).toContain('"runId":"run-1"');
    expect(text).toContain('"previousRanking"');
    expect(text).toContain('"draftRanking"');
    expect(text).toContain('"savedPromptSnapshot":"OLD PROMPT"');
    expect(text).toContain('"draftPromptSnapshot":"DRAFT"');
    expect(text).toContain("event: done");
    expect(updateFinish).toHaveBeenCalledOnce();
    const finishPayload = updateFinish.mock.calls[0]?.[1];
    expect(finishPayload).toMatchObject({
      scoreBreakdown: {
        calendarRuns: [
          {
            runId: "run-1",
            status: "done",
            previousRanking: detail.previousRanking,
          },
        ],
      },
      costBreakdown: {
        totalUsd: 0.012,
        perRun: [
          {
            runId: "run-1",
            cost: {
              usd: 0.012,
            },
          },
        ],
      },
    });
  });

  it("EDGE-005: Mode B rejects an empty run selection", async () => {
    const runEval = vi.fn();
    const { app } = makeRouter({ runEval });
    const res = await app.request("/api/admin/eval/run", {
      method: "POST",
      headers: { ...authedHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        mode: "ab",
        date: "2026-05-22",
        runIds: [],
        draftPrompt: "DRAFT",
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("event: error");
    expect(text).toContain("runIds required");
    expect(runEval).not.toHaveBeenCalled();
  });

  it("EDGE-006: Mode B emits a failed row without blocking other selected runs", async () => {
    const okDetail: CalendarRunDetail = {
      runId: "ok",
      completedAt: "2026-05-22T10:00:00.000Z",
      createdAt: "2026-05-22T09:55:00.000Z",
      startedAt: "2026-05-22T09:50:00.000Z",
      itemCount: 1,
      topN: 10,
      digestHeadline: null,
      digestSummary: null,
      sourceTypes: ["hn"],
      previousRanking: [],
      sourcePool: [
        {
          rawItemId: 201,
          title: "Ok",
          url: "https://example.com/ok",
          sourceType: "hn",
          publishedAt: null,
          content: null,
          enrichedLink: null,
          enrichmentStatus: "ok",
          comments: [],
          engagement: { points: 0, commentCount: 0 },
        },
      ],
    };
    const getCalendarRunDetail = vi.fn((runId: string) =>
      runId === "missing" ? Promise.resolve(null) : Promise.resolve(okDetail),
    );
    const runEval = vi.fn(
      (): Promise<RunEvalOutput> =>
        Promise.resolve({
          rankedItems: [{ rawItemId: 201, score: 0.7, rationale: "ok" }],
          score: null,
          cost: {
            tokensIn: 10,
            tokensOut: 5,
            usd: 0.001,
            cacheHit: false,
            promptHash: "x",
          },
        }),
    );
    const { app } = makeRouter({ getCalendarRunDetail, runEval });
    const res = await app.request("/api/admin/eval/run", {
      method: "POST",
      headers: { ...authedHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        mode: "ab",
        date: "2026-05-22",
        runIds: ["missing", "ok"],
        draftPrompt: "DRAFT",
      }),
    });
    const text = await res.text();
    expect(runEval).toHaveBeenCalledOnce();
    expect(text).toContain('"runId":"missing"');
    expect(text).toContain('"status":"error"');
    expect(text).toContain('"runId":"ok"');
    expect(text).toContain('"status":"done"');
    expect(text).toContain("event: done");
  });

  it("REQ-004 REQ-005: lists completed calendar runs for a date", async () => {
    const listCalendarRunsByDate = vi.fn(() =>
      Promise.resolve([
        {
          runId: "run-1",
          completedAt: "2026-05-22T10:00:00.000Z",
          createdAt: "2026-05-22T09:55:00.000Z",
          startedAt: "2026-05-22T09:50:00.000Z",
          itemCount: 3,
          topN: 10,
          digestHeadline: "AI infra shifts",
          digestSummary: null,
          sourceTypes: ["hn", "reddit"],
        },
      ]),
    );
    const { app } = makeRouter({ listCalendarRunsByDate });
    const res = await app.request(
      "/api/admin/eval/calendar-runs?date=2026-05-22",
      { headers: authedHeaders() },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      date: string;
      runs: { runId: string; itemCount: number; digestHeadline: string }[];
    };
    expect(listCalendarRunsByDate).toHaveBeenCalledWith("2026-05-22");
    expect(body).toMatchObject({
      date: "2026-05-22",
      runs: [
        {
          runId: "run-1",
          itemCount: 3,
          digestHeadline: "AI infra shifts",
        },
      ],
    });
  });

  it("Mode B errors when date missing or malformed", async () => {
    const { app } = makeRouter();
    const res = await app.request("/api/admin/eval/run", {
      method: "POST",
      headers: { ...authedHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        mode: "ab",
        date: "bad-date",
        draftPrompt: "DRAFT",
      }),
    });
    const text = await res.text();
    expect(text).toContain("event: error");
    expect(text).toContain("date required");
  });
});
