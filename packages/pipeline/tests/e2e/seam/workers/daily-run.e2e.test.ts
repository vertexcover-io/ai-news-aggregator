import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Queue, Worker, type Job } from "bullmq";
import { userSettings } from "@newsletter/shared/db";
import {
  DAILY_RUN_SCHEDULER_KEY,
  PIPELINE_RUN_SCHEDULER_KEY,
  SOCIAL_HEALTH_SCHEDULER_KEY,
  reconcileDailyRunSchedule,
} from "../../../../../api/src/services/scheduler.js";
import { handleDailyRunJob, type DailyRunJobLike } from "@pipeline/workers/daily-run.js";
import { createUserSettingsRepo } from "@pipeline/repositories/user-settings.js";
import { createSourcesRepo } from "@pipeline/repositories/sources.js";
import { getTestDb } from "@pipeline-tests/e2e/setup/test-db.js";
import { ensurePipelineTenant } from "@pipeline-tests/e2e/setup/tenant.js";
import type { TenantContext } from "@newsletter/shared/types/tenant-context";
import { closeTestRedis, getTestRedis } from "@pipeline-tests/e2e/setup/test-redis.js";
import type { AppDb } from "@newsletter/shared/db";
import type { RunProcessJobPayload, UserSettings } from "@newsletter/shared";

config({ path: resolve(import.meta.dirname, "../../../../../../.env.test") });

const POLL_INTERVAL_MS = 100;

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

async function waitForRunProcessJob(
  queue: Queue<RunProcessJobPayload>,
  timeoutMs: number,
): Promise<RunProcessJobPayload> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const jobs = await queue.getJobs(["waiting", "delayed", "paused"]);
    const runProcessJob = jobs.find((job) => job.name === "run-process");
    if (runProcessJob !== undefined) {
      return runProcessJob.data;
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`run-process job was not enqueued within ${timeoutMs}ms`);
}

async function removeRunStateKeys(runIds: readonly string[]): Promise<void> {
  if (runIds.length === 0) return;
  const redis = getTestRedis();
  await redis.del(...runIds.map((runId) => `run:${runId}`));
}

function makeScheduleSettings(enabled: boolean): UserSettings {
  return {
    id: randomUUID(),
    topN: 1,
    halfLifeHours: null,
    hnEnabled: true,
    hnConfig: {
      sinceDays: 1,
      count: 1,
      feeds: ["newest"],
      commentsPerItem: 0,
    },
    redditEnabled: false,
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
    scheduleTime: "00:00",
    pipelineTime: "00:00",
    emailTime: "09:00",
    linkedinTime: "09:30",
    twitterTime: "10:00",
    scheduleTimezone: "UTC",
    scheduleEnabled: enabled,
    emailEnabled: false,
    linkedinEnabled: false,
    twitterPostEnabled: false,
    autoReview: false,
    rankingPrompt: "test ranking prompt",
    shortlistPrompt: "test shortlist prompt {{N}}",
    shortlistSize: 30,
    updatedAt: new Date("2026-05-21T00:00:00.000Z").toISOString(),
  };
}

async function seedUserSettings(db: AppDb): Promise<void> {
  await db.insert(userSettings).values({
    tenantId: tenant.tenantId,
    topN: 1,
    halfLifeHours: null,
    hnEnabled: true,
    hnConfig: {
      sinceDays: 1,
      count: 1,
      feeds: ["newest"],
      commentsPerItem: 0,
    },
    redditEnabled: false,
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
    pipelineTime: "00:00",
    emailTime: "09:00",
    linkedinTime: "09:30",
    twitterTime: "10:00",
    scheduleTimezone: "UTC",
    scheduleEnabled: true,
    emailEnabled: false,
    linkedinEnabled: false,
    twitterPostEnabled: false,
    autoReview: false,
    rankingPrompt: "test ranking prompt",
    shortlistPrompt: "test shortlist prompt {{N}}",
    shortlistSize: 30,
  });
}

// tenant_id is NOT NULL on user_settings — seeds + repo stamp this tenant
let tenant: TenantContext;

