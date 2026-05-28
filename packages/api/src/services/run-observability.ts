import type IORedis from "ioredis";
import { runKey } from "@newsletter/shared";
import type {
  EnrichmentTelemetry,
  RunCostBreakdown,
  RunFunnel,
  RunLogEntry,
  RunObservability,
  RunObservabilitySource,
  RunObservabilityStage,
  RunStage,
  RunState,
  RunStatus,
} from "@newsletter/shared";
import type { RunArchiveRow, RunArchivesRepo } from "@api/repositories/run-archives.js";
import type { RunLogRepo } from "@api/repositories/run-logs.js";
import { NotFoundError } from "@api/lib/errors.js";

export interface BuildRunObservabilityDeps {
  redis: Pick<IORedis, "get">;
  archiveRepo: Pick<RunArchivesRepo, "findById">;
  runLogRepo: RunLogRepo;
}

export const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>([
  "completed",
  "failed",
  "cancelled",
]);

const SOURCE_KEY_TO_TYPE: Partial<Record<string, string>> = {
  hn: "hn",
  reddit: "reddit",
  twitter: "twitter",
  blog: "blog",
  rss: "rss",
  github: "github",
  newsletter: "newsletter",
  web_search: "web_search",
};

export async function buildRunObservability(
  runId: string,
  deps: BuildRunObservabilityDeps,
): Promise<RunObservability> {
  const [stateRaw, archive, logs] = await Promise.all([
    deps.redis.get(runKey(runId)),
    deps.archiveRepo.findById(runId),
    deps.runLogRepo.listForRun(runId),
  ]);

  const runState: RunState | null = stateRaw === null ? null : (JSON.parse(stateRaw) as RunState);

  if (runState === null && archive === null) {
    throw new NotFoundError(`run not found: ${runId}`);
  }

  const live = runState !== null && !TERMINAL_STATUSES.has(runState.status);

  const run = composeRun(runId, runState, archive, live);
  const funnel = live ? deriveFunnelFromLogs(logs) : composeHistoricalFunnel(archive, logs);
  const sources = live ? sourcesFromRunState(runState, logs) : sourcesFromArchive(archive);
  const enrichment = composeEnrichment(live, archive, logs);
  const stages = deriveStages(logs);
  const cost: RunCostBreakdown | null = archive?.costBreakdown ?? null;
  const failures = logs.filter((l) => l.level === "error");

  return { run, funnel, sources, enrichment, stages, cost, logs, failures, live };
}

function composeRun(
  runId: string,
  runState: RunState | null,
  archive: RunArchiveRow | null,
  live: boolean,
): RunObservability["run"] {
  const startedAt = runState?.startedAt ?? archive?.startedAt?.toISOString() ?? null;

  if (live && runState !== null) {
    return {
      runId,
      status: runState.status,
      stage: runState.stage,
      startedAt,
      completedAt: runState.completedAt,
      isDryRun: archive?.isDryRun ?? false,
      reviewed: archive?.reviewed ?? false,
    };
  }

  if (archive !== null) {
    return {
      runId,
      status: archive.status,
      stage: stageFromStatus(archive.status),
      startedAt,
      completedAt: archive.completedAt.toISOString(),
      isDryRun: archive.isDryRun,
      reviewed: archive.reviewed,
    };
  }

  // runState present but terminal, no archive yet — runState is non-null here
  // because the caller throws NotFoundError when both are null.
  if (runState === null) {
    throw new NotFoundError(`run not found: ${runId}`);
  }
  return {
    runId,
    status: runState.status,
    stage: runState.stage,
    startedAt,
    completedAt: runState.completedAt,
    isDryRun: false,
    reviewed: false,
  };
}

function stageFromStatus(status: "completed" | "failed" | "cancelled"): RunStage {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
}

