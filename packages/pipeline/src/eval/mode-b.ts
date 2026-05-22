import type { RankedItemRef } from "@newsletter/shared";
import type {
  Fixture,
  FixtureItem,
} from "@newsletter/shared/types/eval-ranking";
import type { EvalCache } from "@pipeline/eval/cache.js";
import { runEval, type RunEvalCost } from "@pipeline/eval/index.js";

export interface CalendarPoolItem {
  rawItemId: number;
  title: string;
  url: string;
  sourceType: string;
  publishedAt: string | null;
  content: string | null;
}

/**
 * Build an in-memory `calendar` fixture from a pre-fetched pool of raw items.
 *
 * Callers (the API route) must read raw_items for the date from Postgres
 * and pass the pool here — this module deliberately has no DB dependency
 * so it can be exercised in unit tests without infrastructure. If the pool
 * is empty, throws so the caller can surface a 422.
 */
export function buildCalendarFixture(
  date: string,
  pool: CalendarPoolItem[],
  model: string,
): Fixture {
  if (pool.length === 0) {
    throw new Error(
      `buildCalendarFixture: no raw_items found for date ${date}`,
    );
  }
  const items: FixtureItem[] = pool.map((p) => ({
    rawItemId: p.rawItemId,
    title: p.title,
    url: p.url,
    sourceType: p.sourceType,
    publishedAt: p.publishedAt,
    content: p.content,
    enrichedLink: null,
    enrichmentStatus: "ok",
    comments: [],
    engagement: { points: 0, commentCount: 0 },
  }));
  return {
    fixtureId: `calendar-${date}`,
    source: "calendar",
    date,
    runId: null,
    model,
    exportedAt: new Date().toISOString(),
    pool: items,
    dedupClusters: [],
    originalRankerOutput: null,
  };
}

export interface ModeBRunArgs {
  fixture: Fixture;
  savedPrompt: string;
  draftPrompt: string;
  model: string;
  cache: EvalCache;
  abortSignal?: AbortSignal;
}

export interface ModeBResult {
  saved: RankedItemRef[];
  draft: RankedItemRef[];
  cost: {
    saved: RunEvalCost;
    draft: RunEvalCost;
    totalUsd: number;
  };
}

export interface ModeBDeps {
  runEval?: typeof runEval;
}

export async function runModeB(
  args: ModeBRunArgs,
  deps: ModeBDeps = {},
): Promise<ModeBResult> {
  const runEvalFn = deps.runEval ?? runEval;
  const [savedResult, draftResult] = await Promise.all([
    runEvalFn({
      fixture: args.fixture,
      groundTruth: null,
      prompt: args.savedPrompt,
      model: args.model,
      cache: args.cache,
      abortSignal: args.abortSignal,
    }),
    runEvalFn({
      fixture: args.fixture,
      groundTruth: null,
      prompt: args.draftPrompt,
      model: args.model,
      cache: args.cache,
      abortSignal: args.abortSignal,
    }),
  ]);
  return {
    saved: savedResult.rankedItems,
    draft: draftResult.rankedItems,
    cost: {
      saved: savedResult.cost,
      draft: draftResult.cost,
      totalUsd: savedResult.cost.usd + draftResult.cost.usd,
    },
  };
}
