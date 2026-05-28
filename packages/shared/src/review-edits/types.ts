export type EditType = "reorder" | "add" | "remove" | "text_edit";

export interface PreReviewSnapshot {
  capturedAt: string; // ISO timestamp
  rankedItemIds: number[]; // ordered raw_item ids as the LLM produced them
  recap: Record<number, {
    title: string;
    summary: string;
    bullets: string[];
    bottomLine: string;
  }>;
  digestMeta: {
    headline: string | null;
    summary: string | null;
    hook: string | null;
    twitterSummary: string | null;
  };
}

export type DigestMetaField =
  | "digest_headline"
  | "digest_summary"
  | "hook"
  | "twitter_summary";

export type ItemTextField = "title" | "summary" | "bullets" | "bottomLine";

export interface ReviewEditRow {
  editType: EditType;
  rawItemId: number | null;
  field: ItemTextField | DigestMetaField | "rank" | null;
  before: unknown;
  after: unknown;
  positionBefore: number | null;
  positionAfter: number | null;
}
