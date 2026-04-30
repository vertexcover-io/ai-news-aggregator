# SPEC: Twitter Collector

**Source:** `docs/plans/2026-04-30-twitter-collector-design.md`
**Generated:** 2026-04-30
**Linear:** TBD (file under VER- newsletter project)

## Requirements

### Collector behavior

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Ubiquitous | The pipeline shall expose a `collectTwitter()` function in `packages/pipeline/src/collectors/twitter.ts` matching the `(deps, config) => Promise<CollectorResult>` signature used by other collectors. | Function is exported; deps shape is `{ rawItemsRepo, fetchFn?, signal? }`; passes `newsletter/collector-return-shape` lint. | Must |
| REQ-002 | Event-driven | When `collectTwitter()` is invoked with `users.length + listIds.length > 0`, the collector shall instantiate one `Scraper` instance, call `setCookies(parsed)` once, and reuse it across all source iterations. | A test that injects a mock client asserts the constructor and `setCookies` were each called exactly once for a config with multiple users and lists. | Must |
| REQ-003 | Event-driven | When iterating over `config.users[]`, the collector shall call `getTweets(handle, config.maxPerSource)` for each handle in declared order. | Mock-client test asserts call sequence and arguments; order matches input order. | Must |
| REQ-004 | Event-driven | When iterating over `config.listIds[]`, the collector shall call `fetchListTweets(listId, config.maxPerSource)` for each list in declared order. | Mock-client test asserts call sequence and arguments. | Must |
| REQ-005 | Ubiquitous | Between any two consecutive Twitter API calls within a single `collectTwitter()` run, the collector shall delay at least 1000 ms. | Test using fake timers asserts `delay(1000, signal)` is called between every pair of source iterations and not after the final one. | Must |
| REQ-006 | Ubiquitous | The collector shall map each library `Tweet` object to one `RawItemInsert` with `sourceType="twitter"`, `externalId=tweet.id`, `url=tweet.permanentUrl ?? https://x.com/${tweet.username}/status/${tweet.id}`, `author=tweet.username`, `content=tweet.text` (with quoted text appended as documented), `publishedAt=tweet.timeParsed ?? new Date()`, `engagement={points: tweet.likes ?? 0, commentCount: tweet.replies ?? 0}`, and `imageUrl=tweet.photos[0]?.url ?? null`. | Mapping unit test feeds a fully-populated `Tweet` fixture and asserts every field is correct; another test feeds a sparse `Tweet` and asserts the documented fallbacks. | Must |
| REQ-007 | Ubiquitous | The collector shall set `RawItemInsert.title` to the first 200 characters of `tweet.text`, suffixed with `…` (single character) if and only if the original text exceeds 200 characters; total title length shall never exceed 200 characters. | Unit test with a 201-char text asserts `title.length === 200` and ends with `…`; with a 200-char text asserts no suffix; with a 50-char text asserts unchanged. | Must |
| REQ-008 | Event-driven | When a tweet has `quotedStatus !== undefined`, the collector shall set `content` to `${tweet.text}\n\n> ${quotedStatus.text}`. | Unit test with quoted-tweet fixture asserts the exact concatenation. | Must |
| REQ-009 | State-driven | While iterating sources, the collector shall populate `metadata.twitter` on each item with `{ origin: { kind, handle?, listId? }, retweetCount, viewCount, displayName, isReply }`, where `origin.kind` is `"user"` for items from `getTweets()` and `"list"` for items from `fetchListTweets()`. | Mapping test asserts `origin.kind === "user"` and `origin.handle` is set for user-fetched items, and `origin.kind === "list"` with `origin.listId` set for list-fetched items. | Must |
| REQ-010 | Ubiquitous | The collector shall drop items where `tweet.isRetweet === true` from the result. | Unit test with a fixture containing 3 tweets (1 retweet, 2 originals) asserts `itemsFetched === 2` and the retweet's id is absent from the upserted set. | Must |
| REQ-011 | Ubiquitous | The collector shall keep items where `tweet.isReply === true`. | Unit test with a reply fixture asserts the item is included in the upserted set. | Must |
| REQ-012 | Event-driven | When `config.sinceDays > 0`, the collector shall drop items whose `publishedAt` is older than `Date.now() - sinceDays * 86_400_000`. | Time-frozen test with two fixtures (1 inside, 1 outside the window) asserts only the inside one is upserted. | Must |
| REQ-013 | Ubiquitous | After mapping and filtering, the collector shall call `rawItemsRepo.upsertItems(items)` exactly once when `items.length > 0` and not at all when `items.length === 0`. | Repo-mock test asserts the call count under both conditions. | Must |
| REQ-014 | Ubiquitous | The collector shall return a `CollectorResult` whose `itemsFetched` equals the count of post-filter (sinceDays + retweet drop) items, `itemsStored` equals the same count when upsert succeeded (`0` if `items.length === 0` and no upsert was called), `commentsFetched` equals `0`, and `durationMs` is a non-negative integer. | Unit test asserts all four fields match expected values. | Must |

