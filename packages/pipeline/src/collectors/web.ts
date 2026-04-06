import * as cheerio from "cheerio";
import type { RawItemInsert } from "@newsletter/shared/db";
import type { CollectorResult } from "@newsletter/shared/types";
import type { WebCollectConfig } from "@pipeline/types.js";
import { createLogger } from "@newsletter/shared/logger";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import type { GeminiClient, ArticleSelectors } from "@pipeline/llm.js";
import { extractArticleSelectors } from "@pipeline/llm.js";

const logger = createLogger("collector:web");

const MAX_RETRIES = 3;
const URL_DELAY_MS = 1000;

export interface WebCollectorDeps {
  rawItemsRepo: RawItemsRepo;
  fetchFn?: typeof fetch;
  geminiClient: GeminiClient;
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

function parseArticle(
  html: string,
  url: string,
  sourceType: "blog" | "rss",
  selectors: ArticleSelectors,
): RawItemInsert | null {
  const $ = cheerio.load(html);

  const title = $(selectors.title).first().text().trim();
  if (!title) {
    return null;
  }

  const content = $(selectors.content).first().text().replace(/\s+/g, " ").trim();
  const author = selectors.author ? $(selectors.author).first().text().trim() || null : null;
  const dateStr = selectors.date ? $(selectors.date).first().text().trim() : null;
  const publishedAt = dateStr ? new Date(dateStr) : null;
  const now = new Date();

  return {
    sourceType,
    externalId: new URL(url).pathname,
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

export async function collectWeb(
  deps: WebCollectorDeps,
  config: WebCollectConfig,
): Promise<CollectorResult> {
  const startTime = Date.now();
  const fetchFn = deps.fetchFn ?? fetch;
  const { urls, sourceType } = config;

  logger.info({ urlCount: urls.length }, "web collection started");

  const items: RawItemInsert[] = [];

  for (let i = 0; i < urls.length; i++) {
    if (i > 0) {
      await delay(URL_DELAY_MS);
    }

    const url = urls[i];
    try {
      const html = await fetchWithRetry(fetchFn, url);
      const selectors = await extractArticleSelectors(html, deps.geminiClient);
      const item = parseArticle(html, url, sourceType, selectors);
      if (item) {
        items.push(item);
      } else {
        logger.warn({ url }, "article skipped — no title found");
      }
    } catch (err) {
      logger.warn(
        { url, error: err instanceof Error ? err.message : String(err) },
        "URL processing failed, skipping",
      );
    }
  }

  let itemsStored = 0;
  if (items.length > 0) {
    await deps.rawItemsRepo.upsertItems(items);
    itemsStored = items.length;
  }

  const result: CollectorResult = {
    itemsFetched: items.length,
    commentsFetched: 0,
    itemsStored,
    durationMs: Date.now() - startTime,
  };

  logger.info(result, "web collection completed");

  return result;
}
