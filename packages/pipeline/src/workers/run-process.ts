import { Worker } from "bullmq";
import type IORedis from "ioredis";
import { createRedisConnection } from "@newsletter/shared/redis";
import { getDb } from "@newsletter/shared";
import {
  DEFAULT_RANKING_PROMPT,
  DEFAULT_SHORTLIST_PROMPT,
} from "@newsletter/shared/constants";
import type { SlackNotifier } from "@newsletter/shared";
import type { AppDb, SourceType } from "@newsletter/shared/db";
import { createLogger } from "@newsletter/shared/logger";
import { canonicalizeUrl, dedupCandidates } from "@pipeline/processors/dedup.js";
import {
  createCandidatesRepo,
  type CandidatesRepo,
} from "@pipeline/repositories/candidates.js";
import {
  rankCandidates,
  type RankResult,
  type RankOptions,
} from "@pipeline/processors/rank.js";
import {
  shortlistCandidates,
  type ShortlistOptions,
  type ShortlistResult,
} from "@pipeline/processors/shortlist.js";
import {
  createRunStateService,
  type RunStateService,
} from "@pipeline/services/run-state.js";
import {
  loadCandidatesSince,
  type LoadCandidatesFn,
  type Candidate,
} from "@pipeline/services/candidate-loader.js";
import { collectHn } from "@pipeline/collectors/hn.js";
import { collectReddit } from "@pipeline/collectors/reddit.js";
import { collectWeb } from "@pipeline/collectors/web.js";
import { collectTwitter } from "@pipeline/collectors/twitter/index.js";
import { collectWebSearch } from "@pipeline/collectors/web-search/index.js";
import type { WebSearchProvider } from "@pipeline/collectors/web-search/providers/index.js";
import type { ErrorAlerter } from "@pipeline/services/error-alerts.js";
import type { NotificationEmailSender } from "@pipeline/services/notification-email.js";
import type { TenantNotificationChannels } from "@pipeline/services/tenant-notify.js";
import { createRettiwtClient } from "@pipeline/collectors/twitter/clients/rettiwt.js";
import { refreshRettiwtCsrfToken } from "@pipeline/collectors/twitter/clients/rettiwt-auth.js";
import type { TwitterClient } from "@pipeline/collectors/twitter/types.js";
import { Rettiwt } from "rettiwt-api";
import { createAppCredentialsRepo } from "@pipeline/repositories/app-credentials.js";
import { resolveTwitterCollectorCookie } from "@pipeline/services/credential-resolver.js";
import { getCredentialCipher } from "@newsletter/shared/services/credential-cipher";
import { createRawItemsRepo } from "@pipeline/repositories/raw-items.js";
import {
  createRunArchivesRepo,
  type RunArchivesRepo,
} from "@pipeline/repositories/run-archives.js";
import type { UserSettingsRepo } from "@pipeline/repositories/user-settings.js";
import type {
  HnCollectConfig,
  RedditCollectConfig,
  TwitterCollectConfig,
  WebCollectConfig,
} from "@pipeline/types.js";
import type { RunSubmitWebSearchConfig } from "@newsletter/shared/types";
import type { CollectorResult } from "@newsletter/shared";
import { CancelledError } from "@pipeline/lib/cancelled-error.js";
import {
  createCancelSubscriber,
  type CancelSubscriberFactory,
} from "@pipeline/services/cancel-subscriber.js";
import {
  buildSourceTelemetry,
  type CollectorOutcome,
  type CollectorSourceType,
} from "@pipeline/services/source-telemetry.js";
import {
  createEnrichmentCache,
  newCounters,
  toEnrichmentTelemetry,
} from "@pipeline/services/link-enrichment/index.js";
import type { EnrichmentContext } from "@pipeline/services/link-enrichment/types.js";
import {
  createCostTracker,
  type CostTracker,
} from "@pipeline/services/cost-tracker.js";
import {
  createRunLogRepo,
  type RunLogRepo,
} from "@pipeline/repositories/run-logs.js";
import {
  getDefaultTenantScope,
  jobTenantContext,
} from "@pipeline/repositories/default-tenant.js";
import {
  createRunLogger,
  type RunLogger,
} from "@pipeline/services/run-logger.js";
import type { RunCostBreakdown, RunFunnel } from "@newsletter/shared";
import { writeFailedArchive } from "@pipeline/services/run-archive-writer.js";
import { finalizeRun } from "@pipeline/services/finalize-run.js";
import type { SourceRateLimiter } from "@pipeline/services/source-rate-limit.js";

const logger = createLogger("worker:run-process");

const FALLBACK_WINDOW_MS = 10 * 60 * 1000; // 10-minute dedup lookback fallback

function ensureDb(db: AppDb | undefined): AppDb {
  if (!db) throw new Error("internal: db required to build default repositories");
  return db;
}


export interface RunCollectorsPayload {
  hn?: HnCollectConfig;
  reddit?: RedditCollectConfig;
  web?: WebCollectConfig;
  twitter?: TwitterCollectConfig;
  webSearch?: RunSubmitWebSearchConfig;
}

