/**
 * Deterministic jitter: hash a tenant seed string into a deterministic offset.
 *
 * The seed is typically a tenantId so that every tenant sharing a nominal
 * schedule time gets a stable, repeatable offset within the jitter window.
 *
 * Modes:
 * - "positive" (default): offset in [0, windowMs]
 * - "symmetric": offset in [-windowMs, +windowMs] (REQ-066: spread starts around
 *   the nominal time, not just after it)
 */
export interface JitterOptions {
  readonly windowMs: number;
  readonly mode?: "positive" | "symmetric";
}

/**
 * Simple non-cryptographic hash (FNV-1a 32-bit) for deterministic jitter.
 * Returns a number in [0, 1).
 */
function hashToUnit(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Map 32-bit unsigned to [0, 1)
  return ((h >>> 0) % 1000000) / 1000000;
}

export function computeJitterOffsetMs(
  seed: string,
  opts: JitterOptions,
): number {
  if (opts.windowMs <= 0) return 0;
  const unit = hashToUnit(seed);
  if (opts.mode === "symmetric") {
    return Math.round((unit - 0.5) * 2 * opts.windowMs);
  }
  return Math.round(unit * opts.windowMs);
}
