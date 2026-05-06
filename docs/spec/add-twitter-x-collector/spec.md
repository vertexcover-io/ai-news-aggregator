# SPEC: Twitter/X Collector

**Source design:** `docs/plans/2026-05-04-twitter-collector-design.md`
**Library probe:** `docs/spec/add-twitter-x-collector/library-probe.md` (PASS — `rettiwt-api@7.0.3` user-auth)
**Generated:** 2026-05-04

---

## 1. Scope

A new pipeline collector — `collectTwitter` — that fetches tweets from two source types once per daily run and writes them to `raw_items` for downstream dedup/rank/recap stages. Sits beside `collectHn`, `collectReddit`, and `collectWeb`.

**Two source types, one collector, one auth:**
- **Twitter lists** by list ID, via `rettiwt.list.tweets(listId, count, cursor)` — verified in VS-0a-userauth (95 tweets, cursor pagination).
- **Individual users** by `@handle`, via `rettiwt.user.details(handle)` to resolve to numeric ID, then `rettiwt.user.timeline(userId, count, cursor)` — verified in VS-0a-user-timeline (21 tweets for `@jack`, 20 for `@sama`).

The selected library is `rettiwt-api@7.0.3` in user-authentication (`apiKey`) mode. Single `RETTIWT_API_KEY` env var (base64 cookie blob), one `Rettiwt()` instance shared between both collection paths. All four originally-probed alternatives (rettiwt guest, convocation guest, custom syndication scraper, paid Twitter API) are eliminated and recorded in the library-probe document.

---

## 2. Requirements

### 2.1 Collector behaviour

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Ubiquitous | The collector shall expose `collectTwitter(deps: TwitterCollectorDeps, config: TwitterCollectConfig): Promise<CollectorResult>` as its only public entry point. | ESLint rule `newsletter/collector-return-shape` passes; signature compiles under TypeScript strict mode. | Must |
| REQ-002 | Event-driven | When `collectTwitter` is invoked, the system shall iterate `config.listIds` sequentially and call `rettiwt.list.tweets(listId, count, cursor)` for each. | Test asserts exactly one client call per list ID, in order. | Must |
| REQ-002b | Event-driven | When `collectTwitter` is invoked, the system shall iterate `config.users` sequentially and call `rettiwt.user.timeline(user.userId, count, cursor)` for each. | Test asserts exactly one client call per user, in order. | Must |
| REQ-002c | Event-driven | When both `config.listIds` and `config.users` are non-empty, the system shall fetch lists first, then users, in a single sequential pass. | Test on a 2-lists + 2-users config asserts the expected call order. | Must |
| REQ-003 | Event-driven | When a per-source call returns, the system shall stop paginating once the accumulated count for that source reaches `config.maxTweetsPerSource`. | Stub client returns 100-tweet pages; test sets `maxTweetsPerSource=120` and asserts exactly 2 calls (one page = 100, second page truncated to 20). Same behaviour for lists and users. | Must |
| REQ-003b | Event-driven | When `user.timeline` returns no cursor (single-page response), the system shall NOT attempt further pagination for that user. | Stub user.timeline to return `{ list: [...], next: null }`; assert exactly one call. Observed empirically in VS-0a-user-timeline. | Must |
| REQ-004 | Event-driven | When `config.sinceHours` is set, the system shall stop paginating a source (list or user) once the first tweet older than `now - sinceHours` is seen. | Stub returns reverse-chronological page; test sets `sinceHours=24` and asserts paging halts at the boundary tweet. Same behaviour for lists and users. | Must |
| REQ-005 | Ubiquitous | The collector shall map each tweet to a `RawItemInsert` with `sourceType: "twitter"` and `externalId` set to the tweet's `id` (string). | Mapper unit test asserts `externalId === tweet.id`. | Must |
| REQ-006 | Ubiquitous | The collector shall set `engagement.points = tweet.likeCount` and `engagement.commentCount = retweetCount + replyCount + quoteCount` (each coalesced from `null` to `0` when missing). | Mapper unit test asserts the sum on a fixture with all four counters. | Must |
| REQ-007 | Ubiquitous | The collector shall set `imageUrl` to the URL of the first item in `tweet.media` whose `type === "photo"`, or `null` if no photo exists. | Mapper unit tests: photo→url, video-only→null, mixed media→first photo, empty media→null. | Must |
| REQ-008 | Event-driven | When a tweet has `retweetedTweet !== null`, the system shall use `retweetedTweet.id`, `retweetedTweet.fullText`, `retweetedTweet.tweetBy.userName`, `retweetedTweet.createdAt`, and `retweetedTweet.media` for the `RawItemInsert` (not the outer fields). | Mapper unit test passes a retweet fixture and asserts the persisted `externalId` and `content` come from the inner tweet. | Must |
| REQ-009 | Event-driven | When a tweet has `quoted !== null`, the system shall use the outer tweet's fields and discard the quoted tweet's text. | Mapper unit test asserts `content === outer.fullText` for a quote-tweet fixture. | Must |
| REQ-010 | Ubiquitous | The collector shall set `url` on each item to `https://x.com/<authorHandle>/status/<tweetId>`. | Mapper unit test asserts URL format. | Must |
| REQ-011 | Ubiquitous | The collector shall set `title` to the first 80 chars of the full text, single-lined (newlines collapsed to spaces), with a `…` suffix iff the original is longer than 80 chars. | Mapper unit tests on three fixtures: short tweet, exactly-80, long tweet. | Must |
| REQ-012 | Ubiquitous | The collector shall set `content` to the full tweet text (777+-char `fullText` round-trips intact, no 280-char truncation). | Mapper unit test asserts `content.length === tweet.fullText.length`. | Must |
| REQ-013 | Ubiquitous | The collector shall set `metadata.comments = []` (replies are not collected). | Mapper unit test asserts the empty array. | Must |
| REQ-014 | Event-driven | When the collector finishes processing all lists, it shall in-memory-deduplicate the assembled batch by `externalId` before passing it to `rawItemsRepo.upsertItems`. | Test passes a batch with duplicate IDs; assert `upsertItems` receives one row per ID. | Must |
| REQ-015 | Event-driven | When the deduped batch is non-empty, the collector shall call `rawItemsRepo.upsertItems(batch)` exactly once. | Spy on repo; assert single call with the deduped array. | Must |
| REQ-016 | Event-driven | When `collectTwitter` returns, the result shall be `{ itemsFetched: <total mapped>, commentsFetched: 0, itemsStored: <deduped batch length>, durationMs: <real elapsed> }`. | Test asserts each field independently. | Must |
| REQ-017 | Event-driven | When `deps.signal` (an `AbortSignal`) is aborted mid-pagination, the collector shall cease further client calls and throw an `AbortError`. | Test aborts after the first page; assert exactly one client call and the thrown error name. | Must |

