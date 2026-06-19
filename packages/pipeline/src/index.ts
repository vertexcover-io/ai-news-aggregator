import { config } from "dotenv";
config({ path: "../../.env" });
import { Configuration } from "crawlee";
import { assertChromiumInstalled } from "@pipeline/lib/boot.js";
import type { Job } from "bullmq";
import type { CollectionJobLike } from "@pipeline/workers/collection.js";
import { collectionWorker } from "@pipeline/workers/collection.js";
import { createProcessingWorker } from "@pipeline/workers/processing.js";
import { createCollectorHealthWorker } from "@pipeline/workers/collector-health.js";
import { createLogger } from "@newsletter/shared/logger";
import { createRedisConnection } from "@newsletter/shared/redis";
import { createRunStateService } from "@pipeline/services/run-state.js";
import { captureException, shutdownPostHog } from "@pipeline/lib/posthog.js";
import { handleWorkerFailure } from "@pipeline/lib/worker-failure.js";
import { createFatalHandler } from "@pipeline/lib/crash-handlers.js";

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

// Single-tenant bridge (pre-P9): resolve the AGENTLOOP/default tenant scope
// BEFORE worker default deps are built, so every tenant-owned write
// (raw_items, run_archives, run_logs, email_sends, …) stamps a concrete
// tenant_id — the column is NOT NULL with no DB DEFAULT.
const { primeDefaultTenantScope } = await import(
  "@pipeline/repositories/default-tenant.js"
);
const { getDb } = await import("@newsletter/shared");
const primedTenantScope = await primeDefaultTenantScope(getDb());
if (!primedTenantScope) {
  logger.warn(
    "no default tenant found — tenant-owned writes will fail until a tenant exists",
  );
}

const processingConnection = createRedisConnection();
const runState = createRunStateService(processingConnection);
const processingWorker = createProcessingWorker({ connection: processingConnection });

const collectorHealthConnection = createRedisConnection();
const collectorHealthWorker = createCollectorHealthWorker({ connection: collectorHealthConnection });

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
  await shutdownPostHog(); // REQ-015: flush PostHog on graceful shutdown
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

// REQ-009: capture fatal crashes then flush before exit
process.on("uncaughtException", (err) => void createFatalHandler("uncaughtException")(err));
process.on("unhandledRejection", (err) => void createFatalHandler("unhandledRejection")(err));

collectionWorker.on("ready", () => {
  logger.info({ queue: "collection" }, "worker ready");
});

collectionWorker.on("completed", (job: Job<CollectionJobData>) => {
  logger.info({ jobId: job.id, jobName: job.name, result: job.returnvalue as unknown }, "job completed");
});

collectionWorker.on("failed", (job: Job<CollectionJobData> | undefined, err: Error) => {
  logger.error({ jobId: job?.id, jobName: job?.name, error: err.message }, "job failed");
  handleWorkerFailure("collection", job, err, captureException);
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
  handleWorkerFailure("processing", job, err, captureException);
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
  handleWorkerFailure("collector-health", job, err, captureException);
});
