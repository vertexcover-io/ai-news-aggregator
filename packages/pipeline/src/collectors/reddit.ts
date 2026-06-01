import { JSDOM, VirtualConsole } from "jsdom";
import type { RawItemInsert } from "@newsletter/shared/db";
import type { CollectorResult, RawItemEngagement, SourceUnitResult } from "@newsletter/shared/types";
import type { RedditCollectConfig } from "@pipeline/types.js";
import { createLogger } from "@newsletter/shared/logger";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import { delay } from "@pipeline/lib/delay.js";
import { UrlParseError } from "@pipeline/collectors/hn.js";
import { withAbortSignal } from "@pipeline/lib/abortable-fetch.js";
import { enrichRawItems } from "@pipeline/services/link-enrichment/index.js";
import type { EnrichmentContext } from "@pipeline/services/link-enrichment/types.js";

const logger = createLogger("collector:reddit");

const ERROR_MESSAGE_MAX_LEN = 120;

const DEFAULT_SUBREDDITS = [
  "MachineLearning", "LocalLLaMA", "artificial", "OpenAI",
  "AI_Agents", "aiagents", "generativeAI",
];
const DEFAULT_SORT = "top";
const DEFAULT_TIMEFRAME = "day";
const DEFAULT_LIMIT = 25;
const MAX_RETRIES = 3;
const RATE_LIMIT_MS = 500;
const USER_AGENT = "Mozilla/5.0 (compatible; NewsletterBot/1.0; +https://vertexcover.io)";
const ZERO_ENGAGEMENT: RawItemEngagement = { points: 0, commentCount: 0 };

function formatCause(cause: unknown): string | undefined {
  if (cause === undefined) return undefined;
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`;
  if (typeof cause === "string") return cause;
  if (typeof cause === "number" || typeof cause === "boolean") return String(cause);
  try {
    return JSON.stringify(cause);
  } catch {
    return "[unserializable cause]";
  }
}

export interface RedditCollectorDeps {
  rawItemsRepo: RawItemsRepo;
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
  enrichment?: EnrichmentContext;
}

const silentConsole = new VirtualConsole();
silentConsole.on("jsdomError", () => undefined);

function decodeAmp(url: string): string {
  return url.replaceAll("&amp;", "&");
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function parseDateOrNow(value: string): Date {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? new Date() : new Date(timestamp);
}

function parseXmlDocument(xml: string): Document {
  const dom = new JSDOM(xml, { contentType: "application/xml", virtualConsole: silentConsole });
  const doc = dom.window.document;
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error(`Reddit RSS returned invalid XML: ${normalizeText(parseError.textContent).slice(0, ERROR_MESSAGE_MAX_LEN)}`);
  }
  return doc;
}

function parseHtmlDocument(html: string): Document {
  return new JSDOM(html, { virtualConsole: silentConsole }).window.document;
}

function firstElement(parent: Document | Element, tagName: string): Element | null {
  return parent.getElementsByTagName(tagName).item(0);
}

function firstText(parent: Document | Element, tagName: string): string {
  return normalizeText(firstElement(parent, tagName)?.textContent);
}

function firstAttribute(parent: Document | Element, tagName: string, attribute: string): string {
  return firstElement(parent, tagName)?.getAttribute(attribute) ?? "";
}

function stripThingPrefix(id: string): string {
  return id.replace(/^t[13]_/, "");
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function isSameUrl(a: string, b: string): boolean {
  return stripTrailingSlash(a) === stripTrailingSlash(b);
}

function getAnchorHrefByLabel(doc: Document, label: string): string | null {
  const anchors = Array.from(doc.querySelectorAll("a[href]"));
  const anchor = anchors.find((a) => normalizeText(a.textContent) === label);
  return anchor?.getAttribute("href") ?? null;
}

function getEntryContentDocument(entry: Element): Document {
  return parseHtmlDocument(firstText(entry, "content"));
}

function getEntryAuthor(entry: Element): string | null {
  const author = firstText(entry, "name").replace(/^\/u\//, "");
  return author === "" ? null : author;
}

function extractEntryImageUrl(entry: Element, contentDoc: Document): string | null {
  const mediaThumbnail = firstAttribute(entry, "media:thumbnail", "url");
  if (mediaThumbnail.startsWith("http")) return decodeAmp(mediaThumbnail);

  const image = contentDoc.querySelector("img[src]");
  const src = image?.getAttribute("src") ?? "";
  return src.startsWith("http") ? decodeAmp(src) : null;
}

function extractEntryBody(contentDoc: Document): string {
  const markdownBody = contentDoc.querySelector(".md");
  if (!markdownBody) return "";
  const blockTexts = Array.from(markdownBody.querySelectorAll("p, li, pre, blockquote"))
    .map((el) => normalizeText(el.textContent))
    .filter((text) => text !== "");
  return blockTexts.length > 0 ? blockTexts.join(" ") : normalizeText(markdownBody.textContent);
}

function extractEntryUrl(contentDoc: Document, sourceUrl: string): string {
  const linkHref = getAnchorHrefByLabel(contentDoc, "[link]");
  if (!linkHref) return sourceUrl;
  return isSameUrl(linkHref, sourceUrl) ? sourceUrl : decodeAmp(linkHref);
}

interface ParsedPostEntry {
  readonly item: RawItemInsert;
}

function parsePostEntry(entry: Element, subreddit: string, now: Date): ParsedPostEntry | null {
  const rawId = firstText(entry, "id");
  if (!rawId.startsWith("t3_")) return null;

  const title = firstText(entry, "title");
  if (title === "") return null;

  const sourceUrl = firstAttribute(entry, "link", "href");
  if (sourceUrl === "") return null;

  const contentDoc = getEntryContentDocument(entry);
  const publishedAt = parseDateOrNow(firstText(entry, "published"));

  return {
    item: {
      sourceType: "reddit",
      externalId: stripThingPrefix(rawId),
      title,
      url: extractEntryUrl(contentDoc, sourceUrl),
      sourceUrl,
      author: getEntryAuthor(entry),
      content: extractEntryBody(contentDoc),
      publishedAt,
      collectedAt: now,
      engagement: { ...ZERO_ENGAGEMENT },
      metadata: {
        comments: [],
        sourceUnit: { identifier: `r/${subreddit}`, displayName: `r/${subreddit}` },
      },
      imageUrl: extractEntryImageUrl(entry, contentDoc),
      updatedAt: now,
    },
  };
}

function parseListingItems(xml: string, subreddit: string): ParsedPostEntry[] {
  const doc = parseXmlDocument(xml);
  const now = new Date();
  return Array.from(doc.getElementsByTagName("entry"))
    .map((entry) => parsePostEntry(entry, subreddit, now))
    .filter((entry): entry is ParsedPostEntry => entry !== null);
}

function buildListingUrl(
  subreddit: string,
  sort: string,
  timeframe: string,
  limit: number,
): string {
  const params = new URLSearchParams();
  if (sort === "top") params.set("t", timeframe);
  params.set("limit", String(limit));
  return `https://www.reddit.com/r/${subreddit}/${sort}.rss?${params.toString()}`;
}

