import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { config } from "dotenv";
import { resolve } from "node:path";
import { Queue, QueueEvents, Worker } from "bullmq";
import { rawItems } from "@newsletter/shared/db";
import type { RunState } from "@newsletter/shared/types";
import {
  handleRunProcessJob,
  type CollectFns,
  type RunProcessJobLike,
  type RunProcessResult,
} from "@pipeline/workers/run-process.js";
import type { CollectorResult } from "@newsletter/shared/types";
import { loadCandidatesSince } from "@pipeline/services/candidate-loader.js";
import { createRunStateService } from "@pipeline/services/run-state.js";
import { getTestDb, truncateAll } from "@pipeline-tests/e2e/setup/test-db.js";
import {
  getTestRedis,
  closeTestRedis,
} from "@pipeline-tests/e2e/setup/test-redis.js";
import type { AppDb } from "@newsletter/shared/db";

config({ path: resolve(import.meta.dirname, "../../../../../.env.test") });

describe("run-process worker E2E", () => {
  let db: AppDb;
  let queue: Queue;
  let queueEvents: QueueEvents;
  let worker: Worker<unknown, RunProcessResult>;

  beforeAll(() => {
    db = getTestDb();
    const connection = getTestRedis();
    const runStateService = createRunStateService(connection);

    queue = new Queue("run-process-e2e-test", { connection });
    queueEvents = new QueueEvents("run-process-e2e-test", { connection });
    const noopCollect: CollectFns["hn"] = (): Promise<CollectorResult> =>
      Promise.resolve({
        itemsFetched: 0,
        itemsStored: 0,
        failures: 0,
        durationMs: 0,
      });
    const noopCollectFns: CollectFns = {
      hn: noopCollect,
      reddit: noopCollect,
      web: noopCollect,
    };
    worker = new Worker<unknown, RunProcessResult>(
      "run-process-e2e-test",
      (job) =>
        handleRunProcessJob(
          {
            runState: runStateService,
            db,
            loadFn: loadCandidatesSince,
            shortlistFn: (candidates) =>
              Promise.resolve({ shortlist: candidates, breakdowns: [] }),
            rankFn: (deduped, opts) =>
              Promise.resolve({
                rankedItems: deduped.slice(0, opts.topN).map((c, idx) => ({
                  rawItemId: c.id,
                  score: 1 - idx * 0.1,
                  rationale: "deterministic test rank",
                })),
                candidateCount: deduped.length,
                rankedCount: Math.min(deduped.length, opts.topN),
              }),
            collectFns: noopCollectFns,
          },
          job as unknown as RunProcessJobLike,
        ),
      { connection },
    );

    return async () => {
      await worker.close();
      await queueEvents.close();
      await queue.close();
      await closeTestRedis();
    };
  });

  beforeEach(async () => {
    await truncateAll();
    await queue.obliterate({ force: true });
    const connection = getTestRedis();
    // clear any stray run-state keys
    const keys = await connection.keys("run:run-process-e2e-*");
    if (keys.length > 0) await connection.del(...keys);
  });

  it("dedups and ranks raw_items into rankedItems on the run-state", async () => {
    const connection = getTestRedis();
    const runStateService = createRunStateService(connection);
    const runId = "run-process-e2e-1";
    const startedAt = new Date(Date.now() - 60 * 1000).toISOString();

    // seed raw_items
    await db.insert(rawItems).values([
      {
        sourceType: "hn",
        externalId: "hn-1",
        title: "Item A",
        url: "https://example.com/a",
        engagement: { points: 100, commentCount: 10 },
        metadata: { comments: [] },
      },
      {
        sourceType: "hn",
        externalId: "hn-2",
        title: "Item A dup",
        url: "https://example.com/a?utm_source=x",
        engagement: { points: 50, commentCount: 5 },
        metadata: { comments: [] },
      },
      {
        sourceType: "hn",
        externalId: "hn-3",
        title: "Item B",
        url: "https://example.com/b",
        engagement: { points: 80, commentCount: 4 },
        metadata: { comments: [] },
      },
      {
        sourceType: "reddit",
        externalId: "r-1",
        title: "Item C",
        url: "https://example.com/c",
        engagement: { points: 200, commentCount: 20 },
        metadata: { comments: [] },
      },
    ]);

    // seed run-state
    const initial: RunState = {
      id: runId,
      status: "running",
      stage: "collecting",
      topN: 3,
      startedAt,
      updatedAt: startedAt,
      completedAt: null,
      sources: {},
      rankedItems: null,
      warnings: [],
      error: null,
    };
    await runStateService.set(initial);

    const job = await queue.add("run-process", {
      runId,
      topN: 3,
      sourceTypes: ["hn", "reddit"],
      collectors: {},
    });

    await job.waitUntilFinished(queueEvents, 30000);

    const finalState = await runStateService.get(runId);
    expect(finalState).not.toBeNull();
    expect(finalState?.stage).toBe("completed");
    expect(finalState?.status).toBe("completed");
    expect(finalState?.rankedItems?.length).toBe(3);
    expect(finalState?.completedAt).not.toBeNull();
  });

  it("writes empty rankedItems with warning when no raw_items match window", async () => {
    const connection = getTestRedis();
    const runStateService = createRunStateService(connection);
    const runId = "run-process-e2e-2";
    const startedAt = new Date(Date.now() - 60 * 1000).toISOString();

    const initial: RunState = {
      id: runId,
      status: "running",
      stage: "collecting",
      topN: 3,
      startedAt,
      updatedAt: startedAt,
      completedAt: null,
      sources: {},
      rankedItems: null,
      warnings: [],
      error: null,
    };
    await runStateService.set(initial);

    const job = await queue.add("run-process", {
      runId,
      topN: 3,
      sourceTypes: ["hn", "reddit"],
      collectors: {},
    });

    await job.waitUntilFinished(queueEvents, 30000);

    const finalState = await runStateService.get(runId);
    expect(finalState?.stage).toBe("completed");
    expect(finalState?.status).toBe("completed");
    expect(finalState?.rankedItems).toEqual([]);
    expect(finalState?.warnings).toContain("no items collected");
  });
});
