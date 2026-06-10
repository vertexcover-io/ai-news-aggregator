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
  CalendarRunDetail,
  CalendarRunSummary,
  Fixture,
  GradingStatus,
  GroundTruth,
} from "@newsletter/shared/types/eval-ranking";
import {
  createEvalExportsRepo,
  createManualFixture as defaultCreateManualFixture,
  listFixtures as defaultListFixtures,
  readFixture as defaultReadFixture,
  readGroundTruth as defaultReadGroundTruth,
  runEval as defaultRunEval,
  writeGroundTruth as defaultWriteGroundTruth,
  type CreateManualFixtureResult,
} from "@newsletter/pipeline/eval";
import {
  createUserSettingsRepo,
  type UserSettingsRepo,
} from "@api/repositories/user-settings.js";
import {
  createEvalRunsRepo,
  type EvalRunsRepo,
} from "@api/repositories/eval-runs.js";
import { runEvalOrchestrator, type RunEvalFn } from "@api/services/eval-run-orchestrator.js";
import { BOOTSTRAP_CONTEXT } from "@newsletter/shared/services";

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

interface FixtureSummary {
  fixtureId: string;
  source: Fixture["source"];
  date: string | null;
  model: string;
  exportedAt: string;
  itemCount: number;
  gradingStatus: GradingStatus;
}

export type { RunEvalFn };
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

    return streamSSE(c, async (stream) => {
      await runEvalOrchestrator({
        req,
        cacheDir,
        fixturesDir,
        groundtruthDir,
        evalRunsRepo: deps.getEvalRunsRepo?.(),
        getSettingsRepo: deps.getSettingsRepo,
        readFixtureFn,
        readGroundTruthFn,
        getCalendarRunDetailFn,
        runEvalFn,
        emit: (event) => stream.writeSSE(event),
        logger,
      });
    });
  });

  return app;
}

export function createDefaultAdminEvalRouter(): Hono {
  return createAdminEvalRouter({
    getSettingsRepo: () => createUserSettingsRepo(defaultGetDb(), BOOTSTRAP_CONTEXT),
    getEvalRunsRepo: () => createEvalRunsRepo(defaultGetDb(), BOOTSTRAP_CONTEXT),
    listCalendarRunsByDate: async (dateISO, timezone) => {
      const repo = createEvalExportsRepo(defaultGetDb(), BOOTSTRAP_CONTEXT);
      return repo.listCompletedRunsByDate(dateISO, timezone);
    },
    getCalendarRunDetail: async (runId) => {
      const repo = createEvalExportsRepo(defaultGetDb(), BOOTSTRAP_CONTEXT);
      return repo.getCompletedRunDetail(runId);
    },
  });
}