export interface RunProcessJobData {
  runId: string;
  topN: number;
  sourceTypes: SourceType[];
  collectors: RunCollectorsPayload;
  halfLifeHours?: number;
  dryRun?: boolean;
  /**
   * Originating tenant (P9, REQ-060). Optional only for in-flight jobs
   * enqueued before P9 — those fall back to the default AGENTLOOP bridge.
   */
  tenantId?: string;
}

export interface RunProcessJobLike {
  name: string;
  id?: string;
  data: RunProcessJobData;
}

export interface RunProcessResult {
  rankedCount: number;
}

export type RankFn = (
  candidates: Candidate[],
  options: RankOptions,
) => Promise<RankResult>;

export type ShortlistFn = (
  candidates: Candidate[],
  options: ShortlistOptions,
) => Promise<ShortlistResult>;

export type HnCollectFn = (
  deps: {
    rawItemsRepo: ReturnType<typeof createRawItemsRepo>;
    signal?: AbortSignal;
    enrichment?: EnrichmentContext;
  },
  config: HnCollectConfig,
) => Promise<CollectorResult>;

export type RedditCollectFn = (
  deps: {
    rawItemsRepo: ReturnType<typeof createRawItemsRepo>;
    signal?: AbortSignal;
    enrichment?: EnrichmentContext;
  },
  config: RedditCollectConfig,
) => Promise<CollectorResult>;

export type WebCollectFn = (
  deps: {
    rawItemsRepo: ReturnType<typeof createRawItemsRepo>;
    signal?: AbortSignal;
    tracker?: CostTracker;
    runLogger?: RunLogger;
  },
  config: WebCollectConfig,
) => Promise<CollectorResult>;

export type TwitterCollectFn = (
  deps: {
    client: TwitterClient;
    rawItemsRepo: ReturnType<typeof createRawItemsRepo>;
    signal?: AbortSignal;
    enrichment?: EnrichmentContext;
    /** Global page throttle shared across tenants (P10, REQ-068). */
    throttle?: () => Promise<void>;
  },
  config: TwitterCollectConfig,
) => Promise<CollectorResult>;

export type WebSearchCollectFn = (
  deps: {
    rawItemsRepo: ReturnType<typeof createRawItemsRepo>;
    provider: WebSearchProvider;
    signal?: AbortSignal;
    enrichment?: EnrichmentContext;
  },
  config: RunSubmitWebSearchConfig,
) => Promise<CollectorResult>;

export interface CollectFns {
  hn: HnCollectFn;
  reddit: RedditCollectFn;
  web: WebCollectFn;
  twitter: TwitterCollectFn;
  webSearch: WebSearchCollectFn;
}

export interface RunProcessDeps {
  runState: RunStateService;
  rawItemsRepo: ReturnType<typeof createRawItemsRepo>;
  candidatesRepo: CandidatesRepo;
  loadFn: LoadCandidatesFn;
  shortlistFn: ShortlistFn;
  rankFn: RankFn;
  collectFns: CollectFns;
  archiveRepo: RunArchivesRepo;
  runLogRepo: RunLogRepo;
  userSettingsRepo?: UserSettingsRepo;
  cancelSubscriber: CancelSubscriberFactory;
  /**
   * Per-job factory for the Twitter (X) collector client. Invoked once per run
   * AFTER the job is picked up — this is the contract that lets operators save
   * cookies via /admin/settings and have them take effect on the NEXT job without
   * a worker restart. Do NOT cache the resolved client at construction time.
   */
  twitterClient: () => Promise<TwitterClient>;
  slackNotifier?: SlackNotifier;
  /**
   * Per-tenant notification channels + email sender (P16, REQ-090).
   * Resolved per job by the deps builder; optional with backward-compat
   * defaults (absent = legacy Slack-only review-ready behavior).
   */
  notificationChannels?: TenantNotificationChannels;
  notificationEmailSender?: NotificationEmailSender;
  /**
   * Tenant error alerts (P16, REQ-091): run-crash notifications to the
   * tenant's channels. Markerless (D-111 counterpart) and never throws.
   */
  errorAlerter?: ErrorAlerter;
  /** Tavily (or future) web-search provider. Resolved once at worker startup from TAVILY_API_KEY env var. */
  webSearchProvider?: WebSearchProvider;
  /**
   * Global per-external-source limiter (P10, REQ-067/068): Redis-shared
   * token buckets pace collector starts (and Twitter page fetches) across
   * concurrent tenant runs. Optional — absence (or a limiter failure) means
   * unthrottled collection, never a failed source.
   */
  sourceRateLimiter?: SourceRateLimiter;
}

interface CollectingOutcome {
  successCount: number;
  failureCount: number;
  errors: string[];
  outcomes: CollectorOutcome[];
}

