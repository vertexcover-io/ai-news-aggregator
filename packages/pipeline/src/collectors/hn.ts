import type { RawItemInsert } from "@newsletter/shared/db";
import type {
  CollectorResult,
  RawItemComment,
  SourceUnitResult,
} from "@newsletter/shared/types";
import type { HnCollectConfig } from "@pipeline/types.js";
import { createLogger } from "@newsletter/shared/logger";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import { delay } from "@pipeline/lib/delay.js";
import { withAbortSignal } from "@pipeline/lib/abortable-fetch.js";
import { enrichRawItems } from "@pipeline/services/link-enrichment/index.js";
import type { EnrichmentContext } from "@pipeline/services/link-enrichment/types.js";

const logger = createLogger("collector:hn");

// ── Single-post fetch (add-post flow) ────────────────────────────────────────

const HN_ITEM_API = "https://hacker-news.firebaseio.com/v0/item";

export class UrlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlParseError";
  }
}

export interface FetchHnPostDeps {
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
}

interface HnFirebaseItem {
  id: number;
  type: string;
  by?: string;
  title?: string | null;
  url?: string | null;
  score?: number;
  descendants?: number;
  time?: number;
  text?: string | null;
}

function isHnFirebaseItem(value: unknown): value is HnFirebaseItem {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "type" in value &&
    typeof (value as { type: unknown }).type === "string"
  );
}

export function parseHnItemIdFromUrl(url: string): string | null {
  try {
    const u = new URL(url);

    if (u.hostname === "news.ycombinator.com" && u.pathname === "/item") {
      const id = u.searchParams.get("id");
      if (id && /^\d+$/.test(id)) return id;
      return null;
    }

    if (u.hostname === "hn.algolia.com") {
      const hash = u.hash;
      const storyMatch = /\/story\/[^/]+\/\d+\/(\d+)/.exec(hash);
      if (storyMatch?.[1]) return storyMatch[1];
      return null;
    }

    return null;
  } catch {
    return null;
  }
}

export async function fetchHnPost(
  url: string,
  deps: FetchHnPostDeps = {},
): Promise<RawItemInsert> {
  const id = parseHnItemIdFromUrl(url);
  if (!id) {
    throw new UrlParseError(`not a recognized HN item URL: ${url}`);
  }

  const fetchFn = deps.fetchFn ?? fetch;
  const apiUrl = `${HN_ITEM_API}/${id}.json`;

  logger.info({ event: "hn.single.fetch", id, url }, "hn.single.fetch");

  const response = await fetchFn(apiUrl, { signal: deps.signal });
  if (!response.ok) {
    throw new Error(`HN API HTTP ${response.status} for item ${id}`);
  }
  const body: unknown = await response.json();
  if (body === null) {
    throw new Error(`HN item ${id} not found or deleted`);
  }
  if (!isHnFirebaseItem(body)) {
    throw new Error(`HN API returned unexpected shape for item ${id}`);
  }
  if (body.type === "comment") {
    throw new UrlParseError(
      `HN item ${id} is a comment, not a story — cannot add as post`,
    );
  }
  if (!body.title) {
    throw new Error(`HN item ${id} has no title`);
  }

  const now = new Date();
  const publishedAt =
    typeof body.time === "number" ? new Date(body.time * 1000) : null;

  return {
    sourceType: "hn",
    externalId: id,
    title: body.title,
    url: body.url ?? `https://news.ycombinator.com/item?id=${id}`,
    sourceUrl: `https://news.ycombinator.com/item?id=${id}`,
    author: body.by ?? null,
    content: body.text ?? null,
    publishedAt,
    collectedAt: now,
    engagement: {
      points: body.score ?? 0,
      commentCount: body.descendants ?? 0,
    },
    metadata: { comments: [] },
    updatedAt: now,
  };
}

// ── Batch collection ──────────────────────────────────────────────────────────

