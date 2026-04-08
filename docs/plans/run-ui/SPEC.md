# SPEC: Run UI — Collect → Dedup → Rank → Show

**Source:** `docs/plans/2026-04-07-run-ui-feature-design.md`
**Generated:** 2026-04-07

## Prerequisites

This feature requires the web blog collector (`docs/plans/2026-04-07-web-blog-collector-design.md`) to be shipped first. Its SPEC is at `docs/plans/web-blog-collector/SPEC.md`.

---

## Requirements

### API — Run creation

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Event-driven | When `POST /api/runs` receives a valid `RunSubmitPayload`, the API shall return HTTP 201 with a JSON body `{ runId: string }` within 500ms. | Integration test: POST a valid payload, assert status 201 and response body contains a non-empty `runId` string. | Must |
| REQ-002 | Ubiquitous | The `RunSubmitPayload` shall require `topN: number` (minimum 1, maximum 50) and at least one source group (`web`, `reddit`, or `hn`). | Integration test: POST with `topN: 0` returns 400; POST with no source groups returns 400; POST with `topN: 51` returns 400; POST with `topN: 10` and one source group returns 201. | Must |
| REQ-003 | Event-driven | When `POST /api/runs` receives a payload containing `web` config but `GEMINI_API_KEY` is not set in the server environment, the API shall return HTTP 400 with an error message mentioning the missing key. | Integration test: unset `GEMINI_API_KEY`, POST with `web` config, assert 400 and body contains `"GEMINI_API_KEY"`. POST without `web` config under same conditions returns 201. | Must |
| REQ-004 | Event-driven | When `POST /api/runs` succeeds, the API shall write an initial `RunState` to Redis under key `run:{runId}` with TTL of 3600 seconds, `status: "running"`, `stage: "queued"`, and the submitted `topN`. | Integration test: after POST, read `run:{runId}` from Redis, assert `status === "running"` and TTL between 3000 and 3600. | Must |
| REQ-005 | Event-driven | When `POST /api/runs` succeeds, the API shall enqueue a BullMQ `FlowProducer` flow with a parent job `"run-process"` on queue `"processing"` and one child job per configured source group (`"hn-collect"`, `"reddit-collect"`, `"web-collect"`) on queue `"collection"`. | Integration test: after POST, assert that the `"processing"` queue has one waiting job named `"run-process"` and the `"collection"` queue has one waiting job per source group in the payload. | Must |
| REQ-006 | Ubiquitous | The `POST /api/runs` endpoint and `GET /api/runs/:runId` endpoint shall require authentication via the MVP password middleware. | Integration test: POST without auth header returns 401; POST with correct password returns 201. | Must |

### API — Run status

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-010 | Event-driven | When `GET /api/runs/:runId` is called with a valid `runId` that exists in Redis, the API shall return HTTP 200 with the full `RunState` JSON. | Integration test: create a run, GET `/api/runs/{runId}`, assert 200 and body contains `status`, `stage`, `sources`. | Must |
| REQ-011 | Event-driven | When `GET /api/runs/:runId` is called with a `runId` that does not exist in Redis, the API shall return HTTP 404. | Integration test: GET `/api/runs/nonexistent-id`, assert 404. | Must |
| REQ-012 | Event-driven | When `GET /api/runs/:runId` returns a run with `status: "completed"`, the response shall include a `rankedItems` array of `RankedItem` objects hydrated from the `raw_items` table, containing `id`, `title`, `url`, `sourceType`, `author`, `publishedAt`, `engagement`, and `rationale`. | Integration test: create a run that completes, GET status, assert `rankedItems` is an array where each element has all listed fields and `title` matches the corresponding `raw_items.title`. | Must |
| REQ-013 | Event-driven | When `GET /api/runs/:runId` returns a run with `status: "completed"` and 0 ranked items, the response shall include `rankedItems: []`. | Integration test: create a run where no items are collected, GET status, assert `rankedItems` is an empty array. | Must |

