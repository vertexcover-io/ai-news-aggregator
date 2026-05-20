export interface WebSearchProvider {
  readonly name: string;
  search(input: SearchInput): Promise<WebSearchResult[]>;
}

export interface SearchInput {
  query: string;
  sinceDays: number;
  maxItems: number;
  signal?: AbortSignal;
}

export interface WebSearchResult {
  url: string;
  title: string;
  snippet: string;
  publishedAt: Date | null;
  imageUrl?: string;
  rawScore?: number;
  providerMetadata?: Record<string, unknown>;
}
