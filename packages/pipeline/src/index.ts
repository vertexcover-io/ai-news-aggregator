import { config } from "dotenv";
config({ path: "../../.env" });
import { Configuration } from "crawlee";
import { assertChromiumInstalled } from "@pipeline/lib/boot.js";
import { Worker, type Job } from "bullmq";
import type { NewsletterSendJobPayload } from "@newsletter/shared";
import type { CollectionJobLike } from "@pipeline/workers/collection.js";
import { collectionWorker } from "@pipeline/workers/collection.js";
import {
  createProcessingWorker,
  buildDefaultNewsletterSendDeps,
} from "@pipeline/workers/processing.js";
import { handleNewsletterSendJob } from "@pipeline/workers/newsletter-send.js";
import { createLogger } from "@newsletter/shared/logger";
import { createRedisConnection } from "@newsletter/shared/redis";
import { createRunStateService } from "@pipeline/services/run-state.js";

// REQ-09: disable on-disk Crawlee storage; never write ./storage/
Configuration.getGlobalConfig().set("persistStorage", false);

// REQ-10: verify Chromium is present before accepting any jobs
assertChromiumInstalled();

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

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET is required for issuing unsubscribe tokens");
}

export function getRunIdFromJobData(data: unknown): string | undefined {
  if (typeof data === "object" && data !== null && "runId" in data) {
    const runId = (data as Record<string, unknown>).runId;
    return typeof runId === "string" ? runId : undefined;
  }
  return undefined;
}

const processingConnection = createRedisConnection();
const runState = createRunStateService(processingConnection);
const processingWorker = createProcessingWorker({ connection: processingConnection });

const newsletterSendConnection = createRedisConnection();
let resolvedNewsletterSendDeps: ReturnType<typeof buildDefaultNewsletterSendDeps> | undefined;
const newsletterSendWorker = new Worker<NewsletterSendJobPayload, unknown>(
  "send-newsletter",
  async (job: Job<NewsletterSendJobPayload>) => {
    resolvedNewsletterSendDeps ??= buildDefaultNewsletterSendDeps();
    await handleNewsletterSendJob(resolvedNewsletterSendDeps, {
      name: job.name,
      id: job.id,
      data: job.data,
    });
    return undefined;
  },
  { connection: newsletterSendConnection },
);

const shutdown = async (): Promise<void> => {
  logger.info({ queue: "collection" }, "worker shutting down");
  await collectionWorker.close();
  logger.info({ queue: "collection" }, "worker shut down");
  logger.info({ queue: "processing" }, "worker shutting down");
  await processingWorker.close();
  logger.info({ queue: "processing" }, "worker shut down");
  logger.info({ queue: "send-newsletter" }, "worker shutting down");
  await newsletterSendWorker.close();
  logger.info({ queue: "send-newsletter" }, "worker shut down");
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
  if (job?.name === "run-process") {
    const runId = getRunIdFromJobData(job.data);
    if (runId !== undefined) {
      runState.setStage(runId, "failed", "failed").catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error({ runId, error: msg }, "failed to update run state after job failure");
      });
    }
  }
});

newsletterSendWorker.on("ready", () => {
  logger.info({ queue: "send-newsletter" }, "worker ready");
});

newsletterSendWorker.on("completed", (job: Job<NewsletterSendJobPayload>) => {
  logger.info(
    { jobId: job.id, jobName: job.name, runId: job.data.runId },
    "send-newsletter completed",
  );
});

newsletterSendWorker.on("failed", (job: Job<NewsletterSendJobPayload> | undefined, err: Error) => {
  logger.error(
    { jobId: job?.id, jobName: job?.name, runId: job?.data.runId, error: err.message },
    "send-newsletter failed",
  );
});

processingWorker.on("stalled", (jobId: string) => {
  logger.warn({ jobId }, "processing job stalled — BullMQ will retry");
});
