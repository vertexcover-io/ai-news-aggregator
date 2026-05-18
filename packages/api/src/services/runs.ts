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
    hnEnabled: payload.hn !== undefined,
    hnConfig: payload.hn ?? null,
    redditEnabled: payload.reddit !== undefined,
    redditConfig: payload.reddit ?? null,
    webEnabled: payload.web !== undefined,
    webConfig: payload.web ?? null,
    twitterEnabled: payload.twitter !== undefined,
    twitterConfig: payload.twitter ?? null,
    posthogEnabled: false,
    posthogProjectToken: null,
    posthogHost: null,
    scheduleTime: "00:00",
    pipelineTime: "00:00",
    emailTime: "00:30",
    linkedinTime: "00:30",
    twitterTime: "00:30",
    scheduleTimezone: "UTC",
    scheduleEnabled: false,
    emailEnabled: true,
    linkedinEnabled: true,
    twitterPostEnabled: true,
    autoReview: false,
    updatedAt: new Date().toISOString(),
  };

  return startRun(settings, { redis, queue: processingQueue });
}
