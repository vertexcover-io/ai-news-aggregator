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

export interface RedditCollectConfig {
  subreddits?: string[];
  sort?: "hot" | "new" | "top";
  timeframe?: "hour" | "day" | "week" | "month";
  limit?: number;
  commentsPerItem?: number;
}

export interface WebSourceSelectors {
  articleLink: string;
  title: string;
  content: string;
  author?: string;
  date?: string;
}

export interface WebSourceConfig {
  name: string;
  sourceType: "blog" | "rss";
  indexUrl: string;
  selectors: WebSourceSelectors;
  maxItems?: number;
}

export interface WebCollectConfig {
  sources: WebSourceConfig[];
}

export interface WebCollectJobData {
  config: WebCollectConfig;
}