### 2.2 Settings round-trip

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-020 | Ubiquitous | The `user_settings` table shall include a nullable `twitter_config jsonb` column. | Drizzle migration applied; `pnpm --filter @newsletter/shared db:generate` produces no further diff. | Must |
| REQ-021 | Ubiquitous | The system shall expose a `RunSubmitTwitterConfig` type in `@newsletter/shared` with the shape `{ listIds: string[]; users: { handle: string; userId: string }[]; maxTweetsPerSource?: number; sinceHours?: number }`. | TypeScript export resolves; consumers compile. | Must |
| REQ-022 | Ubiquitous | The API shall validate `twitterConfig` requests against a `twitterConfigSchema` (zod) that enforces `listIds: string[]` (each item non-empty digit string), `users: { handle: string (non-empty), userId: string (digit string) }[]`, `maxTweetsPerSource: integer 1..500` optional, `sinceHours: integer 1..168` optional. | API unit test asserts rejection of empty values, negative numbers, non-integer values, and non-digit IDs; acceptance of valid input. | Must |
| REQ-023 | Event-driven | When `PUT /api/settings` succeeds with a `twitterConfig` payload, the saved settings retrieved via `GET /api/settings` shall include the same `twitterConfig` value byte-equivalently. | API integration test (round-trip) asserts equality. | Must |
| REQ-024 | Event-driven | When the daily-run scheduler builds a `RunCollectorsPayload`, it shall include `twitter: <user_settings.twitter_config>` if non-null and shall omit the `twitter` key entirely if null. | Scheduler unit test on both states. | Must |

