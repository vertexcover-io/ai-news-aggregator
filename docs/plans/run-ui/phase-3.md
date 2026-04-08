# Phase 3: Dedup processor (pure functions)

> **Status:** pending
> **Depends on:** Phase 1
> **Traces to:** REQ-050, REQ-051, REQ-052, EDGE-002, EDGE-014

## Overview

Pure, side-effect-free URL canonicalization + deduplication. Given a candidate
list with engagement scores, collapse items with the same canonical URL,
keeping the highest-engagement representative, while preserving the original
insertion order of survivors.

## Implementation

**Files to create:**
- `packages/pipeline/src/processors/dedup.ts`
- `packages/pipeline/tests/unit/processors/dedup.test.ts`

### `dedup.ts`

```typescript
const TRACKING_PARAM_PATTERNS: ReadonlyArray<RegExp> = [
  /^utm_/i,
  /^ref$/i,
  /^source$/i,
  /^fbclid$/i,
  /^gclid$/i,
];

/**
 * Canonicalize a URL:
 * - lowercase hostname
 * - strip trailing slash from path (but keep "/" for root)
 * - drop tracking query params
 * - drop fragment
 *
 * Non-URLs (parse failure) are returned unchanged — the caller treats them as
 * their own canonical group (EDGE-014).
 */
export function canonicalizeUrl(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return input;
  }
  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.hash = "";
  const keep: Array<[string, string]> = [];
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

export function dedupCandidates<T extends DedupCandidate>(items: readonly T[]): T[] {
  const engagementOf = (it: T): number => it.engagement.points + it.engagement.commentCount;

  // Map canonical URL → index of best representative in `items`.
  const best = new Map<string, { idx: number; score: number }>();
  items.forEach((item, idx) => {
    const key = canonicalizeUrl(item.url);
    const score = engagementOf(item);
    const existing = best.get(key);
    if (!existing || score > existing.score) {
      best.set(key, { idx, score });
    }
  });

  // Preserve original order: walk items, emit the one matching the winning idx for its key.
  const survivingIdxs = new Set(Array.from(best.values(), (v) => v.idx));
  return items.filter((_, idx) => survivingIdxs.has(idx));
}
```

## What to test (REQ-050–052 + edges)

1. **canonicalizeUrl unit tests:**
   - `"https://Example.com/path/?utm_source=rss&ref=newsletter#section"` → `"https://example.com/path"`
   - `"https://example.com/path"` → unchanged
   - `"https://example.com/"` → `"https://example.com/"` (root slash preserved)
   - `"https://example.com/a/b?utm_campaign=x&keep=1"` → `"https://example.com/a/b?keep=1"`
   - `"example.com/path"` (no protocol, EDGE-014) → returned unchanged
   - Fragment-only: `"https://example.com/x#frag"` → `"https://example.com/x"`
2. **dedupCandidates unit tests:**
   - REQ-051: three items same canonical URL with engagement [10, 50, 5] → the
     one with 50 survives.
   - REQ-052: items A, B, C where B duplicates A → result is `[A, C]` in that order.
   - Items with unique URLs → all pass through in original order.
   - Empty input → empty output.
   - Engagement tiebreak: equal scores → first occurrence wins (deterministic).
   - Mixed canonical + non-canonical URLs preserved correctly.

**Commit:** `feat(VER-run-ui): add dedup processor with URL canonicalization`

## Done When

- [ ] `canonicalizeUrl` and `dedupCandidates` exported from `processors/dedup.ts`
- [ ] Tests cover all listed cases
- [ ] Zero runtime dependencies added
