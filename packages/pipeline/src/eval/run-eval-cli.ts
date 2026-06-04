import { readFile } from "node:fs/promises";
import {
  WINDOW_DEFAULT,
  WINDOW_MAX,
} from "@newsletter/shared/constants/eval-ranking";
import type {
  EvalScore,
  Fixture,
  GroundTruth,
  SourcingReportRow,
} from "@newsletter/shared/types/eval-ranking";
import { sourcingReport } from "@pipeline/eval/scoring.js";

import { EvalCache } from "@pipeline/eval/cache.js";
import {
  estimateCost as estimateCostDefault,
  type CostEstimate,
} from "@pipeline/eval/cost-estimator.js";
import {
  listFixtures as listFixturesDefault,
  readFixture as readFixtureDefault,
  readGroundTruth as readGroundTruthDefault,
} from "@pipeline/eval/fixture-io.js";
import { runEval as runEvalDefault } from "@pipeline/eval/index.js";
import {
  readScoreHistory as readScoreHistoryDefault,
  recordScore as recordScoreDefault,
  type ScoreHistoryEntry,
} from "@pipeline/eval/score-history.js";

export interface CostInfo {
  tokensIn: number;
  tokensOut: number;
  usd: number;
  cacheHit: boolean;
  promptHash: string;
}

export interface PerFixtureResult {
  fixtureId: string;
  score?: EvalScore;
  cost?: CostInfo;
  previousNdcgAt10?: number;
  error?: string;
}

export interface AggregateResult {
  meanNdcgAt10: number;
  totalCost: number;
  succeeded: number;
  failed: number;
  sourcingReport: SourcingReportRow[];
}

export interface EvalCliResult {
  exitCode: 0 | 1;
  perFixture: PerFixtureResult[];
  aggregate?: AggregateResult;
  estimate?: CostEstimate;
  dryRun?: boolean;
}

export interface RunEvalCliOptions {
  fixture?: string;
  all?: boolean;
  window?: number;
  forceWindow?: number;
  promptFile?: string;
  noCache?: boolean;
  dryRun?: boolean;
  diff?: boolean;
  json?: boolean;
  cacheDir?: string;
  runEval?: typeof runEvalDefault;
  cache?: EvalCache;
  listFixtures?: typeof listFixturesDefault;
  readFixture?: typeof readFixtureDefault;
  readGroundTruth?: typeof readGroundTruthDefault;
  loadPromptFromDb?: () => Promise<string>;
  estimateCost?: typeof estimateCostDefault;
  readScoreHistory?: typeof readScoreHistoryDefault;
  recordScore?: typeof recordScoreDefault;
  writeLine?: (s: string) => void;
  now?: Date;
}

async function resolvePrompt(opts: RunEvalCliOptions): Promise<string> {
  if (opts.promptFile !== undefined) {
    return readFile(opts.promptFile, "utf8");
  }
  if (opts.loadPromptFromDb === undefined) {
    throw new Error(
      "no prompt source: pass --prompt-file or provide loadPromptFromDb",
    );
  }
  return opts.loadPromptFromDb();
}

async function resolveTargetFixtures(
  opts: RunEvalCliOptions,
  windowSize: number,
): Promise<Fixture[]> {
  const readFixture = opts.readFixture ?? readFixtureDefault;
  const listFixtures = opts.listFixtures ?? listFixturesDefault;
  const readGroundTruth = opts.readGroundTruth ?? readGroundTruthDefault;

  if (opts.fixture !== undefined) {
    return [await readFixture(opts.fixture)];
  }
  const all = await listFixtures();
  const graded: { fixture: Fixture; gradedAt: string }[] = [];
  for (const fixture of all) {
    const gt = await readGroundTruth(fixture.fixtureId);
    if (gt === null) continue;
    graded.push({ fixture, gradedAt: gt.gradedAt });
  }
  graded.sort((a, b) => (a.gradedAt < b.gradedAt ? 1 : -1));
  return graded.slice(0, windowSize).map((g) => g.fixture);
}

