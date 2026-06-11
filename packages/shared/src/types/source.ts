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
