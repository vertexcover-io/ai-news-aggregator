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
import { randomUUID } from "node:crypto";
import { Queue, QueueEvents, Worker } from "bullmq";
import { eq, sql } from "drizzle-orm";
import { rawItems, runArchives, runLogs } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import { resolveScheduledPublishAt } from "@newsletter/shared/scheduling";
import type { CollectorResult, RunState, UserSettings } from "@newsletter/shared/types";
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
import { createRunArchivesRepo } from "@pipeline/repositories/run-archives.js";
import { createRunLogRepo } from "@pipeline/repositories/run-logs.js";
import { getTestDb, truncateAll } from "@pipeline-tests/e2e/setup/test-db.js";
import { ensurePipelineTenant } from "@pipeline-tests/e2e/setup/tenant.js";
import type { TenantContext } from "@newsletter/shared/types/tenant-context";
import {
  getTestRedis,
  closeTestRedis,
} from "@pipeline-tests/e2e/setup/test-redis.js";
import type { CancelSubscriberFactory } from "@pipeline/services/cancel-subscriber.js";
import type { UserSettingsRepo } from "@pipeline/repositories/user-settings.js";

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
  let tenant: TenantContext;
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
  // Mutable settings returned by the injected fake userSettingsRepo so each
  // test can drive the published_at compute (schedule timezone / times).
  let settingsImpl: UserSettings | null;

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

  beforeAll(async () => {
    db = getTestDb();
    // tenant_id is NOT NULL — all repo writes stamp the e2e tenant
    tenant = await ensurePipelineTenant();
    const connection = getTestRedis();
    const runStateService = createRunStateService(connection);
    const repo = createRawItemsRepo(db, tenant);

    rankFnImpl = defaultRankFn;
    scenario = { hnMode: "seed", redditMode: "seed" };
    settingsImpl = null;

    const fakeUserSettingsRepo: UserSettingsRepo = {
      get: () => Promise.resolve(settingsImpl),
    };

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
          tenantId: tenant.tenantId,
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
          tenantId: tenant.tenantId,
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
          tenantId: tenant.tenantId,
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
            tenantId: tenant.tenantId,
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

    const noopCancelSubscriber: CancelSubscriberFactory = {
      subscribe: () => Promise.resolve({ close: () => Promise.resolve() }),
    };

    processWorker = new Worker<RunProcessJobData, RunProcessResult>(
      PROCESS_QUEUE,
      (job) =>
        handleRunProcessJob(
          {
            runState: runStateService,
            rawItemsRepo: createRawItemsRepo(db, tenant),
            candidatesRepo: createCandidatesRepo(db, tenant),
            archiveRepo: createRunArchivesRepo(db, tenant),
            runLogRepo: createRunLogRepo(db, tenant),
            loadFn: loadCandidatesSince,
            shortlistFn: (candidates) =>
              Promise.resolve({ shortlist: candidates, breakdowns: [] }),
            rankFn: (candidates, options) => rankFnImpl(candidates, options),
            collectFns: { hn: fakeHn, reddit: fakeReddit, web: fakeWeb },
            userSettingsRepo: fakeUserSettingsRepo,
            cancelSubscriber: noopCancelSubscriber,
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
    settingsImpl = null;
    await truncateAll();
    await db.execute(sql`TRUNCATE TABLE run_archives RESTART IDENTITY CASCADE`);
    await db.execute(sql`TRUNCATE TABLE run_logs RESTART IDENTITY CASCADE`);
    // Wait for the worker to finish any in-flight job before obliterating.
    // obliterate({ force: true }) while a job is mid-`moveToFinished` triggers
    // a BullMQ lock error under the singleFork serial run — drain first.
    const drainStart = Date.now();
    for (;;) {
      const active = await processQueue.getActiveCount();
      if (active === 0) break;
      if (Date.now() - drainStart > 10000) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    await processQueue.obliterate({ force: true });
    const connection = getTestRedis();
    const keys = await connection.keys("run:run-flow-e2e-*");
    if (keys.length > 0) await connection.del(...keys);
  });

  function makeSettings(overrides: Partial<UserSettings>): UserSettings {
    return {
      id: "settings-singleton",
      topN: 3,
      halfLifeHours: null,
      hnEnabled: true,
      hnConfig: null,
      redditEnabled: true,
      redditConfig: null,
      webEnabled: false,
      webConfig: null,
      twitterEnabled: false,
      twitterConfig: null,
      webSearchEnabled: false,
      webSearchConfig: null,
      posthogEnabled: false,
      posthogProjectToken: null,
      posthogHost: null,
      scheduleTime: "23:00",
      pipelineTime: "23:00",
      emailTime: "06:00",
      linkedinTime: "07:00",
      twitterTime: "07:00",
      scheduleTimezone: "America/New_York",
      scheduleEnabled: true,
      emailEnabled: true,
      linkedinEnabled: false,
      twitterPostEnabled: false,
      autoReview: false,
      rankingPrompt: "rank",
      shortlistPrompt: "shortlist",
      shortlistSize: 30,
      updatedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  // The worker flips Redis run-state to "completed"/"failed" BEFORE it writes
  // the run_archives row, so reading the DB the instant the poll returns
  // terminal would race the upsert. Poll until the archive row exists.
  async function pollForArchiveRow(
    runId: string,
    timeoutMs: number,
  ): Promise<{ publishedAt: Date | null; completedAt: Date }> {
    const start = Date.now();
    for (;;) {
      const rows = await db
        .select({
          publishedAt: runArchives.publishedAt,
          completedAt: runArchives.completedAt,
        })
        .from(runArchives)
        .where(eq(runArchives.id, runId));
      if (rows.length > 0) {
        return {
          publishedAt: rows[0].publishedAt ?? null,
          completedAt: rows[0].completedAt,
        };
      }
      if (Date.now() - start > timeoutMs) {
        throw new Error(`timed out waiting for run_archives row id=${runId}`);
      }
      await new Promise((r) => setTimeout(r, 50));
    }
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

  // REQ-015 / REQ-010: a processed run persists run_archives.run_funnel with the
  // four counts AND writes run_logs rows for the run.
  it(
    "REQ-015/REQ-010: persists run_funnel and run_logs for a completed run",
    { timeout: 60000 },
    async () => {
      const runId = randomUUID();
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

      // run_archives.run_funnel populated with the four counts (REQ-015).
      // Collected: 3 HN + 1 reddit = 4 itemsStored; deduped: HN dup collapses
      // → 3 survivors; passthrough shortlist → 3; ranked topN=3 → 3.
      const archiveRows = await db
        .select({ runFunnel: runArchives.runFunnel, status: runArchives.status })
        .from(runArchives)
        .where(eq(runArchives.id, runId));
      expect(archiveRows).toHaveLength(1);
      expect(archiveRows[0].status).toBe("completed");
      expect(archiveRows[0].runFunnel).toEqual({
        collected: 4,
        deduped: 3,
        shortlisted: 3,
        ranked: 3,
      });

      // run_logs rows exist for the run (REQ-010) ordered by id ascending.
      const logRows = await db
        .select({
          id: runLogs.id,
          event: runLogs.event,
          level: runLogs.level,
          stage: runLogs.stage,
        })
        .from(runLogs)
        .where(eq(runLogs.runId, runId))
        .orderBy(runLogs.id);
      expect(logRows.length).toBeGreaterThan(0);
      const events = logRows.map((r) => r.event);
      expect(events).toContain("run.started");
      expect(events).toContain("source.completed");
      expect(events).toContain("stage.result");
      expect(events).toContain("enrichment.summary");
      expect(events).toContain("run.completed");
      // Three stage.result rows (dedup, shortlist, rank).
      expect(events.filter((e) => e === "stage.result")).toHaveLength(3);
      // Two source.completed rows (hn + reddit) — EDGE-006.
      expect(events.filter((e) => e === "source.completed")).toHaveLength(2);
      // Monotonically non-decreasing ids (REQ-026).
      const ids = logRows.map((r) => r.id);
      expect([...ids].sort((a, b) => a - b)).toEqual(ids);

      await connection.del(`run:${runId}`);
    },
  );

  it(
    "REQ-002: success finalize with settings present sets published_at to next-day emailTime instant",
    { timeout: 60000 },
    async () => {
      const runId = "f7c8124c-2cc3-4eee-9cec-1eb13e1c46a2";
      await seedRunState(runId, 3);
      settingsImpl = makeSettings({
        pipelineTime: "23:00",
        emailTime: "06:00",
        scheduleTimezone: "America/New_York",
      });

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

      const { publishedAt, completedAt } = await pollForArchiveRow(runId, 5000);
      expect(publishedAt).not.toBeNull();

      // The stored value must equal the helper's computed instant for the
      // archive's own completedAt.
      const expected = resolveScheduledPublishAt({
        scheduleTimezone: "America/New_York",
        pipelineTime: "23:00",
        emailTime: "06:00",
        completedAt,
      });
      expect(expected).not.toBeNull();
      expect(publishedAt?.getTime()).toBe(expected?.getTime());
    },
  );

  it(
    "REQ-003: success finalize with absent settings leaves published_at NULL",
    { timeout: 60000 },
    async () => {
      const runId = "9aa60e69-b6ea-4ede-ae0f-302b747ab14c";
      await seedRunState(runId, 3);
      settingsImpl = null;

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
      const row = await pollForArchiveRow(runId, 5000);
      expect(row.publishedAt).toBeNull();
    },
  );

  it(
    "REQ-004: success finalize with emailTime === pipelineTime leaves published_at NULL and run still completes",
    { timeout: 60000 },
    async () => {
      const runId = "36cab5ce-128e-4928-8ae3-83d0f628d501";
      await seedRunState(runId, 3);
      settingsImpl = makeSettings({
        pipelineTime: "06:00",
        emailTime: "06:00",
        scheduleTimezone: "America/New_York",
      });

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
      const row = await pollForArchiveRow(runId, 5000);
      expect(row.publishedAt).toBeNull();
    },
  );

  it(
    "REQ-005: failed run leaves published_at NULL",
    { timeout: 60000 },
    async () => {
      const runId = "c599e0cc-95b6-44b8-ba17-c81b6e7f274a";
      await seedRunState(runId, 3);
      scenario = { hnMode: "fail", redditMode: "fail" };
      // Even with valid schedule settings, the failed path must not set it.
      settingsImpl = makeSettings({
        pipelineTime: "23:00",
        emailTime: "06:00",
        scheduleTimezone: "America/New_York",
      });

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
      const row = await pollForArchiveRow(runId, 5000);
      expect(row.publishedAt).toBeNull();
    },
  );
});
