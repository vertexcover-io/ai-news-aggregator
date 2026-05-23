import type { SourceType } from "../db/schema.js";

export interface SourcesSummaryRow {
  identifier: string;
  displayName: string;
  url: string | null;
  todayCount: number;
  weekCount: number;
  inDigestCount: number;
  status: "healthy" | "idle" | "failing";
  lastFetchedAt: string | null;
}

export interface SourcesSummarySection {
  sourceType: SourceType;
  rows: SourcesSummaryRow[];
}

export interface SourcesSummaryResponse {
  generatedAt: string;
  sections: SourcesSummarySection[];
  rankingPrompt: string;
}
