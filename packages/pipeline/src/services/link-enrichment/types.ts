import type { EnrichedLinkContent } from "@newsletter/shared";
import type { Logger } from "@newsletter/shared/logger";
import type { RunLogger } from "@pipeline/services/run-logger.js";
import type { AlertDispatcher } from "@newsletter/shared/alerting";

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
  runLogger?: RunLogger;
  /** Optional alert dispatcher — if present, enrichment failures capture an incident (REQ-004). */
  alertDispatcher?: AlertDispatcher;
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