### 2.3 Pipeline integration

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-030 | Ubiquitous | `RunCollectorsPayload` shall include `twitter?: TwitterCollectConfig`. | Type definition committed; downstream code compiles. | Must |
| REQ-031 | Ubiquitous | The `CollectFns` interface in `pipeline/src/workers/run-process.ts` shall include `collectTwitter`. | Type-check passes. | Must |
| REQ-032 | Event-driven | When `handleRunProcessJob` builds its task array and `payload.twitter` is non-undefined, it shall add a Task that invokes `collectTwitter` and runs it concurrently with the existing collectors via the shared `Promise.all` fan-out. | Worker integration test asserts `collectTwitter` is invoked exactly once when the payload contains it. | Must |
| REQ-033 | Event-driven | When `payload.twitter` is undefined, the system shall not invoke `collectTwitter`. | Worker integration test asserts zero invocations. | Must |
| REQ-034 | Ubiquitous | The collector shall not import from `hono`, `@newsletter/api`, or any web-package code (enforced by existing `no-restricted-imports` ESLint config). | `pnpm lint` passes. | Must |
| REQ-035 | Ubiquitous | The collector shall not use raw Drizzle/`db` clients; all DB writes go through `rawItemsRepo` (enforced by `newsletter/enforce-repository-access`). | `pnpm lint` passes. | Must |

### 2.4 Settings UI

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-040 | Ubiquitous | The settings page shall include a Twitter section with two dynamic-array editors (Lists, Users) and two scalar inputs (`maxTweetsPerSource`, `sinceHours`). | Component rendering test asserts all four controls. | Must |
| REQ-040b | Ubiquitous | The Lists editor shall render one input row per list ID with an "Add list" button that appends a new empty input row, and a "Remove" affordance per row. | RTL test: click Add → 2 inputs; type → values reflected; click Remove → 1 input. | Must |
| REQ-040c | Ubiquitous | The Users editor shall render one input row per user handle with an "Add user" button that appends a new empty input row, and a "Remove" affordance per row. | RTL test, same shape as REQ-040b. | Must |
| REQ-041 | Event-driven | When the user submits the settings form, the API call shall include `twitterConfig: { listIds, users, maxTweetsPerSource, sinceHours }` after dropping rows whose value is empty/whitespace, trimming surviving values, and stripping a leading `@` from handles. | Form submission test asserts the request body. | Must |
| REQ-042 | Event-driven | When `twitterConfig.listIds` AND `twitterConfig.users` are both empty after trimming, the form shall submit `twitterConfig: null` to clear the column. | Form submission test. | Should |

### 2.4b Handle resolution

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-045 | Event-driven | When `PUT /api/settings` receives a `twitterConfig.users` entry that has only a `handle` field (no `userId`), the API shall resolve the handle to a numeric ID via `rettiwt.user.details(handle)` before persisting, and store both `{ handle, userId }`. | API unit test stubs the rettiwt client; asserts both fields persisted. | Must |
| REQ-045b | Event-driven | When `PUT /api/settings` receives a `users` entry that ALREADY contains both `handle` and `userId`, the API shall NOT re-resolve (treat as already-resolved). | API unit test; assert no rettiwt call. | Must |
| REQ-046 | Unwanted | If `rettiwt.user.details(handle)` returns undefined or throws (handle not found, suspended, or auth fails), the PUT shall fail with HTTP 422 and a per-handle error in the response body, leaving prior settings intact. | API unit test stubs rettiwt to throw / return undefined. | Must |
| REQ-047 | Unwanted | If `RETTIWT_API_KEY` is missing at the API process level when a handle resolution is required, the PUT shall fail with HTTP 503 and an actionable error message; settings unchanged. | API unit test with env var unset. | Must |

