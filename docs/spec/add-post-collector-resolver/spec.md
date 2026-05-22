# SPEC: Add Post — Twitter/X Collector Resolver

**Related design:** [design.md](./design.md)
**Library probe:** [library-probe.md](./library-probe.md)

## Goal

Extend the admin "Add Post" feature so that pasting a Twitter/X URL fetches the single tweet via `rettiwt-api`, persists it as a `raw_items` row with `source_type = 'twitter'`, and surfaces it on the review page exactly like an HN or Reddit add. URLs that do not match any source-specific pattern continue to fall through to the generic web/blog collector.

The user's task description assumed HN was missing — **it is not; HN is already supported**. The actual change is Twitter only, plus regression checks on the existing HN / Reddit / web paths.

## Scope

### In

- New URL→source detection: `"twitter"` for `x.com` / `twitter.com` / `mobile.twitter.com` / `www.x.com` URLs containing `/status/<numeric_id>`.
- New collector function `fetchTwitterPost(url, deps)` exported from `packages/pipeline/src/collectors/twitter/index.ts`.
- New URL parser `parseTweetIdFromUrl(url)` exported from the same file.
- Wiring into `dispatchFetch()` and `AddPostSourceType` union in `packages/pipeline/src/services/add-post-helper.ts`.
- Re-export from `packages/pipeline/src/add-post-entry.ts`.
- Per-call cookie resolution via the existing `resolveTwitterCollectorCookie` (DB-first / env-fallback).
- CSRF refresh + single retry on auth failure (matches the bulk-collector behavior verified by library-probe).
- Typed error messages for: cookies missing, auth failure after retry, tweet not found (`undefined` from rettiwt), construction-time auth error.
- Unit tests for parser, detector, fetcher (with injected client), and `addPostToArchive` end-to-end via mocked deps.
- E2E test (Playwright) extension to assert an x.com URL adds a card on the review page.

### Out

- `nitter.net` URLs (deferred — minor follow-up).
- `t.co` shortlink resolution (deferred).
- Splitting 404 vs 502 status codes (current behavior: all upstream errors → 502).
- Any change to the bulk twitter collector code paths.
- Any DB migration — `source_type = 'twitter'` is already a valid enum value.
- UI/CSS changes — the existing `AddPostPanel` form accepts any URL.
- Adding `web_search` to the Add Post dispatcher (explicitly forbidden per task description).

## Requirements (EARS)

### REQ-001 — Twitter URL detection
**When** `detectAddPostSourceType(url)` is called with any URL of the form `https?://(?:[a-z0-9-]+\.)?(?:x|twitter)\.com/[^/]+/status/<digits>(?:[/?#].*)?`,
**the system shall** return `"twitter"`.

### REQ-002 — Twitter URL detection precedence
**When** detection is called with a Twitter/X URL **and** the URL would also match the HN or Reddit pattern (it cannot in practice, but defense in depth),
**the system shall** still return `"twitter"`. The order in `detectAddPostSourceType` puts twitter first, then hn, then reddit, then web fallback.

### REQ-003 — Tweet ID parsing
**When** `parseTweetIdFromUrl(url)` is called,
**the system shall** return the numeric tweet ID as a string for any valid Twitter/X status URL, or `null` for any other URL.

### REQ-004 — Twitter dispatch
**When** `dispatchFetch(url, "twitter", deps)` is called,
**the system shall** invoke `fetchTwitterPost(url, deps)` (or `deps.fetchTwitterPost` if provided as a test seam).

### REQ-005 — Tweet fetch happy path
**When** `fetchTwitterPost(url, deps)` is called with a URL matching `parseTweetIdFromUrl` **and** a valid Rettiwt cookie is resolved **and** the tweet exists,
**the system shall** return a `RawItemInsert` produced by passing the raw tweet through `denormalize()` then `tweetToRawItem()`, with `sourceType: "twitter"` and `externalId` equal to the tweet ID.

