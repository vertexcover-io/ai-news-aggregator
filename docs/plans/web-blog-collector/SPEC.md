# SPEC: Web Blog Collector

**Source:** `docs/plans/2026-04-07-web-blog-collector-design.md`
**Generated:** 2026-04-07

## Requirements

### Dispatch and configuration

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Event-driven | When a BullMQ job with name `"web-collect"` is dequeued, the worker shall invoke `collectWeb(deps, job.data.config)`. | `workers/collection.ts:handleCollectionJob` contains a `case "web-collect"` that resolves `deps = { rawItemsRepo }` and calls `collectWeb`. Unit test asserts dispatch; e2e test enqueues a `web-collect` job and observes the collector running. | Must |
| REQ-002 | Ubiquitous | The `WebCollectConfig` type shall contain `sources: BlogSource[]`, `maxItems: number`, optional `sinceDays?: number`, and optional `postConcurrency?: number`. | `packages/pipeline/src/types.ts` exports `WebCollectConfig` matching this shape; TypeScript strict-mode compile rejects payloads missing `sources` or `maxItems`. | Must |
| REQ-003 | Ubiquitous | The `BlogSource` type shall contain a required `name: string` and a required `listingUrl: string`. | `BlogSource` has no optional fields; compile error if `name` is omitted. | Must |

### Discovery

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-010 | Event-driven | When processing a source, the collector shall fetch `source.listingUrl` via Jina Reader (`https://r.jina.ai/<url>`) and pass the full trimmed Jina response — including the envelope header (`Title:`, `URL Source:`, `Published Time:`, `Markdown Content:`) — to the LLM. The envelope header contains authoritative metadata (title, canonical URL, publish time) that downstream extraction relies on; stripping it discards that data. | Unit test: given a Jina response containing the envelope, the string passed to the LLM equals the trimmed raw response and still contains the literal substring `"Markdown Content:"`. | Must |
| REQ-011 | Event-driven | When the listing markdown is available, the collector shall call Vercel AI SDK `generateObject` with `DiscoverySchema` (`{ posts: Array<{ url, title, published_at }> }`) against the configured Gemini model. | Unit test: collector invokes a mocked `LanguageModel` with a schema equal to `DiscoverySchema`. | Must |
| REQ-012 | Ubiquitous | The collector shall drop any URL returned by the discovery step that does not appear as a substring of the listing markdown. | Unit test: given a mocked LLM returning 3 URLs where 1 is not a substring of the markdown, only the 2 valid URLs enter the filter pipeline. | Must |

### Filtering

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-020 | State-driven | While `config.sinceDays` is set, the collector shall drop discovered posts whose `published_at` parses to a date older than `now - sinceDays * 86_400_000` ms. | Unit test: given posts with ages 0, 5, 10 days and `sinceDays: 7`, only the 0-day and 5-day posts survive. | Must |
| REQ-021 | Unwanted | If a discovered post has `published_at === ""`, then the `sinceDays` filter shall accept the post rather than drop it. | Unit test: given a post with `published_at: ""` and `sinceDays: 1`, the post passes the filter. | Must |
| REQ-022 | Unwanted | If `published_at` is a non-empty string that does not parse to a valid `Date`, then the `sinceDays` filter shall accept the post rather than drop it. | Unit test: given `published_at: "not a date"` and `sinceDays: 1`, the post passes the filter. | Should |
| REQ-023 | Ubiquitous | The collector shall cap the number of candidate post URLs per source at `config.maxItems` after the `sinceDays` filter is applied. | Unit test: given 10 filtered posts and `maxItems: 3`, exactly 3 URLs advance to the dedup pre-check. | Must |