const DEFAULT_KEYWORDS = [
  "AI", "LLM", "GPT", "machine learning", "deep learning",
  "neural network", "transformer", "Claude", "Gemini",
];
const DEFAULT_POINTS_THRESHOLD = 20;
const DEFAULT_COUNT = 100;
const DEFAULT_COMMENTS_PER_ITEM = 20;
const DEFAULT_FEEDS = ["newest", "best"];
const MAX_RETRIES = 3;
const RATE_LIMIT_MS = 500;

const ALGOLIA_BASE = "https://hn.algolia.com/api/v1";

export interface HnCollectorDeps {
  rawItemsRepo: RawItemsRepo;
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
  enrichment?: EnrichmentContext;
}

interface AlgoliaStoryHit {
  objectID: string;
  title: string | null;
  url: string | null;
  author: string | null;
  points: number | null;
  num_comments: number | null;
  created_at: string;
  story_text: string | null;
}

interface AlgoliaStorySearchResponse {
  hits: AlgoliaStoryHit[];
  nbHits: number;
}

interface AlgoliaCommentHit {
  objectID: string;
  author: string | null;
  comment_text: string | null;
  created_at: string;
}

interface AlgoliaCommentSearchResponse {
  hits: AlgoliaCommentHit[];
  nbHits: number;
}

function buildKeywordParams(keywords: string[]): { query: string; optionalWords: string } {
  // For multi-word keywords, quote them so Algolia treats them as a phrase.
  // For single-word keywords, just include them. optionalWords lists each
  // single-word token so any one match is sufficient (OR semantics).
  const queryParts: string[] = [];
  const optionalSet = new Set<string>();

  for (const kw of keywords) {
    const trimmed = kw.trim();
    if (!trimmed) continue;
    if (/\s/.test(trimmed)) {
      queryParts.push(`"${trimmed}"`);
      for (const token of trimmed.split(/\s+/)) {
        optionalSet.add(token);
      }
    } else {
      queryParts.push(trimmed);
      optionalSet.add(trimmed);
    }
  }

  return {
    query: queryParts.join(" "),
    optionalWords: Array.from(optionalSet).join(","),
  };
}

function buildSearchUrl(feed: string, config: HnCollectConfig): string {
  const keywords = config.keywords ?? DEFAULT_KEYWORDS;
  const points = config.pointsThreshold ?? DEFAULT_POINTS_THRESHOLD;
  const count = config.count ?? DEFAULT_COUNT;

  const { query, optionalWords } = buildKeywordParams(keywords);

  // The relevance index (/search, used by the "best" feed) does not list
  // `points` in its numericAttributesForFiltering and rejects a points filter
  // with HTTP 400 — only /search_by_date (newest) supports it. Apply the
  // points filter to the API only for newest; the best feed is post-filtered
  // by points in code (see collectHn).
  const numericFilters: string[] = [];
  if (feed !== "best") {
    numericFilters.push(`points>${points}`);
  }
  if (config.sinceDays !== undefined && config.sinceDays > 0) {
    const cutoffSeconds = Math.floor((Date.now() - config.sinceDays * 86_400_000) / 1000);
    numericFilters.push(`created_at_i>${cutoffSeconds}`);
  }

  const params = new URLSearchParams({
    query,
    tags: "story",
    optionalWords,
    hitsPerPage: String(count),
  });
  if (numericFilters.length > 0) {
    params.set("numericFilters", numericFilters.join(","));
  }

  const endpoint = feed === "best" ? "search" : "search_by_date";
  return `${ALGOLIA_BASE}/${endpoint}?${params.toString()}`;
}

function isAlgoliaStorySearchResponse(value: unknown): value is AlgoliaStorySearchResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "hits" in value &&
    Array.isArray((value as { hits: unknown }).hits)
  );
}

function parseAlgoliaStoryResponse(value: unknown): AlgoliaStorySearchResponse {
  return isAlgoliaStorySearchResponse(value) ? value : { hits: [], nbHits: 0 };
}

