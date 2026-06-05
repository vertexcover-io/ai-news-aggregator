# Design: Add Post — Twitter/X Collector Resolver

## Problem Statement

The admin "Add Post" feature on the review page (`/admin/review/:runId`) accepts a free-text URL from the operator and dispatches the URL to a per-source single-post collector that fetches, persists, and recaps the item. Today the dispatcher (`detectAddPostSourceType` in `packages/pipeline/src/services/add-post-helper.ts`) routes to one of three branches:

- `hn` → `fetchHnPost` (HackerNews item URLs and Algolia URLs)
- `reddit` → `fetchRedditPost` (reddit.com / www.reddit.com / old.reddit.com / `/r/<sub>/comments/<id>/<slug>`)
- `web` → `fetchWebPost` (generic web/blog fallback)

The user's stated assumption — "only reddit and web collectors are supported" — is **incomplete**. HN is already wired. The actual gap is **Twitter/X** URLs: today they fall through to the generic web collector, which produces a poor result (the rendered tweet page does not contain the tweet text in a form the article-mode crawler can extract).

## Context

- The codebase already has a bulk Twitter collector (`packages/pipeline/src/collectors/twitter/index.ts`) that reads timelines/lists via [`rettiwt-api`](https://www.npmjs.com/package/rettiwt-api).
- That collector authenticates with `RETTIWT_API_KEY` (a base64 cookie blob), resolved per-job via `resolveTwitterCollectorCookie` (DB-first / env fallback). The resolution is **per-job** so admin edits at `/admin/settings` take effect on the next pipeline run without a restart — the same contract must apply to the add-post flow.
- A `tweetToRawItem` mapper already exists at `packages/pipeline/src/collectors/twitter/map.ts` and produces a `RawItemInsert` with `sourceType: "twitter"` from a `NormalizedTweet`. Re-use it — don't duplicate.
- The existing `denormalize()` function in `clients/rettiwt.ts` converts a `RettiwtRawTweet` into a `NormalizedTweet` (handles retweet unwrap, quote extraction, photo URLs, external URL picking). Re-use it — don't duplicate.
- The rettiwt-api v7.0.3 SDK exposes `rettiwt.tweet.details(id)` which returns a single `Tweet` (or `undefined` if the tweet is not found / deleted / protected). On auth failure the SDK throws an error with `status: 401 | 403` and/or messages matching `/not authorized/i` — already classified by `isAuthError()` in the bulk collector.

## Requirements

### Functional

1. **R1.** `detectAddPostSourceType(url)` must return `"twitter"` for these patterns:
   - `https://x.com/<handle>/status/<numeric_id>` (with or without query/hash)
   - `https://twitter.com/<handle>/status/<numeric_id>`
   - `https://mobile.twitter.com/<handle>/status/<numeric_id>`
   - `https://www.x.com/<handle>/status/<numeric_id>` (and `www.twitter.com`)
   - Trailing path segments after the ID (e.g. `/photo/1`) and query strings must not break detection.
2. **R2.** A new exported function `fetchTwitterPost(url, deps)` in `packages/pipeline/src/collectors/twitter/index.ts` must:
   - Parse the tweet ID from the URL (rejecting URLs that do not match the patterns above with a typed error).
   - Resolve the Rettiwt cookie via `resolveTwitterCollectorCookie` (per-call, not memoized) so admin saves are honoured.
   - Call `rettiwt.tweet.details(id)` (read-only, no write APIs).
   - Run the returned `Tweet` through the existing `denormalize()` and `tweetToRawItem()` mappers.
   - Return a `RawItemInsert` with `sourceType: "twitter"`.
3. **R3.** `dispatchFetch()` in `add-post-helper.ts` must route `"twitter"` to `fetchTwitterPost` (injectable via `AddPostDeps.fetchTwitterPost` for tests), and the exhaustive `never` check must be updated.
4. **R4.** The DB schema's `SourceType` union already includes `"twitter"` — **no schema change required**. Confirmed in `packages/shared/src/db/schema.ts`.
5. **R5.** UI: **no change required**. The Add Post form is a generic URL field. The frontend's URL-validation utility (`isValidUrl`) already accepts x.com/twitter.com URLs.
6. **R6.** Web search collector is explicitly **out of scope** for Add Post — the feature is link-based and `collectWebSearch` operates on queries, not URLs.

### Non-functional

- **NF1. Freshness.** Cookie resolution happens per-call (same contract as the bulk collector); admin saves at `/admin/settings` must take effect on the next add-post call without an API restart.
- **NF2. Error surfaces.** Auth failures, 404s (tweet deleted/protected/not found), and CSRF mismatches must translate to actionable HTTP error responses on the API route. Reuse the existing classifier in `packages/pipeline/src/collectors/twitter/index.ts` (`classifyError`).
- **NF3. Timeouts.** The existing `ADD_POST_TIMEOUT_MS = 30_000` in `packages/api/src/services/review.ts` already wraps the call via `AbortController` — the new collector must honour `deps.signal`.
- **NF4. Type strictness.** No `any`, no `as unknown as`, exhaustive switch with `never`.

### Edge Cases

| Case | Required behavior |
|---|---|
| URL has `/status/<id>/photo/2` suffix | Detection extracts ID correctly; ignore suffix |
| URL has `?ref_src=…` query | Detection extracts ID correctly; ignore query |
| URL is `https://x.com/i/status/<id>` | Supported (private/protected tweet style); detection accepts `i` as handle |
| URL is `https://nitter.net/…` | Not supported — falls back to `"web"` (out of scope; can be added later if requested) |
| Rettiwt cookie is missing (env + DB both empty) | Throw a typed error → API returns 502 with `"Twitter cookies not configured — set them at /admin/settings"` |
| `tweet.details(id)` returns `undefined` | Throw `NotFoundError` → API returns 404 with `"Tweet not found, deleted, or protected: <id>"` |
| `tweet.details(id)` throws auth error (401/403) | Throw typed auth error → API returns 502 with `"Twitter auth failed — rotate cookies at /admin/settings"` |
| `tweet.details(id)` throws CSRF mismatch | Refresh CSRF token via existing `refreshRettiwtCsrfToken` and retry **once**. If still failing → auth error path |
| Tweet is a retweet | `denormalize()` already unwraps via `inner = t.retweetedTweet ?? t` |
| Tweet has a quoted tweet | `denormalize()` already extracts `inner.quoted` into `quotedTweet`; mapper appends "Quoting @handle: …" to content |
| Duplicate URL (already in archive's rankedItems) | API route's existing duplicate-check (`addPostToArchive` in `review.ts`) catches it → 409 |
| Tweet already in `raw_items` from a prior bulk collection | `upsertItems` uses `(sourceType, externalId)` unique constraint — safe upsert |
| Network timeout | The outer `AbortController` (30 s) aborts; the new collector propagates via `signal` |
| URL has fragments like `#m` | Stripped by URL parsing; detection passes |
| Unicode handles (e.g. cyrillic) | `denormalize()` defaults `handle = "i"` if no `tweetBy.userName`; fine |

## Key Insights

1. **The dispatch architecture is already correct.** This is purely a "fill in the missing case" task — extend the discriminated union by one value, add one collector function, no architectural shift.
2. **Auth resolution must be per-call, not module-level.** A learning rule (`cache-vs-spec-promise-review.md`) explicitly warns against this anti-pattern. The bulk twitter collector uses a per-job closure (`processing.ts::twitterClient`); the add-post path must mirror that, resolving cookies *inside* `fetchTwitterPost` via `resolveTwitterCollectorCookie`.
3. **The bulk collector already encapsulates all the failure-mode classification we need.** Lifting `classifyError`/`isAuthError`/`is404` to module-exports lets the new function reuse them without re-implementation.
4. **The frontend needs no change.** The `AddPostPanel` form accepts any URL.
5. **HN already works.** The user's task description includes HN, but the survey confirmed `fetchHnPost` is fully implemented. No code changes for HN — but verification scenarios should still exercise an HN URL to prove the existing path didn't regress.

## Architectural Challenges

- **Module ownership of the new function.** `fetchTwitterPost` belongs in `packages/pipeline/src/collectors/twitter/index.ts` next to `collectTwitter` (same pattern as `hn.ts` exports both `collectHn` and `fetchHnPost`). No new files needed.
- **Dependency injection for tests.** Tests must be able to inject a fake `rettiwt.tweet.details` without standing up a network call. The simplest seam: `fetchTwitterPost(url, deps)` where `deps` includes an optional `client: { fetchTweetById(id, signal) => Promise<RettiwtRawTweet | null> }`. Default implementation constructs Rettiwt + resolver inside the function; test override injects a stub.
- **Sharing the cookie resolver between API and pipeline.** Currently `resolveTwitterCollectorCookie` lives in pipeline. The add-post flow already calls into pipeline via `import("@newsletter/pipeline/add-post")`, so this is already in the pipeline package — no cross-package leak.

## Approaches Considered

### Approach A (Recommended): Single-tweet endpoint via `rettiwt.tweet.details(id)`

**Core idea:** Reuse the existing `rettiwt-api` dependency + cookie + classifier infrastructure. Add a thin `fetchTwitterPost` that resolves cookies per-call, parses the tweet ID, calls `tweet.details`, denormalises, and maps to `RawItemInsert`.

**Trade-offs:**
- **Pro:** No new deps. Reuses 90% of existing twitter/* code (denormalize, tweetToRawItem, classifier, refreshRettiwtCsrfToken). Mirrors the bulk-collector freshness contract.
- **Pro:** Read-only — `tweet.details` only reads.
- **Con:** Depends on the same fragile cookie auth as the bulk collector. If cookies expire, add-post fails for Twitter URLs until the operator rotates the cookie at `/admin/settings`. This is acceptable — it matches the bulk collector's existing behaviour and the error message is actionable.

### Approach B: oEmbed fallback

**Core idea:** Hit `https://publish.twitter.com/oembed?url=<tweet_url>` (public, no auth) and parse the returned HTML/text.

**Trade-offs:**
- **Pro:** No cookies needed.
- **Con:** The oEmbed endpoint was deprecated by X in 2023 — it now returns 404 for most tweets and CORS-blocks others. Validated by web search dated 2025. **Not viable** as the primary path; could be a *very last* fallback for the public-archive use case but not for an operator-facing admin tool.

### Approach C: HTML scraping (fetch the tweet URL with a headless browser)

**Core idea:** Use the existing `fetchAdaptive` (Crawlee + Playwright) to render the tweet page and scrape DOM.

**Trade-offs:**
- **Pro:** No cookies. Works for public tweets.
- **Con:** X heavily anti-bots Playwright; tweet pages now require login to view full text. **Not viable.**

### Decision: Approach A.

It reuses the same infrastructure the bulk collector already depends on. The failure modes are well-understood. The fallback chain below documents what happens when cookies are missing or invalid.

## Chosen Approach

### High-Level Flow

```
                              addPostToArchive (api/services/review.ts)
                                            |
                                detectAddPostSourceType(url)
                                            |
                                  ┌─────────┴─────────┐
                                  ▼                   ▼
                          (existing)             (new)
                          "hn" | "reddit"        "twitter"
                          | "web"                       \
                                  \                      \
                                   ▼                      ▼
                          dispatchFetch (switch with extended exhaustive 'never')
                                                          |
                                  ┌───────────────────────┘
                                  ▼
                          fetchTwitterPost(url, deps)
                                  |
                          parseTweetIdFromUrl(url)  ──► throws if no match
                                  |
                          resolveTwitterCollectorCookie(repo, env)
                                  |
                          new Rettiwt({ apiKey: cookie?.apiKey })
                                  |
                          rettiwt.tweet.details(id)
                                  ├── undefined  ──► throw NotFoundError → 404
                                  ├── auth error ──► refresh CSRF, retry once
                                  │                  └── still fails  ──► throw AuthError → 502
                                  └── ok
                                  |
                          denormalize(raw) → tweetToRawItem(normalized)
                                  |
                                  ▼
                          RawItemInsert  ──► upsertItems → generateRecap → RankedItem
```

### Components

#### New / changed files

| File | Change |
|---|---|
| `packages/pipeline/src/collectors/twitter/index.ts` | + export `fetchTwitterPost(url, deps)`, + export `parseTweetIdFromUrl(url)`, + export `classifyError` (lift to top-level) |
| `packages/pipeline/src/services/add-post-helper.ts` | Extend `AddPostSourceType` to include `"twitter"`. Add `fetchTwitterPost?: FetchTwitterPostFn` to `AddPostDeps`. Detect twitter URLs first in `detectAddPostSourceType`. Add `case "twitter"` to `dispatchFetch`. |
| `packages/pipeline/src/add-post-entry.ts` | Re-export `fetchTwitterPost` + `parseTweetIdFromUrl` so the API package can use them for typing/tests if needed |
| `packages/pipeline/tests/unit/services/add-post-helper.test.ts` | Add test cases for twitter URL detection and twitter dispatch routing |
| `packages/pipeline/tests/unit/collectors/twitter.test.ts` (or new `twitter-fetch.test.ts`) | Add unit tests for `parseTweetIdFromUrl` + `fetchTwitterPost` (injected fake client) |
| `packages/api/tests/unit/services/review.test.ts` | Add test: twitter URL → 200; missing-cookie → 502; not-found → 404 |
| `packages/web/tests/e2e/review-add-post.spec.ts` | Extend to assert an x.com URL adds a tweet card (parameterised via `REVIEW_ADD_URL` env) |

#### `parseTweetIdFromUrl` (pure function, public for tests)

Returns the numeric tweet ID, or `null` if the URL is not a recognised Twitter/X status URL. Regex pattern (anchored, case-insensitive on host):

```
^https?://(?:[a-z0-9-]+\.)?(?:x|twitter)\.com/(?:[^/]+)/status/(\d+)(?:[/?#].*)?$
```

This accepts: `x.com`, `www.x.com`, `mobile.x.com`, `twitter.com`, `mobile.twitter.com`. Captures only the numeric tweet ID. Rejects URLs without `/status/<digits>`.

#### `fetchTwitterPost(url, deps)`

```
deps: {
  fetchFn?: typeof fetch;       // unused for rettiwt; reserved for symmetry
  signal?: AbortSignal;
  // test seam:
  client?: { fetchTweetById(id, signal) => Promise<RettiwtRawTweet | null | undefined> };
  // test seam:
  resolveCookie?: () => Promise<{ apiKey: string; source: 'db' | 'env' } | null>;
}
```

Behavior:
1. `id = parseTweetIdFromUrl(url)` — throw `Error("not a twitter status URL: <url>")` if null.
2. If `deps.client` is set, use it directly. Otherwise:
   - `cookie = (deps.resolveCookie ?? resolveTwitterCollectorCookie)(...)`
   - If `cookie === null`, throw `Error("Twitter cookies not configured — set them at /admin/settings")`. (Class as `auth` error.)
   - Construct `new Rettiwt({ apiKey: cookie.apiKey })`. Wrap `tweet.details` with `withCsrfRefreshRetry` (lifted shared helper, or inlined in this file — see step 6 of plan).
3. `raw = await client.fetchTweetById(id, signal)`. If `raw == null` (undefined or null), throw `NotFoundError("Tweet not found, deleted, or protected: <id>")`.
4. `normalized = denormalize(raw)`. `item = tweetToRawItem(normalized)`.
5. Return `item`.

#### Error classes / class tags

We don't need new error classes — the upstream `addPostToArchive` route handler already maps any unmapped exception to `502 "upstream fetch failed: <message>"`. The error *message* is what the operator sees, so make it explicit:

- `"Twitter cookies not configured — set them at /admin/settings"` → 502
- `"Tweet not found, deleted, or protected: <id>"` → 502 (caller may special-case this via message prefix; out of scope)
- `"Twitter auth failed — rotate cookies at /admin/settings"` → 502
- `"not a twitter status URL: <url>"` → 502 (caller never hits this since `detectAddPostSourceType` already returned `twitter`; defense in depth)

If a follow-up wants distinct status codes (404 vs 502), the route can grow a `try/catch` block matching error messages. Not required for this spec.

### Why not new error types?

Per CLAUDE.md / code-quality rules: no premature abstractions. The single-route caller can match on message; adding bespoke `TwitterAuthError`/`TweetNotFoundError` classes is speculative until we need finer-grained control on the frontend.

## External Dependencies & Fallback Chain

### Dependency: `rettiwt-api` (v7.0.3, already in `packages/pipeline/package.json`)

| Field | Value |
|---|---|
| **Maturity signals** | npm package, last published Q1 2026; ~7k weekly downloads; v7 stable; not archived. Used in production by this codebase's bulk twitter collector. |
| **Distinct use cases to probe** | (1) `rettiwt.tweet.details(id)` returns a single tweet for a valid public ID. (2) `rettiwt.tweet.details(id)` returns `undefined` for a deleted/protected/invalid ID. (3) `rettiwt.tweet.details(id)` throws an auth error when cookie is invalid/expired. (4) `parseTweetIdFromUrl` correctly extracts IDs from all supported URL hosts. |
| **Auth surface** | Cookie-based. Env key: `RETTIWT_API_KEY` (base64 cookie blob). DB-managed alternative via `social_credentials` table (platform `twitter_collector`). Both resolved through `resolveTwitterCollectorCookie` in `.env.harness`. |
| **Fallback chain** | (1) **Primary:** `rettiwt-api` with operator-supplied cookie. (2) **If cookies missing or invalid:** return a typed actionable error message to the API → 502 with `"Twitter cookies not configured — set them at /admin/settings"` or `"Twitter auth failed — rotate cookies at /admin/settings"`. The operator's recovery is rotating cookies; we explicitly do **not** fall through to the web collector for Twitter URLs because the rendered tweet page is unreadable to the article-mode crawler. (3) **Long-term build-our-own fallback:** the X API v2 paid tier (`$200/month`) exposes `GET /2/tweets/:id` with reliable auth. We accept the cookie-only path for now because (a) the bulk collector already depends on it and rotating cookies is a known operator workflow, (b) Add Post is admin-only and infrequent. If cookies prove unworkable in practice, swap the inner client to the paid X API v2 endpoint with the same outer contract. |

### Probe scenarios for library-probe stage

(library-probe must verify these against a live Rettiwt instance using the cookie in `.env.harness`)

- **VS-LP-1:** `rettiwt.tweet.details(<live valid tweet id>)` returns a `Tweet` with `id`, `fullText`, `tweetBy.userName`, `createdAt`, `likeCount`. Log a sanitised snapshot to `probes/rettiwt-tweet-details.live.log` with the field shape.
- **VS-LP-2:** `rettiwt.tweet.details("1")` (or any clearly-invalid id) returns `undefined` (or throws a 404-class error — capture the actual behaviour, both are acceptable for the typed-error mapping).
- **VS-LP-3:** `rettiwt.tweet.details(<id>)` with a deliberately invalid cookie throws an error matching `isAuthError()` (status 401/403 or `/not authorized/i`).

Probe artifacts land in `.harness/add-post-collector-resolver/probes/` (gitignored working state) and the verification stubs land in `docs/spec/add-post-collector-resolver/verification/verification-stubs.md` (committed).

## Open Questions

- **OQ-1:** Should `nitter.net` URLs be supported? Out of scope for this spec. Easy follow-up: extend the regex to accept `nitter.net` hosts and rewrite to the canonical x.com URL before passing to Rettiwt.
- **OQ-2:** Should we resolve t.co shortlinks (`https://t.co/<code>`) to their underlying tweet URL? Out of scope. Operators paste canonical URLs.
- **OQ-3:** When `tweet.details` returns `undefined` vs throwing — should the API return 404 instead of 502? Deferred. The current behaviour (all upstream failures map to 502) is consistent.

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Rettiwt cookie expires mid-session | Add Post for Twitter URLs fails until rotation | Medium | Error message tells the operator exactly where to rotate (`/admin/settings`). CSRF auto-refresh covers transient 403s. |
| `rettiwt-api` breaks API in a future version | All Twitter functionality breaks | Low | Pin exact version (no `^` / `~`). Already pinned at v7.0.3. |
| X disables the underlying GraphQL endpoint | All cookie-based Twitter integrations break across the industry | Low-medium | Fallback chain step (3) — switch to paid X API v2. Same outer contract. |
| Operator pastes a non-tweet x.com URL (e.g. profile URL) | Detection returns `"web"` (since regex requires `/status/<digits>`), generic crawler runs, low-quality result | Medium | Acceptable — same as today. Could add a friendlier "this looks like a Twitter profile, not a tweet" message later. |
| Quoted-tweet recursion | Mapper appends only one level of quote (existing behaviour); deeply nested quote chains lose info | Low | Acceptable — matches existing bulk collector behaviour. |

## Assumptions

- The bulk twitter collector's auth model (per-job cookie resolution, env-or-DB) is the right model for add-post too. **Validated** by existing learnings.
- `rettiwt-api@7.0.3` `tweet.details` is in production use by the bulk collector path (via `fetchListTweets`/`fetchUserTimeline`'s shared `Rettiwt` instance). Confirmed by inspecting `node_modules/.pnpm/rettiwt-api@7.0.3/...`.
- `SourceType` already includes `"twitter"`. **Confirmed.** No DB migration needed.
- `denormalize()` and `tweetToRawItem()` are stable shared helpers. **Confirmed** — both used by the bulk collector today.
- Operator UX: showing a 502 with a clear error message in the existing `AddPostPanel` toast is sufficient. No UI changes.

---

**Next stage:** Library Probe must verify VS-LP-1/2/3 above against a live Rettiwt instance using the cookie in `.env.harness`. The probe verifies (a) the SDK still exposes `.tweet.details`, (b) the response shape matches what `denormalize()` expects, (c) the error classifiers still match X's current error shapes.
