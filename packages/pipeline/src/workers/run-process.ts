import { Worker } from "bullmq";
import type IORedis from "ioredis";
import { createRedisConnection } from "@newsletter/shared/redis";
import { getDb, serializeArchiveSearchText } from "@newsletter/shared";
import { DEFAULT_RANKING_PROMPT } from "@newsletter/shared/constants";
import type { SlackNotifier } from "@newsletter/shared";
import type { AppDb, SourceType } from "@newsletter/shared/db";
import { createLogger } from "@newsletter/shared/logger";
import { dedupCandidates } from "@pipeline/processors/dedup.js";
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
import { createRettiwtClient } from "@pipeline/collectors/twitter/clients/rettiwt.js";
import type { TwitterClient } from "@pipeline/collectors/twitter/types.js";
import { Rettiwt } from "rettiwt-api";
import { createSocialCredentialsRepo } from "@pipeline/repositories/social-credentials.js";
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
import type { RunCostBreakdown } from "@newsletter/shared";

const logger = createLogger("worker:run-process");

const FALLBACK_WINDOW_MS = 10 * 60 * 1000; // 10-minute dedup lookback fallback

function ensureDb(db: AppDb | undefined): AppDb {
  if (!db) throw new Error("internal: db required to build default repositories");
  return db;
}

function nonEmptyText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? value : null;
}

function pickArchiveDigest(rankResult: RankResult): {
  digestHeadline: string | null;
  digestSummary: string | null;
} {
  if (rankResult.rankedItems.length === 0) {
    return {
      digestHeadline: nonEmptyText(rankResult.digestHeadline),
      digestSummary: nonEmptyText(rankResult.digestSummary),
    };
  }

  const firstRankedItem = rankResult.rankedItems[0];
  return {
    digestHeadline:
      nonEmptyText(firstRankedItem.title) ?? nonEmptyText(rankResult.digestHeadline),
    digestSummary: nonEmptyText(rankResult.digestSummary),
  };
}

async function writeFailedArchive(input: {
  readonly archiveRepo: RunArchivesRepo;
  readonly runId: string;
  readonly topN: number;
  readonly completedAt: Date;
  readonly startedAt: Date;
  readonly sourceTypes: readonly SourceType[];
  readonly isDryRun: boolean;
  readonly costBreakdown: RunCostBreakdown | null;
  readonly logger: ReturnType<typeof createLogger>;
}): Promise<boolean> {
  try {
    await input.archiveRepo.upsert({
      id: input.runId,
      status: "failed",
      rankedItems: [],
      topN: input.topN,
      completedAt: input.completedAt,
      startedAt: input.startedAt,
      sourceTypes: [...input.sourceTypes],
      reviewed: false,
      isDryRun: input.isDryRun,
    });
    if (input.costBreakdown !== null) {
      await input.archiveRepo.setCostBreakdown(input.runId, input.costBreakdown);
    }
    return true;
  } catch (err) {
    input.logger.error(
      {
        event: "archive.write_failed",
        runId: input.runId,
        error: err instanceof Error ? err.message : String(err),
      },
      "archive.write_failed",
    );
    return false;
  }
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
  },
  config: WebCollectConfig,
) => Promise<CollectorResult>;