### 2.5 Error handling

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-050 | Unwanted | If `RETTIWT_API_KEY` is missing or empty at boot, the collector shall return `{ itemsFetched: 0, commentsFetched: 0, itemsStored: 0, durationMs: <ms> }` and log a structured error with `event: "collector.twitter.missing_api_key"` (no throw). | Test sets env to `""` and asserts result shape and log emission; downstream collectors continue. | Must |
| REQ-051 | Unwanted | If a per-list call throws a `Not authorized` / 401-class error, the collector shall stop iterating remaining lists, throw an `AuthError`, and log `event: "collector.twitter.auth_failed"`. | Test stubs the client to throw on the first call; assert subsequent lists are not called and the error propagates. | Must |
| REQ-052 | Unwanted | If a per-list call throws a 404 / not-found error (private or deleted list), the collector shall log `event: "collector.twitter.list_failed"` with `error.code: "not_found"`, record the failure in `result.failures`, and continue processing the next list. | Test on a 3-list config where list 2 throws 404; assert lists 1 and 3 are processed and `failures` contains the listId. | Must |
| REQ-053 | Unwanted | If a per-list call throws a 429 / rate-limit error, the collector shall retry with exponential backoff (250ms, 1s, 4s) up to 3 attempts before recording it as a list failure. | Test with a fake clock; assert retry count and delays. | Must |
| REQ-054 | Unwanted | If every list throws (none succeed), the collector shall throw an aggregated `Error` whose message names each failed list ID, so BullMQ marks the run failed and retries. | Test with all-fail config; assert thrown error contains all list IDs. | Must |
| REQ-055 | Unwanted | If `config.listIds` is empty, the collector shall return `{ itemsFetched: 0, ..., itemsStored: 0, durationMs: <ms> }` with no client calls and log `event: "collector.twitter.no_lists_configured"` at info level. | Test asserts zero client calls and the log entry. | Must |

### 2.6 Observability

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-060 | Event-driven | When the collector starts, it shall emit a structured pino log via `createLogger("collector:twitter")` at info level with `event: "collector.twitter.started"`, `listCount: <n>`. | Log-capture test asserts presence and fields. | Must |
| REQ-061 | Event-driven | When the collector completes, it shall emit a structured log with `event: "collector.twitter.completed"`, `itemsFetched`, `itemsStored`, `failureCount`, `durationMs`. | Log-capture test asserts all five fields. | Must |
| REQ-062 | Event-driven | When a per-list call completes successfully, it shall emit `event: "collector.twitter.list_completed"` with `listId`, `tweetsFetched`, `pagesFetched`. | Log-capture test on a 2-list config. | Should |

---

## 3. Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | Tweet has no media | `imageUrl: null` | REQ-007 |
| EDGE-002 | Tweet has only video media | `imageUrl: null` (videos are not used) | REQ-007 |
| EDGE-003 | Tweet has multiple photos | `imageUrl` is the first photo's URL | REQ-007 |
| EDGE-004 | Long-form tweet (`note_tweet`) >280 chars | `content` contains the full text; `title` truncates to 80 chars with ellipsis | REQ-011, REQ-012 |
| EDGE-005 | `viewCount` is `null` (e.g. on retweets) | Mapper coalesces missing counters to `0`; engagement remains a complete object | REQ-006 |
| EDGE-006 | Same tweet returned by two different lists in the same run | Second occurrence is dropped before `upsertItems` (in-memory dedup) | REQ-014 |
| EDGE-007 | Tweet ID collides with an existing row in `raw_items` (re-run) | Drizzle `onConflictDoUpdate` updates engagement/metadata/imageUrl/updatedAt only; title/content/author preserved | REQ-015 |
| EDGE-008 | Cursor advances but page 2 boundary tweet is identical to page 1 last tweet (1-tweet overlap, observed in probe) | In-memory dedup catches it before upsert | REQ-014 |
| EDGE-009 | List exists but has zero tweets | List logged complete with `tweetsFetched: 0`; run continues | REQ-062 |
| EDGE-010 | Library throws non-401, non-404, non-429 error (unknown class) | Recorded as a list failure with `error.code: "unknown"`; run continues | REQ-052 |
| EDGE-011 | Cancellation via `AbortSignal` between page 1 and page 2 of the same list | No further pages fetched; partial work for that list NOT persisted (upsert called per-collector at end, not per-list) | REQ-017 |
| EDGE-012 | Retweet of a tweet whose original author has since been deleted | Mapper proceeds using `retweetedTweet.tweetBy.userName` (may be `null`); URL falls back to `https://x.com/i/status/<id>` if handle is missing | REQ-008, REQ-010 |
| EDGE-013 | `tweetBy` is missing or malformed | List call recorded as a failure with `error.code: "schema"`; remaining lists continue | REQ-052 |
| EDGE-014 | Settings UI submitted with whitespace-only line in textarea | That line dropped; surviving IDs submitted | REQ-041 |
| EDGE-015 | Settings UI submitted with all blank list IDs | Settings persisted with `twitterConfig: null` (column cleared) | REQ-042 |

