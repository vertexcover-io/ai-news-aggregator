import type IORedis from "ioredis";
import { runKey } from "@newsletter/shared";
import {
  buildSourceSteps,
  classifyItemLifecycle,
  classifyLogStep,
  orderSourceItems,
  summarizeSourceItems,
} from "@newsletter/shared/services";
import type {
  RunLogEntry,
  RunSourceItemsResponse,
  RunState,
  RunStatus,
} from "@newsletter/shared/types";
import type { SourceType } from "@newsletter/shared/db";
import { computeDedupGroups } from "@newsletter/pipeline/eval";
import type { RawItemWithEnrichment, RawItemsRepo } from "@api/repositories/raw-items.js";
import type { RunArchivesRepo } from "@api/repositories/run-archives.js";
import type { RunLogRepo } from "@api/repositories/run-logs.js";
import { NotFoundError } from "@api/lib/errors.js";

export class InvalidSourceKeyError extends Error {
  constructor(sourceKey: string) {
    super(`invalid sourceKey: ${sourceKey}`);
    this.name = "InvalidSourceKeyError";
  }
}

export interface BuildRunSourceItemsDeps {
  readonly redis: Pick<IORedis, "get">;
  readonly archiveRepo: Pick<RunArchivesRepo, "findById">;
  readonly rawItemsRepo: Pick<RawItemsRepo, "listForRunWithEnrichment">;
  readonly runLogRepo: Pick<RunLogRepo, "listForRunSource">;
}

const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>([
  "completed",
  "failed",
  "cancelled",
]);

const SOURCE_TYPES: ReadonlySet<string> = new Set<SourceType>([
  "hn",
  "reddit",
  "twitter",
  "rss",
  "github",
  "blog",
  "newsletter",
  "web_search",
]);

interface ParsedSourceKey {
  readonly sourceType: SourceType;
  readonly identifier: string;
  readonly value: string;
}

export async function buildRunSourceItems(
  runId: string,
  sourceKey: string,
  deps: BuildRunSourceItemsDeps,
): Promise<RunSourceItemsResponse> {
  const parsedSource = parseSourceKey(sourceKey);
  const [stateRaw, archive] = await Promise.all([
    deps.redis.get(runKey(runId)),
    deps.archiveRepo.findById(runId),
  ]);
  const runState = parseRunState(stateRaw);

  if (runState === null && archive === null) {
    throw new NotFoundError(`run not found: ${runId}`);
  }

  const [pool, logs] = await Promise.all([
    deps.rawItemsRepo.listForRunWithEnrichment(runId, {
      archiveRepo: deps.archiveRepo,
      redis: deps.redis,
    }),
    deps.runLogRepo.listForRunSource(runId, parsedSource),
  ]);

  const dedupGroups = computeDedupGroups(pool);
  const rankByItemId = new Map(
    (archive?.rankedItems ?? []).map((item, index) => [item.rawItemId, index + 1]),
  );
  const live = runState !== null && !TERMINAL_STATUSES.has(runState.status);
  const shortlistedIds = archive?.shortlistedItemIds ?? null;
  const sourceItems = pool
    .filter(
      (item) =>
        item.sourceType === parsedSource.sourceType &&
        // Prefer the stamped collection-unit identity (matches the Source
        // Telemetry row exactly — fixes hn/twitter where the URL-derived
        // identity differs); fall back to the derived identity for legacy
        // items that predate metadata.sourceUnit.
        (item.sourceUnitIdentifier === parsedSource.identifier ||
          item.sourceIdentifier === parsedSource.identifier),
    )
    .map((item) =>
      classifyItemLifecycle({
        id: item.id,
        title: item.title,
        url: item.url,
        author: item.author,
        engagement: item.engagement,
        publishedAt: item.publishedAt,
        sourceIdentifier: item.sourceIdentifier,
        enrichedLink: item.enrichedLink,
        dedup: dedupStatusFor(item, dedupGroups),
        shortlistedIds,
        rankByItemId,
        live,
      }),
    );
  const items = orderSourceItems(sourceItems);
  const summary = summarizeSourceItems(items);
  // Stamp the resolved extraction step on each log so the frontend can filter
  // the log strip by step without re-implementing the classifier (single
  // source of truth lives in classifyLogStep).
  const stampedLogs: RunLogEntry[] = logs.map((entry) => {
    const step = classifyLogStep(entry.event, entry.context);
    if (step === null) return entry;
    return { ...entry, context: { ...(entry.context ?? {}), step } };
  });

  return {
    runId,
    sourceKey: parsedSource.value,
    live,
    summary,
    steps: buildSourceSteps({ logs: stampedLogs, summary, itemCount: items.length }),
    items,
    logs: stampedLogs,
  };
}

function parseRunState(raw: string | null): RunState | null {
  return raw === null ? null : (JSON.parse(raw) as RunState);
}

function parseSourceKey(sourceKey: string): ParsedSourceKey {
  const decoded = decodeSourceKey(sourceKey);
  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === decoded.length - 1) {
    throw new InvalidSourceKeyError(sourceKey);
  }

  const sourceType = decoded.slice(0, separatorIndex);
  let identifier = decoded.slice(separatorIndex + 1);
  if (!SOURCE_TYPES.has(sourceType)) {
    throw new InvalidSourceKeyError(sourceKey);
  }

  // Legacy compatibility: web_search runs archived before the source-identifier
  // alignment fix emitted unit.identifier = "web_search:<query>", which the web
  // UI concatenated into a double-prefixed sourceKey ("web_search:web_search:<q>").
  // Strip the redundant "<sourceType>:" prefix so legacy archives still resolve.
  const redundantPrefix = `${sourceType}:`;
  if (identifier.startsWith(redundantPrefix)) {
    identifier = identifier.slice(redundantPrefix.length);
  }

  // Reddit subreddit names are case-insensitive; canonicalise the "r/<name>"
  // segment to lowercase so user-configured mixed-case ("r/Google_antigravity")
  // resolves against URL-derived lowercase identifiers ("r/google_antigravity").
  if (sourceType === "reddit" && identifier.toLowerCase().startsWith("r/")) {
    identifier = identifier.toLowerCase();
  }

  return {
    sourceType: sourceType as SourceType,
    identifier,
    value: `${sourceType}:${identifier}`,
  };
}

function decodeSourceKey(sourceKey: string): string {
  try {
    return decodeURIComponent(sourceKey);
  } catch {
    throw new InvalidSourceKeyError(sourceKey);
  }
}

function dedupStatusFor(
  item: RawItemWithEnrichment,
  dedupGroups: ReturnType<typeof computeDedupGroups>,
): {
  readonly status: "survived" | "dropped";
  readonly winnerTitle: string | null;
  readonly winnerId: number | null;
  readonly winnerPoints: number | null;
} | null {
  if (dedupGroups.survivorIds.has(item.id)) {
    return { status: "survived", winnerTitle: null, winnerId: null, winnerPoints: null };
  }

  const winner = dedupGroups.droppedToWinner.get(item.id);
  if (winner === undefined) return null;

  return {
    status: "dropped",
    winnerTitle: winner.winnerTitle,
    winnerId: winner.winnerId,
    winnerPoints: winner.winnerPoints,
  };
}
