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

export interface CollectorResult {
  itemsFetched: number;
  commentsFetched: number;
  itemsStored: number;
  durationMs: number;
}

export * from "./run.js";
export type { UserProfile } from "./profile.js";
export type { Candidate } from "./candidate.js";
