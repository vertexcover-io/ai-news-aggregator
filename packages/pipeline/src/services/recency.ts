export const DEFAULT_HALF_LIFE_HOURS = 72;

export function recencyDecay(ageHours: number, halfLifeHours: number): number {
  if (halfLifeHours <= 0) {
    throw new Error("halfLifeHours must be > 0");
  }
  return Math.exp(-ageHours / halfLifeHours);
}

export function ageHoursFromPublishedAt(
  publishedAt: Date | null,
  now: Date = new Date(),
): number {
  if (publishedAt === null) return 24;
  const diffMs = now.getTime() - publishedAt.getTime();
  return Math.max(0, diffMs / 3_600_000);
}

/**
 * Compute a normalized engagement score using log compression.
 * log1p compresses the power-law distribution of engagement
 * (a few posts get 1000+ points, most get 10-50).
 * Comments are weighted at 0.5x since they're a weaker signal than points.
 */
export function engagementScore(points: number, commentCount: number): number {
  return Math.log1p(points) + 0.5 * Math.log1p(commentCount);
}
