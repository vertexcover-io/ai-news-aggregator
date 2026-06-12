import { Queue, Worker } from "bullmq";
import type IORedis from "ioredis";
import { getDb } from "@newsletter/shared";
import { createRedisConnection } from "@newsletter/shared/redis";
import { createLogger } from "@newsletter/shared/logger";
import { computeJitterMs, parsePipelineStartJitterMs, startRun } from "@newsletter/shared";
import type { RunProcessJobPayload } from "@newsletter/shared";
import { assembleRunConfigs } from "@newsletter/shared/services/sources-assembler";
import {
  createUserSettingsRepo,
  type UserSettingsRepo,
} from "@pipeline/repositories/user-settings.js";
import {
  createSourcesRepo,
  type SourcesRepo,
} from "@pipeline/repositories/sources.js";
import { jobTenantId } from "@pipeline/lib/job-tenant.js";

const logger = createLogger("worker:daily-run");

export interface DailyRunJobLike {
  name: string;
  id?: string;
  data: Record<string, unknown>;
}

export interface DailyRunDeps {
  redis: IORedis;
  queue: Queue<RunProcessJobPayload>;
  /** Repos already scoped to the job's tenant at the worker boundary. */
  userSettingsRepo: UserSettingsRepo;
  sourcesRepo: SourcesRepo;
  /** Tenant derived once at the job boundary; propagated into the run payload. */
  tenantId: string;
  /** Jitter window (REQ-066); parsed once at worker composition. 0 disables. */
  startJitterMs: number;
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
  // REQ-073: collect from the tenant's enabled source rows only.
  const enabledSources = await deps.sourcesRepo.listEnabled();
  const collectors = assembleRunConfigs(enabledSources, settings);
  if (Object.keys(collectors).length === 0) {
    logger.warn(
      { event: "daily-run.skipped", reason: "no-sources", jobId: job.id },
      "daily-run skipped: no-sources",
    );
    return;
  }

  // REQ-066: spread starts so tenants sharing a schedule time don't all hit
  // the cap at once. The global Math.random is injected here, never inside.
  const startDelayMs = computeJitterMs(Math.random, deps.startJitterMs);
  const { runId } = await startRun(
    settings,
    collectors,
    {
      redis: deps.redis,
      queue: deps.queue,
    },
    { tenantId: deps.tenantId, startDelayMs },
  );
  logger.info(
    { event: "daily-run.started", jobId: job.id, runId, startDelayMs },
    "daily-run started",
  );
}

export interface CreateDailyRunWorkerOptions {
  connection?: IORedis;
  redis?: IORedis;
  queue?: Queue<RunProcessJobPayload>;
  userSettingsRepo?: UserSettingsRepo;
  sourcesRepo?: SourcesRepo;
  startJitterMs?: number;
}

export function createDailyRunWorker(
  options: CreateDailyRunWorkerOptions = {},
): Worker {
  const connection = options.connection ?? options.redis ?? createRedisConnection();
  const redis = options.redis ?? connection;
  const queue =
    options.queue ?? new Queue<RunProcessJobPayload>("processing", { connection });
  const startJitterMs =
    options.startJitterMs ??
    parsePipelineStartJitterMs(process.env.PIPELINE_START_JITTER_MS);

  // Deps are built per job: the tenant is only known from the job payload.
  const depsFor = (tenantId: string): DailyRunDeps => ({
    redis,
    queue,
    userSettingsRepo:
      options.userSettingsRepo ?? createUserSettingsRepo(getDb(), tenantId),
    sourcesRepo: options.sourcesRepo ?? createSourcesRepo(getDb(), tenantId),
    tenantId,
    startJitterMs,
  });

  return new Worker(
    "processing",
    (job) => handleDailyRunJob(depsFor(jobTenantId(job.data)), job as DailyRunJobLike),
    { connection },
  );
}
