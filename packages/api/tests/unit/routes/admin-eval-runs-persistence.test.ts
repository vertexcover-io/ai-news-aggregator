import { describe, it, expect, vi } from "vitest";
import { setTestTenant } from "../../helpers/tenant.js";
import { Hono } from "hono";
import type {
  Fixture,
  UserSettings,
} from "@newsletter/shared";
import type {
  EvalRun,
  EvalRunSummary,
} from "@newsletter/shared/types/eval-ranking";
import {
  createAdminEvalRouter,
  type AdminEvalRouterDeps,
} from "@api/routes/admin-eval.js";
import type { EvalRunsRepo } from "@api/repositories/eval-runs.js";
import type { UserSettingsRepo } from "@api/repositories/user-settings.js";

function makeFixture(id = "f1"): Fixture {
  return {
    fixtureId: id,
    source: "manual",
    date: null,
    runId: null,
    model: "claude-haiku-4-5-20251001",
    exportedAt: "2026-05-01T00:00:00Z",
    pool: [
      {
        rawItemId: 1,
        title: "t1",
        url: "https://example.com/1",
        sourceType: "hn",
        publishedAt: null,
        content: null,
        enrichedLink: null,
        enrichmentStatus: "ok",
        comments: [],
        engagement: { points: 1, commentCount: 0 },
      },
    ],
    dedupClusters: [],
    originalRankerOutput: null,
  };
}

function makeSettings(rankingPrompt = "saved-prompt-body"): UserSettings {
  return {
    id: 1,
    topN: 10,
    halfLifeHours: 12,
    hnEnabled: true,
    hnConfig: null,
    redditEnabled: false,
    redditConfig: null,
    webSearchEnabled: false,
    webSearchConfig: null,
    twitterEnabled: false,
    twitterConfig: null,
    rankingModel: "claude-haiku-4-5-20251001",
    rankingPrompt,
    pipelineTime: "08:00",
    scheduleTime: "08:00",
    timezone: "UTC",
    autoReview: false,
    updatedAt: new Date(),
  } as UserSettings;
}

function makeSettingsRepo(rankingPrompt = "saved-prompt-body"): UserSettingsRepo {
  return {
    get: vi.fn(() => Promise.resolve(makeSettings(rankingPrompt))),
    upsert: vi.fn(() => Promise.resolve(makeSettings(rankingPrompt))),
  };
}

function makeEvalRunsRepo(overrides: Partial<EvalRunsRepo> = {}): EvalRunsRepo {
  return {
    insert: vi.fn(() => Promise.resolve({ id: "eval-run-1" })),
    updateFinish: vi.fn(() => Promise.resolve({ rowsAffected: 1 })),
    updateFailed: vi.fn(() => Promise.resolve({ rowsAffected: 1 })),
    getById: vi.fn(() => Promise.resolve(null)),
    list: vi.fn(() => Promise.resolve({ runs: [], total: 0 })),
    ...overrides,
  };
}

function makeApp(deps: AdminEvalRouterDeps): Hono {
  const app = new Hono();
  app.use("*", setTestTenant());
  const router = createAdminEvalRouter(deps);
  app.route("/api/admin/eval", router);
  return app;
}

async function readBody(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((acc, c) => acc + c.length, 0);
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.length;
  }
  return new TextDecoder().decode(merged);
}

