/**
 * End-to-end seam test for the single-job run-process refactor: real Redis,
 * real Postgres, real BullMQ Queue/Worker. Collectors are injected as fakes
 * via `collectFns` so we can drive the in-process happy path, all-failed,
 * and partial-failure scenarios deterministically without external HTTP.
 *
 * This exercises:
 *   - Single processing-queue job (no FlowProducer)
 *   - In-process collector parallelism + per-source state writes
 *   - run-state Redis transitions inside one worker
 *   - Real dedup against canonical URLs in raw_items
 *   - Real candidate loader against Postgres
 *   - run-process completion path with rankedItems persisted to Redis
 *   - All-collectors-failed terminal state (REQ-010)
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  vi,
} from "vitest";
import { config } from "dotenv";
import { resolve } from "node:path";
import { Queue, QueueEvents, Worker } from "bullmq";
import { rawItems } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { CollectorResult, RunState } from "@newsletter/shared/types";
import {
  handleRunProcessJob,
  type CollectFns,
  type RunProcessJobData,
  type RunProcessJobLike,
  type RunProcessResult,
} from "@pipeline/workers/run-process.js";
import { loadCandidatesSince } from "@pipeline/services/candidate-loader.js";
import { createRunStateService } from "@pipeline/services/run-state.js";
import { createRawItemsRepo } from "@pipeline/repositories/raw-items.js";
import { createCandidatesRepo } from "@pipeline/repositories/candidates.js";
import { getTestDb, truncateAll } from "@pipeline-tests/e2e/setup/test-db.js";
import {
  getTestRedis,
  closeTestRedis,
} from "@pipeline-tests/e2e/setup/test-redis.js";

config({ path: resolve(import.meta.dirname, "../../../../.env.test") });

const PROCESS_QUEUE = "run-flow-e2e-processing";

async function pollUntilTerminal(
  get: () => Promise<RunState | null>,
  timeoutMs: number,
): Promise<RunState> {
  const start = Date.now();
  for (;;) {
    const state = await get();
    if (state && (state.status === "completed" || state.status === "failed")) {
      return state;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `timed out waiting for terminal run-state (last=${JSON.stringify(state)})`,
      );
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

interface ScenarioState {
  hnMode: "seed" | "fail";
  redditMode: "seed" | "fail";
}

describe("run flow end-to-end (single-job)", () => {
  let db: AppDb;
  let processWorker: Worker<RunProcessJobData, RunProcessResult>;
  let processQueueEvents: QueueEvents;
  let processQueue: Queue<RunProcessJobData, RunProcessResult>;
  // Mutable rank fn so individual tests can override behaviour.
  let rankFnImpl: (
    candidates: { id: number }[],
    options: { topN: number },
  ) => Promise<{
    rankedItems: { rawItemId: number; score: number; rationale: string }[];
    candidateCount: number;
    rankedCount: number;
  }>;
  // Mutable scenario so each test selects collector behavior.
  let scenario: ScenarioState;

  const defaultRankFn: typeof rankFnImpl = (candidates, options) =>
    Promise.resolve({
      rankedItems: candidates.slice(0, options.topN).map((c, idx) => ({
        rawItemId: c.id,
        score: 1 - idx * 0.1,
        rationale: "deterministic test rank",
      })),
      candidateCount: candidates.length,
      rankedCount: Math.min(candidates.length, options.topN),
    });

  beforeAll(() => {
    db = getTestDb();
    const connection = getTestRedis();
    const runStateService = createRunStateService(connection);
    const repo = createRawItemsRepo(db);

    rankFnImpl = defaultRankFn;
    scenario = { hnMode: "seed", redditMode: "seed" };

    processQueue = new Queue<RunProcessJobData, RunProcessResult>(
      PROCESS_QUEUE,
      { connection },
    );
    processQueueEvents = new QueueEvents(PROCESS_QUEUE, { connection });

    const fakeHn: CollectFns["hn"] = async (): Promise<CollectorResult> => {
      if (scenario.hnMode === "fail") {
        throw new Error("simulated hn failure");
      }
      const now = new Date();
      const items = [
        {
          sourceType: "hn" as const,
          externalId: "flow-hn-1",
          title: "AI breakthrough headline",
          url: "https://example.com/ai-breakthrough",
          sourceUrl: "https://news.ycombinator.com/item?id=1",
          author: "alice",
          content: null,
          publishedAt: now,
          collectedAt: now,
          engagement: { points: 250, commentCount: 30 },
          metadata: { comments: [] },
          updatedAt: now,
        },
        {
          // Duplicate of flow-hn-1 by canonical URL (utm stripped).
          sourceType: "hn" as const,
          externalId: "flow-hn-1-dup",
          title: "AI breakthrough headline (rehost)",
          url: "https://example.com/ai-breakthrough?utm_source=x",
          sourceUrl: "https://news.ycombinator.com/item?id=2",
          author: "alice",
          content: null,
          publishedAt: now,
          collectedAt: now,
          engagement: { points: 80, commentCount: 5 },
          metadata: { comments: [] },
          updatedAt: now,
        },
        {
          sourceType: "hn" as const,
          externalId: "flow-hn-2",
          title: "New transformer paper",
          url: "https://example.com/transformer",
          sourceUrl: "https://news.ycombinator.com/item?id=3",
          author: "bob",
          content: null,
          publishedAt: now,
          collectedAt: now,
          engagement: { points: 180, commentCount: 22 },
          metadata: { comments: [] },
          updatedAt: now,
        },
      ];
      await repo.upsertItems(items);
      return {
        itemsFetched: items.length,
        itemsStored: items.length,
        failures: 0,
        durationMs: 1,
      };
    };

    const fakeReddit: CollectFns["reddit"] =
      async (): Promise<CollectorResult> => {
        if (scenario.redditMode === "fail") {
          throw new Error("simulated reddit failure");
        }
        const now = new Date();
        const items = [
          {
            sourceType: "reddit" as const,
            externalId: "flow-r-1",
            title: "LocalLLaMA: new fine-tune",
            url: "https://example.com/localllama-finetune",
            sourceUrl: "https://reddit.com/r/LocalLLaMA/1",
            author: "redditor",
            content: null,
            publishedAt: now,
            collectedAt: now,
            engagement: { points: 400, commentCount: 50 },
            metadata: { comments: [] },
            updatedAt: now,
          },
        ];
        await repo.upsertItems(items);
        return {
          itemsFetched: items.length,
          itemsStored: items.length,
          failures: 0,
          durationMs: 1,
        };
      };

    const fakeWeb: CollectFns["web"] = (): Promise<CollectorResult> =>
      Promise.resolve({
        itemsFetched: 0,
        itemsStored: 0,
        failures: 0,
        durationMs: 0,
      });

    processWorker = new Worker<RunProcessJobData, RunProcessResult>(
      PROCESS_QUEUE,
      (job) =>
        handleRunProcessJob(
          {
            runState: runStateService,
            rawItemsRepo: createRawItemsRepo(db),
            candidatesRepo: createCandidatesRepo(db),
            loadFn: loadCandidatesSince,
            shortlistFn: (candidates) =>
              Promise.resolve({ shortlist: candidates, breakdowns: [] }),
            rankFn: (candidates, options) => rankFnImpl(candidates, options),
            collectFns: { hn: fakeHn, reddit: fakeReddit, web: fakeWeb },
          },
          job as unknown as RunProcessJobLike,
        ),
      { connection },
    );

    return async () => {
      await processWorker.close();
      await processQueueEvents.close();
      await processQueue.close();
      await closeTestRedis();
    };
  });

  beforeEach(async () => {
    rankFnImpl = defaultRankFn;
    scenario = { hnMode: "seed", redditMode: "seed" };
    await truncateAll();
    await processQueue.obliterate({ force: true });
    const connection = getTestRedis();
    const keys = await connection.keys("run:run-flow-e2e-*");
    if (keys.length > 0) await connection.del(...keys);
  });

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
      },
      rankedItems: null,
      warnings: [],
      error: null,
    };
    await runStateService.set(initial);
  }

  it(
    "REQ-001/REQ-005: full single-job flow completes with HN+Reddit",
    { timeout: 60000 },
    async () => {
      const runId = "run-flow-e2e-happy";
      await seedRunState(runId, 3);

      await processQueue.add(
        "run-process",
        {
          runId,
          topN: 3,
          sourceTypes: ["hn", "reddit"],
          collectors: {
            hn: { sinceDays: 1 },
            reddit: { subreddits: ["LocalLLaMA"], sinceDays: 1 },
          },
        },
        { jobId: runId },
      );

      const connection = getTestRedis();
      const runStateService = createRunStateService(connection);
      const final = await pollUntilTerminal(
        () => runStateService.get(runId),
        45000,
      );

      expect(final.status).toBe("completed");
      expect(final.stage).toBe("completed");
      expect(final.completedAt).not.toBeNull();
      expect(final.rankedItems?.length).toBe(3);
      expect(final.sources.hn?.status).toBe("completed");
      expect(final.sources.reddit?.status).toBe("completed");
      expect(final.sources.hn?.itemsFetched).toBe(3);
      expect(final.sources.reddit?.itemsFetched).toBe(1);

      // Dedup: 3 HN rows seeded but two share canonical URL → 2 unique HN + 1 reddit = 3 candidates.
      // The deterministic rankFn returns all 3 with descending scores.
      const ids = (final.rankedItems ?? []).map((r) => r.rawItemId);
      expect(new Set(ids).size).toBe(3);

      // Raw items physically present in Postgres.
      const rows = await db.select().from(rawItems);
      expect(rows.length).toBe(4);
    },
  );

  it(
    "REQ-010: all collectors fail → run marked failed and rank skipped",
    { timeout: 60000 },
    async () => {
      const runId = "run-flow-e2e-allfail";
      await seedRunState(runId, 3);
      scenario = { hnMode: "fail", redditMode: "fail" };
      const rankSpy = vi.fn(defaultRankFn);
      rankFnImpl = rankSpy;

      await processQueue.add(
        "run-process",
        {
          runId,
          topN: 3,
          sourceTypes: ["hn", "reddit"],
          collectors: {
            hn: { sinceDays: 1 },
            reddit: { subreddits: ["LocalLLaMA"], sinceDays: 1 },
          },
        },
        { jobId: runId },
      );

      const connection = getTestRedis();
      const runStateService = createRunStateService(connection);
      const final = await pollUntilTerminal(
        () => runStateService.get(runId),
        45000,
      );

      expect(final.status).toBe("failed");
      expect(final.stage).toBe("failed");
      expect(final.rankedItems).toBeNull();
      expect(final.error).toContain("simulated hn failure");
      expect(final.error).toContain("simulated reddit failure");
      expect(final.sources.hn?.status).toBe("failed");
      expect(final.sources.reddit?.status).toBe("failed");
      expect(rankSpy).not.toHaveBeenCalled();
    },
  );

  it(
    "REQ-007/EDGE-013: partial failure — surviving collector items still ranked",
    { timeout: 60000 },
    async () => {
      const runId = "run-flow-e2e-mixed";
      await seedRunState(runId, 5);
      scenario = { hnMode: "seed", redditMode: "fail" };
      const rankSpy = vi.fn(defaultRankFn);
      rankFnImpl = rankSpy;

      await processQueue.add(
        "run-process",
        {
          runId,
          topN: 5,
          sourceTypes: ["hn", "reddit"],
          collectors: {
            hn: { sinceDays: 1 },
            reddit: { subreddits: ["LocalLLaMA"], sinceDays: 1 },
          },
        },
        { jobId: runId },
      );

      const connection = getTestRedis();
      const runStateService = createRunStateService(connection);
      const final = await pollUntilTerminal(
        () => runStateService.get(runId),
        45000,
      );

      expect(final.status).toBe("completed");
      expect(final.sources.hn?.status).toBe("completed");
      expect(final.sources.reddit?.status).toBe("failed");
      expect(rankSpy).toHaveBeenCalledTimes(1);
      const [candidatesArg] = rankSpy.mock.calls[0];
      // 3 HN raw_items but two collapse via canonical URL → 2 deduped candidates.
      expect(candidatesArg.length).toBe(2);
    },
  );
});
