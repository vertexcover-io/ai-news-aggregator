import { describe, it, expect, vi } from "vitest";
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

  it("Mode B success: row has mode=ab, date set, fixtureId null, saved+draft breakdown", async () => {
    const evalRunsRepo = makeEvalRunsRepo();
    const app = makeApp({
      getSettingsRepo: () => makeSettingsRepo("the-saved-prompt"),
      getEvalRunsRepo: () => evalRunsRepo,
      findRawItemsByDate: vi.fn(() =>
        Promise.resolve([
          {
            rawItemId: 1,
            title: "x",
            url: "https://x/1",
            sourceType: "hn",
            publishedAt: null,
            content: null,
          },
        ]),
      ),
      runModeB: vi.fn(() =>
        Promise.resolve({
          saved: [{ rawItemId: 1, score: 1, rationale: "" }],
          draft: [{ rawItemId: 1, score: 1, rationale: "" }],
          cost: {
            saved: {
              tokensIn: 10,
              tokensOut: 5,
              usd: 0.001,
              cacheHit: false,
              promptHash: "s",
            },
            draft: {
              tokensIn: 20,
              tokensOut: 10,
              usd: 0.002,
              cacheHit: false,
              promptHash: "d",
            },
            totalUsd: 0.003,
          },
        }),
      ),
      listFixtures: vi.fn(() => Promise.resolve([])),
      readFixture: vi.fn(),
      readGroundTruth: vi.fn(),
      writeGroundTruth: vi.fn(),
      runEval: vi.fn(),
    });
    const res = await app.request("/api/admin/eval/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "ab",
        date: "2026-05-10",
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

    expect(evalRunsRepo.updateFinish).toHaveBeenCalledTimes(1);
    const [, finishPayload] = vi.mocked(evalRunsRepo.updateFinish).mock.calls[0];
    interface ScoreBreakdownB {
      saved: unknown[];
      draft: unknown[];
    }
    interface CostBreakdownB {
      totalUsd: number;
      saved: { usd: number };
      draft: { usd: number };
    }
    const score = finishPayload.scoreBreakdown as ScoreBreakdownB;
    const cost = finishPayload.costBreakdown as CostBreakdownB;
    expect(score.saved).toHaveLength(1);
    expect(score.draft).toHaveLength(1);
    expect(cost.totalUsd).toBeCloseTo(0.003);
    expect(cost.saved.usd).toBeCloseTo(0.001);
    expect(cost.draft.usd).toBeCloseTo(0.002);
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