function deriveFunnelFromLogs(logs: RunLogEntry[]): RunFunnel {
  const funnel: RunFunnel = {
    collected: null,
    deduped: null,
    shortlisted: null,
    ranked: null,
  };

  let collectedFromSources = 0;
  let sawSourceCompleted = false;

  for (const entry of logs) {
    if (entry.event === "source.completed") {
      const fetched = entry.context?.itemsFetched;
      if (typeof fetched === "number") {
        collectedFromSources += fetched;
        sawSourceCompleted = true;
      }
      continue;
    }
    if (entry.event === "stage.end" && entry.stage === "collecting") {
      const collected = entry.context?.outputCount ?? entry.context?.itemsFetched;
      if (typeof collected === "number") funnel.collected = collected;
      continue;
    }
    if (entry.event === "stage.result") {
      const output = entry.context?.outputCount;
      if (typeof output !== "number") continue;
      if (entry.stage === "processing") {
        funnel.deduped = output;
        const input = entry.context?.inputCount;
        if (funnel.collected === null && typeof input === "number") funnel.collected = input;
      } else if (entry.stage === "shortlisting") {
        funnel.shortlisted = output;
      } else if (entry.stage === "ranking") {
        funnel.ranked = output;
      }
    }
  }

  if (funnel.collected === null && sawSourceCompleted) {
    funnel.collected = collectedFromSources;
  }

  return funnel;
}

function composeHistoricalFunnel(archive: RunArchiveRow | null, logs: RunLogEntry[]): RunFunnel {
  if (archive?.runFunnel != null) return archive.runFunnel;
  if (logs.length > 0) return deriveFunnelFromLogs(logs);
  return { collected: null, deduped: null, shortlisted: null, ranked: null };
}

function sourcesFromRunState(
  runState: RunState,
  logs: RunLogEntry[],
): RunObservabilitySource[] {
  const logBySource = new Map<string, RunLogEntry>();
  for (const entry of logs) {
    if (entry.source !== null && (entry.event === "source.completed" || entry.event === "source.failed")) {
      logBySource.set(entry.source, entry);
    }
  }

  const sources: RunObservabilitySource[] = [];
  for (const [key, srcState] of Object.entries(runState.sources)) {
    const sourceType = SOURCE_KEY_TO_TYPE[key] ?? key;
    const logEntry = logBySource.get(key);
    sources.push({
      sourceType,
      identifier: key,
      displayName: key,
      itemsFetched: srcState.itemsFetched,
      status: srcState.status,
      errors: srcState.errors,
      retries: typeof logEntry?.context?.retries === "number" ? logEntry.context.retries : 0,
      durationMs:
        typeof logEntry?.context?.durationMs === "number" ? logEntry.context.durationMs : null,
    });
  }
  return sources;
}

function sourcesFromArchive(archive: RunArchiveRow | null): RunObservabilitySource[] {
  const telemetry = archive?.sourceTelemetry;
  if (telemetry == null) return [];
  return telemetry.sources.map((s) => ({
    sourceType: s.sourceType,
    identifier: s.identifier,
    displayName: s.displayName,
    itemsFetched: s.itemsFetched,
    status: s.status,
    errors: s.errors,
    retries: s.retries,
    durationMs: s.durationMs,
  }));
}

function composeEnrichment(
  live: boolean,
  archive: RunArchiveRow | null,
  logs: RunLogEntry[],
): EnrichmentTelemetry | null {
  if (live) {
    for (let i = logs.length - 1; i >= 0; i--) {
      const entry = logs[i];
      if (entry.event === "enrichment.summary" && entry.context?.enrichment != null) {
        return entry.context.enrichment;
      }
    }
    return null;
  }
  return archive?.sourceTelemetry?.enrichment ?? null;
}

function deriveStages(logs: RunLogEntry[]): RunObservabilityStage[] {
  const ordered: RunObservabilityStage[] = [];
  const byStage = new Map<string, RunObservabilityStage>();

  for (const entry of logs) {
    if (entry.event !== "stage.start" && entry.event !== "stage.end") continue;
    let stage = byStage.get(entry.stage);
    if (stage === undefined) {
      stage = { stage: entry.stage, startedAt: null, endedAt: null, durationMs: null };
      byStage.set(entry.stage, stage);
      ordered.push(stage);
    }
    if (entry.event === "stage.start") {
      stage.startedAt = entry.ts;
    } else {
      stage.endedAt = entry.ts;
      if (typeof entry.context?.durationMs === "number") {
        stage.durationMs = entry.context.durationMs;
      }
    }
  }

  return ordered;
}
