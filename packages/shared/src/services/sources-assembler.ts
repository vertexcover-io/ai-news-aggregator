import type {
  RunCollectorsPayload,
  RunSubmitHnConfig,
  RunSubmitRedditConfig,
  RunSubmitTwitterConfig,
  RunSubmitTwitterUser,
  RunSubmitWebConfig,
  RunSubmitWebSearchConfig,
  RunSubmitWebSource,
  WebSearchProviderName,
  WebSearchQueryConfig,
} from "../types/run.js";
import type {
  SourceRedditConfig,
  SourceTwitterConfig,
  TenantSourceType,
} from "../db/schema.js";

export interface SourceConfigByType {
  hn: RunSubmitHnConfig;
  reddit: SourceRedditConfig;
  web: RunSubmitWebSource;
  twitter: SourceTwitterConfig;
  web_search: WebSearchQueryConfig;
}

/** Minimal structural shape the assembler needs — full repo rows satisfy it. */
export type AssemblableSourceRow = {
  [K in TenantSourceType]: { type: K; config: SourceConfigByType[K] };
}[TenantSourceType];

/**
 * Collector-level tuning knobs that have no per-row slot in the sources
 * table. The 0041 lift intentionally left them behind in the retained legacy
 * user_settings JSONB columns; the assembler merges them back (tenant 0) or
 * falls back to defaults (new tenants, whose legacy columns are null).
 */
export interface LegacySourceTuning {
  webConfig?: Pick<RunSubmitWebConfig, "maxItems" | "sinceDays"> | null;
  twitterConfig?: Pick<
    RunSubmitTwitterConfig,
    "maxTweetsPerSource" | "sinceHours"
  > | null;
  webSearchConfig?: Pick<RunSubmitWebSearchConfig, "provider"> | null;
}

export const DEFAULT_WEB_MAX_ITEMS = 10;
export const DEFAULT_WEB_SEARCH_PROVIDER: WebSearchProviderName = "tavily";

function pickRows<K extends TenantSourceType>(
  rows: readonly AssemblableSourceRow[],
  type: K,
): SourceConfigByType[K][] {
  const configs: SourceConfigByType[K][] = [];
  for (const row of rows) {
    if (row.type === type) {
      configs.push(row.config as SourceConfigByType[K]);
    }
  }
  return configs;
}

function assembleReddit(
  configs: SourceRedditConfig[],
): RunSubmitRedditConfig | null {
  if (configs.length === 0) return null;
  const [first] = configs;
  return {
    subreddits: configs.map((c) => c.subreddit),
    ...(first.sort !== undefined ? { sort: first.sort } : {}),
    ...(first.limit !== undefined ? { limit: first.limit } : {}),
    sinceDays: first.sinceDays,
  };
}

function assembleWeb(
  sources: RunSubmitWebSource[],
  legacy: LegacySourceTuning,
): RunSubmitWebConfig | null {
  if (sources.length === 0) return null;
  return {
    sources,
    maxItems: legacy.webConfig?.maxItems ?? DEFAULT_WEB_MAX_ITEMS,
    ...(legacy.webConfig?.sinceDays !== undefined
      ? { sinceDays: legacy.webConfig.sinceDays }
      : {}),
  };
}

function assembleTwitter(
  configs: SourceTwitterConfig[],
  legacy: LegacySourceTuning,
): RunSubmitTwitterConfig | null {
  if (configs.length === 0) return null;
  const listIds: string[] = [];
  const users: RunSubmitTwitterUser[] = [];
  for (const config of configs) {
    if (config.kind === "list") {
      listIds.push(config.listId);
    } else {
      users.push({ handle: config.handle, userId: config.userId });
    }
  }
  return {
    listIds,
    users,
    ...(legacy.twitterConfig?.maxTweetsPerSource !== undefined
      ? { maxTweetsPerSource: legacy.twitterConfig.maxTweetsPerSource }
      : {}),
    ...(legacy.twitterConfig?.sinceHours !== undefined
      ? { sinceHours: legacy.twitterConfig.sinceHours }
      : {}),
  };
}