---

## 4. Verification Matrix

| ID | Unit Test | Integration Test | E2E / Functional | Manual | Notes |
|----|-----------|-----------------|------------------|--------|-------|
| REQ-001 | Yes | — | — | — | Compile-time + ESLint check |
| REQ-002 | Yes | — | — | — | Stub client, assert call sequence |
| REQ-002b | Yes | — | — | — | Stub user.timeline call sequence |
| REQ-002c | Yes | — | — | — | Mixed config call order test |
| REQ-003 | Yes | — | — | — | Stub client paging |
| REQ-003b | Yes | — | — | — | user.timeline single-page case (cursor: null) |
| REQ-004 | Yes | — | — | — | Stub client + fake clock |
| REQ-005 | Yes | — | — | — | Pure mapper test |
| REQ-006 | Yes | — | — | — | Pure mapper test |
| REQ-007 | Yes | — | — | — | Pure mapper test |
| REQ-008 | Yes | — | — | — | Pure mapper test |
| REQ-009 | Yes | — | — | — | Pure mapper test |
| REQ-010 | Yes | — | — | — | Pure mapper test |
| REQ-011 | Yes | — | — | — | Pure mapper test |
| REQ-012 | Yes | — | — | — | Pure mapper test |
| REQ-013 | Yes | — | — | — | Pure mapper test |
| REQ-014 | Yes | — | — | — | Collector test with duplicate IDs in batch |
| REQ-015 | Yes | — | — | — | Spy on repo |
| REQ-016 | Yes | — | — | — | Result shape assertion |
| REQ-017 | Yes | — | — | — | AbortSignal test |
| REQ-020 | — | Yes | — | — | Drizzle migration applied; schema type round-trip |
| REQ-021 | Yes | — | — | — | Type-only |
| REQ-022 | Yes | — | — | — | Zod schema unit test |
| REQ-023 | — | Yes | — | — | API round-trip via supertest |
| REQ-024 | Yes | — | — | — | Scheduler unit test |
| REQ-030 | Yes | — | — | — | Type-only |
| REQ-031 | Yes | — | — | — | Type-only |
| REQ-032 | — | Yes | — | — | Worker dispatch test |
| REQ-033 | — | Yes | — | — | Worker dispatch test |
| REQ-034 | — | — | — | Yes | `pnpm lint` |
| REQ-035 | — | — | — | Yes | `pnpm lint` |
| REQ-040 | Yes | — | — | — | RTL render test |
| REQ-040b | Yes | — | — | — | RTL: Add-list / Remove-row interactions |
| REQ-040c | Yes | — | — | — | RTL: Add-user / Remove-row interactions |
| REQ-041 | Yes | — | — | — | Form-submit test |
| REQ-042 | Yes | — | — | — | Form-submit test |
| REQ-045 | Yes | Yes | — | — | API unit + handle-resolution round-trip |
| REQ-045b | Yes | — | — | — | API unit: no resolve when userId present |
| REQ-046 | Yes | — | — | — | API unit: rettiwt throws / undefined |
| REQ-047 | Yes | — | — | — | API unit: env var unset |
| REQ-050 | Yes | — | — | — | Env-var stub |
| REQ-051 | Yes | — | — | — | Stub throwing client |
| REQ-052 | Yes | — | — | — | Stub throwing client |
| REQ-053 | Yes | — | — | — | Fake clock + retry stub |
| REQ-054 | Yes | — | — | — | Stub all-fail |
| REQ-055 | Yes | — | — | — | Empty config |
| REQ-060 | Yes | — | — | — | Pino capture |
| REQ-061 | Yes | — | — | — | Pino capture |
| REQ-062 | Yes | — | — | — | Pino capture |
| EDGE-001 to EDGE-015 | Yes (one per case) | — | — | — | Parameterized mapper / collector tests |

---

## 5. Verification Scenarios

> Stage 5 (functional-verify) re-runs these scripts. The first two come from the library probe and prove the chosen library still works against the live list at merge time.

