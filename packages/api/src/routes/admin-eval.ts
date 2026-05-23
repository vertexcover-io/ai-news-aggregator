import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import {
  createLogger,
  getDb as defaultGetDb,
  safeTimezone,
} from "@newsletter/shared";
import { GroundTruthSchema } from "@newsletter/shared/types/eval-ranking-schemas";
import { EvalRunRequestSchema } from "@newsletter/shared/types/eval-ranking-schemas";
import {
  FIXTURES_DIR,
  GROUNDTRUTH_DIR,
} from "@newsletter/shared/constants/eval-ranking";
import type {
  ActualRankingItem,
  CalendarRankingItem,
  CalendarRunDetail,
  CalendarRunReportEntry,
  CalendarRunSummary,
  ExpectedRankingItem,
  Fixture,
  FixtureItem,
  GradingStatus,
  GroundTruth,
  Tier,
} from "@newsletter/shared/types/eval-ranking";
import {
  createEvalExportsRepo,
  createManualFixture as defaultCreateManualFixture,
  listFixtures as defaultListFixtures,
  readFixture as defaultReadFixture,
  readGroundTruth as defaultReadGroundTruth,
  runEval as defaultRunEval,
  sourcingReport,
  writeGroundTruth as defaultWriteGroundTruth,
  EvalCache,
  type CreateManualFixtureResult,
  type RunEvalArgs,
  type RunEvalOutput,
} from "@newsletter/pipeline/eval";
import {
  createUserSettingsRepo,
  type UserSettingsRepo,
} from "@api/repositories/user-settings.js";
import {
  createEvalRunsRepo,
  type EvalRunsRepo,
} from "@api/repositories/eval-runs.js";
import { hashPrompt } from "@newsletter/shared/utils/prompt-hash";

const PROMPT_SNAPSHOT_MAX_LEN = 65536;
const TRUNCATION_SUFFIX = "…";

function truncateSnapshot(prompt: string): string {
  if (prompt.length <= PROMPT_SNAPSHOT_MAX_LEN) return prompt;
  return prompt.slice(0, PROMPT_SNAPSHOT_MAX_LEN - TRUNCATION_SUFFIX.length) +
    TRUNCATION_SUFFIX;
}

const TIER_ORDER: Record<Tier, number> = { must: 0, nice: 1, drop: 2 };

/**
 * Join the ranker's per-item output with fixture-pool metadata to produce the
 * comparison-report payload. Pure derivation — no I/O. Exported for tests.
 */
export function buildActualRanking(
  rankedItems: RunEvalOutput["rankedItems"],
  fixture: Fixture,
): ActualRankingItem[] {
  const itemById = new Map(fixture.pool.map((p) => [p.rawItemId, p]));
  return rankedItems.map((r) => {
    const pool = itemById.get(r.rawItemId);
    return {
      rawItemId: r.rawItemId,
      url: pool?.url ?? "",
      title: r.title ?? pool?.title ?? "",
      score: r.score,
      rationale: r.rationale,
      summary: r.summary ?? "",
      bullets: r.bullets ?? [],
      bottomLine: r.bottomLine ?? "",
    };
  });
}

/**
 * Snapshot the fixture's graded ground truth at run time so later regrades do
 * not retroactively shift a historical report. Items in the fixture pool that
 * have no GT label are excluded — they were not graded, so they do not belong
 * in the expected order. Drop-tier items still appear, sorted last, so the
 * operator can see "the ranker correctly excluded these".
 */
export function buildExpectedRanking(
  groundTruth: GroundTruth,
  fixture: Fixture,
): ExpectedRankingItem[] {
  const labelById = new Map(
    groundTruth.labels.map((l) => [l.rawItemId, l.tier]),
  );
  const labelled = fixture.pool
    .map((pool) => {
      const tier = labelById.get(pool.rawItemId);
      return tier === undefined ? null : { pool, tier };
    })
    .filter((entry): entry is { pool: Fixture["pool"][number]; tier: Tier } =>
      entry !== null,
    )
    .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]);
  return labelled.map((entry, idx) => ({
    rawItemId: entry.pool.rawItemId,
    url: entry.pool.url,
    title: entry.pool.title,
    tier: entry.tier,
    rank: idx + 1,
  }));
}

