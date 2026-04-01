import { Worker, type Job } from "bullmq";
import { createRedisConnection } from "@newsletter/shared/db";

export const collectionWorker = new Worker(
  "collection",
  async (job: Job) => {
    console.log(
      `Processing collection job: ${job.id} for source: ${job.data.source}`,
    );
  },
  { connection: createRedisConnection() },
);
