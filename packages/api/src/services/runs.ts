import { randomUUID } from "node:crypto";
import type IORedis from "ioredis";
import { Queue } from "bullmq";
import { createRedisConnection } from "@newsletter/shared";
import type {
  RunState,
  RunSubmitPayload,
  UserProfile,
} from "@newsletter/shared";

const TTL_SECONDS = 3600;

export interface CreatedRun {
  runId: string;
}

let defaultQueue: Queue | null = null;

function getDefaultProcessingQueue(): Queue {
  defaultQueue ??= new Queue("processing", {
    connection: createRedisConnection(),
  });
  return defaultQueue;
}

interface RunProcessJobPayload {
  runId: string;
  topN: number;
  sourceTypes: ("hn" | "reddit" | "blog")[];
  collectors: {
    hn?: RunSubmitPayload["hn"];
    reddit?: RunSubmitPayload["reddit"];
    web?: RunSubmitPayload["web"];
  };
  profile: UserProfile | null;
  halfLifeHours?: number;
}

export interface CreateRunOptions {
  profile?: UserProfile | null;
  halfLifeHours?: number;
}

export async function createRun(
  payload: RunSubmitPayload,
  redis: IORedis = createRedisConnection(),
  processingQueue: Queue = getDefaultProcessingQueue(),
  options: CreateRunOptions = {},
): Promise<CreatedRun> {
  const runId = randomUUID();
  const now = new Date().toISOString();
  const sources: RunState["sources"] = {};
  if (payload.hn) {
    sources.hn = { status: "pending", itemsFetched: 0, errors: [] };
  }
  if (payload.reddit) {
    sources.reddit = { status: "pending", itemsFetched: 0, errors: [] };
  }
  if (payload.web) {
    sources.blog = { status: "pending", itemsFetched: 0, errors: [] };
  }

  const initial: RunState = {
    id: runId,
    status: "running",
    stage: "queued",
    topN: payload.topN,
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    sources,
    rankedItems: null,
    warnings: [],
    error: null,
  };

  await redis.set(`run:${runId}`, JSON.stringify(initial), "EX", TTL_SECONDS);

  const sourceTypes: ("hn" | "reddit" | "blog")[] = [];
  const collectors: RunProcessJobPayload["collectors"] = {};
  if (payload.hn) {
    sourceTypes.push("hn");
    collectors.hn = payload.hn;
  }
  if (payload.reddit) {
    sourceTypes.push("reddit");
    collectors.reddit = payload.reddit;
  }
  if (payload.web) {
    sourceTypes.push("blog");
    collectors.web = payload.web;
  }

  const jobPayload: RunProcessJobPayload = {
    runId,
    topN: payload.topN,
    sourceTypes,
    collectors,
    profile: options.profile ?? null,
    ...(options.halfLifeHours !== undefined
      ? { halfLifeHours: options.halfLifeHours }
      : {}),
  };

  await processingQueue.add("run-process", jobPayload, { jobId: runId });

  return { runId };
}
