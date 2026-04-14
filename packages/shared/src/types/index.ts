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

export * from "./run.js";
export type { UserProfile } from "./profile.js";
export type { Candidate } from "./candidate.js";
