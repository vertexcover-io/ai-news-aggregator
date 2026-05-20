import { createHash } from "node:crypto";
import type { RawItemInsert } from "@newsletter/shared/db";
import type {
  CollectorResult,
  RunSubmitWebSearchConfig,
  SourceUnitResult,
} from "@newsletter/shared/types";
import { createLogger } from "@newsletter/shared/logger";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import { enrichRawItems } from "@pipeline/services/link-enrichment/index.js";
import type { EnrichmentContext } from "@pipeline/services/link-enrichment/types.js";
import type {
  WebSearchProvider,
  WebSearchResult,
} from "@pipeline/collectors/web-search/providers/types.js";

const logger = createLogger("collector:web-search");

export interface WebSearchCollectorDeps {
  rawItemsRepo: RawItemsRepo;
  provider: WebSearchProvider;
  signal?: AbortSignal;
  enrichment?: EnrichmentContext;
}

interface QuerySuccess {
  query: string;
  results: WebSearchResult[];
  durationMs: number;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function mapToRawItem(
  result: WebSearchResult,
  providerName: string,
  originatingQuery: string,
): RawItemInsert {
  const collectedAt = new Date();
  const publishedAt = result.publishedAt ?? collectedAt;
  return {
    sourceType: "web_search",
    externalId: `${providerName}:${sha256(result.url)}`,
    title: result.title,
    url: result.url,
    sourceUrl: result.url,
    author: null,
    content: result.snippet,
    imageUrl: result.imageUrl ?? null,
    publishedAt,
    collectedAt,
    engagement: { points: 0, commentCount: 0 },
    metadata: {
      comments: [],
      provider: providerName,
      query: originatingQuery,
      rawScore: result.rawScore,
      providerMetadata: result.providerMetadata,
    },
    updatedAt: collectedAt,
  };
}

export async function collectWebSearch(
  deps: WebSearchCollectorDeps,
  config: RunSubmitWebSearchConfig,
): Promise<CollectorResult> {
  const startTime = Date.now();
  const queries = config.queries;

  if (queries.length === 0) {
    return {
      itemsFetched: 0,
      commentsFetched: 0,
      itemsStored: 0,
      durationMs: Date.now() - startTime,
      unitResults: [],
    };
  }

  logger.info(
    {
      event: "collector.web_search.started",
      provider: deps.provider.name,
      queryCount: queries.length,
    },
    "collection started",
  );

  if (deps.signal?.aborted) {
    const unitResults: SourceUnitResult[] = queries.map((q) => ({
      identifier: `web_search:${q.query}`,
      displayName: q.query,
      itemsFetched: 0,
      status: "failed",
      errors: ["aborted"],
      durationMs: 0,
    }));
    return {
      itemsFetched: 0,
      commentsFetched: 0,
      itemsStored: 0,
      durationMs: Date.now() - startTime,
      unitResults,
    };
  }

  // Capture per-query start times outside the closure so rejected promises
  // still report an accurate durationMs (was 0 in pass-1).
  const queryStarts = queries.map(() => Date.now());

  // Tavily's SDK does not consume the AbortSignal field on SearchInput
  // (spec REQ-002 explicitly required a Promise.race fallback in this case).
  // Race each query against an abort-aware promise so a mid-stage cancel
  // short-circuits in-flight calls instead of waiting for the HTTP timeout.
  const abortRace = <T>(p: Promise<T>): Promise<T> => {
    const signal = deps.signal;
    if (!signal) return p;
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        const reason: unknown = signal.reason;
        reject(reason instanceof Error ? reason : new Error("aborted"));
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
      p.then(
        (v) => {
          signal.removeEventListener("abort", onAbort);
          resolve(v);
        },
        (e: unknown) => {
          signal.removeEventListener("abort", onAbort);
          reject(e instanceof Error ? e : new Error(String(e)));
        },
      );
    });
  };

  const settled = await Promise.allSettled(
    queries.map(async (q, idx): Promise<QuerySuccess> => {
      const results = await abortRace(
        deps.provider.search({
          query: q.query,
          sinceDays: q.sinceDays,
          maxItems: q.maxItems,
          signal: deps.signal,
        }),
      );
      return {
        query: q.query,
        results,
        durationMs: Date.now() - (queryStarts[idx] ?? Date.now()),
      };
    }),
  );

  const unitResults: SourceUnitResult[] = [];
  const byUrl = new Map<string, { item: RawItemInsert; score: number; query: string }>();
  let itemsFetched = 0;

  settled.forEach((outcome, idx) => {
    const queryConfig = queries[idx];
    const identifier = `web_search:${queryConfig.query}`;

    if (outcome.status === "rejected") {
      const reason: unknown = outcome.reason;
      const message = reason instanceof Error ? reason.message : String(reason);
      unitResults.push({
        identifier,
        displayName: queryConfig.query,
        itemsFetched: 0,
        status: "failed",
        errors: [message],
        durationMs: Date.now() - (queryStarts[idx] ?? Date.now()),
      });
      return;
    }

    const { results, durationMs } = outcome.value;
    itemsFetched += results.length;

    for (const r of results) {
      const item = mapToRawItem(r, deps.provider.name, queryConfig.query);
      const score = r.rawScore ?? 0;
      const existing = byUrl.get(item.url);
      if (!existing || score > existing.score) {
        byUrl.set(item.url, { item, score, query: queryConfig.query });
      }
    }

    unitResults.push({
      identifier,
      displayName: queryConfig.query,
      itemsFetched: results.length,
      status: "completed",
      errors: [],
      durationMs,
    });
  });

  let items = Array.from(byUrl.values(), (v) => v.item);

  if (deps.enrichment && items.length > 0) {
    items = await enrichRawItems(items, deps.enrichment);
  }

  if (items.length > 0) {
    await deps.rawItemsRepo.upsertItems(items);
  }

  const result: CollectorResult = {
    itemsFetched,
    commentsFetched: 0,
    itemsStored: items.length,
    durationMs: Date.now() - startTime,
    unitResults,
  };

  logger.info(
    { event: "collector.web_search.completed", ...result },
    "collection completed",
  );

  return result;
}
