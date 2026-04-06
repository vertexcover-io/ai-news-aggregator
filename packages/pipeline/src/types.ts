export interface HnCollectConfig {
  keywords?: string[];
  pointsThreshold?: number;
  count?: number;
  commentsPerItem?: number;
  feeds?: string[];
}

export interface HnCollectJobData {
  config: HnCollectConfig;
}

export interface RedditCollectJobData {
  config: RedditCollectConfig;
}

export interface RedditCollectConfig {
  subreddits?: string[];
  sort?: "hot" | "new" | "top";
  timeframe?: "hour" | "day" | "week" | "month";
  limit?: number;
  commentsPerItem?: number;
}
