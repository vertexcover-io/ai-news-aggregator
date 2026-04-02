import { Worker, type Job } from "bullmq";
import { getDb, createRedisConnection } from "@newsletter/shared/db";
import { collectHn } from "../collectors/hn.js";
import { createRawItemsRepo } from "../repositories/raw-items.js";
import type { CollectorResult } from "@newsletter/shared/types";

export async function handleCollectionJob(job: Job): Promise<CollectorResult> {
  switch (job.name) {
    case "hn-collect": {
      const db = getDb();
      const rawItemsRepo = createRawItemsRepo(db);
      return collectHn({ rawItemsRepo }, job.data.sourceId ?? null, job.data.config);
    }
    default: {
      const _exhaustive: never = job.name as never;
      throw new Error(`Unknown collector: ${_exhaustive}`);
    }
  }
}

export const collectionWorker = new Worker(
  "collection",
  handleCollectionJob,
  { connection: createRedisConnection() },
);
