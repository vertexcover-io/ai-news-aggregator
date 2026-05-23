import { SOURCE_TYPE_ORDER } from "@newsletter/shared/constants";
import type { SourceType, UserSettings } from "@newsletter/shared";
import type {
  ConfiguredRow,
  ConfiguredSection,
  SourceFailureSummary,
  SourcesSummaryResponse,
  SourcesSummaryRow,
  SourcesSummarySection,
} from "@newsletter/shared/types";
import type {
  RawItemsRepo,
  RawItemsAggregateRow,
} from "@api/repositories/raw-items.js";
import type {
  RangeFailureEntry,
  RecentSourceTelemetryEntry,
  RunArchivesRepo,
} from "@api/repositories/run-archives.js";
import type { UserSettingsRepo } from "@api/repositories/user-settings.js";

export interface SourcesSummaryDeps {
  rawItemsRepo: Pick<RawItemsRepo, "aggregateBySourceAndIdentifier">;
  runArchivesRepo: Pick<
    RunArchivesRepo,
    | "getReviewedDigestCountsByDerivedSource"
    | "getRecentSourceTelemetry"
    | "getSourceFailuresInRange"
    | "countCompletedRunsInRange"
  >;
  userSettingsRepo: Pick<UserSettingsRepo, "get">;
  from: Date;
  to: Date;
  now?: () => Date;
}

export async function buildSourcesSummary(
  deps: SourcesSummaryDeps,
): Promise<SourcesSummaryResponse> {
  const now = deps.now?.() ?? new Date();
  const range = { from: deps.from, to: deps.to };

  const [agg, digestCounts, telemetry, failures, runsInRange, settings] =
    await Promise.all([
      deps.rawItemsRepo.aggregateBySourceAndIdentifier(range),
      deps.runArchivesRepo.getReviewedDigestCountsByDerivedSource(range),
      deps.runArchivesRepo.getRecentSourceTelemetry(range),
      deps.runArchivesRepo.getSourceFailuresInRange(range),
      deps.runArchivesRepo.countCompletedRunsInRange(range),
      deps.userSettingsRepo.get(),
    ]);

  const configured = buildConfigured(settings);
  const configuredKeys = configuredKeySet(configured);

  const failuresByKey = new Map<string, RangeFailureEntry>();
  for (const f of failures) {
    failuresByKey.set(`${f.sourceType} ${f.identifier}`, f);
  }

  const bySourceType = new Map<SourceType, SourcesSummaryRow[]>();
  for (const a of agg) {
    if (!configuredKeys.has(`${a.sourceType} ${a.identifier}`)) continue;
    const row = buildRow(a, digestCounts, telemetry, failuresByKey);
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
    range: {
      from: deps.from.toISOString(),
      to: deps.to.toISOString(),
      runsInRange,
    },
    sections,
    configured,
    failures: failures.map(toFailureSummary),
    rankingPrompt: settings?.rankingPrompt ?? "",
  };
}

function buildRow(
  a: RawItemsAggregateRow,
  digestCounts: Map<string, number>,
  telemetry: Map<string, RecentSourceTelemetryEntry>,
  failuresByKey: Map<string, RangeFailureEntry>,
): SourcesSummaryRow {
  const key = `${a.sourceType} ${a.identifier}`;
  const tele = telemetry.get(key);
  const fail = failuresByKey.get(key);
  return {
    identifier: a.identifier,
    displayName: tele?.displayName ?? a.identifier,
    url: a.url,
    fetchedCount: a.fetchedCount,
    usedCount: digestCounts.get(key) ?? 0,
    failureCount: fail?.runsAffected ?? 0,
    lastFailureMessage: fail?.lastErrorMessage ?? null,
  };
}

function compareRows(x: SourcesSummaryRow, y: SourcesSummaryRow): number {
  return x.displayName
    .toLowerCase()
    .localeCompare(y.displayName.toLowerCase());
}

function toFailureSummary(f: RangeFailureEntry): SourceFailureSummary {
  return {
    sourceType: f.sourceType,
    identifier: f.identifier,
    displayName: f.displayName,
    runsAffected: f.runsAffected,
    lastErrorMessage: f.lastErrorMessage,
    lastFailedAt: f.lastFailedAt.toISOString(),
  };
}