### Pipeline — Collector sinceDays

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-020 | Ubiquitous | The `HnCollectConfig` type shall include an optional `sinceDays?: number` field. | `pipeline/types.ts` exports `HnCollectConfig` with `sinceDays?: number`; compile succeeds. | Must |
| REQ-021 | Event-driven | When `HnCollectConfig.sinceDays` is set, the HN collector shall drop items whose `date_published` parses to a date older than `now - sinceDays × 86_400_000` ms. | Unit test: given 10 items with dates spanning 0–14 days and `sinceDays: 7`, only items with `date_published` within 7 days are included in the output. | Must |
| REQ-022 | Ubiquitous | The `RedditCollectConfig` type shall include an optional `sinceDays?: number` field. | `pipeline/types.ts` exports `RedditCollectConfig` with `sinceDays?: number`; compile succeeds. | Must |
| REQ-023 | Event-driven | When `RedditCollectConfig.sinceDays` is set, the Reddit collector shall drop items whose `created_utc` is older than `now - sinceDays × 86_400_000` ms. | Unit test: given 10 items with ages spanning 0–30 days and `sinceDays: 7`, only items within 7 days survive. | Must |

### Pipeline — Collector run-state reporting

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-030 | Event-driven | When a collector child job starts, it shall update `run:{runId}` in Redis to set `sources.{sourceType}.status` to `"running"` and `stage` to `"collecting"`. | Integration test: enqueue a run, wait for child to start, read Redis key, assert `sources.hn.status === "running"` (when HN is configured). | Must |
| REQ-031 | Event-driven | When a collector child job completes successfully, it shall update `run:{runId}` in Redis to set `sources.{sourceType}.status` to `"completed"` and `sources.{sourceType}.itemsFetched` to the number of items fetched. | Integration test: after a successful HN collection, read Redis key, assert `sources.hn.status === "completed"` and `sources.hn.itemsFetched > 0`. | Must |
| REQ-032 | Event-driven | When a collector child job fails (throws), it shall update `run:{runId}` in Redis to set `sources.{sourceType}.status` to `"failed"` and `sources.{sourceType}.errors` to contain the error message. | Integration test: mock a collector that throws, run the flow, read Redis key, assert `sources.hn.status === "failed"` and `sources.hn.errors` is non-empty. | Must |

### Pipeline — Orchestration (run-process parent)

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-040 | Event-driven | When all collector child jobs for a run have completed (success or failure), the `"run-process"` parent job shall execute. | Integration test: create a run with HN + Reddit configured, assert that `run-process` starts only after both children finish. | Must |
| REQ-041 | Event-driven | When the `"run-process"` parent job starts, it shall update `run:{runId}` in Redis to set `stage` to `"processing"`. | Integration test: read Redis after parent starts, assert `stage === "processing"`. | Must |
| REQ-042 | Ubiquitous | The `"run-process"` parent job shall load candidate items from `raw_items` where `collectedAt >= run.startedAt`. | Unit test: given a mock DB with items at various `collectedAt` timestamps, the query returns only items at or after `run.startedAt`. | Must |
| REQ-043 | Event-driven | When the web collector child returns a `WebCollectorResult` with a non-empty `failures[]` array, the parent job shall append a condensed warning string (source count and stage distribution) to `run:{runId}.warnings`. | Unit test: given `failures` with 2 entries at stages `"discovery-fetch"` and `"detail-llm"`, assert warning contains `"2"` and `"discovery-fetch"`. | Must |
| REQ-044 | Unwanted | If every collector child failed (no items collected at all), then the parent job shall update `run:{runId}` to `status: "completed"`, `stage: "completed"`, `rankedItems: []`, and a warning `"no items collected"`. | Unit test: all children failed, assert final state has `status: "completed"` and `rankedItems: []`. | Must |

### Pipeline — Deduplication

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-050 | Ubiquitous | The deduplication function shall canonicalize a URL by: lowercasing the hostname, stripping the trailing slash from the path, removing query parameters whose names start with `utm_`, `ref`, `source`, `fbclid`, `gclid`, and removing the fragment (`#...`). | Unit test: `"https://Example.com/path/?utm_source=rss&ref=newsletter#section"` becomes `"https://example.com/path/"`. `"https://example.com/path"` becomes `"https://example.com/path"`. | Must |
| REQ-051 | Event-driven | When multiple candidate items share the same canonical URL, the deduplication function shall keep the item with the highest engagement score (`points + commentCount`) and discard the rest. | Unit test: given 3 items with the same canonical URL and engagement scores `[10, 50, 5]`, only the item with score 50 survives. | Must |
| REQ-052 | Event-driven | When the candidate set has been deduplicated, the deduplication function shall return the surviving items in their original insertion order. | Unit test: given items A, B, C where B is a dupe of A, the returned list is `[A, C]` (order preserved). | Must |

