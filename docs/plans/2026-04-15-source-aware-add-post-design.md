# Source-Aware Add Post — Design

## Problem Statement

The "Add Post" feature in the review UI always uses the generic web collector to
extract post metadata, even when the URL points to a Hacker News or Reddit post.
This produces low-quality data (no engagement metrics, no comments, wrong
`sourceType`) for posts that have purpose-built collectors.

## Context

The pipeline has three collectors: `hn`, `reddit`, and `web` (blog). Each has a
single-post fetch function (`fetchHnPost`, `fetchRedditPost`, `fetchWebPost`) and
a URL parser (`parseHnItemIdFromUrl`, `parseRedditPostUrl`). The add-post flow in
`review.ts:106` hardcodes `"web"` as the source type for every added URL, bypassing
the richer collectors. The dispatch logic in `add-post-helper.ts` already supports
routing to `hn` and `reddit` — it just never receives anything but `"web"`.

## Requirements

### Functional Requirements

1. When a user adds an HN URL (news.ycombinator.com/item?id=…), the system must
   route to `fetchHnPost` and return full HN post data (title, points, comments).
2. When a user adds a Reddit URL (reddit.com/r/…/comments/…), the system must
   route to `fetchRedditPost` and return full Reddit post data.
3. All other URLs fall back to `fetchWebPost` (blog extraction).
4. The `sourceType` field on the resulting `RawItemInsert` must reflect the detected
   source (`"hn"`, `"reddit"`, or `"blog"`), not always `"blog"`.
5. The detection logic must be testable in isolation.

### Non-Functional Requirements

- Detection is purely URL-based (no HTTP request) — zero latency overhead.
- Adding new source detectors in the future must be a localised change.
- No new dependencies.

### Edge Cases and Boundary Conditions

- **Malformed HN URL**: `parseHnItemIdFromUrl` returns null → fall back to web.
- **Malformed Reddit URL**: `parseRedditPostUrl` returns null → fall back to web.
- **Short Reddit URL** (redd.it/…): not currently parsed by the Reddit parser →
  treated as web fallback (acceptable for MVP).
- **Old Reddit URL** (old.reddit.com): already handled by `parseRedditPostUrl`.
- **HN Algolia URL**: already handled by `parseHnItemIdFromUrl`.
- **Duplicate post**: dedup logic in `review.ts` runs before detection — no change
  needed.

## Key Insights

- **All the hard work is already done.** `dispatchFetch` in `add-post-helper.ts`
  already supports `"hn"` and `"reddit"` routing. The parsers already exist.
  The only missing piece is detecting the source type from the URL before calling
  `dispatchFetch`.
- **The fix is a two-line caller change + a small new utility.** `review.ts:106`
  calls `hydrateAddedPost(url, "web", …)` — replacing `"web"` with the detected
  type is the entire change at the API layer.
- **AddPostSourceType vs SourceType**: `dispatchFetch` uses `AddPostSourceType`
  (`"hn" | "reddit" | "web"`) which is distinct from the DB `SourceType`
  (`"hn" | "reddit" | "blog" | …`). The detection function must return
  `AddPostSourceType`.

## Architectural Challenges

**URL detection without coupling.** The detection function needs access to the
existing URL parsers (`parseHnItemIdFromUrl`, `parseRedditPostUrl`) which live in
collector files. The detection utility should live in `add-post-helper.ts` (same
file that owns `dispatchFetch`) or a sibling service file — NOT in the collector
files themselves — to keep the dependency direction clean (services depend on
collectors, not the reverse).

## Approaches Considered

### Approach A: Inline detection in `review.ts`

Add an `if/else` chain directly in `addPostToArchive()` before calling
`hydrateAddedPost`.

- **Pro:** Minimal files touched.
- **Con:** Puts URL-routing logic in the HTTP service layer; hard to test; leaks
  pipeline internals into the API package.

### Approach B: New `detectSourceType(url)` utility in `add-post-helper.ts`

Add a single exported function `detectAddPostSourceType(url: string): AddPostSourceType`
that tries each parser in priority order and returns the matched source or `"web"`.
The API service calls this, passes the result to `hydrateAddedPost`.

- **Pro:** Testable in isolation. Logic lives close to `dispatchFetch`. Clean
  separation between API layer (what source?) and pipeline layer (how to fetch).
- **Con:** Adds one export to the helper module.

### Approach C: Source detection injected as a dep into `addPostToArchive`

Make `detectSourceType` an injectable dependency on `AddPostDeps` so it can be
swapped in tests.

- **Pro:** Maximally testable.
- **Con:** Over-engineered — the function is pure (URL string in, string out) and
  trivially testable without injection.

## Chosen Approach

**Approach B** — `detectAddPostSourceType(url)` utility in `add-post-helper.ts`.

Pure function, no injection needed, lives alongside `dispatchFetch`, easy to unit
test. The API layer (`review.ts`) calls it before passing the source type to
`hydrateAddedPost`.

## High-Level Design

```
User submits URL via POST /api/archives/:runId/add-post
  │
  ▼
review.ts :: addPostToArchive()
  │  calls detectAddPostSourceType(url)           ← new utility
  │  returns "hn" | "reddit" | "web"
  │
  ▼
add-post-helper.ts :: hydrateAddedPost(url, sourceType, deps)
  │
  ▼
add-post-helper.ts :: dispatchFetch(url, sourceType, deps)   ← unchanged
  ├── "hn"     → fetchHnPost(url)
  ├── "reddit" → fetchRedditPost(url)
  └── "web"    → fetchWebPost(url)
```

**New utility** (`add-post-helper.ts` or sibling):

```
detectAddPostSourceType(url: string): AddPostSourceType
  1. if parseHnItemIdFromUrl(url) != null → return "hn"
  2. if parseRedditPostUrl(url) != null   → return "reddit"
  3. else                                 → return "web"
```

**Changed call site** (`review.ts`):

```
Before: deps.hydrateAddedPost(input.url, "web", {...})
After:  deps.hydrateAddedPost(input.url, detectAddPostSourceType(input.url), {...})
```

No schema changes. No new packages. No API contract changes.

## Open Questions

- Should `redd.it` short URLs be supported? Not for this issue — they'd fall back
  to `"web"` gracefully and can be addressed in a follow-up.

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| `parseHnItemIdFromUrl` / `parseRedditPostUrl` not exported from their modules | Low — already used by `dispatchFetch` | Import directly |
| HN/Reddit fetch fails for a valid URL | Medium | Existing error handling in `hydrateAddedPost` already surfaces fetch errors |
| `detectAddPostSourceType` imported in API package creates pipeline → API circular dep | Low — function lives in pipeline, API imports from pipeline already | Verify import direction |

## Assumptions

- `parseHnItemIdFromUrl` and `parseRedditPostUrl` are stable and already exported.
- `AddPostSourceType` (`"hn" | "reddit" | "web"`) continues to be the union used
  by `dispatchFetch`.
- No change to the API request/response contract is needed.
