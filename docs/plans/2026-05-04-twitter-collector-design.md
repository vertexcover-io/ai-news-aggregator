# Twitter/X Collector — Design

## Problem Statement

Add a Twitter/X collector to the newsletter pipeline that pulls ~500 tweets/day
from one or more curated Twitter lists and emits `RawItemInsert` rows for the
existing pipeline (dedup → rank → recap → review → digest). The collector must
sit alongside the existing `hn`, `reddit`, and `web` collectors and follow their
contract exactly: `collectTwitter(deps, config) -> Promise<CollectorResult>`,
write through `rawItemsRepo.upsertItems`, no direct DB access.

The hard requirement is that any third-party library MUST be validated live
against a real Twitter list before it is locked into the spec. If every
candidate fails, the design must allow falling back to the official paid API or
a custom HTTP scraper, with a documented gap that lets the user consciously
decide between paying and building.

## Context

### Existing collectors

- `packages/pipeline/src/collectors/hn.ts:393-396` —
  `collectHn(deps: HnCollectorDeps, config: HnCollectConfig): Promise<CollectorResult>`,
  fan-out via `Promise.all` over feeds, dedup via
  `findExistingExternalIds`, upsert via `rawItemsRepo.upsertItems`.
- `packages/pipeline/src/collectors/reddit.ts` — same shape, per-subreddit
  loop, partial-failure tolerant (skips a failed subreddit, continues the
  rest).
- `packages/pipeline/src/collectors/web.ts` — Jina+Gemini-based blog collector
  that proves the pipeline tolerates per-source failures and asynchronous
  per-source rate-limiting.

### Pipeline integration points (already mapped)

- `SourceType` (`packages/shared/src/db/schema.ts:11`) already includes
  `"twitter"` — no migration needed for the enum, but a new
  `twitter_config` jsonb column on `user_settings` is required.
- `RunCollectorsPayload` (`packages/pipeline/src/workers/run-process.ts`)
  needs a new optional `twitter?: TwitterCollectConfig` field; `CollectFns`
  needs `collectTwitter`.
- Settings round-trip: `RunSubmitTwitterConfig` in
  `packages/shared/src/types/run.ts`, validated via a new
  `twitterConfigSchema` in `packages/api/src/lib/validate.ts`, persisted in
  `user_settings.twitter_config`, edited via the existing `/admin/settings`
  page.
- ESLint rule `newsletter/collector-return-shape` (type-aware) will enforce
  the return type at lint time. The new collector inherits this guard for
  free if its signature is correct.
- Custom rule `newsletter/no-relative-imports` plus the `enforce-repository-access`
  rule require any DB writes to go through the shared repo abstraction.

### Constraints from the user

- **Volume:** ~500 tweets/day, one run/day. ~15K tweets/month total.
- **Lists, not handles:** the unit of configuration is a Twitter list ID.
- **Multiple lists:** `listIds: string[]` (config primitive). One curated
  list ID is supplied for the live probe (`1585430245762441216`).
- **Tweets only, no replies.** Replies-thread expansion is explicitly out
  of scope; ranking will work off tweet text alone.
- **Always fetch full text.** Long tweets (note_tweet) must not be truncated.
- **Partial-failure tolerance:** one bad list (private/deleted) must not
  break the run. Per-list errors are logged, the rest continues.
- **Personal/internal use** (Vertexcover team, ~2 recipients). Cost matters.
  Free tier of the official API was discontinued Feb 2026.
- **Auth selection (resolved by library probe, 2026-05-04):** every
  unauthenticated path failed in May 2026 — Twitter no longer exposes
  list timelines under guest tokens, the syndication endpoints return
  empty bodies for list-by-ID, and the user declined the ~$200/mo paid
  API tier. Re-probe under user-auth (apiKey) mode against the live list
  PASSED (95 tweets, 778-char full-text round-trip, pagination verified).
  See `docs/spec/add-twitter-x-collector/library-probe.md`.