### Pipeline — Ranking

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-060 | Event-driven | When the deduplicated candidate set has more than 100 items, the ranking stage shall drop items with the lowest engagement scores until 100 remain before calling the LLM. | Unit test: given 150 candidates, assert exactly 100 are passed to the ranking function, and all dropped items have lower engagement than any retained item. | Must |
| REQ-061 | Event-driven | When the ranking stage executes, it shall make a single call to the Vercel AI SDK `generateObject` with a structured output schema `{ ranked: Array<{ id: number, score: number, rationale: string }> }`. | Unit test with mocked AI SDK: assert `generateObject` is called exactly once with a schema containing `ranked[].id`, `ranked[].score`, `ranked[].rationale`. | Must |
| REQ-062 | Ubiquitous | The ranking LLM payload shall include for each candidate: `id`, `title`, `url`, `sourceType`, `publishedAt` (ISO string or null), and `engagement` (`{ points, commentCount }`). | Unit test: inspect the user message passed to `generateObject`, assert each entry has all six fields. | Must |
| REQ-063 | Event-driven | When the LLM returns a ranked list, the ranking stage shall sort by `score` descending, truncate to `topN`, and write the result as `rankedItems: Array<{ rawItemId, score, rationale }>` into `run:{runId}` in Redis. | Unit test: given `topN: 3` and 10 scored items, assert exactly 3 items written to Redis in score-descending order. | Must |
| REQ-064 | Unwanted | If the LLM ranking call fails (network error, invalid structured output, timeout), then the parent job shall update `run:{runId}` to `status: "failed"`, `stage: "failed"`, and `error` containing a description of the failure. | Unit test: mock `generateObject` to throw, assert final run state is `status: "failed"` and `error` is non-empty. | Must |
| REQ-065 | Ubiquitous | The ranking model shall be configurable via the `RANKING_MODEL` environment variable. If unset, the system shall use a default model. | Unit test: when `RANKING_MODEL` is unset, the ranking function uses the default model identifier; when set to `"google/gemini-2.5-flash"`, it uses that model. | Should |
| REQ-066 | Ubiquitous | The ranking prompt shall be loaded from an external file (`pipeline/prompts/rank-system.md`) at startup, not inline in code. | Unit test: the ranking function reads the prompt from a resolved file path, not a string literal. | Should |

### Pipeline — Run completion

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-070 | Event-driven | When the parent job finishes writing ranked items, it shall update `run:{runId}` to `status: "completed"`, `stage: "completed"`, and `completedAt` to the current ISO timestamp. | Integration test: after a full run, read Redis, assert `status === "completed"` and `completedAt` is a parseable ISO string after `startedAt`. | Must |
| REQ-071 | Event-driven | When the parent job encounters an unrecoverable error (dedup failure, ranking failure), it shall update `run:{runId}` to `status: "failed"`, `stage: "failed"`, `error` to the error message, and `completedAt` to the current ISO timestamp. | Integration test: force a ranking failure, read Redis, assert `status === "failed"` and `completedAt` is set. | Must |

### Pipeline — Observability

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-080 | Event-driven | When a run is created, the API shall emit a structured log `run.started` with `runId`, `topN`, and source types configured. | Integration test: after POST, assert log output contains `"run.started"` and the `runId`. | Must |
| REQ-081 | Event-driven | When each collector child completes, the worker shall emit a structured log `run.source.completed` with `runId`, `sourceType`, `itemsFetched`, and `durationMs`. | Unit test: after collector completes, assert log contains `"run.source.completed"` with the correct fields. | Must |
| REQ-082 | Event-driven | When each collector child fails, the worker shall emit a structured log `run.source.failed` with `runId`, `sourceType`, and `error`. | Unit test: after collector throws, assert log contains `"run.source.failed"` with the `sourceType` and error string. | Must |
| REQ-083 | Event-driven | When deduplication completes, the parent job shall emit a structured log `run.dedup` with `runId`, `inputCount`, and `outputCount`. | Unit test: after dedup, assert log contains `"run.dedup"` with counts. | Must |
| REQ-084 | Event-driven | When ranking completes, the parent job shall emit a structured log `run.rank` with `runId`, `candidateCount`, and `rankedCount`. | Unit test: after ranking, assert log contains `"run.rank"` with counts. | Must |
| REQ-085 | Event-driven | When a run completes, the parent job shall emit a structured log `run.completed` with `runId`, `totalDurationMs`, and `rankedItemCount`. | Integration test: after full run, assert log contains `"run.completed"`. | Must |