function buildCalendarRanking(
  rankedItems: readonly {
    rawItemId: number;
    score: number;
    rationale: string;
    title?: string;
    summary?: string;
    bullets?: string[];
    bottomLine?: string;
  }[],
  sourcePool: readonly FixtureItem[],
): CalendarRankingItem[] {
  const sourceById = new Map(sourcePool.map((item) => [item.rawItemId, item]));
  return rankedItems.map((item, index) => {
    const source = sourceById.get(item.rawItemId);
    return {
      rank: index + 1,
      rawItemId: item.rawItemId,
      title: item.title ?? source?.title ?? `#${String(item.rawItemId)}`,
      url: source?.url ?? "",
      sourceType: source?.sourceType ?? "",
      score: item.score,
      rationale: item.rationale,
      summary: item.summary ?? "",
      bullets: item.bullets ?? [],
      bottomLine: item.bottomLine ?? "",
    };
  });
}

function buildCalendarRunFixture(
  detail: CalendarRunDetail,
  date: string,
  model: string,
): Fixture {
  return {
    fixtureId: `calendar-${detail.runId}`,
    source: "calendar",
    date,
    runId: detail.runId,
    model,
    exportedAt: new Date().toISOString(),
    pool: detail.sourcePool,
    dedupClusters: [],
    originalRankerOutput: detail.previousRanking.map((item) => ({
      rawItemId: item.rawItemId,
      score: item.score,
      rationale: item.rationale,
    })),
  };
}

const listRunsQuerySchema = z.object({
  page: z.coerce
    .number()
    .int()
    .default(1)
    .transform((n) => (n < 1 ? 1 : n)),
  perPage: z.coerce
    .number()
    .int()
    .default(20)
    .transform((n) => {
      if (n < 1) return 1;
      if (n > 100) return 100;
      return n;
    }),
  mode: z.enum(["scored", "ab"]).optional(),
  status: z.enum(["running", "done", "failed"]).optional(),
  fixtureId: z.string().min(1).optional(),
});

const runIdParamSchema = z.uuid();

const manualFixtureRequestSchema = z.object({
  urls: z.array(z.url()).min(1).max(50),
  name: z.string().max(80).optional(),
});

const savePromptSchema = z.object({
  prompt: z.string().min(1).max(20000),
});

const calendarRunsQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const DEFAULT_RANKING_MODEL = "claude-haiku-4-5-20251001";

export interface FixtureSummary {
  fixtureId: string;
  source: Fixture["source"];
  date: string | null;
  model: string;
  exportedAt: string;
  itemCount: number;
  gradingStatus: GradingStatus;
}

export type RunEvalFn = typeof defaultRunEval;
export type ListFixturesFn = typeof defaultListFixtures;
export type ReadFixtureFn = typeof defaultReadFixture;
export type ReadGroundTruthFn = typeof defaultReadGroundTruth;
export type WriteGroundTruthFn = typeof defaultWriteGroundTruth;
export type CreateManualFixtureFn = (
  urls: string[],
  opts?: { name?: string; model?: string },
) => Promise<CreateManualFixtureResult>;
export type ListCalendarRunsByDateFn = (
  dateISO: string,
  timezone: string,
) => Promise<CalendarRunSummary[]>;
export type GetCalendarRunDetailFn = (
  runId: string,
) => Promise<CalendarRunDetail | null>;

export interface AdminEvalRouterDeps {
  getSettingsRepo: () => UserSettingsRepo;
  getEvalRunsRepo?: () => EvalRunsRepo;
  listFixtures?: ListFixturesFn;
  readFixture?: ReadFixtureFn;
  readGroundTruth?: ReadGroundTruthFn;
  writeGroundTruth?: WriteGroundTruthFn;
  createManualFixture?: CreateManualFixtureFn;
  runEval?: RunEvalFn;
  listCalendarRunsByDate?: ListCalendarRunsByDateFn;
  getCalendarRunDetail?: GetCalendarRunDetailFn;
  fixturesDir?: string;
  groundtruthDir?: string;
  repoGroundtruthDir?: string;
  cacheDir?: string;
  env?: NodeJS.ProcessEnv;
  logger?: ReturnType<typeof createLogger>;
}