export function formatPrettyLine(r: PerFixtureResult): string {
  if (r.error !== undefined) {
    return `[${r.fixtureId}] ERROR: ${r.error}`;
  }
  if (r.score === undefined) {
    return `[${r.fixtureId}] (no score — ground truth missing)`;
  }
  const s = r.score;
  const ndcg = s.ndcgAt10.toFixed(3);
  const p10 = s.precisionAt10.toFixed(3);
  const rec = s.mustIncludeRecall.toFixed(3);
  const r1 = s.rankOneIsMustInclude ? "yes" : "no";
  let delta = "";
  if (r.previousNdcgAt10 !== undefined) {
    const d = s.ndcgAt10 - r.previousNdcgAt10;
    const sign = d >= 0 ? "+" : "";
    delta = ` (Δ ${sign}${d.toFixed(3)} vs last run)`;
  }
  const cost = r.cost !== undefined ? ` cost $${r.cost.usd.toFixed(4)}` : "";
  return `[${s.fixtureId}] nDCG@10 ${ndcg}${delta} P@10 ${p10} recall ${rec} rank1Must ${r1}${cost}`;
}

interface RunFixtureEvalInput {
  fixture: Fixture;
  prompt: string;
  cache: EvalCache;
  history: Record<string, ScoreHistoryEntry>;
  runEvalFn: typeof runEvalDefault;
  readGroundTruth: typeof readGroundTruthDefault;
  recordScore: typeof recordScoreDefault;
}

interface RunFixtureEvalOutput {
  result: PerFixtureResult;
  graded: { fixture: Fixture; groundTruth: GroundTruth } | null;
}

export async function runFixtureEval(
  input: RunFixtureEvalInput,
): Promise<RunFixtureEvalOutput> {
  const { fixture, prompt, cache, history, runEvalFn, readGroundTruth, recordScore } = input;
  try {
    const gt: GroundTruth | null = await readGroundTruth(fixture.fixtureId);
    if (gt === null) {
      return {
        result: { fixtureId: fixture.fixtureId, error: "no ground truth" },
        graded: null,
      };
    }
    const out = await runEvalFn({ fixture, groundTruth: gt, prompt, model: fixture.model, cache });
    if (out.score === null) {
      return {
        result: { fixtureId: fixture.fixtureId, error: "runEval returned null score" },
        graded: { fixture, groundTruth: gt },
      };
    }
    const previous = fixture.fixtureId in history ? history[fixture.fixtureId] : undefined;
    const result: PerFixtureResult = {
      fixtureId: fixture.fixtureId,
      score: out.score,
      cost: {
        tokensIn: out.cost.tokensIn,
        tokensOut: out.cost.tokensOut,
        usd: out.cost.usd,
        cacheHit: out.cost.cacheHit,
        promptHash: out.cost.promptHash,
      },
      previousNdcgAt10: previous?.ndcgAt10,
    };
    await recordScore({
      fixtureId: fixture.fixtureId,
      ndcgAt10: out.score.ndcgAt10,
      ranAt: out.score.ranAt,
      promptHash: out.cost.promptHash,
    });
    return { result, graded: { fixture, groundTruth: gt } };
  } catch (err) {
    return {
      result: {
        fixtureId: fixture.fixtureId,
        error: err instanceof Error ? err.message : String(err),
      },
      graded: null,
    };
  }
}

export function formatEvalOutput(
  perFixture: PerFixtureResult[],
  aggregate: AggregateResult,
  opts: { json?: boolean; diff?: boolean },
  writeLine: (s: string) => void,
): void {
  const { json, diff } = opts;
  const exitCode: 0 | 1 = aggregate.succeeded > 0 ? 0 : 1;
  if (json === true) {
    const payload = {
      exitCode,
      perFixture: diff === true
        ? perFixture
        : perFixture.map((p) => {
            if (p.score === undefined) return p;
            const { perItemDiff: _diff, ...rest } = p.score;
            return { ...p, score: rest };
          }),
      aggregate,
    };
    writeLine(JSON.stringify(payload));
  } else {
    for (const p of perFixture) {
      writeLine(formatPrettyLine(p));
      if (diff === true && p.score !== undefined) {
        writeLine(`  perItemDiff: ${JSON.stringify(p.score.perItemDiff)}`);
      }
    }
    writeLine(
      `aggregate: mean nDCG@10 ${aggregate.meanNdcgAt10.toFixed(3)}, total cost $${aggregate.totalCost.toFixed(4)}, ${aggregate.succeeded}/${perFixture.length} succeeded`,
    );
    if (aggregate.sourcingReport.length > 0) {
      writeLine("sourcing report (source / must / nice / drop):");
      for (const row of aggregate.sourcingReport) {
        writeLine(
          `  ${row.sourceType.padEnd(16)} ${String(row.mustIncludeCount).padStart(4)} ${String(row.niceCount).padStart(4)} ${String(row.dropCount).padStart(4)}`,
        );
      }
    }
  }
}