### Frontend — Source configuration form

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-100 | Ubiquitous | The `/run` page shall render a form with three collapsible source groups: Websites, Subreddits, and Hacker News. | Visual test: page loads with all three section headers visible. | Must |
| REQ-101 | Ubiquitous | The Websites section shall allow the user to add/remove `{ name, listingUrl }` rows, set `maxItems` per source (default 5), and set `sinceDays` (default 3). | Visual test: can add 2 website rows, change maxItems to 10, change sinceDays to 7, and remove one row. | Must |
| REQ-102 | Ubiquitous | The Subreddits section shall allow the user to enter subreddit names (comma-separated or tag-style), select `sort` (hot/new/top), set `limit` (default 25), and set `sinceDays` (default 3). | Visual test: enter "MachineLearning, LocalLLaMA", select "top", set limit to 50, set sinceDays to 7. | Must |
| REQ-103 | Ubiquitous | The Hacker News section shall have an enable/disable toggle, a keywords input (comma-separated), a `pointsThreshold` input (default 20), and a `sinceDays` input (default 3). | Visual test: toggle HN on, enter "AI, LLM", change points to 50, set sinceDays to 5. | Must |
| REQ-104 | Ubiquitous | The form shall display a global `Top N results` input (default 10, min 1, max 50). | Visual test: default shows 10; can change to 25. | Must |
| REQ-105 | Event-driven | When the user clicks Submit with at least one source group configured and valid topN, the frontend shall POST `RunSubmitPayload` to `/api/runs`. | E2E test: fill form with HN enabled, click Submit, assert network request sent to `POST /api/runs`. | Must |
| REQ-106 | Unwanted | If the user clicks Submit with no source group configured, the frontend shall display a validation error and not send the request. | Visual test: with all sources empty, click Submit, assert error message visible and no network request. | Must |
| REQ-107 | Ubiquitous | The form shall require auth. When the user is not authenticated, the page shall prompt for the MVP password. | Visual test: navigate to `/run` without auth, assert password prompt appears. | Must |

### Frontend — Run status polling

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-110 | Event-driven | When the submit succeeds and returns `{ runId }`, the frontend shall begin polling `GET /api/runs/:runId` every 2 seconds. | E2E test: after submit, observe network tab shows GET requests to `/api/runs/{runId}` at ~2s intervals. | Must |
| REQ-111 | State-driven | While the run `stage` is `"collecting"`, the frontend shall display per-source status (completed/running/failed) with item counts for completed sources. | Visual test: during collection, HN shows "✓ 48 items", Reddit shows "… fetching", Web shows "✓ 12 items". | Must |
| REQ-112 | Event-driven | When the polling response has `status: "completed"`, the frontend shall stop polling and render the ranked results list. | E2E test: wait for run to complete, assert polling stops and results appear. | Must |
| REQ-113 | Event-driven | When the polling response has `status: "failed"`, the frontend shall stop polling and display the error message from `runState.error`. | E2E test: force a failure, assert error message displayed and polling stops. | Must |
| REQ-114 | Event-driven | When the polling request returns 404 (Redis TTL expired), the frontend shall stop polling and display "Run not found — it may have expired. Please submit a new run." | Unit test: mock GET to return 404, assert component shows expired message and does not retry. | Must |

### Frontend — Results display

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-120 | Event-driven | When the run completes with ranked items, the frontend shall render a list showing each item's rank number, title, source type badge, URL (as link), published date, engagement score, and LLM rationale. | Visual test: completed run shows "1. [HN] Title … rationale: …". | Must |
| REQ-121 | Event-driven | When the run completes with 0 ranked items, the frontend shall display "No items matched your criteria." | Visual test: empty run shows the no-items message. | Must |
| REQ-122 | Ubiquitous | The results list shall display at most `topN` items, ordered by rank (highest first). | Visual test: `topN: 3` run shows exactly 3 items in score-descending order. | Must |

