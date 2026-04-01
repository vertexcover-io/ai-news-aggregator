import { collectionWorker } from "./workers/collection.js";

console.log("Pipeline workers starting...");

const shutdown = async (): Promise<void> => {
  console.log("Shutting down workers...");
  await collectionWorker.close();
  console.log("Workers shut down");
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

collectionWorker.on("ready", () => {
  console.log("Collection worker ready");
});

collectionWorker.on("completed", (job) => {
  console.log(`Job ${job.id} completed`);
});

collectionWorker.on("failed", (job, err) => {
  console.log(`Job ${job?.id} failed: ${err.message}`);
});
