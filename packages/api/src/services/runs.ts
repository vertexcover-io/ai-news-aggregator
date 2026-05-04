import type IORedis from "ioredis";
import { Queue } from "bullmq";
import { createRedisConnection, startRun } from "@newsletter/shared";
import type {
  RunProcessJobPayload,
  RunSubmitPayload,
  UserSettings,
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
}

export async function createRun(
  payload: RunSubmitPayload,
  redis: IORedis = createRedisConnection(),
  processingQueue: Queue<RunProcessJobPayload> = getDefaultProcessingQueue(),
  options: CreateRunOptions = {},
): Promise<CreatedRun> {
  const settings: UserSettings = {
    id: "adhoc",
    topN: payload.topN,
    halfLifeHours: options.halfLifeHours ?? null,
    hnConfig: payload.hn ?? null,
    redditConfig: payload.reddit ?? null,
    webConfig: payload.web ?? null,
    scheduleTime: "00:00",
    scheduleTimezone: "UTC",
    scheduleEnabled: false,
    updatedAt: new Date().toISOString(),
  };

  return startRun(settings, { redis, queue: processingQueue });
}