- **Selected path:** `rettiwt-api@7.0.3` in user-auth mode.
  `RETTIWT_API_KEY` is a base64-encoded blob of four cookies
  (`auth_token`, `ct0`, `kdt`, `twid`). When cookies expire, only the
  env var rotates — no code change. This is materially different from
  the prior reverted approach (which used a custom GraphQL client where
  the project owned the breakage when Twitter changed surfaces); here
  the maintained library absorbs upstream changes.
- **Prior reverted approach:** commit `8012d61` reverted a
  custom-GraphQL+cookies collector. The user's "fresh start"
  constraint forbids reusing that custom-client code, not the use of
  authenticated cookies altogether — the chosen path is structurally
  different.
- **Scope expansion (post-probe, 2026-05-04):** alongside Twitter list
  IDs, the collector also pulls tweets from individual `@handle`s. Two
  collection paths, one shared `RETTIWT_API_KEY`. Verified against
  `@jack` and `@sama` — see VS-0a-user-timeline. UI presents two
  dynamic-array editors (one per source type) with Add / Remove
  buttons, and shared `maxTweetsPerSource` + `sinceHours` controls.
- **Architectural rule exception:** handle → numeric ID resolution
  happens at settings-save time in the API package via
  `rettiwt.user.details()`. This is a single, narrow exception to
  `.claude/rules/architecture.md`'s "API package: HTTP layer only"
  rule. The exception is justified because (a) immediate validation
  feedback to the operator is high-value at save time, (b) the
  alternative — resolving every run in the pipeline — costs ~3s per
  user per daily run for the lifetime of the feature, (c) bad
  handles caught at save are unrecoverable in the pipeline anyway.
  The exception is recorded in the spec's REQ-045..047 and should be
  reviewed if more such cases accumulate.

## Requirements

### Functional Requirements

1. Accept a `TwitterCollectConfig` in the run payload of the form
   `{ listIds: string[], maxTweetsPerList?: number, sinceHours?: number }`.
2. For each list ID, fetch the most recent tweets (full text), apply the
   optional `sinceHours` cutoff, cap at `maxTweetsPerList`.
3. Dedup against `raw_items` via `findExistingExternalIds("twitter", …)`
   before any further work, so re-runs don't re-cost API calls or repo work.
4. Map each tweet to a `RawItemInsert` with:
   - `sourceType: "twitter"`
   - `externalId`: tweet ID (string)
   - `url`: `https://x.com/<author>/status/<id>`
   - `title`: first 80 chars of the full tweet text (single line, ellipsis
     suffix if truncated)
   - `content`: full tweet text (note_tweet expansion required)
   - `author`: `@handle` of the tweet author
   - `publishedAt`: tweet `created_at` as ISO string
   - `imageUrl`: first photo media URL if present, otherwise `null`
   - `engagement`: `{ points: likeCount, commentCount: retweetCount + replyCount }`
   - `metadata.comments`: `[]` (replies not collected)
5. Upsert the assembled batch via `rawItemsRepo.upsertItems(items)`.
6. Return `CollectorResult { itemsFetched, commentsFetched: 0, itemsStored, durationMs }`.
7. Be wired into `RunCollectorsPayload`, `CollectFns`, and the dispatching
   `Promise.all` in `workers/run-process.ts` so it runs concurrently with
   `hn`, `reddit`, and `web` inside a single run.
8. Be configurable via `/api/settings` PUT (and the `/admin/settings` UI),
   persisted to `user_settings.twitter_config`, hydrated into the run
   payload by `loadUserSettings` (or equivalent) at job-dispatch time.

### Non-Functional Requirements

- **Idempotency:** re-running for the same list IDs must never duplicate.
  Enforced by the `(sourceType, externalId)` unique constraint plus the
  dedup pre-check.
