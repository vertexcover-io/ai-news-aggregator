import { Worker, type Job } from "bullmq";
import { getDb, createRedisConnection } from "@newsletter/shared/db";
import { collectHn } from "@pipeline/collectors/hn.js";
import { collectReddit } from "@pipeline/collectors/reddit.js";
import { createRawItemsRepo } from "@pipeline/repositories/raw-items.js";
import type { CollectorResult } from "@newsletter/shared/types";
import type { HnCollectConfig, RedditCollectConfig } from "@pipeline/types.js";

export interface CollectionJobLike {
  name: string;
  data: { sourceId?: number | null; config: HnCollectConfig | RedditCollectConfig };
}

export async function handleCollectionJob(job: CollectionJobLike): Promise<CollectorResult> {
  switch (job.name) {
    case "hn-collect": {
      const db = getDb();
      const rawItemsRepo = createRawItemsRepo(db);
      return collectHn({ rawItemsRepo }, job.data.sourceId ?? null, job.data.config);
    }
    case "reddit-collect": {
      const db = getDb();
      const rawItemsRepo = createRawItemsRepo(db);
      return collectReddit({ rawItemsRepo }, job.data.sourceId ?? null, job.data.config as RedditCollectConfig);
    }
    default:
      throw new Error(`Unknown collector: ${job.name}`);
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
