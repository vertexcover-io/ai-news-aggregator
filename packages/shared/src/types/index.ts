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

export interface RawItemMetadata {
  comments: RawItemComment[];
}

export interface HnCollectConfig {
  keywords?: string[];
  pointsThreshold?: number;
  count?: number;
  commentsPerItem?: number;
  feeds?: string[];
}

export interface HnCollectJobData {
  sourceId: number;
  config: HnCollectConfig;
}

export interface CollectorResult {
  itemsFetched: number;
  commentsFetched: number;
  itemsStored: number;
  durationMs: number;
}
