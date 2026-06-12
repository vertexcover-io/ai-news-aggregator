/**
 * Per-tenant normalized sources (P8, REQ-070/072/074).
 *
 * One `sources` row = one collectable identity (a subreddit, a blog listing
 * URL, a Twitter handle/list, the HN firehose, a web-search query) — the
 * granularity the Settings sources panel lists/toggles and discovery (P11)
 * adds to. The row's `type` column is a `SourceType`; `config` is the typed
 * JSONB payload below (D-103), discriminated by `kind` because one
 * SourceType ("twitter") has two shapes (user vs list).
 *
 * The pipeline keeps reading the legacy `user_settings.*Config` JSONB until
 * P9 flips collection onto enabled source rows (REQ-073) — until then the
 * table is additive and collection behavior is unchanged.
 */
import type { SourceType } from "../db/schema.js";
import type {
  RunCollectorsPayload,
  RunSubmitTwitterUser,
  RunSubmitWebSource,
  WebSearchQueryConfig,
} from "./run.js";

/** Whole-feed HN source (one row per tenant at most, lifted from hnConfig). */
export interface HnSourceConfig {
  kind: "hn";
  keywords?: string[];
  pointsThreshold?: number;
  sinceDays: number;
  feeds?: ("newest" | "best")[];
  count?: number;
  commentsPerItem?: number;
}

/** One subreddit per row (lifted from redditConfig.subreddits[]). */
export interface RedditSourceConfig {
  kind: "reddit";
  subreddit: string;
  sort?: "hot" | "new" | "top";
  limit?: number;
  sinceDays: number;
}

/** One followed account per row (lifted from twitterConfig.users[]). */
export interface TwitterUserSourceConfig {
  kind: "twitter_user";
  handle: string;
  /** Resolved by the Rettiwt handle resolver; absent until first resolution. */
  userId?: string;
  maxTweetsPerSource?: number;
  sinceHours?: number;
}

/** One list per row (lifted from twitterConfig.listIds[]). */
export interface TwitterListSourceConfig {
  kind: "twitter_list";
  listId: string;
  maxTweetsPerSource?: number;
  sinceHours?: number;
}

/** One crawled listing page per row (lifted from webConfig.sources[]). */
export interface WebSourceConfig {
  kind: "web";
  name: string;
  listingUrl: string;
  maxItems?: number;
  sinceDays?: number;
}

/** One search query per row (lifted from webSearchConfig.queries[]). */
export interface WebSearchSourceConfig {
  kind: "web_search";
  provider: "tavily";
  query: string;
  sinceDays: number;
  maxItems: number;
}

export type SourceConfig =
  | HnSourceConfig
  | RedditSourceConfig
  | TwitterUserSourceConfig
  | TwitterListSourceConfig
  | WebSourceConfig
  | WebSearchSourceConfig;

/** Last health-check snapshot for a source row (populated by collector health). */
export interface SourceHealth {
  status: "ok" | "warn" | "error";
  detail?: string;
  checkedAt: string;
}

/** Wire shape of one tenant source for the Settings panel (GET /api/sources). */
export interface TenantSourceWire {
  id: string;
  type: SourceType;
  name: string;
  config: SourceConfig;
  enabled: boolean;
  health: SourceHealth | null;
  createdAt: string;
  updatedAt: string;
}

/** Source types addable from the Settings "Add manually" control. */
export const MANUAL_SOURCE_TYPES = [
  "blog",
  "rss",
  "newsletter",
  "github",
  "reddit",
  "hn",
  "twitter",
  "web_search",
] as const satisfies readonly SourceType[];

export type ManualSourceType = (typeof MANUAL_SOURCE_TYPES)[number];

function requireValue(value: string, what: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${what} is required`);
  }
  return trimmed;
}

function requireListingUrl(value: string): string {
  const trimmed = requireValue(value, "listing URL");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`invalid listing URL: ${trimmed}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`invalid listing URL: ${trimmed}`);
  }
  return trimmed;
}

/**
 * Map the Settings panel's manual-add inputs (type select + single text
 * input) to a typed source config. Throws `Error` with a human-readable
 * message on invalid input — the API route surfaces it as a 400.
 */
export function buildSourceConfig(
  type: ManualSourceType,
  value: string,
): SourceConfig {
  switch (type) {
    case "hn":
      return { kind: "hn", sinceDays: 1 };
    case "reddit": {
      const subreddit = requireValue(value, "subreddit")
        .replace(/^\/?(r\/)?/i, "")
        .replace(/\/+$/, "");
      return { kind: "reddit", subreddit: requireValue(subreddit, "subreddit"), sinceDays: 1 };
    }
    case "twitter": {
      const handle = requireValue(value, "handle").replace(/^@/, "");
      return { kind: "twitter_user", handle: requireValue(handle, "handle") };
    }
    case "web_search":
      return {
        kind: "web_search",
        provider: "tavily",
        query: requireValue(value, "query"),
        sinceDays: 7,
        maxItems: 10,
      };
    case "blog":
    case "rss":
    case "newsletter":
    case "github": {
      const listingUrl = requireListingUrl(value);
      return { kind: "web", name: new URL(listingUrl).hostname, listingUrl };
    }
  }
}