### Deduplication

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-030 | Ubiquitous | The repo shall expose `findExistingExternalIds(sourceType: SourceType, externalIds: string[]): Promise<Set<string>>` returning the subset of `externalIds` already present in `raw_items` for the given `sourceType`. | Integration test against test DB: seed 2 rows, call with 3 external IDs of which 2 match, assert returned `Set` has size 2 and contains exactly the matching IDs. | Must |
| REQ-031 | Event-driven | When post URLs have been filtered and capped, the collector shall call `findExistingExternalIds('blog', capped)` and exclude already-present URLs before invoking detail extraction. | Unit test with mocked repo: given 3 candidate URLs and `findExistingExternalIds` returning a `Set` of 2, only 1 URL reaches `processOnePost`. | Must |
| REQ-032 | Ubiquitous | The system shall guarantee that re-running a `web-collect` job for the same sources produces no duplicate rows in `raw_items`. | E2E test: run collector twice with identical config; assert row count after second run equals row count after first run. Also guaranteed structurally by the `(sourceType, externalId)` unique constraint in `schema.ts:22`. | Must |

### Detail extraction

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-040 | Event-driven | When processing a new post URL, the collector shall fetch the post via Jina Reader and pass the full trimmed Jina response — including the envelope header — to the LLM. For many blog platforms (Hugging Face, Anthropic) the article title and publish date exist only in the envelope header; stripping it causes detail extraction to return empty fields. | Same as REQ-010 applied to post URLs. | Must |
| REQ-041 | Event-driven | When the post markdown is available, the collector shall call `generateObject` with `DetailSchema` (`{ title, author, published_at }`) against the configured Gemini model. | Unit test: mocked `LanguageModel` is invoked with a schema equal to `DetailSchema`; e2e test against a pinned historical post URL returns a non-empty `title` containing a known substring. | Must |
| REQ-042 | Ubiquitous | The `generateObject` calls for both discovery and detail extraction shall be made with `temperature: 0`. | Unit test: the options passed to `generateObject` contain `temperature: 0`. | Must |

### Row assembly and persistence

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-050 | Event-driven | When detail extraction succeeds for a post, the collector shall assemble a `RawItemInsert` with `sourceType: 'blog'`, `externalId === url === sourceUrl === postUrl`, `content` equal to the full trimmed Jina response (envelope header + body), `author` equal to the extracted author (or `null` if empty), `engagement: { points: 0, commentCount: 0 }`, and `metadata: { comments: [] }`. | Unit test: assert the exact shape on one assembled row. | Must |
| REQ-051 | Unwanted | If the extracted `published_at` string does not parse to a valid `Date`, then the assembled row shall set `publishedAt: null`. | Unit test: given `published_at: "not a date"`, assembled row has `publishedAt === null`. | Must |
| REQ-052 | Event-driven | When the collector finishes assembling the per-job batch, it shall call `deps.rawItemsRepo.upsertItems(items)` exactly once. | Unit test: `upsertItems` mock is called exactly once with the assembled items array. E2E test: after a successful run, `raw_items` contains N rows where N equals the number of items in `result.itemsStored`. | Must |

### Parallelism and concurrency

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-060 | Ubiquitous | The collector shall process sources in parallel via `Promise.all`. | Unit test: for 3 sources with instrumented start times, source 2 and source 3 start before source 1's listing fetch resolves. | Must |
| REQ-061 | Ubiquitous | The collector shall limit concurrent post-detail extractions within a single source to `config.postConcurrency` (default `3`) using `p-limit`. | Unit test: for 5 new posts with `postConcurrency: 2` and a delayed mocked `fetchMarkdown`, the maximum number of in-flight `processOnePost` calls at any moment is exactly 2. | Must |
| REQ-062 | Unwanted | If `config.postConcurrency` is not provided, then the collector shall use `3` as the default value. | Unit test: call without `postConcurrency`, assert the `p-limit` limiter was constructed with `3`. | Must |

