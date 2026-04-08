import { Worker } from "bullmq";
import type IORedis from "ioredis";
import {
  createRedisConnection,
  getDb,
  type AppDb,
  type SourceType,
} from "@newsletter/shared/db";
import { createLogger } from "@newsletter/shared/logger";
import { dedupCandidates } from "@pipeline/processors/dedup.js";
import {
  rankCandidates,
  type RankResult,
  type RankOptions,
  type RankCandidate,
} from "@pipeline/processors/rank.js";
import {
  createRunStateService,
  type RunStateService,
} from "@pipeline/services/run-state.js";
import {
  loadCandidatesSince,
  type LoadCandidatesFn,
  type Candidate,
} from "@pipeline/services/candidate-loader.js";

const logger = createLogger("worker:run-process");

export interface RunProcessJobData {
  runId: string;
  topN: number;
  sourceTypes: ("hn" | "reddit")[];
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
  candidates: RankCandidate[],
  options: RankOptions,
) => Promise<RankResult>;

export interface RunProcessDeps {
  runState: RunStateService;
  db: AppDb;
  loadFn: LoadCandidatesFn;
  rankFn: RankFn;
}

export async function handleRunProcessJob(
  deps: RunProcessDeps,
  job: RunProcessJobLike,
): Promise<RunProcessResult> {
  if (job.name !== "run-process") {
    throw new Error(`unknown job: ${job.name}`);
  }
  const { runId, topN, sourceTypes } = job.data;
  const started = Date.now();

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
    deps.db,
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

  const rankCandidatesInput: RankCandidate[] = raw.map((c) => ({
    id: c.id,
    url: c.url,
    engagement: c.engagement,
    title: c.title,
    sourceType: c.sourceType,
    publishedAt: c.publishedAt ? c.publishedAt.toISOString() : null,
  }));

  const deduped = dedupCandidates(rankCandidatesInput);
  logger.info(
    {
      event: "run.dedup",
      runId,
      inputCount: raw.length,
      outputCount: deduped.length,
    },
    "run.dedup",
  );

  await deps.runState.setStage(runId, "ranking");

  let rankResult: RankResult;
  try {
    rankResult = await deps.rankFn(deduped, { topN, runId });
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

  await deps.runState.update(runId, (prev) => ({
    ...prev,
    stage: "completed",
    status: "completed",
    rankedItems: rankResult.rankedItems,
    completedAt: new Date().toISOString(),
  }));

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
  db?: AppDb;
  loadFn?: LoadCandidatesFn;
  rankFn?: RankFn;
}

export function createRunProcessWorker(
  options: CreateRunProcessWorkerOptions = {},
): Worker<RunProcessJobData, RunProcessResult> {
  const connection = options.connection ?? createRedisConnection();
  const runState = options.runState ?? createRunStateService(connection);
  const db = options.db ?? getDb();
  const loadFn = options.loadFn ?? loadCandidatesSince;
  const rankFn: RankFn =
    options.rankFn ?? ((candidates, opts) => rankCandidates(candidates, opts));

  const deps: RunProcessDeps = { runState, db, loadFn, rankFn };

  return new Worker<RunProcessJobData, RunProcessResult>(
    "processing",
    (job) => handleRunProcessJob(deps, job as RunProcessJobLike),
    { connection },
  );
}
