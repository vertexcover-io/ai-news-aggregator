import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type { UserSettings } from "@newsletter/shared";
import type {
  Fixture,
  GroundTruth,
} from "@newsletter/shared/types/eval-ranking";
import { createAdminEvalRouter } from "../admin-eval.js";
import { requireAdmin } from "../../auth/middleware.js";
import { issueToken, COOKIE_NAME } from "../../auth/session.js";
import type {
  CreateManualFixtureResult,
  RunEvalOutput,
} from "@newsletter/pipeline/eval";
import type { UserSettingsRepo } from "@api/repositories/user-settings.js";

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

  it("Mode B emits aggregate with saved + draft rankings", async () => {
    const findRawItemsByDate = vi.fn(() =>
      Promise.resolve([
        {
          rawItemId: 101,
          title: "Story A",
          url: "https://example.com/a",
          sourceType: "hn",
          publishedAt: null,
          content: null,
        },
        {
          rawItemId: 102,
          title: "Story B",
          url: "https://example.com/b",
          sourceType: "reddit",
          publishedAt: null,
          content: null,
        },
      ]),
    );
    const runModeB = vi.fn(() =>
      Promise.resolve({
        saved: [{ rawItemId: 101, score: 0.9, rationale: "ok" }],
        draft: [{ rawItemId: 102, score: 0.8, rationale: "ok" }],
        cost: {
          saved: {
            tokensIn: 100,
            tokensOut: 50,
            usd: 0.01,
            cacheHit: false,
            promptHash: "h1",
          },
          draft: {
            tokensIn: 110,
            tokensOut: 55,
            usd: 0.012,
            cacheHit: false,
            promptHash: "h2",
          },
          totalUsd: 0.022,
        },
      }),
    );
    const { app } = makeRouter({ findRawItemsByDate, runModeB });
    const res = await app.request("/api/admin/eval/run", {
      method: "POST",
      headers: { ...authedHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        mode: "ab",
        date: "2026-05-22",
        draftPrompt: "DRAFT",
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(findRawItemsByDate).toHaveBeenCalledWith("2026-05-22");
    expect(runModeB).toHaveBeenCalledOnce();
    expect(text).toContain('"branch":"saved"');
    expect(text).toContain('"branch":"draft"');
    expect(text).toContain("event: aggregate");
    expect(text).toContain('"rawItemId":101');
    expect(text).toContain('"rawItemId":102');
    expect(text).toContain("event: done");
  });

  it("Mode B errors when pool empty", async () => {
    const findRawItemsByDate = vi.fn(() => Promise.resolve([]));
    const runModeB = vi.fn();
    const { app } = makeRouter({ findRawItemsByDate, runModeB });
    const res = await app.request("/api/admin/eval/run", {
      method: "POST",
      headers: { ...authedHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        mode: "ab",
        date: "2026-05-22",
        draftPrompt: "DRAFT",
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("event: error");
    expect(text).toContain("no raw_items for 2026-05-22");
    expect(runModeB).not.toHaveBeenCalled();
  });

  it("Mode A windowSize iterates over top-N graded fixtures", async () => {
    const listFixtures = vi.fn(() =>
      Promise.resolve([
        makeFixture("f-1"),
        makeFixture("f-2"),
        makeFixture("f-3"),
      ]),
    );
    const gradedAtMap: Record<string, string> = {
      "f-1": "2026-05-01T00:00:00Z",
      "f-2": "2026-05-02T00:00:00Z",
      "f-3": "2026-05-03T00:00:00Z",
    };
    const readGroundTruth = vi.fn((id: string): Promise<GroundTruth | null> =>
      Promise.resolve({
        fixtureId: id,
        gradedBy: ["aman"],
        gradedAt: gradedAtMap[id],
        labels: [],
      }),
    );
    const runEval = vi.fn(
      (): Promise<RunEvalOutput> =>
        Promise.resolve({
          rankedItems: [{ rawItemId: -1, score: 0.9, rationale: "ok" }],
          score: {
            fixtureId: "x",
            ndcgAt10: 0.8,
            precisionAt10: 0.5,
            mustIncludeRecall: 1,
            rankOneIsMustInclude: true,
            perItemDiff: [],
            ranAt: "now",
            promptHash: "h",
            model: "m",
          },
          cost: {
            tokensIn: 100,
            tokensOut: 50,
            usd: 0.01,
            cacheHit: false,
            promptHash: "abc",
          },
        }),
    );
    const { app } = makeRouter({ listFixtures, readGroundTruth, runEval });
    const res = await app.request("/api/admin/eval/run", {
      method: "POST",
      headers: { ...authedHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        mode: "scored",
        windowSize: 2,
        draftPrompt: "draft",
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(runEval).toHaveBeenCalledTimes(2);
    // Most recent first: f-3, f-2
    expect(text).toContain('"fixtureId":"f-3"');
    expect(text).toContain('"fixtureId":"f-2"');
    expect(text).not.toContain('"fixtureId":"f-1"');
    expect(text).toContain("event: aggregate");
    expect(text).toContain("meanNdcgAt10");
    expect(text).toContain("event: done");
  });

  it("Mode A windowSize > 60 without forceWindow emits error", async () => {
    const { app } = makeRouter();
    const res = await app.request("/api/admin/eval/run", {
      method: "POST",
      headers: { ...authedHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        mode: "scored",
        windowSize: 65,
        draftPrompt: "draft",
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("event: error");
    expect(text).toContain("forceWindow");
  });

  it("Mode A windowSize > 60 with forceWindow runs (capped to available)", async () => {
    const listFixtures = vi.fn(() => Promise.resolve([makeFixture("f-1")]));
    const readGroundTruth = vi.fn((id: string): Promise<GroundTruth | null> =>
      Promise.resolve({
        fixtureId: id,
        gradedBy: ["aman"],
        gradedAt: "2026-05-01T00:00:00Z",
        labels: [],
      }),
    );
    const runEval = vi.fn(
      (): Promise<RunEvalOutput> =>
        Promise.resolve({
          rankedItems: [],
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
    const { app } = makeRouter({ listFixtures, readGroundTruth, runEval });
    const res = await app.request("/api/admin/eval/run", {
      method: "POST",
      headers: { ...authedHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        mode: "scored",
        windowSize: 65,
        forceWindow: true,
        draftPrompt: "draft",
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(runEval).toHaveBeenCalledTimes(1);
    expect(text).toContain("event: done");
  });

  it("Mode A windowSize: one fixture failure does not abort the stream", async () => {
    const listFixtures = vi.fn(() =>
      Promise.resolve([makeFixture("f-1"), makeFixture("f-2")]),
    );
    const readGroundTruth = vi.fn((id: string): Promise<GroundTruth | null> =>
      Promise.resolve({
        fixtureId: id,
        gradedBy: ["aman"],
        gradedAt: id === "f-1" ? "2026-05-01T00:00:00Z" : "2026-05-02T00:00:00Z",
        labels: [],
      }),
    );
    let call = 0;
    const runEval = vi.fn((): Promise<RunEvalOutput> => {
      call += 1;
      if (call === 1) return Promise.reject(new Error("boom"));
      return Promise.resolve({
        rankedItems: [],
        score: null,
        cost: {
          tokensIn: 10,
          tokensOut: 5,
          usd: 0.001,
          cacheHit: false,
          promptHash: "x",
        },
      });
    });
    const { app } = makeRouter({ listFixtures, readGroundTruth, runEval });
    const res = await app.request("/api/admin/eval/run", {
      method: "POST",
      headers: { ...authedHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        mode: "scored",
        windowSize: 2,
        draftPrompt: "draft",
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(runEval).toHaveBeenCalledTimes(2);
    expect(text).toContain('"status":"error"');
    expect(text).toContain('"error":"boom"');
    expect(text).toContain('"status":"done"');
    expect(text).toContain("event: done");
  });

  it("Mode B errors when date missing or malformed", async () => {
    const { app } = makeRouter({
      findRawItemsByDate: vi.fn(() => Promise.resolve([])),
    });
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
