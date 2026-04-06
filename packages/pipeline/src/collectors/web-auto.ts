import * as cheerio from "cheerio";
import type { CollectorResult } from "@newsletter/shared/types";
import type { WebAutoCollectConfig, WebAutoSourceConfig, WebSourceConfig, WebSourceSelectors } from "@pipeline/types.js";
import { createLogger } from "@newsletter/shared/logger";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import type { GeminiClient } from "@pipeline/collectors/web-selectors.js";
import type { SelectorCache } from "@pipeline/collectors/selector-cache.js";
import { extractSelectors } from "@pipeline/collectors/web-selectors.js";
import { collectSource } from "@pipeline/collectors/web.js";

const logger = createLogger("collector:web-auto");

const SOURCE_DELAY_MS = 500;

export interface WebAutoCollectorDeps {
  rawItemsRepo: RawItemsRepo;
  fetchFn?: typeof fetch;
  geminiClient: GeminiClient;
  selectorCache: SelectorCache;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildWebSourceConfig(
  source: WebAutoSourceConfig,
  selectors: WebSourceSelectors,
): WebSourceConfig {
  return {
    name: source.name,
    sourceType: source.sourceType,
    indexUrl: source.indexUrl,
    selectors,
    maxItems: source.maxItems,
  };
}

function findFirstArticleUrl(html: string, articleLinkSelector: string, baseUrl: string): string | null {
  const $ = cheerio.load(html);
  const href = $(articleLinkSelector).first().attr("href");
  if (!href) {
    return null;
  }
  return new URL(href, baseUrl).href;
}

async function deriveSelectorsFromHtml(
  fetchFn: typeof fetch,
  geminiClient: GeminiClient,
  indexUrl: string,
): Promise<WebSourceSelectors> {
  const indexResponse = await fetchFn(indexUrl);
  const indexHtml = await indexResponse.text();

  const indexSelectors = await extractSelectors(indexHtml, "index", geminiClient);
  if (!indexSelectors.articleLink) {
    throw new Error(`LLM did not return articleLink selector for ${indexUrl}`);
  }
  const articleLink = indexSelectors.articleLink;

  const firstArticleUrl = findFirstArticleUrl(indexHtml, articleLink, indexUrl);
  if (!firstArticleUrl) {
    throw new Error(`No article links found using selector "${articleLink}" on ${indexUrl}`);
  }

  const articleResponse = await fetchFn(firstArticleUrl);
  const articleHtml = await articleResponse.text();

  const articleSelectors = await extractSelectors(articleHtml, "article", geminiClient);
  if (!articleSelectors.title || !articleSelectors.content) {
    throw new Error(`LLM did not return title/content selectors for ${indexUrl}`);
  }

  return {
    articleLink,
    title: articleSelectors.title,
    content: articleSelectors.content,
    ...(articleSelectors.author !== undefined ? { author: articleSelectors.author } : {}),
    ...(articleSelectors.date !== undefined ? { date: articleSelectors.date } : {}),
  };
}

async function collectAutoSource(
  deps: WebAutoCollectorDeps,
  source: WebAutoSourceConfig,
): Promise<{ itemsFetched: number; itemsStored: number }> {
  const fetchFn = deps.fetchFn ?? fetch;
  const { geminiClient, selectorCache } = deps;

  // Step 1: If explicit selectors, use them directly
  if (source.selectors) {
    const config = buildWebSourceConfig(source, source.selectors);
    const items = await collectSource(fetchFn, config);

    if (items.length > 0) {
      await deps.rawItemsRepo.upsertItems(items);
    }
    return { itemsFetched: items.length, itemsStored: items.length };
  }

  // Step 2-4: Check cache or derive
  let selectors = selectorCache.get(source.indexUrl);
  let derivedFresh = false;

  if (!selectors) {
    selectors = await deriveSelectorsFromHtml(fetchFn, geminiClient, source.indexUrl);
    selectorCache.set(source.indexUrl, selectors);
    derivedFresh = true;
  }

  // Step 5-6: Build config and collect
  const config = buildWebSourceConfig(source, selectors);
  const items = await collectSource(fetchFn, config);

  // Step 7: If 0 items, invalidate and retry once
  if (items.length === 0 && !derivedFresh) {
    logger.warn({ source: source.name }, "0 items extracted, invalidating cache and retrying");
    selectorCache.invalidate(source.indexUrl);

    const newSelectors = await deriveSelectorsFromHtml(fetchFn, geminiClient, source.indexUrl);
    selectorCache.set(source.indexUrl, newSelectors);

    const retryConfig = buildWebSourceConfig(source, newSelectors);
    const retryItems = await collectSource(fetchFn, retryConfig);

    if (retryItems.length === 0) {
      logger.error({ source: source.name }, "retry also produced 0 items, skipping source");
      return { itemsFetched: 0, itemsStored: 0 };
    }

    await deps.rawItemsRepo.upsertItems(retryItems);
    return { itemsFetched: retryItems.length, itemsStored: retryItems.length };
  }

  if (items.length === 0 && derivedFresh) {
    // Freshly derived selectors also produced 0 items — invalidate and retry once
    logger.warn({ source: source.name }, "freshly derived selectors produced 0 items, retrying");
    selectorCache.invalidate(source.indexUrl);

    const newSelectors = await deriveSelectorsFromHtml(fetchFn, geminiClient, source.indexUrl);
    selectorCache.set(source.indexUrl, newSelectors);

    const retryConfig = buildWebSourceConfig(source, newSelectors);
    const retryItems = await collectSource(fetchFn, retryConfig);

    if (retryItems.length === 0) {
      logger.error({ source: source.name }, "retry also produced 0 items, skipping source");
      return { itemsFetched: 0, itemsStored: 0 };
    }

    await deps.rawItemsRepo.upsertItems(retryItems);
    return { itemsFetched: retryItems.length, itemsStored: retryItems.length };
  }

  await deps.rawItemsRepo.upsertItems(items);
  return { itemsFetched: items.length, itemsStored: items.length };
}

export async function collectWebAuto(
  deps: WebAutoCollectorDeps,
  config: WebAutoCollectConfig,
): Promise<CollectorResult> {
  const startTime = Date.now();
  const { sources } = config;

  logger.info({ sourceCount: sources.length }, "web-auto collection started");

  let totalItemsFetched = 0;
  let totalItemsStored = 0;

  for (let s = 0; s < sources.length; s++) {
    if (s > 0) {
      await delay(SOURCE_DELAY_MS);
    }

    const source = sources[s];
    try {
      const { itemsFetched, itemsStored } = await collectAutoSource(deps, source);
      totalItemsFetched += itemsFetched;
      totalItemsStored += itemsStored;
    } catch (err) {
      logger.error(
        { source: source.name, error: err instanceof Error ? err.message : String(err) },
        "web-auto source collection failed, skipping",
      );
    }
  }

  const result: CollectorResult = {
    itemsFetched: totalItemsFetched,
    commentsFetched: 0,
    itemsStored: totalItemsStored,
    durationMs: Date.now() - startTime,
  };

  logger.info(result, "web-auto collection completed");

  return result;
}
