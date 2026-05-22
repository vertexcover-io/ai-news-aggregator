import type { RankedItemRef } from "@newsletter/shared";
import { EVAL_K } from "@newsletter/shared/constants/eval-ranking";
import { hashPrompt } from "@newsletter/shared/utils/prompt-hash";
import type {
  EvalScore,
  Fixture,
  GroundTruth,
} from "@newsletter/shared/types/eval-ranking";
import { rankCandidates as rankCandidatesDefault } from "@pipeline/processors/rank.js";
import { createCostTracker } from "@pipeline/services/cost-tracker.js";
import { EvalCache } from "@pipeline/eval/cache.js";
import { fixtureToCandidates } from "@pipeline/eval/replay.js";
import {
  mustIncludeRecall,
  ndcgAtK,
  perItemDiff,
  precisionAtK,
  rankOneIsMustInclude,
} from "@pipeline/eval/scoring.js";

export interface RunEvalArgs {
  fixture: Fixture;
  groundTruth: GroundTruth | null;
  prompt: string;
  model: string;
  cache: EvalCache;
  abortSignal?: AbortSignal;
}

export interface RunEvalCost {
  tokensIn: number;
  tokensOut: number;
  usd: number;
  cacheHit: boolean;
  promptHash: string;
}

export interface RunEvalOutput {
  rankedItems: RankedItemRef[];
  score: EvalScore | null;
  cost: RunEvalCost;
}

export interface RunEvalDeps {
  rankCandidates?: typeof rankCandidatesDefault;
}

function computeScore(
  rankedItems: RankedItemRef[],
  groundTruth: GroundTruth,
  fixtureId: string,
  model: string,
  promptHash: string,
): EvalScore {
  const ranked = rankedItems.map((r) => ({ rawItemId: r.rawItemId }));
  return {
    fixtureId,
    ndcgAt10: ndcgAtK(ranked, groundTruth.labels, EVAL_K),
    precisionAt10: precisionAtK(ranked, groundTruth.labels, EVAL_K),
    mustIncludeRecall: mustIncludeRecall(ranked, groundTruth.labels, EVAL_K),
    rankOneIsMustInclude: rankOneIsMustInclude(ranked, groundTruth.labels),
    perItemDiff: perItemDiff(ranked, groundTruth.labels),
    ranAt: new Date().toISOString(),
    promptHash,
    model,
  };
}

export async function runEval(
  args: RunEvalArgs,
  deps: RunEvalDeps = {},
): Promise<RunEvalOutput> {
  const { fixture, groundTruth, prompt, model, cache, abortSignal } = args;
  const rankCandidatesFn = deps.rankCandidates ?? rankCandidatesDefault;
  const promptHash = hashPrompt(prompt);

  const cached = await cache.get(fixture.fixtureId, prompt, model);
  if (cached !== null) {
    return {
      rankedItems: cached.rankedItems,
      score:
        groundTruth !== null
          ? computeScore(
              cached.rankedItems,
              groundTruth,
              fixture.fixtureId,
              model,
              promptHash,
            )
          : null,
      cost: {
        tokensIn: 0,
        tokensOut: 0,
        usd: 0,
        cacheHit: true,
        promptHash,
      },
    };
  }

  const candidates = fixtureToCandidates(fixture);
  const tracker = createCostTracker(fixture.fixtureId);

  const result = await rankCandidatesFn(candidates, {
    systemPrompt: prompt,
    modelId: model,
    topN: EVAL_K,
    tracker,
    runId: fixture.fixtureId,
    abortSignal,
  });

  const snapshot = tracker.snapshot();
  const rankStage = snapshot.stages.rank;
  const modelEntry = rankStage?.byModel.find((m) => m.modelId === model);
  const inputTokens = modelEntry?.inputTokens ?? 0;
  const outputTokens = modelEntry?.outputTokens ?? 0;
  const cacheCreationTokens =
    (modelEntry?.cacheCreation5mTokens ?? 0) +
    (modelEntry?.cacheCreation1hTokens ?? 0);
  const cacheReadTokens = modelEntry?.cachedInputTokens ?? 0;
  const usd = snapshot.totalCostUsd ?? 0;

  await cache.set(fixture.fixtureId, prompt, model, {
    rankedItems: result.rankedItems,
    usage: {
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
    },
    model,
    savedAt: new Date().toISOString(),
    promptHash,
  });

  return {
    rankedItems: result.rankedItems,
    score:
      groundTruth !== null
        ? computeScore(
            result.rankedItems,
            groundTruth,
            fixture.fixtureId,
            model,
            promptHash,
          )
        : null,
    cost: {
      tokensIn: inputTokens,
      tokensOut: outputTokens,
      usd,
      cacheHit: false,
      promptHash,
    },
  };
}
