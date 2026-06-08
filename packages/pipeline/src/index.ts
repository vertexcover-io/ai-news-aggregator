import { config } from "dotenv";
config({ path: "../../.env" });
import { Configuration } from "crawlee";
import { assertChromiumInstalled } from "@pipeline/lib/boot.js";
import type { Job } from "bullmq";
import type { CollectionJobLike } from "@pipeline/workers/collection.js";
import { collectionWorker } from "@pipeline/workers/collection.js";
import { createProcessingWorker } from "@pipeline/workers/processing.js";
import { createCollectorHealthWorker } from "@pipeline/workers/collector-health.js";
import {
  createAlertDeliveryWorker,
  scheduleAlertDeliverySweep,
} from "@pipeline/workers/alert-delivery.js";
import { createLogger } from "@newsletter/shared/logger";
import { createRedisConnection } from "@newsletter/shared/redis";
import { createRunStateService } from "@pipeline/services/run-state.js";
import { createPipelineAlertDispatcher } from "@pipeline/services/alerting.js";

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

// ── Alert dispatcher (shared across crash handler + failed listeners) ────────

const alertDispatcher = createPipelineAlertDispatcher();

// ── REQ-001/002: Process-level crash handlers ────────────────────────────────

function handleProcessCrash(err: unknown, label: string): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.fatal({ event: `process.${label}`, error: message }, `process ${label} — exiting`);

  void Promise.race([
    alertDispatcher.capture({
      severity: "critical",
      category: "worker_crash",
      title: `Worker crash: ${label}`,
      message,
      context: { label },
    }),
    // REQ-002: bounded timeout — exit regardless within 2s
    new Promise<void>((resolve) => setTimeout(resolve, 2000)),
  ]).finally(() => process.exit(1));
}

process.on("uncaughtException", (err) => { handleProcessCrash(err, "uncaughtException"); });
process.on("unhandledRejection", (reason) => { handleProcessCrash(reason, "unhandledRejection"); });

// ── Workers ──────────────────────────────────────────────────────────────────

const processingConnection = createRedisConnection();
const runState = createRunStateService(processingConnection);
const processingWorker = createProcessingWorker({ connection: processingConnection });

const collectorHealthConnection = createRedisConnection();
const collectorHealthWorker = createCollectorHealthWorker({ connection: collectorHealthConnection });

const alertDeliveryConnection = createRedisConnection();
const alertDeliveryWorker = createAlertDeliveryWorker({ connection: alertDeliveryConnection });

// Schedule the repeatable sweep job (best-effort — startup can continue if this fails)
const alertSchedulerConnection = createRedisConnection();
scheduleAlertDeliverySweep(alertSchedulerConnection).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  logger.error({ event: "alert.sweep.schedule_failed", error: msg }, "failed to schedule alert sweep");
});

// ── Shutdown ─────────────────────────────────────────────────────────────────

const shutdown = async (): Promise<void> => {
  logger.info({ queue: "collection" }, "worker shutting down");
  await collectionWorker.close();
  logger.info({ queue: "collection" }, "worker shut down");
  logger.info({ queue: "processing" }, "worker shutting down");
  await processingWorker.close();
  logger.info({ queue: "processing" }, "worker shut down");
  logger.info({ queue: "collector-health" }, "worker shutting down");
  await collectorHealthWorker.close();
  logger.info({ queue: "collector-health" }, "worker shut down");
  logger.info({ queue: "alert-delivery" }, "worker shutting down");
  await alertDeliveryWorker.close();
  logger.info({ queue: "alert-delivery" }, "worker shut down");
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

// ── Worker event listeners ────────────────────────────────────────────────────

collectionWorker.on("ready", () => {
  logger.info({ queue: "collection" }, "worker ready");
});

collectionWorker.on("completed", (job: Job<CollectionJobData>) => {
  logger.info({ jobId: job.id, jobName: job.name, result: job.returnvalue as unknown }, "job completed");
});

collectionWorker.on("failed", (job: Job<CollectionJobData> | undefined, err: Error) => {
  logger.error({ jobId: job?.id, jobName: job?.name, error: err.message }, "job failed");
  // REQ-003: capture job_failed incident only when retries exhausted
  if (job !== undefined && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    void alertDispatcher.capture({
      severity: "error",
      category: "job_failed",
      title: `Job failed: ${job.name}`,
      message: err.message,
      source: "collection",
      context: { queue: "collection", jobName: job.name, reason: err.message },
    }).catch(() => {
      // NF1: capture must never throw
    });
  }
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
  // REQ-003: capture job_failed incident only when retries exhausted
  if (job !== undefined && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    void alertDispatcher.capture({
      severity: "error",
      category: "job_failed",
      title: `Job failed: ${job.name}`,
      message: err.message,
      source: "processing",
      context: { queue: "processing", jobName: job.name, reason: err.message },
    }).catch(() => {
      // NF1: capture must never throw
    });
  }
});

processingWorker.on("stalled", (jobId: string) => {
  logger.warn({ jobId }, "processing job stalled — BullMQ will retry");
});

collectorHealthWorker.on("ready", () => {
  logger.info({ queue: "collector-health" }, "worker ready");
});

collectorHealthWorker.on("completed", (job: Job) => {
  logger.info(
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- BullMQ types returnvalue as any
    { jobId: job.id, jobName: job.name, result: job.returnvalue },
    "job completed",
  );
});

collectorHealthWorker.on("failed", (job: Job | undefined, err: Error) => {
  logger.error(
    { jobId: job?.id, jobName: job?.name, error: err.message },
    "job failed",
  );
  // REQ-003: capture job_failed incident only when retries exhausted
  if (job !== undefined && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    void alertDispatcher.capture({
      severity: "error",
      category: "job_failed",
      title: `Job failed: ${job.name}`,
      message: err.message,
      source: "collector-health",
      context: { queue: "collector-health", jobName: job.name, reason: err.message },
    }).catch(() => {
      // NF1: capture must never throw
    });
  }
});

alertDeliveryWorker.on("ready", () => {
  logger.info({ queue: "alert-delivery" }, "worker ready");
});

alertDeliveryWorker.on("completed", (job: Job) => {
  logger.info(
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- BullMQ types returnvalue as any
    { jobId: job.id, jobName: job.name, result: job.returnvalue },
    "alert delivery job completed",
  );
});

alertDeliveryWorker.on("failed", (job: Job | undefined, err: Error) => {
  logger.error(
    { jobId: job?.id, jobName: job?.name, error: err.message },
    "alert delivery job failed",
  );
});
