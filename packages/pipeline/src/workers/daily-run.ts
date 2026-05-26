import { Queue, Worker } from "bullmq";
import type IORedis from "ioredis";
import { getDb } from "@newsletter/shared";
import { createRedisConnection } from "@newsletter/shared/redis";
import { createLogger } from "@newsletter/shared/logger";
import { startRun } from "@newsletter/shared";
import type { RunProcessJobPayload, UserSettings } from "@newsletter/shared";
import {
  createUserSettingsRepo,
  type UserSettingsRepo,
} from "@pipeline/repositories/user-settings.js";

const logger = createLogger("worker:daily-run");

export interface DailyRunJobLike {
  name: string;
  id?: string;
  data: Record<string, unknown>;
}

function sourcesEnabled(settings: UserSettings): boolean {
  return (
    (settings.hnEnabled && settings.hnConfig !== null) ||
    (settings.redditEnabled && settings.redditConfig !== null) ||
    (settings.webEnabled && settings.webConfig !== null) ||
    (settings.twitterEnabled && settings.twitterConfig !== null) ||
    (settings.webSearchEnabled && settings.webSearchConfig !== null)
  );
}

export interface DailyRunDeps {
  redis: IORedis;
  queue: Queue<RunProcessJobPayload>;
  userSettingsRepo: UserSettingsRepo;
}

export async function handleDailyRunJob(
  deps: DailyRunDeps,
  job: DailyRunJobLike,
): Promise<void> {
  if (job.name !== "daily-run" && job.name !== "pipeline-run") return;

  const settings = await deps.userSettingsRepo.get();
  if (!settings) {
    logger.warn(
      { event: "daily-run.skipped", reason: "no-settings", jobId: job.id },
      "daily-run skipped: no-settings",
    );
    return;
  }
  if (!sourcesEnabled(settings)) {
    logger.warn(
      { event: "daily-run.skipped", reason: "no-sources", jobId: job.id },
      "daily-run skipped: no-sources",
    );
    return;
  }

  const { runId } = await startRun(settings, {
    redis: deps.redis,
    queue: deps.queue,
  });
  logger.info(
    { event: "daily-run.started", jobId: job.id, runId },
    "daily-run started",
  );
}

export interface CreateDailyRunWorkerOptions {
  connection?: IORedis;
  redis?: IORedis;
  queue?: Queue<RunProcessJobPayload>;
  userSettingsRepo?: UserSettingsRepo;
}

export function createDailyRunWorker(
  options: CreateDailyRunWorkerOptions = {},
): Worker {
  const connection = options.connection ?? options.redis ?? createRedisConnection();
  const redis = options.redis ?? connection;
  const queue =
    options.queue ?? new Queue<RunProcessJobPayload>("processing", { connection });
  const userSettingsRepo =
    options.userSettingsRepo ?? createUserSettingsRepo(getDb());

  const deps: DailyRunDeps = { redis, queue, userSettingsRepo };

  return new Worker(
    "processing",
    (job) => handleDailyRunJob(deps, job as DailyRunJobLike),
    { connection },
  );
}
