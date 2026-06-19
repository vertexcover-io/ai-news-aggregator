import type { SourceType } from "../db/schema.js";
import type { EnrichmentSkipReason, RawItemEngagement, RecapContent } from "./index.js";

export interface TweetPreview {
  kind: "tweet";
  handle: string;
  text: string;
  createdAt: string | null;
  photoUrls: string[];
  url: string;
  quoted: { handle: string; text: string } | null;
}

export interface LinkPreview {
  kind: "link";
  title: string | null;
  byline: string | null;
  description: string | null;
  imageUrl: string | null;
  domain: string | null;
  markdownExcerpt: string | null;
  url: string;
}

export interface NoPreview {
  kind: "none";
}

export type ItemPreview = TweetPreview | LinkPreview | NoPreview;

export interface EnrichmentTelemetry {
  attempted: number;
  ok: number;
  failed: number;
  skipped: number;
  cacheHits: number;
  avgFetchMs: number;
  skippedReasons: Partial<Record<EnrichmentSkipReason, number>>;
}

export type RunStatus = "running" | "completed" | "failed" | "cancelling" | "cancelled";

export type RunStage =
  | "queued"
  | "collecting"
  | "processing"
  | "shortlisting"
  | "ranking"
  | "completed"
  | "failed"
  | "cancelled";

export type SourceStatus = "pending" | "running" | "completed" | "failed";

export interface SourceRunState {
  status: SourceStatus;
  itemsFetched: number;
  errors: string[];
}

export interface RankedItem {
  id: number;
  rawItemId: number;
  title: string;
  url: string;
  sourceType: SourceType;
  author: string | null;
  publishedAt: string | null;
  engagement: { points: number; commentCount: number };
  score: number;
  rationale: string;
  content: string | null;
  imageUrl: string | null;
  recap: RecapContent | null;
  enrichedSource: { hostname: string; url: string } | null;
  sourceIdentifier: string;
  preview: ItemPreview;
}

export interface RankedItemRef {
  rawItemId: number;
  score: number;
  rationale: string;
  title?: string;
  summary?: string;
  bullets?: string[];
  bottomLine?: string;
  imageUrl?: string | null;
}

export interface RunState {
  id: string;
  status: RunStatus;
  stage: RunStage;
  topN: number;
  startedAt: string;
  issueDate?: string;
  updatedAt: string;
  completedAt: string | null;
  sources: {
    hn?: SourceRunState;
    reddit?: SourceRunState;
    blog?: SourceRunState;
    twitter?: SourceRunState;
    web_search?: SourceRunState;
  };
  rankedItems: RankedItemRef[] | null;
  shortlistedItemIds: number[] | null;
  warnings: string[];
  error: string | null;
  /**
   * Owning tenant (REQ-013): stamped by `startRun` when the start path knows
   * its tenant; API run-state reads/cancels 404 across the fence. Optional
   * for states written before the stamp existed (grandfathered readable).
   */
  tenantId?: string;
}

/**
 * Payload submitted by the /run frontend. Collector-specific config types live
 * in @newsletter/pipeline and are re-declared here as structural types to avoid
 * a web→pipeline dependency.
 */
export interface RunSubmitHnConfig {
  keywords?: string[];
  pointsThreshold?: number;
  sinceDays: number;
  feeds?: ("newest" | "best")[];
  count?: number;
  commentsPerItem?: number;
}

export interface RunSubmitRedditConfig {
  subreddits: string[];
  sort?: "hot" | "new" | "top";
  limit?: number;
  sinceDays: number;
}

export interface RunSubmitWebSource {
  name: string;
  listingUrl: string;
}

export interface RunSubmitWebConfig {
  sources: RunSubmitWebSource[];
  maxItems: number;
  sinceDays?: number;
}

export interface RunSubmitTwitterUser {
  handle: string;
  userId: string;
}

export interface RunSubmitTwitterConfig {
  listIds: string[];
  users: RunSubmitTwitterUser[];
  maxTweetsPerSource?: number;
  sinceHours?: number;
}

export type WebSearchProviderName = "tavily";

export interface WebSearchQueryConfig {
  query: string;
  sinceDays: number;
  maxItems: number;
}

export interface RunSubmitWebSearchConfig {
  provider: WebSearchProviderName;
  queries: WebSearchQueryConfig[];
}

export interface RunCollectorsPayload {
  hn?: RunSubmitHnConfig;
  reddit?: RunSubmitRedditConfig;
  web?: RunSubmitWebConfig;
  twitter?: RunSubmitTwitterConfig;
  webSearch?: RunSubmitWebSearchConfig;
}

export interface RunSubmitPayload {
  topN: number;
  hn?: RunSubmitHnConfig;
  reddit?: RunSubmitRedditConfig;
  web?: RunSubmitWebConfig;
  twitter?: RunSubmitTwitterConfig;
}

export interface AddPostPayload {
  url: string;
}

export interface PoolItem {
  id: number;
  title: string;
  url: string;
  sourceType: SourceType;
  author: string | null;
  publishedAt: string | null;
  engagement: { points: number; commentCount: number };
  imageUrl: string | null;
  sourceIdentifier: string;
  preview: ItemPreview;
  recapSummary: string | null;
}

export interface PoolResponse {
  items: PoolItem[];
  total: number;
}

export interface SourceTelemetryEntry {
  sourceType: "hn" | "reddit" | "blog" | "twitter" | "web_search";
  identifier: string;
  displayName: string;
  itemsFetched: number;
  status: "completed" | "failed" | "partial";
  errors: string[];
  retries: number;
  durationMs: number;
}

export interface RunSourceTelemetry {
  sources: SourceTelemetryEntry[];
  totalItemsFetched: number;
  totalErrors: number;
  enrichment?: EnrichmentTelemetry;
}

export interface RawItemSummary {
  id: number;
  sourceType: SourceType;
  title: string;
  url: string;
  author: string | null;
  imageUrl: string | null;
  publishedAt: string | null;
  collectedAt: string;
  engagement: RawItemEngagement;
}

export interface RunSourcesResponse {
  runId: string;
  items: RawItemSummary[];
}