---

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | All three source groups configured but all return 0 items within `sinceDays`. | Run completes with `rankedItems: []`. UI shows "No items matched your criteria." | REQ-013, REQ-121 |
| EDGE-002 | HN and Reddit both link the same article (same canonical URL after dedup). | Only one item survives dedup; the one with higher engagement is kept. | REQ-050, REQ-051 |
| EDGE-003 | User submits a second run while the first is still in progress. | Both runs coexist with separate `runId`s. No error, no coalescing. | REQ-001, REQ-004 |
| EDGE-004 | `sinceDays: 30` but HN feed only returns the last 7 days of items. | HN collector fetches its max page, filters client-side, and logs a warning that 0 items were dropped (filter had no effect). Items returned may not cover the full 30-day window. | REQ-021 |
| EDGE-005 | Redis is restarted mid-run (TTL keys lost). | Frontend polling gets 404, shows "run expired" message. BullMQ jobs continue and complete but run state is gone. User resubmits. | REQ-114 |
| EDGE-006 | Web collector child returns `WebCollectorResult` with `failures: [{ source: "anthropic", stage: "discovery-fetch" }, { source: "openai", stage: "detail-llm" }]`. | Parent job appends warning `"web: 2 sources failed (discovery-fetch, detail-llm)"` to run state. Successful web items still included in ranking. | REQ-043 |
| EDGE-007 | Web collector child throws (all web sources failed). | Parent job sets `sources.web.status = "failed"` with error message. Other sources (HN, Reddit) still contribute items. Run completes with partial data. | REQ-032, REQ-044 |
| EDGE-008 | Ranking LLM returns structured output where some `id` values do not exist in the candidate set. | Parent job discards entries with unknown IDs. If all entries are invalid, run fails with error `"ranking returned no valid items"`. | REQ-063 |
| EDGE-009 | Candidate set has exactly 1 item after dedup. | Ranking LLM is called with 1 candidate. Result list has 1 item. | REQ-060, REQ-063 |
| EDGE-010 | `topN` is larger than the number of deduplicated candidates. | All candidates are ranked and returned; result list is shorter than `topN`. | REQ-063, REQ-122 |
| EDGE-011 | POST `/api/runs` with malformed JSON body. | API returns HTTP 400 with a parse error message. | REQ-002 |
| EDGE-012 | GET `/api/runs/:runId` called with a `runId` containing special characters (path traversal attempt). | API returns HTTP 404 (no Redis key matches). No filesystem access. | REQ-011 |
| EDGE-013 | Collector writes items to `raw_items` but Redis key expires before the parent job reads `run.startedAt`. | Parent job cannot determine `startedAt` from Redis. It uses the current time minus a conservative window (e.g. 10 minutes) as the fallback query window, and logs a warning. | REQ-042 |
| EDGE-014 | URL canonicalization receives a URL without a protocol (e.g. `example.com/path`). | Canonicalization treats it as invalid and returns the original string unchanged. The item is included in dedup but will not match any properly-formed URL. | REQ-050 |
| EDGE-015 | Rapid duplicate submit — user double-clicks Submit. | Two runs are created with different `runId`s. Both run independently. Frontend tracks the latest `runId` and polls that one. | REQ-001, REQ-003 |

---

## Verification Matrix