function isAlgoliaCommentSearchResponse(value: unknown): value is AlgoliaCommentSearchResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "hits" in value &&
    Array.isArray((value as { hits: unknown }).hits)
  );
}

function parseAlgoliaCommentResponse(value: unknown): AlgoliaCommentSearchResponse {
  return isAlgoliaCommentSearchResponse(value) ? value : { hits: [], nbHits: 0 };
}

async function fetchWithRetry<T>(
  fetchFn: typeof fetch,
  url: string,
  parse: (data: unknown) => T,
  retries: number = MAX_RETRIES,
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetchFn(url);
      if (!response.ok) {
        const status = response.status;
        if (status >= 400 && status < 500 && status !== 429) {
          throw new Error(`Non-retryable HTTP error: ${status}`);
        }
        throw new Error(`HTTP error: ${status}`);
      }
      const data: unknown = await response.json();
      return parse(data);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (lastError.message.startsWith("Non-retryable")) {
        throw lastError;
      }
      if (attempt < retries - 1) {
        const backoffMs = Math.pow(2, attempt) * 1000;
        await delay(backoffMs);
      }
    }
  }

  throw lastError ?? new Error("Fetch failed after retries");
}

async function fetchComments(
  fetchFn: typeof fetch,
  hnId: string,
  count: number,
): Promise<RawItemComment[]> {
  const url = `${ALGOLIA_BASE}/search?tags=comment,story_${hnId}&hitsPerPage=${count}`;
  try {
    const response = await fetchWithRetry(fetchFn, url, parseAlgoliaCommentResponse);
    return response.hits
      .filter((hit): hit is AlgoliaCommentHit & { author: string; comment_text: string } =>
        hit.author !== null && hit.comment_text !== null,
      )
      .map((hit) => ({
        id: hit.objectID,
        author: hit.author,
        content: hit.comment_text,
        publishedAt: hit.created_at,
      }));
  } catch (err) {
    logger.warn(
      { externalId: hnId, err: err instanceof Error ? err.message : String(err) },
      "comment fetch failed after retries",
    );
    return [];
  }
}

