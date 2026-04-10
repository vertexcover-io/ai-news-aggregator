export const DEFAULT_HALF_LIFE_HOURS = 48;
export const DEFAULT_GRAVITY_EXPONENT = 1.5;

export function recencyDecay(ageHours: number, halfLifeHours: number): number {
  if (halfLifeHours <= 0) {
    throw new Error("halfLifeHours must be > 0");
  }
  return Math.exp(-ageHours / halfLifeHours);
}

/**
 * HN-style gravity recency: 1 / (ageHours + 2)^exponent
 * Less aggressive than exponential decay; applied once in the final fusion stage.
 */
export function recencyGravity(
  ageHours: number,
  exponent: number = DEFAULT_GRAVITY_EXPONENT,
): number {
  const clampedAge = Math.max(0, ageHours);
  return 1 / Math.pow(clampedAge + 2, exponent);
}

export function ageHoursFromPublishedAt(
  publishedAt: Date | null,
  now: Date = new Date(),
): number {
  if (publishedAt === null) return 24;
  const diffMs = now.getTime() - publishedAt.getTime();
  return Math.max(0, diffMs / 3_600_000);
}
