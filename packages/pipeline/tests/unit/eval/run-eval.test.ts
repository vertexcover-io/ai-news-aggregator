import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  Fixture,
  GroundTruth,
} from "@newsletter/shared/types/eval-ranking";
import type { RankedItemRef } from "@newsletter/shared";

import { EvalCache } from "@pipeline/eval/cache.js";
import { runEval } from "@pipeline/eval/index.js";
import type { rankCandidates as rankCandidatesDefault } from "@pipeline/processors/rank.js";

type RankFn = typeof rankCandidatesDefault;

const FIXTURE: Fixture = {
  fixtureId: "fix-1",
  source: "manual",
  date: null,
  runId: null,
  model: "claude-haiku-4-5",
  exportedAt: "2026-05-22T00:00:00.000Z",
  pool: [
    {
      rawItemId: 1,
      title: "Item 1",
      url: "https://example.com/1",
      sourceType: "hn",
      publishedAt: null,
      content: null,
      enrichedLink: null,
      enrichmentStatus: "ok",
      comments: [],
      engagement: null,
    },
    {
      rawItemId: 2,
      title: "Item 2",
      url: "https://example.com/2",
      sourceType: "hn",
      publishedAt: null,
      content: null,
      enrichedLink: null,
      enrichmentStatus: "ok",
      comments: [],
      engagement: null,
    },
  ],
  dedupClusters: [],
  originalRankerOutput: null,
};

const RANKED: RankedItemRef[] = [
  { rawItemId: 1, score: 0.9, rationale: "Developer-relevance signal" },
  { rawItemId: 2, score: 0.8, rationale: "Signal-vs-hype matters" },
];

const GROUND_TRUTH: GroundTruth = {
  fixtureId: "fix-1",
  gradedBy: ["alice"],
  gradedAt: "2026-05-22T00:00:00.000Z",
  labels: [
    { rawItemId: 1, tier: "must" },
    { rawItemId: 2, tier: "nice" },
  ],
};

function makeStubRank(): { fn: RankFn; mock: ReturnType<typeof vi.fn> } {
  const mock = vi.fn(() =>
    Promise.resolve({
      rankedItems: RANKED,
      candidateCount: 2,
      rankedCount: 2,
      digestHeadline: "",
      digestSummary: "",
      hook: "",
      twitterSummary: "",
    }),
  );
  return { fn: mock as unknown as RankFn, mock };
}

describe("runEval", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "run-eval-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("cache miss → calls rankCandidates once and persists to cache", async () => {
    const cache = new EvalCache(dir);
    const stub = makeStubRank();
    const out = await runEval(
      {
        fixture: FIXTURE,
        groundTruth: null,
        prompt: "PROMPT",
        model: "claude-haiku-4-5",
        cache,
      },
      { rankCandidates: stub.fn },
    );
    expect(stub.mock).toHaveBeenCalledTimes(1);
    expect(out.cost.cacheHit).toBe(false);
    expect(out.rankedItems).toEqual(RANKED);

    const cached = await cache.get(
      FIXTURE.fixtureId,
      "PROMPT",
      "claude-haiku-4-5",
    );
    expect(cached).not.toBeNull();
    expect(cached?.rankedItems).toEqual(RANKED);
  });

  it("cache hit → does NOT call rankCandidates", async () => {
    const cache = new EvalCache(dir);
    await cache.set(FIXTURE.fixtureId, "PROMPT", "claude-haiku-4-5", {
      rankedItems: RANKED,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      },
      model: "claude-haiku-4-5",
      savedAt: "2026-05-22T00:00:00.000Z",
      promptHash: "abc",
    });
    const stub = makeStubRank();
    const out = await runEval(
      {
        fixture: FIXTURE,
        groundTruth: null,
        prompt: "PROMPT",
        model: "claude-haiku-4-5",
        cache,
      },
      { rankCandidates: stub.fn },
    );
    expect(stub.mock).not.toHaveBeenCalled();
    expect(out.cost.cacheHit).toBe(true);
    expect(out.cost.tokensIn).toBe(0);
    expect(out.cost.tokensOut).toBe(0);
    expect(out.cost.usd).toBe(0);
    expect(out.rankedItems).toEqual(RANKED);
  });

  it("bypassCache=true → calls rankCandidates even when cached", async () => {
    const writer = new EvalCache(dir);
    await writer.set(FIXTURE.fixtureId, "PROMPT", "claude-haiku-4-5", {
      rankedItems: RANKED,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      },
      model: "claude-haiku-4-5",
      savedAt: "2026-05-22T00:00:00.000Z",
      promptHash: "abc",
    });
    const cache = new EvalCache(dir, { bypassCache: true });
    const stub = makeStubRank();
    const out = await runEval(
      {
        fixture: FIXTURE,
        groundTruth: null,
        prompt: "PROMPT",
        model: "claude-haiku-4-5",
        cache,
      },
      { rankCandidates: stub.fn },
    );
    expect(stub.mock).toHaveBeenCalledTimes(1);
    expect(out.cost.cacheHit).toBe(false);
  });

  it("groundTruth null → returns score: null", async () => {
    const cache = new EvalCache(dir);
    const stub = makeStubRank();
    const out = await runEval(
      {
        fixture: FIXTURE,
        groundTruth: null,
        prompt: "P",
        model: "m",
        cache,
      },
      { rankCandidates: stub.fn },
    );
    expect(out.score).toBeNull();
  });

  it("groundTruth provided → returns valid EvalScore with nDCG computed", async () => {
    const cache = new EvalCache(dir);
    const stub = makeStubRank();
    const out = await runEval(
      {
        fixture: FIXTURE,
        groundTruth: GROUND_TRUTH,
        prompt: "P",
        model: "m",
        cache,
      },
      { rankCandidates: stub.fn },
    );
    expect(out.score).not.toBeNull();
    expect(out.score?.fixtureId).toBe("fix-1");
    expect(out.score?.ndcgAt10).toBeGreaterThan(0);
    expect(out.score?.rankOneIsMustInclude).toBe(true);
    expect(out.score?.promptHash).toHaveLength(16);
    expect(out.score?.model).toBe("m");
  });

  it("abortSignal aborted → propagates from rankCandidates", async () => {
    const cache = new EvalCache(dir);
    const controller = new AbortController();
    controller.abort();
    const stub = vi.fn((_c: unknown, opts: { abortSignal?: AbortSignal }) => {
      if (opts.abortSignal?.aborted) {
        return Promise.reject(new Error("aborted"));
      }
      return Promise.resolve({
        rankedItems: RANKED,
        candidateCount: 2,
        rankedCount: 2,
        digestHeadline: "",
        digestSummary: "",
        hook: "",
        twitterSummary: "",
      });
    }) as unknown as RankFn;
    await expect(
      runEval(
        {
          fixture: FIXTURE,
          groundTruth: null,
          prompt: "P",
          model: "m",
          cache,
          abortSignal: controller.signal,
        },
        { rankCandidates: stub },
      ),
    ).rejects.toThrow("aborted");
  });
});
