export const DEFAULT_PIPELINE_START_JITTER_MS = 180_000;

/**
 * Spread run starts across [0, maxMs) so tenants sharing a nominal schedule
 * time do not all start simultaneously (REQ-066). Pure: callers inject the
 * random source (production passes Math.random; tests pass a fixed fn).
 */
export function computeJitterMs(rand: () => number, maxMs: number): number {
  if (maxMs <= 0) return 0;
  return Math.floor(rand() * maxMs);
}

/** PIPELINE_START_JITTER_MS env: default 3 minutes; "0" disables; junk falls back to the default. */
export function parsePipelineStartJitterMs(value: string | undefined): number {
  if (value === undefined || value === "") return DEFAULT_PIPELINE_START_JITTER_MS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_PIPELINE_START_JITTER_MS;
  return Math.floor(parsed);
}
