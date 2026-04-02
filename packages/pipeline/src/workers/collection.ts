import { Worker, type Job } from "bullmq";
import { getDb, createRedisConnection } from "@newsletter/shared/db";
import { collectHn } from "@pipeline/collectors/hn.js";
import { createRawItemsRepo } from "@pipeline/repositories/raw-items.js";
import type { CollectorResult, HnCollectConfig } from "@newsletter/shared/types";

export interface CollectionJobLike {
  name: string;
  data: { sourceId?: number | null; config: HnCollectConfig };
}

export async function handleCollectionJob(job: CollectionJobLike): Promise<CollectorResult> {
  switch (job.name) {
    case "hn-collect": {
      const db = getDb();
      const rawItemsRepo = createRawItemsRepo(db);
      return collectHn({ rawItemsRepo }, job.data.sourceId ?? null, job.data.config);
    }
    default:
      throw new Error(`Unknown collector: ${job.name}`);
  }
}

export const collectionWorker = new Worker(
  "collection",
  handleCollectionJob,
  { connection: createRedisConnection() },
);
