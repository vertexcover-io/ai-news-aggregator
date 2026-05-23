import { SOURCE_TYPE_ORDER } from "@newsletter/shared/constants";
import type { SourceType } from "@newsletter/shared";
import type {
  SourcesSummaryResponse,
  SourcesSummaryRow,
  SourcesSummarySection,
} from "@newsletter/shared/types";
import type {
  RawItemsRepo,
  RawItemsAggregateRow,
} from "@api/repositories/raw-items.js";
import type {
  RunArchivesRepo,
  RecentSourceTelemetryEntry,
} from "@api/repositories/run-archives.js";
import type { UserSettingsRepo } from "@api/repositories/user-settings.js";

export interface SourcesSummaryDeps {
  rawItemsRepo: Pick<RawItemsRepo, "aggregateBySourceAndIdentifier">;
  runArchivesRepo: Pick<
    RunArchivesRepo,
    "getReviewedDigestCountsByDerivedSource" | "getRecentSourceTelemetry"
  >;
  userSettingsRepo: Pick<UserSettingsRepo, "get">;
  now?: () => Date;
}

const TELEMETRY_LOOKBACK_DAYS = 14;
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export async function buildSourcesSummary(
  deps: SourcesSummaryDeps,
): Promise<SourcesSummaryResponse> {
  const now = deps.now?.() ?? new Date();
  const sinceToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const sinceWeek = new Date(now.getTime() - SEVEN_DAYS_MS);

  const [agg, digestCounts, telemetry, settings] = await Promise.all([
    deps.rawItemsRepo.aggregateBySourceAndIdentifier({ sinceWeek, sinceToday }),
    deps.runArchivesRepo.getReviewedDigestCountsByDerivedSource({ sinceWeek }),
    deps.runArchivesRepo.getRecentSourceTelemetry({
      sinceDays: TELEMETRY_LOOKBACK_DAYS,
    }),
    deps.userSettingsRepo.get(),
  ]);

  const bySourceType = new Map<SourceType, SourcesSummaryRow[]>();
  for (const a of agg) {
    const row = buildRow(a, digestCounts, telemetry, now);
    const existing = bySourceType.get(a.sourceType) ?? [];
    existing.push(row);
    bySourceType.set(a.sourceType, existing);
  }

  const sections: SourcesSummarySection[] = [];
  for (const sourceType of SOURCE_TYPE_ORDER) {
    const rows = bySourceType.get(sourceType);
    if (!rows || rows.length === 0) continue;
    rows.sort(compareRows);
    sections.push({ sourceType, rows });
  }

  return {
    generatedAt: now.toISOString(),
    sections,
    rankingPrompt: settings?.rankingPrompt ?? "",
  };
}

function buildRow(
  a: RawItemsAggregateRow,
  digestCounts: Map<string, number>,
  telemetry: Map<string, RecentSourceTelemetryEntry>,
  now: Date,
): SourcesSummaryRow {
  const key = `${a.sourceType} ${a.identifier}`;
  const tele = telemetry.get(key);
  return {
    identifier: a.identifier,
    displayName: tele?.displayName ?? a.identifier,
    url: a.url,
    todayCount: a.todayCount,
    weekCount: a.weekCount,
    inDigestCount: digestCounts.get(key) ?? 0,
    status: classifyStatus(tele, a.lastCollectedAt, now),
    lastFetchedAt: a.lastCollectedAt?.toISOString() ?? null,
  };
}

function compareRows(x: SourcesSummaryRow, y: SourcesSummaryRow): number {
  if (y.todayCount !== x.todayCount) return y.todayCount - x.todayCount;
  return x.displayName
    .toLowerCase()
    .localeCompare(y.displayName.toLowerCase());
}

function classifyStatus(
  tele: RecentSourceTelemetryEntry | undefined,
  lastFetched: Date | null,
  now: Date,
): "healthy" | "idle" | "failing" {
  const fourteenDaysAgo = new Date(now.getTime() - FOURTEEN_DAYS_MS);
  if (
    tele?.status === "completed" &&
    tele.itemsFetched > 0 &&
    lastFetched !== null &&
    lastFetched >= fourteenDaysAgo
  ) {
    return "healthy";
  }
  if (
    tele?.status === "failed" ||
    lastFetched === null ||
    lastFetched < fourteenDaysAgo
  ) {
    return "failing";
  }
  return "idle";
}
