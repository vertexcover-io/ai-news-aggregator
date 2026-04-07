const TRACKING_PARAM_PATTERNS: readonly RegExp[] = [
  /^utm_/i,
  /^ref$/i,
  /^source$/i,
  /^fbclid$/i,
  /^gclid$/i,
];

export function canonicalizeUrl(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return input;
  }
  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.hash = "";
  const keep: [string, string][] = [];
  for (const [k, v] of parsed.searchParams) {
    if (TRACKING_PARAM_PATTERNS.some((re) => re.test(k))) continue;
    keep.push([k, v]);
  }
  parsed.search = "";
  for (const [k, v] of keep) parsed.searchParams.append(k, v);
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  }
  return parsed.toString();
}

export interface DedupCandidate {
  id: number;
  url: string;
  engagement: { points: number; commentCount: number };
}

export function dedupCandidates<T extends DedupCandidate>(
  items: readonly T[],
): T[] {
  const engagementOf = (it: T): number =>
    it.engagement.points + it.engagement.commentCount;

  const best = new Map<string, { idx: number; score: number }>();
  items.forEach((item, idx) => {
    const key = canonicalizeUrl(item.url);
    const score = engagementOf(item);
    const existing = best.get(key);
    if (!existing || score > existing.score) {
      best.set(key, { idx, score });
    }
  });

  const survivingIdxs = new Set(Array.from(best.values(), (v) => v.idx));
  return items.filter((_, idx) => survivingIdxs.has(idx));
}
