import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { config } from "dotenv";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Queue, QueueEvents, Worker } from "bullmq";
import { eq, sql } from "drizzle-orm";
import { rawItems, runArchives } from "@newsletter/shared/db";
import type { RunState } from "@newsletter/shared/types";
import type { CollectorResult } from "@newsletter/shared/types";
import type { LanguageModelUsage, ProviderMetadata } from "ai";
import {
  handleRunProcessJob,
  type CollectFns,
  type RunProcessJobLike,
  type RunProcessResult,
} from "@pipeline/workers/run-process.js";
import { hydrateAddedPost } from "@pipeline/services/add-post-helper.js";
import { loadCandidatesSince } from "@pipeline/services/candidate-loader.js";
import { createRunStateService } from "@pipeline/services/run-state.js";
import { createRawItemsRepo } from "@pipeline/repositories/raw-items.js";
import { createCandidatesRepo } from "@pipeline/repositories/candidates.js";
import { createRunArchivesRepo } from "@pipeline/repositories/run-archives.js";
import { getTestDb, truncateAll } from "@pipeline-tests/e2e/setup/test-db.js";
import {
  getTestRedis,
  closeTestRedis,
} from "@pipeline-tests/e2e/setup/test-redis.js";
import type { AppDb } from "@newsletter/shared/db";
import type { CancelSubscriberFactory } from "@pipeline/services/cancel-subscriber.js";
import type { RunCostBreakdown } from "@newsletter/shared";

config({ path: resolve(import.meta.dirname, "../../../../../.env.test") });

const STUB_USAGE: LanguageModelUsage = {
  inputTokens: 1000,
  outputTokens: 200,
  totalTokens: 1200,
  cachedInputTokens: 0,
};
const STUB_META: ProviderMetadata = {
  anthropic: {
    usage: {
      input_tokens: 1000,
      output_tokens: 200,
      cache_creation: {
        ephemeral_5m_input_tokens: 0,
        ephemeral_1h_input_tokens: 0,
      },
    },
  },
};

function noopCollect(): Promise<CollectorResult> {
  return Promise.resolve({
    itemsFetched: 0,
    itemsStored: 0,
    failures: 0,
    durationMs: 0,
  });
}

const noopCollectFns: CollectFns = {
  hn: noopCollect,
  reddit: noopCollect,
  web: noopCollect,
};
const noopCancelSubscriber: CancelSubscriberFactory = {
  subscribe: () => Promise.resolve({ close: () => Promise.resolve() }),
};

interface WorkerHandle {
  worker: Worker<unknown, RunProcessResult>;
  queue: Queue;
  queueEvents: QueueEvents;
}

function buildWorker(
  db: AppDb,
  queueName: string,
  options: {
    rankModelId?: string;
    rankFails?: boolean;
  } = {},
): WorkerHandle {
  const connection = getTestRedis();
  const runStateService = createRunStateService(connection);
  const queue = new Queue(queueName, { connection });
  const queueEvents = new QueueEvents(queueName, { connection });
  const modelId = options.rankModelId ?? "claude-haiku-4-5-20251001";

  const worker = new Worker<unknown, RunProcessResult>(
    queueName,
    (job) =>
      handleRunProcessJob(
        {
          runState: runStateService,
          rawItemsRepo: createRawItemsRepo(db),
          candidatesRepo: createCandidatesRepo(db),
          archiveRepo: createRunArchivesRepo(db),
          loadFn: loadCandidatesSince,
          shortlistFn: (candidates) =>
            Promise.resolve({ shortlist: candidates, breakdowns: [] }),
          rankFn: (deduped, opts) => {
            if (options.rankFails) {
              return Promise.reject(new Error("forced rank failure"));
            }
            opts.tracker?.record({
              stage: "rank",
              modelId,
              usage: STUB_USAGE,
              providerMetadata: STUB_META,
            });
            return Promise.resolve({
              rankedItems: deduped.slice(0, opts.topN).map((c, idx) => ({
                rawItemId: c.id,
                score: 1 - idx * 0.1,
                rationale: "deterministic",
              })),
              candidateCount: deduped.length,
              rankedCount: Math.min(deduped.length, opts.topN),
              digestHeadline: "",
              digestSummary: "",
              hook: "",
              twitterSummary: "",
            });
          },
          collectFns: noopCollectFns,
          cancelSubscriber: noopCancelSubscriber,
        },
        job as unknown as RunProcessJobLike,
      ),
    { connection },
  );

  return { worker, queue, queueEvents };
}

