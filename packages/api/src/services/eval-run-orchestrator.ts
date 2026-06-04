import { createLogger } from "@newsletter/shared";
import { hashPrompt } from "@newsletter/shared/utils/prompt-hash";
import type {
  ActualRankingItem,
  CalendarRunDetail,
  CalendarRunReportEntry,
  EvalRunRequest,
  ExpectedRankingItem,
  Fixture,
  GroundTruth,
} from "@newsletter/shared/types/eval-ranking";
import {
  EvalCache,
  sourcingReport,
  type RunEvalArgs,
  type RunEvalOutput,
} from "@newsletter/pipeline/eval";
import type {
  EvalRunsRepo,
} from "@api/repositories/eval-runs.js";
import type { UserSettingsRepo } from "@api/repositories/user-settings.js";
import {
  buildActualRanking,
  buildCalendarRanking,
  buildCalendarRunFixture,
  buildExpectedRanking,
  truncateSnapshot,
} from "@api/services/eval-report.js";

const DEFAULT_RANKING_MODEL = "claude-haiku-4-5-20251001";

// Local aliases for injected function shapes — defined here to avoid circular imports
type ReadFixtureFn = (id: string, dir: string) => Promise<Fixture>;
type ReadGroundTruthFn = (id: string, dir: string) => Promise<GroundTruth | null>;
type GetCalendarRunDetailFn = (runId: string) => Promise<CalendarRunDetail | null>;
export type RunEvalFn = (args: RunEvalArgs) => Promise<RunEvalOutput>;

export interface SseEvent {
  event: string;
  data: string;
}

export type EmitFn = (event: SseEvent) => Promise<void>;

export interface RunEvalOrchestratorInput {
  req: EvalRunRequest;
  cacheDir: string;
  fixturesDir: string;
  groundtruthDir: string;
  evalRunsRepo: EvalRunsRepo | undefined;
  getSettingsRepo: () => UserSettingsRepo;
  readFixtureFn: ReadFixtureFn;
  readGroundTruthFn: ReadGroundTruthFn;
  getCalendarRunDetailFn: GetCalendarRunDetailFn | undefined;
  runEvalFn: RunEvalFn;
  emit: EmitFn;
  logger: ReturnType<typeof createLogger>;
}

export async function runEvalOrchestrator(input: RunEvalOrchestratorInput): Promise<void> {
  const {
    req, cacheDir, fixturesDir, groundtruthDir, evalRunsRepo,
    getSettingsRepo, readFixtureFn, readGroundTruthFn, getCalendarRunDetailFn,
    runEvalFn, emit, logger,
  } = input;

  const cache = new EvalCache(cacheDir, { bypassCache: req.bypassCache });
  const model = DEFAULT_RANKING_MODEL;

  const draftPromptHash = hashPrompt(req.draftPrompt);
  const draftPromptSnapshot = truncateSnapshot(req.draftPrompt);
  let savedPromptHash: string | null = null;
  let savedPromptSnapshot: string | null = null;
  if (req.mode === "ab") {
    const settingsRepo = getSettingsRepo();
    const settings = await settingsRepo.get();
    const sp = req.savedPrompt ?? settings?.rankingPrompt ?? "";
    if (sp.length > 0) {
      savedPromptHash = hashPrompt(sp);
      savedPromptSnapshot = truncateSnapshot(sp);
    }
  }

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

  let totalUsd = 0;
  try {
    if (req.mode === "scored") {
      interface Target {
        fixture: Fixture;
        groundTruth: GroundTruth | null;
      }
      const targets: Target[] = [];
      if (!req.fixtureId) {
        await emit({
          event: "error",
          data: JSON.stringify({ message: "fixtureId required for scored mode" }),
        });
        return;
      }
      let fixture: Fixture;
      try {
        fixture = await readFixtureFn(req.fixtureId, fixturesDir);
      } catch {
        await emit({
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
        poolSize?: number;
      }
      const perFixtureRecords: PerFixtureRecord[] = [];
      const perFixtureCosts: { fixtureId: string; cost: RunEvalOutput["cost"] }[] = [];
      for (const t of targets) {
        await emit({
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
          const actualRanking = buildActualRanking(result.rankedItems, t.fixture);
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
            poolSize: t.fixture.pool.length,
          });
          perFixtureCosts.push({
            fixtureId: t.fixture.fixtureId,
            cost: result.cost,
          });
          await emit({
            event: "progress",
            data: JSON.stringify({
              fixtureId: t.fixture.fixtureId,
              status: "done",
              score: result.score,
              cost: result.cost,
              actualRanking,
              expectedRanking,
              poolSize: t.fixture.pool.length,
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
          await emit({
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
      await emit({
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
      await emit({
        event: "done",
        data: JSON.stringify({ totalCost: { usd: totalUsd } }),
      });
      return;
    }

    // mode === "ab" — Mode B calendar run comparison.
    if (!req.date || !/^\d{4}-\d{2}-\d{2}$/.test(req.date)) {
      await emit({
        event: "error",
        data: JSON.stringify({ message: "date required (YYYY-MM-DD)" }),
      });
      return;
    }
    if (req.runIds === undefined || req.runIds.length === 0) {
      await emit({
        event: "error",
        data: JSON.stringify({ message: "runIds required" }),
      });
      return;
    }
    if (getCalendarRunDetailFn === undefined) {
      await emit({
        event: "error",
        data: JSON.stringify({ message: "calendar run loader not configured" }),
      });
      return;
    }
    const calendarRuns: CalendarRunReportEntry[] = [];
    const perRunCosts: {
      runId: string;
      cost: RunEvalOutput["cost"];
    }[] = [];
    for (const selectedRunId of req.runIds) {
      await emit({
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
          draftRanking: buildCalendarRanking(result.rankedItems, detail.sourcePool),
          promptDiff: {
            savedPromptHash,
            draftPromptHash,
            savedPromptSnapshot,
            draftPromptSnapshot,
          },
          cost: result.cost,
          poolSize: detail.sourcePool.length,
        };
        calendarRuns.push(entry);
        perRunCosts.push({ runId: selectedRunId, cost: result.cost });
        await emit({
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
        await emit({
          event: "progress",
          data: JSON.stringify(entry),
        });
      }
    }
    await emit({
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
    await emit({
      event: "done",
      data: JSON.stringify({ totalCost: { usd: totalUsd } }),
    });
  } catch (err) {
    logger.error({ err }, "admin-eval.run.failed");
    const errMsg = err instanceof Error ? err.message : String(err);
    await persistFailed(errMsg);
    await emit({
      event: "error",
      data: JSON.stringify({ message: errMsg }),
    });
  }
}
