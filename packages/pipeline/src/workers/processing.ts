import { Queue, Worker } from "bullmq";
import type IORedis from "ioredis";
import type { Job } from "bullmq";
import { getDb } from "@newsletter/shared";
import { createRedisConnection } from "@newsletter/shared/redis";
import { createLogger } from "@newsletter/shared/logger";
import type { RunProcessJobPayload } from "@newsletter/shared";
import {
  handleRunProcessJob,
  type RunProcessDeps,
  type RunProcessJobData,
  type RunProcessJobLike,
  type RunProcessResult,
  type CollectFns,
} from "@pipeline/workers/run-process.js";
import { createCancelSubscriber } from "@pipeline/services/cancel-subscriber.js";
import {
  handleDailyRunJob,
  type DailyRunDeps,
  type DailyRunJobLike,
} from "@pipeline/workers/daily-run.js";
import {
  createRunStateService,
  type RunStateService,
} from "@pipeline/services/run-state.js";
import {
  createRawItemsRepo,
  type RawItemsRepo,
} from "@pipeline/repositories/raw-items.js";
import {
  createCandidatesRepo,
  type CandidatesRepo,
} from "@pipeline/repositories/candidates.js";
import {
  createRunArchivesRepo,
  type RunArchivesRepo,
} from "@pipeline/repositories/run-archives.js";
import {
  createUserSettingsRepo,
  type UserSettingsRepo,
} from "@pipeline/repositories/user-settings.js";
import {
  loadCandidatesSince,
  type LoadCandidatesFn,
} from "@pipeline/services/candidate-loader.js";
import { collectHn } from "@pipeline/collectors/hn.js";
import { collectReddit } from "@pipeline/collectors/reddit.js";
import { collectWeb } from "@pipeline/collectors/web.js";
import { rankCandidates } from "@pipeline/processors/rank.js";
import { shortlistCandidates } from "@pipeline/processors/shortlist.js";

const logger = createLogger("worker:processing");

export interface CreateProcessingWorkerOptions {
  connection?: IORedis;
  runProcessDeps?: RunProcessDeps;
  dailyRunDeps?: DailyRunDeps;
}

// Discriminated by job.name; payload shape is heterogeneous between routes.
type ProcessingJobData = Record<string, unknown>;

function isRunProcessJobData(data: unknown): data is RunProcessJobData {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.runId === "string" &&
    typeof d.topN === "number" &&
    Array.isArray(d.sourceTypes) &&
    typeof d.collectors === "object" &&
    d.collectors !== null
  );
}

export function createProcessingWorker(
  options: CreateProcessingWorkerOptions = {},
): Worker<ProcessingJobData, unknown> {
  const connection = options.connection ?? createRedisConnection();

  const runProcessDeps =
    options.runProcessDeps ?? buildDefaultRunProcessDeps(connection);
  const dailyRunDeps =
    options.dailyRunDeps ?? buildDefaultDailyRunDeps(connection);

  return new Worker<ProcessingJobData, unknown>(
    "processing",
    async (job: Job<ProcessingJobData, unknown>) => {
      switch (job.name) {
        case "run-process": {
          if (!isRunProcessJobData(job.data)) {
            logger.error(
              { event: "processing.invalid_job_data", jobId: job.id },
              "processing.invalid_job_data",
            );
            return undefined;
          }
          const typed: RunProcessJobLike = {
            name: job.name,
            id: job.id,
            data: job.data,
          };
          return handleRunProcessJob(runProcessDeps, typed);
        }
        case "daily-run": {
          const typed: DailyRunJobLike = {
            name: job.name,
            id: job.id,
            data: job.data,
          };
          await handleDailyRunJob(dailyRunDeps, typed);
          return undefined;
        }
        default: {
          logger.warn(
            { event: "processing.unknown_job", jobId: job.id, jobName: job.name },
            "processing.unknown_job",
          );
          return undefined;
        }
      }
    },
    { connection },
  );
}

function buildDefaultRunProcessDeps(connection: IORedis): RunProcessDeps {
  const db = getDb();
  const runState: RunStateService = createRunStateService(connection);
  const rawItemsRepo: RawItemsRepo = createRawItemsRepo(db);
  const candidatesRepo: CandidatesRepo = createCandidatesRepo(db);
  const archiveRepo: RunArchivesRepo = createRunArchivesRepo(db);
  const loadFn: LoadCandidatesFn = loadCandidatesSince;
  const collectFns: CollectFns = {
    hn: collectHn,
    reddit: collectReddit,
    web: collectWeb,
  };
  return {
    runState,
    rawItemsRepo,
    candidatesRepo,
    loadFn,
    shortlistFn: (candidates, opts) => shortlistCandidates(candidates, opts),
    rankFn: (candidates, opts) => rankCandidates(candidates, opts),
    collectFns,
    archiveRepo,
    cancelSubscriber: createCancelSubscriber(connection),
  };
}

function buildDefaultDailyRunDeps(connection: IORedis): DailyRunDeps {
  const db = getDb();
  const userSettingsRepo: UserSettingsRepo = createUserSettingsRepo(db);
  const queue = new Queue<RunProcessJobPayload>("processing", { connection });
  return {
    redis: connection,
    queue,
    userSettingsRepo,
  };
}

export type { RunProcessDeps, DailyRunDeps, RunProcessResult };
