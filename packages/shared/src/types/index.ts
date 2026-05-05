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
  summary: string;
  bullets: string[];
  bottomLine: string;
}

export interface RawItemMetadata {
  comments: RawItemComment[];
  recap?: RecapContent;
  addedInReview?: boolean;
}

export interface CollectorResult {
  itemsFetched: number;
  commentsFetched: number;
  itemsStored: number;
  durationMs: number;
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

export * from "./run.js";
export * from "./archive.js";
export type { Candidate } from "./candidate.js";