### REQ-006 — Tweet not found
**When** `rettiwt.tweet.details(id)` returns `null` or `undefined`,
**the system shall** throw an `Error` whose message starts with `"Tweet not found, deleted, or protected:"` and includes the tweet ID.

### REQ-007 — Missing cookies
**When** `resolveTwitterCollectorCookie(...)` returns `null`,
**the system shall** throw an `Error` whose message is `"Twitter cookies not configured — set them at /admin/settings"` and does not attempt the Rettiwt construction.

### REQ-008 — CSRF refresh + retry
**When** `rettiwt.tweet.details(id)` throws a CSRF-mismatch error (detected via the existing `isCsrfMismatchError` predicate or a 403 with the rotation-marker shape),
**the system shall** invoke `refreshRettiwtCsrfToken` once and retry the call. If the retry succeeds, return its result. If the refresh fails or the retry still throws, surface the original auth-class error.

### REQ-009 — Auth failure
**When** `rettiwt.tweet.details(id)` throws an auth-class error (status 401 / 403 not matching the CSRF-refresh path, or message matching `/not authorized/i`) after retry, **or** `new Rettiwt({ apiKey })` throws synchronously,
**the system shall** throw an `Error` whose message is `"Twitter auth failed — rotate cookies at /admin/settings"`.

### REQ-010 — Cookie freshness
**When** the operator saves new cookies via `/admin/settings`,
**the system shall** honor them on the **next** Add Post call **without** any API or worker restart. Implementation: `fetchTwitterPost` calls `resolveTwitterCollectorCookie` per-invocation (no memoization).

### REQ-011 — Persisted item
**When** the happy path completes,
**the system shall** persist the `RawItemInsert` via `rawItemsRepo.upsertItems`, marking it `metadata.addedInReview = true`, run `generateRecap` against it, and return a `RankedItem` as today. (This is enforced by the existing `hydrateAddedPost` wrapper — `fetchTwitterPost` only contributes the `RawItemInsert`.)

