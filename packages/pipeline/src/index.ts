import { config } from "dotenv";
config({ path: "../../.env" });
import { collectionWorker } from "./workers/collection.js";
import { createLogger } from "@newsletter/shared/logger";

const logger = createLogger("pipeline");

const shutdown = async (): Promise<void> => {
  logger.info({ queue: "collection" }, "worker shutting down");
  await collectionWorker.close();
  logger.info({ queue: "collection" }, "worker shut down");
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

collectionWorker.on("ready", () => {
  logger.info({ queue: "collection" }, "worker ready");
});

collectionWorker.on("completed", (job) => {
  logger.info({ jobId: job.id, jobName: job.name, result: job.returnvalue }, "job completed");
});

collectionWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, jobName: job?.name, error: err.message }, "job failed");
});