async function fetchTextWithRetry(
  fetchFn: typeof fetch,
  url: string,
  retries: number = MAX_RETRIES,
): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetchFn(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/atom+xml, application/xml, text/xml" },
      });
      if (!response.ok) {
        const status = response.status;
        if (status >= 400 && status < 500 && status !== 429) {
          throw new Error(`Non-retryable HTTP error: ${status}`);
        }
        throw new Error(`HTTP error: ${status}`);
      }
      return await response.text();
    } catch (err) {
      if (err instanceof Error) {
        const cause = formatCause(err.cause);
        lastError = cause
          ? new Error(`${err.message} (cause: ${cause})`, { cause: err.cause })
          : err;
      } else {
        lastError = new Error(String(err));
      }
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

// ── Single-post fetch (add-post flow) ────────────────────────────────────────

export interface FetchRedditPostDeps {
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
}

export interface ParsedRedditPostUrl {
  subreddit: string;
  postId: string;
}

export function parseRedditPostUrl(url: string): ParsedRedditPostUrl | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }

  if (
    u.hostname !== "www.reddit.com" &&
    u.hostname !== "reddit.com" &&
    u.hostname !== "old.reddit.com"
  ) {
    return null;
  }

  const parts = u.pathname.split("/").filter((p) => p.length > 0);
  // Expected: ["r", "<sub>", "comments", "<postId>", "<slug>"]
  // Comment permalink adds one more segment: ["r","<sub>","comments","<postId>","<slug>","<commentId>"]
  if (parts.length < 4) return null;
  if (parts[0] !== "r" || parts[2] !== "comments") return null;
  if (parts.length > 5) return null;

  const subreddit = parts[1];
  const postId = parts[3];
  if (!subreddit || !postId) return null;

  return { subreddit, postId };
}

export async function fetchRedditPost(
  url: string,
  deps: FetchRedditPostDeps = {},
): Promise<RawItemInsert> {
  const parsed = parseRedditPostUrl(url);
  if (!parsed) {
    throw new UrlParseError(`not a recognized Reddit post URL: ${url}`);
  }

  const baseFetch = deps.fetchFn ?? globalThis.fetch;
  const fetchFn = deps.signal ? withAbortSignal(baseFetch, deps.signal) : baseFetch;
  const cleanUrl = url.endsWith("/") ? url.slice(0, -1) : url;
  const rssUrl = `${cleanUrl}.rss`;

  logger.info(
    { event: "reddit.single.fetch", ...parsed, url },
    "reddit.single.fetch",
  );

  const xml = await fetchTextWithRetry(fetchFn, rssUrl);
  const posts = parseListingItems(xml, parsed.subreddit).filter(
    ({ item }) => item.externalId === parsed.postId,
  );
  const firstPost = posts.at(0);
  if (!firstPost) {
    throw new Error(`Reddit post ${parsed.postId} not found in RSS response`);
  }

  return { ...firstPost.item, metadata: { comments: [] } };
}

