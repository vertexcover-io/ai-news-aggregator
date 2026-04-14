import type { RawItemInsert } from "@newsletter/shared/db";
import type { CollectorResult, RawItemComment } from "@newsletter/shared/types";
import type { HnCollectConfig } from "@pipeline/types.js";
import { createLogger } from "@newsletter/shared/logger";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";

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
const OG_IMAGE_TIMEOUT_MS = 5000;
const OG_IMAGE_MAX_BYTES = 50_000;

const OG_IMAGE_REGEX = /<meta\s+(?:property|name)="og:image"\s+content="([^"]+)"/i;
const OG_IMAGE_REGEX_ALT = /<meta\s+content="([^"]+)"\s+(?:property|name)="og:image"/i;

export async function fetchOgImage(articleUrl: string, fetchFn: typeof fetch): Promise<string | null> {
  if (!articleUrl.startsWith("http")) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, OG_IMAGE_TIMEOUT_MS);

    const response = await fetchFn(articleUrl, { signal: controller.signal });
    clearTimeout(timer);

    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !contentType.includes("html")) return null;

    const text = await response.text();
    const html = text.slice(0, OG_IMAGE_MAX_BYTES);

    const match = OG_IMAGE_REGEX.exec(html) ?? OG_IMAGE_REGEX_ALT.exec(html);
    if (!match?.[1]) return null;

    const ogUrl = match[1].replaceAll("&amp;", "&");

    if (ogUrl.startsWith("http")) return ogUrl;

    try {
      return new URL(ogUrl, articleUrl).href;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

export interface HnCollectorDeps {
  rawItemsRepo: RawItemsRepo;
  fetchFn?: typeof fetch;
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

  const numericFilters: string[] = [`points>${points}`];
  if (config.sinceDays !== undefined && config.sinceDays > 0) {
    const cutoffSeconds = Math.floor((Date.now() - config.sinceDays * 86_400_000) / 1000);
    numericFilters.push(`created_at_i>${cutoffSeconds}`);
  }

  const params = new URLSearchParams({
    query,
    tags: "story",
    optionalWords,
    numericFilters: numericFilters.join(","),
    hitsPerPage: String(count),
  });

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      url: hit.url ?? "",
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
  const fetchFn = deps.fetchFn ?? fetch;
  const feeds = config.feeds ?? DEFAULT_FEEDS;
  const commentsPerItem = config.commentsPerItem ?? DEFAULT_COMMENTS_PER_ITEM;

  logger.info({ feeds, commentsPerItem }, "collection started");

  const seenIds = new Set<string>();
  const allItems: RawItemInsert[] = [];

  for (const feed of feeds) {
    const url = buildSearchUrl(feed, config);
    const response = await fetchWithRetry(fetchFn, url, parseAlgoliaStoryResponse);
    const items = parseStories(response);
    for (const item of items) {
      if (!seenIds.has(item.externalId)) {
        seenIds.add(item.externalId);
        allItems.push(item);
      }
    }
    if (feed !== feeds[feeds.length - 1]) {
      await delay(RATE_LIMIT_MS);
    }
  }

  let totalComments = 0;

  if (commentsPerItem > 0) {
    for (let i = 0; i < allItems.length; i++) {
      if (i > 0) {
        await delay(RATE_LIMIT_MS);
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

  const ogResults = await Promise.allSettled(
    allItems.map((item) => fetchOgImage(item.url, fetchFn)),
  );
  for (let i = 0; i < ogResults.length; i++) {
    const result = ogResults[i];
    if (result.status === "fulfilled" && result.value) {
      allItems[i].imageUrl = result.value;
    }
  }

  let itemsStored = 0;

  if (allItems.length > 0) {
    await deps.rawItemsRepo.upsertItems(allItems);
    itemsStored = allItems.length;
  }

  const result = {
    itemsFetched: allItems.length,
    commentsFetched: totalComments,
    itemsStored,
    durationMs: Date.now() - startTime,
  };

  logger.info(result, "collection completed");

  return result;
}