| REQ ID | Unit Test | Integration Test | E2E / Visual Test | Notes |
|--------|-----------|-----------------|-------------------|-------|
| REQ-001 | No | Yes | Yes | Integration: API test against real Redis. E2E: full submit flow |
| REQ-002 | No | Yes | No | API validation tests |
| REQ-003 | No | Yes | No | Requires env var manipulation |
| REQ-004 | No | Yes | No | Redis state assertion |
| REQ-005 | No | Yes | No | BullMQ queue inspection |
| REQ-006 | No | Yes | No | Auth middleware test |
| REQ-010 | No | Yes | No | API GET test |
| REQ-011 | No | Yes | No | API 404 test |
| REQ-012 | No | Yes | No | Requires completed run with items in PG |
| REQ-013 | No | Yes | No | Empty run scenario |
| REQ-020 | Yes | No | No | TypeScript compile check |
| REQ-021 | Yes | No | No | Collector unit test with date fixtures |
| REQ-022 | Yes | No | No | TypeScript compile check |
| REQ-023 | Yes | No | No | Collector unit test with date fixtures |
| REQ-030 | No | Yes | No | Redis state after child starts |
| REQ-031 | No | Yes | No | Redis state after child completes |
| REQ-032 | No | Yes | No | Redis state after child fails |
| REQ-040 | No | Yes | No | FlowProducer barrier test |
| REQ-041 | No | Yes | No | Redis stage assertion |
| REQ-042 | Yes | No | No | DB query unit test |
| REQ-043 | Yes | No | No | Warning generation unit test |
| REQ-044 | Yes | No | No | All-failed unit test |
| REQ-050 | Yes | No | No | URL canonicalization unit tests |
| REQ-051 | Yes | No | No | Engagement tiebreak unit test |
| REQ-052 | Yes | No | No | Order preservation unit test |
| REQ-060 | Yes | No | No | Truncation unit test |
| REQ-061 | Yes | No | No | Mocked AI SDK call assertion |
| REQ-062 | Yes | No | No | Payload shape unit test |
| REQ-063 | Yes | No | No | Redis write + truncation unit test |
| REQ-064 | Yes | No | No | Failure mode unit test |
| REQ-065 | Yes | No | No | Env var config unit test |
| REQ-066 | Yes | No | No | File loading unit test |
| REQ-070 | No | Yes | No | End-to-end run integration test |
| REQ-071 | No | Yes | No | Failure integration test |
| REQ-080 | No | Yes | No | Log assertion in integration test |
| REQ-081 | Yes | No | No | Log assertion in unit test |
| REQ-082 | Yes | No | No | Log assertion in unit test |
| REQ-083 | Yes | No | No | Log assertion in unit test |
| REQ-084 | Yes | No | No | Log assertion in unit test |
| REQ-085 | No | Yes | No | Log assertion in integration test |
| REQ-100 | No | No | Yes | Visual / Playwright |
| REQ-101 | No | No | Yes | Visual / Playwright |
| REQ-102 | No | No | Yes | Visual / Playwright |
| REQ-103 | No | No | Yes | Visual / Playwright |
| REQ-104 | No | No | Yes | Visual / Playwright |
| REQ-105 | No | No | Yes | E2E: Playwright form submit |
| REQ-106 | No | No | Yes | Visual / Playwright |
| REQ-107 | No | No | Yes | Visual / Playwright |
| REQ-110 | No | No | Yes | E2E: Playwright polling observation |
| REQ-111 | No | No | Yes | Visual / Playwright |
| REQ-112 | No | No | Yes | E2E: Playwright completion |
| REQ-113 | No | No | Yes | E2E: Playwright failure |
| REQ-114 | Yes | No | No | Component unit test with mocked API |
| REQ-120 | No | No | Yes | Visual / Playwright |
| REQ-121 | No | No | Yes | Visual / Playwright |
| REQ-122 | No | No | Yes | Visual / Playwright |

| EDGE ID | Unit Test | Integration Test | E2E / Visual Test | Notes |
|---------|-----------|-----------------|-------------------|-------|
| EDGE-001 | No | Yes | Yes | Integration: empty run. Visual: empty results |
| EDGE-002 | Yes | No | No | Dedup unit test |
| EDGE-003 | No | Yes | No | Concurrent run integration test |
| EDGE-004 | Yes | No | No | HN collector unit test with warning log |
| EDGE-005 | No | No | Yes | Playwright: mock 404, check message |
| EDGE-006 | Yes | No | No | Warning condensation unit test |
| EDGE-007 | No | Yes | No | Partial failure integration test |
| EDGE-008 | Yes | No | No | Invalid ID filtering unit test |
| EDGE-009 | Yes | No | No | Single-item ranking unit test |
| EDGE-010 | Yes | No | No | topN > candidates unit test |
| EDGE-011 | No | Yes | No | API malformed body test |
| EDGE-012 | No | Yes | No | API path traversal test |
| EDGE-013 | Yes | No | No | Fallback window unit test |
| EDGE-014 | Yes | No | No | URL canonicalization unit test |
| EDGE-015 | No | Yes | Yes | Integration: double submit. Visual: frontend tracks latest |

---

## Out of Scope

- **Human review / approval step** — ranked items are shown directly, no separate review queue or approve/reject flow.
- **Digest assembly and email delivery** — no Resend integration, no curated newsletter email.
- **Source config persistence** — the form is ephemeral; no `sources` table, no save/load between sessions.
- **Run history** — Redis TTL deletes run state after 1 hour; no Postgres `runs` table for revisiting past runs.
- **Per-user auth or rate limiting** — single shared password, no per-user identity, no request throttling.
- **Listing-page pagination** — web collector only scrapes the first page of each listing URL (deferred in web collector design).
- **Sitemap-based discovery** — web collector uses Jina + LLM, not sitemap.xml.
- **Heuristic fallback ranking** — if the LLM ranking call fails, the run fails. Engagement-based heuristic is deferred.
- **Real-time log streaming** — no SSE, WebSocket, or log tailing during runs. Polling only.
- **Concurrent run limits** — no cap on simultaneous runs beyond what BullMQ concurrency settings provide.
- **Subscription management** — recipients remain hardcoded (Ritesh, Aman). No public subscriber system.
- **Archive or digest pages** — `/archive` and `/digest/:date` routes are separate future work.
