import type { SourceType } from "../db/schema.js";

export type RunStatus = "running" | "completed" | "failed";

export type RunStage =
  | "queued"
  | "collecting"
  | "processing"
  | "ranking"
  | "completed"
  | "failed";

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
}

export interface RankedItemRef {
  rawItemId: number;
  score: number;
  rationale: string;
}

export interface RunState {
  id: string;
  status: RunStatus;
  stage: RunStage;
  topN: number;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  sources: {
    hn?: SourceRunState;
    reddit?: SourceRunState;
    blog?: SourceRunState;
  };
  rankedItems: RankedItemRef[] | null;
  warnings: string[];
  error: string | null;
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
}

export interface RunSubmitRedditConfig {
  subreddits: string[];
  sort?: "hot" | "new" | "top";
  limit?: number;
  sinceDays: number;
}

export interface RunSubmitPayload {
  topN: number;
  hn?: RunSubmitHnConfig;
  reddit?: RunSubmitRedditConfig;
}