### VS-0a-userauth: Library probe — `rettiwt-api` `list.tweets` in user-auth mode

- **Type:** api
- **Run:** `node docs/spec/add-twitter-x-collector/probes/rettiwt-api/probe-list-tweets-userauth.mjs`
- **Pre-req:** `RETTIWT_API_KEY` set in project-root `.env.harness`
- **Expected:**
  - exit 0
  - ≥1 tweet returned
  - shape checks pass: `id`, full text, `createdAt`, author handle, `likeCount`
  - `payload.sample.json` non-empty

### VS-0a-user-timeline: Library probe — `rettiwt-api` `user.details` + `user.timeline`

- **Type:** api
- **Run:** `node docs/spec/add-twitter-x-collector/probes/rettiwt-api/probe-user-timeline.mjs`
- **Pre-req:** `RETTIWT_API_KEY` set in project-root `.env.harness`
- **Expected:**
  - exit 0
  - handle → numeric id resolution succeeds for `jack` (id `12`) and `sama` (id `1605`)
  - `user.timeline(numericId)` returns ≥1 tweet for each (or warns if quiet)
  - shape checks pass on returned tweets (id, text, createdAt, author, likes)
  - `payload-user-timeline.sample.json` non-empty

### VS-0a-pagination: Library probe — `rettiwt-api` `list.tweets` pagination

- **Type:** api
- **Run:** `node docs/spec/add-twitter-x-collector/probes/rettiwt-api/probe-pagination.mjs`
- **Pre-req:** `RETTIWT_API_KEY` set in project-root `.env.harness`
- **Expected:**
  - exit 0
  - page 1 returns ≥1 tweet AND a non-empty cursor
  - page 2 returns ≥1 tweet AND is not identical to page 1
  - combined unique-tweet count > page 1 count (cursor advanced)

### VS-1: Settings round-trip via API

- **Type:** api
- **Run:** PUT `/api/settings` with a body containing `twitterConfig: { listIds: ["1585430245762441216"], maxTweetsPerList: 50 }`, then GET `/api/settings`.
- **Expected:** GET response includes the same `twitterConfig` byte-equivalently. Maps to REQ-023.

### VS-2: End-to-end run with a real list and a real user

- **Type:** integration
- **Run:** With a configured `twitterConfig` containing `listIds: ["1585430245762441216"]` and `users: [{ handle: "sama", userId: "1605" }]`, trigger `POST /api/runs/now`. Wait for the run to complete.
- **Expected:**
  - Run completes without throwing.
  - `raw_items` table contains ≥1 row with `sourceType = "twitter"` and a non-empty `content` for that run.
  - Rows include tweets from BOTH the list (multiple authors) and the user (`tweetBy.userName === "sama"`).
  - At least one row has a non-zero `engagement.points`.
  - Maps to REQ-002, REQ-002b, REQ-002c, REQ-005..016.

### VS-3: Partial-failure tolerance with mixed valid + invalid sources

- **Type:** integration
- **Run:** Configure `twitterConfig.listIds = ["1585430245762441216", "9999999999999999999"]` and `users: [{ handle: "jack", userId: "12" }, { handle: "definitely-does-not-exist-zzz999", userId: "999999999999" }]` and trigger a run.
- **Expected:**
  - Run does not throw (≥ one list AND ≥ one user succeeded).
  - Logs include exactly one `event: "collector.twitter.list_failed"` for the invalid list, and one `event: "collector.twitter.user_failed"` for the invalid user.
  - `raw_items` rows for the run include only tweets from the valid list and `@jack`.
  - Maps to REQ-052, REQ-054.

### VS-2b: Handle resolution at settings save

- **Type:** api
- **Run:** PUT `/api/settings` with body `{ ..., twitterConfig: { listIds: [], users: [{ handle: "jack" }], maxTweetsPerSource: 50, sinceHours: 24 } }` (no userId provided). Then GET `/api/settings`.
- **Expected:**
  - PUT returns 200 with `users: [{ handle: "jack", userId: "12" }]` (resolved).
  - GET response contains the same resolved tuple.
  - Maps to REQ-045.

### VS-2c: Handle resolution failure surfaces 422

