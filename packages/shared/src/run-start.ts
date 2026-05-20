import { randomUUID } from "node:crypto";
import type IORedis from "ioredis";
import type { Queue } from "bullmq";
import type {
  RunState,
  RunSubmitHnConfig,
  RunSubmitRedditConfig,
  RunSubmitTwitterConfig,
  RunSubmitWebConfig,
  RunSubmitWebSearchConfig,
} from "./types/run.js";
import type { UserSettings } from "./types/settings.js";

const TTL_SECONDS = 3600;

export interface RunProcessJobPayload {
  runId: string;
  topN: number;
  sourceTypes: ("hn" | "reddit" | "blog" | "twitter" | "web_search")[];
  collectors: {
    hn?: RunSubmitHnConfig;
    reddit?: RunSubmitRedditConfig;
    web?: RunSubmitWebConfig;
    twitter?: RunSubmitTwitterConfig;
    webSearch?: RunSubmitWebSearchConfig;
  };
  halfLifeHours?: number;
  dryRun?: boolean;
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
  opts?: { dryRun?: boolean },
): Promise<{ runId: string }> {
  const runId = (deps.runId ?? randomUUID)();
  const nowIso = (deps.now ? deps.now() : new Date()).toISOString();
  const hnConfig = settings.hnEnabled ? settings.hnConfig : null;
  const redditConfig = settings.redditEnabled ? settings.redditConfig : null;
  const webConfig = settings.webEnabled ? settings.webConfig : null;
  const twitterConfig = settings.twitterEnabled ? settings.twitterConfig : null;
  const webSearchConfig =
    settings.webSearchEnabled && settings.webSearchConfig
      ? settings.webSearchConfig
      : null;

  const sources: RunState["sources"] = {};
  if (hnConfig) {
    sources.hn = { status: "pending", itemsFetched: 0, errors: [] };
  }
  if (redditConfig) {
    sources.reddit = { status: "pending", itemsFetched: 0, errors: [] };
  }
  if (webConfig) {
    sources.blog = { status: "pending", itemsFetched: 0, errors: [] };
  }
  if (twitterConfig) {
    sources.twitter = { status: "pending", itemsFetched: 0, errors: [] };
  }
  if (webSearchConfig) {
    sources.web_search = { status: "pending", itemsFetched: 0, errors: [] };
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
  if (hnConfig) {
    sourceTypes.push("hn");
    collectors.hn = hnConfig;
  }
  if (redditConfig) {
    sourceTypes.push("reddit");
    collectors.reddit = redditConfig;
  }
  if (webConfig) {
    sourceTypes.push("blog");
    collectors.web = webConfig;
  }
  if (twitterConfig) {
    sourceTypes.push("twitter");
    collectors.twitter = twitterConfig;
  }
  if (webSearchConfig) {
    sourceTypes.push("web_search");
    collectors.webSearch = webSearchConfig;
  }

  const jobPayload: RunProcessJobPayload = {
    runId,
    topN: settings.topN,
    sourceTypes,
    collectors,
    ...(settings.halfLifeHours !== null
      ? { halfLifeHours: settings.halfLifeHours }
      : {}),
    ...(opts?.dryRun === true ? { dryRun: true } : {}),
  };

  await deps.queue.add("run-process", jobPayload, { jobId: runId });

  return { runId };
}
