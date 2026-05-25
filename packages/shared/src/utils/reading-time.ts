export interface ReadingTimeStory {
  readonly summary?: string | null;
  readonly bullets?: readonly string[] | null;
  readonly bottomLine?: string | null;
}

const WPM = 200;

function wordCount(text: string | null | undefined): number {
  if (text === null || text === undefined || text === "") return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function readingTimeMinutes(stories: readonly ReadingTimeStory[]): number {
  let total = 0;
  for (const s of stories) {
    total += wordCount(s.summary);
    total += wordCount(s.bottomLine);
    if (s.bullets) {
      for (const b of s.bullets) total += wordCount(b);
    }
  }
  return Math.max(1, Math.ceil(total / WPM));
}
