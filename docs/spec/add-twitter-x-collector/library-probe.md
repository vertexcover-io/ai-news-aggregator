# Library Probe — Twitter/X Collector

> **Run at:** 2026-05-04
> **Live test list ID:** 1585430245762441216 (user-supplied, public AI/ML list)
> **Verdict:** PASS
> **Selected:** `rettiwt-api@7.0.3` in user-auth (apiKey) mode

## Summary

| Candidate | Health | Smoke | Final |
|---|---|---|---|
| `rettiwt-api@7.0.3` (guest mode) | trusted | FAILED:auth-required-by-library | PIVOTED |
| `@the-convocation/twitter-scraper@0.22.3` (guest mode) | trusted | FAILED:404-from-twitter | PIVOTED |
| Custom syndication scraper (Approach C) | n/a | FAILED:endpoint-returns-empty-body | DEAD |
| `twitter-api-v2@1.29.0` (Approach B, paid) | trusted | NOT RUN | DECLINED — user said cost-prohibitive |
| **`rettiwt-api@7.0.3` (user-auth, apiKey)** | **trusted** | **VERIFIED** | **SELECTED** |

## Selected

**`rettiwt-api@7.0.3`** in user-auth (apiKey) mode for fetching list timelines.

- **Probe scripts (committed for re-run):**
  - `docs/spec/add-twitter-x-collector/probes/rettiwt-api/probe-list-tweets-userauth.mjs`
  - `docs/spec/add-twitter-x-collector/probes/rettiwt-api/probe-pagination.mjs`
- **Evidence:**
  - `probes/rettiwt-api/payload.sample.json` — sanitized first-three-tweets capture
  - `probes/rettiwt-api/probe-userauth.log` — probe stdout
  - `probes/rettiwt-api/probe-pagination.log` — pagination probe stdout
  - `probes/rettiwt-api/health.json` — npm/GitHub health snapshot

## Live results — VS-0a-userauth (PASS)

```
[0.00s] apiKey loaded (length=388)
[0.00s] instantiating Rettiwt({ apiKey: <redacted> }) — user-auth mode
[0.00s] calling rettiwt.list.tweets("1585430245762441216", 20)
[2.08s] result type: object; keys: list,next
[2.08s] tweets returned: 95
[2.08s] first tweet keys: _raw,bookmarkCount,conversationId,createdAt,entities,
        fullText,id,lang,likeCount,media,quoteCount,quoted,replyCount,replyTo,
        retweetCount,retweetedTweet,tweetBy,url,viewCount
[2.08s] shape checks: {"hasId":true,"hasText":true,"hasCreatedAt":true,
        "hasAuthor":true,"hasLikeCount":true}
[2.08s] long-form tweet found: 778 chars — full-text expansion VERIFIED
[2.08s] cursor present for pagination: true
[2.09s] PASS — list-tweets in user-auth mode, 95 tweets, 2.09s
```

**Key validations:**
- 95 tweets returned on first page (note: rettiwt's `count` parameter is
  documented as ignored without a cursor; defaults to ~100. Confirmed.)
- Live tweets dated `2026-05-04T09:48:01Z` — list is active.
- All shape checks pass.
- **Full-text expansion VERIFIED** — a 778-char `fullText` round-tripped
  intact (no 280-char truncation).
- Cursor present for pagination.
- Latency: 2.1s for first page.

## Live results — VS-0a-pagination (PASS)

```
page 1: 95 tweets in 2741ms, cursor=DAABCgABHHd2Ux4__7MKAAIcdznE_Fpw-ggAAwAA...
page 2: 107 tweets in 3487ms, cursor=DAABCgABHHd2Ux4__10KAAIcdtqWldsBgwgAAwAA...
overlap: 1/107 tweets repeated between pages
PASS — pagination works, 201 unique tweets across 2 pages
```

