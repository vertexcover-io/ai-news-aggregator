import { createHash } from "node:crypto";
import type { CollectorResult, RunSubmitWebSearchConfig, SourceUnitResult } from "@newsletter/shared/types";
import { createLogger } from "@newsletter/shared/logger";
import type { RawItemPreStamp as RawItemInsert, RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import { enrichRawItems } from "@pipeline/services/link-enrichment/index.js";
import type { EnrichmentContext } from "@pipeline/services/link-enrichment/types.js";
import type { WebSearchProvider, WebSearchResult } from "@pipeline/collectors/web-search/providers/index.js";

const logger = createLogger("collector:web-search");

export interface WebSearchCollectorDeps {
  rawItemsRepo: RawItemsRepo;
  provider: WebSearchProvider;
  signal?: AbortSignal;
  enrichment?: EnrichmentContext;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toRawItem(
  result: WebSearchResult,
  providerName: string,
  query: string,
): RawItemInsert {
  const now = new Date();
  return {
    sourceType: "web_search",
    externalId: `${providerName}:${sha256Hex(result.url)}`,
    title: result.title,
    url: result.url,
    sourceUrl: result.url,
    author: null,
    content: result.snippet,
    imageUrl: result.imageUrl ?? null,
    publishedAt: result.publishedAt ?? now,
    engagement: { points: 0, commentCount: 0 },
    metadata: {
      comments: [],
      provider: providerName,
      query,
      rawScore: result.rawScore ?? 0,
    },
  };
}

interface QueryOutcome {
  query: string;
  sinceDays: number;
  maxItems: number;
  outcome: PromiseSettledResult<WebSearchResult[]>;
}

export async function collectWebSearch(
  deps: WebSearchCollectorDeps,
  config: RunSubmitWebSearchConfig,
): Promise<CollectorResult> {
  const startMs = Date.now();

  if (config.queries.length === 0) {
    logger.info({ event: "collector.web-search.skipped", reason: "no queries configured" }, "no queries configured");
    return {
      itemsFetched: 0,
      commentsFetched: 0,
      itemsStored: 0,
      durationMs: Date.now() - startMs,
      unitResults: [],
    };
  }

  logger.info(
    { event: "collector.web-search.started", queryCount: config.queries.length, provider: deps.provider.name },
    "web-search collector started",
  );

  const settled = await Promise.allSettled(
    config.queries.map((q) =>
      deps.provider.search({
        query: q.query,
        sinceDays: q.sinceDays,
        maxItems: q.maxItems,
        signal: deps.signal,
      }),
    ),
  );

  // Pair each query config with its outcome (Promise.allSettled preserves order)
  const outcomes: QueryOutcome[] = config.queries.map((q, i) => ({
    query: q.query,
    sinceDays: q.sinceDays,
    maxItems: q.maxItems,
    outcome: settled[i] ?? { status: "rejected", reason: new Error("internal: missing outcome") },
  }));

  // Build URL-keyed map (dedup: keep higher rawScore winner)
  const itemsMap = new Map<string, RawItemInsert>();
  const unitResults: SourceUnitResult[] = [];
  let totalFetched = 0;

  for (const { query, outcome } of outcomes) {
    if (outcome.status === "rejected") {
      const message = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      logger.warn(
        { event: "collector.web-search.query_failed", query, error: message },
        "web-search query failed",
      );
      unitResults.push({
        identifier: query,
        displayName: query,
        itemsFetched: 0,
        status: "failed",
        errors: [message],
        durationMs: Date.now() - startMs,
      });
      continue;
    }

    const results: WebSearchResult[] = outcome.value;
    totalFetched += results.length;

    for (const result of results) {
      const incoming = toRawItem(result, deps.provider.name, query);
      const existing = itemsMap.get(result.url);
      if (!existing) {
        itemsMap.set(result.url, incoming);
      } else {
        const incomingScore = result.rawScore ?? 0;
        const existingScore = existing.metadata?.rawScore ?? 0;
        if (incomingScore > existingScore) {
          itemsMap.set(result.url, incoming);
        }
      }
    }

    logger.info(
      { event: "collector.web-search.query_completed", query, fetched: results.length },
      "web-search query completed",
    );

    unitResults.push({
      identifier: query,
      displayName: query,
      itemsFetched: results.length,
      status: "completed",
      errors: [],
      durationMs: Date.now() - startMs,
    });
  }

  const dedupedItems = [...itemsMap.values()];

  if (dedupedItems.length > 0) {
    if (deps.enrichment) {
      await enrichRawItems(dedupedItems, deps.enrichment);
    }
    await deps.rawItemsRepo.upsertItems(dedupedItems);
  }

  const result: CollectorResult = {
    itemsFetched: totalFetched,
    commentsFetched: 0,
    itemsStored: dedupedItems.length,
    durationMs: Date.now() - startMs,
    unitResults,
  };

  logger.info({ event: "collector.web-search.completed", ...result }, "web-search collector completed");

  return result;
}
