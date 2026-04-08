import type { CollectorResult } from "@newsletter/shared/types";

export interface HnCollectConfig {
  keywords?: string[];
  pointsThreshold?: number;
  count?: number;
  commentsPerItem?: number;
  feeds?: string[];
  sinceDays?: number;
}

export interface HnCollectJobData {
  config: HnCollectConfig;
}

export interface RedditCollectConfig {
  subreddits?: string[];
  sort?: "hot" | "new" | "top";
  timeframe?: "hour" | "day" | "week" | "month";
  limit?: number;
  commentsPerItem?: number;
  sinceDays?: number;
}

export interface BlogSource {
  name: string;
  listingUrl: string;
}

export interface WebCollectConfig {
  sources: BlogSource[];
  maxItems: number;
  sinceDays?: number;
  postConcurrency?: number;
}

export interface WebCollectJobData {
  config: WebCollectConfig;
}

export interface CollectorFailure {
  source: string;
  postUrl?: string;
  error: string;
}

export interface WebCollectorResult extends CollectorResult {
  failures?: CollectorFailure[];
}
