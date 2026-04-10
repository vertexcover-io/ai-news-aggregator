import { config } from "dotenv";
config({ path: "../../.env" });
import type { Job } from "bullmq";
import type { CollectionJobLike } from "@pipeline/workers/collection.js";
import { collectionWorker } from "@pipeline/workers/collection.js";
import {
  createRunProcessWorker,
  type RunProcessJobData,
  type RunProcessResult,
} from "@pipeline/workers/run-process.js";
import { createLogger } from "@newsletter/shared/logger";

export {
  createRunStateService,
  RUN_STATE_TTL_SECONDS,
} from "@pipeline/services/run-state.js";
export type { RunStateService } from "@pipeline/services/run-state.js";

type CollectionJobData = CollectionJobLike["data"];

const logger = createLogger("pipeline");

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is required for ranking");
}

const runProcessWorker = createRunProcessWorker();

const shutdown = async (): Promise<void> => {
  logger.info({ queue: "collection" }, "worker shutting down");
  await collectionWorker.close();
  logger.info({ queue: "collection" }, "worker shut down");
  logger.info({ queue: "processing" }, "worker shutting down");
  await runProcessWorker.close();
  logger.info({ queue: "processing" }, "worker shut down");
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

collectionWorker.on("ready", () => {
  logger.info({ queue: "collection" }, "worker ready");
});

collectionWorker.on("completed", (job: Job<CollectionJobData>) => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- BullMQ types returnvalue as any
  logger.info({ jobId: job.id, jobName: job.name, result: job.returnvalue }, "job completed");
});

collectionWorker.on("failed", (job: Job<CollectionJobData> | undefined, err: Error) => {
  logger.error({ jobId: job?.id, jobName: job?.name, error: err.message }, "job failed");
});

runProcessWorker.on("ready", () => {
  logger.info({ queue: "processing" }, "worker ready");
});

runProcessWorker.on(
  "completed",
  (job: Job<RunProcessJobData, RunProcessResult>) => {
    logger.info(
      { jobId: job.id, jobName: job.name, result: job.returnvalue },
      "job completed",
    );
  },
);

runProcessWorker.on(
  "failed",
  (job: Job<RunProcessJobData, RunProcessResult> | undefined, err: Error) => {
    logger.error(
      { jobId: job?.id, jobName: job?.name, error: err.message },
      "job failed",
    );
  },
);
