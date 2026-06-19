import type { EnrichmentTelemetry, RunStatus } from "./run.js";
import type { RunCostBreakdown } from "./cost-breakdown.js";

export type RunLogLevel = "debug" | "info" | "warn" | "error";

export type RunLogEvent =
  | "run.started"
  | "stage.start"
  | "stage.end"
  | "stage.result"
  | "source.completed"
  | "source.failed"
  | "enrichment.summary"
  | "link_enrichment.failed"
  | "collector.web.listing_completed"
  | "collector.web.listing_failed"
  | "collector.web.discovery_failed"
  | "collector.web.detail_failed"
  | "collector.web.all_failed"
  | "collector.web.completed"
  | "web.extract.start"
  | "web.extract.done"
  | "crawler.stats"
  | "crawler.proxy_fallback_done"
  | "run.completed"
  | "run.failed"
  | "run.cancelled";

export interface RunLogContext {
  durationMs?: number;
  inputCount?: number;
  outputCount?: number;
  itemsFetched?: number;
  errors?: string[];
  stack?: string;
  errorClass?: string;
  fatal?: boolean;
  retries?: number;
  enrichment?: EnrichmentTelemetry;
  [key: string]: unknown;
}

export interface RunLogEntry {
  id: number;
  runId: string;
  ts: string;
  level: RunLogLevel;
  stage: string;
  source: string | null;
  event: RunLogEvent;
  message: string;
  context: RunLogContext | null;
}

export type RunLogInsert = Omit<RunLogEntry, "id" | "ts" | "runId">;

export interface RunFunnel {
  collected: number | null;
  deduped: number | null;
  shortlisted: number | null;
  ranked: number | null;
}

export interface RunObservabilityStage {
  stage: string;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
}

export interface RunObservabilitySource {
  sourceType: string;
  identifier: string;
  displayName: string;
  itemsFetched: number;
  status: "completed" | "failed" | "partial" | "running" | "pending";
  errors: string[];
  retries: number;
  durationMs: number | null;
}

export interface RunObservability {
  run: {
    runId: string;
    status: RunStatus;
    stage: string;
    startedAt: string | null;
    completedAt: string | null;
    isDryRun: boolean;
    reviewed: boolean;
  };
  funnel: RunFunnel;
  sources: RunObservabilitySource[];
  enrichment: EnrichmentTelemetry | null;
  stages: RunObservabilityStage[];
  cost: RunCostBreakdown | null;
  logs: RunLogEntry[];
  failures: RunLogEntry[];
  live: boolean;
}

export type ItemEnrichStatus = "ok" | "skipped" | "failed" | "none";
export type ItemDedupStatus = "survived" | "dropped";
export type ItemFurthestStage =
  | "ranked"
  | "shortlisted"
  | "deduped-survivor"
  | "dedup-dropped"
  | "enrich-failed"
  | "fetched";

export interface ItemLifecycle {
  fetched: true;
  enrich: { status: ItemEnrichStatus; reason: string | null };
  dedup: {
    status: ItemDedupStatus;
    winnerTitle: string | null;
    winnerId: number | null;
    winnerPoints: number | null;
  } | null;
  shortlisted: boolean | null;
  rank: number | null;
}

export interface RunSourceItem {
  id: number;
  title: string;
  url: string | null;
  author: string | null;
  engagement: { points: number; commentCount: number };
  publishedAt: string | null;
  sourceIdentifier: string;
  lifecycle: ItemLifecycle;
  furthestStage: ItemFurthestStage;
  dropReason: string | null;
}

export interface RunSourceItemsSummary {
  ranked: number;
  shortlisted: number;
  dedupedSurvivors: number;
  dedupDropped: number;
  enrichFailed: number;
}

export interface RunSourceItemsResponse {
  runId: string;
  sourceKey: string;
  live: boolean;
  summary: RunSourceItemsSummary;
  items: RunSourceItem[];
  logs: RunLogEntry[];
}
