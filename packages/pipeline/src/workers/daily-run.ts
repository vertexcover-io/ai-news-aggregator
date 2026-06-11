import { Queue, Worker } from "bullmq";
import type IORedis from "ioredis";
import { getDb } from "@newsletter/shared";
import { createRedisConnection } from "@newsletter/shared/redis";
import { createLogger } from "@newsletter/shared/logger";
import { startRun } from "@newsletter/shared";
import {
  collectorsFromSources,
  hasAnyCollector,
} from "@newsletter/shared/types";
import type { TenantContext } from "@newsletter/shared/types/tenant-context";
import {
  getDefaultTenantScope,
  jobTenantContext,
} from "@pipeline/repositories/default-tenant.js";
import type { RunProcessJobPayload, UserSettings } from "@newsletter/shared";
import type { RunCollectorsPayload } from "@newsletter/shared/types";
import {
  createUserSettingsRepo,
  type UserSettingsRepo,
} from "@pipeline/repositories/user-settings.js";
import {
  createSourcesRepo,
  type SourcesRepo,
} from "@pipeline/repositories/sources.js";

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
  /**
   * Per-job settings repo factory (P9, REQ-061): invoked with the job's
   * tenant context so the worker loads the ORIGINATING tenant's settings,
   * not the legacy singleton.
   */
  getUserSettingsRepo: (ctx?: TenantContext) => UserSettingsRepo;
  /**
   * Per-job sources repo factory (P9, REQ-073): when the tenant has any
   * `sources` rows, the run's collection set is derived from the ENABLED
   * rows and the legacy user_settings JSONB configs are ignored.
   */
  getSourcesRepo?: (ctx?: TenantContext) => SourcesRepo;
}

export async function handleDailyRunJob(
  deps: DailyRunDeps,
  job: DailyRunJobLike,
): Promise<void> {
  if (job.name !== "daily-run" && job.name !== "pipeline-run") return;

  // P9 (REQ-060/061): the job payload carries the originating tenant.
  // Legacy jobs (enqueued pre-P9 with data:{}) fall back to the default
  // AGENTLOOP bridge — the only remaining bridge use on this path.
  const ctx = jobTenantContext(job.data) ?? getDefaultTenantScope();

  const settings = await deps.getUserSettingsRepo(ctx).get();
  if (!settings) {
    logger.warn(
      { event: "daily-run.skipped", reason: "no-settings", jobId: job.id },
      "daily-run skipped: no-settings",
    );
    return;
  }

  // REQ-073: sources ROWS replace the user_settings JSONB configs entirely
  // once the tenant has any rows; tenants not yet lifted keep the JSONB path.
  let collectors: RunCollectorsPayload | undefined;
  const sourcesRepo = deps.getSourcesRepo?.(ctx);
  if (sourcesRepo && (await sourcesRepo.hasAny())) {
    const enabledRows = await sourcesRepo.listEnabled();
    collectors = collectorsFromSources(enabledRows.map((row) => row.config));
    if (!hasAnyCollector(collectors)) {
      logger.warn(
        { event: "daily-run.skipped", reason: "no-sources", jobId: job.id },
        "daily-run skipped: no-sources",
      );
      return;
    }
  } else if (!sourcesEnabled(settings)) {
    logger.warn(
      { event: "daily-run.skipped", reason: "no-sources", jobId: job.id },
      "daily-run skipped: no-sources",
    );
    return;
  }

  const { runId } = await startRun(
    settings,
    {
      redis: deps.redis,
      queue: deps.queue,
    },
    {
      ...(collectors !== undefined ? { collectors } : {}),
      ...(ctx !== undefined ? { tenantId: ctx.tenantId } : {}),
    },
  );
  logger.info(
    { event: "daily-run.started", jobId: job.id, runId, tenantId: ctx?.tenantId },
    "daily-run started",
  );
}

export interface CreateDailyRunWorkerOptions {
  connection?: IORedis;
  redis?: IORedis;
  queue?: Queue<RunProcessJobPayload>;
  /** Fixed repo override (tests); production uses the per-job factories. */
  userSettingsRepo?: UserSettingsRepo;
  getUserSettingsRepo?: (ctx?: TenantContext) => UserSettingsRepo;
  getSourcesRepo?: (ctx?: TenantContext) => SourcesRepo;
}

export function createDailyRunWorker(
  options: CreateDailyRunWorkerOptions = {},
): Worker {
  const connection = options.connection ?? options.redis ?? createRedisConnection();
  const redis = options.redis ?? connection;
  const queue =
    options.queue ?? new Queue<RunProcessJobPayload>("processing", { connection });
  const fixedSettingsRepo = options.userSettingsRepo;
  const getUserSettingsRepo =
    options.getUserSettingsRepo ??
    (fixedSettingsRepo !== undefined
      ? () => fixedSettingsRepo
      : (ctx?: TenantContext) => createUserSettingsRepo(getDb(), ctx));
  const getSourcesRepo =
    options.getSourcesRepo ??
    (fixedSettingsRepo !== undefined
      ? undefined
      : (ctx?: TenantContext) => createSourcesRepo(getDb(), ctx));

  const deps: DailyRunDeps = {
    redis,
    queue,
    getUserSettingsRepo,
    ...(getSourcesRepo !== undefined ? { getSourcesRepo } : {}),
  };

  return new Worker(
    "processing",
    (job) => handleDailyRunJob(deps, job as DailyRunJobLike),
    { connection },
  );
}
