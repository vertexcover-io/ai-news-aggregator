import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import {
  createLogger,
  getDb as defaultGetDb,
} from "@newsletter/shared";
import { GroundTruthSchema } from "@newsletter/shared/types/eval-ranking-schemas";
import { EvalRunRequestSchema } from "@newsletter/shared/types/eval-ranking-schemas";
import { FIXTURES_DIR, GROUNDTRUTH_DIR } from "@newsletter/shared/constants/eval-ranking";
import type {
  Fixture,
  GradingStatus,
  GroundTruth,
} from "@newsletter/shared/types/eval-ranking";
import {
  buildCalendarFixture,
  createEvalExportsRepo,
  createManualFixture as defaultCreateManualFixture,
  listFixtures as defaultListFixtures,
  readFixture as defaultReadFixture,
  readGroundTruth as defaultReadGroundTruth,
  runEval as defaultRunEval,
  runModeB as defaultRunModeB,
  sourcingReport,
  writeGroundTruth as defaultWriteGroundTruth,
  EvalCache,
  type CalendarPoolItem,
  type CreateManualFixtureResult,
  type ModeBResult,
  type RunEvalArgs,
  type RunEvalOutput,
} from "@newsletter/pipeline/eval";
import {
  createUserSettingsRepo,
  type UserSettingsRepo,
} from "@api/repositories/user-settings.js";

const manualFixtureRequestSchema = z.object({
  urls: z.array(z.url()).min(1).max(50),
  name: z.string().max(80).optional(),
});

