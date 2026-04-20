import type { RawItemInsert } from "@newsletter/shared/db";
import { createLogger } from "@newsletter/shared/logger";

const logger = createLogger("collector:date-filter");

export function filterBySinceDays(
  items: RawItemInsert[],
  sinceDays: number,
  context: string,
): RawItemInsert[] {
  const cutoff = Date.now() - sinceDays * 86_400_000;
  const before = items.length;
  const filtered = items.filter((item) => {
    if (!item.publishedAt) return true;
    const t = item.publishedAt.getTime();
    return Number.isFinite(t) && t >= cutoff;
  });
  const dropped = before - filtered.length;
  if (dropped > 0) {
    logger.warn(
      { context, sinceDays, dropped },
      "sinceDays filter dropped items",
    );
  } else if (before > 0) {
    logger.warn(
      { context, sinceDays, fetched: before },
      "sinceDays filter dropped 0 items — feed may be truncated",
    );
  }
  return filtered;
}
