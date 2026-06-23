# Library Probe — reddit-collector-apify

> **Run at:** 2026-06-18 06:27
> **Verdict:** PASS

## Summary

| Library | Health | Smoke | Final |
|---|---|---|---|
| apify-client (npm 2.23.4) | trusted (332k weekly dl, not deprecated, official SDK) | VERIFIED | SELECTED |
| actor `trudax/reddit-scraper-lite` | trusted (27,695 users, PAY_PER_EVENT) | VERIFIED (listing + single post) | SELECTED |

## Selected

- **`apify-client`** as the SDK; **`trudax/reddit-scraper-lite`** as the actor for both
  use cases.
- Evidence: `.harness/runtime/reddit-collector-apify/probes/apify-client/probe-listing.log`,
  `probe-post.log`, `payload.sample.json`.
- No pivots required — first choice verified on both flows.

## Verified flows + canonical input contract

**Auth:** `new ApifyClient({ token: APIFY_API_KEY })`. Token from `.env.harness` (probe) /
DB-first app-credential + `APIFY_API_KEY` env fallback (production).

### Use case 1 — subreddit listing (drives `collectReddit`)
Input that works (verified, runId `SCcc6tER70g0n9hkI`, 6 posts across 2 subreddits, 0 403s):
```jsonc
{
  "startUrls": [
    { "url": "https://www.reddit.com/r/<sub>/top/?t=<timeframe>" },   // sort=top → /top/?t=week
    { "url": "https://www.reddit.com/r/<sub>/new/" }                  // sort=new|hot → /<sort>/
  ],
  "skipComments": true, "skipUserPosts": true, "skipCommunity": true,
  "includeMediaLinks": true,           // REQUIRED to populate upVotes + numberOfComments
  "maxPostCount": <config.limit>,       // per-subreddit cap (verified: maxPostCount:3 → 3/sub)
  "maxItems": <config.limit * subreddits.length>,  // global safety cap
  "proxy": { "useApifyProxy": true, "apifyProxyGroups": ["RESIDENTIAL"] }
}
```
- A **bare** `/r/<sub>/` startUrl returns 0 posts — the **sort path is required**
  (`/top/?t=week`, `/new/`, `/hot/`). Search-mode (`searchCommunityName`) does a keyword
  search *within* the subreddit, NOT a listing — do not use it for collection.

### Use case 2 — single post by permalink (drives `fetchRedditPost`)
Verified (runId `ZAgDGBYJovS6HeLqp`, 1 post, `parsedId` match):
```jsonc
{ "startUrls": [{ "url": "<reddit post permalink>" }],
  "skipComments": true, "skipUserPosts": true, "skipCommunity": true,
  "includeMediaLinks": true, "maxItems": 1,
  "proxy": { "useApifyProxy": true, "apifyProxyGroups": ["RESIDENTIAL"] } }
```

### Output → RawItemInsert field mapping (verified field names)
| RawItemInsert | actor field |
|---|---|
| `externalId` | `parsedId` (already stripped; `id` is `t3_<parsedId>`) |
| `title` | `title` |
| `url` | `link` ?? `url` (external link if the post links out, else permalink) |
| `sourceUrl` | `url` (permalink) |
| `author` | `username` |
| `content` | `body` |
| `publishedAt` | `new Date(createdAt)` |
| `engagement.points` | `upVotes` |
| `engagement.commentCount` | `numberOfComments` |
| `imageUrl` | `imageUrls?.[0]` |
| `metadata.sourceUnit` | from `parsedCommunityName` → `{ identifier: "r/<name>", displayName: "r/<name>" }` |
| (filter) | keep only items where `dataType === "post"` |

## Pricing (recorded for planning / NF1)
- **PAY_PER_EVENT**: `$0.02` per actor-start per GB (one-time) + `$0.004` per result stored
  (FREE tier; lower on paid Apify tiers). Posts-only (`skipComments: true`) → 1 result/post.
- Example full run (7 subs × 25 posts = 175 posts): ~$0.70/run + start fee ≈ **~$0.74/day
  ≈ $22/month** at daily cadence. Bounded by `maxPostCount`/`maxItems`.

## Rate limit / latency (VERIFIED_WITH_CAVEAT — plan must respect)
- The actor fetches **each post as an individual Puppeteer page**, so **latency scales with
  total post count**: ~55s single post, ~94–114s for 6 posts. A full 175-post run will take
  **several minutes**.
- Transient **403s** from Reddit on the RESIDENTIAL proxy are **retried automatically** by
  the actor and resolve within the run (final runs had 0 failed requests). No action needed
  in our code — do NOT add our own Reddit retry/backoff (the old RSS path's job is gone).
- **Implication for the collector:** pass the BullMQ job `AbortSignal` through to abort a
  long `.call()` on shutdown; rely on BullMQ auto lock-renewal for liveness (R3). Keep
  `maxItems`/`maxPostCount` bounded (NF1).

## Setup Needed
- `APIFY_API_KEY` in project-root `.env.harness` (gitignored) — present. Production uses the
  DB-first app-credential (`apify_api_token`) with `APIFY_API_KEY` env fallback.

## Resolution
- Not escalated — primary library + actor verified on first attempt.

<!-- LP:VERDICT:PASS -->
