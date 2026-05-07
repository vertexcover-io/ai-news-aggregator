import type {
  CollectorResult,
  RunSourceTelemetry,
  SourceTelemetryEntry,
} from "@newsletter/shared";

export type CollectorSourceType = "hn" | "reddit" | "blog" | "twitter";

export interface CollectorOutcome {
  sourceType: CollectorSourceType;
  result: CollectorResult | null;
  topLevelError: string | null;
  durationMs: number;
}

const FALLBACK_DISPLAY_NAMES: Record<CollectorSourceType, string> = {
  hn: "Hacker News",
  reddit: "Reddit",
  blog: "Web sources",
  twitter: "Twitter",
};

function deriveStatus(outcome: CollectorOutcome): SourceTelemetryEntry["status"] {
  if (outcome.topLevelError !== null) return "failed";
  if (outcome.result !== null) return "completed";
  return "failed";
}

export function buildSourceTelemetry(
  outcomes: CollectorOutcome[],
): RunSourceTelemetry {
  const sources: SourceTelemetryEntry[] = [];

  for (const outcome of outcomes) {
    const units = outcome.result?.unitResults;
    if (units !== undefined && units.length > 0) {
      for (const unit of units) {
        sources.push({
          sourceType: outcome.sourceType,
          identifier: unit.identifier,
          displayName: unit.displayName,
          itemsFetched: unit.itemsFetched,
          status: unit.status,
          errors: unit.errors,
          retries: 0,
          durationMs: unit.durationMs,
        });
      }
      continue;
    }

    sources.push({
      sourceType: outcome.sourceType,
      identifier: outcome.sourceType,
      displayName: FALLBACK_DISPLAY_NAMES[outcome.sourceType],
      itemsFetched: outcome.result?.itemsFetched ?? 0,
      status: deriveStatus(outcome),
      errors: outcome.topLevelError !== null ? [outcome.topLevelError] : [],
      retries: 0,
      durationMs: outcome.durationMs,
    });
  }

  const totalItemsFetched = sources.reduce((s, e) => s + e.itemsFetched, 0);
  const totalErrors = sources.reduce(
    (s, e) => s + (e.errors.length > 0 ? 1 : 0),
    0,
  );

  return { sources, totalItemsFetched, totalErrors };
}
