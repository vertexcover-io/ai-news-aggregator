import type { RawItemInsert } from "@newsletter/shared/db";
import type { CollectorResult } from "@newsletter/shared/types";
import type { HnCollectConfig } from "@pipeline/types.js";
import { createLogger } from "@newsletter/shared/logger";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";

const logger = createLogger("collector:hn");

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

export interface HnCollectorDeps {
  rawItemsRepo: RawItemsRepo;
  fetchFn?: typeof fetch;
}

interface JsonFeedItem {
  id?: string;
  title?: string;
  url?: string;
  external_url?: string;
  date_published?: string;
  author?: { name: string };
  authors?: Array<{ name: string }>;
  content_html?: string;
}

interface JsonFeed {
  items?: JsonFeedItem[];
}

interface ParsedComment {
  id: string;
  author: string;
  content: string;
  publishedAt: string;
}

interface ParsedItem {
  title: string;
  url: string;
  externalId: string;
  author: string | null;
  content: string | null;
  publishedAt: Date | null;
  sourceUrl: string;
  engagement: { points: number; commentCount: number };
  comments: ParsedComment[];
}

function buildFeedUrl(feed: string, config: HnCollectConfig): string {
  const keywords = config.keywords ?? DEFAULT_KEYWORDS;
  const points = config.pointsThreshold ?? DEFAULT_POINTS_THRESHOLD;
  const count = config.count ?? DEFAULT_COUNT;
  const q = keywords.map((k) => k.replace(/ /g, "+")).join("+OR+");
  if (feed === "best") {
    return `https://hnrss.org/best.jsonfeed?q=${q}&points=${points}&count=${count}`;
  }
  return `https://hnrss.org/newest.jsonfeed?q=${q}&points=${points}&count=${count}`;
}

function extractHnId(item: JsonFeedItem): string | null {
  const idStr = item.id ?? item.external_url ?? "";
  const match = /[?&]id=(\d+)/.exec(idStr);
  return match ? match[1] : null;
}

function extractEngagement(contentHtml: string | undefined): { points: number; commentCount: number } {
  const pointsMatch = /Points:\s*(\d+)/i.exec(contentHtml ?? "");
  const commentsMatch = /#\s*Comments:\s*(\d+)/i.exec(contentHtml ?? "");
  return {
    points: pointsMatch ? parseInt(pointsMatch[1], 10) : 0,
    commentCount: commentsMatch ? parseInt(commentsMatch[1], 10) : 0,
  };
}

function isJsonFeed(value: unknown): value is JsonFeed {
  return (
    typeof value === "object" &&
    value !== null &&
    "items" in value &&
    Array.isArray(value.items)
  );
}

function parseJsonFeed(value: unknown): JsonFeed {
  return isJsonFeed(value) ? value : { items: [] };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  fetchFn: typeof fetch,
  url: string,
  retries: number = MAX_RETRIES,
): Promise<JsonFeed> {
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
      return parseJsonFeed(data);
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
): Promise<ParsedComment[]> {
  try {
    const url = `https://hnrss.org/item.jsonfeed?id=${hnId}&count=${count}`;
    const response = await fetchFn(url);
    if (!response.ok) {
      return [];
    }
    const data: unknown = await response.json();
    const feed = parseJsonFeed(data);
    return (feed.items ?? []).map((item) => ({
      id: extractHnId(item) ?? "",
      author: item.author?.name ?? item.authors?.[0]?.name ?? "unknown",
      content: item.content_html ?? "",
      publishedAt: item.date_published ?? "",
    }));
  } catch {
    return [];
  }
}

function parseItems(feed: JsonFeed): ParsedItem[] {
  const items: ParsedItem[] = [];

  for (const item of feed.items ?? []) {
    if (!item.title) {
      continue;
    }

    const hnId = extractHnId(item);
    if (!hnId) {
      continue;
    }

    const engagement = extractEngagement(item.content_html);

    items.push({
      title: item.title,
      url: item.url ?? "",
      externalId: hnId,
      author: item.author?.name ?? item.authors?.[0]?.name ?? null,
      content: item.content_html ?? null,
      publishedAt: item.date_published ? new Date(item.date_published) : null,
      sourceUrl: `https://news.ycombinator.com/item?id=${hnId}`,
      engagement,
      comments: [],
    });
  }

  return items;
}

export async function collectHn(
  deps: HnCollectorDeps,
  sourceId: number | null,
  config: HnCollectConfig,
): Promise<CollectorResult> {
  const startTime = Date.now();
  const fetchFn = deps.fetchFn ?? fetch;
  const feeds = config.feeds ?? DEFAULT_FEEDS;
  const commentsPerItem = config.commentsPerItem ?? DEFAULT_COMMENTS_PER_ITEM;

  logger.info({ feeds, commentsPerItem, sourceId }, "collection started");

  const seenIds = new Set<string>();
  const allItems: ParsedItem[] = [];

  for (const feed of feeds) {
    const feedUrl = buildFeedUrl(feed, config);
    const feedData = await fetchWithRetry(fetchFn, feedUrl);
    const items = parseItems(feedData);
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

      const comments = await fetchComments(fetchFn, allItems[i].externalId, commentsPerItem);
      allItems[i].comments = comments;
      totalComments += comments.length;

      if (comments.length === 0 && allItems[i].engagement.commentCount > 0) {
        logger.warn({ externalId: allItems[i].externalId, commentCount: allItems[i].engagement.commentCount }, "comment fetch returned empty");
      }
    }
  }

  let itemsStored = 0;

  if (allItems.length > 0) {
    const rows: RawItemInsert[] = allItems.map((item) => ({
      sourceId: sourceId,
      sourceType: "hn" as const,
      externalId: item.externalId,
      title: item.title,
      url: item.url,
      sourceUrl: item.sourceUrl,
      author: item.author,
      content: item.content,
      publishedAt: item.publishedAt,
      collectedAt: new Date(),
      engagement: item.engagement,
      metadata: { comments: item.comments },
      updatedAt: new Date(),
    }));

    await deps.rawItemsRepo.upsertItems(rows);

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