### Failure tracking

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-070 | Ubiquitous | The `CollectorFailure` type shall contain exactly three fields: `source: string`, optional `postUrl?: string`, and `error: string`. | `packages/pipeline/src/types.ts` exports `CollectorFailure` matching this shape with no other fields. | Must |
| REQ-071 | Ubiquitous | The `WebCollectorResult` type shall extend `CollectorResult` and add an optional `failures?: CollectorFailure[]` field. | `WebCollectorResult extends CollectorResult` is assignable to `CollectorResult`; compile-time subtype check passes. | Must |
| REQ-072 | Unwanted | If the listing page Jina fetch throws, then the collector shall record a source-level `CollectorFailure` (no `postUrl`) with `error` truncated to `MAX_ERROR_LENGTH` (200) chars, and emit a pino warn event with `{ event: "collector_failure", collector: "web", source, stage: "discovery-fetch", error }`. | Unit test: mocked `fetch` rejects for listing URL; `result.failures` contains one entry with matching `source`, no `postUrl`, and `error.length <= 200`; pino log spy received a warn call with `stage: "discovery-fetch"`. | Must |
| REQ-073 | Unwanted | If the discovery LLM call throws, then the collector shall record a source-level `CollectorFailure` and log with `stage: "discovery-llm"`. | Unit test: mocked LLM throws on discovery; `result.failures` has one entry with no `postUrl`; log stage is `"discovery-llm"`. | Must |
| REQ-074 | Unwanted | If `capped.length === 0` after `sinceDays` and `maxItems` filtering (i.e. the LLM returned posts but none survived the filters, or the LLM returned zero posts), then the collector shall record a source-level `CollectorFailure` with `stage: "discovery-empty"`. | Unit test: mocked LLM returns 3 posts all older than `sinceDays`; `result.failures` contains a source-level entry with log stage `"discovery-empty"`. | Must |
| REQ-075 | Ubiquitous | When `newPosts.length === 0` after the dedup pre-check (i.e. all candidates were already stored), the collector shall treat this as a normal successful run for that source — **no** `discovery-empty` failure is recorded and the source contributes zero items. | Unit test: seed DB so `findExistingExternalIds` returns a `Set` containing all candidate URLs; assert `result.failures` is `undefined` and `result.itemsStored === 0`. | Must |
| REQ-076 | Unwanted | If detail Jina fetch throws for a post, then the collector shall record a post-level `CollectorFailure` (with `postUrl`) and log with `stage: "detail-fetch"`. | Unit test: mocked `fetch` rejects for one post URL; `result.failures` contains one entry with matching `postUrl`; other posts in the same source still succeed. | Must |
| REQ-077 | Unwanted | If detail LLM extraction throws for a post, then the collector shall record a post-level `CollectorFailure` and log with `stage: "detail-llm"`. | Unit test: mocked LLM throws on the 2nd of 3 posts; `result.failures` contains one entry with `postUrl` of the 2nd post. | Must |
| REQ-078 | Unwanted | If detail extraction returns an empty `title` for a post AND the discovery-stage `post.title` is also empty, then the collector shall skip the post, record a post-level `CollectorFailure` with `stage: "validate"`, and not write a row to `raw_items`. If the detail `title` is empty but the discovery `post.title` is non-empty, the collector shall fall back to the discovery title and proceed normally (see REQ-078a). | Unit test: mocked LLM returns `title: ""` AND the discovery post has `title: ""`; the post does not appear in the assembled batch; `result.failures` contains one entry with stage `"validate"`. | Must |
| REQ-078a | Event-driven | When detail extraction returns an empty `title` or empty `published_at` for a post, the collector shall fall back to the corresponding field from the discovery-stage `DiscoveredPost` (the result of `discoverPostUrls` against the listing page) before row assembly. This fallback applies field-by-field: a non-empty detail field always wins; a discovery field is used only when the detail field is empty. | Unit test: mocked detail LLM returns `{title: "", author: "X", published_at: ""}` while discovery post has `title: "Fallback T"` and `published_at: "2026-03-30"`; the assembled row has `title: "Fallback T"` and `publishedAt` parsing to `2026-03-30`. | Must |
| REQ-079 | Unwanted | If *every* source in a job produced a source-level failure (`sourceFailed === true` for all), then `collectWeb` shall throw an `Error`. | Unit test: all sources have failing listing URLs; `collectWeb` throws; no rows are inserted. E2E test 5: running with only the broken source throws. | Must |
| REQ-080 | Unwanted | If at least one source in a job succeeded, then `collectWeb` shall return a `WebCollectorResult` without throwing, even if other sources failed. | Unit test: one working source + one broken source; `collectWeb` resolves; `result.failures` contains the broken source; the working source's items are upserted. E2E test 4 covers this live. | Must |
| REQ-081 | Ubiquitous | Every persisted `error` string on a `CollectorFailure` shall be no longer than `MAX_ERROR_LENGTH` (200) chars. | Unit test: mocked error with a 10,000-char message; the resulting `CollectorFailure.error.length === 200`. | Must |
| REQ-082 | Ubiquitous | The `stage` tag is log-only. It shall never appear as a field on the `CollectorFailure` type in the returned result. | Compile-time: the `CollectorFailure` interface has no `stage` field. Runtime: `JSON.stringify(result)` does not contain the key `"stage"` under any failure entry. | Must |

