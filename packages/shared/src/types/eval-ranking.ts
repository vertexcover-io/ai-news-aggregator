import type { EnrichedLinkContent, RawItemComment } from "./index.js";

/** Editorial relevance tier assigned by a human grader. */
export type Tier = "must" | "nice" | "drop";

/** Where the fixture was sourced from. */
export type FixtureSource = "run" | "manual" | "calendar";

/**
 * Status of the link-enrichment fetch for a fixture item. Defaults to `ok`
 * for legacy run-derived fixtures whose `raw_items.metadata.enrichedLink`
 * was not populated.
 */
export type EnrichmentStatus = "ok" | "failed" | "skipped";

/** Whether a fixture has a committed ground-truth file on disk. */
export type GradingStatus = "ungraded" | "in_progress" | "graded";

/** Minimal ranker output shape consumed by the scoring functions. */
export interface RankedItem {
  rawItemId: number;
}

/** One graded label produced by the grading UI. */
export interface GroundTruthLabel {
  rawItemId: number;
  tier: Tier;
}

/** One candidate inside a fixture pool. */
export interface FixtureItem {
  rawItemId: number;
  title: string;
  url: string;
  sourceType: string;
  publishedAt: string | null;
  content: string | null;
  enrichedLink: EnrichedLinkContent | null;
  enrichmentStatus: EnrichmentStatus;
  comments: RawItemComment[];
  engagement: { points: number; commentCount: number } | null;
}

/** Original ranker output entry preserved for diff display only. */
export interface OriginalRankerOutputEntry {
  rawItemId: number;
  score: number;
  rationale: string;
}

/** Dedup-cluster snapshot frozen at fixture-creation time. */
export interface FixtureDedupCluster {
  representativeId: number;
  duplicateIds: number[];
}

/**
 * JSON snapshot of a ranking input pool persisted under
 * `evals/ranking/fixtures/<fixtureId>.json`. Once committed, never edited.
 */
export interface Fixture {
  fixtureId: string;
  source: FixtureSource;
  date: string | null;
  runId: string | null;
  model: string;
  exportedAt: string;
  pool: FixtureItem[];
  dedupClusters: FixtureDedupCluster[];
  originalRankerOutput: OriginalRankerOutputEntry[] | null;
}

/**
 * Ground-truth labels for a fixture persisted under
 * `evals/ranking/groundtruth/<fixtureId>.json`.
 */
export interface GroundTruth {
  fixtureId: string;
  gradedBy: string[];
  gradedAt: string;
  labels: GroundTruthLabel[];
}

/** Request shape accepted by `POST /api/admin/eval/run`. */
export interface EvalRunRequest {
  mode: "scored" | "ab";
  fixtureId?: string;
  date?: string;
  draftPrompt: string;
  savedPrompt?: string;
  windowSize?: number;
  forceWindow?: boolean;
  bypassCache?: boolean;
}

/** A/B-mode payload: two parallel ranker outputs for a single date. */
export interface AbRanking {
  savedRanking: RankedItem[];
  draftRanking: RankedItem[];
}

/** One row of `perItemDiff` covering the union of ranker output and GT labels. */
export interface PerItemDiffRow {
  rawItemId: number;
  rankerRank: number | null;
  groundTruthTier: Tier | null;
}

/** Scored-mode metrics for a single fixture. */
export interface EvalScore {
  fixtureId: string;
  ndcgAt10: number;
  precisionAt10: number;
  mustIncludeRecall: number;
  rankOneIsMustInclude: boolean;
  perItemDiff: PerItemDiffRow[];
  ranAt: string;
  promptHash: string;
  model: string;
}

/** Per-fixture cost record returned in `EvalResult.perFixture[].cost`. */
export interface PerFixtureCost {
  promptHash: string;
  tokensIn: number;
  tokensOut: number;
  usd: number;
  cacheHit: boolean;
}

/**
 * One row in the ranker's actual output for a fixture, captured at SSE
 * finalize and persisted in `eval_runs.score_breakdown.perFixture[i].actualRanking`.
 * Optional on the parent because runs persisted before this field landed do
 * not carry it.
 */
export interface ActualRankingItem {
  rawItemId: number;
  url: string;
  title: string;
  score: number;
  rationale: string;
  summary: string;
  bullets: string[];
  bottomLine: string;
}

/**
 * One row of the human-graded expected order, captured at SSE finalize so
 * later fixture/groundtruth edits do not retroactively shift a historical
 * report. Rank is derived from tier order (must < nice < drop) plus position
 * within the tier.
 */
export interface ExpectedRankingItem {
  rawItemId: number;
  url: string;
  title: string;
  tier: Tier;
  rank: number;
}

/** Per-fixture result row inside `EvalResult.perFixture[]`. */
export interface PerFixtureResult {
  fixtureId: string;
  scored?: EvalScore;
  ab?: AbRanking;
  cost: PerFixtureCost;
  actualRanking?: ActualRankingItem[];
  expectedRanking?: ExpectedRankingItem[];
}

/** One row of the sourcing report aggregated across graded fixtures. */
export interface SourcingReportRow {
  sourceType: string;
  mustIncludeCount: number;
  niceCount: number;
  dropCount: number;
}

/** Delta-vs-previous entry surfaced in the Mode-A aggregate panel. */
export interface DeltaVsPrevious {
  fixtureId: string;
  previousNdcg: number;
  currentNdcg: number;
  delta: number;
}

/** Aggregate panel populated when `mode = 'scored'` and `perFixture.length > 1`. */
export interface EvalAggregate {
  meanNdcgAt10: number;
  meanPrecisionAt10: number;
  sourcingReport: SourcingReportRow[];
  deltaVsPrevious: DeltaVsPrevious[];
}

/** Top-level response shape from `runEval()`. */
export interface EvalResult {
  mode: "scored" | "ab";
  perFixture: PerFixtureResult[];
  aggregate?: EvalAggregate;
  totalCost: { usd: number; totalTokensIn: number; totalTokensOut: number };
}

/** Input payload for inserting a fresh `eval_runs` row at run start. */
export interface EvalRunInsertInput {
  mode: "scored" | "ab";
  fixtureId: string | null;
  date: string | null;
  windowSize: number | null;
  draftPromptHash: string;
  draftPromptSnapshot: string;
  savedPromptHash: string | null;
  savedPromptSnapshot: string | null;
}

/** Lifecycle status of an eval run. */
export type EvalRunStatus = "running" | "done" | "failed";

/** Full `eval_runs` row as returned by the API (timestamps serialised as ISO strings). */
export interface EvalRun {
  id: string;
  mode: "scored" | "ab";
  fixtureId: string | null;
  date: string | null;
  windowSize: number | null;
  draftPromptHash: string;
  draftPromptSnapshot: string;
  savedPromptHash: string | null;
  savedPromptSnapshot: string | null;
  status: EvalRunStatus;
  startedAt: string;
  finishedAt: string | null;
  scoreBreakdown: unknown;
  costBreakdown: unknown;
  errorMessage: string | null;
}

/** Compact `eval_runs` shape used by list endpoints (omits the big snapshot fields). */
export type EvalRunSummary = Omit<EvalRun, "draftPromptSnapshot" | "savedPromptSnapshot">;