// ── Batch collection ──────────────────────────────────────────────────────────

export async function collectReddit(
  deps: RedditCollectorDeps,
  config: RedditCollectConfig,
): Promise<CollectorResult> {
  const startTime = Date.now();
  const baseFetch = deps.fetchFn ?? globalThis.fetch;
  const fetchFn = deps.signal ? withAbortSignal(baseFetch, deps.signal) : baseFetch;
  const subreddits = config.subreddits ?? DEFAULT_SUBREDDITS;
  const sort = config.sort ?? DEFAULT_SORT;
  const timeframe = config.timeframe ?? DEFAULT_TIMEFRAME;
  const limit = config.limit ?? DEFAULT_LIMIT;

  logger.info(
    {
      event: "collector.reddit.started",
      subreddits,
      sort,
      timeframe,
      limit,
      sinceDays: config.sinceDays,
      commentsPerItem: 0,
      requestedCommentsPerItem: config.commentsPerItem ?? 0,
    },
    "collection started",
  );

  const seenIds = new Set<string>();
  const allItems: RawItemInsert[] = [];
  const unitResults: SourceUnitResult[] = [];

  for (const subreddit of subreddits) {
    // Reddit subreddit names are case-insensitive; canonicalise to lowercase so
    // telemetry / facet / per-item identifiers all agree regardless of how the
    // user typed the name in settings.
    const canonical = subreddit.toLowerCase();
    const url = buildListingUrl(subreddit, sort, timeframe, limit);
    const subStart = Date.now();

    try {
      const xml = await fetchTextWithRetry(fetchFn, url);
      const entries = parseListingItems(xml, canonical);

      let added = 0;
      for (const { item } of entries) {
        if (!seenIds.has(item.externalId)) {
          seenIds.add(item.externalId);
          allItems.push(item);
          added++;
        }
      }
      logger.info(
        {
          event: "collector.reddit.subreddit_completed",
          subreddit: canonical,
          url,
          sinceDays: config.sinceDays,
          fetched: entries.length,
          added,
          durationMs: Date.now() - subStart,
        },
        "subreddit fetched",
      );
      unitResults.push({
        identifier: `r/${canonical}`,
        displayName: `r/${canonical}`,
        itemsFetched: added,
        status: "completed",
        errors: [],
        durationMs: Date.now() - subStart,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const cause = err instanceof Error ? formatCause(err.cause) : undefined;
      logger.error(
        {
          event: "collector.reddit.subreddit_failed",
          subreddit: canonical,
          url,
          sinceDays: config.sinceDays,
          error: message,
          cause,
          durationMs: Date.now() - subStart,
        },
        "failed to fetch subreddit",
      );
      unitResults.push({
        identifier: `r/${canonical}`,
        displayName: `r/${canonical}`,
        itemsFetched: 0,
        status: "failed",
        errors: [cause ? `${message} (cause: ${cause})` : message],
        durationMs: Date.now() - subStart,
      });
    }

    if (subreddit !== subreddits[subreddits.length - 1]) {
      await delay(RATE_LIMIT_MS, deps.signal);
    }
  }

  let filteredItems = allItems;
  if (config.sinceDays !== undefined && config.sinceDays > 0) {
    const cutoff = Date.now() - config.sinceDays * 86_400_000;
    const before = filteredItems.length;
    filteredItems = filteredItems.filter((item) => {
      if (!item.publishedAt) return true;
      const t = item.publishedAt.getTime();
      return Number.isFinite(t) && t >= cutoff;
    });
    const dropped = before - filteredItems.length;
    if (dropped === 0 && before > 0) {
      logger.warn(
        { sinceDays: config.sinceDays, fetched: before },
        "sinceDays filter dropped 0 items — feed may be truncated",
      );
    }
  }

  let itemsStored = 0;

  if (filteredItems.length > 0) {
    if (deps.enrichment) {
      await enrichRawItems(filteredItems, deps.enrichment);
    }
    await deps.rawItemsRepo.upsertItems(filteredItems);
    itemsStored = filteredItems.length;
  }

  const result: CollectorResult = {
    itemsFetched: filteredItems.length,
    commentsFetched: 0,
    itemsStored,
    durationMs: Date.now() - startTime,
    unitResults,
  };

  logger.info({ event: "collector.reddit.completed", ...result }, "collection completed");

  return result;
}
