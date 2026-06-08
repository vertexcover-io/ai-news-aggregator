/**
 * Alert-delivery worker — runs the sweep of undelivered incidents.
 *
 * D-110: mirrors collector-health — own createRedisConnection, ready/completed/failed
 *        listeners, SIGTERM/SIGINT close in index.ts.
 * REQ-015/016: sweeps listUndelivered() (bounded batch, capped rows excluded by repo).
 * NF1/D-070: sweep errors never throw to the caller.
 *
 * The sweep is scheduled as a repeatable BullMQ job
 * (ALERT_DELIVERY_QUEUE_NAME / ALERT_DELIVERY_SCHEDULER_KEY).
 */
import { Worker, Queue } from "bullmq";
import type IORedis from "ioredis";
import type { Job } from "bullmq";
import { createRedisConnection } from "@newsletter/shared/redis";
import { createLogger } from "@newsletter/shared/logger";
import {
  ALERT_DELIVERY_QUEUE_NAME,
  ALERT_SWEEP_INTERVAL_MS,
} from "@newsletter/shared/constants";
import { ALERT_DELIVERY_SCHEDULER_KEY } from "@newsletter/shared/scheduling";
import type { AlertChannel, IncidentRepository, Incident } from "@newsletter/shared/alerting";
import { createSlackAlertChannel } from "@newsletter/shared/alerting";
import { createIncidentRepo } from "@pipeline/repositories/incidents.js";
import { getDb } from "@newsletter/shared";

const SWEEP_JOB_NAME = "alert-sweep";

export interface SweepDeps {
  channel: AlertChannel;
  repo: IncidentRepository;
}

/**
 * Run a single sweep of undelivered incidents (REQ-015/016).
 *
 * For each undelivered incident in the bounded batch:
 *   - call channel.send(incident)
 *   - on success → repo.markDelivered (EDGE-006: guarded WHERE IS NULL)
 *   - on failure / throw → repo.incrementDeliveryAttempts (REQ-014)
 *
 * NF1: never throws — one incident failure must not abort others.
 */
export async function runAlertDeliverySweep(deps: SweepDeps): Promise<void> {
  const { channel, repo } = deps;

  if (!channel.enabled) return;

  let incidents: Incident[];
  try {
    incidents = await repo.listUndelivered();
  } catch {
    // Best-effort: if listUndelivered fails, skip this sweep cycle
    return;
  }

  // Process each incident independently (one failure must not block others)
  await Promise.allSettled(
    incidents.map(async (incident) => {
      try {
        const ok = await channel.send(incident);
        if (ok) {
          await repo.markDelivered(incident.id, new Date());
        } else {
          await repo.incrementDeliveryAttempts(incident.id);
        }
      } catch {
        // Best-effort per-incident: try to increment attempts
        try {
          await repo.incrementDeliveryAttempts(incident.id);
        } catch {
          // completely silent — best-effort
        }
      }
    }),
  );
}

export interface CreateAlertDeliveryWorkerOptions {
  connection?: IORedis;
  deps?: Partial<SweepDeps> & {
    logger?: {
      info(fields: Record<string, unknown>, msg: string): void;
      error(fields: Record<string, unknown>, msg: string): void;
    };
  };
}

export function createAlertDeliveryWorker(
  options: CreateAlertDeliveryWorkerOptions = {},
): Worker {
  const connection = options.connection ?? createRedisConnection();
  const logger = options.deps?.logger ?? createLogger("worker:alert-delivery");
  const repo = options.deps?.repo ?? createIncidentRepo(getDb());
  const channel = options.deps?.channel ?? createSlackAlertChannel({
    webhookUrl: process.env.SLACK_WEBHOOK_URL,
    publicBaseUrl: process.env.PUBLIC_BASE_URL,
  });

  return new Worker(
    ALERT_DELIVERY_QUEUE_NAME,
    async (_job: Job) => {
      logger.info({ event: "alert.sweep.start" }, "alert delivery sweep started");
      await runAlertDeliverySweep({ channel, repo });
      logger.info({ event: "alert.sweep.done" }, "alert delivery sweep done");
      return undefined;
    },
    { connection },
  );
}

/**
 * Ensure the repeatable sweep job is scheduled.
 * Called once at startup from index.ts.
 */
export async function scheduleAlertDeliverySweep(connection: IORedis): Promise<void> {
  const queue = new Queue(ALERT_DELIVERY_QUEUE_NAME, { connection });
  try {
    await queue.upsertJobScheduler(
      ALERT_DELIVERY_SCHEDULER_KEY,
      { every: ALERT_SWEEP_INTERVAL_MS },
      { name: SWEEP_JOB_NAME, data: {} },
    );
  } finally {
    await queue.close();
  }
}
