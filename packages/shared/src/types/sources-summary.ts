import type { SourceType } from "../db/schema.js";

export interface SourcesSummaryRow {
  identifier: string;
  displayName: string;
  url: string | null;
  fetchedCount: number;
  usedCount: number;
  failureCount: number;
  lastFailureMessage: string | null;
}

export interface SourcesSummarySection {
  sourceType: SourceType;
  rows: SourcesSummaryRow[];
}

export interface ConfiguredRow {
  /** Stable join key matching `RawItemsAggregateRow.identifier` (e.g. `r/LocalLLaMA`, `news.ycombinator.com`, `@karpathy`). Empty string for web_search rows since web_search aggregates under a single literal identifier. */
  identifier: string;
  displayName: string;
  url: string | null;
}

export interface ConfiguredSection {
  sourceType: SourceType;
  rows: ConfiguredRow[];
}

export interface SourceFailureSummary {
  sourceType: SourceType;
  identifier: string;
  displayName: string;
  runsAffected: number;
  lastErrorMessage: string;
  lastFailedAt: string;
}

export interface SourcesSummaryRange {
  from: string;
  to: string;
  runsInRange: number;
}

export interface SourcesSummaryResponse {
  generatedAt: string;
  range: SourcesSummaryRange;
  sections: SourcesSummarySection[];
  configured: ConfiguredSection[];
  failures: SourceFailureSummary[];
  rankingPrompt: string;
}
