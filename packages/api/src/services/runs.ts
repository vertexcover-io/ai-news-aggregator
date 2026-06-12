import type IORedis from "ioredis";
import { Queue } from "bullmq";
import { createRedisConnection, startRun } from "@newsletter/shared";
import type {
  RunCollectorsPayload,
  RunProcessJobPayload,
  RunSubmitPayload,
} from "@newsletter/shared";

export interface CreatedRun {
  runId: string;
}

let defaultQueue: Queue<RunProcessJobPayload> | null = null;

function getDefaultProcessingQueue(): Queue<RunProcessJobPayload> {
  defaultQueue ??= new Queue<RunProcessJobPayload>("processing", {
    connection: createRedisConnection(),
  });
  return defaultQueue;
}

export interface CreateRunOptions {
  halfLifeHours?: number;
  tenantId?: string;
}

export async function createRun(
  payload: RunSubmitPayload,
  redis: IORedis = createRedisConnection(),
  processingQueue: Queue<RunProcessJobPayload> = getDefaultProcessingQueue(),
  options: CreateRunOptions = {},
): Promise<CreatedRun> {
  const collectors: RunCollectorsPayload = {
    ...(payload.hn !== undefined ? { hn: payload.hn } : {}),
    ...(payload.reddit !== undefined ? { reddit: payload.reddit } : {}),
    ...(payload.web !== undefined ? { web: payload.web } : {}),
    ...(payload.twitter !== undefined ? { twitter: payload.twitter } : {}),
  };

  return startRun(
    { topN: payload.topN, halfLifeHours: options.halfLifeHours ?? null },
    collectors,
    { redis, queue: processingQueue },
    { tenantId: options.tenantId },
  );
}
