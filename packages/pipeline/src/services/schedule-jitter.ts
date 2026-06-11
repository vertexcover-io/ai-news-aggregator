/**
 * Compute deterministic start-time jitter for a tenant's scheduled run.
 * Same tenant + same nominal time → same offset (repeatable).
 * Different tenants/spreads produce different offsets within ±windowMs.
 *
 * Uses a simple hash of tenantId + time bucket for reproducibility.
 */
export function computeJitterMs(
  tenantId: string,
  nominalTimeMs: number,
  windowMs: number,
): number {
  // Hash: combine tenantId and time bucket for deterministic output
  const key = `${tenantId}:${nominalTimeMs}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  // Map to [-windowMs, +windowMs]
  // Use modulo with windowMs*2 and shift to center
  const range = windowMs * 2;
  const positiveHash = Math.abs(hash);
  return (positiveHash % range) - windowMs;
}
