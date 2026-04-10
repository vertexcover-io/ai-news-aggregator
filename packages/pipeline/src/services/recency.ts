export const DEFAULT_HALF_LIFE_HOURS = 48;

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
