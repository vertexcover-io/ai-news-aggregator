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

const FAILURE_REASON_MAX_LEN = 120;

function attach(item: RawItemInsert, enriched: EnrichedLinkContent): void {
  const existing: RawItemMetadata = item.metadata ?? { comments: [] };
  item.metadata = { ...existing, enrichedLink: enriched };
}

function bumpSkipReason(counters: EnrichmentCounters, reason: EnrichmentSkipReason): void {
  counters.skippedReasons.set(reason, (counters.skippedReasons.get(reason) ?? 0) + 1);
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function logEnrichmentFailure(
  ctx: EnrichmentContext,
  item: RawItemInsert,
  failureReason: string,
): void {
  if (!ctx.runLogger) return;
  const hostname = hostnameOf(item.url);
  void ctx.runLogger.error(
    {
      stage: "enrich",
      source: item.sourceType,
      event: "link_enrichment.failed",
      url: item.url,
      externalId: item.externalId,
      step: "enrich",
      error: failureReason,
      failureReason,
      originatingCollector: item.sourceType,
    },
    `link enrichment failed: ${hostname} — ${failureReason}`,
  );
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
      logEnrichmentFailure(ctx, item, "cancelled");
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
        logEnrichmentFailure(ctx, item, result.failureReason ?? "unknown");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const failureReason = `exception: ${msg}`.slice(0, FAILURE_REASON_MAX_LEN);
      const enriched: EnrichedLinkContent = {
        url: item.url,
        fetchedAt: new Date().toISOString(),
        status: "failed",
        failureReason,
      };
      attach(item, enriched);
      ctx.counters.attempted += 1;
      ctx.counters.failed += 1;
      logEnrichmentFailure(ctx, item, failureReason);
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
export { newCounters } from "@pipeline/services/link-enrichment/types.js";
export type { EnrichmentContext, EnrichmentCounters } from "@pipeline/services/link-enrichment/types.js";