export type TwitterCollectFn = (
  deps: {
    client: TwitterClient;
    rawItemsRepo: ReturnType<typeof createRawItemsRepo>;
    signal?: AbortSignal;
    enrichment?: EnrichmentContext;
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
  /** Tavily (or future) web-search provider. Resolved once at worker startup from TAVILY_API_KEY env var. */
  webSearchProvider?: WebSearchProvider;
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

  const collectorDeps = { rawItemsRepo: deps.rawItemsRepo, signal };
  const enrichingDeps = { ...collectorDeps, enrichment: enrichmentCtx };

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
      run: () => deps.collectFns.web({ ...collectorDeps, tracker }, config),
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
            rawItemsRepo: deps.rawItemsRepo,
            signal,
            enrichment: enrichmentCtx,
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
            rawItemsRepo: deps.rawItemsRepo,
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
  };

  // REQ-09: always close subscriber in a finally block
  try {
    // EDGE-04: re-check Redis run-state after subscribing — if already cancelling, abort immediately
    const currentState = await deps.runState.get(runId);
    if (currentState?.status === "cancelling") {
      controller.abort(new CancelledError(runId));
    }

    // Stage 1: collecting
    throwIfAborted(signal);
    await deps.runState.setStage(runId, "collecting");
    const collecting = await runCollecting(deps, runId, collectors, signal, enrichmentCtx, tracker);

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
      await writeFailedArchive({
        archiveRepo: deps.archiveRepo,
        runId,
        topN,
        completedAt: new Date(),
        startedAt: runStartedAt,
        sourceTypes,
        isDryRun: dryRun,
        costBreakdown: snapshotCost(),
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
      await persistCost();
      return { rankedCount: 0 };
    }

    const deduped = dedupCandidates(raw);
    logger.info(
      {
        event: "run.dedup",
        runId,
        inputCount: raw.length,
        outputCount: deduped.length,
      },
      "run.dedup",
    );

    // Stage 3: shortlisting
    throwIfAborted(signal);
    await deps.runState.setStage(runId, "shortlisting");
    const { shortlist, breakdowns } = await deps.shortlistFn(deduped, {
      halfLifeHours,
      runId,
      signal,
    });

    if (shortlist.length === 0) {
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
      logger.info(
        {
          event: "run.completed",
          runId,
          totalDurationMs: Date.now() - started,
          rankedItemCount: 0,
        },
        "run.completed",
      );
      await persistCost();
      return { rankedCount: 0 };
    }

    // Stage 4: ranking
    throwIfAborted(signal);
    await deps.runState.setStage(runId, "ranking");

    // Load settings INSIDE the job (not at worker startup) so admin edits to
    // the ranking prompt take effect on the next pipeline job without a
    // worker restart. See .claude/rules/learnings/cache-vs-spec-promise-review.md.
    const settings = deps.userSettingsRepo ? await deps.userSettingsRepo.get() : null;

    let rankResult: RankResult;
    try {
      rankResult = await deps.rankFn(shortlist, {
        topN,
        runId,
        halfLifeHours,
        shortlistBreakdowns: breakdowns,
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

    const autoReviewed = settings?.autoReview === true;
    const sourceTelemetry = buildSourceTelemetry(collecting.outcomes);
    sourceTelemetry.enrichment = toEnrichmentTelemetry(enrichmentCtx.counters);
    const { digestHeadline, digestSummary } = pickArchiveDigest(rankResult);
    const hook = nonEmptyText(rankResult.hook);
    const twitterSummary = nonEmptyText(rankResult.twitterSummary);
    const rankedRawIds = rankResult.rankedItems.map((r) => r.rawItemId);
    const rankedRawRows = await deps.rawItemsRepo.findByIds(rankedRawIds);
    const rawItemsById = new Map(rankedRawRows.map((r) => [r.id, r]));
    const searchText = serializeArchiveSearchText({
      digestHeadline,
      digestSummary,
      rankedItems: rankResult.rankedItems,
      rawItemsById,
    });
    let archiveWritten = false;
    try {
      await deps.archiveRepo.upsert({
        id: runId,
        status: "completed",
        rankedItems: rankResult.rankedItems,
        topN,
        completedAt: new Date(),
        startedAt: runStartedAt,
        sourceTypes,
        reviewed: autoReviewed,
        digestHeadline,
        digestSummary,
        hook,
        twitterSummary,
        sourceTelemetry,
        searchText,
        isDryRun: dryRun,
      });
      archiveWritten = true;
    } catch (err) {
      logger.error(
        {
          event: "archive.write_failed",
          runId,
          error: err instanceof Error ? err.message : String(err),
        },
        "archive.write_failed",
      );
    }

    if (archiveWritten) {
      await persistCost();
    }

    if (archiveWritten) {
      try {
        await deps.slackNotifier?.notifySourceDistribution({ runId });
      } catch (err) {
        logger.warn(
          {
            event: "slack.source_distribution.unexpected_throw",
            runId,
            error: err instanceof Error ? err.message : String(err),
          },
          "slack.source_distribution.unexpected_throw",
        );
      }
    }

    if (archiveWritten && settings && !settings.autoReview) {
      await deps.slackNotifier?.notifyReviewPending({ runId });
    }

    logger.info(
      {
        event: "run.completed",
        runId,
        totalDurationMs: Date.now() - started,
        rankedItemCount: rankResult.rankedItems.length,
        dryRun,
      },
      "run.completed",
    );

    return { rankedCount: rankResult.rankedItems.length };
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
      return { rankedCount: 0 };
    }
    await writeFailedArchive({
      archiveRepo: deps.archiveRepo,
      runId,
      topN,
      completedAt: new Date(),
      startedAt: runStartedAt,
      sourceTypes,
      isDryRun: dryRun,
      costBreakdown: snapshotCost(),
      logger,
    });
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
  userSettingsRepo?: UserSettingsRepo;
  cancelSubscriber?: CancelSubscriberFactory;
  twitterClient?: () => Promise<TwitterClient>;
  slackNotifier?: SlackNotifier;
  webSearchProvider?: WebSearchProvider;
}

export function createRunProcessWorker(
  options: CreateRunProcessWorkerOptions = {},
): Worker<RunProcessJobData, RunProcessResult> {
  const connection = options.connection ?? createRedisConnection();
  const runState = options.runState ?? createRunStateService(connection);
  const needsDb = !options.rawItemsRepo || !options.candidatesRepo || !options.archiveRepo;
  const db: AppDb | undefined = needsDb ? getDb() : undefined;
  const rawItemsRepo =
    options.rawItemsRepo ?? createRawItemsRepo(ensureDb(db));
  const candidatesRepo =
    options.candidatesRepo ?? createCandidatesRepo(ensureDb(db));
  const loadFn = options.loadFn ?? loadCandidatesSince;
  const shortlistFn: ShortlistFn =
    options.shortlistFn ??
    ((candidates, opts) => shortlistCandidates(candidates, opts));
  const rankFn: RankFn =
    options.rankFn ?? ((candidates, opts) => rankCandidates(candidates, opts));
  const collectFns: CollectFns = {
    hn: options.collectFns?.hn ?? collectHn,
    reddit: options.collectFns?.reddit ?? collectReddit,
    web: options.collectFns?.web ?? collectWeb,
    twitter: options.collectFns?.twitter ?? collectTwitter,
    webSearch: options.collectFns?.webSearch ?? collectWebSearch,
  };

  // Per-job factory: resolves cookies from `social_credentials.twitter_collector`
  // first (admin-managed), falling back to RETTIWT_API_KEY env var. Construction
  // happens at job time so admin saves take effect on the next run without a
  // worker restart. Rettiwt accepts an undefined apiKey (guest mode).
  const twitterClient: () => Promise<TwitterClient> =
    options.twitterClient ??
    (async () => {
      const cookie = await resolveTwitterCollectorCookie({
        repo: createSocialCredentialsRepo(ensureDb(db), getCredentialCipher()),
        env: process.env,
      });
      return createRettiwtClient({
        rettiwt: new Rettiwt({ apiKey: cookie?.apiKey }),
      });
    });

  const archiveRepo =
    options.archiveRepo ?? createRunArchivesRepo(ensureDb(db));
  const userSettingsRepo = options.userSettingsRepo;

  const cancelSubscriber =
    options.cancelSubscriber ?? createCancelSubscriber(connection);

  const deps: RunProcessDeps = {
    runState,
    rawItemsRepo,
    candidatesRepo,
    loadFn,
    shortlistFn,
    rankFn,
    collectFns,
    archiveRepo,
    userSettingsRepo,
    cancelSubscriber,
    twitterClient,
    slackNotifier: options.slackNotifier,
    webSearchProvider: options.webSearchProvider,
  };

  return new Worker<RunProcessJobData, RunProcessResult>(
    "processing",
    (job) => handleRunProcessJob(deps, job as RunProcessJobLike),
    { connection },
  );
}