describe("admin-eval /run persistence (Phase 3)", () => {
  it("Mode A success: inserts running → done with breakdowns", async () => {
    const fixture = makeFixture("fix-A");
    const evalRunsRepo = makeEvalRunsRepo();
    const app = makeApp({
      getSettingsRepo: () => makeSettingsRepo(),
      getEvalRunsRepo: () => evalRunsRepo,
      listFixtures: vi.fn(() => Promise.resolve([fixture])),
      readFixture: vi.fn(() => Promise.resolve(fixture)),
      readGroundTruth: vi.fn(() => Promise.resolve(null)),
      writeGroundTruth: vi.fn(() => Promise.resolve()),
      runEval: vi.fn(() =>
        Promise.resolve({
          rankedItems: [{ rawItemId: 1, score: 1, rationale: "" }],
          score: null,
          cost: {
            tokensIn: 100,
            tokensOut: 50,
            usd: 0.0042,
            cacheHit: false,
            promptHash: "abc",
          },
        }),
      ),
      runModeB: vi.fn(),
    });
    const res = await app.request("/api/admin/eval/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "scored",
        fixtureId: "fix-A",
        draftPrompt: "draft-A",
      }),
    });
    expect(res.status).toBe(200);
    const body = await readBody(res);
    expect(body).toContain("event: done");

    expect(evalRunsRepo.insert).toHaveBeenCalledTimes(1);
    const insertArg = vi.mocked(evalRunsRepo.insert).mock.calls[0][0];
    expect(insertArg).toMatchObject({
      mode: "scored",
      fixtureId: "fix-A",
      date: null,
      windowSize: null,
      savedPromptHash: null,
      savedPromptSnapshot: null,
    });
    expect(insertArg.draftPromptHash).toHaveLength(16);
    expect(insertArg.draftPromptSnapshot).toBe("draft-A");

    expect(evalRunsRepo.updateFinish).toHaveBeenCalledTimes(1);
    const [finishedId, finishPayload] = vi.mocked(evalRunsRepo.updateFinish).mock.calls[0];
    expect(finishedId).toBe("eval-run-1");
    interface ScoreBreakdownA {
      perFixture: { fixtureId: string; status: string }[];
      aggregate: { meanNdcgAt10: number };
    }
    interface CostBreakdownA {
      totalUsd: number;
      perFixture: { fixtureId: string; cost: { usd: number } }[];
    }
    const score = finishPayload.scoreBreakdown as ScoreBreakdownA;
    const cost = finishPayload.costBreakdown as CostBreakdownA;
    expect(score.perFixture).toHaveLength(1);
    expect(score.perFixture[0].fixtureId).toBe("fix-A");
    expect(cost.totalUsd).toBeCloseTo(0.0042);
    expect(cost.perFixture[0].cost.usd).toBeCloseTo(0.0042);

    expect(evalRunsRepo.updateFailed).not.toHaveBeenCalled();
  });

  it("Mode A per-fixture error: run still transitions to done (errors are per-fixture, not run-level)", async () => {
    const fixture = makeFixture("fix-A");
    const evalRunsRepo = makeEvalRunsRepo();
    const app = makeApp({
      getSettingsRepo: () => makeSettingsRepo(),
      getEvalRunsRepo: () => evalRunsRepo,
      listFixtures: vi.fn(() => Promise.resolve([fixture])),
      readFixture: vi.fn(() => Promise.resolve(fixture)),
      readGroundTruth: vi.fn(() => Promise.resolve(null)),
      writeGroundTruth: vi.fn(() => Promise.resolve()),
      runEval: vi.fn(() => {
        throw new Error("stage-2 rerank exploded");
      }),
      runModeB: vi.fn(),
    });
    const res = await app.request("/api/admin/eval/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "scored",
        fixtureId: "fix-A",
        draftPrompt: "draft-A",
      }),
    });
    expect(res.status).toBe(200);
    await readBody(res);

    expect(evalRunsRepo.insert).toHaveBeenCalledTimes(1);
    expect(evalRunsRepo.updateFinish).toHaveBeenCalledTimes(1);
    expect(evalRunsRepo.updateFailed).not.toHaveBeenCalled();
  });

  it("Mode A outer-catch failure: updateFailed is invoked", async () => {
    const fixture = makeFixture("fix-A");
    const evalRunsRepo = makeEvalRunsRepo();
    const app = makeApp({
      getSettingsRepo: () => makeSettingsRepo(),
      getEvalRunsRepo: () => evalRunsRepo,
      listFixtures: vi.fn(() => Promise.resolve([fixture])),
      readFixture: vi.fn(() => Promise.resolve(fixture)),
      readGroundTruth: vi.fn(() => {
        throw new Error("groundtruth-disk-corrupt");
      }),
      writeGroundTruth: vi.fn(() => Promise.resolve()),
      runEval: vi.fn(),
      runModeB: vi.fn(),
    });
    const res = await app.request("/api/admin/eval/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "scored",
        fixtureId: "fix-A",
        draftPrompt: "draft-A",
      }),
    });
    expect(res.status).toBe(200);
    const body = await readBody(res);
    expect(body).toContain("event: error");

    expect(evalRunsRepo.insert).toHaveBeenCalledTimes(1);
    expect(evalRunsRepo.updateFinish).not.toHaveBeenCalled();
    expect(evalRunsRepo.updateFailed).toHaveBeenCalledTimes(1);
    const [failedId, failedPayload] =
      vi.mocked(evalRunsRepo.updateFailed).mock.calls[0];
    expect(failedId).toBe("eval-run-1");
    expect(failedPayload.errorMessage).toBe("groundtruth-disk-corrupt");
  });

  it("Mode B success: row has mode=ab, date set, fixtureId null, calendar run breakdown", async () => {
    const evalRunsRepo = makeEvalRunsRepo();
    const calendarDetail = {
      runId: "run-calendar-1",
      completedAt: "2026-05-10T10:30:00.000Z",
      createdAt: "2026-05-10T10:00:00.000Z",
      startedAt: "2026-05-10T10:05:00.000Z",
      itemCount: 1,
      topN: 10,
      digestHeadline: "Calendar run",
      digestSummary: "One archived item",
      sourceTypes: ["hn"],
      previousRanking: [
        {
          rank: 1,
          rawItemId: 1,
          title: "x",
          url: "https://x/1",
          sourceType: "hn",
          score: 1,
          rationale: "saved",
          summary: "",
          bullets: [],
          bottomLine: "",
        },
      ],
      sourcePool: [
        {
          rawItemId: 1,
          title: "x",
          url: "https://x/1",
          sourceType: "hn",
          publishedAt: null,
          content: null,
          enrichedLink: null,
          enrichmentStatus: "ok",
          comments: [],
          engagement: null,
        },
      ],
    };
    const getCalendarRunDetail = vi.fn(() => Promise.resolve(calendarDetail));
    const runEval = vi.fn(() =>
      Promise.resolve({
        rankedItems: [{ rawItemId: 1, score: 1, rationale: "draft" }],
        score: null,
        cost: {
          tokensIn: 20,
          tokensOut: 10,
          usd: 0.002,
          cacheHit: false,
          promptHash: "d",
        },
      }),
    );
    const app = makeApp({
      getSettingsRepo: () => makeSettingsRepo("the-saved-prompt"),
      getEvalRunsRepo: () => evalRunsRepo,
      getCalendarRunDetail,
      listFixtures: vi.fn(() => Promise.resolve([])),
      readFixture: vi.fn(),
      readGroundTruth: vi.fn(),
      writeGroundTruth: vi.fn(),
      runEval,
    });
    const res = await app.request("/api/admin/eval/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "ab",
        date: "2026-05-10",
        runIds: ["run-calendar-1"],
        draftPrompt: "draft-B",
      }),
    });
    expect(res.status).toBe(200);
    await readBody(res);

    expect(evalRunsRepo.insert).toHaveBeenCalledTimes(1);
    const insertArg = vi.mocked(evalRunsRepo.insert).mock.calls[0][0];
    expect(insertArg).toMatchObject({
      mode: "ab",
      fixtureId: null,
      date: "2026-05-10",
      windowSize: null,
    });
    expect(insertArg.savedPromptSnapshot).toBe("the-saved-prompt");
    expect(insertArg.savedPromptHash).toHaveLength(16);
    expect(getCalendarRunDetail).toHaveBeenCalledWith(
      expect.any(String),
      "run-calendar-1",
    );
    expect(runEval).toHaveBeenCalledOnce();

    expect(evalRunsRepo.updateFinish).toHaveBeenCalledTimes(1);
    const [, finishPayload] = vi.mocked(evalRunsRepo.updateFinish).mock.calls[0];
    interface ScoreBreakdownB {
      calendarRuns: unknown[];
    }
    interface CostBreakdownB {
      totalUsd: number;
      perRun: { runId: string; cost: { usd: number } }[];
    }
    const score = finishPayload.scoreBreakdown as ScoreBreakdownB;
    const cost = finishPayload.costBreakdown as CostBreakdownB;
    expect(score.calendarRuns).toHaveLength(1);
    expect(score.calendarRuns[0]).toMatchObject({
      runId: "run-calendar-1",
      status: "done",
      previousRanking: calendarDetail.previousRanking,
    });
    expect(cost.totalUsd).toBeCloseTo(0.002);
    expect(cost.perRun[0]).toMatchObject({
      runId: "run-calendar-1",
      cost: { usd: 0.002 },
    });
  });

  it("REQ-009: Mode B done entry carries poolSize === sourcePool.length", async () => {
    const evalRunsRepo = makeEvalRunsRepo();
    const makePoolItem = (rawItemId: number) => ({
      rawItemId,
      title: `t${rawItemId}`,
      url: `https://x/${rawItemId}`,
      sourceType: "hn",
      publishedAt: null,
      content: null,
      enrichedLink: null,
      enrichmentStatus: "ok" as const,
      comments: [],
      engagement: null,
    });
    const calendarDetail = {
      runId: "run-pool",
      completedAt: "2026-05-10T10:30:00.000Z",
      createdAt: "2026-05-10T10:00:00.000Z",
      startedAt: "2026-05-10T10:05:00.000Z",
      itemCount: 3,
      topN: 10,
      digestHeadline: "Calendar run",
      digestSummary: "Three items",
      sourceTypes: ["hn"],
      previousRanking: [],
      sourcePool: [makePoolItem(1), makePoolItem(2), makePoolItem(3)],
    };
    const app = makeApp({
      getSettingsRepo: () => makeSettingsRepo("the-saved-prompt"),
      getEvalRunsRepo: () => evalRunsRepo,
      getCalendarRunDetail: vi.fn(() => Promise.resolve(calendarDetail)),
      listFixtures: vi.fn(() => Promise.resolve([])),
      readFixture: vi.fn(),
      readGroundTruth: vi.fn(),
      writeGroundTruth: vi.fn(),
      runEval: vi.fn(() =>
        Promise.resolve({
          rankedItems: [{ rawItemId: 1, score: 1, rationale: "draft" }],
          score: null,
          cost: {
            tokensIn: 20,
            tokensOut: 10,
            usd: 0.002,
            cacheHit: false,
            promptHash: "d",
          },
        }),
      ),
    });
    const res = await app.request("/api/admin/eval/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "ab",
        date: "2026-05-10",
        runIds: ["run-pool"],
        draftPrompt: "draft-B",
      }),
    });
    expect(res.status).toBe(200);
    await readBody(res);

    const [, finishPayload] = vi.mocked(evalRunsRepo.updateFinish).mock.calls[0];
    interface ScoreBreakdownB {
      calendarRuns: { runId: string; status: string; poolSize?: number }[];
    }
    const score = finishPayload.scoreBreakdown as ScoreBreakdownB;
    expect(score.calendarRuns[0].status).toBe("done");
    expect(score.calendarRuns[0].poolSize).toBe(3);
    expect(score.calendarRuns[0].poolSize).toBe(calendarDetail.sourcePool.length);
  });

  it("REQ-008: Mode A per-fixture record carries poolSize === fixture.pool.length", async () => {
    const fixture = makeFixture("fix-pool");
    fixture.pool = [fixture.pool[0], { ...fixture.pool[0], rawItemId: 2 }];
    const evalRunsRepo = makeEvalRunsRepo();
    const app = makeApp({
      getSettingsRepo: () => makeSettingsRepo(),
      getEvalRunsRepo: () => evalRunsRepo,
      listFixtures: vi.fn(() => Promise.resolve([fixture])),
      readFixture: vi.fn(() => Promise.resolve(fixture)),
      readGroundTruth: vi.fn(() => Promise.resolve(null)),
      writeGroundTruth: vi.fn(() => Promise.resolve()),
      runEval: vi.fn(() =>
        Promise.resolve({
          rankedItems: [{ rawItemId: 1, score: 1, rationale: "" }],
          score: null,
          cost: {
            tokensIn: 100,
            tokensOut: 50,
            usd: 0.0042,
            cacheHit: false,
            promptHash: "abc",
          },
        }),
      ),
      runModeB: vi.fn(),
    });
    const res = await app.request("/api/admin/eval/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "scored",
        fixtureId: "fix-pool",
        draftPrompt: "draft-A",
      }),
    });
    expect(res.status).toBe(200);
    const body = await readBody(res);
    expect(body).toContain("event: done");

    const [, finishPayload] = vi.mocked(evalRunsRepo.updateFinish).mock.calls[0];
    interface ScoreBreakdownA {
      perFixture: { fixtureId: string; status: string; poolSize?: number }[];
    }
    const score = finishPayload.scoreBreakdown as ScoreBreakdownA;
    expect(score.perFixture[0].status).toBe("done");
    expect(score.perFixture[0].poolSize).toBe(2);
    expect(score.perFixture[0].poolSize).toBe(fixture.pool.length);
  });

  it("EDGE-003: Mode B empty source pool → error entry with no poolSize, no crash", async () => {
    const evalRunsRepo = makeEvalRunsRepo();
    const emptyDetail = {
      runId: "run-empty",
      completedAt: "2026-05-10T10:30:00.000Z",
      createdAt: "2026-05-10T10:00:00.000Z",
      startedAt: "2026-05-10T10:05:00.000Z",
      itemCount: 0,
      topN: 10,
      digestHeadline: "Empty",
      digestSummary: "",
      sourceTypes: [],
      previousRanking: [],
      sourcePool: [],
    };
    const runEval = vi.fn();
    const app = makeApp({
      getSettingsRepo: () => makeSettingsRepo("the-saved-prompt"),
      getEvalRunsRepo: () => evalRunsRepo,
      getCalendarRunDetail: vi.fn(() => Promise.resolve(emptyDetail)),
      listFixtures: vi.fn(() => Promise.resolve([])),
      readFixture: vi.fn(),
      readGroundTruth: vi.fn(),
      writeGroundTruth: vi.fn(),
      runEval,
    });
    const res = await app.request("/api/admin/eval/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "ab",
        date: "2026-05-10",
        runIds: ["run-empty"],
        draftPrompt: "draft-B",
      }),
    });
    expect(res.status).toBe(200);
    await readBody(res);

    expect(runEval).not.toHaveBeenCalled();
    const [, finishPayload] = vi.mocked(evalRunsRepo.updateFinish).mock.calls[0];
    interface ScoreBreakdownB {
      calendarRuns: {
        runId: string;
        status: string;
        error?: string;
        poolSize?: number;
      }[];
    }
    const score = finishPayload.scoreBreakdown as ScoreBreakdownB;
    expect(score.calendarRuns[0].status).toBe("error");
    expect(score.calendarRuns[0].error).toBe("run source pool empty");
    expect(score.calendarRuns[0].poolSize).toBeUndefined();
  });

  it("EDGE-1.4: insert throws — stream still completes with done", async () => {
    const fixture = makeFixture("fix-A");
    const evalRunsRepo = makeEvalRunsRepo({
      insert: vi.fn(() => Promise.reject(new Error("db-down"))),
    });
    const app = makeApp({
      getSettingsRepo: () => makeSettingsRepo(),
      getEvalRunsRepo: () => evalRunsRepo,
      listFixtures: vi.fn(() => Promise.resolve([fixture])),
      readFixture: vi.fn(() => Promise.resolve(fixture)),
      readGroundTruth: vi.fn(() => Promise.resolve(null)),
      writeGroundTruth: vi.fn(() => Promise.resolve()),
      runEval: vi.fn(() =>
        Promise.resolve({
          rankedItems: [{ rawItemId: 1, score: 1, rationale: "" }],
          score: null,
          cost: {
            tokensIn: 1,
            tokensOut: 1,
            usd: 0,
            cacheHit: false,
            promptHash: "z",
          },
        }),
      ),
      runModeB: vi.fn(),
    });
    const res = await app.request("/api/admin/eval/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "scored",
        fixtureId: "fix-A",
        draftPrompt: "draft-A",
      }),
    });
    expect(res.status).toBe(200);
    const body = await readBody(res);
    expect(body).toContain("event: done");
    expect(evalRunsRepo.updateFinish).not.toHaveBeenCalled();
    expect(evalRunsRepo.updateFailed).not.toHaveBeenCalled();
  });

  it("EDGE-3.2: updateFinish throws — stream still emits done", async () => {
    const fixture = makeFixture("fix-A");
    const evalRunsRepo = makeEvalRunsRepo({
      updateFinish: vi.fn(() => Promise.reject(new Error("db-flaked"))),
    });
    const app = makeApp({
      getSettingsRepo: () => makeSettingsRepo(),
      getEvalRunsRepo: () => evalRunsRepo,
      listFixtures: vi.fn(() => Promise.resolve([fixture])),
      readFixture: vi.fn(() => Promise.resolve(fixture)),
      readGroundTruth: vi.fn(() => Promise.resolve(null)),
      writeGroundTruth: vi.fn(() => Promise.resolve()),
      runEval: vi.fn(() =>
        Promise.resolve({
          rankedItems: [{ rawItemId: 1, score: 1, rationale: "" }],
          score: null,
          cost: {
            tokensIn: 1,
            tokensOut: 1,
            usd: 0,
            cacheHit: false,
            promptHash: "z",
          },
        }),
      ),
      runModeB: vi.fn(),
    });
    const res = await app.request("/api/admin/eval/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "scored",
        fixtureId: "fix-A",
        draftPrompt: "draft-A",
      }),
    });
    expect(res.status).toBe(200);
    const body = await readBody(res);
    expect(body).toContain("event: done");
    expect(evalRunsRepo.updateFinish).toHaveBeenCalledTimes(1);
    expect(evalRunsRepo.updateFailed).not.toHaveBeenCalled();
  });

  it("EDGE-1.3: prompts longer than 65,536 chars are truncated with '…' suffix; hash is computed BEFORE truncation", async () => {
    // Build a prompt that exceeds the snapshot cap. Use a deterministic
    // pattern so we can assert that the hash matches the *full* prompt's
    // hash, not the truncated version's.
    const bigPrompt = "x".repeat(70_000);
    const { hashPrompt } = await import("@newsletter/shared/utils/prompt-hash");
    const expectedHash = hashPrompt(bigPrompt);

    const fixture = makeFixture("fix-edge-13");
    const evalRunsRepo = makeEvalRunsRepo();
    const app = makeApp({
      getSettingsRepo: () => makeSettingsRepo(),
      getEvalRunsRepo: () => evalRunsRepo,
      listFixtures: vi.fn(() => Promise.resolve([fixture])),
      readFixture: vi.fn(() => Promise.resolve(fixture)),
      readGroundTruth: vi.fn(() => Promise.resolve(null)),
      writeGroundTruth: vi.fn(() => Promise.resolve()),
      runEval: vi.fn(() =>
        Promise.resolve({
          rankedItems: [],
          score: null,
          cost: { tokensIn: 0, tokensOut: 0, usd: 0, cacheHit: false, promptHash: "abc" },
        }),
      ),
      runModeB: vi.fn(),
    });

    const res = await app.request("/api/admin/eval/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "scored",
        fixtureId: "fix-edge-13",
        draftPrompt: bigPrompt,
      }),
    });
    expect(res.status).toBe(200);
    await readBody(res); // drain

    expect(evalRunsRepo.insert).toHaveBeenCalledTimes(1);
    const insertArg = vi.mocked(evalRunsRepo.insert).mock.calls[0][0];

    // Hash matches the FULL prompt (computed before truncation).
    expect(insertArg.draftPromptHash).toBe(expectedHash);

    // Snapshot is exactly 65,536 chars (the cap, including the suffix).
    expect(insertArg.draftPromptSnapshot.length).toBe(65_536);
    // Ends with the truncation marker.
    expect(insertArg.draftPromptSnapshot.endsWith("…")).toBe(true);
    // The prefix is the start of the original prompt.
    expect(insertArg.draftPromptSnapshot.startsWith("xxxxxxxxxx")).toBe(true);
  });
});

