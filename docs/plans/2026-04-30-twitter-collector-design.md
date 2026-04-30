# Twitter Collector — Design

**Date:** 2026-04-30
**Status:** Approved (pending plan)
**Spec dir:** `docs/spec/build-twitter-collector/`
**Linear:** TBD (file under VER- newsletter project)

## Problem Statement

The newsletter pipeline currently collects from HN, Reddit, and a generic web/blog crawler.
Twitter/X is the highest-value missing source for AI news but has no first-party API path
that fits this project (no paid X API tier, no public unauthenticated endpoints since 2023).
We need a Twitter collector that fetches:

1. Recent tweets from configured X **usernames** (their author timeline).
2. Recent tweets from configured Twitter **Lists** (by list ID).

…integrates with the existing collector contract, surfaces in the settings UI and dashboard
just like the other collectors, and authenticates via a one-time browser-exported cookie blob
in an env var (no password login, no 2FA flow inside the worker).

## Context

- **Existing collector pattern:** `packages/pipeline/src/collectors/{hn,reddit,web}.ts`
  each export `collect<Source>()` returning `Promise<CollectorResult>`, taking
  `{ rawItemsRepo, fetchFn?, signal? }` and a per-source config. They map source API
  responses directly to `RawItemInsert[]` (no intermediate types — enforced by
  `newsletter/collector-return-shape`) and upsert via `rawItemsRepo.upsertItems()`.
- **Settings shape:** `user_settings` (singleton row) currently holds `hnConfig`,
  `redditConfig`, `webConfig`. The settings page (`/admin/settings`) edits them
  through `react-hook-form` + zod (`packages/web/src/pages/settingsSchema.ts`).
  A `twitterConfig` jsonb column needs to be added the same way.
- **`SourceType` already includes `"twitter"`** in `packages/shared/src/db/schema.ts`
  — no enum migration needed for the raw_items table itself.
- **Run dispatch:** `handleRunProcessJob()` in `workers/run-process.ts` invokes all
  enabled collectors via `Promise.allSettled`. Twitter slots in alongside HN/Reddit/Web
  and writes per-source state to `RunState.sources.twitter`.
- **Library:** `agent-twitter-client` (the GitHub fork the user named is
  `TreasureProject/twitter-scraper-v2`, but the npm artifact is published as
  `agent-twitter-client`). The planner is responsible for picking the exact
  package + version (favor the most actively maintained fork that exposes
  `setCookies`, `getTweets`, and `fetchListTweets`) and pinning it exactly per
  the project's "no `^`/`~`" rule.

## Requirements

### Functional

- F1. Fetch tweets from N user handles configured in settings (`users: string[]`).
- F2. Fetch tweets from M Twitter Lists configured in settings (`listIds: string[]`).
- F3. Authenticate using cookies parsed from `TWITTER_COOKIES_JSON` env var.
  No password login, no 2FA prompt, no browser automation.
- F4. Settings UI lets the operator edit users + lists (multi-line textarea or chip
  list, same UX feel as the existing HN keywords / Reddit subreddits editors),
  set `maxPerSource` and `sinceDays`, and enable/disable the source via a single
  toggle (`twitterConfig === null` means disabled, mirroring HN/Reddit).
- F5. List entries accept either a numeric list ID (`1234567890`) or a list URL
  (`https://x.com/i/lists/1234567890`, `https://twitter.com/i/lists/1234567890`).
  We extract the trailing numeric segment server-side in the API zod schema.
  Persisted shape is the canonical numeric ID string.
- F6. Each tweet maps to one `RawItemInsert` with `sourceType="twitter"`,
  `externalId=tweet.id` (the canonical tweet ID — same value regardless of which
  source surfaced it, so duplicate tweets across user-and-list collide on the
  unique constraint and dedup naturally).