function parseStories(response: AlgoliaStorySearchResponse): RawItemInsert[] {
  const items: RawItemInsert[] = [];

  for (const hit of response.hits) {
    if (!hit.title || !hit.objectID) {
      continue;
    }

    const now = new Date();

    items.push({
      sourceType: "hn" as const,
      externalId: hit.objectID,
      title: hit.title,
      // Ask HN / Show HN stories have no external url — fall back to the HN
      // permalink (same convention as the single-item fetch path above).
      url: hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`,
      sourceUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
      author: hit.author ?? null,
      content: hit.story_text ?? null,
      publishedAt: hit.created_at ? new Date(hit.created_at) : null,
      collectedAt: now,
      engagement: {
        points: hit.points ?? 0,
        commentCount: hit.num_comments ?? 0,
      },
      metadata: { comments: [] },
      updatedAt: now,
    });
  }

  return items;
}

export async function collectHn(
  deps: HnCollectorDeps,
  config: HnCollectConfig,
): Promise<CollectorResult> {
  const startTime = Date.now();
  const baseFetch = deps.fetchFn ?? fetch;
  const fetchFn = deps.signal ? withAbortSignal(baseFetch, deps.signal) : baseFetch;
  const feeds = config.feeds ?? DEFAULT_FEEDS;
  const commentsPerItem = config.commentsPerItem ?? DEFAULT_COMMENTS_PER_ITEM;

  logger.info(
    {
      event: "collector.hn.started",
      feeds,
      sinceDays: config.sinceDays,
      commentsPerItem,
    },
    "collection started",
  );

  const seenIds = new Set<string>();
  const allItems: RawItemInsert[] = [];
  const unitResults: SourceUnitResult[] = [];
  const pointsThreshold = config.pointsThreshold ?? DEFAULT_POINTS_THRESHOLD;
  let successfulFeeds = 0;

  for (const feed of feeds) {
    const url = buildSearchUrl(feed, config);
    const feedStart = Date.now();
    try {
      const response = await fetchWithRetry(fetchFn, url, parseAlgoliaStoryResponse);
      let items = parseStories(response);
      // The best feed has no API-side points filter (the relevance index
      // rejects it), so enforce the threshold here to preserve the floor.
      if (feed === "best") {
        items = items.filter((item) => (item.engagement?.points ?? 0) > pointsThreshold);
      }
      let added = 0;
      for (const item of items) {
        if (!seenIds.has(item.externalId)) {
          seenIds.add(item.externalId);
          allItems.push(item);
          added += 1;
        }
      }
      logger.info(
        {
          event: "collector.hn.feed_completed",
          feed,
          url,
          sinceDays: config.sinceDays,
          fetched: items.length,
          added,
          durationMs: Date.now() - feedStart,
        },
        "hn feed fetched",
      );
      unitResults.push({
        identifier: `hn:${feed}`,
        displayName: `Hacker News ${feed}`,
        itemsFetched: added,
        status: "completed",
        errors: [],
        durationMs: Date.now() - feedStart,
      });
      successfulFeeds += 1;
    } catch (err) {
      // Cancellation must abort the whole collector, not degrade to a feed
      // failure — propagate it so the run finalises as cancelled.
      if (deps.signal?.aborted) throw err;
      // A single feed failing (e.g. an Algolia 400 on one index) degrades to
      // the surviving feeds rather than failing the entire HN source.
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        {
          event: "collector.hn.feed_failed",
          feed,
          url,
          error: message,
          durationMs: Date.now() - feedStart,
        },
        "hn feed failed",
      );
      unitResults.push({
        identifier: `hn:${feed}`,
        displayName: `Hacker News ${feed}`,
        itemsFetched: 0,
        status: "failed",
        errors: [message],
        durationMs: Date.now() - feedStart,
      });
    }
    if (feed !== feeds[feeds.length - 1]) {
      await delay(RATE_LIMIT_MS, deps.signal);
    }
  }

  // Only fail the HN source when EVERY feed failed; otherwise proceed with
  // whatever the surviving feeds returned.
  if (successfulFeeds === 0) {
    const reasons = unitResults.map((u) => u.errors[0] ?? "unknown").join("; ");
    throw new Error(`all HN feeds failed: ${reasons}`);
  }

  let totalComments = 0;

  if (commentsPerItem > 0) {
    for (let i = 0; i < allItems.length; i++) {
      if (deps.signal?.aborted) break;
      if (i > 0) {
        await delay(RATE_LIMIT_MS, deps.signal);
      }

      const item = allItems[i];
      const comments = await fetchComments(fetchFn, item.externalId, commentsPerItem);
      item.metadata = { comments };
      totalComments += comments.length;

      if (comments.length === 0 && item.engagement?.commentCount && item.engagement.commentCount > 0) {
        logger.warn(
          { externalId: item.externalId, commentCount: item.engagement.commentCount },
          "story has comments but Algolia returned zero hits",
        );
      }
    }
  }

  let itemsStored = 0;

  if (allItems.length > 0) {
    if (deps.enrichment) {
      await enrichRawItems(allItems, deps.enrichment);
      for (const item of allItems) {
        if (item.imageUrl != null && item.imageUrl !== "") continue;
        const enriched = item.metadata?.enrichedLink;
        if (enriched?.status === "ok" && enriched.imageUrl) {
          item.imageUrl = enriched.imageUrl;
        }
      }
    }
    await deps.rawItemsRepo.upsertItems(allItems);
    itemsStored = allItems.length;
  }

  const result = {
    itemsFetched: allItems.length,
    commentsFetched: totalComments,
    itemsStored,
    durationMs: Date.now() - startTime,
    unitResults,
  };

  logger.info(
    { event: "collector.hn.completed", ...result },
    "collection completed",
  );

  return result;
}