### Authentication and cookies

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-020 | Unwanted | If `process.env.TWITTER_COOKIES_JSON` is `undefined` or the empty string, then `collectTwitter()` shall throw a `TwitterAuthError` with message starting `"TWITTER_COOKIES_JSON not set"` before making any network call. | Test with env unset asserts the throw, asserts `Scraper` was never constructed, and asserts the message prefix. | Must |
| REQ-021 | Unwanted | If `TWITTER_COOKIES_JSON` is non-empty but `JSON.parse` throws, then `collectTwitter()` shall throw a `TwitterAuthError` with message starting `"invalid TWITTER_COOKIES_JSON:"` before making any network call. | Test with malformed JSON asserts the throw and prefix. | Must |
| REQ-022 | Unwanted | If `TWITTER_COOKIES_JSON` parses but the result is not an array of objects each containing string `name` and `value` fields, then `collectTwitter()` shall throw a `TwitterAuthError` with message `"invalid cookie shape"`. | Test with array-of-strings fixture and another with object-without-name asserts both throw the exact message. | Must |
| REQ-023 | Event-driven | When cookies parse and shape-validate, the collector shall call `scraper.setCookies(parsed)` exactly once before any tweet-fetch call. | Mock-client test asserts call order: `setCookies` precedes the first `getTweets`/`fetchListTweets`. | Must |
| REQ-024 | Event-driven | When `setCookies` resolves, the collector shall perform an authentication probe (`scraper.isLoggedIn()` if available, otherwise the cheapest equivalent) before iterating sources. | Mock-client test asserts the probe call occurs and precedes any `getTweets`/`fetchListTweets`. | Must |
| REQ-025 | Unwanted | If the authentication probe returns `false` or throws, then `collectTwitter()` shall throw a `TwitterAuthError` with message starting `"session rejected"` and shall not call any per-source fetch method. | Mock-client test asserts the throw and prefix and asserts `getTweets`/`fetchListTweets` were never called. | Must |

### Configuration and persistence

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-030 | Ubiquitous | The shared package shall export an `RunSubmitTwitterConfig` interface with fields `users: string[]`, `listIds: string[]`, `maxPerSource: number`, `sinceDays: number`. | TypeScript compiles a downstream usage importing the type from `@newsletter/shared`. | Must |
| REQ-031 | Ubiquitous | The `RunSubmitPayload` interface shall add an optional `twitter?: RunSubmitTwitterConfig` field, leaving existing fields unchanged. | TypeScript test of `satisfies RunSubmitPayload` with and without the field passes. | Must |
| REQ-032 | Ubiquitous | The `UserSettings` interface shall add a `twitterConfig: RunSubmitTwitterConfig \| null` field. | TypeScript compile of a UserSettings literal asserts the field is required (non-optional) and accepts `null`. | Must |
| REQ-033 | Ubiquitous | The `user_settings` Drizzle table shall add a nullable `twitter_config` jsonb column with no default. | Drizzle-Kit-generated migration file exists in `packages/shared/src/db/migrations/`, the snapshot reflects the column, and `pnpm --filter @newsletter/shared db:migrate` against a fresh DB succeeds. | Must |
| REQ-034 | Ubiquitous | The `RawItemMetadata` type shall accept an optional `twitter` field of shape `{ origin: { kind: "user"; handle: string } \| { kind: "list"; listId: string }, retweetCount: number, viewCount: number \| null, displayName: string \| null, isReply: boolean }`. | TypeScript compile of a RawItem with the field passes; another without it also passes. | Must |
| REQ-035 | Ubiquitous | The `RunState.sources` object shall add an optional `twitter?: SourceRunState` key. | TypeScript test asserts setting and reading the key works. | Must |

