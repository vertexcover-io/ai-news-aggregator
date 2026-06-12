import { randomUUID } from "node:crypto";
import type IORedis from "ioredis";
import type { Queue } from "bullmq";
import type {
  RunCollectorsPayload,
  RunState,
  RunSubmitHnConfig,
  RunSubmitRedditConfig,
  RunSubmitTwitterConfig,
  RunSubmitWebConfig,
  RunSubmitWebSearchConfig,
} from "./types/run.js";
import { TENANT_ZERO_ID } from "./constants/tenant.js";

const TTL_SECONDS = 3600;

export interface RunProcessJobPayload {
  runId: string;
  /** Originating tenant. Optional for in-flight legacy jobs; absent ⇒ tenant 0. */
  tenantId?: string;
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

export interface StartRunSettings {
  topN: number;
  halfLifeHours: number | null;
}

export interface StartRunDeps {
  redis: IORedis;
  queue: Queue<RunProcessJobPayload>;
  now?: () => Date;
  runId?: () => string;
}

export async function startRun(
  settings: StartRunSettings,
  collectors: RunCollectorsPayload,
  deps: StartRunDeps,
  opts?: { dryRun?: boolean; tenantId?: string; startDelayMs?: number },
): Promise<{ runId: string }> {
  const runId = (deps.runId ?? randomUUID)();
  const nowIso = (deps.now ? deps.now() : new Date()).toISOString();

  const sources: RunState["sources"] = {};
  if (collectors.hn) {
    sources.hn = { status: "pending", itemsFetched: 0, errors: [] };
  }
  if (collectors.reddit) {
    sources.reddit = { status: "pending", itemsFetched: 0, errors: [] };
  }
  if (collectors.web) {
    sources.blog = { status: "pending", itemsFetched: 0, errors: [] };
  }
  if (collectors.twitter) {
    sources.twitter = { status: "pending", itemsFetched: 0, errors: [] };
  }
  if (collectors.webSearch) {
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
    shortlistedItemIds: null,
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
  const jobCollectors: RunProcessJobPayload["collectors"] = {};
  if (collectors.hn) {
    sourceTypes.push("hn");
    jobCollectors.hn = collectors.hn;
  }
  if (collectors.reddit) {
    sourceTypes.push("reddit");
    jobCollectors.reddit = collectors.reddit;
  }
  if (collectors.web) {
    sourceTypes.push("blog");
    jobCollectors.web = collectors.web;
  }
  if (collectors.twitter) {
    sourceTypes.push("twitter");
    jobCollectors.twitter = collectors.twitter;
  }
  if (collectors.webSearch) {
    sourceTypes.push("web_search");
    jobCollectors.webSearch = collectors.webSearch;
  }

  const jobPayload: RunProcessJobPayload = {
    runId,
    tenantId: opts?.tenantId ?? TENANT_ZERO_ID,
    topN: settings.topN,
    sourceTypes,
    collectors: jobCollectors,
    ...(settings.halfLifeHours !== null
      ? { halfLifeHours: settings.halfLifeHours }
      : {}),
    ...(opts?.dryRun === true ? { dryRun: true } : {}),
  };

  const startDelayMs = opts?.startDelayMs ?? 0;
  await deps.queue.add("run-process", jobPayload, {
    jobId: runId,
    ...(startDelayMs > 0 ? { delay: startDelayMs } : {}),
  });

  return { runId };
}
