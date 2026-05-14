import type {
  EnrichedLinkContent,
  EnrichmentSkipReason,
  EnrichmentTelemetry,
  RawItemInsert,
  RawItemMetadata,
} from "@newsletter/shared";
import { enrichOne } from "@pipeline/services/link-enrichment/fetcher.js";
import type { EnrichmentContext, EnrichmentCounters } from "@pipeline/services/link-enrichment/types.js";
import { shouldEnrich } from "@pipeline/services/link-enrichment/url-classifier.js";

function attach(item: RawItemInsert, enriched: EnrichedLinkContent): void {
  const existing: RawItemMetadata = item.metadata ?? { comments: [] };
  item.metadata = { ...existing, enrichedLink: enriched };
}

function bumpSkipReason(counters: EnrichmentCounters, reason: EnrichmentSkipReason): void {
  counters.skippedReasons.set(reason, (counters.skippedReasons.get(reason) ?? 0) + 1);
}

export async function enrichRawItems(
  items: RawItemInsert[],
  ctx: EnrichmentContext,
): Promise<RawItemInsert[]> {
  for (const item of items) {
    if (ctx.signal?.aborted) {
      const enriched: EnrichedLinkContent = {
        url: item.url,
        fetchedAt: new Date().toISOString(),
        status: "failed",
        failureReason: "cancelled",
      };
      attach(item, enriched);
      ctx.counters.attempted += 1;
      ctx.counters.failed += 1;
      continue;
    }

    try {
      const decision = shouldEnrich(item, ctx.cache);

      if (!decision.enrich && decision.skipReason === "cache-hit" && decision.canonical) {
        const cached = ctx.cache.get(decision.canonical);
        if (cached) {
          const copy: EnrichedLinkContent = { ...cached, cacheHit: true };
          attach(item, copy);
          ctx.counters.ok += 1;
          ctx.counters.cacheHits += 1;
          continue;
        }
      }

      if (!decision.enrich) {
        const enriched: EnrichedLinkContent = {
          url: item.url,
          fetchedAt: new Date().toISOString(),
          status: "skipped",
          skipReason: decision.skipReason,
        };
        attach(item, enriched);
        ctx.counters.skipped += 1;
        bumpSkipReason(ctx.counters, decision.skipReason);
        continue;
      }

      ctx.counters.attempted += 1;
      const result = await enrichOne(item.url, decision.canonical, ctx);
      attach(item, result);
      if (result.status === "ok") {
        ctx.counters.ok += 1;
        ctx.cache.set(decision.canonical, result);
      } else {
        ctx.counters.failed += 1;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const enriched: EnrichedLinkContent = {
        url: item.url,
        fetchedAt: new Date().toISOString(),
        status: "failed",
        failureReason: `exception: ${msg}`.slice(0, 120),
      };
      attach(item, enriched);
      ctx.counters.attempted += 1;
      ctx.counters.failed += 1;
    }
  }
  return items;
}

export function toEnrichmentTelemetry(counters: EnrichmentCounters): EnrichmentTelemetry {
  const skippedReasons: Partial<Record<EnrichmentSkipReason, number>> = {};
  for (const [k, v] of counters.skippedReasons.entries()) {
    skippedReasons[k as EnrichmentSkipReason] = v;
  }
  return {
    attempted: counters.attempted,
    ok: counters.ok,
    failed: counters.failed,
    skipped: counters.skipped,
    skippedReasons,
    cacheHits: counters.cacheHits,
    avgFetchMs: Math.round(counters.totalFetchMs / Math.max(1, counters.ok + counters.failed)),
  };
}

export { createEnrichmentCache } from "@pipeline/services/link-enrichment/cache.js";
export { enrichOne } from "@pipeline/services/link-enrichment/fetcher.js";
export {
  shouldEnrich,
  canonicalizeEnrichmentUrl,
  getContentType,
} from "@pipeline/services/link-enrichment/url-classifier.js";
export type { ShouldEnrichResult } from "@pipeline/services/link-enrichment/url-classifier.js";
export { newCounters } from "@pipeline/services/link-enrichment/types.js";
export type { EnrichmentContext, EnrichmentCounters } from "@pipeline/services/link-enrichment/types.js";