### API validation and parsing

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-040 | Ubiquitous | The API zod schema for settings shall validate `twitterConfig` as an object containing the four required fields, or `null`. | Zod-schema test with a valid object passes; with `null` passes; with `undefined`-instead-of-null fails. | Must |
| REQ-041 | Ubiquitous | The API zod schema shall enforce `maxPerSource` is an integer in `[1, 200]` and `sinceDays` is an integer in `[1, 30]`. | Boundary tests at 0, 1, 200, 201 for `maxPerSource` and 0, 1, 30, 31 for `sinceDays` pass/fail as specified. | Must |
| REQ-042 | Ubiquitous | The API shall accept each list input either as a numeric string of 6 or more digits, or as a URL whose hostname is one of `x.com`, `www.x.com`, `twitter.com`, `www.twitter.com` and whose path contains `/lists/<numeric-id>`, and shall persist only the canonical numeric id. | Tests with each input form assert persisted value equals the numeric id. | Must |
| REQ-043 | Unwanted | If a list input is neither a numeric string nor a recognised list URL, then the zod schema shall reject the request with HTTP 400 before persistence. | Negative test with garbage strings asserts 400 response and no DB write. | Must |
| REQ-044 | Ubiquitous | The API shall trim whitespace from each user handle and lowercase it, persisting the canonical form (no `@` prefix, lowercase). | Test with `"  @OpenAI "` persists as `"openai"`. | Must |

### Run-state, dispatch and reporting

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-050 | Event-driven | When `handleRunProcessJob` runs and the active payload contains a non-null `twitter` config, the worker shall dispatch `collectTwitter()` inside the same `Promise.allSettled` group as other collectors. | Worker unit test asserts the call happens for a payload with twitter config and does not happen when the field is absent. | Must |
| REQ-051 | Event-driven | When dispatch begins for the Twitter source, the run-state service shall set `sources.twitter = { status: "running", itemsFetched: 0, errors: [] }` before the collector runs. | Run-state test inspects the redis-backed state during dispatch. | Must |
| REQ-052 | Event-driven | When `collectTwitter()` resolves successfully, the run-state service shall update `sources.twitter.status` to `"completed"` and `itemsFetched` to the returned count. | Integration test asserts the final state. | Must |
| REQ-053 | Unwanted | If `collectTwitter()` throws a `TwitterAuthError`, then the run-state service shall set `sources.twitter.status = "failed"` and append the error message to `sources.twitter.errors[]`. | Integration test with mock collector that throws asserts the final state. | Must |
| REQ-054 | Unwanted | If `collectTwitter()` throws a `TwitterRateLimitError` after fetching at least one item, then the source shall be marked `"completed"` (partial) and the message appended to `errors[]`. | Test with a mock that fetches once then throws rate-limit asserts state. | Must |
| REQ-055 | Ubiquitous | A failure of the Twitter source shall not terminate the run; other configured collectors shall still be awaited and their results stored. | Integration test asserting that a Twitter throw plus a successful HN config still produces HN items in `raw_items`. | Must |

