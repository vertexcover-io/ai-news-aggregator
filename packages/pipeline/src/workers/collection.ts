import { Worker, type Job } from "bullmq";
import { createRedisConnection, getDb } from "@newsletter/shared/db";
import { collectHn } from "../collectors/hn.js";
import type { CollectorResult } from "@newsletter/shared/types";

export async function handleCollectionJob(job: Job): Promise<CollectorResult> {
  switch (job.name) {
    case "hn-collect": {
      const db = getDb();
      return collectHn({ db }, job.data.sourceId ?? null, job.data.config);
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