- **Type:** api
- **Run:** PUT `/api/settings` with `users: [{ handle: "definitely-not-a-real-handle-zzz999" }]`.
- **Expected:**
  - HTTP 422 with a per-handle error in the response body.
  - Prior settings unchanged (subsequent GET shows the previous state).
  - Maps to REQ-046.

### VS-4: Missing `RETTIWT_API_KEY` doesn't crash a run

- **Type:** integration
- **Run:** Temporarily unset `RETTIWT_API_KEY` from the pipeline process env. Trigger `POST /api/runs/now` with a configured `twitterConfig`.
- **Expected:**
  - Run completes (other collectors still run).
  - Pipeline logs include `event: "collector.twitter.missing_api_key"`.
  - No `raw_items` rows with `sourceType="twitter"` are written for this run.
  - Maps to REQ-050.

### VS-5: Run cancellation aborts mid-list

- **Type:** integration
- **Run:** Configure a `twitterConfig` with one list. Trigger `POST /api/runs/now`. Within 1s, hit `POST /api/runs/:runId/cancel`.
- **Expected:**
  - Run terminates in `cancelled` status.
  - Twitter collector logs do not include a `collector.twitter.completed` event.
  - Any tweets fetched before cancellation are NOT in `raw_items` for this run (upsert is per-collector at end-of-list, atomic).
  - Maps to REQ-017.

### VS-6: Settings UI round-trip

- **Type:** ui (Playwright)
- **Run:** Open `/admin/settings`, paste a list ID into the Twitter textarea, set `maxTweetsPerList=50` and `sinceHours=24`, click save. Reload the page.
- **Expected:** The same values are present after reload. Maps to REQ-040, REQ-041, REQ-023.

---

## 6. Out of Scope

- **Reply collection** — replies to tweets are not fetched; `metadata.comments` is always `[]`. The "Tweets only" decision in the design doc is binding.
- **Quote-tweet text inclusion** — when a tweet quotes another, the quoted text is dropped; only the outer tweet is stored.
- **Video media** — videos populate `imageUrl: null`; only photos are surfaced.
- **Mixing public-token and apiKey paths** — both list and user collection use the same `RETTIWT_API_KEY`. We do not implement guest-mode user collection as a fallback.
- **Handle re-resolution** — when a saved user's `userId` becomes stale (e.g. account suspended/recreated with the same handle), the collector keeps using the saved `userId`. Re-saving the handle in the UI re-resolves it. We do not auto-detect handle ownership changes.
- **Cookie auto-rotation** — when the underlying X.com session is logged out and the apiKey expires, manual operator action is required (regenerate via the X Auth Helper extension and update `RETTIWT_API_KEY`). The collector does not attempt re-auth.
- **Streaming / real-time** — the collector is fired by the daily-run scheduler only; no continuous tail.
- **Per-list scheduling** — every configured list is fetched on the same daily cadence. Per-list cron schedules are not supported.
- **Email/digest changes** — this PR does not modify digest assembly, recap content, or email delivery. Twitter rows enter the same dedup→rank→recap→review→digest flow as HN/Reddit/web.
- **Migration of existing reverted Twitter data** — commit `8012d61` reverted prior schema; this PR re-introduces only what is required for the chosen approach. Any old `raw_items` rows with `sourceType="twitter"` from earlier attempts are out of scope (can be deleted manually if any exist).
- **Anti-bot evasion** — if Twitter introduces additional bot challenges, the response is to wait for `rettiwt-api` to publish a fix, not to layer additional mitigations.

---

## 7. Cross-references

| Concern | File / Section |
|---|---|
| Library selection rationale | `docs/spec/add-twitter-x-collector/library-probe.md` |
| Probe scripts (re-runnable) | `docs/spec/add-twitter-x-collector/probes/rettiwt-api/` |
| Design narrative | `docs/plans/2026-05-04-twitter-collector-design.md` |
| Existing collector pattern | `packages/pipeline/src/collectors/{hn,reddit,web}.ts` |
| Repository abstraction | `packages/pipeline/src/repositories/raw-items.ts` |
| ESLint rule for return shape | `packages/eslint-plugin/src/rules/collector-return-shape.ts` |
| Settings round-trip baseline | `packages/api/src/routes/settings.ts`, `packages/shared/src/db/schema.ts` |
| Run dispatch | `packages/pipeline/src/workers/run-process.ts` |