### UI surfacing

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-060 | Ubiquitous | The settings page shall render a Twitter source card with: an enable toggle, a multi-entry editor for `users`, a multi-entry editor for `listInputs` (URL or ID accepted), numeric inputs for `maxPerSource` and `sinceDays`, and a static notice "Requires TWITTER_COOKIES_JSON env var." | React component test mounts SettingsPage with seeded settings and asserts all six elements are present. | Must |
| REQ-061 | Event-driven | When the operator toggles the Twitter card off, the form's `twitterConfig` value shall become `null` and persist as `null` on save. | RTL test simulates toggle, submit; mock API client receives `twitterConfig: null`. | Must |
| REQ-062 | Event-driven | When the operator submits a settings change with a valid Twitter config, the typed API client shall PUT to `/api/settings` and the response shall reflect the saved values. | RTL test with mock fetch asserts request body and that the form re-renders with persisted values. | Must |
| ~~REQ-063~~ | ~~Ubiquitous~~ | ~~The dashboard's per-run source-status panel shall render the `twitter` source key with a label "Twitter" and the same status badge styling used for other sources.~~ | **DEFERRED** — the dashboard does not currently render a per-source status panel for any collector. Adding one is out of scope for this PR. The widened `RunState.sources.twitter` data is ready for a future per-source panel that surfaces all collectors uniformly. | ~~Must~~ Deferred |
| REQ-064 | Ubiquitous | Items with `sourceType="twitter"` shall render in the archive listing and detail views with `imageUrl` rendered in the image plate when non-null, identical to other source types. | Snapshot or RTL test with a Twitter item fixture asserts the image renders. | Should |

### Operational

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-070 | Ubiquitous | `.env.example` shall include a `TWITTER_COOKIES_JSON=` entry with a comment explaining what it is and how to obtain it. | File diff includes the entry. | Must |
| REQ-071 | Ubiquitous | The Twitter library dependency shall be added only to `packages/pipeline/package.json` and pinned exactly (no `^` or `~`). | `grep` in `package.json` confirms exact version; `pnpm install` resolves cleanly. | Must |
| REQ-072 | Ubiquitous | The library shall not be imported from `@newsletter/api` or `@newsletter/web`. | ESLint passes with `no-restricted-imports` configured to forbid the package outside `@newsletter/pipeline`. | Should |
| REQ-073 | Ubiquitous | All `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm build` shall pass at the end of implementation. | CI commands return exit 0. | Must |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | Both `users[]` and `listIds[]` are empty arrays | `collectTwitter()` returns `{ itemsFetched: 0, itemsStored: 0, commentsFetched: 0, durationMs: <n> }` and never instantiates the Scraper. | REQ-001, REQ-002 |
| EDGE-002 | Same tweet appears via a user timeline and a list it's a member of | The unique constraint on `(sourceType, externalId)` prevents duplicate rows; `upsertItems` updates the single row; `itemsFetched` counts pre-dedup, `itemsStored` may equal `itemsFetched`. | REQ-013, REQ-006 |
| EDGE-003 | A user handle returns a 404 / suspended | The error is logged at `warn`, pushed to `sources.twitter.errors[]`, and iteration continues to the next source. | REQ-053, REQ-055 |
| EDGE-004 | A list ID returns a 404 / private | Same as EDGE-003. | REQ-053, REQ-055 |
| EDGE-005 | Tweet has `text === ""` (media-only post) | `title` becomes `"[media]"`, `content` is the empty string, the row is upserted. | REQ-006, REQ-007 |
| EDGE-006 | Tweet has `timeParsed === undefined` | `publishedAt` falls back to `new Date()` and a `warn` log includes the tweet ID. | REQ-006 |
| EDGE-007 | Tweet has photos but only videos/GIFs (no still photos) | `imageUrl` is `null`. | REQ-006 |
| EDGE-008 | Tweet has multiple photos | Only `photos[0].url` is used; remaining photos are ignored. | REQ-006 |
| EDGE-009 | Quoted tweet text exceeds combined-content sanity (very long thread) | Concatenation proceeds without truncation; `content` field accepts the full text (no length cap in this PR). | REQ-008 |
| EDGE-010 | `AbortSignal.aborted === true` between sources | The collector exits the loop without further fetches and returns whatever was already upserted. | REQ-001, REQ-005 |
| EDGE-011 | List input is `"https://twitter.com/jack/lists/tech-leaders/123456789"` | Zod parser extracts `123456789` from the path's `lists` segment. | REQ-042 |
| EDGE-012 | List input is `"@123456789"` (with stray prefix) | Zod parser rejects with HTTP 400. | REQ-043 |
| EDGE-013 | Cookie array contains expired cookies that X rejects on probe | `TwitterAuthError("session rejected")` is thrown; source marked failed. | REQ-025 |
| EDGE-014 | Cookie object includes optional fields (`domain`, `path`, `expires`, etc.) | They are forwarded to `setCookies` unchanged; shape validation only requires `name` and `value`. | REQ-022, REQ-023 |
| EDGE-015 | `TWITTER_COOKIES_JSON` is a JSON object instead of an array | `TwitterAuthError("invalid cookie shape")` is thrown. | REQ-022 |
| EDGE-016 | `getTweets` returns an iterable/async iterable instead of an array (depends on library version) | The collector consumes it fully into an array before mapping. | REQ-003, REQ-006 |
| EDGE-017 | `tweet.id` is missing (corrupt library response) | The item is dropped from results and a `warn` log is emitted; processing continues. | REQ-006 |
| EDGE-018 | Twitter source enabled in settings but `TWITTER_COOKIES_JSON` is unset at run time | Run still completes; Twitter source `failed` with the documented error message; other sources unaffected. | REQ-020, REQ-053, REQ-055 |
| EDGE-019 | Settings UI receives an existing `twitterConfig` from the API | Form hydrates all fields correctly and "Save" without changes is a no-op. | REQ-060 |
| EDGE-020 | Two settings PUTs race | Last-write-wins on the singleton row; no special handling required. | REQ-040 |

