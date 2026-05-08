import type { RankedItem } from "@newsletter/shared";

const WPM = 200;

function wordCount(text: string): number {
  if (text.length === 0) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function readingTimeMinutes(items: readonly RankedItem[]): number {
  let total = 0;
  for (const item of items) {
    if (!item.recap) continue;
    total += wordCount(item.recap.summary);
    total += wordCount(item.recap.bottomLine);
    for (const b of item.recap.bullets) {
      total += wordCount(b);
    }
  }
  return Math.max(1, Math.ceil(total / WPM));
}
