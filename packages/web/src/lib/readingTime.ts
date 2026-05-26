import type { RankedItem } from "@newsletter/shared/types";
import { readingTimeMinutes as sharedReadingTimeMinutes } from "@newsletter/shared/utils/reading-time";

export function readingTimeMinutes(items: readonly RankedItem[]): number {
  return sharedReadingTimeMinutes(
    items.map((i) => ({
      summary: i.recap?.summary,
      bullets: i.recap?.bullets,
      bottomLine: i.recap?.bottomLine,
    })),
  );
}