## Verification Matrix

| REQ ID | Unit Test | Integration Test | E2E Test | Manual Test | Notes |
|--------|-----------|-----------------|----------|-------------|-------|
| REQ-001 | Yes | No | No | No | Lint rule asserts shape; export check is type-only. |
| REQ-002 | Yes | No | No | No | Mock client. |
| REQ-003 | Yes | No | No | No | Mock client; assert call sequence. |
| REQ-004 | Yes | No | No | No | Mock client. |
| REQ-005 | Yes | No | No | No | Fake timers (vitest). |
| REQ-006 | Yes | No | No | No | Mapping fixtures. |
| REQ-007 | Yes | No | No | No | Boundary tests at 199/200/201. |
| REQ-008 | Yes | No | No | No | Quoted-tweet fixture. |
| REQ-009 | Yes | No | No | No | Both `kind` paths. |
| REQ-010 | Yes | No | No | No | Mixed fixture. |
| REQ-011 | Yes | No | No | No | Reply fixture. |
| REQ-012 | Yes | No | No | No | Frozen-time fixture. |
| REQ-013 | Yes | No | No | No | Repo mock. |
| REQ-014 | Yes | No | No | No | |
| REQ-020 | Yes | No | No | No | Env stubbing. |
| REQ-021 | Yes | No | No | No | |
| REQ-022 | Yes | No | No | No | |
| REQ-023 | Yes | No | No | No | |
| REQ-024 | Yes | No | No | No | |
| REQ-025 | Yes | No | No | No | |
| REQ-030 | Yes | No | No | No | TS-compile-only. |
| REQ-031 | Yes | No | No | No | TS-compile-only. |
| REQ-032 | Yes | No | No | No | TS-compile-only. |
| REQ-033 | No | Yes | No | Yes | Run drizzle migrate against fresh DB; verify column. |
| REQ-034 | Yes | No | No | No | TS-compile-only. |
| REQ-035 | Yes | No | No | No | TS-compile-only. |
| REQ-040 | Yes | No | No | No | Zod schema test in api package. |
| REQ-041 | Yes | No | No | No | |
| REQ-042 | Yes | No | No | No | URL parser unit tests. |
| REQ-043 | Yes | No | No | No | |
| REQ-044 | Yes | No | No | No | |
| REQ-050 | Yes | Yes | No | No | Worker unit + run-process integration. |
| REQ-051 | No | Yes | No | No | Run-state service test. |
| REQ-052 | No | Yes | No | No | |
| REQ-053 | Yes | Yes | No | No | |
| REQ-054 | Yes | Yes | No | No | |
| REQ-055 | No | Yes | No | No | Mixed-collector run. |
| REQ-060 | Yes | No | No | No | RTL on SettingsPage. |
| REQ-061 | Yes | No | No | No | RTL. |
| REQ-062 | Yes | No | No | No | RTL with fetch mock. |
| ~~REQ-063~~ | — | — | — | — | **Deferred** — no per-source dashboard panel today; data is ready for future PR. |
| REQ-064 | Yes | No | No | No | RTL on archive views. |
| REQ-070 | No | No | No | Yes | File-presence check; manual review of comment text. |
| REQ-071 | No | No | No | Yes | `package.json` review. |
| REQ-072 | Yes | No | No | No | Lint config covers it. |
| REQ-073 | No | No | No | Yes | CI run. |
| EDGE-001 | Yes | No | No | No | |
| EDGE-002 | No | Yes | No | No | DB-backed test. |
| EDGE-003 | Yes | No | No | No | Mock client throws per source. |
| EDGE-004 | Yes | No | No | No | |
| EDGE-005 | Yes | No | No | No | |
| EDGE-006 | Yes | No | No | No | |
| EDGE-007 | Yes | No | No | No | |
| EDGE-008 | Yes | No | No | No | |
| EDGE-009 | Yes | No | No | No | |
| EDGE-010 | Yes | No | No | No | Pre-aborted signal. |
| EDGE-011 | Yes | No | No | No | URL parser. |
| EDGE-012 | Yes | No | No | No | |
| EDGE-013 | Yes | No | No | No | |
| EDGE-014 | Yes | No | No | No | |
| EDGE-015 | Yes | No | No | No | |
| EDGE-016 | Yes | No | No | No | If library returns iterable, normalize. |
| EDGE-017 | Yes | No | No | No | |
| EDGE-018 | No | Yes | No | No | Full-run integration with env unset. |
| EDGE-019 | Yes | No | No | No | RTL hydration test. |
| EDGE-020 | No | No | No | Yes | Documented behaviour; no automated coverage. |