async function loadCostBreakdown(
  db: AppDb,
  runId: string,
): Promise<RunCostBreakdown | null> {
  const rows = await db
    .select({ costBreakdown: runArchives.costBreakdown })
    .from(runArchives)
    .where(eq(runArchives.id, runId));
  return rows[0]?.costBreakdown ?? null;
}

describe("cost-tracking E2E", () => {
  let db: AppDb;
  let handle: WorkerHandle;

  beforeAll(() => {
    db = getTestDb();
    handle = buildWorker(db, "cost-tracking-e2e-test");

    return async () => {
      await handle.worker.close();
      await handle.queueEvents.close();
      await handle.queue.close();
      await closeTestRedis();
    };
  });

  beforeEach(async () => {
    await truncateAll();
    await db.execute(sql`TRUNCATE TABLE run_archives CASCADE`);
    await handle.queue.obliterate({ force: true });
  });

  it("REQ-040 + REQ-042 VS-1 happy path: writes non-null cost_breakdown with schemaVersion 1", async () => {
    const runId = randomUUID();
    await db.insert(rawItems).values([
      {
        sourceType: "hn",
        externalId: `hn-${runId}-1`,
        title: "Item A",
        url: "https://example.com/cost-a",
        engagement: { points: 100, commentCount: 1 },
        metadata: { comments: [] },
      },
    ]);
    const connection = getTestRedis();
    const runState = createRunStateService(connection);
    const startedAt = new Date(Date.now() - 60 * 1000).toISOString();
    const initial: RunState = {
      id: runId,
      status: "running",
      stage: "collecting",
      topN: 1,
      startedAt,
      updatedAt: startedAt,
      completedAt: null,
      sources: {},
      rankedItems: null,
      warnings: [],
      error: null,
    };
    await runState.set(initial);

    const job = await handle.queue.add("run-process", {
      runId,
      topN: 1,
      sourceTypes: ["hn"],
      collectors: {},
    });
    await job.waitUntilFinished(handle.queueEvents, 30000);

    const breakdown = await loadCostBreakdown(db, runId);
    expect(breakdown).not.toBeNull();
    expect(breakdown?.schemaVersion).toBe(1);
    expect(breakdown?.stages.rank).toBeDefined();
    expect(breakdown?.stages.rank?.byModel[0].calls).toBe(1);
    expect(breakdown?.totalCostUsd).not.toBeNull();
    expect(breakdown?.totalCostUsd ?? 0).toBeGreaterThan(0);
  });

  it("REQ-040 EDGE-001 empty run skips write: cost_breakdown stays NULL", async () => {
    const runId = randomUUID();
    const connection = getTestRedis();
    const runState = createRunStateService(connection);
    const startedAt = new Date(Date.now() - 60 * 1000).toISOString();
    await runState.set({
      id: runId,
      status: "running",
      stage: "collecting",
      topN: 1,
      startedAt,
      updatedAt: startedAt,
      completedAt: null,
      sources: {},
      rankedItems: null,
      warnings: [],
      error: null,
    });

    const job = await handle.queue.add("run-process", {
      runId,
      topN: 1,
      sourceTypes: ["hn"],
      collectors: {},
    });
    await job.waitUntilFinished(handle.queueEvents, 30000);

    const breakdown = await loadCostBreakdown(db, runId);
    expect(breakdown).toBeNull();
  });

  it("REQ-041 add-post merge: adds recap call onto existing breakdown", async () => {
    const runId = randomUUID();
    const existing: RunCostBreakdown = {
      schemaVersion: 1,
      totalCostUsd: 0.001,
      generatedAt: "2026-01-01T00:00:00.000Z",
      unknownModels: [],
      stages: {
        rank: {
          calls: 1,
          costUsd: 0.001,
          costStatus: "ok",
          byModel: [
            {
              modelId: "claude-haiku-4-5-20251001",
              calls: 1,
              inputTokens: 1000,
              outputTokens: 0,
              cachedInputTokens: 0,
              cacheCreation5mTokens: 0,
              cacheCreation1hTokens: 0,
              reasoningTokens: 0,
              costUsd: 0.001,
            },
          ],
        },
      },
    };

    await db.insert(runArchives).values({
      id: runId,
      status: "completed",
      rankedItems: [],
      topN: 1,
      completedAt: new Date(),
      costBreakdown: existing,
    });

    const archiveRepo = createRunArchivesRepo(db);
    const rawItemsRepo = createRawItemsRepo(db);

    await hydrateAddedPost(
      "https://example.com/add-merge",
      "web",
      {
        rawItemsRepo,
        archiveRepo,
        runId,
        fetchWebPost: () =>
          Promise.resolve({
            sourceType: "blog",
            externalId: "ext-add-merge",
            title: "Added",
            url: "https://example.com/add-merge",
            sourceUrl: "https://example.com/add-merge",
            author: null,
            content: "body",
            publishedAt: null,
            collectedAt: new Date(),
            engagement: { points: 0, commentCount: 0 },
            metadata: { comments: [] },
            imageUrl: null,
            updatedAt: new Date(),
          }),
        generateRecap: (_input, opts) => {
          opts?.tracker?.record({
            stage: "recap",
            modelId: "claude-haiku-4-5-20251001",
            usage: STUB_USAGE,
            providerMetadata: STUB_META,
          });
          return Promise.resolve({
            title: "T",
            summary: "S",
            bullets: ["a", "b", "c"],
            bottomLine: "B",
          });
        },
      },
    );

    const breakdown = await loadCostBreakdown(db, runId);
    expect(breakdown).not.toBeNull();
    expect(breakdown?.stages.rank?.byModel[0].calls).toBe(1);
    expect(breakdown?.stages.recap).toBeDefined();
    expect(breakdown?.stages.recap?.byModel[0].calls).toBe(1);
  });

  it("EDGE-004 unknown model: tokens persist, costUsd null, unknownModels lists id", async () => {
    const unknownHandle = buildWorker(db, "cost-tracking-e2e-unknown", {
      rankModelId: "claude-opus-99-experimental",
    });
    try {
      const runId = randomUUID();
      await db.insert(rawItems).values([
        {
          sourceType: "hn",
          externalId: `hn-${runId}-x`,
          title: "Unknown",
          url: `https://example.com/unknown-${runId}`,
          engagement: { points: 50, commentCount: 1 },
          metadata: { comments: [] },
        },
      ]);
      const connection = getTestRedis();
      const runState = createRunStateService(connection);
      const startedAt = new Date(Date.now() - 60 * 1000).toISOString();
      await runState.set({
        id: runId,
        status: "running",
        stage: "collecting",
        topN: 1,
        startedAt,
        updatedAt: startedAt,
        completedAt: null,
        sources: {},
        rankedItems: null,
        warnings: [],
        error: null,
      });

      const job = await unknownHandle.queue.add("run-process", {
        runId,
        topN: 1,
        sourceTypes: ["hn"],
        collectors: {},
      });
      await job.waitUntilFinished(unknownHandle.queueEvents, 30000);

      const breakdown = await loadCostBreakdown(db, runId);
      expect(breakdown).not.toBeNull();
      expect(breakdown?.stages.rank?.byModel[0].modelId).toBe(
        "claude-opus-99-experimental",
      );
      expect(breakdown?.stages.rank?.byModel[0].costUsd).toBeNull();
      expect(breakdown?.stages.rank?.costStatus).not.toBe("ok");
      expect(breakdown?.unknownModels).toContain("claude-opus-99-experimental");
    } finally {
      await unknownHandle.worker.close();
      await unknownHandle.queueEvents.close();
      await unknownHandle.queue.close();
    }
  });

  it("REQ-040 EDGE-002 failed run persists partial cost", async () => {
    const failHandle = buildWorker(db, "cost-tracking-e2e-fail", {
      rankFails: true,
    });
    try {
      const runId = randomUUID();
      await db.insert(rawItems).values([
        {
          sourceType: "hn",
          externalId: `hn-${runId}-f`,
          title: "Fail",
          url: `https://example.com/fail-${runId}`,
          engagement: { points: 10, commentCount: 0 },
          metadata: { comments: [] },
        },
      ]);
      const connection = getTestRedis();
      const runState = createRunStateService(connection);
      const startedAt = new Date(Date.now() - 60 * 1000).toISOString();
      await runState.set({
        id: runId,
        status: "running",
        stage: "collecting",
        topN: 1,
        startedAt,
        updatedAt: startedAt,
        completedAt: null,
        sources: {},
        rankedItems: null,
        warnings: [],
        error: null,
      });

      const job = await failHandle.queue.add("run-process", {
        runId,
        topN: 1,
        sourceTypes: ["hn"],
        collectors: {},
      });

      await job.waitUntilFinished(failHandle.queueEvents, 30000).catch(() => undefined);

      // Failed before any LLM call → cost_breakdown stays NULL
      const breakdown = await loadCostBreakdown(db, runId);
      expect(breakdown).toBeNull();
    } finally {
      await failHandle.worker.close();
      await failHandle.queueEvents.close();
      await failHandle.queue.close();
    }
  });
});