- F7. The collector returns the existing `CollectorResult` shape: `itemsFetched`,
  `commentsFetched: 0` (we don't fetch reply threads), `itemsStored`, `durationMs`.
- F8. RunState reports a `sources.twitter` slot with `status`, `itemsFetched`,
  and `errors[]` — reusing the existing `SourceRunState` type. The dashboard's
  per-source status panel automatically picks it up once the type is widened.
- F9. Tweet image plate: `imageUrl = tweet.photos[0]?.url ?? null`. Videos and GIFs
  are ignored for the image plate (no thumbnails for them). The Ledger archive
  view uses `imageUrl` exactly the same way it does for HN/Reddit/web.
- F10. Cancellation: the collector observes `AbortSignal` between sources (never
  inside a single library call — the library doesn't expose a signal hook).
  On abort, partial results already stored remain stored; the source is marked
  `cancelled` upstream.

### Non-functional

- NF1. **Strict TypeScript** — no `any`, all library types come from the package's
  shipped `.d.ts`. If the library types are loose, define narrow internal types.
- NF2. **One Scraper instance per run.** Constructed once at the start of
  `collectTwitter()`, cookies set once, reused for every user and list. Avoids
  re-login churn that triggers anti-bot signals.
- NF3. **Per-source rate limit:** 1 second delay between consecutive
  `getTweets`/`fetchListTweets` calls (similar to the Reddit collector's 500 ms).
  Single account, low volume — no proxy pool, no account pool. This restriction
  must not be baked in deeper than a single delay constant; future work could
  add a pool by injecting multiple cookie blobs.
- NF4. **Cookie expiry is recoverable, not fatal to the run.** A `TwitterAuthError`
  fails *the Twitter source* and writes the message into `sources.twitter.errors`,
  but other collectors keep running and the run still completes (with fewer items).
- NF5. **No proxy support in MVP.** Architecture must not preclude adding
  `httpsAgent` later — pass any future proxy options through a single options
  object the collector forwards to the Scraper constructor.
- NF6. **Logging at boundaries only:** info on collection start/end per source,
  warn on auth or rate-limit failures, error on unexpected library throws.
  No per-tweet logs.
- NF7. **No HTTP framework in pipeline.** All UI/admin paths are implemented in
  `@newsletter/api`; the collector itself is pure pipeline code.
- NF8. **Repository pattern preserved.** Twitter items go through `rawItemsRepo`
  (no direct Drizzle calls in the collector — enforced by
  `newsletter/enforce-repository-access`).

### Edge cases

- E1. `TWITTER_COOKIES_JSON` missing **and** `twitterConfig` enabled → fail the
  Twitter source fast with a `TwitterAuthError("TWITTER_COOKIES_JSON not set")`,
  do not touch the network, run continues.
- E2. `TWITTER_COOKIES_JSON` present but unparseable (invalid JSON, wrong shape)
  → same handling as E1.
- E3. Cookies parse but X rejects them (login wall, expired session) — surface as
  `TwitterAuthError("session rejected")`. The library typically signals this via
  thrown errors or empty timelines; the collector probes auth with a single
  cheap call (e.g. `scraper.isLoggedIn()` if exposed, otherwise
  `scraper.me()` / `getProfile(<authedHandle>)`) before iterating sources, and
  short-circuits if the probe fails.
- E4. A single user handle is invalid (404, suspended) → log `warn`, push to
  `errors[]`, continue with remaining handles. Same for an invalid list ID.
- E5. Rate-limit signal from the library (HTTP 429 or its internal equivalent)
  → log `warn`, stop fetching further sources, mark Twitter as
  `status: "completed"` with the items we got and the rate-limit message in
  `errors[]`. Do NOT mark `failed` — partial collection is the project rule.
- E6. A tweet has empty `text` (rare but possible for media-only posts) → use
  `"[media]"` as the title so the row is still rankable; keep `content` as the
  empty string. The ranker can deprioritize on its own merits.
- E7. Retweets and replies — by default the collector **drops retweets**
  (`tweet.isRetweet === true`) but **keeps replies**. Retweets dedup poorly
  (the same tweet ID can surface multiple times) and add noise. Replies are
  kept because they're often substantive in AI Twitter. Both behaviors live
  behind constants in the collector file (no settings-UI knob in MVP).
- E8. Quoted tweets (`tweet.quotedStatus`) — kept as one row for the outer tweet
  only; we don't store the inner quoted tweet separately. The quoted tweet's
  text is appended to `content` with a `\n\n> ` prefix so the ranker sees it.
- E9. `tweet.timeParsed` missing — fall back to `new Date()` and log a
  `warn` with the tweet ID. The recency-decay shortlist will then treat it
  as freshly collected.
- E10. List URL parser receives garbage (a non-URL, a profile URL, an empty
  string) → API zod validation rejects the request before persistence. The
  collector itself only sees clean numeric IDs at runtime.
- E11. Same tweet appears via both a user timeline and a list it's a member of
  → `externalId` collision on `(sourceType, externalId)` unique constraint;
  `upsertItems` handles it (existing repo behavior). The `metadata.twitter.origin`
  reflects whichever source wrote first; this is acceptable — both origins are
  truthful, and downstream consumers don't switch on origin.

## Key Insights

- The Twitter `SourceType` is already in the schema, so the only DB change is
  a new nullable jsonb column `twitter_config` on `user_settings`. That's a single
  Drizzle-Kit migration with no backfill — every existing row is `null` (disabled).
- The library's `Tweet` shape is rich enough to populate every `RawItemInsert`
  field directly. We don't need a second HTTP fetch for media/profile metadata.
- Cookie-only auth means the worker never knows the password and can't be
  social-engineered into entering one. Rotation is a single env-var change +
  pipeline restart, which fits the existing deploy story.
- The "URL or ID" parser belongs in the **API zod schema**, not the collector.
  The collector should always see canonical numeric IDs at runtime; persisting
  raw URLs would make the runtime contract fuzzier and force every downstream
  consumer to re-parse.

## Architectural Challenges

- **Auth probe placement.** Probing on every collector run wastes a request, but
  not probing means we discover bad cookies via the first `getTweets` call which
  could mask the cause. Decision: probe once at the start of `collectTwitter()`
  via the cheapest available method on the library; if it fails, fail the source
  with a clear `TwitterAuthError`.
- **Source-state typing.** `RunState.sources` currently has hardcoded
  `hn`/`reddit`/`blog` keys. Adding `twitter` requires widening that union in
  `@newsletter/shared/types/run.ts` and updating any frontend code that switches
  over those keys. (`web` source today already uses the `blog` key — we keep
  that, and add a new `twitter` key.) This is the only intrusive type change.
- **Settings UI shape parity.** HN/Reddit/Web each have their own component in
  `packages/web/src/components/settings/`. Twitter follows the same pattern with a
  new component, kept on parity (header, enable toggle, list editors,
  numeric inputs). Zero new abstractions — three similar config blocks is fine.
- **Configurability vs lock-in.** `agent-twitter-client` is a single point of
  failure (X breaks the lib regularly). The collector wraps it behind a thin
  internal `TwitterClient` interface (the methods we actually call: `setCookies`,
  `getTweets`, `fetchListTweets`, `me` or equivalent). Tests mock `TwitterClient`,
  not the library. Swapping libs later is a one-file change.

## Approaches Considered

### A. Direct library calls in `collectTwitter()` (chosen)

A single function that constructs `Scraper`, calls `setCookies(parsed)`, probes
auth, loops over users and lists with a rate-limit delay, and maps each tweet
to `RawItemInsert`. Mirror of `collectReddit()` / `collectWeb()`.

- ✅ Smallest amount of new code; matches existing collector pattern exactly.
- ✅ One Scraper instance per run satisfies NF2 cleanly.
- ❌ Tight coupling to the library shape. Mitigated by keeping the library
  surface inside one file behind a narrow `TwitterClient` interface used only
  for testing.

### B. Separate `TwitterClient` service in `services/twitter-client.ts`

Move the library construction + cookie setup + auth probe into a shared service
class, called by `collectTwitter()` and reusable by future code (e.g. a
single-tweet add-post fetcher).

- ✅ Cleaner separation; single place for cookie management.
- ❌ Premature — only one caller today. Per project rules ("Three similar lines
  of code is better than a premature abstraction"), defer until a second caller
  exists. The single-tweet add-post path is not in scope for this PR.

### C. Browser-driven scrape via Crawlee + Playwright (already used for web collector)

Drive `x.com` directly with Crawlee, intercept the internal GraphQL endpoints,
parse JSON.

- ✅ Reuses our existing browser stack; no new dependency.
- ✅ More resilient to library breakage.
- ❌ ~5–10× more code. We'd be reimplementing every endpoint
  `agent-twitter-client` already encodes (UserTweets, ListLatestTweetsTimeline,
  TweetDetail) ourselves. Out of scope for the MVP.
- ❌ Real browser sessions are heavier per request and more conspicuous to X's
  anti-bot heuristics; for one daily run that's fine but it's not free.

**Decision: Approach A.** Approach C remains a documented fallback if the library
falls behind X changes faster than we can update it.

## Chosen Approach: High-Level Design

### Module layout

```
packages/pipeline/src/collectors/twitter.ts        — collectTwitter() + helpers (single file, like reddit.ts)
packages/pipeline/src/types.ts                     — extend with TwitterCollectConfig
packages/shared/src/types/run.ts                   — add RunSubmitTwitterConfig
packages/shared/src/types/index.ts                 — extend RawItemMetadata.twitter (optional)
packages/shared/src/types/run.ts                   — extend RunState.sources with twitter key
packages/shared/src/db/schema.ts                   — add twitter_config jsonb column to user_settings
packages/shared/src/db/migrations/00XX_twitter_config.sql  — generated by drizzle-kit
packages/api/src/lib/validate.ts                   — add twitterConfigSchema + URL→ID parser
packages/api/src/routes/settings.ts                — already accepts whatever validate.ts allows; no changes
packages/web/src/pages/settingsSchema.ts           — add twitterConfigSchema mirroring API schema
packages/web/src/components/settings/TwitterSourceCard.tsx  — new component, same shape as HN/Reddit cards
packages/web/src/pages/SettingsPage.tsx            — render the new card
packages/pipeline/src/workers/run-process.ts       — dispatch collectTwitter when twitterConfig is non-null
packages/pipeline/src/services/run-state.ts        — accept twitter as a valid source key (typing only)
.env.example                                       — TWITTER_COOKIES_JSON=
```

No new package. The `agent-twitter-client` dependency is added to
`@newsletter/pipeline` only. The web and API packages never touch it.

### Data flow

```
[admin UI: /admin/settings]
    |  PUT /api/settings { twitterConfig: { enabled, users[], listInputs[], maxPerSource, sinceDays } }
    v
[api/routes/settings] -> validate.ts (zod):
    - parse listInputs[] (URL or ID) -> canonical listIds[]
    - reject empties, malformed
    v
[user_settings.twitter_config jsonb]   ----> read by handleDailyRunJob / run submit
    v
[run-process worker]
    if twitterConfig !== null:
       sources.twitter = { status: "running", itemsFetched: 0, errors: [] }
       collectTwitter({ rawItemsRepo, signal }, twitterConfig) ----> Promise.allSettled
    v
[collector: twitter.ts]
    1. Read TWITTER_COOKIES_JSON; parse; if missing -> TwitterAuthError -> source failed.
    2. const scraper = new Scraper(); await scraper.setCookies(cookies)
    3. Auth probe (cheapest method available); fail source if rejected.
    4. For each handle in users[]:
         tweets = await scraper.getTweets(handle, maxPerSource)
         items.push(...tweets.map(toRawItem(handle, "user")))
         await delay(RATE_LIMIT_MS, signal)
       For each id in listIds[]:
         tweets = await scraper.fetchListTweets(id, maxPerSource)
         items.push(...tweets.map(toRawItem(id, "list")))
         await delay(RATE_LIMIT_MS, signal)
    5. Filter by sinceDays (publishedAt cutoff), drop retweets, keep replies.
    6. await rawItemsRepo.upsertItems(items)
    7. Return CollectorResult.
    v
[dedup, shortlist, rank — unchanged]
    v
[review UI / archive — unchanged; tweets show as sourceType="twitter" with imageUrl]
```

### RawItem mapping

| RawItemInsert field | Source on `Tweet`              | Notes                                                                 |
|---------------------|--------------------------------|-----------------------------------------------------------------------|
| `sourceType`        | constant `"twitter"`           | Always.                                                               |
| `externalId`        | `tweet.id`                     | Canonical tweet ID. Same value regardless of origin.                  |
| `title`             | `tweet.text` truncated to 200  | Twitter has no title; truncate with `…` if longer (reserve 1 char).   |
| `url`               | `tweet.permanentUrl`           | Falls back to `https://x.com/${tweet.username}/status/${tweet.id}` if missing. |
| `sourceUrl`         | `tweet.permanentUrl`           | Same as `url` — kept for parity with other collectors.                |
| `author`            | `tweet.username`               | Bare handle, no `@`.                                                  |
| `content`           | `tweet.text` (+ quoted text)   | If `quotedStatus`, append `\n\n> ${quotedStatus.text}`.               |
| `publishedAt`       | `tweet.timeParsed ?? new Date()` | Warn if missing; never null.                                        |
| `collectedAt`       | `new Date()`                   | Set at upsert time.                                                   |
| `engagement`        | `{ points: tweet.likes ?? 0, commentCount: tweet.replies ?? 0 }` | Mirrors Reddit/HN shape.                                              |
| `metadata`          | `{ comments: [], twitter: { origin, retweets, views, name, isReply } }` | See "Metadata extension".                                             |
| `imageUrl`          | `tweet.photos[0]?.url ?? null` | Videos/GIFs ignored for the image plate.                              |
| `updatedAt`         | `new Date()`                   |                                                                       |

### Metadata extension

`RawItemMetadata` (in `@newsletter/shared/types/index.ts`) gains an optional
`twitter` field:

```ts
interface RawItemTwitterMetadata {
  origin: { kind: "user"; handle: string } | { kind: "list"; listId: string };
  retweetCount: number;        // tweet.retweets
  viewCount: number | null;    // tweet.views (null if not provided)
  displayName: string | null;  // tweet.name
  isReply: boolean;            // tweet.isReply
}
interface RawItemMetadata {
  comments: RawItemComment[];   // existing
  recap?: RecapContent;         // existing
  twitter?: RawItemTwitterMetadata;  // new, optional
}
```

The field is strictly additive. Existing rows have no `twitter` key; consumers
that don't know about it ignore it.

### Config schema diff

**New shared type** in `packages/shared/src/types/run.ts`:

```ts
export interface RunSubmitTwitterConfig {
  users: string[];      // bare handles, no @
  listIds: string[];    // canonical numeric IDs (already parsed by API)
  maxPerSource: number; // 1..200
  sinceDays: number;    // 1..30
}

export interface RunSubmitPayload {
  topN: number;
  hn?: RunSubmitHnConfig;
  reddit?: RunSubmitRedditConfig;
  web?: RunSubmitWebConfig;
  twitter?: RunSubmitTwitterConfig;  // new
}
```

**`UserSettings`** in `@newsletter/shared/types/settings.ts` gains
`twitterConfig: RunSubmitTwitterConfig | null`.

**Schema migration** (`packages/shared/src/db/schema.ts`):

```ts
twitterConfig: jsonb("twitter_config").$type<RunSubmitTwitterConfig | null>(),
```

Generated migration is a single `ALTER TABLE user_settings ADD COLUMN twitter_config jsonb`.

**Pipeline-internal collector config** (`packages/pipeline/src/types.ts`):

```ts
export interface TwitterCollectConfig {
  users: string[];
  listIds: string[];
  maxPerSource: number;
  sinceDays: number;
}
```

This is structurally identical to `RunSubmitTwitterConfig`. Following the
existing pattern (Reddit's `RedditCollectConfig` mirrors `RunSubmitRedditConfig`),
they live in different packages because the wire shape and the collector input
shape are separate concerns.

### Env / auth handling

**.env.example** gains:

```
# Optional. JSON-encoded array of cookies exported from a logged-in burner X account
# (use the EditThisCookie extension or the browser devtools Application tab).
# When set AND the Twitter source is enabled in settings, the pipeline will fetch
# tweets and lists. Empty string or unset disables the Twitter source even if
# settings have it enabled.
TWITTER_COOKIES_JSON=
```

**Validation flow** (in `collectTwitter()`):

1. `process.env.TWITTER_COOKIES_JSON` — if missing or empty, throw
   `TwitterAuthError("TWITTER_COOKIES_JSON not set")`.
2. `JSON.parse` the string — if it throws, wrap in `TwitterAuthError("invalid TWITTER_COOKIES_JSON: <reason>")`.
3. Validate the parsed value is an array of objects with at least `name`/`value`
   (and optionally `domain`, `path`, `expires`, `httpOnly`, `secure`, `sameSite`).
   If shape check fails, `TwitterAuthError("invalid cookie shape")`.
4. `await scraper.setCookies(parsed)`.
5. Auth probe — call the cheapest "am I logged in?" method the library exposes.
   If it returns false or throws, `TwitterAuthError("session rejected")`.

**Failure surfacing:** `collectTwitter()` catches `TwitterAuthError` at the top
level and returns `CollectorResult` with `itemsFetched: 0, itemsStored: 0` AND
sets `sources.twitter.status = "failed"` plus `errors.push(error.message)` via
the run-state service. The error is also logged at `error` level. Other collectors
keep running (existing `Promise.allSettled` behavior).

### Error classes

In `packages/pipeline/src/collectors/twitter.ts`:

```ts
export class TwitterAuthError extends Error { /* cookie missing / invalid / rejected */ }
export class TwitterRateLimitError extends Error { /* 429 or library-internal rate-limit signal */ }
export class TwitterFetchError extends Error { /* anything else from the library */ }
```

Handling:

| Error                  | Effect on Twitter source                               | Effect on overall run |
|------------------------|--------------------------------------------------------|------------------------|
| `TwitterAuthError`     | `failed`, no items, message in `errors[]`              | run continues          |
| `TwitterRateLimitError`| `completed` with partial items, message in `errors[]`  | run continues          |
| `TwitterFetchError`    | per-source: log `warn`, push to `errors[]`, continue   | run continues          |
| Unexpected throw       | bubble up; `Promise.allSettled` traps it; source `failed` | run continues          |

### Settings UI

A new card component on `/admin/settings` in the same row as HN/Reddit/Web:

```
┌──────────────────────────────────────────────┐
│  Twitter / X                       [enabled] │  <- toggle drives null vs object
├──────────────────────────────────────────────┤
│  Usernames                                   │
│  [ openai      ] [ AnthropicAI ] [ + add ]   │  <- chip-style add/remove like HN keywords
│                                              │
│  Lists (paste URL or ID)                     │
│  [ https://x.com/i/lists/12345 ] [ + add ]   │  <- one input, parser canonicalises to ID
│                                              │
│  Max per source: [ 50 ▾ ]                    │
│  Since (days):   [ 1  ▾ ]                    │
│                                              │
│  ⚠ Requires TWITTER_COOKIES_JSON env var.    │
└──────────────────────────────────────────────┘
```

The "Requires TWITTER_COOKIES_JSON" notice is static UI copy — the frontend
does not actually probe the env on the API side just to show a banner; we
keep the trust boundary clean. A failed run with a clear "TWITTER_COOKIES_JSON
not set" error in `sources.twitter.errors[]` is the operational signal.

### List input parser

In `packages/api/src/lib/validate.ts`:

```ts
function parseListInput(value: string): string {
  const trimmed = value.trim();
  // Already a numeric ID
  if (/^\d{6,}$/.test(trimmed)) return trimmed;
  // URL form: https://(x|twitter).com/i/lists/<id>(?...)
  let u: URL;
  try { u = new URL(trimmed); } catch { throw new Error(`invalid list input: ${value}`); }
  if (u.hostname !== "x.com" && u.hostname !== "twitter.com" &&
      u.hostname !== "www.x.com" && u.hostname !== "www.twitter.com") {
    throw new Error(`unrecognised host: ${u.hostname}`);
  }
  const parts = u.pathname.split("/").filter(Boolean);
  // /i/lists/<id> OR /<handle>/lists/<slug>/<id>? — we accept the canonical /i/lists/<id> form only
  const idx = parts.indexOf("lists");
  if (idx === -1 || !parts[idx + 1]) throw new Error(`no list id in URL: ${trimmed}`);
  const id = parts[idx + 1];
  if (!/^\d{6,}$/.test(id)) throw new Error(`list id is not numeric: ${id}`);
  return id;
}
```

Mirrored as a zod `.transform()` so the persisted shape is canonical.

### RunState typing

Currently:

```ts
sources: {
  hn?: SourceRunState;
  reddit?: SourceRunState;
  blog?: SourceRunState;
};
```

Extended to:

```ts
sources: {
  hn?: SourceRunState;
  reddit?: SourceRunState;
  blog?: SourceRunState;
  twitter?: SourceRunState;
};
```

This is a non-breaking widening. Any frontend `switch (key)` over source keys
needs a new branch (likely a `getSourceLabel` helper); the planner audits
those touch points.

## Open Questions (deferred to planning / coding)

1. **Exact npm package name and version.** The user named the GitHub fork
   `TreasureProject/twitter-scraper-v2`; the planner verifies whether to install
   that fork directly (via git URL or a fork-published tag) or the canonical
   `agent-twitter-client` package. Pin exact (`"x.y.z"`, not `"^x.y.z"`).
2. **Auth probe method.** The library exposes either `me()`, `getProfile()`, or
   an `isLoggedIn()` boolean. Planner picks the cheapest call that doesn't burn
   a per-account rate-limit quota.
3. **Single-tweet add-post flow.** Out of scope for this PR. The existing
   `add-post-helper.ts` doesn't dispatch on `sourceType="twitter"`. Mention in
   the spec as "future" so reviewers don't expect it.
4. **Daily run scheduler integration.** `reconcileDailyRunSchedule()` reads
   `userSettings`. No code change should be needed beyond the type widening,
   but planner should confirm the daily-run handler reads `twitterConfig` and
   forwards it into the `RunSubmitPayload`.

## Risks and Mitigations

| Risk                                                   | Mitigation                                                                                          |
|--------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| `agent-twitter-client` breaks against X within a month | Library surface stays inside one file behind a narrow `TwitterClient` interface; swap is isolated. |
| Burner account gets banned                             | Cookie rotation = update env + restart. Document the rotation procedure in `.env.example` comments. |
| Rate-limit signal not surfaced cleanly by library      | Conservative 1 s delay; on any thrown error after first source succeeds, mark partial completion.   |
| Quoted-tweet text inflates `content` past 1MB row size | Tweets are bounded ~280 chars × ~10 nesting levels; orders of magnitude under the limit.            |
| Same tweet via user + list inflates `itemsFetched` count | The metric counts pre-dedup fetches; storage dedups via the unique constraint. Document this.       |
| Drizzle migration on prod requires downtime            | `ADD COLUMN ... DEFAULT NULL` is online in PostgreSQL. No backfill needed.                         |

## Assumptions

1. The existing `Promise.allSettled` orchestrator handles a Twitter source the
   same way it handles others — the planner verifies in `run-process.ts`.
2. The web settings page is the only place users edit collector configs (no
   API-only flow, no env-var-only flow). Confirmed by reading
   `packages/web/src/pages/SettingsPage.tsx` ↔ `settingsSchema.ts`.
3. The dashboard's per-source status panel renders any source key it sees in
   `RunState.sources` without hardcoding a fixed list. Planner verifies — if
   it does hardcode, planner adds the new key in the per-source rendering map.
4. The `agent-twitter-client` package's TypeScript declarations are good enough
   that we don't need to write a `*.d.ts` shim. Planner confirms during phase 1
   (adding the dep) — if types are missing, the planner adds a minimal
   `types/agent-twitter-client.d.ts` rather than `any`-casting.
5. No outbound writes — we never tweet, like, or follow anything from the worker.
   The collector reads only.

## Out of Scope

- Single-tweet add-post (manual URL → row) flow.
- Twitter video/GIF thumbnails.
- Reply thread fetching (we don't fetch replies under a tweet).
- Account pool, proxy pool, or 2FA-driven login.
- Cookie storage in the DB or admin-UI cookie paste form (deferred; env var only).
- Linear ticketing automation — the planner files VER-XX manually.
