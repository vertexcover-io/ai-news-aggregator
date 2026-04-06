import { Worker } from "bullmq";
import { getDb, createRedisConnection } from "@newsletter/shared/db";
import { collectHn } from "@pipeline/collectors/hn.js";
import { collectReddit } from "@pipeline/collectors/reddit.js";
import { createRawItemsRepo } from "@pipeline/repositories/raw-items.js";
import type { CollectorResult } from "@newsletter/shared/types";
import type { HnCollectJobData, RedditCollectJobData } from "@pipeline/types.js";

const STALLED_INTERVAL_MS = 30_000;
const MAX_STALLED_COUNT = 2;

export type CollectionJobLike =
  | { name: "hn-collect"; data: HnCollectJobData }
  | { name: "reddit-collect"; data: RedditCollectJobData };

export async function handleCollectionJob(job: CollectionJobLike): Promise<CollectorResult> {
  const db = getDb();
  const rawItemsRepo = createRawItemsRepo(db);

  switch (job.name) {
    case "hn-collect":
      return collectHn({ rawItemsRepo }, job.data.config);
    case "reddit-collect":
      return collectReddit({ rawItemsRepo }, job.data.config);
    default: {
      // Unreachable at compile time; guards against runtime unknown job names
      const unknownName = (job as { name: string }).name;
      throw new Error(`Unknown collector: ${unknownName}`);
    }
  }
}

export const collectionWorker = new Worker(
  "collection",
  handleCollectionJob,
  {
    connection: createRedisConnection(),
    stalledInterval: STALLED_INTERVAL_MS,
    maxStalledCount: MAX_STALLED_COUNT,
  },
);
