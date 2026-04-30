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

export type RawItemTwitterOrigin =
  | { kind: "user"; handle: string }
  | { kind: "list"; listId: string };

export interface RawItemTwitterMetadata {
  origin: RawItemTwitterOrigin;
  retweetCount: number;
  viewCount: number | null;
  displayName: string | null;
  isReply: boolean;
}

export interface RawItemMetadata {
  comments: RawItemComment[];
  recap?: RecapContent;
  addedInReview?: boolean;
  twitter?: RawItemTwitterMetadata;
}

export interface CollectorResult {
  itemsFetched: number;
  commentsFetched: number;
  itemsStored: number;
  durationMs: number;
}

export * from "./run.js";
export * from "./archive.js";
export type { Candidate } from "./candidate.js";
