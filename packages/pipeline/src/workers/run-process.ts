import { Worker } from "bullmq";
import type IORedis from "ioredis";
import { createRedisConnection } from "@newsletter/shared/redis";
import { getDb } from "@newsletter/shared";
import type { AppDb, SourceType } from "@newsletter/shared/db";
import { createLogger } from "@newsletter/shared/logger";
import type { UserProfile } from "@newsletter/shared";
import { dedupCandidates } from "@pipeline/processors/dedup.js";
import { filterNoise } from "@pipeline/processors/noise.js";
import { semanticDedupCandidates } from "@pipeline/processors/semantic-dedup.js";
import { mmrSelect, type MmrItem } from "@pipeline/processors/mmr.js";
import type { NoiseFilterOptions } from "@pipeline/processors/noise.js";
import type { SemanticDedupOptions, SemanticDedupResult } from "@pipeline/processors/semantic-dedup.js";
import type { MmrOptions } from "@pipeline/processors/mmr.js";
import type { RankedItemRef } from "@newsletter/shared";
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
import type {
  HnCollectConfig,
  RedditCollectConfig,
  WebCollectConfig,
} from "@pipeline/types.js";
import type { CollectorResult } from "@newsletter/shared";

const logger = createLogger("worker:run-process");

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
  sourceTypes: ("hn" | "reddit" | "blog")[];
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

export type NoiseFn = (
  candidates: readonly Candidate[],
  options: NoiseFilterOptions,
) => Candidate[];

export type SemanticDedupFn = (
  candidates: readonly Candidate[],
  options: SemanticDedupOptions,
) => Promise<SemanticDedupResult>;

