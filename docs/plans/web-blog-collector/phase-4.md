# Phase 4: Filters and row assembly

> **Status:** pending
> **Traces to:** REQ-020, REQ-021, REQ-022, REQ-023, REQ-050, REQ-051
> **Depends on:** Phase 1 (types)

## Overview

After this phase, `collectors/web.ts` has three pure helpers:
`applySinceDays`, `parseDateOrNull`, and `buildRawItem`. Plus the
`maxItems` cap (which is just `.slice(0, maxItems)` — no helper needed).

This phase is **independent of Phases 2 and 3** and can run in parallel
with them after Phase 1 lands.

## Implementation

**Files:**
- Modify: `packages/pipeline/src/collectors/web.ts` — add `applySinceDays`, `parseDateOrNull`, `buildRawItem`
- Modify: `packages/pipeline/tests/unit/collectors/web.test.ts` — add test cases

**Pattern to follow:** `packages/pipeline/src/collectors/hn.ts:141-174` (`parseItems`) for the row-assembly pattern. Each field is copied explicitly into a `RawItemInsert` literal — no intermediate types.

**What to test:**
- `applySinceDays` with `sinceDays: undefined` → returns input unchanged (no filter)
- `applySinceDays` with `sinceDays: 7` drops posts 10 days old, keeps posts 5 days old
- `applySinceDays` with `sinceDays: 7` and post with `published_at: ""` → keeps the post (REQ-021)
- `applySinceDays` with `sinceDays: 7` and post with `published_at: "not a date"` → keeps the post (REQ-022)
- `applySinceDays` boundary: post exactly at the cutoff (within a few ms) → keeps
- `parseDateOrNull("")` returns `null`
- `parseDateOrNull("not a date")` returns `null` (REQ-051)
- `parseDateOrNull("2026-04-07")` returns a valid `Date`
- `parseDateOrNull("2026-04-07T10:30:00Z")` returns a valid `Date`
- `buildRawItem` produces correct shape: `sourceType: 'blog'`, `externalId === url === sourceUrl === postUrl`, `content === markdownBody`, `engagement: { points: 0, commentCount: 0 }`, `metadata: { comments: [] }` (REQ-050)
- `buildRawItem` sets `author: null` when extracted author is empty string
- `buildRawItem` sets `author: "Jane Doe"` when extracted author is `"Jane Doe"` (trimmed)
- `buildRawItem` sets `publishedAt: null` when extracted `published_at` is empty or invalid (REQ-051)
- `buildRawItem` sets `publishedAt` to a valid `Date` when `published_at` is parseable

**Traces to:** REQ-020, REQ-021, REQ-022, REQ-023, REQ-050, REQ-051

**What to build:**

### `applySinceDays`

```ts
import type { DiscoveredPost } from "./web.js";  // from Phase 3

const MS_PER_DAY = 86_400_000;

export function applySinceDays(
  posts: DiscoveredPost[],
  sinceDays: number | undefined,
): DiscoveredPost[] {
  if (sinceDays === undefined) return posts;
  const cutoff = Date.now() - sinceDays * MS_PER_DAY;
  return posts.filter((p) => {
    if (!p.published_at) return true;              // REQ-021: empty date → accept
    const t = Date.parse(p.published_at);
    if (Number.isNaN(t)) return true;              // REQ-022: unparseable → accept
    return t >= cutoff;
  });
}
```

REQ-021 and REQ-022 are the "fail-open" rules. Both are asserted by the unit tests.

### `parseDateOrNull`

```ts
export function parseDateOrNull(raw: string | undefined | null): Date | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : new Date(t);
}
```

Used by `buildRawItem` to set `publishedAt`.

### `buildRawItem`

```ts
import type { RawItemInsert } from "@newsletter/shared/db";
import type { ExtractedFields } from "./web.js";   // from Phase 3

export function buildRawItem(
  postUrl: string,
  markdownBody: string,
  fields: ExtractedFields,
): RawItemInsert {
  const now = new Date();
  const author = fields.author.trim();
  return {
    sourceType: "blog" as const,
    externalId: postUrl,
    title: fields.title,
    url: postUrl,
    sourceUrl: postUrl,
    author: author.length > 0 ? author : null,
    content: markdownBody,
    publishedAt: parseDateOrNull(fields.published_at),
    collectedAt: now,
    engagement: { points: 0, commentCount: 0 },
    metadata: { comments: [] },
    updatedAt: now,
  };
}
```

Mirrors `hn.ts:157-170` exactly except for the `sourceType`, `engagement`, and `metadata` values.

**Note on title validation:** REQ-078 says we must skip posts with empty titles. That's enforced in `processOnePost` (Phase 5) by throwing before `buildRawItem` is called, NOT by making `buildRawItem` defensive. `buildRawItem` trusts its input — Phase 5 owns the validation.

### Unit test cases (add to web.test.ts)

Name each test with the REQ it covers for traceability, e.g.:

```ts
// REQ-020: sinceDays filter drops posts older than cutoff
it("applySinceDays drops posts older than the cutoff", () => { ... });

// REQ-021: empty date passthrough
it("applySinceDays keeps posts with empty published_at even when sinceDays is set", () => { ... });

// REQ-022: unparseable date passthrough
it("applySinceDays keeps posts with unparseable published_at", () => { ... });
```

Use fake timers with `vi.setSystemTime(new Date("2026-04-07T00:00:00Z"))` to make date math deterministic:

```ts
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-04-07T00:00:00Z"));
});
```

Total new test cases: ~14.

**Commit:** `feat(VER-47): add sinceDays filter and row assembly helpers`

## Done When

- [ ] `applySinceDays`, `parseDateOrNull`, `buildRawItem` exported from `collectors/web.ts`
- [ ] 14 new unit tests passing
- [ ] `pnpm build && pnpm typecheck && pnpm lint && pnpm test:unit` clean
- [ ] Tests from Phase 2 still pass (this phase adds to the same test file)