function configuredKeySet(sections: ConfiguredSection[]): Set<string> {
  const keys = new Set<string>();
  for (const s of sections) {
    // web_search aggregates under a single identifier in raw_items —
    // include every web_search row regardless of identifier match.
    if (s.sourceType === "web_search" && s.rows.length > 0) {
      keys.add(`web_search web search`);
      continue;
    }
    for (const r of s.rows) {
      if (r.identifier.length === 0) continue;
      keys.add(`${s.sourceType} ${r.identifier}`);
    }
  }
  return keys;
}

function buildConfigured(settings: UserSettings | null): ConfiguredSection[] {
  if (!settings) return [];
  const out: ConfiguredSection[] = [];

  if (settings.hnEnabled) {
    out.push({
      sourceType: "hn",
      rows: [
        {
          identifier: "news.ycombinator.com",
          displayName: "Hacker News",
          url: "https://news.ycombinator.com",
        },
      ],
    });
  }

  if (settings.redditEnabled && settings.redditConfig) {
    const rows: ConfiguredRow[] = settings.redditConfig.subreddits
      .map((s) => s.trim().replace(/^r\//i, ""))
      .filter((s) => s.length > 0)
      .map((name) => ({
        identifier: `r/${name}`,
        displayName: `r/${name}`,
        url: `https://reddit.com/r/${name}`,
      }));
    if (rows.length > 0) out.push({ sourceType: "reddit", rows });
  }

  if (settings.twitterEnabled && settings.twitterConfig) {
    const rows: ConfiguredRow[] = settings.twitterConfig.users
      .map((u) => u.handle.trim().replace(/^@+/, ""))
      .filter((h) => h.length > 0)
      .map((handle) => ({
        identifier: `@${handle}`,
        displayName: `@${handle}`,
        url: `https://x.com/${handle}`,
      }));
    // Lists rendered with their ID as fallback name; resolver deferred.
    // Raw items collected from lists carry the @handle identifier of the
    // tweet author, not the list — so list rows have an empty identifier
    // and will never match aggregated raw_items. That's correct: list
    // membership is rendered for the reader, but the volume metrics
    // attribute to the per-handle row.
    for (const id of settings.twitterConfig.listIds) {
      const trimmed = id.trim();
      if (trimmed.length === 0) continue;
      rows.push({
        identifier: "",
        displayName: `List #${trimmed}`,
        url: `https://x.com/i/lists/${trimmed}`,
      });
    }
    if (rows.length > 0) out.push({ sourceType: "twitter", rows });
  }

  if (settings.webEnabled && settings.webConfig) {
    const rows: ConfiguredRow[] = settings.webConfig.sources
      .filter((s) => s.name.trim().length > 0 && s.listingUrl.length > 0)
      .map((s) => ({
        identifier: hostnameOf(s.listingUrl),
        displayName: s.name,
        url: s.listingUrl,
      }))
      .filter((r) => r.identifier.length > 0);
    if (rows.length > 0) out.push({ sourceType: "blog", rows });
  }

  if (settings.webSearchEnabled && settings.webSearchConfig) {
    const rows: ConfiguredRow[] = settings.webSearchConfig.queries
      .map((q) => q.query.trim())
      .filter((q) => q.length > 0)
      .map((q) => ({ identifier: "", displayName: `"${q}"`, url: null }));
    if (rows.length > 0) out.push({ sourceType: "web_search", rows });
  }

  out.sort(
    (a, b) =>
      SOURCE_TYPE_ORDER.indexOf(a.sourceType) -
      SOURCE_TYPE_ORDER.indexOf(b.sourceType),
  );
  for (const s of out) {
    s.rows.sort((x, y) =>
      x.displayName
        .toLowerCase()
        .localeCompare(y.displayName.toLowerCase()),
    );
  }
  return out;
}

// Mirror the SQL hostname extraction (lowercased, www-stripped). Returns
// empty string on a non-URL input so the caller can drop the row.
function hostnameOf(value: string): string {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host.replace(/^www\./, "");
  } catch {
    return "";
  }
}
