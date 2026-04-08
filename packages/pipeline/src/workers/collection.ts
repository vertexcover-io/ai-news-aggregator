import { Worker } from "bullmq";
import { getDb, createRedisConnection } from "@newsletter/shared/db";
import { createLogger } from "@newsletter/shared/logger";
import type { CollectorResult } from "@newsletter/shared";
import { collectHn } from "@pipeline/collectors/hn.js";
import { collectReddit } from "@pipeline/collectors/reddit.js";
import { collectWeb } from "@pipeline/collectors/web.js";
import { createRawItemsRepo } from "@pipeline/repositories/raw-items.js";
import {
  createRunStateService,
  type RunSourceType,
} from "@pipeline/services/run-state.js";
import type {
  HnCollectConfig,
  RedditCollectConfig,
  WebCollectConfig,
} from "@pipeline/types.js";

export interface CollectionJobLike {
  name: string;
  data: {
    runId?: string;
    config: HnCollectConfig | RedditCollectConfig | WebCollectConfig;
  };
}

const logger = createLogger("worker:collection");
const runState = createRunStateService(createRedisConnection());

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
  job: CollectionJobLike,
): Promise<CollectorResult> {
  switch (job.name) {
    case "hn-collect": {
      const db = getDb();
      const rawItemsRepo = createRawItemsRepo(db);
      return collectHn({ rawItemsRepo }, job.data.config as HnCollectConfig);
    }
    case "reddit-collect": {
      const db = getDb();
      const rawItemsRepo = createRawItemsRepo(db);
      return collectReddit(
        { rawItemsRepo },
        job.data.config as RedditCollectConfig,
      );
    }
    case "web-collect": {
      const db = getDb();
      const rawItemsRepo = createRawItemsRepo(db);
      return collectWeb({ rawItemsRepo }, job.data.config as WebCollectConfig);
    }
    default:
      throw new Error(`Unknown collector: ${job.name}`);
  }
}

export async function handleCollectionJob(
  job: CollectionJobLike,
): Promise<CollectorResult> {
  const runId = job.data.runId;
  const startedAt = Date.now();

  let sourceType: RunSourceType | null = null;
  if (runId) {
    sourceType = jobNameToSourceType(job.name);
    await runState.updateSource(runId, sourceType, { status: "running" });
    await runState.setStage(runId, "collecting");
  }

  try {
    const result = await dispatchCollector(job);
    if (runId && sourceType) {
      await runState.updateSource(runId, sourceType, {
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
      await runState.updateSource(runId, sourceType, {
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
  handleCollectionJob,
  {
    connection: createRedisConnection(),
    stalledInterval: 30000,
    maxStalledCount: 2,
  },
);
