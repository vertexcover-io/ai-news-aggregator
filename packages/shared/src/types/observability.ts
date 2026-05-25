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
