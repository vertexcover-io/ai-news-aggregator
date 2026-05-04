# Phase 3: Twitter client adapter + pure mapper

> **Status:** pending

## Overview

Adds the testable abstractions on top of `rettiwt-api`:
- `TwitterClient` interface — the only surface the collector talks to. Two methods: `fetchListTweets(listId, opts)` and `fetchUserTimeline(userId, opts)`. Both return `NormalizedTweet[]` (a thin internal type).
- `tweetToRawItem(t: NormalizedTweet): RawItemInsert` — pure mapping function.
- `createRettiwtClient(deps): TwitterClient` — concrete adapter that wraps the live library.

After this phase, no orchestration exists yet, but every primitive the collector needs is unit-tested.

## Implementation

**Files:**
- Create: `packages/pipeline/src/collectors/twitter/types.ts` — `TwitterClient`, `NormalizedTweet`, `TwitterCollectorDeps`, `TwitterCollectorResult`.
- Create: `packages/pipeline/src/collectors/twitter/map.ts` — `tweetToRawItem`.
- Create: `packages/pipeline/src/collectors/twitter/clients/rettiwt.ts` — `createRettiwtClient`.
- Create: `packages/pipeline/src/collectors/twitter/__tests__/map.test.ts`.
- Create: `packages/pipeline/src/collectors/twitter/__tests__/rettiwt-client.test.ts` (uses a stubbed `Rettiwt` instance — does NOT hit the network).
- Modify: `packages/pipeline/package.json` — add `rettiwt-api` dep.

**Pattern to follow:** `packages/pipeline/src/collectors/web.ts` for the layered "interface → adapter → tests" approach. The split into `types.ts`/`map.ts`/`clients/*.ts` mirrors the eventual layout of larger collectors and keeps `index.ts` (Phase 4) small.

### `NormalizedTweet` shape

This is the projection of `rettiwt-api`'s `Tweet` type into exactly what the mapper uses. Defined in `types.ts`:

```ts
export interface NormalizedTweet {
  id: string;
  authorHandle: string;          // canonical, no @
  fullText: string;              // full body, no truncation
  createdAt: string;             // ISO
  url: string;                   // https://x.com/<handle>/status/<id>
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  quoteCount: number;
  photoUrls: string[];           // first item used as imageUrl
  isRetweet: boolean;            // if true, the above fields already point to the original
  isQuote: boolean;
}
```

### `TwitterClient` interface

```ts
export interface TwitterClientFetchOptions {
  maxTweets?: number;
  cursor?: string;
  signal?: AbortSignal;
}

export interface TwitterClientFetchResult {
  tweets: NormalizedTweet[];
  nextCursor: string | null;
}

export interface TwitterClient {
  fetchListTweets(listId: string, opts?: TwitterClientFetchOptions): Promise<TwitterClientFetchResult>;
  fetchUserTimeline(userId: string, opts?: TwitterClientFetchOptions): Promise<TwitterClientFetchResult>;
}
```

### `createRettiwtClient(deps)`

Wraps the rettiwt instance, denormalizes its tweet shape into `NormalizedTweet`, propagates `AbortSignal` via `Promise.race`, surfaces any thrown error verbatim. Internally:

```ts
function denormalize(t: RettiwtTweet): NormalizedTweet {
  // Use retweetedTweet inner fields when isRetweet
  const inner = t.retweetedTweet ?? t;
  return {
    id: inner.id,
    authorHandle: inner.tweetBy?.userName ?? "i",
    fullText: inner.fullText ?? "",
    createdAt: inner.createdAt,
    url: `https://x.com/${inner.tweetBy?.userName ?? "i"}/status/${inner.id}`,
    likeCount: inner.likeCount ?? 0,
    retweetCount: inner.retweetCount ?? 0,
    replyCount: inner.replyCount ?? 0,
    quoteCount: inner.quoteCount ?? 0,
    photoUrls: (inner.media ?? [])
      .filter(m => m.type === "photo")
      .map(m => m.url)
      .filter((u): u is string => typeof u === "string"),
    isRetweet: !!t.retweetedTweet,
    isQuote: !!(t.quoted ?? t.quotedTweet),
  };
}
```

### `tweetToRawItem(t: NormalizedTweet): RawItemInsert`

Pure function. No side effects. Maps as documented in the spec:

| Source field | RawItemInsert field |
|---|---|
| `t.id` | `externalId` (and reused in `url`) |
| `t.fullText` | `content` (full body); `title` (first 80 chars + ellipsis if longer; newlines collapsed) |
| `t.authorHandle` | `author` |
| `t.createdAt` | `publishedAt` |
| `t.url` | `url` |
| `t.photoUrls[0] ?? null` | `imageUrl` |
| `{ points: t.likeCount, commentCount: t.retweetCount + t.replyCount + t.quoteCount }` | `engagement` |
| `{ comments: [] }` | `metadata` |
| `"twitter"` | `sourceType` |

Title truncation: `text.replace(/\s+/g, " ").trim()` then if length > 80, take first 79 chars + `…`.

### Tests

**`map.test.ts`** — pure unit tests, no async, no mocks needed:
- REQ-005, REQ-010: `externalId === t.id`, `url === expected`.
- REQ-006: engagement sum on a fixture with all four counters.
- REQ-007 / EDGE-001..003: photo-only → first url; video-only → null; mixed → first photo; empty media → null.
- REQ-008 / EDGE-012: retweet fixture asserts the persisted `externalId`/`content`/`author` are from `retweetedTweet`. (The denormalizer in the client adapter handles this; the mapper sees `NormalizedTweet` already containing inner fields.)
- REQ-009: quote fixture; assert `content === outer.fullText`.
- REQ-011: title truncation cases — short, exactly 80, long, with newlines.
- REQ-012: full-text content length matches input.
- REQ-013: `metadata.comments === []`.
- EDGE-005: `viewCount` null is fine — `NormalizedTweet` doesn't include viewCount, so this is implicitly tested.

**`rettiwt-client.test.ts`** — stub `Rettiwt`:
- Construct a stub with `list.tweets()` returning a fixture; assert `fetchListTweets()` returns `NormalizedTweet[]`.
- Same for `user.timeline()` → `fetchUserTimeline()`.
- Retweet fixture → asserts denormalizer uses `retweetedTweet` for the inner fields.
- AbortSignal: aborted signal → `Promise.race` rejects with AbortError.

**Traces to:** REQ-005..013, REQ-008 (mapper side), EDGE-001..005, EDGE-008, EDGE-012, EDGE-013.

**Commit:** `feat(twitter): client adapter and mapper`

## Done when

- [ ] `pnpm --filter @newsletter/pipeline test:unit` passes with new tests; all REQ-005..013 assertions pass.
- [ ] `pnpm typecheck` clean.
- [ ] No `any` types in `clients/rettiwt.ts` — use `import type` from `rettiwt-api` for the `Tweet` shape (the lib ships `.d.ts`).
- [ ] One commit.

## Notes

- Drag rettiwt-api into `packages/pipeline/package.json` (and remove from workspace root if no other package needs it). The api package keeps it for handle resolution.
- The denormalizer is the only place that touches the rettiwt-specific shape. Keep all `import type { Tweet } from "rettiwt-api"` statements in `clients/rettiwt.ts` — do NOT leak into `types.ts` or `map.ts`.
- ESLint rule `newsletter/collector-return-shape` does NOT trigger on this phase because no exported `collect*` function exists yet. It will trigger in Phase 4.