/** Web collector default page budget when no row specifies one (UI default). */
const DEFAULT_WEB_MAX_ITEMS = 10;

function firstDefined<T>(values: (T | undefined)[]): T | undefined {
  return values.find((v) => v !== undefined);
}

/**
 * Map a tenant's enabled `sources` ROW configs to the run's collectors
 * payload (P9, REQ-073) — the exact inverse of the P8 JSONB→rows lift
 * (packages/scripts/src/lift-sources.ts):
 *
 * - one `hn` row → collectors.hn (first hn row wins; at most one per tenant)
 * - reddit rows  → one config aggregating subreddits[]; scalar options
 *   (sort/limit/sinceDays) come from the first row that defines them
 * - `web`-kind rows (blog/rss/newsletter/github types) → web.sources[];
 *   maxItems = max across rows (lift stamped the shared legacy value on
 *   every row), defaulting to the Settings-panel default
 * - twitter rows → users[] + listIds[]; users without a resolved `userId`
 *   are skipped (the collector fetches timelines by id, not handle)
 * - web_search rows → queries[]
 *
 * Pass only ENABLED rows — disabled rows must not collect (REQ-073).
 */
export function collectorsFromSources(
  rowConfigs: readonly SourceConfig[],
): RunCollectorsPayload {
  const collectors: RunCollectorsPayload = {};

  const hn = rowConfigs.find((c): c is HnSourceConfig => c.kind === "hn");
  if (hn) {
    const { kind: _kind, ...config } = hn;
    collectors.hn = config;
  }

  const reddit = rowConfigs.filter(
    (c): c is RedditSourceConfig => c.kind === "reddit",
  );
  if (reddit.length > 0) {
    const sort = firstDefined(reddit.map((r) => r.sort));
    const limit = firstDefined(reddit.map((r) => r.limit));
    collectors.reddit = {
      subreddits: reddit.map((r) => r.subreddit),
      ...(sort !== undefined ? { sort } : {}),
      ...(limit !== undefined ? { limit } : {}),
      sinceDays: firstDefined(reddit.map((r) => r.sinceDays)) ?? 1,
    };
  }

  const web = rowConfigs.filter((c): c is WebSourceConfig => c.kind === "web");
  if (web.length > 0) {
    const sources: RunSubmitWebSource[] = web.map((w) => ({
      name: w.name,
      listingUrl: w.listingUrl,
    }));
    const maxItemsValues = web
      .map((w) => w.maxItems)
      .filter((v): v is number => v !== undefined);
    const sinceDays = firstDefined(web.map((w) => w.sinceDays));
    collectors.web = {
      sources,
      maxItems:
        maxItemsValues.length > 0
          ? Math.max(...maxItemsValues)
          : DEFAULT_WEB_MAX_ITEMS,
      ...(sinceDays !== undefined ? { sinceDays } : {}),
    };
  }

  const twitterUsers = rowConfigs.filter(
    (c): c is TwitterUserSourceConfig => c.kind === "twitter_user",
  );
  const twitterLists = rowConfigs.filter(
    (c): c is TwitterListSourceConfig => c.kind === "twitter_list",
  );
  const users: RunSubmitTwitterUser[] = twitterUsers
    .filter((u): u is TwitterUserSourceConfig & { userId: string } =>
      u.userId !== undefined && u.userId !== "",
    )
    .map((u) => ({ handle: u.handle, userId: u.userId }));
  const listIds = twitterLists.map((l) => l.listId);
  if (users.length > 0 || listIds.length > 0) {
    const twitterRows = [...twitterUsers, ...twitterLists];
    const maxTweetsPerSource = firstDefined(
      twitterRows.map((t) => t.maxTweetsPerSource),
    );
    const sinceHours = firstDefined(twitterRows.map((t) => t.sinceHours));
    collectors.twitter = {
      listIds,
      users,
      ...(maxTweetsPerSource !== undefined ? { maxTweetsPerSource } : {}),
      ...(sinceHours !== undefined ? { sinceHours } : {}),
    };
  }

  const webSearch = rowConfigs.filter(
    (c): c is WebSearchSourceConfig => c.kind === "web_search",
  );
  if (webSearch.length > 0) {
    const queries: WebSearchQueryConfig[] = webSearch.map((q) => ({
      query: q.query,
      sinceDays: q.sinceDays,
      maxItems: q.maxItems,
    }));
    collectors.webSearch = { provider: "tavily", queries };
  }

  return collectors;
}

/** True when a collectors payload would collect nothing (no run worth starting). */
export function hasAnyCollector(collectors: RunCollectorsPayload): boolean {
  return (
    collectors.hn !== undefined ||
    collectors.reddit !== undefined ||
    collectors.web !== undefined ||
    collectors.twitter !== undefined ||
    collectors.webSearch !== undefined
  );
}

/** Display label for one source row in the Settings panel / onboarding list. */
export function sourceDisplayName(config: SourceConfig): string {
  switch (config.kind) {
    case "hn":
      return "Hacker News";
    case "reddit":
      return `r/${config.subreddit}`;
    case "twitter_user":
      return `@${config.handle}`;
    case "twitter_list":
      return `List ${config.listId}`;
    case "web":
      return config.name;
    case "web_search":
      return `“${config.query}”`;
  }
}