function assembleWebSearch(
  queries: WebSearchQueryConfig[],
  legacy: LegacySourceTuning,
): RunSubmitWebSearchConfig | null {
  if (queries.length === 0) return null;
  return {
    provider: legacy.webSearchConfig?.provider ?? DEFAULT_WEB_SEARCH_PROVIDER,
    queries,
  };
}

/**
 * The legacy user_settings columns that still carry per-source lists during
 * the transition (web settings UI migrates to /api/admin/sources in the
 * settings-panel phase, REQ-074).
 */
export interface LegacySourceSettings {
  hnEnabled: boolean;
  hnConfig: RunSubmitHnConfig | null;
  redditEnabled: boolean;
  redditConfig: RunSubmitRedditConfig | null;
  webEnabled: boolean;
  webConfig: RunSubmitWebConfig | null;
  twitterEnabled: boolean;
  twitterConfig: RunSubmitTwitterConfig | null;
  webSearchEnabled: boolean;
  webSearchConfig: RunSubmitWebSearchConfig | null;
}

export type SourceRowSeed = {
  [K in TenantSourceType]: {
    type: K;
    config: SourceConfigByType[K];
    enabled: boolean;
  };
}[TenantSourceType];

/**
 * Explode legacy user_settings source configs into per-row sources-table
 * seeds — the inverse of assembleRunConfigs and the TS mirror of the 0041
 * lift. Used by the settings write-through sync so legacy settings saves
 * keep the sources table (the runtime source of truth) consistent until the
 * web Settings panel migrates to /api/admin/sources.
 */
export function settingsToSourceRows(
  settings: LegacySourceSettings,
): SourceRowSeed[] {
  const rows: SourceRowSeed[] = [];
  if (settings.hnConfig) {
    rows.push({ type: "hn", config: settings.hnConfig, enabled: settings.hnEnabled });
  }
  if (settings.redditConfig) {
    const { subreddits, sort, limit, sinceDays } = settings.redditConfig;
    for (const subreddit of subreddits) {
      rows.push({
        type: "reddit",
        config: {
          subreddit,
          ...(sort !== undefined ? { sort } : {}),
          ...(limit !== undefined ? { limit } : {}),
          sinceDays,
        },
        enabled: settings.redditEnabled,
      });
    }
  }
  if (settings.webConfig) {
    for (const source of settings.webConfig.sources) {
      rows.push({
        type: "web",
        config: { name: source.name, listingUrl: source.listingUrl },
        enabled: settings.webEnabled,
      });
    }
  }
  if (settings.twitterConfig) {
    for (const listId of settings.twitterConfig.listIds) {
      rows.push({
        type: "twitter",
        config: { kind: "list", listId },
        enabled: settings.twitterEnabled,
      });
    }
    for (const user of settings.twitterConfig.users) {
      rows.push({
        type: "twitter",
        config: { kind: "user", handle: user.handle, userId: user.userId },
        enabled: settings.twitterEnabled,
      });
    }
  }
  if (settings.webSearchConfig) {
    for (const query of settings.webSearchConfig.queries) {
      rows.push({
        type: "web_search",
        config: query,
        enabled: settings.webSearchEnabled,
      });
    }
  }
  return rows;
}

/**
 * Convert sources-table rows (typically the tenant's enabled rows) back into
 * the RunSubmit*Config shapes the collectors consume, so collectors stay
 * untouched by the per-row sources model (REQ-070/073).
 */
export function assembleRunConfigs(
  rows: readonly AssemblableSourceRow[],
  legacySettings: LegacySourceTuning | null,
): RunCollectorsPayload {
  const legacy = legacySettings ?? {};
  const hnConfigs = pickRows(rows, "hn");
  const hn = hnConfigs.length > 0 ? hnConfigs[0] : null;
  const reddit = assembleReddit(pickRows(rows, "reddit"));
  const web = assembleWeb(pickRows(rows, "web"), legacy);
  const twitter = assembleTwitter(pickRows(rows, "twitter"), legacy);
  const webSearch = assembleWebSearch(pickRows(rows, "web_search"), legacy);

  return {
    ...(hn !== null ? { hn } : {}),
    ...(reddit !== null ? { reddit } : {}),
    ...(web !== null ? { web } : {}),
    ...(twitter !== null ? { twitter } : {}),
    ...(webSearch !== null ? { webSearch } : {}),
  };
}
