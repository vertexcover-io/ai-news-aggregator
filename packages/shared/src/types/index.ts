export interface RawItemEngagement {
  points: number;
  commentCount: number;
}

export interface RawItemComment {
  id: string;
  author: string;
  content: string;
  publishedAt: string;
}

export interface RecapContent {
  title: string;
  summary: string;
  bullets: string[];
  bottomLine: string;
}

export type EnrichmentSkipReason =
  | "no-url"
  | "invalid-url"
  | "same-platform"
  | "non-html-media"
  | "cache-hit";

export interface EnrichedLinkContent {
  url: string;
  fetchedAt: string;
  status: "ok" | "skipped" | "failed";
  skipReason?: EnrichmentSkipReason;
  failureReason?: string;
  cacheHit?: boolean;
  title?: string;
  byline?: string;
  description?: string;
  imageUrl?: string;
  domain?: string;
  contentType?: "html" | "pdf" | "image" | "video" | "other";
  markdown?: string;
  textLength?: number;
}

export interface QuotedTweetMetadata {
  id: string;
  authorHandle: string;
  fullText: string;
  url: string;
  createdAt: string;
  photoUrls: string[];
}

/**
 * The collection unit an item came from — the same identity Source Telemetry
 * reports per `unitResults` entry (e.g. `r/OpenAI`, `Twitter list 158…`, `@sama`).
 * Stamped at collect time so review-page facets can group/filter by it exactly
 * as the observability table does. Absent on items collected before this field
 * existed; callers fall back to URL-derived identifiers for those.
 */
export interface RawItemSourceUnit {
  identifier: string;
  displayName: string;
}

export interface RawItemMetadata {
  comments: RawItemComment[];
  recap?: RecapContent;
  addedInReview?: boolean;
  enrichedLink?: EnrichedLinkContent;
  quotedTweet?: QuotedTweetMetadata;
  sourceUnit?: RawItemSourceUnit;
  // web-search collector fields
  provider?: string;
  query?: string;
  rawScore?: number;
}

export interface SourceUnitResult {
  identifier: string;
  displayName: string;
  itemsFetched: number;
  status: "completed" | "failed" | "partial";
  errors: string[];
  durationMs: number;
}

export interface CollectorResult {
  itemsFetched: number;
  commentsFetched: number;
  itemsStored: number;
  durationMs: number;
  unitResults?: SourceUnitResult[];
}

export interface SendEmailParams {
  to: string[];
  from: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

export interface SendEmailResult {
  messageId: string;
}

export interface EmailProvider {
  send(params: SendEmailParams): Promise<SendEmailResult>;
}

export const RETRYABLE_RESEND_CODES: ReadonlySet<string> = new Set([
  "rate_limit_exceeded",
  "application_error",
  "internal_server_error",
]);

export function parseRetryAfter(
  headerValue: string | null | undefined,
  now: number = Date.now(),
): number | null {
  if (headerValue === null || headerValue === undefined || headerValue === "") {
    return null;
  }
  const trimmed = headerValue.trim();
  // Try delta-seconds: a string of only digits (possibly with a leading minus)
  const deltaMatch = /^-?\d+$/.exec(trimmed);
  if (deltaMatch !== null) {
    const seconds = parseInt(trimmed, 10);
    return Math.max(0, seconds * 1000);
  }
  // Try HTTP-date
  const parsed = Date.parse(trimmed);
  if (!isNaN(parsed)) {
    return Math.max(0, parsed - now);
  }
  return null;
}

export interface EmailSendErrorParams {
  code: string;
  message: string;
  retryAfterMs: number | null;
  retryable: boolean;
}

export class EmailSendError extends Error {
  readonly retryAfterMs: number | null;
  readonly retryable: boolean;

  constructor(params: EmailSendErrorParams) {
    super(params.message);
    this.name = params.code;
    this.retryAfterMs = params.retryAfterMs;
    this.retryable = params.retryable;
    // Restore prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface NewsletterSendJobPayload {
  runId: string;
  subscriberIds: string[] | "all";
}

export interface AnalyticsMetrics {
  totalSubscriptions: number;
  totalUnsubscriptions: number;
  emailsSent: number;
  bounces: number;
  complaints: number;
  opens: number;
  clicks: number;
  period: {
    from: string;
    to: string;
    granularity: "daily" | "weekly" | "monthly";
  };
}

export interface SocialMetadata {
  linkedinPermalink?: string;
  twitterPermalink?: string;
  twitterThreadIds?: string[];
  linkedinError?: string;
  twitterError?: string;
}

export interface SocialTokenMetadata {
  personUrn?: string;
  /** Display name from LinkedIn /v2/userinfo (persisted during OAuth callback). */
  name?: string;
}

export * from "./run.js";
export * from "./observability.js";
export * from "./archive.js";
export * from "./notifications.js";
export * from "./cost-breakdown.js";
export * from "./must-read.js";
export * from "./home.js";
export * from "./sources-summary.js";
export type { Candidate } from "./candidate.js";
