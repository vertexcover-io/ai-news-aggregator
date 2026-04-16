import { randomUUID } from "node:crypto";
import type IORedis from "ioredis";
import type { Queue } from "bullmq";
import type {
  RunState,
  RunSubmitHnConfig,
  RunSubmitRedditConfig,
  RunSubmitWebConfig,
} from "./types/run.js";
import type { UserSettings } from "./types/settings.js";

const TTL_SECONDS = 3600;

export interface RunProcessJobPayload {
  runId: string;
  topN: number;
  sourceTypes: ("hn" | "reddit" | "blog")[];
  collectors: {
    hn?: RunSubmitHnConfig;
    reddit?: RunSubmitRedditConfig;
    web?: RunSubmitWebConfig;
  };
  halfLifeHours?: number;
}

export interface StartRunDeps {
  redis: IORedis;
  queue: Queue<RunProcessJobPayload>;
  now?: () => Date;
  runId?: () => string;
}

export async function startRun(
  settings: UserSettings,
  deps: StartRunDeps,
): Promise<{ runId: string }> {
  const runId = (deps.runId ?? randomUUID)();
  const nowIso = (deps.now ? deps.now() : new Date()).toISOString();

  const sources: RunState["sources"] = {};
  if (settings.hnConfig) {
    sources.hn = { status: "pending", itemsFetched: 0, errors: [] };
  }
  if (settings.redditConfig) {
    sources.reddit = { status: "pending", itemsFetched: 0, errors: [] };
  }
  if (settings.webConfig) {
    sources.blog = { status: "pending", itemsFetched: 0, errors: [] };
  }

  const initial: RunState = {
    id: runId,
    status: "running",
    stage: "queued",
    topN: settings.topN,
    startedAt: nowIso,
    updatedAt: nowIso,
    completedAt: null,
    sources,
    rankedItems: null,
    warnings: [],
    error: null,
  };

  await deps.redis.set(
    `run:${runId}`,
    JSON.stringify(initial),
    "EX",
    TTL_SECONDS,
  );

  const sourceTypes: RunProcessJobPayload["sourceTypes"] = [];
  const collectors: RunProcessJobPayload["collectors"] = {};
  if (settings.hnConfig) {
    sourceTypes.push("hn");
    collectors.hn = settings.hnConfig;
  }
  if (settings.redditConfig) {
    sourceTypes.push("reddit");
    collectors.reddit = settings.redditConfig;
  }
  if (settings.webConfig) {
    sourceTypes.push("blog");
    collectors.web = settings.webConfig;
  }

  const jobPayload: RunProcessJobPayload = {
    runId,
    topN: settings.topN,
    sourceTypes,
    collectors,
    ...(settings.halfLifeHours !== null
      ? { halfLifeHours: settings.halfLifeHours }
      : {}),
  };

  await deps.queue.add("run-process", jobPayload, { jobId: runId });

  return { runId };
}
