/**
 * REQ-100 + EDGE-015: personalized ranking end-to-end smoke.
 *
 * Seeds real raw_items rows (blog with content, HN link-post with null
 * content, HN self-post with content), invokes handleRunProcessJob with
 * stubbed collectors/embeddings/LLM/fetchMarkdown, and asserts:
 *   - the run completes within the 60s budget
 *   - rankedItems shape matches RankedItemRef[]
 *   - stage transitions collecting → processing → shortlisting → ranking → completed
 *   - EDGE-015: a profile-null run completes with zero embedding calls
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { config } from "dotenv";
import { resolve } from "node:path";
import type { AppDb } from "@newsletter/shared/db";
import type {
  UserProfile,
  RankedItemRef,
  RunState,
  RunStage,
  RunStatus,
  SourceRunState,
  CollectorResult,
} from "@newsletter/shared";
import {
  handleRunProcessJob,
  type CollectFns,
  type RunProcessDeps,
  type RunProcessJobData,
  type RunProcessJobLike,
} from "@pipeline/workers/run-process.js";
import { loadCandidatesSince } from "@pipeline/services/candidate-loader.js";
import {
  shortlistCandidates,
  type ShortlistOptions,
  type ShortlistResult,
} from "@pipeline/processors/shortlist.js";
import {
  rankCandidates,
  type RankOptions,
  type RankResult,
} from "@pipeline/processors/rank.js";
import {
  createRunStateService,
  type RunStateService,
  type RunSourceType,
} from "@pipeline/services/run-state.js";
import { createRawItemsRepo } from "@pipeline/repositories/raw-items.js";
import { getTestDb, truncateAll } from "@pipeline-tests/e2e/setup/test-db.js";
import {
  getTestRedis,
  closeTestRedis,
} from "@pipeline-tests/e2e/setup/test-redis.js";
import type { Candidate } from "@pipeline/services/candidate-loader.js";

config({ path: resolve(import.meta.dirname, "../../../../.env.test") });

interface GenerateArgs {
  model: unknown;
  system: string;
  prompt: string;
  schema: unknown;
  temperature?: number;
}

interface TestHarness {
  deps: RunProcessDeps;
  embedCalls: number;
  generateCalls: number;
  fetchMarkdownCalls: number;
  stageTransitions: RunStage[];
}

function buildHarness(db: AppDb): TestHarness {
  const connection = getTestRedis();
  const base = createRunStateService(connection);
  const repo = createRawItemsRepo(db);

  const harness: TestHarness = {
    embedCalls: 0,
    generateCalls: 0,
    fetchMarkdownCalls: 0,
    stageTransitions: [],
    deps: undefined as unknown as RunProcessDeps,
  };

  const runState: RunStateService = {
    get: (runId: string): Promise<RunState | null> => base.get(runId),
    set: (state: RunState): Promise<void> => base.set(state),
    update: (
      runId: string,
      mutate: (prev: RunState) => RunState,
    ): Promise<RunState | null> =>
      base.update(runId, (prev) => {
        const next = mutate(prev);
        if (next.stage !== prev.stage) {
          harness.stageTransitions.push(next.stage);
        }
        return next;
      }),
    updateSource: (
      runId: string,
      sourceType: RunSourceType,
      patch: Partial<SourceRunState>,
    ): Promise<void> => base.updateSource(runId, sourceType, patch),
    setStage: async (
      runId: string,
      stage: RunStage,
      status?: RunStatus,
    ): Promise<void> => {
      harness.stageTransitions.push(stage);
      await base.setStage(runId, stage, status);
    },
  };

  const now = new Date();

  const fakeBlog: CollectFns["web"] = async (): Promise<CollectorResult> => {
    await repo.upsertItems([
      {
        sourceType: "blog",
        externalId: "pr-blog-1",
        title: "Scaling LLM inference with speculative decoding",
        url: "https://example.com/blog/spec-decoding",
        sourceUrl: "https://example.com/blog/spec-decoding",
        author: "writer",
        content:
          "A practical look at speculative decoding for LLM inference. " +
          "Covers draft models, verifier kernels, and throughput wins.",
        publishedAt: now,
        collectedAt: now,
        engagement: { points: 0, commentCount: 0 },
        metadata: { comments: [] },
        updatedAt: now,
      },
    ]);
    return { itemsFetched: 1, itemsStored: 1, failures: 0, durationMs: 1 };
  };

  const fakeHn: CollectFns["hn"] = async (): Promise<CollectorResult> => {
    await repo.upsertItems([
      {
        sourceType: "hn",
        externalId: "pr-hn-link",
        title: "Agent frameworks: a practitioner's review",
        url: "https://example.com/ext/agent-frameworks",
        sourceUrl: "https://news.ycombinator.com/item?id=100",
        author: "hnuser1",
        content: null,
        publishedAt: now,
        collectedAt: now,
        engagement: { points: 200, commentCount: 30 },
        metadata: {
          comments: [
            {
              id: "hc1",
              author: "alice",
              content: "Good overview of tool routing",
              publishedAt: now.toISOString(),
            },
          ],
        },
        updatedAt: now,
      },
      {
        sourceType: "hn",
        externalId: "pr-hn-self",
        title: "Ask HN: best distributed database for multi-region writes",
        url: "https://news.ycombinator.com/item?id=101",
        sourceUrl: "https://news.ycombinator.com/item?id=101",
        author: "hnuser2",
        content:
          "I'm evaluating distributed databases for a multi-region workload. " +
          "Looking for practical experience on write conflict handling.",
        publishedAt: now,
        collectedAt: now,
        engagement: { points: 150, commentCount: 20 },
        metadata: {
          comments: [
            {
              id: "hc2",
              author: "bob",
              content: "Check out CockroachDB multi-region",
              publishedAt: now.toISOString(),
            },
          ],
        },
        updatedAt: now,
      },
    ]);
    return { itemsFetched: 2, itemsStored: 2, failures: 0, durationMs: 1 };
  };

  const fakeReddit: CollectFns["reddit"] = (): Promise<CollectorResult> =>
    Promise.resolve({
      itemsFetched: 0,
      itemsStored: 0,
      failures: 0,
      durationMs: 0,
    });

  const stubEmbedBatch = (inputs: string[]): Promise<number[][]> => {
    harness.embedCalls += 1;
    return Promise.resolve(
      inputs.map((_, i) => {
        const v = new Array<number>(8).fill(0);
        v[i % 8] = 1;
        return v;
      }),
    );
  };

  const stubGenerateObject = (
    args: GenerateArgs,
  ): Promise<{
    object: { ranked: { id: number; score: number; rationale: string }[] };
  }> => {
    harness.generateCalls += 1;
    const parsed = JSON.parse(args.prompt) as {
      items: { id: number }[];
    };
    // Pick a rationale axis that matches whichever system prompt was sent.
    // Profiled prompt uses Relevance; no-profile prompt uses Novelty.
    const axisRationale = args.system.includes("Relevance")
      ? "strong Relevance — topic match"
      : "strong Novelty — new angle";
    return Promise.resolve({
      object: {
        ranked: parsed.items.map((it, idx) => ({
          id: it.id,
          score: 80 - idx,
          rationale: axisRationale,
        })),
      },
    });
  };

  const stubFetchMarkdown = (): Promise<string> => {
    harness.fetchMarkdownCalls += 1;
    return Promise.resolve("stub markdown body");
  };

  const shortlistFn = (
    candidates: Candidate[],
    opts: ShortlistOptions,
  ): Promise<ShortlistResult> =>
    shortlistCandidates(candidates, { ...opts, embedBatch: stubEmbedBatch });

  const rankFn = (
    candidates: Candidate[],
    opts: RankOptions,
  ): Promise<RankResult> => {
    const loadBodies = async (
      cs: Candidate[],
    ): Promise<Map<number, string | null>> => {
      const m = new Map<number, string | null>();
      for (const c of cs) {
        if (c.content !== null) {
          m.set(c.id, c.content);
        } else {
          m.set(c.id, await stubFetchMarkdown());
        }
      }
      return m;
    };
    return rankCandidates(candidates, {
      ...opts,
      generateObject: stubGenerateObject,
      loadBodies,
    });
  };

  harness.deps = {
    runState,
    db,
    loadFn: loadCandidatesSince,
    shortlistFn,
    rankFn,
    collectFns: { hn: fakeHn, reddit: fakeReddit, web: fakeBlog },
  };

  return harness;
}

async function seedRunState(runId: string, topN: number): Promise<void> {
  const connection = getTestRedis();
  const runStateService = createRunStateService(connection);
  const startedAt = new Date(Date.now() - 60 * 1000).toISOString();
  const initial: RunState = {
    id: runId,
    status: "running",
    stage: "queued",
    topN,
    startedAt,
    updatedAt: startedAt,
    completedAt: null,
    sources: {
      hn: { status: "pending", itemsFetched: 0, errors: [] },
      reddit: { status: "pending", itemsFetched: 0, errors: [] },
      blog: { status: "pending", itemsFetched: 0, errors: [] },
    },
    rankedItems: null,
    warnings: [],
    error: null,
  };
  await runStateService.set(initial);
}

describe("personalized-ranking e2e (REQ-100, EDGE-015)", () => {
  let db: AppDb;

  beforeAll(() => {
    db = getTestDb();
    return async () => {
      await closeTestRedis();
    };
  });

  beforeEach(async () => {
    await truncateAll();
    const connection = getTestRedis();
    const keys = await connection.keys("run:pr-e2e-*");
    if (keys.length > 0) await connection.del(...keys);
  });

  it(
    "REQ-100: profiled run completes within 60s with expected rankedItems shape",
    { timeout: 60000 },
    async () => {
      const runId = "pr-e2e-profiled";
      await seedRunState(runId, 5);
      const harness = buildHarness(db);

      const profile: UserProfile = {
        name: "aman",
        topics: ["agent frameworks", "LLM inference"],
        antiTopics: ["crypto"],
      };

      const jobData: RunProcessJobData = {
        runId,
        topN: 5,
        sourceTypes: ["hn", "blog"],
        collectors: {
          hn: { sinceDays: 1 },
          web: { sources: [], maxItems: 5 },
        },
        profile,
      };
      const job: RunProcessJobLike = {
        name: "run-process",
        id: runId,
        data: jobData,
      };

      const start = Date.now();
      await handleRunProcessJob(harness.deps, job);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(60_000);

      const connection = getTestRedis();
      const runStateService = createRunStateService(connection);
      const final = await runStateService.get(runId);
      expect(final).not.toBeNull();
      expect(final?.status).toBe("completed");
      expect(final?.stage).toBe("completed");
      expect(final?.rankedItems).not.toBeNull();
      const ranked = (final?.rankedItems ?? []) as RankedItemRef[];
      expect(ranked.length).toBeGreaterThan(0);
      for (const r of ranked) {
        expect(typeof r.rawItemId).toBe("number");
        expect(typeof r.score).toBe("number");
        expect(typeof r.rationale).toBe("string");
      }

      const expectedOrder: RunStage[] = [
        "collecting",
        "processing",
        "shortlisting",
        "ranking",
        "completed",
      ];
      const filtered = harness.stageTransitions.filter((s) =>
        expectedOrder.includes(s),
      );
      expect(filtered).toEqual(expectedOrder);

      expect(harness.embedCalls).toBeGreaterThanOrEqual(1);
      expect(harness.generateCalls).toBe(1);
    },
  );

  it(
    "EDGE-015: profile-null run completes with no embedding calls",
    { timeout: 60000 },
    async () => {
      const runId = "pr-e2e-noprofile";
      await seedRunState(runId, 5);
      const harness = buildHarness(db);

      const jobData: RunProcessJobData = {
        runId,
        topN: 5,
        sourceTypes: ["hn", "blog"],
        collectors: {
          hn: { sinceDays: 1 },
          web: { sources: [], maxItems: 5 },
        },
        profile: null,
      };
      const job: RunProcessJobLike = {
        name: "run-process",
        id: runId,
        data: jobData,
      };

      await handleRunProcessJob(harness.deps, job);

      const connection = getTestRedis();
      const runStateService = createRunStateService(connection);
      const final = await runStateService.get(runId);
      expect(final?.status).toBe("completed");
      expect(final?.stage).toBe("completed");

      expect(harness.embedCalls).toBe(0);
      expect(harness.generateCalls).toBe(1);
    },
  );
});
