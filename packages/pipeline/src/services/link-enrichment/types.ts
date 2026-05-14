import type { EnrichedLinkContent } from "@newsletter/shared";
import type { Logger } from "@newsletter/shared/logger";

export interface EnrichmentCounters {
  attempted: number;
  ok: number;
  failed: number;
  skipped: number;
  cacheHits: number;
  totalFetchMs: number;
  skippedReasons: Map<string, number>;
}

export interface EnrichmentContext {
  logger: Logger;
  signal?: AbortSignal;
  cache: Map<string, EnrichedLinkContent>;
  counters: EnrichmentCounters;
}

export function newCounters(): EnrichmentCounters {
  return {
    attempted: 0,
    ok: 0,
    failed: 0,
    skipped: 0,
    cacheHits: 0,
    totalFetchMs: 0,
    skippedReasons: new Map(),
  };
}