const savePromptSchema = z.object({
  prompt: z.string().min(1).max(20000),
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
export type RunModeBFn = typeof defaultRunModeB;
export type ListFixturesFn = typeof defaultListFixtures;
export type ReadFixtureFn = typeof defaultReadFixture;
export type ReadGroundTruthFn = typeof defaultReadGroundTruth;
export type WriteGroundTruthFn = typeof defaultWriteGroundTruth;
export type CreateManualFixtureFn = (
  urls: string[],
  opts?: { name?: string; model?: string },
) => Promise<CreateManualFixtureResult>;
export type FindRawItemsByDateFn = (dateISO: string) => Promise<
  CalendarPoolItem[]
>;

export interface AdminEvalRouterDeps {
  getSettingsRepo: () => UserSettingsRepo;
  listFixtures?: ListFixturesFn;
  readFixture?: ReadFixtureFn;
  readGroundTruth?: ReadGroundTruthFn;
  writeGroundTruth?: WriteGroundTruthFn;
  createManualFixture?: CreateManualFixtureFn;
  runEval?: RunEvalFn;
  runModeB?: RunModeBFn;
  findRawItemsByDate?: FindRawItemsByDateFn;
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
  const runModeBFn = deps.runModeB ?? defaultRunModeB;
  const findRawItemsByDateFn = deps.findRawItemsByDate;
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

    return streamSSE(c, async (stream) => {
      let totalUsd = 0;
      try {
        if (req.mode === "scored") {
          if (!req.fixtureId) {
            await stream.writeSSE({
              event: "error",
              data: JSON.stringify({ message: "fixtureId required for scored mode" }),
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
          await stream.writeSSE({
            event: "progress",
            data: JSON.stringify({
              fixtureId: req.fixtureId,
              status: "running",
            }),
          });
          try {
            const args: RunEvalArgs = {
              fixture,
              groundTruth: gt,
              prompt: req.draftPrompt,
              model,
              cache,
            };
            const result: RunEvalOutput = await runEvalFn(args);
            totalUsd += result.cost.usd;
            await stream.writeSSE({
              event: "progress",
              data: JSON.stringify({
                fixtureId: req.fixtureId,
                status: "done",
                score: result.score,
                cost: result.cost,
              }),
            });
          } catch (err) {
            await stream.writeSSE({
              event: "progress",
              data: JSON.stringify({
                fixtureId: req.fixtureId,
                status: "error",
                error: err instanceof Error ? err.message : String(err),
              }),
            });
          }
          const report = gt !== null ? sourcingReport([{ fixture, groundTruth: gt }]) : [];
          await stream.writeSSE({
            event: "aggregate",
            data: JSON.stringify({
              totalCost: { usd: totalUsd },
              sourcingReport: report,
            }),
          });
          await stream.writeSSE({
            event: "done",
            data: JSON.stringify({ totalCost: { usd: totalUsd } }),
          });
          return;
        }
        // mode === "ab" — Mode B Calendar comparison.
        if (!req.date || !/^\d{4}-\d{2}-\d{2}$/.test(req.date)) {
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({ message: "date required (YYYY-MM-DD)" }),
          });
          return;
        }
        if (findRawItemsByDateFn === undefined) {
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({
              message: "calendar pool loader not configured",
            }),
          });
          return;
        }
        const repo = deps.getSettingsRepo();
        const settings = await repo.get();
        const savedPrompt =
          req.savedPrompt ?? settings?.rankingPrompt ?? "";
        if (savedPrompt.length === 0) {
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({ message: "savedPrompt unavailable" }),
          });
          return;
        }
        const pool = await findRawItemsByDateFn(req.date);
        if (pool.length === 0) {
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({
              message: `no raw_items for ${req.date}`,
            }),
          });
          return;
        }
        const fixture = buildCalendarFixture(req.date, pool, model);
        await stream.writeSSE({
          event: "progress",
          data: JSON.stringify({ branch: "saved", status: "running" }),
        });
        await stream.writeSSE({
          event: "progress",
          data: JSON.stringify({ branch: "draft", status: "running" }),
        });
        let abResult: ModeBResult;
        try {
          abResult = await runModeBFn({
            fixture,
            savedPrompt,
            draftPrompt: req.draftPrompt,
            model,
            cache,
          });
        } catch (err) {
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({
              message: err instanceof Error ? err.message : String(err),
            }),
          });
          return;
        }
        totalUsd += abResult.cost.totalUsd;
        const titleById = new Map<number, { title: string; url: string; source: string }>();
        for (const p of pool) {
          titleById.set(p.rawItemId, {
            title: p.title,
            url: p.url,
            source: p.sourceType,
          });
        }
        const toAbItems = (
          refs: { rawItemId: number }[],
        ): { rank: number; rawItemId: number; title: string; url: string; source: string }[] =>
          refs.slice(0, 10).map((r, idx) => {
            const meta = titleById.get(r.rawItemId);
            return {
              rank: idx + 1,
              rawItemId: r.rawItemId,
              title: meta?.title ?? `#${String(r.rawItemId)}`,
              url: meta?.url ?? "",
              source: meta?.source ?? "",
            };
          });
        await stream.writeSSE({
          event: "aggregate",
          data: JSON.stringify({
            saved: toAbItems(abResult.saved),
            draft: toAbItems(abResult.draft),
            totalCost: { usd: totalUsd },
          }),
        });
        await stream.writeSSE({
          event: "done",
          data: JSON.stringify({ totalCost: { usd: totalUsd } }),
        });
      } catch (err) {
        logger.error({ err }, "admin-eval.run.failed");
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({
            message: err instanceof Error ? err.message : String(err),
          }),
        });
      }
    });
  });

  return app;
}

export function createDefaultAdminEvalRouter(): Hono {
  return createAdminEvalRouter({
    getSettingsRepo: () => createUserSettingsRepo(defaultGetDb()),
    findRawItemsByDate: async (dateISO) => {
      const repo = createEvalExportsRepo(defaultGetDb());
      const rows = await repo.findRawItemsByDate(dateISO);
      return rows.map((r) => ({
        rawItemId: r.id,
        title: r.title,
        url: r.url,
        sourceType: r.sourceType,
        publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
        content: r.content,
      }));
    },
  });
}
