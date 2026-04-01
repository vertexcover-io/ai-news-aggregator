export interface HnCollectConfig {
  keywords?: string[];
  pointsThreshold?: number;
  count?: number;
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