export function createAdminEvalRouter(deps: AdminEvalRouterDeps): Hono {
  const logger = deps.logger ?? createLogger("api:admin-eval");
  const listFixturesFn = deps.listFixtures ?? defaultListFixtures;
  const readFixtureFn = deps.readFixture ?? defaultReadFixture;
  const readGroundTruthFn = deps.readGroundTruth ?? defaultReadGroundTruth;
  const writeGroundTruthFn = deps.writeGroundTruth ?? defaultWriteGroundTruth;
  const createManualFixtureFn =
    deps.createManualFixture ??
    ((urls: string[], opts?: { name?: string; model?: string }) =>
      defaultCreateManualFixture(urls, opts));
  const runEvalFn = deps.runEval ?? defaultRunEval;
  const listCalendarRunsByDateFn = deps.listCalendarRunsByDate;
  const getCalendarRunDetailFn = deps.getCalendarRunDetail;
  const fixturesDir = deps.fixturesDir ?? FIXTURES_DIR;
  const groundtruthDir = deps.groundtruthDir ?? GROUNDTRUTH_DIR;
  const repoGroundtruthDir = deps.repoGroundtruthDir ?? GROUNDTRUTH_DIR;
  const cacheDir = deps.cacheDir ?? "evals/ranking/cache";
  const env = deps.env ?? process.env;

  const app = new Hono();

  app.get("/fixtures", async (c) => {
    const fixtures = await listFixturesFn(fixturesDir);
    const summaries: FixtureSummary[] = await Promise.all(
      fixtures.map(async (f) => {
        const gt = await readGroundTruthFn(f.fixtureId, groundtruthDir);
        return {
          fixtureId: f.fixtureId,
          source: f.source,
          date: f.date,
          model: f.model,
          exportedAt: f.exportedAt,
          itemCount: f.pool.length,
          gradingStatus: gt === null ? "ungraded" : "graded",
        };
      }),
    );
    return c.json({ fixtures: summaries });
  });

  app.get("/fixtures/:id", async (c) => {
    const id = c.req.param("id");
    try {
      const fixture = await readFixtureFn(id, fixturesDir);
      const gt = await readGroundTruthFn(id, groundtruthDir);
      return c.json({ fixture, groundTruth: gt });
    } catch (err) {
      logger.warn({ err, fixtureId: id }, "admin-eval.fixture.read_failed");
      return c.json({ error: "fixture_not_found" }, 404);
    }
  });

  app.get("/calendar-runs", async (c) => {
    if (listCalendarRunsByDateFn === undefined) {
      return c.json({ error: "calendar_runs_repo_unavailable" }, 500);
    }
    const parsed = calendarRunsQuerySchema.safeParse(
      Object.fromEntries(new URL(c.req.url).searchParams),
    );
    if (!parsed.success) {
      return c.json(
        { error: "invalid_query", issues: parsed.error.issues },
        400,
      );
    }
    const settings = await deps.getSettingsRepo().get();
    const timezone = safeTimezone(settings?.scheduleTimezone);
    const runs = await listCalendarRunsByDateFn(parsed.data.date, timezone);
    return c.json({ date: parsed.data.date, runs });
  });

  app.get("/calendar-runs/:runId", async (c) => {
    if (getCalendarRunDetailFn === undefined) {
      return c.json({ error: "calendar_runs_repo_unavailable" }, 500);
    }
    const runId = c.req.param("runId");
    const detail = await getCalendarRunDetailFn(runId);
    if (detail === null) {
      return c.json({ error: "run_not_found" }, 404);
    }
    return c.json({ run: detail });
  });

  app.get("/runs", async (c) => {
    const evalRunsRepo = deps.getEvalRunsRepo?.();
    if (evalRunsRepo === undefined) {
      return c.json({ error: "eval_runs_repo_unavailable" }, 500);
    }
    const parsed = listRunsQuerySchema.safeParse(
      Object.fromEntries(new URL(c.req.url).searchParams),
    );
    if (!parsed.success) {
      return c.json(
        { error: "invalid_query", issues: parsed.error.issues },
        400,
      );
    }
    const { page, perPage, mode, status, fixtureId } = parsed.data;
    const result = await evalRunsRepo.list({
      page,
      perPage,
      mode,
      status,
      fixtureId,
    });
    return c.json({
      runs: result.runs,
      total: result.total,
      page,
      perPage,
    });
  });

  app.get("/runs/:id", async (c) => {
    const evalRunsRepo = deps.getEvalRunsRepo?.();
    if (evalRunsRepo === undefined) {
      return c.json({ error: "eval_runs_repo_unavailable" }, 500);
    }
    const parsed = runIdParamSchema.safeParse(c.req.param("id"));
    if (!parsed.success) {
      return c.json({ error: "invalid_id" }, 400);
    }
    const run = await evalRunsRepo.getById(parsed.data);
    if (run === null) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json({ run });
  });

  app.post("/fixtures", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const parsed = manualFixtureRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "invalid_body", issues: parsed.error.issues },
        422,
      );
    }
    try {
      const result = await createManualFixtureFn(parsed.data.urls, {
        name: parsed.data.name,
      });
      return c.json({
        fixtureId: result.fixture.fixtureId,
        itemCount: result.fixture.pool.length,
        enrichment: result.enrichment,
      });
    } catch (err) {
      logger.error({ err }, "admin-eval.fixture.create_failed");
      return c.json({ error: "create_failed" }, 500);
    }
  });

  app.post("/groundtruth/:fixtureId", async (c) => {
    const fixtureId = c.req.param("fixtureId");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const parsed = GroundTruthSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "invalid_body", issues: parsed.error.issues },
        422,
      );
    }
    if (parsed.data.fixtureId !== fixtureId) {
      return c.json({ error: "fixtureId_mismatch" }, 422);
    }
    await writeGroundTruthFn(parsed.data as GroundTruth, groundtruthDir);
    const saved = await readGroundTruthFn(fixtureId, groundtruthDir);
    return c.json({ groundTruth: saved });
  });

  app.post("/groundtruth/:fixtureId/save-to-repo", async (c) => {
    const fixtureId = c.req.param("fixtureId");
    const gateOpen =
      env.NODE_ENV !== "production" && env.EVAL_WRITE_TO_REPO === "true";
    if (!gateOpen) {
      return c.json(
        {
          error: "save-to-repo disabled",
          hint:
            "set NODE_ENV != production and EVAL_WRITE_TO_REPO=true to enable",
        },
        403,
      );
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const parsed = GroundTruthSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "invalid_body", issues: parsed.error.issues },
        422,
      );
    }
    if (parsed.data.fixtureId !== fixtureId) {
      return c.json({ error: "fixtureId_mismatch" }, 422);
    }
    await writeGroundTruthFn(parsed.data as GroundTruth, repoGroundtruthDir);
    return c.json({ ok: true });
  });

  app.post("/save-prompt", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const parsed = savePromptSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "invalid_body", issues: parsed.error.issues },
        422,
      );
    }
    const repo = deps.getSettingsRepo();
    const current = await repo.get();
    if (current === null) {
      return c.json({ error: "settings_not_initialised" }, 409);
    }
    const saved = await repo.upsert({
      ...current,
      rankingPrompt: parsed.data.prompt,
    });
    return c.json({ rankingPrompt: saved.rankingPrompt });
  });

  app.post("/run", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const parsed = EvalRunRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "invalid_body", issues: parsed.error.issues },
        422,
      );
    }
    const req = parsed.data;
    const cache = new EvalCache(cacheDir, { bypassCache: req.bypassCache });
    const model = DEFAULT_RANKING_MODEL;

    const draftPromptHash = hashPrompt(req.draftPrompt);
    const draftPromptSnapshot = truncateSnapshot(req.draftPrompt);
    let savedPromptHash: string | null = null;
    let savedPromptSnapshot: string | null = null;
    if (req.mode === "ab") {
      const settingsRepo = deps.getSettingsRepo();
      const settings = await settingsRepo.get();
      const sp = req.savedPrompt ?? settings?.rankingPrompt ?? "";
      if (sp.length > 0) {
        savedPromptHash = hashPrompt(sp);
        savedPromptSnapshot = truncateSnapshot(sp);
      }
    }

    const evalRunsRepo = deps.getEvalRunsRepo?.();
    let runId: string | null = null;
    if (evalRunsRepo !== undefined) {
      try {
        const inserted = await evalRunsRepo.insert({
          mode: req.mode,
          fixtureId: req.mode === "scored" ? (req.fixtureId ?? null) : null,
          date: req.mode === "ab" ? (req.date ?? null) : null,
          windowSize: null,
          draftPromptHash,
          draftPromptSnapshot,
          savedPromptHash,
          savedPromptSnapshot,
        });
        runId = inserted.id;
      } catch (err) {
        logger.error({ err }, "admin-eval.run.insert_failed");
      }
    }

    const persistFinish = async (
      scoreBreakdown: unknown,
      costBreakdown: unknown,
    ): Promise<void> => {
      if (runId === null || evalRunsRepo === undefined) return;
      try {
        await evalRunsRepo.updateFinish(runId, {
          scoreBreakdown,
          costBreakdown,
        });
      } catch (err) {
        logger.error({ err, runId }, "admin-eval.run.update_finish_failed");
      }
    };

    const persistFailed = async (errorMessage: string): Promise<void> => {
      if (runId === null || evalRunsRepo === undefined) return;
      try {
        await evalRunsRepo.updateFailed(runId, { errorMessage });
      } catch (err) {
        logger.error({ err, runId }, "admin-eval.run.update_failed_failed");
      }
    };

    return streamSSE(c, async (stream) => {
      let totalUsd = 0;
      try {
        if (req.mode === "scored") {
          interface Target {
            fixture: Fixture;
            groundTruth: GroundTruth | null;
          }
          const targets: Target[] = [];
          if (!req.fixtureId) {
            await stream.writeSSE({
              event: "error",
              data: JSON.stringify({
                message: "fixtureId required for scored mode",
              }),
            });
            return;
          }
          let fixture: Fixture;
          try {
            fixture = await readFixtureFn(req.fixtureId, fixturesDir);
          } catch {
            await stream.writeSSE({
              event: "error",
              data: JSON.stringify({ message: "fixture_not_found" }),
            });
            return;
          }
          const gt = await readGroundTruthFn(req.fixtureId, groundtruthDir);
          targets.push({ fixture, groundTruth: gt });

          const ndcgScores: number[] = [];
          const gradedForReport: { fixture: Fixture; groundTruth: GroundTruth }[] = [];
          interface PerFixtureRecord {
            fixtureId: string;
            status: "done" | "error";
            score: RunEvalOutput["score"] | null;
            cost: RunEvalOutput["cost"] | null;
            error: string | null;
            actualRanking?: ActualRankingItem[];
            expectedRanking?: ExpectedRankingItem[];
          }
          const perFixtureRecords: PerFixtureRecord[] = [];
          const perFixtureCosts: { fixtureId: string; cost: RunEvalOutput["cost"] }[] = [];
          for (const t of targets) {
            await stream.writeSSE({
              event: "progress",
              data: JSON.stringify({
                fixtureId: t.fixture.fixtureId,
                status: "running",
              }),
            });
            try {
              const args: RunEvalArgs = {
                fixture: t.fixture,
                groundTruth: t.groundTruth,
                prompt: req.draftPrompt,
                model,
                cache,
              };
              const result: RunEvalOutput = await runEvalFn(args);
              totalUsd += result.cost.usd;
              if (result.score !== null) {
                ndcgScores.push(result.score.ndcgAt10);
              }
              const actualRanking = buildActualRanking(
                result.rankedItems,
                t.fixture,
              );
              const expectedRanking =
                t.groundTruth !== null
                  ? buildExpectedRanking(t.groundTruth, t.fixture)
                  : undefined;
              perFixtureRecords.push({
                fixtureId: t.fixture.fixtureId,
                status: "done",
                score: result.score,
                cost: result.cost,
                error: null,
                actualRanking,
                expectedRanking,
              });
              perFixtureCosts.push({
                fixtureId: t.fixture.fixtureId,
                cost: result.cost,
              });
              await stream.writeSSE({
                event: "progress",
                data: JSON.stringify({
                  fixtureId: t.fixture.fixtureId,
                  status: "done",
                  score: result.score,
                  cost: result.cost,
                  actualRanking,
                  expectedRanking,
                }),
              });
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              perFixtureRecords.push({
                fixtureId: t.fixture.fixtureId,
                status: "error",
                score: null,
                cost: null,
                error: errMsg,
              });
              await stream.writeSSE({
                event: "progress",
                data: JSON.stringify({
                  fixtureId: t.fixture.fixtureId,
                  status: "error",
                  error: errMsg,
                }),
              });
            }
            if (t.groundTruth !== null) {
              gradedForReport.push({
                fixture: t.fixture,
                groundTruth: t.groundTruth,
              });
            }
          }
          const report = sourcingReport(gradedForReport);
          const meanNdcgAt10 =
            ndcgScores.length === 0
              ? 0
              : ndcgScores.reduce((a, b) => a + b, 0) / ndcgScores.length;
          await stream.writeSSE({
            event: "aggregate",
            data: JSON.stringify({
              meanNdcgAt10,
              totalCost: { usd: totalUsd },
              sourcingReport: report,
            }),
          });
          await persistFinish(
            {
              perFixture: perFixtureRecords,
              aggregate: { meanNdcgAt10 },
            },
            {
              totalUsd,
              perFixture: perFixtureCosts,
            },
          );
          await stream.writeSSE({
            event: "done",
            data: JSON.stringify({ totalCost: { usd: totalUsd } }),
          });
          return;
        }
        // mode === "ab" — Mode B calendar run comparison.
        if (!req.date || !/^\d{4}-\d{2}-\d{2}$/.test(req.date)) {
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({ message: "date required (YYYY-MM-DD)" }),
          });
          return;
        }
        if (req.runIds === undefined || req.runIds.length === 0) {
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({ message: "runIds required" }),
          });
          return;
        }
        if (getCalendarRunDetailFn === undefined) {
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({
              message: "calendar run loader not configured",
            }),
          });
          return;
        }
        const calendarRuns: CalendarRunReportEntry[] = [];
        const perRunCosts: {
          runId: string;
          cost: RunEvalOutput["cost"];
        }[] = [];
        for (const selectedRunId of req.runIds) {
          await stream.writeSSE({
            event: "progress",
            data: JSON.stringify({ runId: selectedRunId, status: "running" }),
          });
          try {
            const detail = await getCalendarRunDetailFn(selectedRunId);
            if (detail === null) {
              throw new Error("run not found");
            }
            if (detail.sourcePool.length === 0) {
              throw new Error("run source pool empty");
            }
            const fixture = buildCalendarRunFixture(detail, req.date, model);
            const result = await runEvalFn({
              fixture,
              groundTruth: null,
              prompt: req.draftPrompt,
              model,
              cache,
            });
            totalUsd += result.cost.usd;
            const entry: CalendarRunReportEntry = {
              runId: selectedRunId,
              status: "done",
              previousRanking: detail.previousRanking,
              draftRanking: buildCalendarRanking(
                result.rankedItems,
                detail.sourcePool,
              ),
              promptDiff: {
                savedPromptHash,
                draftPromptHash,
                savedPromptSnapshot,
                draftPromptSnapshot,
              },
              cost: result.cost,
            };
            calendarRuns.push(entry);
            perRunCosts.push({ runId: selectedRunId, cost: result.cost });
            await stream.writeSSE({
              event: "progress",
              data: JSON.stringify(entry),
            });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            const entry: CalendarRunReportEntry = {
              runId: selectedRunId,
              status: "error",
              error: errMsg,
            };
            calendarRuns.push(entry);
            await stream.writeSSE({
              event: "progress",
              data: JSON.stringify(entry),
            });
          }
        }
        await stream.writeSSE({
          event: "aggregate",
          data: JSON.stringify({
            calendarRuns,
            totalCost: { usd: totalUsd },
          }),
        });
        await persistFinish(
          { calendarRuns },
          {
            totalUsd,
            perRun: perRunCosts,
          },
        );
        await stream.writeSSE({
          event: "done",
          data: JSON.stringify({ totalCost: { usd: totalUsd } }),
        });
      } catch (err) {
        logger.error({ err }, "admin-eval.run.failed");
        const errMsg = err instanceof Error ? err.message : String(err);
        await persistFailed(errMsg);
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({ message: errMsg }),
        });
      }
    });
  });

  return app;
}

export function createDefaultAdminEvalRouter(): Hono {
  return createAdminEvalRouter({
    getSettingsRepo: () => createUserSettingsRepo(defaultGetDb()),
    getEvalRunsRepo: () => createEvalRunsRepo(defaultGetDb()),
    listCalendarRunsByDate: async (dateISO, timezone) => {
      const repo = createEvalExportsRepo(defaultGetDb());
      return repo.listCompletedRunsByDate(dateISO, timezone);
    },
    getCalendarRunDetail: async (runId) => {
      const repo = createEvalExportsRepo(defaultGetDb());
      return repo.getCompletedRunDetail(runId);
    },
  });
}
