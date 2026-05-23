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

export interface RawItemMetadata {
  comments: RawItemComment[];
  recap?: RecapContent;
  addedInReview?: boolean;
  enrichedLink?: EnrichedLinkContent;
  quotedTweet?: QuotedTweetMetadata;
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
}

export * from "./run.js";
export * from "./archive.js";
export * from "./notifications.js";
export * from "./cost-breakdown.js";
export * from "./must-read.js";
export * from "./home.js";
export type { Candidate } from "./candidate.js";
