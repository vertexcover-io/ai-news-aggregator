import { config } from "dotenv";
config({ path: "../../.env" });
import type { Job } from "bullmq";
import type { CollectionJobLike } from "@pipeline/workers/collection.js";
import { collectionWorker } from "@pipeline/workers/collection.js";
import { createProcessingWorker } from "@pipeline/workers/processing.js";
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

if (!process.env.VOYAGE_API_KEY) {
  throw new Error("VOYAGE_API_KEY is required for personalized ranking");
}

const processingWorker = createProcessingWorker();

const shutdown = async (): Promise<void> => {
  logger.info({ queue: "collection" }, "worker shutting down");
  await collectionWorker.close();
  logger.info({ queue: "collection" }, "worker shut down");
  logger.info({ queue: "processing" }, "worker shutting down");
  await processingWorker.close();
  logger.info({ queue: "processing" }, "worker shut down");
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

collectionWorker.on("ready", () => {
  logger.info({ queue: "collection" }, "worker ready");
});

collectionWorker.on("completed", (job: Job<CollectionJobData>) => {
  logger.info({ jobId: job.id, jobName: job.name, result: job.returnvalue as unknown }, "job completed");
});

collectionWorker.on("failed", (job: Job<CollectionJobData> | undefined, err: Error) => {
  logger.error({ jobId: job?.id, jobName: job?.name, error: err.message }, "job failed");
});

processingWorker.on("ready", () => {
  logger.info({ queue: "processing" }, "worker ready");
});

processingWorker.on("completed", (job: Job) => {
  logger.info(
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- BullMQ types returnvalue as any
    { jobId: job.id, jobName: job.name, result: job.returnvalue },
    "job completed",
  );
});

processingWorker.on("failed", (job: Job | undefined, err: Error) => {
  logger.error(
    { jobId: job?.id, jobName: job?.name, error: err.message },
    "job failed",
  );
});