### REQ-012 — Signal propagation
**When** the caller passes an `AbortSignal` (e.g. the API's 30 s timeout),
**the system shall** abort the in-flight rettiwt call when the signal fires. Implementation: pass `signal` into `withCsrfRefreshRetry` / `abortRace` — same helper the bulk collector uses.

### REQ-013 — No DB migration
**The system shall not** require any change to the Drizzle schema, migrations, or `SourceType` union (`"twitter"` is already a member).

### REQ-014 — No UI change
**The system shall not** require any change to `packages/web/src/components/review/AddPostPanel.tsx` or the API client. The existing URL field handles x.com/twitter.com URLs.

### REQ-015 — Web search out of scope
**The system shall not** add a `"web_search"` branch to `detectAddPostSourceType` or `dispatchFetch`. Add Post remains URL-based; web search is query-based.

### REQ-016 — Regression on existing source types
**When** an HN, Reddit, or generic web URL is added,
**the system shall** behave identically to today: same source type assignment, same `raw_items` shape, same error semantics. Tests must include at least one happy-path assertion per existing source type to prevent regressions during refactor of the helper.

## Edge Cases

| Case | Required behavior | Requirement covered |
|---|---|---|
| URL has `/status/<id>/photo/2` | Detection still extracts ID | REQ-001, REQ-003 |
| URL has `?ref_src=…` | ID extracted | REQ-001, REQ-003 |
| URL is `https://x.com/i/status/<id>` | Accepted; `i` is treated as handle | REQ-001 |
| URL is `https://x.com/jack` (profile, no /status/) | Falls through to `web` | REQ-001 (negative) |
| Tweet id `"1"` returns `undefined` | Throw "Tweet not found…" | REQ-006 |
| Tweet id like `"999999999999999"` throws "Unknown error" | Propagated; caller catches via outer try/catch as upstream-failed 502 | n/a — falls outside REQ-006 (`null`-only); the upstream `addPostToArchive` catches any thrown error and returns 502 with the message |
| Bad cookie at constructor | Caught, mapped to REQ-009 | REQ-009 |
| Tweet is a retweet | `denormalize()` unwraps via `inner = t.retweetedTweet ?? t` (existing behavior) | REQ-005 |
| Tweet has a quoted tweet | Existing `quotedTweet` extraction + content append | REQ-005 |
| Duplicate URL already in archive | `addPostToArchive` returns 409 (existing) | n/a (existing) |
| Tweet already in `raw_items` from prior collection | `upsertItems` no-ops via unique constraint | REQ-011 |
| AbortController fires (30 s timeout) | rettiwt call aborts; caller sees AbortError | REQ-012 |

## Verification Scenarios

Folded from [`verification/verification-stubs.md`](./verification/verification-stubs.md):

- **VS-0-1** Twitter Add Post — happy path against live cookie → REQ-005, REQ-011
- **VS-0-2** Twitter Add Post — invalid/deleted tweet ID → REQ-006
- **VS-0-3** Twitter Add Post — stale CSRF auto-refresh → REQ-008, REQ-010
- **VS-0-4** Twitter Add Post — cookie missing → REQ-007
- **VS-0-5** URL detection coverage (incl. HN + Reddit + web regression) → REQ-001, REQ-002, REQ-016
- **VS-0-6** HN Add Post still works (regression) → REQ-016

## Acceptance Criteria

1. `pnpm typecheck` PASS, no new errors.
2. `pnpm lint` PASS (0 errors; warnings ≤ baseline = 10).
3. `pnpm test:unit` — all new unit tests pass; existing test count maintained (modulo the 5 pre-existing baseline failures in `reddit.test.ts` that are unrelated and tolerated).
4. New unit-test coverage for:
   - `parseTweetIdFromUrl` — all VS-0-5 cases.
   - `detectAddPostSourceType` — twitter URLs return `"twitter"`; non-twitter URLs return existing values (regression).
   - `dispatchFetch` for `"twitter"` — calls the injected `fetchTwitterPost`.
   - `fetchTwitterPost` — happy path, `undefined` result → "Tweet not found", auth error → "Twitter auth failed", missing cookie → "Twitter cookies not configured".
5. `addPostToArchive` integration test with mocked rettiwt deps — proves the route + service layer dispatch twitter correctly and surface errors as 502.
6. E2E test `review-add-post.spec.ts` passes against a stack with a valid `RETTIWT_API_KEY` for a known-public tweet ID (Jack Dorsey's `"20"`).
7. No DB migration generated by `pnpm --filter @newsletter/shared db:generate` (snapshot unchanged).
8. No UI bundle size regression (subpath-import rule still enforced — no new web imports of `@newsletter/shared` root).

## Verification Matrix

| Requirement | Covered by |
|---|---|
| REQ-001 | unit (`parseTweetIdFromUrl`, `detectAddPostSourceType`), VS-0-5 |
| REQ-002 | unit (`detectAddPostSourceType` precedence) |
| REQ-003 | unit (`parseTweetIdFromUrl`) |
| REQ-004 | unit (`dispatchFetch`) |
| REQ-005 | unit (`fetchTwitterPost` happy), VS-0-1 |
| REQ-006 | unit (`fetchTwitterPost` undefined), VS-0-2 |
| REQ-007 | unit (`fetchTwitterPost` missing cookie), VS-0-4 |
| REQ-008 | unit (`fetchTwitterPost` CSRF refresh + retry), VS-0-3 |
| REQ-009 | unit (`fetchTwitterPost` auth fail + constructor throw) |
| REQ-010 | unit (cookie resolver invoked per-call), VS-0-3 |
| REQ-011 | unit (`hydrateAddedPost` integration in existing add-post-helper test) |
| REQ-012 | unit (`fetchTwitterPost` signal propagation) |
| REQ-013 | typecheck PASS + no migration generated |
| REQ-014 | grep — no diff in `packages/web/src/components/review/AddPostPanel.tsx` |
| REQ-015 | grep — no `"web_search"` literal added to add-post-helper.ts |
| REQ-016 | unit (regression assertions for hn/reddit/web), VS-0-6 |