- **Observability:** structured pino logs via `createLogger("collector:twitter")`
  at job start, per-list start/complete/fail, and job complete. Per-list
  failure events tagged `event: "collector.twitter.list_failed"` with
  `listId`, `error.message`, `error.code` (rate-limit, auth, not-found,
  unknown).
- **Partial-failure tolerance:** an exception thrown while processing one
  list is caught, logged, and recorded in
  `TwitterCollectorResult.failures: { listId, error }[]`. The next list
  proceeds. The collector returns success unless **every** list failed —
  matching `web.ts`'s "all-failed" rule (which throws so BullMQ retries).
- **Cancellation:** honour the per-run `signal: AbortSignal` (already
  threaded through other collectors). Throw `AbortError` mid-fetch when
  signalled.
- **Rate-limit safety:** sequential per-list iteration (no fan-out within
  the collector), so 1 list ≈ 1 burst of API calls. Retry on 429 with
  exponential backoff (mirror `hn.ts:83-115`), capped at 3 attempts.
- **Cost ceiling:** at 500 tweets/day = 15K/month, the collector must work
  within the free tier of whichever library/API is selected, OR raise an
  explicit cost flag in the design at probe time (see fallback chain
  below). The official API's $200/mo Basic tier (10K reads) is *not* enough
  by itself — pay-per-use ($0.10/1K reads beyond) or Pro is needed.
- **Configuration auditability:** the `twitter_config` jsonb is editable via
  the existing settings UI; no env-var-only config (matches Reddit/HN
  pattern).

### Edge Cases and Boundary Conditions

1. **Private list / deleted list / non-existent list ID** → caught at the
   per-list level, logged with `error.code = "not_found"` or `"forbidden"`,
   skipped, run continues.
2. **List has fewer tweets than `maxTweetsPerList`** → return what's
   available, no padding.
3. **`sinceHours` cuts off mid-page** → stop iterating once the first tweet
   older than the cutoff is seen (lists return reverse-chronological).
4. **Tweet has no media (text-only)** → `imageUrl: null`, no error.
5. **Tweet has video, not photo** → `imageUrl: null` (we do not surface
   videos in the digest); future work could pull video thumbnails.
6. **Tweet has multiple photos** → take the first.
7. **Long tweet (note_tweet, >280 chars)** → use the library's full-text
   field if available. If the chosen library doesn't expose full text, that
   library FAILS the probe and the chain falls back.
8. **Retweet vs original tweet** → the list endpoint returns retweets
   surfaced by list members. Treat them as the *original* tweet (use the
   original `id_str`, original author, original text). This avoids
   duplicate `externalId`s when two list members retweet the same thing —
   the second occurrence dedups via the unique constraint.