export async function runEvalCli(
  opts: RunEvalCliOptions,
): Promise<EvalCliResult> {
  const writeLine =
    opts.writeLine ?? ((s: string): void => {
      process.stdout.write(`${s}\n`);
    });
  const estimateCost = opts.estimateCost ?? estimateCostDefault;
  const recordScore = opts.recordScore ?? recordScoreDefault;
  const readScoreHistory = opts.readScoreHistory ?? readScoreHistoryDefault;
  const runEvalFn = opts.runEval ?? runEvalDefault;
  const readGroundTruth = opts.readGroundTruth ?? readGroundTruthDefault;

  const requestedWindow = opts.forceWindow ?? opts.window ?? WINDOW_DEFAULT;
  if (
    opts.forceWindow === undefined &&
    opts.window !== undefined &&
    opts.window > WINDOW_MAX
  ) {
    throw new Error(
      `--window ${opts.window} exceeds the ${WINDOW_MAX} cap. Use --force-window to confirm cost beyond ${WINDOW_MAX} fixtures.`,
    );
  }

  const fixtures = await resolveTargetFixtures(opts, requestedWindow);

  if (opts.dryRun === true) {
    const model = fixtures[0]?.model ?? "claude-haiku-4-5-20251001";
    const estimate = estimateCost(fixtures.length, model);
    if (opts.json === true) {
      writeLine(
        JSON.stringify({
          exitCode: 0,
          dryRun: true,
          perFixture: [],
          estimate,
          fixtureCount: fixtures.length,
        }),
      );
    } else {
      writeLine(
        `dry-run: ${fixtures.length} fixture(s), model ${model}, est ${estimate.tokensIn} in / ${estimate.tokensOut} out tokens, ~$${(estimate.usd ?? 0).toFixed(4)}`,
      );
    }
    return {
      exitCode: 0,
      perFixture: [],
      estimate,
      dryRun: true,
    };
  }

  const prompt = await resolvePrompt(opts);
  const cache =
    opts.cache ??
    new EvalCache(opts.cacheDir ?? "evals/ranking/cache", {
      bypassCache: opts.noCache === true,
    });

  const history = await readScoreHistory();

  const perFixture: PerFixtureResult[] = [];
  const graded: { fixture: Fixture; groundTruth: GroundTruth }[] = [];
  for (const fixture of fixtures) {
    const { result, graded: gradedEntry } = await runFixtureEval({
      fixture,
      prompt,
      cache,
      history,
      runEvalFn,
      readGroundTruth,
      recordScore,
    });
    perFixture.push(result);
    if (gradedEntry !== null) graded.push(gradedEntry);
  }

  const succeeded = perFixture.filter((p) => p.score !== undefined);
  const failed = perFixture.length - succeeded.length;
  const meanNdcg =
    succeeded.length === 0
      ? 0
      : succeeded.reduce((sum, p) => sum + (p.score?.ndcgAt10 ?? 0), 0) /
        succeeded.length;
  const totalCost = perFixture.reduce(
    (sum, p) => sum + (p.cost?.usd ?? 0),
    0,
  );
  const report = sourcingReport(graded);
  const aggregate: AggregateResult = {
    meanNdcgAt10: meanNdcg,
    totalCost,
    succeeded: succeeded.length,
    failed,
    sourcingReport: report,
  };

  formatEvalOutput(perFixture, aggregate, { json: opts.json, diff: opts.diff }, writeLine);

  return { exitCode: aggregate.succeeded > 0 ? 0 : 1, perFixture, aggregate };
}
