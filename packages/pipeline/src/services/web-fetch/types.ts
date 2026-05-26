export type FetchMode = "article" | "listing";

export interface ConvertInput {
  html: string;
  baseUrl: string;
  mode: FetchMode;
}

export interface ConvertResult {
  markdown: string;
  title: string | null;
  byline: string | null;
  imageUrl: string | null;
  textLength: number;
  publishedAt: Date | null;
  structuredData: string | null;
}
