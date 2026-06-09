export interface RunHealthInput {
  readonly enrichment: { readonly ok: number; readonly failed: number } | null;
  readonly sources: readonly {
    readonly source: string;
    readonly collected: number;
    readonly historicalYield: boolean;
  }[] | null;
  readonly publish: { readonly ok: number; readonly failed: number } | null;
  readonly isDryRun: boolean;
}

export type RunHealthKind =
  | "enrichment_failure_rate"
  | "zero_yield_source"
  | "partial_publish";

export interface RunHealthFinding {
  readonly kind: RunHealthKind;
  readonly severity: "warning" | "error";
  readonly detail: Record<string, string | number>;
}

export const ENRICHMENT_FAILURE_RATE_THRESHOLD = 0.3;

export function evaluateRunHealth(input: RunHealthInput): RunHealthFinding[] {
  if (input.isDryRun) return [];

  const findings: RunHealthFinding[] = [];

  // Rule 1: enrichment_failure_rate
  if (input.enrichment !== null) {
    const { ok, failed } = input.enrichment;
    const total = ok + failed;
    if (total > 0) {
      const rate = failed / total;
      if (rate > ENRICHMENT_FAILURE_RATE_THRESHOLD) {
        findings.push({
          kind: "enrichment_failure_rate",
          severity: "warning",
          detail: { failed, total, rate },
        });
      }
    }
  }

  // Rule 2: zero_yield_source (one finding per qualifying source)
  if (input.sources !== null) {
    for (const src of input.sources) {
      if (src.historicalYield && src.collected === 0) {
        findings.push({
          kind: "zero_yield_source",
          severity: "warning",
          detail: { source: src.source },
        });
      }
    }
  }

  // Rule 3: partial_publish
  if (input.publish !== null) {
    const { ok, failed } = input.publish;
    if (ok >= 1 && failed >= 1) {
      findings.push({
        kind: "partial_publish",
        severity: "error",
        detail: { ok, failed },
      });
    }
  }

  return findings;
}