async function runCollecting(
  deps: RunProcessDeps,
  runId: string,
  collectors: RunCollectorsPayload,
  signal: AbortSignal,
  enrichmentCtx: EnrichmentContext,
  tracker: CostTracker,
  runLog: RunLogger,
): Promise<CollectingOutcome> {
  // In-process serializer for state writes: replicates the old
  // `concurrency: 1` invariant from the collection worker. Without this,
  // two near-simultaneous updateSource calls can interleave their
  // read-modify-write cycles on the shared run:{runId} JSON blob and the
  // second writer will clobber the first. If run-state.ts ever becomes
  // atomic internally, this becomes a no-op but stays correct.
  let writeChain: Promise<unknown> = Promise.resolve();
  const writeSerial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = writeChain.then(fn);
    writeChain = next.catch(() => undefined);
    return next;
  };

  // Wrap rawItemsRepo so every item written during this run carries runId.
  // Collectors stay untouched — the stamping happens at the single wiring point.
  const runScopedRawItemsRepo: typeof deps.rawItemsRepo = {
    ...deps.rawItemsRepo,
    upsertItems: (items) =>
      deps.rawItemsRepo.upsertItems(items.map((i) => ({ ...i, runId }))),
  };

  const collectorDeps = { rawItemsRepo: runScopedRawItemsRepo, signal };
  const enrichingDeps = { ...collectorDeps, enrichment: enrichmentCtx };

  // P10 (REQ-067): pace each collector start on the GLOBAL per-source bucket
  // so concurrent tenant runs share one upstream budget. Limiter failures are
  // swallowed — collection proceeds unthrottled rather than failing a source.
  const sourceRateLimiter = deps.sourceRateLimiter;
  const paceSource = async (sourceKey: string): Promise<void> => {
    if (!sourceRateLimiter) return;
    try {
      await sourceRateLimiter.acquire(sourceKey);
    } catch (err) {
      logger.warn(
        {
          event: "run.source.rate_limiter_unavailable",
          runId,
          sourceType: sourceKey,
          error: err instanceof Error ? err.message : String(err),
        },
        "source rate limiter unavailable — proceeding unthrottled",
      );
    }
  };

  type SourceKey = CollectorSourceType;
  interface Task {
    sourceKey: SourceKey;
    run: () => Promise<CollectorResult>;
  }

  const tasks: Task[] = [];
  if (collectors.hn) {
    const config = collectors.hn;
    tasks.push({
      sourceKey: "hn",
      run: () => deps.collectFns.hn(enrichingDeps, config),
    });
  }
  if (collectors.reddit) {
    const config = collectors.reddit;
    tasks.push({
      sourceKey: "reddit",
      run: () => deps.collectFns.reddit(enrichingDeps, config),
    });
  }
  if (collectors.web) {
    const config = collectors.web;
    tasks.push({
      sourceKey: "blog",
      run: () =>
        deps.collectFns.web(
          { ...collectorDeps, tracker, runLogger: runLog },
          config,
        ),
    });
  }
  if (collectors.twitter) {
    const config = collectors.twitter;
    // Resolve the Twitter client lazily, per job, so admin saves at
    // /admin/settings take effect on the next run without a worker restart.
    // The factory may construct an unauthenticated client (guest mode) when
    // no cookies are configured; the collector itself returns an `auth`
    // failure on its first authenticated call, which is then surfaced in the
    // run-pending Slack notice without crashing the run.
    const resolveClient = deps.twitterClient;
    tasks.push({
      sourceKey: "twitter",
      run: async () => {
        const client = await resolveClient();
        return deps.collectFns.twitter(
          {
            client,
            rawItemsRepo: runScopedRawItemsRepo,
            signal,
            enrichment: enrichmentCtx,
            // REQ-068: page-level throttle on the SHARED twitter budget — the
            // collector invokes it before every page fetch and tolerates
            // throttle failures itself (graceful degrade, EDGE-011).
            ...(sourceRateLimiter !== undefined
              ? { throttle: (): Promise<void> => sourceRateLimiter.acquire("twitter") }
              : {}),
          },
          config,
        );
      },
    });
  }
  if (collectors.webSearch && deps.webSearchProvider) {
    const config = collectors.webSearch;
    const provider = deps.webSearchProvider;
    tasks.push({
      sourceKey: "web_search",
      run: () =>
        deps.collectFns.webSearch(
          {
            rawItemsRepo: runScopedRawItemsRepo,
            provider,
            signal,
            enrichment: enrichmentCtx,
          },
          config,
        ),
    });
  } else if (collectors.webSearch && !deps.webSearchProvider) {
    // graceful degradation — TAVILY_API_KEY not set, skip the task
    logger.warn(
      { source: "web_search" },
      "web_search collector requested but no provider configured (TAVILY_API_KEY missing)",
    );
  }

  const errors: string[] = [];
  const outcomes: CollectorOutcome[] = [];
  let successCount = 0;
  let failureCount = 0;

  const runTask = async (task: Task): Promise<void> => {
    await paceSource(task.sourceKey);
    const started = Date.now();
    try {
      const result = await task.run();
      const durationMs = Date.now() - started;
      await writeSerial(() =>
        deps.runState.updateSource(runId, task.sourceKey, {
          status: "completed",
          itemsFetched: result.itemsStored,
        }),
      );
      logger.info(
        {
          event: "run.source.completed",
          runId,
          sourceType: task.sourceKey,
          itemsFetched: result.itemsStored,
          durationMs,
        },
        "run.source.completed",
      );
      await runLog.info(
        {
          stage: "collecting",
          source: task.sourceKey,
          event: "source.completed",
          itemsFetched: result.itemsStored,
          durationMs,
        },
        `source.completed: ${task.sourceKey}`,
      );
      outcomes.push({
        sourceType: task.sourceKey,
        result,
        topLevelError: null,
        durationMs,
      });
      successCount += 1;
    } catch (err) {
      // Re-throw CancelledError so the outer worker catch maps the run to
      // status: cancelled instead of aggregating it as a per-source failure.
      // Mirrors the rank stage's pattern at line ~437. Without this, a
      // single-source cancellation hits the all-failed branch and the run
      // finalises as "failed". Discovered by Stage 5 VS-5.
      if (err instanceof CancelledError) throw err;
      const durationMs = Date.now() - started;
      const message = err instanceof Error ? err.message : String(err);
      await writeSerial(() =>
        deps.runState.updateSource(runId, task.sourceKey, {
          status: "failed",
          errors: [message],
        }),
      );
      logger.error(
        {
          event: "run.source.failed",
          runId,
          sourceType: task.sourceKey,
          error: message,
          durationMs,
        },
        "run.source.failed",
      );
      await runLog.error(
        {
          stage: "collecting",
          source: task.sourceKey,
          event: "source.failed",
          errors: [message],
          durationMs,
          stack: err instanceof Error ? err.stack : undefined,
        },
        `source.failed: ${task.sourceKey}`,
      );
      errors.push(`${task.sourceKey}: ${message}`);
      outcomes.push({
        sourceType: task.sourceKey,
        result: null,
        topLevelError: message,
        durationMs,
      });
      failureCount += 1;
    }
  };

  await Promise.all(tasks.map(runTask));

  return { successCount, failureCount, errors, outcomes };
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("aborted");
  }
}