describe("daily-run worker scheduler e2e", () => {
  let db: AppDb;
  let dailyQueue: Queue;
  let runQueue: Queue<RunProcessJobPayload>;
  let worker: Worker<unknown, void>;
  let queueName: string;
  let runQueueName: string;
  let createdRunIds: readonly string[];

  beforeAll(async () => {
    db = getTestDb();
    tenant = await ensurePipelineTenant();
  });

  beforeEach(async () => {
    queueName = `daily-run-e2e-${randomUUID()}`;
    runQueueName = `run-process-e2e-${randomUUID()}`;
    createdRunIds = [];
    const connection = getTestRedis();
    dailyQueue = new Queue(queueName, { connection });
    runQueue = new Queue<RunProcessJobPayload>(runQueueName, { connection });
    worker = new Worker<unknown, void>(
      queueName,
      (job: Job<unknown, void>) =>
        handleDailyRunJob(
          {
            redis: connection,
            queue: runQueue,
            getUserSettingsRepo: () => createUserSettingsRepo(db, tenant),
          },
          { name: job.name, id: job.id, data: {} } satisfies DailyRunJobLike,
        ),
      { connection },
    );
    await db.delete(userSettings);
  });

  afterEach(async () => {
    await worker.close();
    await dailyQueue.removeJobScheduler(DAILY_RUN_SCHEDULER_KEY);
    await dailyQueue.removeJobScheduler(PIPELINE_RUN_SCHEDULER_KEY);
    await dailyQueue.removeJobScheduler(SOCIAL_HEALTH_SCHEDULER_KEY);
    await dailyQueue.obliterate({ force: true });
    await runQueue.obliterate({ force: true });
    await dailyQueue.close();
    await runQueue.close();
    await removeRunStateKeys(createdRunIds);
    await db.delete(userSettings);
  });

  afterAll(async () => {
    await closeTestRedis();
  });

  it("REQ-WK-5 handles a scheduled daily-run job within 5 seconds and enqueues one run-process job", async () => {
    await seedUserSettings(db);
    await dailyQueue.upsertJobScheduler(
      DAILY_RUN_SCHEDULER_KEY,
      { every: 1000 },
      { name: "daily-run", data: {} },
    );

    const payload = await waitForRunProcessJob(runQueue, 5000);
    createdRunIds = [payload.runId];
    const jobs = await runQueue.getJobs(["waiting", "delayed", "paused"]);

    expect(jobs.filter((job) => job.name === "run-process")).toHaveLength(1);
    expect(payload.sourceTypes).toEqual(["hn"]);
    expect(payload.collectors.hn).toEqual({
      sinceDays: 1,
      count: 1,
      feeds: ["newest"],
      commentsPerItem: 0,
    });
  });

  it("handles a scheduled pipeline-run job and enqueues one run-process job", async () => {
    await seedUserSettings(db);
    await dailyQueue.upsertJobScheduler(
      PIPELINE_RUN_SCHEDULER_KEY,
      { every: 1000 },
      { name: "pipeline-run", data: {} },
    );

    const payload = await waitForRunProcessJob(runQueue, 5000);
    createdRunIds = [payload.runId];
    const jobs = await runQueue.getJobs(["waiting", "delayed", "paused"]);

    expect(jobs.filter((job) => job.name === "run-process")).toHaveLength(1);
    expect(payload.sourceTypes).toEqual(["hn"]);
  });

  // ── P9: per-tenant job scope ──────────────────────────────────────────
  // Two tenants with different settings + sources rows; the worker must load
  // the ORIGINATING tenant's config from job.data.tenantId (REQ-061) and
  // collect from that tenant's ENABLED sources ROWS, not user_settings JSONB
  // and not another tenant's rows (REQ-073). REQ-060: the enqueued
  // run-process payload carries the tenant id.
  describe("per-tenant job scope (P9)", () => {
    const P9_MARKER = "pipeline-daily-run-p9";
    let tenantAId: string;
    let tenantBId: string;

    async function seedP9Tenants(): Promise<void> {
      const { tenants, sources } = await import("@newsletter/shared/db");
      const { sql } = await import("drizzle-orm");
      await db.execute(
        sql.raw(
          `DELETE FROM sources WHERE tenant_id IN (SELECT id FROM tenants WHERE slug LIKE '${P9_MARKER}%')`,
        ),
      );
      await db.execute(
        sql.raw(`DELETE FROM tenants WHERE slug LIKE '${P9_MARKER}%'`),
      );
      const rows = await db
        .insert(tenants)
        .values([
          { slug: `${P9_MARKER}-a`, name: "P9 Tenant A", status: "active" },
          { slug: `${P9_MARKER}-b`, name: "P9 Tenant B", status: "active" },
        ])
        .returning({ id: tenants.id });
      tenantAId = rows[0].id;
      tenantBId = rows[1].id;

      // user_settings: A topN 7 (JSONB says hn — rows must win), B topN 13
      await db.insert(userSettings).values([
        {
          ...settingsSeed(tenantAId),
          topN: 7,
          hnEnabled: true,
          hnConfig: { sinceDays: 1, count: 1 },
        },
        { ...settingsSeed(tenantBId), topN: 13 },
      ]);

      // sources rows: A = enabled r/AAA + DISABLED r/ZZZ; B = enabled r/BBB
      await db.insert(sources).values([
        {
          tenantId: tenantAId,
          type: "reddit",
          config: { kind: "reddit", subreddit: "AAA", sinceDays: 1 },
          enabled: true,
        },
        {
          tenantId: tenantAId,
          type: "reddit",
          config: { kind: "reddit", subreddit: "ZZZ", sinceDays: 1 },
          enabled: false,
        },
        {
          tenantId: tenantBId,
          type: "reddit",
          config: { kind: "reddit", subreddit: "BBB", sinceDays: 1 },
          enabled: true,
        },
      ]);
    }

    function settingsSeed(
      tenantId: string,
    ): typeof userSettings.$inferInsert {
      return {
        tenantId,
        topN: 5,
        halfLifeHours: null,
        hnEnabled: false,
        hnConfig: null,
        redditEnabled: false,
        redditConfig: null,
        webEnabled: false,
        webConfig: null,
        twitterEnabled: false,
        twitterConfig: null,
        webSearchEnabled: false,
        webSearchConfig: null,
        posthogEnabled: false,
        pipelineTime: "00:00",
        emailTime: "09:00",
        linkedinTime: "09:30",
        twitterTime: "10:00",
        scheduleTimezone: "UTC",
        scheduleEnabled: true,
        emailEnabled: false,
        linkedinEnabled: false,
        twitterPostEnabled: false,
        autoReview: false,
        rankingPrompt: "p9 ranking prompt",
        shortlistPrompt: "p9 shortlist prompt {{N}}",
        shortlistSize: 30,
      };
    }

    interface CapturedAdd {
      name: string;
      payload: RunProcessJobPayload;
    }

    function makeCapturingDeps(): {
      deps: Parameters<typeof handleDailyRunJob>[0];
      added: CapturedAdd[];
      runIds: string[];
    } {
      const added: CapturedAdd[] = [];
      const runIds: string[] = [];
      const fakeQueue = {
        add: (name: string, payload: RunProcessJobPayload) => {
          added.push({ name, payload });
          runIds.push(payload.runId);
          return Promise.resolve({ id: payload.runId });
        },
      };
      const deps = {
        redis: getTestRedis(),
        queue: fakeQueue as never,
        getUserSettingsRepo: (ctx?: TenantContext) =>
          createUserSettingsRepo(db, ctx),
        getSourcesRepo: (ctx?: TenantContext) => createSourcesRepo(db, ctx),
      };
      return { deps, added, runIds };
    }

    it("test_REQ_061_worker_loads_tenant_settings", async () => {
      await seedP9Tenants();
      const { deps, added, runIds } = makeCapturingDeps();

      await handleDailyRunJob(deps, {
        name: "pipeline-run",
        id: "p9-req061",
        data: { tenantId: tenantAId },
      });

      try {
        expect(added).toHaveLength(1);
        const payload = added[0].payload;
        // settings come from tenant A's row, not B's and not the singleton
        expect(payload.topN).toBe(7);
        // REQ-060: payload carries the originating tenant
        expect(payload.tenantId).toBe(tenantAId);
      } finally {
        await removeRunStateKeys(runIds);
      }
    });

    it("test_REQ_073_pipeline_uses_enabled_tenant_sources", async () => {
      await seedP9Tenants();
      const { deps, added, runIds } = makeCapturingDeps();

      await handleDailyRunJob(deps, {
        name: "pipeline-run",
        id: "p9-req073-a",
        data: { tenantId: tenantAId },
      });
      await handleDailyRunJob(deps, {
        name: "pipeline-run",
        id: "p9-req073-b",
        data: { tenantId: tenantBId },
      });

      try {
        expect(added).toHaveLength(2);
        const [a, b] = added;
        // A collects ONLY its enabled rows: r/AAA (not disabled ZZZ, not B's BBB)
        expect(a.payload.collectors.reddit?.subreddits).toEqual(["AAA"]);
        // rows replace the JSONB configs entirely — A's hnConfig must NOT leak in
        expect(a.payload.collectors.hn).toBeUndefined();
        expect(a.payload.sourceTypes).toEqual(["reddit"]);
        // B collects only its own enabled row
        expect(b.payload.collectors.reddit?.subreddits).toEqual(["BBB"]);
        expect(b.payload.tenantId).toBe(tenantBId);
      } finally {
        await removeRunStateKeys(runIds);
      }
    });
  });

  it("REQ-WK-6 removes the daily-run scheduler when scheduling is disabled", async () => {
    await dailyQueue.upsertJobScheduler(
      DAILY_RUN_SCHEDULER_KEY,
      { every: 1000 },
      { name: "daily-run", data: {} },
    );

    await reconcileDailyRunSchedule(dailyQueue, makeScheduleSettings(false));

    const schedulers = await dailyQueue.getJobSchedulers();
    expect(schedulers).toEqual([]);
  });
});