## Verification Scenarios

When running `harness:functional-verify`, exercise the following live scenarios:

1. **Cookie auth missing** — start the pipeline with `TWITTER_COOKIES_JSON` unset and `twitterConfig` enabled in settings; trigger a run; assert the run completes with `sources.twitter.status === "failed"` and the documented error message.
2. **Settings round-trip** — open `/admin/settings`, add a user and a list URL, save, reload the page, assert the form rehydrates with the canonical numeric list ID.
3. **Mixed-collector run** — with `TWITTER_COOKIES_JSON` unset (forcing Twitter failure) and HN enabled, trigger a run; assert HN items land in `raw_items` and the run completes.

(Live verification of a successful Twitter fetch requires real cookies and is outside automated CI; the operator runs that manually post-merge.)

## Out of Scope

- Single-tweet add-post flow (the `add-post` URL → `RawItemInsert` path is not extended for `sourceType="twitter"` in this PR).
- Twitter video / GIF thumbnails for the image plate.
- Reply-thread fetching (we don't pull replies under a tweet).
- Cookie storage in the DB or admin-UI cookie paste form.
- Account pool, proxy pool, and any 2FA-driven login.
- Rate-limit account-pool failover.
- Outbound writes (tweeting, liking, following) — read-only collector.
- Embeddings or recap generation specific to tweets — handled by existing pipeline stages unchanged.