export async function handleRunProcessJob(
  deps: RunProcessDeps,
  job: RunProcessJobLike,
): Promise<RunProcessResult> {
  if (job.name !== "run-process") {
    return { rankedCount: 0 };
  }
  const { runId, topN, sourceTypes, collectors, halfLifeHours } = job.data;
  const dryRun = job.data.dryRun ?? false;
  const started = Date.now();
  let runStartedAt: Date = new Date(started);

  const runLog = createRunLogger(runId, { repo: deps.runLogRepo, logger });

  // Funnel counts accumulate as the run progresses; unreached stages stay null
  // so a failed-mid-stage archive records a partial funnel (EDGE-002).
  const funnel: RunFunnel = {
    collected: null,
    deduped: null,
    shortlisted: null,
    ranked: null,
  };

  // Stage timing: each stage opens a start log and, on close, a paired end log
  // carrying durationMs. `currentStage` tracks the active stage for run.failed.
  let currentStage = "queued";
  let stageStartedAt = Date.now();
  const beginStage = async (stage: string): Promise<void> => {
    currentStage = stage;
    stageStartedAt = Date.now();
    await runLog.info({ stage, event: "stage.start" }, `stage.start: ${stage}`);
  };
  const endStage = async (): Promise<void> => {
    await runLog.info(
      {
        stage: currentStage,
        event: "stage.end",
        durationMs: Date.now() - stageStartedAt,
      },
      `stage.end: ${currentStage}`,
    );
  };

  const tracker = createCostTracker(runId);

  const snapshotCost = (): RunCostBreakdown | null =>
    tracker.hasAnyCalls() ? tracker.snapshot() : null;

  const persistCost = async (): Promise<void> => {
    const snapshot = snapshotCost();
    if (snapshot === null) return;
    try {
      await deps.archiveRepo.setCostBreakdown(runId, snapshot);
    } catch (err) {
      logger.error(
        {
          event: "archive.cost_write_failed",
          runId,
          error: err instanceof Error ? err.message : String(err),
        },
        "archive.cost_write_failed",
      );
    }
  };

  // REQ-05: create AbortController and subscribe to cancellation channel
  const controller = new AbortController();
  const { signal } = controller;

  const subscriber = await deps.cancelSubscriber.subscribe(runId, () => {
    controller.abort(new CancelledError(runId));
  });

  const enrichmentCtx: EnrichmentContext = {
    logger: createLogger("collector:enrichment"),
    signal,
    cache: createEnrichmentCache(),
    counters: newCounters(),
    runLogger: runLog,
  };

  // REQ-09: always close subscriber in a finally block
  try {
    await runLog.info(
      {
        stage: "queued",
        event: "run.started",
        topN,
        sourceTypes,
        dryRun,
      },
      "run.started",
    );

    // EDGE-04: re-check Redis run-state after subscribing — if already cancelling, abort immediately
    const currentState = await deps.runState.get(runId);
    if (currentState?.status === "cancelling") {
      controller.abort(new CancelledError(runId));
    }

    // Stage 1: collecting
    throwIfAborted(signal);
    await deps.runState.setStage(runId, "collecting");
    await beginStage("collecting");
    const collecting = await runCollecting(
      deps,
      runId,
      collectors,
      signal,
      enrichmentCtx,
      tracker,
      runLog,
    );
    funnel.collected = collecting.outcomes.reduce(
      (sum, o) => sum + (o.result?.itemsStored ?? 0),
      0,
    );
    await endStage();

    // All collectors failed → terminal failure, skip dedup/rank
    if (collecting.failureCount > 0 && collecting.successCount === 0) {
      const errorMessage = collecting.errors.join("; ");
      await deps.runState.update(runId, (prev) => ({
        ...prev,
        stage: "failed",
        status: "failed",
        error: errorMessage,
        completedAt: new Date().toISOString(),
      }));
      const failedCollectingTelemetry = buildSourceTelemetry(collecting.outcomes);
      failedCollectingTelemetry.enrichment = toEnrichmentTelemetry(enrichmentCtx.counters);
      await writeFailedArchive({
        archiveRepo: deps.archiveRepo,
        runId,
        topN,
        completedAt: new Date(),
        startedAt: runStartedAt,
        sourceTypes,
        isDryRun: dryRun,
        costBreakdown: snapshotCost(),
        runFunnel: { ...funnel },
        sourceTelemetry: failedCollectingTelemetry,
        logger,
      });
      logger.error(
        {
          event: "run.failed",
          runId,
          totalDurationMs: Date.now() - started,
          error: errorMessage,
        },
        "run.failed",
      );
      await runLog.error(
        {
          stage: "collecting",
          event: "run.failed",
          fatal: true,
          errors: collecting.errors,
        },
        `run.failed: ${errorMessage}`,
      );
      // P16 (REQ-091): all collectors down = terminal failure → alert the
      // tenant's channels (dry runs stay silent, matching the notifier's
      // dry-run gate). Markerless + never throws.
      if (!dryRun) {
        await deps.errorAlerter?.runCrashed({
          runId,
          error: errorMessage,
          stage: "collecting",
        });
      }
      // Ensure archive row exists before setCostBreakdown (REQ-040 / EDGE-002):
      // setCostBreakdown is a plain UPDATE that silently no-ops without a row.
      try {
        await deps.archiveRepo.upsert({
          id: runId,
          status: "failed",
          rankedItems: [],
          topN,
          completedAt: new Date(),
          startedAt: runStartedAt,
          sourceTypes,
          isDryRun: dryRun,
          runFunnel: { ...funnel },
          sourceTelemetry: failedCollectingTelemetry,
        });
      } catch (archiveErr) {
        logger.error(
          {
            event: "archive.write_failed",
            runId,
            error: archiveErr instanceof Error ? archiveErr.message : String(archiveErr),
          },
          "archive.write_failed",
        );
      }
      await persistCost();
      return { rankedCount: 0 };
    }

    // Stage 2: processing (dedup)
    throwIfAborted(signal);
    await deps.runState.setStage(runId, "processing");
    await beginStage("processing");

    const state = await deps.runState.get(runId);
    let since: Date;
    if (state?.startedAt) {
      since = new Date(state.startedAt);
      runStartedAt = since;
    } else {
      since = new Date(Date.now() - FALLBACK_WINDOW_MS);
      runStartedAt = since;
      logger.warn(
        { runId },
        "run-state missing; using 10-minute fallback window",
      );
    }

    const raw: Candidate[] = await deps.loadFn(
      deps.candidatesRepo,
      since,
      sourceTypes,
    );

    if (raw.length === 0) {
      funnel.deduped = 0;
      funnel.shortlisted = 0;
      funnel.ranked = 0;
      await endStage();
      await deps.runState.update(runId, (prev) => ({
        ...prev,
        stage: "completed",
        status: "completed",
        rankedItems: [],
        completedAt: new Date().toISOString(),
        warnings: [...prev.warnings, "no items collected"],
      }));
      logger.info(
        {
          event: "run.completed",
          runId,
          totalDurationMs: Date.now() - started,
          rankedItemCount: 0,
        },
        "run.completed",
      );
      await runLog.info(
        { stage: "completed", event: "run.completed", rankedItemCount: 0 },
        "run.completed",
      );
      await persistCost();
      return { rankedCount: 0 };
    }

    // Drop already-published links before dedup (best-effort; failure → empty set, run continues)
    let coveredCanonical = new Set<string>();
    try {
      coveredCanonical = await deps.archiveRepo.getPublishedCanonicalUrls();
    } catch (err) {
      logger.error({ event: "dedup.covered_links_query_failed", runId, err }, "dedup.covered_links_query_failed");
    }
    const beforeCovered = raw.length;
    const notCovered =
      coveredCanonical.size === 0
        ? raw
        : raw.filter((c) => !coveredCanonical.has(canonicalizeUrl(c.url)));
    const coveredRemoved = beforeCovered - notCovered.length;
    if (coveredRemoved > 0) {
      logger.info(
        { event: "dedup.covered_links_removed", runId, coveredRemoved, beforeCovered },
        "dedup.covered_links_removed",
      );
    }

    const deduped = dedupCandidates(notCovered);
    funnel.deduped = deduped.length;
    logger.info(
      {
        event: "run.dedup",
        runId,
        inputCount: raw.length,
        outputCount: deduped.length,
      },
      "run.dedup",
    );
    await runLog.info(
      {
        stage: "processing",
        event: "stage.result",
        inputCount: raw.length,
        outputCount: deduped.length,
      },
      "stage.result: dedup",
    );
    await endStage();

    // Stage 3: shortlisting
    throwIfAborted(signal);
    await deps.runState.setStage(runId, "shortlisting");
    await beginStage("shortlisting");

    // Load settings INSIDE the job (not at worker startup) so admin edits to
    // the shortlist / ranking prompts take effect on the next pipeline job
    // without a worker restart.
    // See .claude/rules/learnings/cache-vs-spec-promise-review.md.
    const settings = deps.userSettingsRepo
      ? await deps.userSettingsRepo.get()
      : null;

    const { shortlist } = await deps.shortlistFn(deduped, {
      shortlistSize: settings?.shortlistSize ?? 30,
      systemPrompt: settings?.shortlistPrompt ?? DEFAULT_SHORTLIST_PROMPT,
      runId,
      tracker,
      abortSignal: signal,
    });
    funnel.shortlisted = shortlist.length;
    const shortlistIds: number[] = shortlist.map((c) => c.id);
    await runLog.info(
      {
        stage: "shortlisting",
        event: "stage.result",
        inputCount: deduped.length,
        outputCount: shortlist.length,
      },
      "stage.result: shortlist",
    );
    await endStage();

    if (shortlist.length === 0) {
      funnel.ranked = 0;
      logger.info(
        { event: "empty_shortlist", runId },
        "shortlist empty — skipping rank stage",
      );
      await deps.runState.update(runId, (prev) => ({
        ...prev,
        stage: "completed",
        status: "completed",
        rankedItems: [],
        completedAt: new Date().toISOString(),
      }));
      const emptyShortlistTelemetry = buildSourceTelemetry(collecting.outcomes);
      emptyShortlistTelemetry.enrichment = toEnrichmentTelemetry(enrichmentCtx.counters);
      try {
        await deps.archiveRepo.upsert({
          id: runId,
          status: "completed",
          rankedItems: [],
          topN,
          completedAt: new Date(),
          startedAt: runStartedAt,
          sourceTypes,
          isDryRun: dryRun,
          sourceTelemetry: emptyShortlistTelemetry,
          runFunnel: { ...funnel },
          shortlistedItemIds: shortlistIds,
        });
      } catch (archiveErr) {
        logger.error(
          {
            event: "archive.write_failed",
            runId,
            error: archiveErr instanceof Error ? archiveErr.message : String(archiveErr),
          },
          "archive.write_failed",
        );
      }
      logger.info(
        {
          event: "run.completed",
          runId,
          totalDurationMs: Date.now() - started,
          rankedItemCount: 0,
        },
        "run.completed",
      );
      await runLog.info(
        { stage: "completed", event: "run.completed", rankedItemCount: 0 },
        "run.completed",
      );
      await persistCost();
      return { rankedCount: 0 };
    }

    // Stage 4: ranking
    throwIfAborted(signal);
    await deps.runState.setStage(runId, "ranking");
    await beginStage("ranking");

    let rankResult: RankResult;
    try {
      rankResult = await deps.rankFn(shortlist, {
        topN,
        runId,
        halfLifeHours,
        shortlistBreakdowns: [],
        abortSignal: signal,
        tracker,
        systemPrompt: settings?.rankingPrompt ?? DEFAULT_RANKING_PROMPT,
      });
    } catch (err) {
      // Re-throw CancelledError to be handled by the outer catch
      if (err instanceof CancelledError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      await deps.runState.update(runId, (prev) => ({
        ...prev,
        stage: "failed",
        status: "failed",
        error: message,
        completedAt: new Date().toISOString(),
      }));
      // The fatal run.failed run_log is emitted once by the outer catch, which
      // observes currentStage="ranking" (set by beginStage above) and the stack.
      // Ensure archive row exists before setCostBreakdown (REQ-040 / EDGE-002):
      // setCostBreakdown is a plain UPDATE that silently no-ops without a row.
      const rankFailedTelemetry = buildSourceTelemetry(collecting.outcomes);
      rankFailedTelemetry.enrichment = toEnrichmentTelemetry(enrichmentCtx.counters);
      try {
        await deps.archiveRepo.upsert({
          id: runId,
          status: "failed",
          rankedItems: [],
          topN,
          completedAt: new Date(),
          startedAt: runStartedAt,
          sourceTypes,
          isDryRun: dryRun,
          runFunnel: { ...funnel },
          sourceTelemetry: rankFailedTelemetry,
        });
      } catch (archiveErr) {
        logger.error(
          {
            event: "archive.write_failed",
            runId,
            error: archiveErr instanceof Error ? archiveErr.message : String(archiveErr),
          },
          "archive.write_failed",
        );
      }
      await persistCost();
      throw err;
    }

    funnel.ranked = rankResult.rankedItems.length;
    await runLog.info(
      {
        stage: "ranking",
        event: "stage.result",
        inputCount: shortlist.length,
        outputCount: rankResult.rankedItems.length,
      },
      "stage.result: rank",
    );
    await endStage();

    const recapUpdates = rankResult.rankedItems
      .filter(
        (item): item is typeof item & { title: string; summary: string; bullets: string[]; bottomLine: string } =>
          !!item.title && !!item.summary && !!item.bullets && !!item.bottomLine,
      )
      .map((item) => ({
        id: item.rawItemId,
        recap: {
          title: item.title,
          summary: item.summary,
          bullets: item.bullets,
          bottomLine: item.bottomLine,
        },
      }));
    if (recapUpdates.length > 0) {
      await deps.rawItemsRepo.updateRecapData(recapUpdates);
    }

    await deps.runState.update(runId, (prev) => ({
      ...prev,
      stage: "completed",
      status: "completed",
      rankedItems: rankResult.rankedItems,
      completedAt: new Date().toISOString(),
    }));

    return await finalizeRun({
      runId,
      topN,
      sourceTypes,
      dryRun,
      runStartedAt,
      runLog,
      logger,
      archiveRepo: deps.archiveRepo,
      rawItemsRepo: deps.rawItemsRepo,
      slackNotifier: deps.slackNotifier,
      notificationChannels: deps.notificationChannels,
      notificationEmailSender: deps.notificationEmailSender,
      publicArchiveBaseUrl:
        process.env.PUBLIC_BASE_URL ?? process.env.NEWSLETTER_BASE_URL,
      settings,
      rankResult,
      collectingOutcomes: collecting.outcomes,
      enrichmentCtx,
      funnel,
      shortlistIds,
      startedTimestamp: started,
      persistCost,
    });
  } catch (err) {
    // REQ-08: handle CancelledError — write cancelled state, archive, return normally
    if (err instanceof CancelledError) {
      await deps.runState.update(runId, (prev) => ({
        ...prev,
        stage: "cancelled",
        status: "cancelled",
        error: "Cancelled by user",
        completedAt: new Date().toISOString(),
      }));
      try {
        await deps.archiveRepo.upsert({
          id: runId,
          status: "cancelled",
          rankedItems: [],
          topN,
          completedAt: new Date(),
          startedAt: runStartedAt,
          sourceTypes,
          isDryRun: dryRun,
        });
      } catch (archiveErr) {
        logger.error(
          {
            event: "archive.write_failed",
            runId,
            error: archiveErr instanceof Error ? archiveErr.message : String(archiveErr),
          },
          "archive.write_failed",
        );
      }
      await persistCost();
      logger.info({ event: "run.cancelled", runId, dryRun }, "run.cancelled");
      await runLog.warn(
        { stage: currentStage, event: "run.cancelled" },
        "run.cancelled",
      );
      return { rankedCount: 0 };
    }
    const message = err instanceof Error ? err.message : String(err);
    await runLog.error(
      {
        stage: currentStage,
        event: "run.failed",
        fatal: true,
        stack: err instanceof Error ? err.stack : undefined,
      },
      `run.failed: ${message}`,
    );
    await writeFailedArchive({
      archiveRepo: deps.archiveRepo,
      runId,
      topN,
      completedAt: new Date(),
      startedAt: runStartedAt,
      sourceTypes,
      isDryRun: dryRun,
      costBreakdown: snapshotCost(),
      runFunnel: { ...funnel },
      logger,
    });
    // P16 (REQ-091): unhandled stage crash → alert the tenant's channels
    // before re-throwing (dry runs stay silent). Markerless + never throws.
    if (!dryRun) {
      await deps.errorAlerter?.runCrashed({
        runId,
        error: message,
        stage: currentStage,
      });
    }
    throw err;
  } finally {
    await subscriber.close();
  }
}

export interface CreateRunProcessWorkerOptions {
  connection?: IORedis;
  runState?: RunStateService;
  rawItemsRepo?: ReturnType<typeof createRawItemsRepo>;
  candidatesRepo?: CandidatesRepo;
  loadFn?: LoadCandidatesFn;
  shortlistFn?: ShortlistFn;
  rankFn?: RankFn;
  collectFns?: Partial<CollectFns>;
  archiveRepo?: RunArchivesRepo;
  runLogRepo?: RunLogRepo;
  userSettingsRepo?: UserSettingsRepo;
  cancelSubscriber?: CancelSubscriberFactory;
  twitterClient?: () => Promise<TwitterClient>;
  slackNotifier?: SlackNotifier;
  notificationChannels?: TenantNotificationChannels;
  notificationEmailSender?: NotificationEmailSender;
  errorAlerter?: ErrorAlerter;
  webSearchProvider?: WebSearchProvider;
  sourceRateLimiter?: SourceRateLimiter;
}

/**
 * Builds the deps for ONE run-process job (P9, REQ-061/064): every repo not
 * injected via `options` is constructed with the job's tenant scope —
 * `jobTenantContext(jobData)` for P9 payloads, falling back to the default
 * AGENTLOOP bridge (`getDefaultTenantScope()`, primed at process startup)
 * for legacy in-flight jobs with no `tenantId`. All tenant-owned writes the
 * run performs (raw_items, run_archives, run_logs) therefore stamp the
 * originating tenant.
 */
export function buildRunProcessDepsForJob(
  options: CreateRunProcessWorkerOptions,
  jobData: { tenantId?: unknown } | undefined,
): Promise<RunProcessDeps> {
  const connection = options.connection ?? createRedisConnection();
  const runState = options.runState ?? createRunStateService(connection);
  const needsDb =
    !options.rawItemsRepo ||
    !options.candidatesRepo ||
    !options.archiveRepo ||
    !options.runLogRepo;
  const db: AppDb | undefined = needsDb ? getDb() : undefined;
  // Per-job tenant scope (REQ-060/064). The sync bridge read keeps this
  // function dependency-free for unit tests with fake DBs; production primes
  // the bridge once at process startup (src/index.ts).
  const tenantScope = jobTenantContext(jobData) ?? getDefaultTenantScope();
  const rawItemsRepo =
    options.rawItemsRepo ?? createRawItemsRepo(ensureDb(db), tenantScope);
  const candidatesRepo =
    options.candidatesRepo ?? createCandidatesRepo(ensureDb(db), tenantScope);
  const loadFn = options.loadFn ?? loadCandidatesSince;
  const shortlistFn: ShortlistFn =
    options.shortlistFn ??
    ((candidates, opts) => shortlistCandidates(candidates, opts));
  const rankFn: RankFn =
    options.rankFn ?? ((candidates, opts) => rankCandidates(candidates, opts));
  const collectFns: CollectFns = {
    hn: options.collectFns?.hn ?? collectHn,
    reddit:
      options.collectFns?.reddit ??
      // Per-job factory: resolves the Apify token from the app-level
      // `app_credentials` store first (super-admin managed), falling back to
      // APIFY_API_KEY env var. Wired lazily so the collector stays db-free
      // (enforce-repository-access rule). DB read happens per-call (so admin
      // saves take effect on the next run); cipher is a process-singleton
      // (SESSION_SECRET is never rotated — D-104).
      (async (deps, config) => {
        const { buildRedditResolveToken } = await import(
          "@pipeline/lib/reddit-deps.js"
        );
        const resolveToken = await buildRedditResolveToken();
        return collectReddit({ ...deps, resolveToken }, config);
      }),
    web: options.collectFns?.web ?? collectWeb,
    twitter: options.collectFns?.twitter ?? collectTwitter,
    webSearch: options.collectFns?.webSearch ?? collectWebSearch,
  };

  // Per-job factory: resolves the SHARED collector cookie from the app-level
  // `app_credentials` store first (super-admin managed, P12 REQ-086), falling
  // back to RETTIWT_API_KEY env var. Construction happens at job time so saves
  // take effect on the next run without a worker restart (S-pipeline-03). The
  // cookie is app-level by design — never tenant-scoped. Rettiwt accepts an
  // undefined apiKey (guest mode).
  const twitterClient: () => Promise<TwitterClient> =
    options.twitterClient ??
    (async () => {
      const repo = createAppCredentialsRepo(ensureDb(db), getCredentialCipher());
      const cookie = await resolveTwitterCollectorCookie({
        appRepo: repo,
        env: process.env,
      });
      const rettiwt = new Rettiwt({ apiKey: cookie?.apiKey });
      return createRettiwtClient({
        rettiwt,
        auth: cookie
          ? {
              refreshCsrfToken: () =>
                refreshRettiwtCsrfToken({
                  rettiwt,
                  repo,
                  credentialSource: cookie.source,
                }),
            }
          : undefined,
      });
    });

  const archiveRepo =
    options.archiveRepo ?? createRunArchivesRepo(ensureDb(db), tenantScope);
  const runLogRepo =
    options.runLogRepo ?? createRunLogRepo(ensureDb(db), tenantScope);
  const userSettingsRepo = options.userSettingsRepo;

  const cancelSubscriber =
    options.cancelSubscriber ?? createCancelSubscriber(connection);

  return Promise.resolve({
    runState,
    rawItemsRepo,
    candidatesRepo,
    loadFn,
    shortlistFn,
    rankFn,
    collectFns,
    archiveRepo,
    runLogRepo,
    userSettingsRepo,
    cancelSubscriber,
    twitterClient,
    slackNotifier: options.slackNotifier,
    notificationChannels: options.notificationChannels,
    notificationEmailSender: options.notificationEmailSender,
    errorAlerter: options.errorAlerter,
    webSearchProvider: options.webSearchProvider,
    sourceRateLimiter: options.sourceRateLimiter,
  });
}

export function createRunProcessWorker(
  options: CreateRunProcessWorkerOptions = {},
): Worker<RunProcessJobData, RunProcessResult> {
  const connection = options.connection ?? createRedisConnection();
  // Connection-bound services are shared across jobs; repos are rebuilt per
  // job so each run's writes stamp the job's tenant (P9, REQ-064).
  const sharedOptions: CreateRunProcessWorkerOptions = {
    ...options,
    connection,
    runState: options.runState ?? createRunStateService(connection),
    cancelSubscriber:
      options.cancelSubscriber ?? createCancelSubscriber(connection),
  };

  return new Worker<RunProcessJobData, RunProcessResult>(
    "processing",
    async (job) => {
      const typed = job as RunProcessJobLike;
      const deps = await buildRunProcessDepsForJob(sharedOptions, typed.data);
      return handleRunProcessJob(deps, typed);
    },
    { connection },
  );
}
