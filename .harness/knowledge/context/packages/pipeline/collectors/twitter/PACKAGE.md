---
governs: packages/pipeline/src/collectors/twitter/
last_verified_sha: 5a2ff20
key_files: [index.ts, map.ts, types.ts, clients/rettiwt.ts, clients/rettiwt-auth.ts]
flow_fns: [index.ts::collectTwitter, clients/rettiwt.ts::createRettiwtClient, clients/rettiwt-auth.ts::refreshRettiwtCsrfToken, map.ts::tweetToRawItem]
decisions: [D-020, D-021]
status: active
---

# collectors/twitter/ — X/Twitter collection via Rettiwt API with CSRF auth management

## Purpose
Collects tweets from Twitter/X lists and user timelines via the `rettiwt-api` library. Normalizes tweet data, extracts quoted tweets, maps to `RawItemInsert`, and manages CSRF token rotation when credentials are stored in the admin DB.

## Public surface
- `collectTwitter(deps, config)` → `TwitterCollectorResult` — batch collect from configured Twitter lists/users
- `fetchTwitterPost(url, deps)` → `RawItemInsert` — fetch single tweet by URL for add-post flow
- `parseTweetIdFromUrl(url)` → `string | null` — extract tweet ID from x.com/twitter.com/mobile URLs
- `createRettiwtClient({ rettiwt, auth? })` → `TwitterClient` — adapter wrapping Rettiwt SDK, adds `denormalize()` + `abortRace()`
- `refreshRettiwtCsrfToken({ rettiwt, repo, credentialSource })` → `boolean` — rotates CSRF token; persists to DB when source="db"
- `tweetToRawItem(tweet, sourceUnit?)` → `RawItemInsert` — maps `NormalizedTweet` to `RawItemInsert`
- `denormalize(raw)` → `NormalizedTweet` — unwraps retweets, extracts quoted tweets
- `isCsrfMismatchError(err)` → `boolean` — detects CSRF mismatch (409/403 with specific body)

## Depends on / used by
- Uses: `rettiwt-api`, `@newsletter/shared`, `@pipeline/services/link-enrichment`
- Used by: `workers/run-process.ts`, `services/add-post/dispatch.ts`, `workers/processing.ts`

## Data flows

### collectTwitter(deps, config) → TwitterCollectorResult
  config.sources → for each source (list or user):
    rettiwtClient.fetchListTweets / fetchUserTimeline → page through tweets (max 10 pages)
      ├─ per-page: denormalize raw tweets → tweetToRawItem → RawItemInsert[]
      ├─ CSRF mismatch detected → refreshRettiwtCsrfToken → retry once
      ├─ rate-limited → exponential backoff (250ms/1s/4s)
      ├─ out-of-window streak > 30 → stop paging (tweets too old)
      └─ auth failure → classify as `auth` error, source skipped
    → enrichRawItems → rawItemsRepo.upsertItems → TwitterCollectorResult
  (collector continues on per-source failure; only all-sources-failed is terminal)

### createRettiwtClient({ rettiwt, auth? }) → TwitterClient
  rettiwt → wrap fetchListTweets / fetchUserTimeline
    → fetch page → denormalize each tweet
      ├─ retweet: inner = retweetedTweet (unwrap once)
      ├─ quoted tweet present → extract NormalizedTweet.quotedTweet
      └─ external URL extraction → first non-x.com/twitter.com/t.co URL
    → abortRace (check signal between pages)
  (if auth provided, CSRF refresh fn is wired; if not, client runs in guest mode)

### tweetToRawItem(t, sourceUnit?) → RawItemInsert
  t → makeTitle (first 80 chars) → content (append "Quoting @handle: text" for quoted tweets)
    → metadata.quotedTweet (structured quoted-tweet block)
      → sourceUnit → metadata.sourceUnit
        → RawItemInsert

## Gotchas / landmines
- **Rettiwt pagination type mismatch**: Rettiwt's published types declare `CursoredData.next: string` but the live runtime emits `string | { value: string }`. The adapter accepts either shape. Upgrade `rettiwt-api` past 7.0.3 requires re-checking. (D-020)
- **Quoted-tweet tombstone guard**: `denormalize()` guards against quoted tombstones (legacy-less tweets with `conversation_id_str` crash). A `patches/rettiwt-api@7.0.3.patch` exists; re-check on rettiwt upgrade. (D-021)
- **Guest mode**: Rettiwt accepts `undefined` apiKey and runs in unauthenticated guest mode. The collector classifies the first auth failure as `auth` so the operator sees a clear skip reason in Slack.
- **CSRF refresh persists to DB**: When `credentialSource === "db"`, the refreshed CSRF token is upserted back to `social_credentials` so it survives worker restarts. When sourced from env, the in-memory key is updated but not persisted.

## Decisions
- **D-020**: Accept both `string` and `{ value: string }` cursor shapes. Why: Rettiwt runtime diverges from published types; narrowing to the declaration would drop pagination on every page boundary. Tradeoff: the adapter type is wider than the SDK type — an SDK fix would let us remove the union. Governs: `clients/rettiwt.ts`.
- **D-021**: Guard quoted-tweet access against tombstones. Why: quoted tweets from deleted/protected accounts have no `legacy` field; accessing `conversation_id_str` crashes. Tradeoff: the patch is fragile across Rettiwt upgrades. Governs: `clients/rettiwt.ts`, `patches/rettiwt-api@7.0.3.patch`.