9. **Quote tweet** → treat the *quote* (outer tweet) as the item. The
   quoted-tweet text is dropped (acceptable signal loss — no replies/quotes
   per the user's "tweets only" decision).
10. **Rate-limited mid-list** → 429 triggers retry-with-backoff; exhausted
    retries → list marked failed, run continues.
11. **Auth expired (cookie/token)** → first 401 sets a `authFailed` flag on
    the result; remaining lists skipped; collector throws so the run fails
    visibly. (Auth failure is not partial-failure — it's a config problem,
    not a per-list problem.)
12. **Tweet ID collision across lists in the same run** → second occurrence
    is dropped before the upsert batch is sent (in-memory dedup by
    `externalId`).
13. **Empty `listIds` config** → return success with zeros, log info-level
    `event: "collector.twitter.no_lists_configured"`. Don't throw — Reddit
    behaves the same way for empty subreddits.
14. **Cancellation mid-list** → AbortError propagates, partial work is NOT
    persisted (we only call `upsertItems` once per list at the end of that
    list's loop, atomic).

## Key Insights

1. **The library question is the entire design risk.** The collector code
   itself is mechanical — fetch, map, upsert. What determines whether this
   ships is whether *any* library can fetch a list timeline reliably with
   full-text tweets in May 2026. That's why the library probe is a separate
   pipeline stage rather than something we decide here.
2. **Cookie auth is a known dead-end** for this project (revert at
   `8012d61`). It works for a few hours, then breaks at the worst time.
   Excluded from the chain.
3. **The official API isn't free anymore.** As of Feb 2026 the free tier is
   gone; Basic is $200/mo for 10K reads (insufficient at 500/day). This
   reframes "fall back to API" as a real cost decision, not a free safety
   net.
4. **The user explicitly wants a gap-and-stop**, not silent escalation. If
   no library passes the probe and no bearer token is provided, the
   pipeline should HALT at stage 1.5 with a clear report of options +
   costs + risk profile of a custom scraper, then wait for input. This is
   why the chain ends in `BLOCKED:user-decision`, not `BLOCKED:no-options`.
5. **Lists are reverse-chronological and bounded.** A single list typically
   returns 100–200 tweets/page; for ~500 tweets/day across 1–3 lists,
   we'll often need just one page per list. This keeps the rate-limit
   budget tiny compared to follower-graph or search-based collectors.

## Architectural Challenges

### Library abstraction boundary

The collector must be testable without a network call and replaceable
without rewrites if the chosen library breaks. Solution: a
`TwitterClient` interface with one method —
`fetchListTimeline(listId, opts) -> Promise<NormalizedTweet[]>` — and a
`TwitterClientFactory` injected via `TwitterCollectorDeps`. The default
factory wraps whichever library survives the probe; tests pass a stub
factory that returns canned `NormalizedTweet[]` arrays. This mirrors the
`HttpClient` injection pattern in `hn.ts` and the LLM-client pattern in
`web.ts`.

`NormalizedTweet` is a *thin* internal type — exactly the fields we use:
`{ id, authorHandle, text, createdAt, likeCount, retweetCount, replyCount, photoUrls }`.
The library-specific tweet shape is normalized inside the client adapter,
not leaked into the collector. This keeps the collector untouched if the
library swaps.

### Settings hydration path

The path from `user_settings.twitter_config` → `RunCollectorsPayload.twitter`
already has analogues for HN/Reddit. We follow the same hydration in
`loadUserSettings` (or wherever the daily-run scheduler builds its payload),
plus the manual `/run` page sends the same shape on demand. No new wiring
pattern.

### Auth secret handling

If the chosen path requires a bearer token, the secret lives in `.env`
(`TWITTER_BEARER_TOKEN`), is loaded via the existing dotenv bootstrap, and
is read by the `TwitterClientFactory` — never serialized into job payloads
or DB rows. The settings UI never displays it.

## Approaches Considered

Three approaches differ in *who fetches the tweets*; the rest of the
collector code is the same in all three.

### Approach A: Unauth Twitter scraper library (preferred if it works)

A npm library that fetches tweets without a real Twitter user account or
paid API key. Examples: `rettiwt-api` (guest tokens), unauthenticated paths
of `@the-convocation/twitter-scraper`.

- **How it addresses requirements:** Free, no recurring cost, works for
  500/day if the library is healthy. Matches the project's prior pattern
  (HN/Reddit unauth fetch).
- **How it handles edge cases:** Per-list 429s and 404s flow through
  normally. Long-tweet expansion depends on the library — must be
  validated in the probe.
- **Trade-offs:** Brittle to Twitter-side changes; the library's last
  commit and download trend matter. Risk of silent breakage.
- **Risks:** Library breaks unexpectedly (high), guest-token rate limits
  tighter than expected (medium), full-text not exposed (medium).
- **Effort:** Low (smallest collector code).

### Approach B: Official Twitter API v2 with bearer token

Use `twitter-api-v2` (`v2.lists.tweets(listId, …)`) with a
`TWITTER_BEARER_TOKEN` env var.

- **How it addresses requirements:** Reliable, supported, well-typed.
  Long-tweet via `tweet.fields=note_tweet` is documented. Rate limits
  documented (Basic tier: 75 req/15min on list timeline → fine for
  one daily run).
- **How it handles edge cases:** Library handles retries and pagination
  natively; rate-limit headers exposed.
- **Trade-offs:** Costs money. Free tier discontinued Feb 2026. Basic tier
  ($200/mo) gives 10K reads/mo; we need ~15K. Pay-per-use ($0.10/1K beyond
  Basic cap) or Pro ($5K/mo, way too much) is the realistic shape →
  effective cost ~$200–$250/mo.
- **Risks:** Cost (high — relative to project's "personal use" budget),
  API plan changes (medium).
- **Effort:** Low.

### Approach C: Custom HTTP scraper using public syndication endpoints

Roll a tiny client that hits `https://syndication.twitter.com/srv/timeline-profile/screen-name/<x>`-style
endpoints or `cdn.syndication.twimg.com/widgets/*`. Used by tweet embeds —
no auth needed.

- **How it addresses requirements:** Free, no library dependency.
- **How it handles edge cases:** We control the parser, so partial-failure
  and full-text handling are explicit.
- **Trade-offs:** Brittle (Twitter changes embed endpoints), ToS-grey
  (closer to a robots-violation than libraries that pretend to be a real
  user), and **list timelines aren't a documented embed endpoint** —
  list-of-tweets via syndication is not a guaranteed surface. Likely
  requires per-handle iteration over list members instead, which is a
  different shape.
- **Risks:** Endpoint disappears (high), ToS exposure (medium for personal
  use, project owner accepts).
- **Effort:** Medium.

### Recommendation

**Probe Approach A first** — `rettiwt-api` (most recent publish, active) and
`@the-convocation/twitter-scraper` (most recent publish under that name) as
the two unauth candidates. If both fail the probe (auth wall, missing
full-text, rate-limit lockout), the chain falls to **gap-and-stop**: the
pipeline halts at stage 1.5 with a written cost/risk comparison of
Approach B and Approach C, and the user decides. We do *not* silently fall
into B (cost) or C (ToS) without consent.

This matches the user's explicit choice: "documented gap, then custom
scraper."

## Chosen Approach

A `collectTwitter` collector backed by an injected `TwitterClient` interface,
where the concrete client is selected by the library probe in stage 1.5.

The collector code is library-agnostic: it depends only on
`TwitterClient.fetchListTimeline(listId, opts)`. The factory lives in a
separate module (`packages/pipeline/src/collectors/twitter/clients/`) so the
adapter for whichever library wins can be swapped without touching the
collector or its tests.

### High-Level Design

```
┌─────────────────────────────────────────────────────────────────────┐
│                          run-process.ts                              │
│  RunCollectorsPayload { hn, reddit, web, twitter? }                  │
│  CollectFns { collectHn, collectReddit, collectWeb, collectTwitter } │
│  Promise.all([…, collectTwitter(deps, payload.twitter)])             │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  collectors/twitter/index.ts                         │
│                                                                      │
│  collectTwitter(deps, config) -> Promise<CollectorResult>            │
│                                                                      │
│   for each listId in config.listIds:                                 │
│     try:                                                             │
│       tweets = await deps.client.fetchListTimeline(listId, opts)     │
│       filter by sinceHours, cap at maxTweetsPerList                  │
│       dedup vs rawItemsRepo.findExistingExternalIds("twitter", ids)  │
│       map NormalizedTweet -> RawItemInsert                           │
│       collect into batch                                             │
│     catch err:                                                       │
│       failures.push({ listId, error })                               │
│       if 401: rethrow as AuthError (collector aborts entirely)       │
│   in-memory dedup of batch by externalId                             │
│   await rawItemsRepo.upsertItems(batch)                              │
│   return { itemsFetched, commentsFetched: 0, itemsStored, durationMs}│
└─────────┬───────────────────────────────────────────┬───────────────┘
          │                                           │
          ▼                                           ▼
┌────────────────────────────┐       ┌──────────────────────────────┐
│  collectors/twitter/       │       │     rawItemsRepo (shared)    │
│  clients/<chosen>.ts       │       │  - findExistingExternalIds   │
│                            │       │  - upsertItems               │
│  TwitterClient interface:  │       └──────────────────────────────┘
│  fetchListTimeline(        │
│    listId,                 │
│    { maxTweets, sinceHours,│
│      signal }              │
│  ): NormalizedTweet[]      │
└────────────────────────────┘
```

### Files to add / modify

**Add**:
- `packages/pipeline/src/collectors/twitter/index.ts` — `collectTwitter` function.
- `packages/pipeline/src/collectors/twitter/types.ts` — `TwitterCollectConfig`,
  `TwitterCollectorDeps`, `TwitterClient`, `NormalizedTweet`,
  `TwitterCollectorResult`.
- `packages/pipeline/src/collectors/twitter/map.ts` —
  `tweetToRawItem(t: NormalizedTweet): RawItemInsert`.
- `packages/pipeline/src/collectors/twitter/clients/<chosen>.ts` — the
  concrete adapter implementing `TwitterClient`. Filename and imports
  determined by the probe winner.
- `packages/pipeline/src/collectors/twitter/__tests__/collect-twitter.test.ts` —
  unit tests with a stub `TwitterClient`.
- `packages/pipeline/src/collectors/twitter/__tests__/map.test.ts` — pure
  mapper tests.
- `packages/shared/src/db/migrations/<timestamp>_add_twitter_config.sql` —
  Drizzle migration adding `user_settings.twitter_config jsonb`.

**Modify**:
- `packages/shared/src/db/schema.ts` — add `twitterConfig` column to
  `userSettings`. Verify `SourceType` already includes `"twitter"` (per
  reconnaissance: yes).
- `packages/shared/src/types/run.ts` — add `RunSubmitTwitterConfig`,
  extend `RunSubmitPayload` and `RunCollectorsPayload`.
- `packages/api/src/lib/validate.ts` — add `twitterConfigSchema`, extend
  `userSettingsUpsertSchema`.
- `packages/api/src/routes/settings.ts` — settings repo already round-trips
  jsonb; verify the new column flows through `UserSettings`.
- `packages/pipeline/src/workers/run-process.ts` — add `collectTwitter` to
  `CollectFns`, `twitter?: TwitterCollectConfig` to `RunCollectorsPayload`,
  add a Task in the `Promise.all` fan-out.
- `packages/pipeline/src/services/load-user-settings.ts` (or equivalent —
  resolved during planning) — hydrate `twitterConfig` into the run payload.
- `packages/web/src/pages/SettingsPage.tsx` — add a Twitter section
  (list IDs textarea + max-per-list + sinceHours).

**No changes to**:
- ESLint plugin (the existing `collector-return-shape` rule covers the new
  collector).
- Drizzle DB client.
- Daily-run scheduler (the schedule itself is unchanged; only the payload
  it builds gets a new optional field).

## External Dependencies & Fallback Chain

> **Resolved by library probe on 2026-05-04** — see
> `docs/spec/add-twitter-x-collector/library-probe.md` for full
> evidence (verbatim error excerpts, latency measurements, payload
> samples).

The collector depends on exactly one external thing: a library or API
that can fetch a Twitter list timeline with full text. Four candidates
were probed live against list `1585430245762441216`:

| Candidate | Auth model | Outcome |
|---|---|---|
| `rettiwt-api@7.0.3` (guest mode) | none | FAILED — `LIST_TWEETS` not in library's `AllowGuestAuthenticationGroup` |
| `@the-convocation/twitter-scraper@0.22.3` (guest mode) | none | FAILED — Twitter returned HTTP 404 with empty body for the list-timeline GraphQL endpoint |
| Custom syndication scraper | none | DEAD — `cdn.syndication.twimg.com/widgets/timelines/<id>` and `/timeline/list?list_id=<id>` return HTTP 200 with `content-length: 0`. List-by-ID is closed in May 2026 |
| Official Twitter API v2 (`twitter-api-v2`) | bearer token | DECLINED — ~$200.50/mo for our volume; cost-prohibitive for personal use |
| **`rettiwt-api@7.0.3` (user-auth, apiKey)** | **base64 of session cookies** | **VERIFIED — SELECTED** |

### Selected: `rettiwt-api@7.0.3` in user-auth mode

- **Maturity:** last published 2026-05-02 (two days before probe), 828
  GitHub stars, 19 open issues, ISC/MIT licensed, not deprecated.
  Source repo: `Rishikant181/Rettiwt-API`.
- **API:** `rettiwt.list.tweets(listId, count, cursor)` returns
  `Promise<CursoredData<Tweet>>` where `CursoredData<T>` is
  `{ list: T[], next: { value: string, type: string } | null }`.
- **Auth model:** `RETTIWT_API_KEY` is base64-encoded
  `auth_token=<v>; ct0=<v>; kdt=<v>; twid=<v>;`. Other cookies are
  ignored. Generated via the [X Auth Helper Chrome
  extension](https://chromewebstore.google.com/detail/x-auth-helper/igpkhkjmpdecacocghpgkghdcmcmpfhp)
  or by manually base64-encoding the cookie string. Lasts up to 5
  years if the source X.com session isn't logged out.
- **Live probe results (2026-05-04, list `1585430245762441216`):**
  - 95 tweets returned on first page in 2.09s
  - Full-text round-trip VERIFIED (a 778-char `fullText` came through
    intact — no 280-char truncation)
  - Pagination cursor advances correctly (page 2 returned 107 distinct
    tweets, 1-tweet boundary overlap)
  - Latency: ~3s per page → ample headroom for 500 tweets/day
- **Tweet shape from live capture:**
  - `id` (string), `fullText`, `createdAt` (ISO), `tweetBy.userName`
    (handle), `likeCount`, `retweetCount`, `replyCount`, `quoteCount`,
    `viewCount` (nullable, null on retweets), `bookmarkCount`,
    `media[]` (with `type === "photo"` for `imageUrl`),
    `retweetedTweet` / `quoted` / `replyTo` (nested `Tweet | null`),
    `entities`, `lang`, `conversationId`, `url`.

### Chosen mappings (resolved by live shape)

- **Engagement:** `points = likeCount`, `commentCount = retweetCount + replyCount + quoteCount` (all summed since the design's "tweets only" decision means no separate replies axis exists).
- **Retweets:** when `retweetedTweet` is non-null, the outer
  `fullText` is the truncated `RT @user: ...` form. The collector
  uses the **inner** tweet (`retweetedTweet.id`,
  `retweetedTweet.fullText`, `retweetedTweet.tweetBy.userName`) so
  the entry represents the *original*. Two list members retweeting
  the same thing collapse to one row via the
  `(sourceType, externalId)` unique constraint.
- **Quotes:** outer tweet is the item. Quoted tweet text is dropped
  (matches the "tweets only" decision).
- **Image:** `media[]` filtered to `type === "photo"`, take the first
  entry's URL. Videos populate `imageUrl: null`.
- **viewCount nullability:** mapper coalesces `null` to `0` when
  storing to the engagement field.

### Failure modes (still apply)

- **Cookie expiry / auth revoked:** library throws
  `Error: Not authorized to access requested resource` (same string
  whether guest mode is denied or a user apiKey has expired).
  Collector treats the FIRST 401-class error as a config problem,
  marks the run failed visibly, and surfaces an actionable error so
  the operator regenerates the apiKey. Subsequent lists in the same
  run are skipped (no point retrying — the auth is dead).
- **Per-list 404 (deleted/private):** caught at per-list level, logged,
  remaining lists continue. Matches Reddit's per-subreddit
  behaviour.
- **Rate-limit (429):** retry with exponential backoff (mirror
  `hn.ts:83-115`), capped at 3 attempts.
- **Library breaks against Twitter changes:** rettiwt-api maintainer
  publishes fix → run `pnpm update rettiwt-api`. The collector code
  is unchanged because the lib normalizes the GraphQL shape.

### Live probe target

- **List ID:** `1585430245762441216` (user-supplied, public AI/ML list).
- **Probe scripts:** kept in
  `docs/spec/add-twitter-x-collector/probes/rettiwt-api/`
  (gitignored under `docs/spec/`, but kept locally for re-run during
  CI verification or after a library update).
- **Credentials:**
  - `.env.harness` at project root (gitignored via `.env.*` pattern):
    `RETTIWT_API_KEY=<base64 cookie blob>` — used by probe scripts.
  - `.env` (gitignored): same `RETTIWT_API_KEY` — used by the pipeline
    runtime via the existing dotenv bootstrap.
  - `.env.example` (committed): placeholder line documenting the var.

## Open Questions

1. **Cancellation contract for the `TwitterClient` adapter.** Does
   `rettiwt-api` accept an `AbortSignal`, or do we need to wrap it with
   a manual `Promise.race`? Resolve in the probe.
2. **Pagination shape for list timelines.** `rettiwt-api` returns
   `Cursored<Tweet>`; need to confirm the `cursor` field works for the
   list endpoint (some endpoints in scrapers don't paginate). At ~500
   tweets/day across 1–3 lists, we likely don't need to paginate, but
   the probe should test that one cursor advance works.
3. **`maxTweetsPerList` default.** Suggest 200 (covers a heavy-volume
   list) but plan should pick the final default.
4. **Settings UI shape for `listIds`.** Textarea (newline-separated) vs.
   chip-list with add/remove. Mirror Reddit's existing pattern for
   subreddits — resolved during planning.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `rettiwt-api` breaks within weeks | Medium | High | Probe re-runnable; client is behind interface — swap adapter without touching collector. Quality-gate's library-probe re-run can be scheduled monthly. |
| Twitter changes guest-token mechanics, all unauth libs die | Medium | High | Gap-and-stop is in the chain. User has documented their Approach B/C decision criteria. |
| Full-text expansion silently truncated | Low | Medium | Probe explicitly tests a >280-char tweet. Fail-the-library if not satisfied. |
| `note_tweet` field naming differs across libs | Medium | Low | Adapter normalizes to `NormalizedTweet.text` (full); collector never sees the raw shape. |
| List timeline endpoint deprecated by library | Low | High | Probe runs the actual list endpoint, not just any timeline endpoint — failure caught at probe, not in production. |
| Cookie/login regression slips into a chosen library | Low | High | Both unauth candidates explicitly evaluated for guest-mode list support. If a library requires `login()` for lists, it fails the probe. |
| Tweet ID overflow (53-bit) | Low | High | `externalId` is `text` in the schema — already string-typed, no conversion. |

## Assumptions

- Twitter list IDs are stable across the foreseeable life of this feature
  (≥6 months). The user-supplied list `1585430245762441216` will not be
  deleted during probe.
- The `(sourceType, externalId)` unique constraint on `raw_items` is the
  ground-truth dedup boundary — same tweet ID across two lists collapses
  to one row, which is the desired behaviour.
- A daily run is the only run cadence for Twitter; no per-list schedules
  or per-handle pollers. The pipeline's existing daily-run job is the only
  caller.
- The `web` collector's "all-failed → throw" pattern is the right shape for
  Twitter too (when every list errors, the run fails visibly and BullMQ
  retries; when one list errors, the run continues).
- Replies are not collected. If product later wants reply context, this
  becomes a separate design (replies blow the volume budget by 5–10×).
