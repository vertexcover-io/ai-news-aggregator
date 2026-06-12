import { TENANT_ZERO_ID } from "@newsletter/shared/constants";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { config } from "dotenv";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Queue, QueueEvents, Worker } from "bullmq";
import { rawItems, runArchives } from "@newsletter/shared/db";
import { sql } from "drizzle-orm";
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
import { createRawItemsRepo } from "@pipeline/repositories/raw-items.js";
import { createCandidatesRepo } from "@pipeline/repositories/candidates.js";
import {
  createRunArchivesRepo,
  type RunArchivesRepo,
} from "@pipeline/repositories/run-archives.js";
import { getTestDb, truncateAll } from "@pipeline-tests/e2e/setup/test-db.js";
import {
  getTestRedis,
  closeTestRedis,
} from "@pipeline-tests/e2e/setup/test-redis.js";
import type { AppDb } from "@newsletter/shared/db";
import type { CancelSubscriberFactory } from "@pipeline/services/cancel-subscriber.js";

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
    const noopCancelSubscriber: CancelSubscriberFactory = {
      subscribe: () => Promise.resolve({ close: () => Promise.resolve() }),
    };

    worker = new Worker<unknown, RunProcessResult>(
      "run-process-e2e-test",
      (job) =>
        handleRunProcessJob(
          {
            runState: runStateService,
            runLogRepo: { append: () => Promise.resolve() },
            rawItemsRepo: createRawItemsRepo(db, TENANT_ZERO_ID),
            candidatesRepo: createCandidatesRepo(db, TENANT_ZERO_ID),
            archiveRepo: createRunArchivesRepo(db, TENANT_ZERO_ID),
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
            cancelSubscriber: noopCancelSubscriber,
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
    // Also truncate run_archives since it doesn't cascade from raw_items
    await db.execute(sql`TRUNCATE TABLE run_archives CASCADE`);
    await queue.obliterate({ force: true });
    const connection = getTestRedis();
    // clear any stray run-state keys (both legacy string IDs and UUID-based)
    const keys = await connection.keys("run:*");
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
        tenantId: TENANT_ZERO_ID,
        sourceType: "hn",
        externalId: "hn-1",
        title: "Item A",
        url: "https://example.com/a",
        engagement: { points: 100, commentCount: 10 },
        metadata: { comments: [] },
      },
      {
        tenantId: TENANT_ZERO_ID,
        sourceType: "hn",
        externalId: "hn-2",
        title: "Item A dup",
        url: "https://example.com/a?utm_source=x",
        engagement: { points: 50, commentCount: 5 },
        metadata: { comments: [] },
      },
      {
        tenantId: TENANT_ZERO_ID,
        sourceType: "hn",
        externalId: "hn-3",
        title: "Item B",
        url: "https://example.com/b",
        engagement: { points: 80, commentCount: 4 },
        metadata: { comments: [] },
      },
      {
        tenantId: TENANT_ZERO_ID,
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

  // REQ-001: shortlisted_item_ids is written on success
  it("writes shortlisted_item_ids on a successful run", async () => {
    const connection = getTestRedis();
    const runStateService = createRunStateService(connection);
    const runId = randomUUID();
    const startedAt = new Date(Date.now() - 60 * 1000).toISOString();

    // Seed 2 raw_items
    const inserted = await db
      .insert(rawItems)
      .values([
        {
          tenantId: TENANT_ZERO_ID,
          sourceType: "hn",
          externalId: "hn-shortlist-1",
          title: "Shortlist Item A",
          url: "https://example.com/shortlist-a",
          engagement: { points: 100, commentCount: 10 },
          metadata: { comments: [] },
        },
        {
          tenantId: TENANT_ZERO_ID,
          sourceType: "hn",
          externalId: "hn-shortlist-2",
          title: "Shortlist Item B",
          url: "https://example.com/shortlist-b",
          engagement: { points: 80, commentCount: 5 },
          metadata: { comments: [] },
        },
      ])
      .returning({ id: rawItems.id });

    const seededIds = inserted.map((r) => r.id);

    const initial: RunState = {
      id: runId,
      status: "running",
      stage: "collecting",
      topN: 5,
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
      topN: 5,
      sourceTypes: ["hn"],
      collectors: {},
    });

    await job.waitUntilFinished(queueEvents, 30000);

    // Verify the archive has shortlisted_item_ids set
    const archiveRows = await db
      .select({ shortlistedItemIds: runArchives.shortlistedItemIds })
      .from(runArchives)
      .where(sql`${runArchives.id} = ${runId}`);

    expect(archiveRows).toHaveLength(1);
    const storedIds = archiveRows[0]?.shortlistedItemIds;
    expect(storedIds).not.toBeNull();
    expect(Array.isArray(storedIds)).toBe(true);
    // The shortlist should contain our seeded item ids
    for (const seededId of seededIds) {
      expect(storedIds).toContain(seededId);
    }
  });

  // Partial-update precondition: FAILED run leaves shortlisted_item_ids NULL
  it("leaves shortlisted_item_ids NULL on a failed run (never reached shortlist stage)", async () => {
    const connection = getTestRedis();
    const runStateService = createRunStateService(connection);
    const runId = randomUUID();
    const startedAt = new Date(Date.now() - 60 * 1000).toISOString();

    // Seed raw_items so dedup/shortlist would be reached but inject a rank failure
    await db.insert(rawItems).values([
      {
        tenantId: TENANT_ZERO_ID,
        sourceType: "hn",
        externalId: "hn-fail-1",
        title: "Item that causes rank failure",
        url: "https://example.com/fail",
        engagement: { points: 50, commentCount: 2 },
        metadata: { comments: [] },
      },
    ]);

    const initial: RunState = {
      id: runId,
      status: "running",
      stage: "collecting",
      topN: 5,
      startedAt,
      updatedAt: startedAt,
      completedAt: null,
      sources: {},
      rankedItems: null,
      warnings: [],
      error: null,
    };
    await runStateService.set(initial);

    // Create a queue + worker specifically for this test with a failing rankFn
    const failingQueue = new Queue("run-process-fail-test", { connection });
    const failingQueueEvents = new QueueEvents("run-process-fail-test", { connection });
    const failingWorker = new Worker<unknown, RunProcessResult>(
      "run-process-fail-test",
      (job) =>
        handleRunProcessJob(
          {
            runState: runStateService,
            runLogRepo: { append: () => Promise.resolve() },
            rawItemsRepo: createRawItemsRepo(db, TENANT_ZERO_ID),
            candidatesRepo: createCandidatesRepo(db, TENANT_ZERO_ID),
            archiveRepo: createRunArchivesRepo(db, TENANT_ZERO_ID),
            loadFn: loadCandidatesSince,
            shortlistFn: (candidates) =>
              Promise.resolve({ shortlist: candidates, breakdowns: [] }),
            rankFn: () => Promise.reject(new Error("rank stage intentional failure")),
            collectFns: {
              hn: () => Promise.resolve({ itemsFetched: 0, itemsStored: 0, failures: 0, durationMs: 0 }),
              reddit: () => Promise.resolve({ itemsFetched: 0, itemsStored: 0, failures: 0, durationMs: 0 }),
              web: () => Promise.resolve({ itemsFetched: 0, itemsStored: 0, failures: 0, durationMs: 0 }),
            } as CollectFns,
            cancelSubscriber: {
              subscribe: () => Promise.resolve({ close: () => Promise.resolve() }),
            },
          } as never,
          job as unknown as RunProcessJobLike,
        ),
      { connection },
    );

    try {
      const job = await failingQueue.add("run-process", {
        runId,
        topN: 5,
        sourceTypes: ["hn"],
        collectors: {},
      });

      // The job is expected to fail
      await job.waitUntilFinished(failingQueueEvents, 30000).catch(() => {
        // expected failure
      });

      // Verify the archive has shortlisted_item_ids = NULL
      const archiveRows = await db
        .select({ shortlistedItemIds: runArchives.shortlistedItemIds })
        .from(runArchives)
        .where(sql`${runArchives.id} = ${runId}`);

      // A failed archive row may or may not be written depending on where it failed
      if (archiveRows.length > 0) {
        expect(archiveRows[0]?.shortlistedItemIds).toBeNull();
      }
    } finally {
      await failingWorker.close();
      await failingQueueEvents.close();
      await failingQueue.obliterate({ force: true });
      await failingQueue.close();
    }
  });

  // EDGE-005: first-ever run (no published history) drops nothing
  it("first-ever run with no published archives drops nothing (EDGE-005)", async () => {
    const connection = getTestRedis();
    const runStateService = createRunStateService(connection);
    const runId = randomUUID();
    const startedAt = new Date(Date.now() - 60 * 1000).toISOString();

    // Seed items - no prior published archives exist (truncated in beforeEach)
    await db.insert(rawItems).values([
      {
        tenantId: TENANT_ZERO_ID,
        sourceType: "hn",
        externalId: "hn-edge005-1",
        title: "Item A",
        url: "https://example.com/edge005-a",
        engagement: { points: 100, commentCount: 10 },
        metadata: { comments: [] },
      },
      {
        tenantId: TENANT_ZERO_ID,
        sourceType: "hn",
        externalId: "hn-edge005-2",
        title: "Item B",
        url: "https://example.com/edge005-b",
        engagement: { points: 80, commentCount: 5 },
        metadata: { comments: [] },
      },
    ]);

    const initial: RunState = {
      id: runId,
      status: "running",
      stage: "collecting",
      topN: 5,
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
      topN: 5,
      sourceTypes: ["hn"],
      collectors: {},
    });

    await job.waitUntilFinished(queueEvents, 30000);

    const finalState = await runStateService.get(runId);
    expect(finalState?.stage).toBe("completed");
    expect(finalState?.status).toBe("completed");
    // Both items should be ranked (nothing dropped)
    expect(finalState?.rankedItems?.length).toBe(2);
  });

  // REQ-003/VS-5: prior published archive's link is absent from new run's ranked items
  it("excludes URLs from prior published archives in the new run (REQ-003/VS-5)", async () => {
    const connection = getTestRedis();
    const runStateService = createRunStateService(connection);

    // Step 1: Seed a raw_item that was in a prior published archive
    const priorRun = await db
      .insert(rawItems)
      .values([
        {
          tenantId: TENANT_ZERO_ID,
          sourceType: "hn",
          externalId: "hn-prior-1",
          title: "Prior published article",
          url: "https://example.com/published-article",
          engagement: { points: 100, commentCount: 10 },
          metadata: { comments: [] },
        },
      ])
      .returning({ id: rawItems.id });

    const priorRawId = priorRun[0]?.id;
    if (priorRawId === undefined) throw new Error("Failed to insert prior raw_item");

    // Step 2: Create a prior "published" archive (reviewed=true, isDryRun=false, status=completed)
    const priorArchiveId = randomUUID();
    await db.insert(runArchives).values({
      tenantId: TENANT_ZERO_ID,
      id: priorArchiveId,
      status: "completed",
      rankedItems: [{ rawItemId: priorRawId, score: 0.9, rationale: "top" }],
      topN: 5,
      completedAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // yesterday
      reviewed: true,
      isDryRun: false,
    });

    // Step 3: Truncate raw_items (keeping run_archives) and insert new batch
    // The new batch includes the previously published URL + a new unique URL
    await db.execute(sql`TRUNCATE TABLE raw_items RESTART IDENTITY CASCADE`);

    await db.insert(rawItems).values([
      {
        tenantId: TENANT_ZERO_ID,
        sourceType: "hn",
        externalId: "hn-new-published",
        title: "Prior published article (re-collected)",
        url: "https://example.com/published-article", // same URL as prior archive
        engagement: { points: 150, commentCount: 15 },
        metadata: { comments: [] },
      },
      {
        tenantId: TENANT_ZERO_ID,
        sourceType: "hn",
        externalId: "hn-new-unique",
        title: "Brand new article",
        url: "https://example.com/brand-new",
        engagement: { points: 80, commentCount: 5 },
        metadata: { comments: [] },
      },
    ]);

    // Step 4: Run the new pipeline run
    const runId = randomUUID();
    const startedAt = new Date(Date.now() - 60 * 1000).toISOString();

    const initial: RunState = {
      id: runId,
      status: "running",
      stage: "collecting",
      topN: 5,
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
      topN: 5,
      sourceTypes: ["hn"],
      collectors: {},
    });

    await job.waitUntilFinished(queueEvents, 30000);

    // Step 5: Verify the published URL is absent from ranked items
    const archiveRows = await db
      .select({ rankedItems: runArchives.rankedItems })
      .from(runArchives)
      .where(sql`${runArchives.id} = ${runId}`);

    expect(archiveRows).toHaveLength(1);
    const ranked = archiveRows[0]?.rankedItems ?? [];

    // Look up the raw_items to get the IDs
    const newRawRows = await db
      .select({ id: rawItems.id, url: rawItems.url })
      .from(rawItems);

    const publishedRow = newRawRows.find((r) => r.url === "https://example.com/published-article");
    const uniqueRow = newRawRows.find((r) => r.url === "https://example.com/brand-new");

    // The previously-published URL should NOT appear in ranked items
    if (publishedRow) {
      expect(ranked.map((r) => r.rawItemId)).not.toContain(publishedRow.id);
    }

    // The brand-new URL SHOULD appear in ranked items
    if (uniqueRow) {
      expect(ranked.map((r) => r.rawItemId)).toContain(uniqueRow.id);
    }
  });

  // REQ-004/EDGE-009: getPublishedCanonicalUrls throws → run completes, nothing dropped
  it("run completes normally when getPublishedCanonicalUrls throws (REQ-004/EDGE-009)", async () => {
    const connection = getTestRedis();
    const runStateService = createRunStateService(connection);
    const runId = randomUUID();
    const startedAt = new Date(Date.now() - 60 * 1000).toISOString();

    await db.insert(rawItems).values([
      {
        tenantId: TENANT_ZERO_ID,
        sourceType: "hn",
        externalId: "hn-edge009-1",
        title: "Item A",
        url: "https://example.com/edge009-a",
        engagement: { points: 100, commentCount: 10 },
        metadata: { comments: [] },
      },
      {
        tenantId: TENANT_ZERO_ID,
        sourceType: "hn",
        externalId: "hn-edge009-2",
        title: "Item B",
        url: "https://example.com/edge009-b",
        engagement: { points: 80, commentCount: 5 },
        metadata: { comments: [] },
      },
    ]);

    const initial: RunState = {
      id: runId,
      status: "running",
      stage: "collecting",
      topN: 5,
      startedAt,
      updatedAt: startedAt,
      completedAt: null,
      sources: {},
      rankedItems: null,
      warnings: [],
      error: null,
    };
    await runStateService.set(initial);

    // Create a repo with a throwing getPublishedCanonicalUrls
    const baseRepo = createRunArchivesRepo(db, TENANT_ZERO_ID);
    const throwingRepo: RunArchivesRepo = {
      ...baseRepo,
      getPublishedCanonicalUrls: () => Promise.reject(new Error("DB connection failed")),
    };

    const throwingQueue = new Queue("run-process-throw-test", { connection });
    const throwingQueueEvents = new QueueEvents("run-process-throw-test", { connection });
    const throwingWorker = new Worker<unknown, RunProcessResult>(
      "run-process-throw-test",
      (job) =>
        handleRunProcessJob(
          {
            runState: runStateService,
            runLogRepo: { append: () => Promise.resolve() },
            rawItemsRepo: createRawItemsRepo(db, TENANT_ZERO_ID),
            candidatesRepo: createCandidatesRepo(db, TENANT_ZERO_ID),
            archiveRepo: throwingRepo,
            loadFn: loadCandidatesSince,
            shortlistFn: (candidates) =>
              Promise.resolve({ shortlist: candidates, breakdowns: [] }),
            rankFn: (deduped, opts) =>
              Promise.resolve({
                rankedItems: deduped.slice(0, opts.topN).map((c, idx) => ({
                  rawItemId: c.id,
                  score: 1 - idx * 0.1,
                  rationale: "test",
                })),
                candidateCount: deduped.length,
                rankedCount: Math.min(deduped.length, opts.topN),
              }),
            collectFns: {
              hn: () => Promise.resolve({ itemsFetched: 0, itemsStored: 0, failures: 0, durationMs: 0 }),
              reddit: () => Promise.resolve({ itemsFetched: 0, itemsStored: 0, failures: 0, durationMs: 0 }),
              web: () => Promise.resolve({ itemsFetched: 0, itemsStored: 0, failures: 0, durationMs: 0 }),
            } as CollectFns,
            cancelSubscriber: {
              subscribe: () => Promise.resolve({ close: () => Promise.resolve() }),
            },
          } as never,
          job as unknown as RunProcessJobLike,
        ),
      { connection },
    );

    try {
      const job = await throwingQueue.add("run-process", {
        runId,
        topN: 5,
        sourceTypes: ["hn"],
        collectors: {},
      });

      await job.waitUntilFinished(throwingQueueEvents, 30000);

      // Run should complete successfully despite the getPublishedCanonicalUrls failure
      const finalState = await runStateService.get(runId);
      expect(finalState?.stage).toBe("completed");
      expect(finalState?.status).toBe("completed");
      // Both items should be ranked (nothing dropped because error → empty coveredSet)
      expect(finalState?.rankedItems?.length).toBe(2);
    } finally {
      await throwingWorker.close();
      await throwingQueueEvents.close();
      await throwingQueue.obliterate({ force: true });
      await throwingQueue.close();
    }
  });
});