### Result and logging

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-090 | Event-driven | When a job completes, the collector shall return a `WebCollectorResult` containing `itemsFetched`, `itemsStored`, `commentsFetched: 0`, `durationMs`, and `failures` set to the failures array iff `failures.length > 0` (otherwise `undefined`). | Unit test: successful run → `result.failures === undefined`; partial-failure run → `result.failures` is a non-empty array. | Must |
| REQ-091 | Event-driven | When a job completes, the collector shall emit a pino `info` event with `{ itemsFetched, itemsStored, failures: result.failures?.length ?? 0, durationMs }` and the message `"collection completed"`, mirroring `hn.ts:238`. | Unit test: pino log spy receives the `info` call with exactly those fields. | Must |
| REQ-092 | Event-driven | When a job begins, the collector shall emit a pino `info` event indicating collection start (mirroring `collectHn`'s `"collection started"` log in `hn.ts`). | Unit test: pino log spy receives a start-of-job info call before any per-source work. | Should |

### Retry and rate-limit

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-100 | Unwanted | If Jina Reader returns HTTP 429, then the collector shall retry with exponential backoff up to the retry limit defined by `fetchWithRetry` in `packages/pipeline/src/lib/fetch-with-retry.ts` (`MAX_FETCH_RETRIES = 3`). | Unit test: mocked `fetch` returns 429 then 200; collector succeeds; retry count matches expected. | Must |
| REQ-101 | Unwanted | If Jina Reader returns a non-retryable HTTP 4xx (not 429), then the collector shall treat the fetch as failed and record a source-level or post-level `CollectorFailure` without retrying. | Unit test: mocked fetch returns 404; no retries; `CollectorFailure` recorded. | Must |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|--------------|
| EDGE-001 | Listing card shows no visible date and `sinceDays` is set | Post is accepted by the filter; detail extraction still attempts to recover `publishedAt` from the post page | REQ-021 |
| EDGE-002 | LLM returns a URL that does not appear in the listing markdown | URL is dropped before the filter step | REQ-012 |
| EDGE-003 | Listing page Jina fetch fails (network error, DNS failure, non-retryable HTTP) | Source-level `CollectorFailure` recorded with `stage: "discovery-fetch"`; other sources continue | REQ-072, REQ-101 |
| EDGE-004 | Listing LLM extraction throws (schema validation, API error) | Source-level `CollectorFailure` with `stage: "discovery-llm"` | REQ-073 |
| EDGE-005 | LLM returns an empty posts array from the listing | `capped.length === 0` → `CollectorFailure` with `stage: "discovery-empty"` | REQ-074 |
| EDGE-006 | All discovered posts are older than `sinceDays` | `capped.length === 0` after filter → `CollectorFailure` with `stage: "discovery-empty"` | REQ-074 |
| EDGE-007 | All discovered posts are already in `raw_items` | `newPosts.length === 0` after dedup → normal success, `result.failures` is `undefined`, `itemsStored === 0` | REQ-075 |
| EDGE-008 | Detail page Jina fetch fails for one post while others in the same source succeed | Post-level `CollectorFailure` with matching `postUrl` and `stage: "detail-fetch"`; other posts in the source still produce rows | REQ-076 |
| EDGE-009 | Detail LLM extraction throws for one post | Post-level `CollectorFailure` with `stage: "detail-llm"` | REQ-077 |
| EDGE-010 | Detail LLM returns empty `title` but discovery post had a non-empty title | Collector falls back to the discovery title and writes the row; no failure recorded | REQ-078a |
| EDGE-010a | Detail LLM returns empty `title` AND discovery post title is also empty | Post-level `CollectorFailure` with `stage: "validate"`; no row written | REQ-078 |
| EDGE-010b | Detail LLM returns empty `published_at` but discovery post had a date | Collector falls back to the discovery `published_at`; row is written with parsed `publishedAt` | REQ-078a |
| EDGE-011 | Detail LLM returns `published_at: "not a date"` | Row is written with `publishedAt: null` (no failure recorded) | REQ-051 |
| EDGE-012 | Every source in the job fails | `collectWeb` throws; BullMQ marks the job failed and applies its retry policy | REQ-079 |
| EDGE-013 | One working source + one broken source in the same job | `collectWeb` resolves; broken source appears in `failures`; working source's rows are upserted | REQ-080 |
| EDGE-014 | Jina returns HTTP 429 | Retried with exponential backoff up to the retry limit | REQ-100 |
| EDGE-015 | Very long post markdown (>50KB) | Passed through to Gemini Flash unchanged; stored as-is in `content` | REQ-050, REQ-041 |
| EDGE-016 | JS-rendered listing (Next.js, React) | Trusts Jina's headless-browser rendering; no special handling | REQ-010 |
| EDGE-017 | Error message from a thrown exception is 10,000 chars | Truncated to 200 chars in the persisted `CollectorFailure.error` | REQ-081 |
| EDGE-018 | Sources array is empty | `collectWeb` returns a `WebCollectorResult` with `itemsStored: 0` and no failures; does not throw (zero sources cannot all fail) | REQ-079 (boundary) |

## Verification Matrix

| ID | Unit Test | Integration Test | E2E Test | Notes |
|----|-----------|-----------------|----------|-------|
| REQ-001 | Yes | — | Yes | E2E test enqueues a `web-collect` job |
| REQ-002 | Yes (type-only) | — | — | Verified at compile time |
| REQ-003 | Yes (type-only) | — | — | Verified at compile time |
| REQ-010 | Yes | — | Yes | E2E test 1 exercises live Jina |
| REQ-011 | Yes | — | Yes | E2E test 1 exercises live Gemini |
| REQ-012 | Yes | — | — | Requires a mocked LLM that returns a URL not in the listing |
| REQ-020 | Yes | — | — | |
| REQ-021 | Yes | — | — | |
| REQ-022 | Yes | — | — | |
| REQ-023 | Yes | — | Yes | E2E test 3 covers `maxItems: 1` |
| REQ-030 | Yes | Yes | — | Integration test uses `test-db.ts` fixture |
| REQ-031 | Yes | — | Yes | E2E test 3 dedup act |
| REQ-032 | Yes | — | Yes | E2E test 3 double-run |
| REQ-040 | Yes | — | Yes | E2E test 2 (pinned post) |
| REQ-041 | Yes | — | Yes | E2E test 2 asserts title substring |
| REQ-042 | Yes | — | — | |
| REQ-050 | Yes | — | Yes | E2E test 1 asserts shape |
| REQ-051 | Yes | — | — | |
| REQ-052 | Yes | — | Yes | E2E test 3 first run asserts `itemsStored` |
| REQ-060 | Yes | — | Yes | E2E test 1 loose timing / spy on start times |
| REQ-061 | Yes | — | — | Requires timing-sensitive mocked `fetchMarkdown` |
| REQ-062 | Yes | — | — | |
| REQ-070 | Yes (type-only) | — | — | |
| REQ-071 | Yes (type-only) | — | — | |
| REQ-072 | Yes | — | Yes | E2E test 4 broken source |
| REQ-073 | Yes | — | — | Requires mocked LLM that throws |
| REQ-074 | Yes | — | Yes | E2E test 3 sinceDays-zeros act |
| REQ-075 | Yes | — | Yes | E2E test 3 second run (dedup) |
| REQ-076 | Yes | — | — | |
| REQ-077 | Yes | — | — | |
| REQ-078 | Yes | — | — | Requires mocked LLM returning empty title AND discovery post with empty title |
| REQ-078a | Yes | — | — | Covers field-by-field fallback from discovery stage when detail extraction returns empty strings |
| REQ-079 | Yes | — | Yes | E2E test 5 all-sources-broken |
| REQ-080 | Yes | — | Yes | E2E test 4 partial failure |
| REQ-081 | Yes | — | — | |
| REQ-082 | Yes | — | — | Type-only + runtime JSON.stringify check |
| REQ-090 | Yes | — | Yes | E2E tests 1, 3, 4 cover various failure shapes |
| REQ-091 | Yes | — | — | Pino log spy |
| REQ-092 | Yes | — | — | Pino log spy |
| REQ-100 | Yes | — | — | Requires mocked `fetch` returning 429 then 200 |
| REQ-101 | Yes | — | — | Requires mocked `fetch` returning 404 |
| EDGE-001 | Yes | — | — | Covered by REQ-021 test |
| EDGE-002 | Yes | — | — | Covered by REQ-012 test |
| EDGE-003 | Yes | — | Yes | E2E test 4 |
| EDGE-004 | Yes | — | — | |
| EDGE-005 | Yes | — | — | |
| EDGE-006 | Yes | — | Yes | E2E test 3 sinceDays act |
| EDGE-007 | Yes | — | Yes | E2E test 3 second-run dedup act |
| EDGE-008 | Yes | — | — | |
| EDGE-009 | Yes | — | — | |
| EDGE-010 | Yes | — | — | |
| EDGE-011 | Yes | — | — | |
| EDGE-012 | Yes | — | Yes | E2E test 5 |
| EDGE-013 | Yes | — | Yes | E2E test 4 |
| EDGE-014 | Yes | — | — | |
| EDGE-015 | Yes | — | — | Large fixture in unit test |
| EDGE-016 | — | — | Yes | E2E test 1 against Anthropic (Next.js) |
| EDGE-017 | Yes | — | — | |
| EDGE-018 | Yes | — | — | |

## Out of Scope

The following behaviors are deliberately excluded from this feature and are NOT to be implemented:

- **Pagination across listing pages.** Only the first page of each listing is consulted. Sources with post velocity exceeding the first page between collection runs will miss older posts. Revisited only if a specific source requires it.
- **Auth-required blogs.** Sources behind login walls, paywalls, or API keys are not supported. Implementer must not add per-source authentication flows.
- **Manual CSS selector fallback.** If a source fails under the Jina + LLM approach, the answer is either to live with it or to drop that source — not to add per-source selectors.
- **Content rewriting or summarization.** The collector stores the raw Jina markdown body in `content` verbatim. Summarization, ranking, and filtering are downstream pipeline stages and must not leak into the collector.
- **A sources DB table.** For this work, sources are passed inline in the BullMQ job payload. A persistent `sources` table is future work.
- **Backfilling historical posts.** The collector targets "latest posts since last run." Fetching a source's entire archive is not supported.
- **Per-source rate-limit overrides.** `postConcurrency` is global to the job, not per-source. Sites with specific rate-limit needs are out of scope.
- **A `collection_failures` DB table.** Failure history beyond BullMQ result retention is not persisted. To be revisited when an admin dashboard consumes it.
- **Cross-collector failure-type sharing.** `CollectorFailure` lives in `@newsletter/pipeline` and is not exported from `@newsletter/shared`. Promoting it is deferred until a second collector needs the same shape.
- **Promoting `stage` into the `CollectorFailure` type.** Stage tags are log-only. Consumers that need stage-based filtering must grep logs.
- **Robots.txt enforcement.** Jina Reader handles fetching; the collector does not independently consult `/robots.txt`.
- **Image or attachment extraction.** Images embedded in the Jina markdown are preserved as markdown image syntax in `content` but are not downloaded, rehosted, or parsed.
- **`CollectorResult.engagement` with non-zero values.** Blog posts have no native engagement metric; always `{ points: 0, commentCount: 0 }`.
- **A `webCollectionQueue` separate from the existing `collection` queue.** The web collector reuses the existing `collection` queue and dispatches via the existing worker.