describe("admin-eval GET /runs and /runs/:id (Phase 4)", () => {
  function makeSummary(overrides: Partial<EvalRunSummary> = {}): EvalRunSummary {
    return {
      id: "00000000-0000-0000-0000-000000000001",
      mode: "scored",
      fixtureId: "fix-A",
      date: null,
      windowSize: null,
      draftPromptHash: "h".repeat(16),
      savedPromptHash: null,
      status: "done",
      startedAt: "2026-05-10T00:00:00.000Z",
      finishedAt: "2026-05-10T00:00:05.000Z",
      scoreBreakdown: null,
      costBreakdown: null,
      errorMessage: null,
      ...overrides,
    };
  }
  function makeRun(overrides: Partial<EvalRun> = {}): EvalRun {
    return {
      ...makeSummary(),
      draftPromptSnapshot: "draft body",
      savedPromptSnapshot: null,
      ...overrides,
    };
  }

  it("GET /runs with no filters returns all rows, defaults page=1 perPage=20", async () => {
    const summaries = [makeSummary({ id: "00000000-0000-0000-0000-000000000001" })];
    const evalRunsRepo = makeEvalRunsRepo({
      list: vi.fn(() => Promise.resolve({ runs: summaries, total: 1 })),
    });
    const app = makeApp({
      getSettingsRepo: () => makeSettingsRepo(),
      getEvalRunsRepo: () => evalRunsRepo,
    });
    const res = await app.request("/api/admin/eval/runs");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      runs: EvalRunSummary[];
      total: number;
      page: number;
      perPage: number;
    };
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    expect(body.perPage).toBe(20);
    expect(body.runs).toHaveLength(1);
    const listArg = vi.mocked(evalRunsRepo.list).mock.calls[0][0];
    expect(listArg).toEqual({
      page: 1,
      perPage: 20,
      mode: undefined,
      status: undefined,
      fixtureId: undefined,
    });
  });

  it("GET /runs?page=2&perPage=5 forwards pagination", async () => {
    const evalRunsRepo = makeEvalRunsRepo({
      list: vi.fn(() => Promise.resolve({ runs: [], total: 12 })),
    });
    const app = makeApp({
      getSettingsRepo: () => makeSettingsRepo(),
      getEvalRunsRepo: () => evalRunsRepo,
    });
    const res = await app.request("/api/admin/eval/runs?page=2&perPage=5");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { page: number; perPage: number };
    expect(body.page).toBe(2);
    expect(body.perPage).toBe(5);
    const listArg = vi.mocked(evalRunsRepo.list).mock.calls[0][0];
    expect(listArg.page).toBe(2);
    expect(listArg.perPage).toBe(5);
  });

  it("GET /runs?mode=scored forwards the mode filter", async () => {
    const evalRunsRepo = makeEvalRunsRepo({
      list: vi.fn(() => Promise.resolve({ runs: [], total: 0 })),
    });
    const app = makeApp({
      getSettingsRepo: () => makeSettingsRepo(),
      getEvalRunsRepo: () => evalRunsRepo,
    });
    const res = await app.request("/api/admin/eval/runs?mode=scored");
    expect(res.status).toBe(200);
    const listArg = vi.mocked(evalRunsRepo.list).mock.calls[0][0];
    expect(listArg.mode).toBe("scored");
  });

  it("GET /runs?status=done&mode=scored AND-composes filters", async () => {
    const evalRunsRepo = makeEvalRunsRepo({
      list: vi.fn(() => Promise.resolve({ runs: [], total: 0 })),
    });
    const app = makeApp({
      getSettingsRepo: () => makeSettingsRepo(),
      getEvalRunsRepo: () => evalRunsRepo,
    });
    const res = await app.request(
      "/api/admin/eval/runs?status=done&mode=scored",
    );
    expect(res.status).toBe(200);
    const listArg = vi.mocked(evalRunsRepo.list).mock.calls[0][0];
    expect(listArg.mode).toBe("scored");
    expect(listArg.status).toBe("done");
  });

  it("GET /runs?perPage=200 clamps to 100", async () => {
    const evalRunsRepo = makeEvalRunsRepo({
      list: vi.fn(() => Promise.resolve({ runs: [], total: 0 })),
    });
    const app = makeApp({
      getSettingsRepo: () => makeSettingsRepo(),
      getEvalRunsRepo: () => evalRunsRepo,
    });
    const res = await app.request("/api/admin/eval/runs?perPage=200");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { perPage: number };
    expect(body.perPage).toBe(100);
    expect(vi.mocked(evalRunsRepo.list).mock.calls[0][0].perPage).toBe(100);
  });

  it("GET /runs?page=0 clamps to 1", async () => {
    const evalRunsRepo = makeEvalRunsRepo({
      list: vi.fn(() => Promise.resolve({ runs: [], total: 0 })),
    });
    const app = makeApp({
      getSettingsRepo: () => makeSettingsRepo(),
      getEvalRunsRepo: () => evalRunsRepo,
    });
    const res = await app.request("/api/admin/eval/runs?page=0");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { page: number };
    expect(body.page).toBe(1);
    expect(vi.mocked(evalRunsRepo.list).mock.calls[0][0].page).toBe(1);
  });

  it("GET /runs?page=abc returns 400", async () => {
    const evalRunsRepo = makeEvalRunsRepo();
    const app = makeApp({
      getSettingsRepo: () => makeSettingsRepo(),
      getEvalRunsRepo: () => evalRunsRepo,
    });
    const res = await app.request("/api/admin/eval/runs?page=abc");
    expect(res.status).toBe(400);
    expect(evalRunsRepo.list).not.toHaveBeenCalled();
  });

  it("GET /runs/:id returns the full run on valid uuid", async () => {
    const id = "a1b2c3d4-1234-4abc-8def-0123456789ab";
    const run = makeRun({ id, draftPromptSnapshot: "the-draft" });
    const evalRunsRepo = makeEvalRunsRepo({
      getById: vi.fn(() => Promise.resolve(run)),
    });
    const app = makeApp({
      getSettingsRepo: () => makeSettingsRepo(),
      getEvalRunsRepo: () => evalRunsRepo,
    });
    const res = await app.request(`/api/admin/eval/runs/${id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { run: EvalRun };
    expect(body.run.id).toBe(id);
    expect(body.run.draftPromptSnapshot).toBe("the-draft");
    expect(vi.mocked(evalRunsRepo.getById).mock.calls[0][0]).toBe(id);
  });

  it("GET /runs/:id returns 404 when run not found", async () => {
    const id = "b2c3d4e5-2345-4bcd-9ef0-1234567890ab";
    const evalRunsRepo = makeEvalRunsRepo({
      getById: vi.fn(() => Promise.resolve(null)),
    });
    const app = makeApp({
      getSettingsRepo: () => makeSettingsRepo(),
      getEvalRunsRepo: () => evalRunsRepo,
    });
    const res = await app.request(`/api/admin/eval/runs/${id}`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not found");
  });

  it("GET /runs/:id returns 400 for non-uuid id", async () => {
    const evalRunsRepo = makeEvalRunsRepo();
    const app = makeApp({
      getSettingsRepo: () => makeSettingsRepo(),
      getEvalRunsRepo: () => evalRunsRepo,
    });
    const res = await app.request("/api/admin/eval/runs/not-a-uuid");
    expect(res.status).toBe(400);
    expect(evalRunsRepo.getById).not.toHaveBeenCalled();
  });
});
