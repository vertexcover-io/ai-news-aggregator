import type { CaptureIncidentInput } from "../types/incident.js";
import { ENRICHMENT_FAILURE_RATE_THRESHOLD } from "../constants/index.js";

export interface EnrichmentTelemetry {
  attempted: number;
  ok: number;
  failed: number;
}

export interface SourceTelemetryEntry {
  collected: number;
  hasHistoricalItems: boolean;
}

export interface PublishResult {
  channel: string;
  ok: boolean;
}

export interface RunHealthInput {
  enrichmentTelemetry: EnrichmentTelemetry | null;
  sourceTelemetry: Record<string, SourceTelemetryEntry> | null;
  publishResults?: PublishResult[] | undefined;
  isDryRun: boolean;
}

/**
 * Pure evaluator: given finalization telemetry, return any incidents that
 * should be captured (REQ-006, REQ-007, REQ-008, EDGE-004, EDGE-005).
 *
 * - isDryRun → [] (EDGE-005)
 * - Null telemetry fields → skip relevant rule (EDGE-004)
 * - enrichment: failed/(ok+failed) > ENRICHMENT_FAILURE_RATE_THRESHOLD → warning run_degraded
 * - zero-yield: source with hasHistoricalItems but 0 collected → warning run_degraded
 * - partial publish: ≥1 ok AND ≥1 failed → error publish_partial_failure
 */
export function evaluateRunHealth(input: RunHealthInput): CaptureIncidentInput[] {
  if (input.isDryRun) return [];

  const incidents: CaptureIncidentInput[] = [];

  // Enrichment failure rate rule (REQ-006)
  const enrich = input.enrichmentTelemetry;
  if (enrich !== null && enrich.attempted > 0) {
    const total = enrich.ok + enrich.failed;
    if (total > 0 && enrich.failed / total > ENRICHMENT_FAILURE_RATE_THRESHOLD) {
      const pct = Math.round((enrich.failed / total) * 100);
      incidents.push({
        severity: "warning",
        category: "run_degraded",
        title: "High enrichment failure rate",
        message: `Enrichment failed for ${enrich.failed}/${total} links (${pct}%).`,
        context: { failedCount: enrich.failed, totalCount: total, failureRate: enrich.failed / total },
      });
    }
  }

  // Zero-yield rule (REQ-007)
  const sourceTelemetry = input.sourceTelemetry;
  if (sourceTelemetry !== null) {
    for (const [source, entry] of Object.entries(sourceTelemetry)) {
      if (entry.hasHistoricalItems && entry.collected === 0) {
        incidents.push({
          severity: "warning",
          category: "run_degraded",
          title: `Zero yield from ${source}`,
          message: `Source "${source}" produced 0 items despite having historical items.`,
          source,
          context: { reason: "zero_yield", source },
        });
      }
    }
  }

  // Partial publish rule (REQ-008)
  const publishResults = input.publishResults;
  if (publishResults !== undefined && publishResults.length > 0) {
    const hasOk = publishResults.some((r) => r.ok);
    const hasFailed = publishResults.some((r) => !r.ok);
    if (hasOk && hasFailed) {
      const failedChannels = publishResults.filter((r) => !r.ok).map((r) => r.channel);
      incidents.push({
        severity: "error",
        category: "publish_partial_failure",
        title: "Partial publish failure",
        message: `Publishing failed for channels: ${failedChannels.join(", ")}.`,
        context: { failedChannels },
      });
    }
  }

  return incidents;
}
