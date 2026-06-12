import { TENANT_ZERO_ID } from "@newsletter/shared/constants";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Queue, Worker, type Job } from "bullmq";
import { sources, userSettings } from "@newsletter/shared/db";
import {
  reconcilePipelineSchedule,
  schedulerKeyFor,
} from "../../../../../api/src/services/scheduler.js";
import { handleDailyRunJob, type DailyRunJobLike } from "@pipeline/workers/daily-run.js";
import { createUserSettingsRepo } from "@pipeline/repositories/user-settings.js";
import { createSourcesRepo } from "@pipeline/repositories/sources.js";
import { getTestDb } from "@pipeline-tests/e2e/setup/test-db.js";
import { closeTestRedis, getTestRedis } from "@pipeline-tests/e2e/setup/test-redis.js";
import type { AppDb } from "@newsletter/shared/db";
import type { RunProcessJobPayload, UserSettings } from "@newsletter/shared";

config({ path: resolve(import.meta.dirname, "../../../../../../.env.test") });

const POLL_INTERVAL_MS = 100;

// Legacy pre-Phase-6 global key: still exercised below to prove in-flight
// legacy "daily-run" jobs (no tenantId) keep working against tenant 0.
const LEGACY_DAILY_RUN_KEY = "daily-run:default";
const PIPELINE_RUN_KEY = schedulerKeyFor("pipeline-run", TENANT_ZERO_ID);
const SOCIAL_HEALTH_KEY = schedulerKeyFor("social-health", TENANT_ZERO_ID);

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

async function seedSources(db: AppDb): Promise<void> {
  await db.insert(sources).values([
    {
      tenantId: TENANT_ZERO_ID,
      type: "hn",
      config: { sinceDays: 1, count: 1, feeds: ["newest"], commentsPerItem: 0 },
      enabled: true,
    },
    // REQ-073: disabled rows must not reach the run payload.
    {
      tenantId: TENANT_ZERO_ID,
      type: "reddit",
      config: { subreddit: "MachineLearning", sinceDays: 1 },
      enabled: false,
    },
  ]);
}

async function seedUserSettings(db: AppDb): Promise<void> {
  await seedSources(db);
  await db.insert(userSettings).values({
    tenantId: TENANT_ZERO_ID,
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

describe("daily-run worker scheduler e2e", () => {
  let db: AppDb;
  let dailyQueue: Queue;
  let runQueue: Queue<RunProcessJobPayload>;
  let worker: Worker<unknown, void>;
  let queueName: string;
  let runQueueName: string;
  let createdRunIds: readonly string[];

  beforeAll(() => {
    db = getTestDb();
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
            userSettingsRepo: createUserSettingsRepo(db, TENANT_ZERO_ID),
            sourcesRepo: createSourcesRepo(db, TENANT_ZERO_ID),
            tenantId: TENANT_ZERO_ID,
            startJitterMs: 0,
          },
          { name: job.name, id: job.id, data: {} } satisfies DailyRunJobLike,
        ),
      { connection },
    );
    await db.delete(userSettings);
    await db.delete(sources);
  });

  afterEach(async () => {
    await worker.close();
    await dailyQueue.removeJobScheduler(LEGACY_DAILY_RUN_KEY);
    await dailyQueue.removeJobScheduler(PIPELINE_RUN_KEY);
    await dailyQueue.removeJobScheduler(SOCIAL_HEALTH_KEY);
    await dailyQueue.obliterate({ force: true });
    await runQueue.obliterate({ force: true });
    await dailyQueue.close();
    await runQueue.close();
    await removeRunStateKeys(createdRunIds);
    await db.delete(userSettings);
    await db.delete(sources);
  });

  afterAll(async () => {
    await closeTestRedis();
  });

  it("REQ-WK-5 handles a scheduled daily-run job within 5 seconds and enqueues one run-process job", async () => {
    await seedUserSettings(db);
    await dailyQueue.upsertJobScheduler(
      LEGACY_DAILY_RUN_KEY,
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
      PIPELINE_RUN_KEY,
      { every: 1000 },
      { name: "pipeline-run", data: { tenantId: TENANT_ZERO_ID } },
    );

    const payload = await waitForRunProcessJob(runQueue, 5000);
    createdRunIds = [payload.runId];
    const jobs = await runQueue.getJobs(["waiting", "delayed", "paused"]);

    expect(jobs.filter((job) => job.name === "run-process")).toHaveLength(1);
    expect(payload.sourceTypes).toEqual(["hn"]);
    // REQ-060: every run-process payload carries the originating tenant.
    expect(payload.tenantId).toBe(TENANT_ZERO_ID);
  });

  it("REQ-WK-6 removes the tenant's pipeline scheduler when scheduling is disabled", async () => {
    await dailyQueue.upsertJobScheduler(
      PIPELINE_RUN_KEY,
      { every: 1000 },
      { name: "pipeline-run", data: { tenantId: TENANT_ZERO_ID } },
    );

    await reconcilePipelineSchedule(dailyQueue, TENANT_ZERO_ID, makeScheduleSettings(false));

    const schedulers = await dailyQueue.getJobSchedulers();
    expect(schedulers).toEqual([]);
  });
});
