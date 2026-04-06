import * as cheerio from "cheerio";
import type { RawItemInsert } from "@newsletter/shared/db";
import type { CollectorResult } from "@newsletter/shared/types";
import type { WebCollectConfig, WebSourceConfig } from "@pipeline/types.js";
import { createLogger } from "@newsletter/shared/logger";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";

const logger = createLogger("collector:web");

const MAX_RETRIES = 3;
const ARTICLE_DELAY_MS = 1000;
const SOURCE_DELAY_MS = 500;
const DEFAULT_MAX_ITEMS = 10;

export interface WebCollectorDeps {
  rawItemsRepo: RawItemsRepo;
  fetchFn?: typeof fetch;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  fetchFn: typeof fetch,
  url: string,
  retries: number = MAX_RETRIES,
): Promise<string> {
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
      return await response.text();
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

function extractPathname(url: string): string {
  return new URL(url).pathname;
}

function resolveUrl(base: string, href: string): string {
  return new URL(href, base).href;
}

function extractArticleUrls(html: string, source: WebSourceConfig): string[] {
  const $ = cheerio.load(html);
  const hrefs: string[] = [];

  $(source.selectors.articleLink).each((_, el) => {
    const href = $(el).attr("href");
    if (href) {
      hrefs.push(resolveUrl(source.indexUrl, href));
    }
  });

  // Deduplicate
  return [...new Set(hrefs)];
}

function parseArticle(
  html: string,
  url: string,
  source: WebSourceConfig,
): RawItemInsert | null {
  const $ = cheerio.load(html);
  const { selectors } = source;

  const title = $(selectors.title).first().text().trim();
  if (!title) {
    return null;
  }

  const content = $(selectors.content).first().text().trim();
  const author = selectors.author ? $(selectors.author).first().text().trim() || null : null;
  const dateStr = selectors.date ? $(selectors.date).first().text().trim() : null;
  const publishedAt = dateStr ? new Date(dateStr) : null;
  const now = new Date();

  return {
    sourceType: source.sourceType,
    externalId: extractPathname(url),
    title,
    url,
    sourceUrl: url,
    author,
    content,
    publishedAt,
    collectedAt: now,
    engagement: { points: 0, commentCount: 0 },
    metadata: { comments: [] },
    updatedAt: now,
  };
}

export async function collectSource(
  fetchFn: typeof fetch,
  source: WebSourceConfig,
): Promise<RawItemInsert[]> {
  const html = await fetchWithRetry(fetchFn, source.indexUrl);
  const urls = extractArticleUrls(html, source);
  const maxItems = source.maxItems ?? DEFAULT_MAX_ITEMS;
  const limited = urls.slice(0, maxItems);

  if (limited.length === 0) {
    logger.warn({ source: source.name }, "no article links found on index page");
  }

  const items: RawItemInsert[] = [];

  for (let i = 0; i < limited.length; i++) {
    if (i > 0) {
      await delay(ARTICLE_DELAY_MS);
    }

    const articleUrl = limited[i];
    try {
      const articleHtml = await fetchWithRetry(fetchFn, articleUrl);
      const item = parseArticle(articleHtml, articleUrl, source);
      if (item) {
        items.push(item);
      } else {
        logger.warn({ url: articleUrl }, "article skipped — no title found");
      }
    } catch (err) {
      logger.warn({ url: articleUrl, error: err instanceof Error ? err.message : String(err) }, "article fetch failed, skipping");
    }
  }

  return items;
}

export async function collectWeb(
  deps: WebCollectorDeps,
  config: WebCollectConfig,
): Promise<CollectorResult> {
  const startTime = Date.now();
  const fetchFn = deps.fetchFn ?? fetch;
  const { sources } = config;

  logger.info({ sourceCount: sources.length }, "web collection started");

  let totalItemsFetched = 0;
  let totalItemsStored = 0;

  for (let s = 0; s < sources.length; s++) {
    if (s > 0) {
      await delay(SOURCE_DELAY_MS);
    }

    const source = sources[s];
    try {
      const items = await collectSource(fetchFn, source);
      totalItemsFetched += items.length;

      if (items.length > 0) {
        await deps.rawItemsRepo.upsertItems(items);
        totalItemsStored += items.length;
      }
    } catch (err) {
      logger.error({ source: source.name, error: err instanceof Error ? err.message : String(err) }, "index page fetch failed, skipping source");
    }
  }

  const result: CollectorResult = {
    itemsFetched: totalItemsFetched,
    commentsFetched: 0,
    itemsStored: totalItemsStored,
    durationMs: Date.now() - startTime,
  };

  logger.info(result, "web collection completed");

  return result;
}
