import { Worker } from "bullmq";
import { createRedisConnection } from "@newsletter/shared/redis";
import { getDb } from "@newsletter/shared";
import { createLogger } from "@newsletter/shared/logger";
import type { CollectorResult } from "@newsletter/shared";
import { collectHn } from "@pipeline/collectors/hn.js";
import { collectReddit } from "@pipeline/collectors/reddit.js";
import { collectWeb } from "@pipeline/collectors/web.js";
import {
  createRawItemsRepo,
  type RawItemsRepo,
} from "@pipeline/repositories/raw-items.js";
import { resolveJobTenantScope } from "@pipeline/repositories/default-tenant.js";
import {
  createRunStateService,
  type RunSourceType,
  type RunStateService,
} from "@pipeline/services/run-state.js";
import type {
  HnCollectConfig,
  RedditCollectConfig,
  WebCollectConfig,
} from "@pipeline/types.js";

const STALLED_INTERVAL_MS = 30_000; // 30-second BullMQ stalled job check interval

export interface CollectionJobLike {
  name: string;
  data: {
    runId?: string;
    config: HnCollectConfig | RedditCollectConfig | WebCollectConfig;
    /** Originating tenant (P9, REQ-060); legacy jobs fall back to the bridge. */
    tenantId?: string;
  };
}

export interface CollectionWorkerDeps {
  rawItemsRepo: RawItemsRepo;
  runState: RunStateService;
}

const logger = createLogger("worker:collection");

let sharedRunState: RunStateService | null = null;

/**
 * Per-job deps (P9, REQ-064): the raw_items repo is scoped to the job's
 * tenant (`data.tenantId`); legacy jobs without one fall back to the default
 * (AGENTLOOP) bridge — tenant_id is NOT NULL with no DB DEFAULT, so a write
 * is never unscoped. The run-state service is connection-bound and shared.
 */
async function buildJobDeps(
  data: CollectionJobLike["data"],
): Promise<CollectionWorkerDeps> {
  const db = getDb();
  const scope = await resolveJobTenantScope(db, data);
  sharedRunState ??= createRunStateService(createRedisConnection());
  return {
    rawItemsRepo: createRawItemsRepo(db, scope),
    runState: sharedRunState,
  };
}

function jobNameToSourceType(name: string): RunSourceType {
  switch (name) {
    case "hn-collect":
      return "hn";
    case "reddit-collect":
      return "reddit";
    case "web-collect":
      return "blog";
    default:
      throw new Error(`Unknown collector: ${name}`);
  }
}

async function dispatchCollector(
  deps: CollectionWorkerDeps,
  job: CollectionJobLike,
): Promise<CollectorResult> {
  switch (job.name) {
    case "hn-collect": {
      return collectHn(
        { rawItemsRepo: deps.rawItemsRepo },
        job.data.config as HnCollectConfig,
      );
    }
    case "reddit-collect": {
      return collectReddit(
        { rawItemsRepo: deps.rawItemsRepo },
        job.data.config as RedditCollectConfig,
      );
    }
    case "web-collect": {
      return collectWeb(
        { rawItemsRepo: deps.rawItemsRepo },
        job.data.config as WebCollectConfig,
      );
    }
    default:
      throw new Error(`Unknown collector: ${job.name}`);
  }
}

export async function handleCollectionJob(
  job: CollectionJobLike,
  deps?: CollectionWorkerDeps,
): Promise<CollectorResult> {
  deps ??= await buildJobDeps(job.data);
  const runId = job.data.runId;
  const startedAt = Date.now();

  let sourceType: RunSourceType | null = null;
  if (runId) {
    sourceType = jobNameToSourceType(job.name);
    await deps.runState.updateSource(runId, sourceType, { status: "running" });
    await deps.runState.setStage(runId, "collecting");
  }

  try {
    const result = await dispatchCollector(deps, job);
    if (runId && sourceType) {
      await deps.runState.updateSource(runId, sourceType, {
        status: "completed",
        itemsFetched: result.itemsStored,
      });
      logger.info(
        {
          event: "run.source.completed",
          runId,
          sourceType,
          itemsFetched: result.itemsStored,
          durationMs: Date.now() - startedAt,
        },
        "run.source.completed",
      );
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (runId && sourceType) {
      await deps.runState.updateSource(runId, sourceType, {
        status: "failed",
        errors: [message],
      });
      logger.error(
        {
          event: "run.source.failed",
          runId,
          sourceType,
          error: message,
        },
        "run.source.failed",
      );
    }
    throw err;
  }
}

export const collectionWorker = new Worker(
  "collection",
  (job) => handleCollectionJob(job as CollectionJobLike),
  {
    connection: createRedisConnection(),
    stalledInterval: STALLED_INTERVAL_MS,
    maxStalledCount: 2,
  },
);
