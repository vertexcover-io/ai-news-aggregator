import { config } from "dotenv";
config({ path: "../../.env" });
import { collectionWorker } from "./workers/collection.js";

const shutdown = async (): Promise<void> => {
  console.log(JSON.stringify({ event: "worker_shutting_down", queue: "collection" }));
  await collectionWorker.close();
  console.log(JSON.stringify({ event: "worker_shut_down", queue: "collection" }));
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

collectionWorker.on("ready", () => {
  console.log(JSON.stringify({ event: "worker_ready", queue: "collection" }));
});

collectionWorker.on("completed", (job) => {
  console.log(JSON.stringify({
    event: "job_completed",
    jobId: job.id,
    jobName: job.name,
    result: job.returnvalue,
  }));
});

collectionWorker.on("failed", (job, err) => {
  console.log(JSON.stringify({
    event: "job_failed",
    jobId: job?.id,
    jobName: job?.name,
    error: err.message,
  }));
});