**Key validations:**
- Cursor advances correctly between pages.
- 1-tweet boundary overlap (typical for cursor-based feeds; handled by
  the collector's existing `findExistingExternalIds` dedup).
- Combined latency for ~200 tweets: ~6.2s. At ~500 tweets/day this is
  trivial cost.

## Live tweet shape (from payload.sample.json)

The library normalizes Twitter's GraphQL response into this shape:

| Field | Type | Notes |
|---|---|---|
| `id` | string | Tweet ID |
| `fullText` | string | Full-text (no 280-char truncation) |
| `createdAt` | ISO string | Tweet creation time |
| `tweetBy.userName` | string | Author handle (`@<userName>`) |
| `likeCount` | number | |
| `retweetCount` | number | |
| `replyCount` | number | |
| `quoteCount` | number | |
| `viewCount` | number \| null | null on retweets |
| `bookmarkCount` | number | |
| `media` | object[] \| undefined | Photos/videos (mapper takes first photo for `imageUrl`) |
| `entities` | object | URLs, hashtags, mentions |
| `retweetedTweet` | Tweet \| null | When the list-member retweeted something — original tweet shape |
| `quoted` | Tweet \| null | When this tweet quote-tweets another |
| `replyTo` | Tweet \| null | When this tweet is a reply |
| `url` | string | `https://x.com/<handle>/status/<id>` |
| `lang` | string | Language code |
| `conversationId` | string | Thread root ID |

**Mapping decisions for the collector (resolved by probe data):**

- **Retweets:** when `retweetedTweet` is non-null, the outer text is the
  truncated `RT @user: ...` form (140 chars). To get the original
  full-text, use `retweetedTweet.fullText` and `retweetedTweet.id`.
  This matches the design's "treat retweets as the original tweet"
  decision.
- **`viewCount` null on retweets:** mapper must coalesce nulls to
  `0` or `null` (drizzle accepts both for the engagement field — TBD
  in planning).
- **`media` is an array of `{ type, url, ... }`:** mapper takes the
  first item with `type === "photo"` for `imageUrl`. Videos are
  ignored (per design).

## Pivot Log

1. **VS-0a (rettiwt guest)** → FAILED. `LIST_TWEETS` not in
   `AllowGuestAuthenticationGroup`. Library refuses client-side.
2. **VS-0b (convocation guest)** → FAILED. Twitter returns HTTP 404
   for list-timeline GraphQL endpoint without auth.
3. **VS-0d (custom syndication scraper investigation)** → DEAD.
   `cdn.syndication.twimg.com/widgets/timelines/<id>` and related
   endpoints return HTTP 200 with empty body. Tweet-result endpoint
   for individual IDs works, confirming infra is up — only list-by-ID
   is closed.
4. **VS-0c (paid Twitter API)** → DECLINED by user (~$200/mo
   cost-prohibitive for personal use).
5. **Re-probe: VS-0a-userauth (rettiwt user-auth via apiKey)** →
   VERIFIED. User explicitly opted in to cookie-based auth via
   maintained library.

## Auth model — important context

`rettiwt-api`'s "user authentication" requires an `apiKey` which is a
**base64-encoded cookie string** containing exactly four cookies:
`auth_token`, `ct0`, `kdt`, `twid`. Other cookies are ignored.

This IS cookie-based auth. The user originally excluded this class
because of the prior revert at `8012d61`. After unauthenticated paths
exhausted and the paid API was declined, the user explicitly opted in,
on the basis that:

- The prior revert was a **custom GraphQL client** (the project owned
  the breakage when Twitter changed surfaces).
- This path uses a **maintained library** (`rettiwt-api`, last
  published 2026-05-02) — when Twitter changes endpoints, the library
  absorbs the change, not the project's code.
- When cookies expire (5 years per the README, or sooner if the user
  explicitly logs out of the X.com session), only the `RETTIWT_API_KEY`
  env var needs rotating. No code changes.

**Implications for the design doc:** the brainstorm's "cookie auth is
already-tried-and-failed" exclusion is now superseded. The chosen-approach
section needs an update during spec generation to reflect that
user-auth is the selected path and to document the apiKey rotation
runbook.

## Setup needed

For development and CI:
- File `.env.harness` at project root (gitignored via `.env.*` in
  `.gitignore`), permission `chmod 600`.
- Key: `RETTIWT_API_KEY=<base64 of "auth_token=...; ct0=...; kdt=...; twid=...;">`
- Build helper: encode like
  ```
  node -e 'const c={auth_token:"...",ct0:"...",kdt:"...",twid:"..."};
  const s=Object.entries(c).map(([k,v])=>`${k}=${v}`).join(";")+";";
  process.stdout.write(Buffer.from(s).toString("base64"))'
  ```

For production (later, in deployment):
- Same `RETTIWT_API_KEY` env var must be set on the EC2 host or
  wherever the pipeline runs.
- Add to deployment env-checklist.

For pipeline runtime:
- The collector reads `RETTIWT_API_KEY` from `process.env` at boot
  (via the existing dotenv bootstrap).
- If the env var is missing/empty, the collector logs a structured
  error and returns `CollectorResult { itemsFetched: 0, ... }` (does
  not throw — failed env shouldn't crash the run).

## Addendum 2026-05-04 — VS-0a-user-timeline (PASS)

User feedback during planning expanded scope to include user-timeline
collection alongside list-timeline. Re-probed to validate.

**Probe scripts:**
- `probes/rettiwt-api/probe-user-timeline.mjs`
- Evidence: `probes/rettiwt-api/payload-user-timeline.sample.json`,
  `probes/rettiwt-api/probe-user-timeline.log`

**Live results (2026-05-04):**

```
[0.00s] resolving @jack via rettiwt.user.details(jack)
[3.48s]   -> id=12, userName=jack, fullName=jack
[5.53s] resolving @sama via rettiwt.user.details(sama)
[5.53s]   -> id=1605, userName=sama, fullName=Sam Altman
[5.53s] calling rettiwt.user.timeline("12", 10) for @jack
[8.81s]   -> 21 tweets, cursor=no
[8.81s] calling rettiwt.user.timeline("1605", 10) for @sama
[11.26s]  -> 20 tweets, cursor=no
PASS — handle->id resolution + user.timeline() in user-auth mode
```

**Key validations:**
- `rettiwt.user.details(handle)` resolves a `@handle` to a numeric `id`.
  Both `jack` and `sama` resolved correctly.
- `rettiwt.user.timeline(numericId, count)` returns `CursoredData<Tweet>`
  — same shape as `list.tweets()`. Mapper code can be reused.
- All five shape checks pass on both sample timelines.
- **Notable difference from list.tweets:** user-timeline returned no
  cursor. Both calls returned 20-21 tweets in a single page. Collector
  must handle both cases (cursor present and cursor absent).

**Auth mode:** same `RETTIWT_API_KEY`; one `Rettiwt()` instance shared
between `list.tweets()` and `user.timeline()` calls.

**New REQs added to spec:** REQ-002b, REQ-008b, REQ-070..074 covering the
user-timeline path — see spec.md.

## Re-plan implications

- **Design doc** (`docs/plans/2026-05-04-twitter-collector-design.md`):
  - "Auth fallback chain" section: user-auth via apiKey is now the
    selected path, not a fallback. spec generation should rewrite the
    External Dependencies section accordingly.
  - "Excluded: cookie auth" line in Context section: superseded —
    explicitly allowed under maintained-library wrapper.
  - Risks section: keep the Twitter-changes-GraphQL-surface risk but
    note that mitigation is "rettiwt-api maintainer publishes a fix".

- **Spec generation:** must include:
  - VS-0a-userauth and VS-0a-pagination from
    `probes/verification-stubs.md`.
  - A configuration section documenting `RETTIWT_API_KEY` env var
    requirement.
  - Field-mapping detail derived from the live payload
    (retweet handling, viewCount null, media[0]).

<!-- LP:VERDICT:PASS -->
