import type {
  RunLogContext,
  RunLogEntry,
  RunSourceItemsSummary,
  RunSourceStep,
  SourceStepKey,
  SourceStepStatus,
} from "../types/observability.js";

/** Canonical step order, collect-time first then process-time. */
export const SOURCE_STEP_ORDER: readonly SourceStepKey[] = [
  "discover",
  "fetch",
  "extract",
  "enrich",
  "dedup",
  "shortlist",
  "rank",
] as const;

const STEP_LABELS: Record<SourceStepKey, string> = {
  discover: "Discover",
  fetch: "Fetch",
  extract: "Extract",
  enrich: "Enrich",
  dedup: "Dedup",
  shortlist: "Shortlist",
  rank: "Rank",
};

/** Steps fed by run-log events (collect time). */
const COLLECT_STEPS: ReadonlySet<SourceStepKey> = new Set<SourceStepKey>([
  "discover",
  "fetch",
  "extract",
  "enrich",
]);

/**
 * Map a run-log event (and optional explicit `context.step`) to the extraction
 * step it belongs to. Honors `context.step` when present; otherwise matches the
 * event name against known substrings. Returns null when the event is not a
 * per-source collect-time step (e.g. stage brackets, run lifecycle).
 */
const STEP_KEY_SET: ReadonlySet<string> = new Set(SOURCE_STEP_ORDER);

export function classifyLogStep(
  event: string,
  context: RunLogContext | null,
): SourceStepKey | null {
  // Honor an explicit context.step only when it is a canonical step key — some
  // collectors stamp a looser vocabulary (e.g. "listing", "discovery") that we
  // re-map via the event-name heuristics below.
  const explicit = context?.step;
  if (typeof explicit === "string" && STEP_KEY_SET.has(explicit)) {
    return explicit;
  }

  const e = event.toLowerCase();
  if (e.includes("listing") || e.includes("discover")) return "discover";
  if (e.includes("enrich")) return "enrich";
  if (e.includes("extract")) return "extract";
  if (e.includes("fetch") || e.includes("detail") || e.includes("crawler")) {
    return "fetch";
  }
  return null;
}

function numericContext(
  context: RunLogContext | null,
  keys: readonly string[],
): number | null {
  if (context === null) return null;
  for (const key of keys) {
    const value = context[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

interface CollectStepAccumulator {
  logs: RunLogEntry[];
  hasError: boolean;
  hasFatal: boolean;
}

function emptyStep(key: SourceStepKey, status: SourceStepStatus): RunSourceStep {
  return {
    key,
    label: STEP_LABELS[key],
    status,
    count: null,
    detail: null,
    durationMs: null,
  };
}

export interface BuildSourceStepsInput {
  /** Logs already scoped to a single source. */
  readonly logs: readonly RunLogEntry[];
  readonly summary: RunSourceItemsSummary;
  /** Number of items the source contributed to the pool. */
  readonly itemCount: number;
}

/**
 * Derive the per-source step timeline at read time. Collect-time steps come
 * from the source-scoped logs; process-time steps come from the item lifecycle
 * summary. A fatal error in a collect step marks that step `failed` and every
 * later step `skipped`; steps with no signal are `empty`.
 */
export function buildSourceSteps(input: BuildSourceStepsInput): RunSourceStep[] {
  const { logs, summary, itemCount } = input;

  const collect = new Map<SourceStepKey, CollectStepAccumulator>();
  for (const log of logs) {
    const key = classifyLogStep(log.event, log.context);
    if (key === null || !COLLECT_STEPS.has(key)) continue;
    const acc = collect.get(key) ?? { logs: [], hasError: false, hasFatal: false };
    acc.logs.push(log);
    if (log.level === "error") {
      acc.hasError = true;
      if (log.context?.fatal === true) acc.hasFatal = true;
    }
    collect.set(key, acc);
  }

  // First collect step that fatally failed — everything after it is skipped.
  let fatalIndex = -1;
  SOURCE_STEP_ORDER.forEach((key, index) => {
    if (fatalIndex === -1 && collect.get(key)?.hasFatal === true) {
      fatalIndex = index;
    }
  });

  return SOURCE_STEP_ORDER.map((key, index) => {
    if (fatalIndex !== -1 && index > fatalIndex) {
      return emptyStep(key, "skipped");
    }

    if (COLLECT_STEPS.has(key)) {
      const acc = collect.get(key);
      if (acc === undefined) {
        // No signal: skipped if the run already fatally failed upstream, else empty.
        return emptyStep(key, fatalIndex !== -1 ? "skipped" : "empty");
      }
      // acc is only created when at least one log was pushed, so logs is non-empty.
      const last = acc.logs[acc.logs.length - 1];
      const durationMs = (() => {
        let max: number | null = null;
        for (const l of acc.logs) {
          const d = numericContext(l.context, ["durationMs"]);
          if (d !== null && (max === null || d > max)) max = d;
        }
        return max;
      })();
      const count = numericContext(last.context, [
        "extracted",
        "discovered",
        "outputCount",
        "itemsFetched",
        "count",
      ]);
      const status: SourceStepStatus = acc.hasFatal
        ? "failed"
        : "done";
      const detail = acc.hasError && !acc.hasFatal ? "completed with errors" : null;
      return { key, label: STEP_LABELS[key], status, count, detail, durationMs };
    }

    // Process-time steps from the lifecycle summary.
    if (itemCount === 0) {
      return emptyStep(key, fatalIndex !== -1 ? "skipped" : "empty");
    }
    switch (key) {
      case "dedup":
        return {
          key,
          label: STEP_LABELS.dedup,
          status: "done",
          count: summary.dedupedSurvivors,
          detail:
            summary.dedupDropped > 0
              ? `${String(summary.dedupDropped)} dropped`
              : null,
          durationMs: null,
        };
      case "shortlist":
        return {
          key,
          label: STEP_LABELS.shortlist,
          status: summary.shortlisted > 0 ? "done" : "empty",
          count: summary.shortlisted,
          detail: null,
          durationMs: null,
        };
      case "rank":
        return {
          key,
          label: STEP_LABELS.rank,
          status: summary.ranked > 0 ? "done" : "empty",
          count: summary.ranked,
          detail: null,
          durationMs: null,
        };
      default:
        return emptyStep(key, "empty");
    }
  });
}
