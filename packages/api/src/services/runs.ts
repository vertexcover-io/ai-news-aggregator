import { randomUUID } from "node:crypto";
import type IORedis from "ioredis";
import type { Queue } from "bullmq";
import {
  RUN_STATE_TTL_SECONDS,
  runKey,
} from "@newsletter/shared";
import type {
  RunState,
  RunSubmitPayload,
  SourceType,
  UserProfile,
} from "@newsletter/shared";

export interface CreatedRun {
  runId: string;
}

interface RunProcessJobPayload {
  runId: string;
  topN: number;
  sourceTypes: SourceType[];
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
  redis: IORedis,
  processingQueue: Queue,
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

  await redis.set(runKey(runId), JSON.stringify(initial), "EX", RUN_STATE_TTL_SECONDS);

  const sourceTypes: SourceType[] = [];
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