export type MmrFn = (items: MmrItem[], options: MmrOptions) => RankedItemRef[];

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
  noiseFn: NoiseFn;
  semanticDedupFn: SemanticDedupFn;
  shortlistFn: ShortlistFn;
  rankFn: RankFn;
  mmrFn: MmrFn;
  collectFns: CollectFns;
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
    since = new Date(Date.now() - 10 * 60 * 1000);
    logger.warn(
      { runId },
      "run-state missing; using 10-minute fallback window",
    );
  }

  const raw: Candidate[] = await deps.loadFn(
    deps.candidatesRepo,
    since,
    sourceTypes as SourceType[],
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

  // 2a: URL dedup (exact, fast, cheap)
  const urlDeduped = dedupCandidates(raw);
  logger.info(
    {
      event: "run.dedup",
      runId,
      inputCount: raw.length,
      outputCount: urlDeduped.length,
    },
    "run.dedup",
  );

  // 2b: Noise pre-filter (REQ-001, REQ-002)
  const noiseFiltered = deps.noiseFn(urlDeduped, { runId });
  logger.info(
    {
      event: "run.noise",
      runId,
      inputCount: urlDeduped.length,
      outputCount: noiseFiltered.length,
    },
    "run.noise",
  );

  if (noiseFiltered.length === 0) {
    await deps.runState.update(runId, (prev) => ({
      ...prev,
      stage: "completed",
      status: "completed",
      rankedItems: [],
      completedAt: new Date().toISOString(),
      warnings: [...prev.warnings, "all candidates filtered by noise filter"],
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

  // 2c: Semantic dedup — returns candidates + titleEmbeds (REQ-003 to REQ-008)
  const { candidates: semanticDeduped, titleEmbeds } = await deps.semanticDedupFn(
    noiseFiltered,
    { runId },
  );
  logger.info(
    {
      event: "run.semantic-dedup",
      runId,
      inputCount: noiseFiltered.length,
      outputCount: semanticDeduped.length,
    },
    "run.semantic-dedup",
  );

  if (semanticDeduped.length === 0) {
    await deps.runState.update(runId, (prev) => ({
      ...prev,
      stage: "completed",
      status: "completed",
      rankedItems: [],
      completedAt: new Date().toISOString(),
      warnings: [...prev.warnings, "all candidates removed by semantic dedup"],
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

  // Stage 3: shortlisting — reuses titleEmbeds from semantic dedup (REQ-009)
  await deps.runState.setStage(runId, "shortlisting");
  const {
    shortlist,
    titleEmbeds: shortlistEmbeds,
  } = await deps.shortlistFn(semanticDeduped, {
    profile,
    runId,
    titleEmbeds,
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

  // Stage 4: ranking with 4-signal fusion (over-select before MMR source caps)
  await deps.runState.setStage(runId, "ranking");

  let rankResult: RankResult;
  try {
    rankResult = await deps.rankFn(shortlist, {
      topN: topN * 3,
      runId,
      profile,
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

  // Stage 5: MMR diversity selection (REQ-022 to REQ-025)
  // Build lookup maps from the shortlist for O(1) access
  const shortlistById = new Map(shortlist.map((c) => [c.id, c]));
  const idxMap = new Map(shortlist.map((c, i) => [c.id, i]));
  const mmrItems: MmrItem[] = rankResult.rankedItems.map((ref) => {
    const c = shortlistById.get(ref.rawItemId);
    return {
      ref,
      title: c?.title ?? "",
      sourceType: c?.sourceType ?? "hn",
    };
  });
  const mmrTitleEmbeds = mmrItems.map((item) => {
    const idx = idxMap.get(item.ref.rawItemId);
    return idx !== undefined ? (shortlistEmbeds[idx] ?? []) : [];
  });

  const finalRanked = deps.mmrFn(mmrItems, {
    topN,
    titleEmbeds: mmrTitleEmbeds,
    runId,
  });

  await deps.runState.update(runId, (prev) => ({
    ...prev,
    stage: "completed",
    status: "completed",
    rankedItems: finalRanked,
    completedAt: new Date().toISOString(),
  }));

  logger.info(
    {
      event: "run.completed",
      runId,
      totalDurationMs: Date.now() - started,
      rankedItemCount: finalRanked.length,
    },
    "run.completed",
  );

  return { rankedCount: finalRanked.length };
}

export interface CreateRunProcessWorkerOptions {
  connection?: IORedis;
  runState?: RunStateService;
  rawItemsRepo?: ReturnType<typeof createRawItemsRepo>;
  candidatesRepo?: CandidatesRepo;
  loadFn?: LoadCandidatesFn;
  noiseFn?: NoiseFn;
  semanticDedupFn?: SemanticDedupFn;
  shortlistFn?: ShortlistFn;
  rankFn?: RankFn;
  mmrFn?: MmrFn;
  collectFns?: Partial<CollectFns>;
}

export function createRunProcessWorker(
  options: CreateRunProcessWorkerOptions = {},
): Worker<RunProcessJobData, RunProcessResult> {
  const connection = options.connection ?? createRedisConnection();
  const runState = options.runState ?? createRunStateService(connection);
  const needsDb = !options.rawItemsRepo || !options.candidatesRepo;
  const db: AppDb | undefined = needsDb ? getDb() : undefined;
  const rawItemsRepo =
    options.rawItemsRepo ?? createRawItemsRepo(ensureDb(db));
  const candidatesRepo =
    options.candidatesRepo ?? createCandidatesRepo(ensureDb(db));
  const loadFn = options.loadFn ?? loadCandidatesSince;
  const noiseFn: NoiseFn = options.noiseFn ?? filterNoise;
  const semanticDedupFn: SemanticDedupFn = options.semanticDedupFn ?? semanticDedupCandidates;
  const shortlistFn: ShortlistFn =
    options.shortlistFn ??
    ((candidates, opts) => shortlistCandidates(candidates, opts));
  const rankFn: RankFn =
    options.rankFn ?? ((candidates, opts) => rankCandidates(candidates, opts));
  const mmrFn: MmrFn = options.mmrFn ?? mmrSelect;
  const collectFns: CollectFns = {
    hn: options.collectFns?.hn ?? collectHn,
    reddit: options.collectFns?.reddit ?? collectReddit,
    web: options.collectFns?.web ?? collectWeb,
  };

  const deps: RunProcessDeps = {
    runState,
    rawItemsRepo,
    candidatesRepo,
    loadFn,
    noiseFn,
    semanticDedupFn,
    shortlistFn,
    rankFn,
    mmrFn,
    collectFns,
  };

  return new Worker<RunProcessJobData, RunProcessResult>(
    "processing",
    (job) => handleRunProcessJob(deps, job as RunProcessJobLike),
    { connection },
  );
}
