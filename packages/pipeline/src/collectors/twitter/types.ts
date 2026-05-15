import type { CollectorResult } from "@newsletter/shared/types";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import type { EnrichmentContext } from "@pipeline/services/link-enrichment/types.js";

export interface QuotedTweet {
  id: string;
  authorHandle: string;
  fullText: string;
  url: string;
  createdAt: string;
  photoUrls: string[];
}

export interface NormalizedTweet {
  id: string;
  authorHandle: string;
  fullText: string;
  createdAt: string;
  eventCreatedAt: string;
  url: string;
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  quoteCount: number;
  photoUrls: string[];
  isRetweet: boolean;
  isQuote: boolean;
  externalUrl?: string;
  quotedTweet?: QuotedTweet;
}

export interface TwitterClientFetchOptions {
  maxTweets?: number;
  cursor?: string;
  signal?: AbortSignal;
}

export interface TwitterClientFetchResult {
  tweets: NormalizedTweet[];
  nextCursor: string | null;
}

export interface TwitterClient {
  fetchListTweets(listId: string, opts?: TwitterClientFetchOptions): Promise<TwitterClientFetchResult>;
  fetchUserTimeline(userId: string, opts?: TwitterClientFetchOptions): Promise<TwitterClientFetchResult>;
}

export interface TwitterCollectorFailure {
  source: string;
  error: Error;
}

export interface TwitterCollectorDeps {
  client: TwitterClient;
  rawItemsRepo: RawItemsRepo;
  signal?: AbortSignal;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  enrichment?: EnrichmentContext;
}

export interface TwitterCollectorResult extends CollectorResult {
  failures: TwitterCollectorFailure[];
}
