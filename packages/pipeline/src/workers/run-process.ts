import { Worker } from "bullmq";
import type IORedis from "ioredis";
import { createRedisConnection } from "@newsletter/shared/redis";
import { getDb } from "@newsletter/shared";
import type { AppDb, SourceType } from "@newsletter/shared/db";
import { createLogger } from "@newsletter/shared/logger";
import type { UserProfile } from "@newsletter/shared";
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
import { createRawItemsRepo } from "@pipeline/repositories/raw-items.js";
import {
  createRunArchivesRepo,
  type RunArchivesRepo,
} from "@pipeline/repositories/run-archives.js";
import type {
  HnCollectConfig,
  RedditCollectConfig,
  WebCollectConfig,
} from "@pipeline/types.js";
import type { CollectorResult } from "@newsletter/shared";

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
}

export interface RunProcessJobData {
  runId: string;
  topN: number;
  sourceTypes: SourceType[];
  collectors: RunCollectorsPayload;
  profile?: UserProfile | null;
  halfLifeHours?: number;
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
  deps: { rawItemsRepo: ReturnType<typeof createRawItemsRepo> },
  config: HnCollectConfig,
) => Promise<CollectorResult>;

export type RedditCollectFn = (
  deps: { rawItemsRepo: ReturnType<typeof createRawItemsRepo> },
  config: RedditCollectConfig,
) => Promise<CollectorResult>;

export type WebCollectFn = (
  deps: { rawItemsRepo: ReturnType<typeof createRawItemsRepo> },
  config: WebCollectConfig,
) => Promise<CollectorResult>;

export interface CollectFns {
  hn: HnCollectFn;
  reddit: RedditCollectFn;
  web: WebCollectFn;
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
}

interface CollectingOutcome {
  successCount: number;
  failureCount: number;
  errors: string[];
}

async function runCollecting(
  deps: RunProcessDeps,
  runId: string,
  collectors: RunCollectorsPayload,
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

  const collectorDeps = { rawItemsRepo: deps.rawItemsRepo };

  type SourceKey = "hn" | "reddit" | "blog";
  interface Task {
    sourceKey: SourceKey;
    run: () => Promise<CollectorResult>;
  }

  const tasks: Task[] = [];
  if (collectors.hn) {
    const config = collectors.hn;
    tasks.push({
      sourceKey: "hn",
      run: () => deps.collectFns.hn(collectorDeps, config),
    });
  }
  if (collectors.reddit) {
    const config = collectors.reddit;
    tasks.push({
      sourceKey: "reddit",
      run: () => deps.collectFns.reddit(collectorDeps, config),
    });
  }
  if (collectors.web) {
    const config = collectors.web;
    tasks.push({
      sourceKey: "blog",
      run: () => deps.collectFns.web(collectorDeps, config),
    });
  }

  const errors: string[] = [];
  let successCount = 0;
  let failureCount = 0;

  const runTask = async (task: Task): Promise<void> => {
    const started = Date.now();
    try {
      const result = await task.run();
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
          durationMs: Date.now() - started,
        },
        "run.source.completed",
      );
      successCount += 1;
    } catch (err) {
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
          durationMs: Date.now() - started,
        },
        "run.source.failed",
      );
      errors.push(`${task.sourceKey}: ${message}`);
      failureCount += 1;
    }
  };

  await Promise.all(tasks.map(runTask));

  return { successCount, failureCount, errors };
}

export async function handleRunProcessJob(
  deps: RunProcessDeps,
  job: RunProcessJobLike,
): Promise<RunProcessResult> {
  if (job.name !== "run-process") {
    throw new Error(`unknown job: ${job.name}`);
  }
  const { runId, topN, sourceTypes, collectors } = job.data;
  const profile = job.data.profile ?? null;
  const halfLifeHours = job.data.halfLifeHours;
  const started = Date.now();

  // Stage 1: collecting
  await deps.runState.setStage(runId, "collecting");
  const collecting = await runCollecting(deps, runId, collectors);

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
    logger.error(
      {
        event: "run.failed",
        runId,
        totalDurationMs: Date.now() - started,
        error: errorMessage,
      },
      "run.failed",
    );
    return { rankedCount: 0 };
  }

  // Stage 2: processing (dedup)
  await deps.runState.setStage(runId, "processing");

  const state = await deps.runState.get(runId);
  let since: Date;
  if (state?.startedAt) {
    since = new Date(state.startedAt);
  } else {
    since = new Date(Date.now() - FALLBACK_WINDOW_MS);
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

  await deps.runState.setStage(runId, "shortlisting");
  const { shortlist, breakdowns } = await deps.shortlistFn(deduped, {
    profile,
    halfLifeHours,
    runId,
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
    return { rankedCount: 0 };
  }

  await deps.runState.setStage(runId, "ranking");

  let rankResult: RankResult;
  try {
    rankResult = await deps.rankFn(shortlist, {
      topN,
      runId,
      profile,
      halfLifeHours,
      shortlistBreakdowns: breakdowns,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.runState.update(runId, (prev) => ({
      ...prev,
      stage: "failed",
      status: "failed",
      error: message,
      completedAt: new Date().toISOString(),
    }));
    throw err;
  }

  const recapUpdates = rankResult.rankedItems
    .filter(
      (item): item is typeof item & { summary: string; bullets: string[]; bottomLine: string } =>
        !!item.summary && !!item.bullets && !!item.bottomLine,
    )
    .map((item) => ({
      id: item.rawItemId,
      recap: { summary: item.summary, bullets: item.bullets, bottomLine: item.bottomLine },
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

  try {
    await deps.archiveRepo.upsert({
      id: runId,
      status: "completed",
      rankedItems: rankResult.rankedItems,
      topN,
      profileName: profile?.name ?? null,
      completedAt: new Date(),
    });
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

  logger.info(
    {
      event: "run.completed",
      runId,
      totalDurationMs: Date.now() - started,
      rankedItemCount: rankResult.rankedItems.length,
    },
    "run.completed",
  );

  return { rankedCount: rankResult.rankedItems.length };
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
  };

  const archiveRepo =
    options.archiveRepo ?? createRunArchivesRepo(ensureDb(db));

  const deps: RunProcessDeps = {
    runState,
    rawItemsRepo,
    candidatesRepo,
    loadFn,
    shortlistFn,
    rankFn,
    collectFns,
    archiveRepo,
  };

  return new Worker<RunProcessJobData, RunProcessResult>(
    "processing",
    (job) => handleRunProcessJob(deps, job as RunProcessJobLike),
    { connection },
  );
}
