import { randomUUID } from "node:crypto";
import type IORedis from "ioredis";
import type { Queue } from "bullmq";
import type { RunCollectorsPayload, RunState } from "./types/run.js";
import type { UserSettings } from "./types/settings.js";

const TTL_SECONDS = 3600;

export interface RunProcessJobPayload {
  runId: string;
  topN: number;
  sourceTypes: ("hn" | "reddit" | "blog" | "twitter" | "web_search")[];
  collectors: RunCollectorsPayload;
  halfLifeHours?: number;
  dryRun?: boolean;
  /**
   * Originating tenant (REQ-060, P9). Optional in the TYPE only for
   * backward compatibility with in-flight jobs enqueued before P9 — every
   * live enqueue site supplies it; workers fall back to the default-tenant
   * bridge when absent.
   */
  tenantId?: string;
}

export interface StartRunDeps {
  redis: IORedis;
  queue: Queue<RunProcessJobPayload>;
  now?: () => Date;
  runId?: () => string;
}

export interface StartRunOptions {
  dryRun?: boolean;
  /** Stamped onto the job payload (REQ-060). */
  tenantId?: string;
  /**
   * Collection set derived from the tenant's enabled `sources` ROWS
   * (REQ-073). When provided it replaces the legacy `user_settings` JSONB
   * configs entirely; settings still supply topN/halfLifeHours/prompts.
   */
  collectors?: RunCollectorsPayload;
}

export async function startRun(
  settings: UserSettings,
  deps: StartRunDeps,
  opts?: StartRunOptions,
): Promise<{ runId: string }> {
  const runId = (deps.runId ?? randomUUID)();
  const nowIso = (deps.now ? deps.now() : new Date()).toISOString();
  const override = opts?.collectors;
  const hnConfig = override
    ? (override.hn ?? null)
    : settings.hnEnabled
      ? settings.hnConfig
      : null;
  const redditConfig = override
    ? (override.reddit ?? null)
    : settings.redditEnabled
      ? settings.redditConfig
      : null;
  const webConfig = override
    ? (override.web ?? null)
    : settings.webEnabled
      ? settings.webConfig
      : null;
  const twitterConfig = override
    ? (override.twitter ?? null)
    : settings.twitterEnabled
      ? settings.twitterConfig
      : null;
  const webSearchConfig = override
    ? (override.webSearch ?? null)
    : settings.webSearchEnabled && settings.webSearchConfig
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
    ...(opts?.tenantId !== undefined ? { tenantId: opts.tenantId } : {}),
  };

  await deps.queue.add("run-process", jobPayload, { jobId: runId });

  return { runId };
}
