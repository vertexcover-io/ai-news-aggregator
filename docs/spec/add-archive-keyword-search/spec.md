# SPEC: Archive Keyword Search

**Source:** `docs/plans/2026-05-07-archive-keyword-search-design.md`
**Library probe:** `docs/spec/add-archive-keyword-search/library-probe.md` (PASS)
**UI mock (approved):** `docs/spec/add-archive-keyword-search/mocks/search-ui.html` (4 frames)
**Generated:** 2026-05-07
**Linear:** TBD

## Summary

Add a keyword search to the public archive listing at `/`. Search must cover the entire content of every reviewed archive: digest headline, digest summary, and per-story title, source, author, effective recap summary/bullets/bottom-line. Beside the search input, a date-range picker filters by archive completion date. Postgres FTS (with an `unaccent`-wrapped tsvector + GIN index) powers the backend; `react-day-picker` v9 powers the UI control.

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-001 | Ubiquitous | The system shall expose a public HTTP endpoint `GET /api/archives/search` that accepts query params `q`, `from`, `to`, `limit`. | Endpoint reachable without auth; returns `200 OK` with `{ archives, total, q?, from?, to? }`. | Must |
| REQ-002 | Event-driven | When the request includes `q` (≥ 2 chars), the system shall return only archives whose `search_text` matches `websearch_to_tsquery('english', immutable_unaccent(q))`. | For seeded fixtures, `q="agentic"` returns exactly the archives whose digest or any story content contains a stem of "agent"; non-matching archives absent. | Must |
| REQ-003 | Event-driven | When the request includes `from` and/or `to`, the system shall return only archives whose `completed_at` falls within the inclusive range `[from, to]`. | Out-of-range archives absent; in-range archives present. | Must |
| REQ-004 | Ubiquitous | The system shall return only archives where `reviewed = true`. | Unreviewed archives never appear in results regardless of query/range. | Must |
| REQ-005 | Ubiquitous | The system shall sort results primarily by FTS relevance (`ts_rank_cd`) when `q` is present, and by `completed_at` DESC when `q` is absent. | Given two archives where archive A scores higher on `q`, A precedes B; when `q` is absent, newest archive first. | Must |
| REQ-006 | Ubiquitous | The system shall cap response size at `limit` (default 50, max 50). | `archives.length ≤ limit`; `total` reports the full count. | Must |
| REQ-007 | Ubiquitous | The system shall return per-archive fields identical in shape to `GET /api/archives` (`runId`, `runDate`, `storyCount`, `topItems[≤3]`, `leadSummary`, `digestHeadline`, `digestSummary`). | Schema diff vs `ArchiveListItem` = ∅. | Must |
| REQ-008 | Ubiquitous | The system shall maintain a denormalized `run_archives.search_text` column populated whenever an archive is created or its review is saved. | After a `PATCH /api/admin/archives/:runId` call, the new `search_text` value contains all override-aware story content from `rankedItems`. | Must |
| REQ-009 | Ubiquitous | The system shall maintain a generated `run_archives.search_tsv` tsvector column derived from `to_tsvector('english', immutable_unaccent(coalesce(search_text, '')))` and indexed with GIN. | Migration creates the column + index; `EXPLAIN` on the search query references the GIN index when corpus ≥ 500 rows. | Must |
| REQ-010 | Ubiquitous | The system shall provide a pure serializer `serializeArchiveSearchText({digestHeadline, digestSummary, rankedItems, rawItemsById}) → string` in `@newsletter/shared`. | Serializer concatenates digest + per-story title, url-host, sourceType, author, effective summary, joined bullets, effective bottom-line. Override values take precedence over `raw_items.metadata.recap`. | Must |
| REQ-011 | State-driven | While the AUTO_REVIEW path marks an archive reviewed in the pipeline, the system shall write the same `search_text` value the API write path would produce. | A pipeline-AUTO_REVIEW-completed archive returns the same `search_text` as one saved via `PATCH /api/admin/archives/:runId` for identical inputs. | Must |
| REQ-012 | Ubiquitous | The system shall include a one-shot backfill migration that populates `search_text` for all existing reviewed archives at deploy time. | After migration, `count(*) where reviewed=true and search_text is null = 0`. | Must |
| REQ-013 | Ubiquitous | The system shall render a search input on the archive listing page `/` containing the placeholder `Search the archive…` and a leading `⌕` glyph. | DOM contains `<input>` with the placeholder text; visible on desktop and mobile. | Must |
| REQ-014 | Event-driven | When the user types into the search input, the system shall debounce updates to the URL query param `q` by 250 ms. | Within 250 ms of last keystroke, `location.search` reflects the new `q`. | Must |
| REQ-015 | Ubiquitous | The system shall persist `q`, `from`, `to` in the URL as query parameters so refresh/share preserves state. | Reload of `/?q=foo&from=2026-04-01&to=2026-05-07` shows the same query, range, and result list. | Must |
| REQ-016 | Ubiquitous | The system shall render a date-range chip beside the search input that shows the current range or "ALL TIME" when none is set. | Chip text equals `ALL TIME` when no `from`/`to` params; equals `<MMM D> – <MMM D>, <YYYY>` when both set. | Must |
| REQ-017 | Event-driven | When the user clicks the date-range chip, the system shall open a popover containing a 2-month `react-day-picker` v9 in `mode="range"`, preset chips (`Last 7 days`, `Last 30 days`, `Last 90 days`, `This year`, `All time`), a `Clear` button, and an `Apply` button. | Popover DOM matches mock Frame 4. | Must |
| REQ-018 | Event-driven | When the user clicks `Apply` in the popover, the system shall close the popover and update `from`/`to` URL params. | After click, popover gone; URL reflects selection. | Must |
| REQ-019 | Event-driven | When the user clicks `Clear` in the popover, the system shall remove `from`/`to` from the URL. | After click, URL has no `from`/`to`; chip reads `ALL TIME`. | Must |
| REQ-020 | Event-driven | When `q` is non-empty in the URL, the system shall hide month-group headers (the relevance-sorted result list is not month-grouped). | DOM contains no `<MonthHeader>` elements when `q` present. | Must |
| REQ-021 | Event-driven | When `q` is non-empty, the system shall display a result-meta strip reading `<N> issues match "<q>"` (and ` · <range>` if a range is set). | Visible above the row list; absent when `q` is empty. | Must |
| REQ-022 | Event-driven | When the API returns zero archives for a non-empty `q`, the system shall render the empty state from mock Frame 3 (eyebrow `NO MATCHES`, serif headline echoing the query, hint copy). | DOM matches mock Frame 3. | Must |
| REQ-023 | Ubiquitous | The system shall apply inline `<mark>` highlights to occurrences of each query term inside the digest headline and digest summary on each result row. | Each unique term in `q` (case-insensitive, accent-insensitive) wraps in a `<mark>` when found in `digestHeadline` or `digestSummary`. | Should |
| REQ-024 | Unwanted | If `q.length > 200`, then the system shall return `400 Bad Request` with `{ error: "q-too-long" }`. | Request with `q` of 201 chars returns 400. | Must |
| REQ-025 | Unwanted | If `from > to` (inverted range), then the system shall return `400 Bad Request` with `{ error: "invalid-range" }`. | Request with `from=2026-05-08&to=2026-05-01` returns 400. | Must |
| REQ-026 | Unwanted | If `from` or `to` is not an ISO date `YYYY-MM-DD`, then the system shall return `400 Bad Request`. | Request with `from=garbage` returns 400. | Must |
| REQ-027 | Ubiquitous | The system shall log a structured info entry on every search request containing `{ q, from, to, count, durationMs }`. | One log entry per request; on a 200 ms slow query the `durationMs` field is present. | Must |
| REQ-028 | Ubiquitous | The system shall complete the P95 search query in ≤ 200 ms on a corpus of 1,000 reviewed archives. | Benchmark suite (seeded 1k archives) reports P95 ≤ 200 ms over 100 sequential queries. | Should |
| REQ-029 | Ubiquitous | The system shall declare a Postgres IMMUTABLE wrapper function `immutable_unaccent(text) RETURNS text` in the migration that introduces FTS, and use it both in the generated tsvector column expression and in every search query. | Migration includes `CREATE OR REPLACE FUNCTION immutable_unaccent ... IMMUTABLE PARALLEL SAFE`; query references the same function name verbatim. | Must |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|--------------|
| EDGE-001 | `q` is empty string and no `from`/`to` provided. | Endpoint returns same data as `GET /api/archives` (all reviewed archives, newest first, capped at limit). | REQ-001, REQ-005, REQ-006 |
| EDGE-002 | `q` is exactly 1 character. | Frontend does not fire request (min 2 chars); server still accepts and returns FTS results normally if called directly (no new error). | REQ-014 |
| EDGE-003 | `q` contains websearch operators (`-`, `OR`, quoted phrase). | Operators interpreted by Postgres `websearch_to_tsquery`; e.g. `claude -agentic` excludes archives containing "agentic". | REQ-002 |
| EDGE-004 | Story has both an override `summary` and a `raw_items.metadata.recap.summary`. | `search_text` contains the override only (override precedence). | REQ-008, REQ-010 |
| EDGE-005 | Pre-VER-96 archive (no `digest_headline`/`digest_summary`). | `search_text` falls back to story content; archive is searchable on story content even though digest fields are null. | REQ-008, REQ-010 |
| EDGE-006 | Archive has no `rankedItems` (status=completed but reviewed=false). | Not present in search results. | REQ-004 |
| EDGE-007 | Concurrent: review save in progress for archive A, search query fires. | Either pre-save or post-save state; never partial. (Postgres single-statement transactional update of `search_text` ensures this.) | REQ-008 |
| EDGE-008 | Accent: query `cote` against archive containing `Côté`. | Match (accent-insensitive via `immutable_unaccent`). | REQ-002, REQ-029 |
| EDGE-009 | Multi-word query `claude 4.7`. | All terms must match (websearch AND semantics by default). | REQ-002 |
| EDGE-010 | `limit` exceeds 50 (e.g. `limit=1000`). | Server caps at 50; returns 50 archives + accurate `total`. | REQ-006 |
| EDGE-011 | `limit` is negative or non-integer. | 400 Bad Request via zod. | REQ-024 (extends validation) |
| EDGE-012 | Archive `search_text` exceeds 64 KB. | Serializer truncates per-story bottom_line to fit; no row-insert error. | REQ-010 |
| EDGE-013 | Migration runs against a DB where `unaccent` extension is not installed. | Migration installs it (`CREATE EXTENSION IF NOT EXISTS unaccent`); failure if user lacks privilege is loud and clear. | REQ-009 |
| EDGE-014 | URL has `q=&from=2026-05-01` (q empty, range set). | Backend filters by date only; frontend hides search-meta strip but keeps the result list and the date chip. | REQ-002, REQ-003, REQ-021 |
| EDGE-015 | User clicks `Last 30 days` preset, then immediately clicks `Apply`. | URL updates with computed `from`/`to` matching today − 30 days through today. | REQ-017, REQ-018 |
| EDGE-016 | User selects a single day (from = to). | Backend returns archives completed exactly on that date (inclusive). | REQ-003 |
| EDGE-017 | Term appears in story but NOT in digest headline/summary. | Row appears in results; no `<mark>` highlight on visible text (highlights are digest-only by REQ-023). | REQ-023 |
| EDGE-018 | XSS attempt: `q=<script>alert(1)</script>`. | Term is treated as text by Postgres FTS; React's default escaping prevents script execution; no `<mark>` injects unsafe HTML. | REQ-002, REQ-023 |
| EDGE-019 | Search-meta string includes the user-supplied `q`. | Echoed text is React-escaped (no `dangerouslySetInnerHTML`). | REQ-021 |

## Verification Matrix

| ID | Unit Test | Integration Test | E2E Test | Manual Test | Notes |
|----|-----------|------------------|----------|-------------|-------|
| REQ-001 | — | Yes | Yes | — | Hono route test (status, shape); Playwright `/?q=…` GET. |
| REQ-002 | — | Yes | — | — | API repo test: seeded archives, FTS match. |
| REQ-003 | — | Yes | — | — | Range filter test against seeded `completed_at` values. |
| REQ-004 | — | Yes | — | — | Seed includes one unreviewed archive; assert absence. |
| REQ-005 | — | Yes | — | — | Two archives differing in `ts_rank_cd`; assert order. |
| REQ-006 | — | Yes | — | — | Seed 60 archives; assert `archives.length === 50`, `total === 60`. |
| REQ-007 | — | Yes | — | — | Schema diff vs `ArchiveListItem`. |
| REQ-008 | Yes | Yes | — | — | Unit on serializer; integration on review-save write. |
| REQ-009 | — | Yes | — | — | DB introspection: column type, index name, expression. |
| REQ-010 | Yes | — | — | — | Unit tests on `serializeArchiveSearchText` covering override precedence + missing fields. |
| REQ-011 | — | Yes | — | — | Pipeline AUTO_REVIEW path test (existing pattern); assert `search_text` written. |
| REQ-012 | — | Yes | — | — | Apply migration to DB seeded with reviewed archives lacking `search_text`; assert all populated. |
| REQ-013 | Yes | — | Yes | — | Unit on `<SearchBar/>`; Playwright DOM assertion. |
| REQ-014 | Yes | — | Yes | — | Vitest fake timers for debounce; Playwright timing. |
| REQ-015 | Yes | — | Yes | — | Vitest test with MemoryRouter; Playwright reload check. |
| REQ-016 | Yes | — | Yes | — | Unit on `<DateRangeChip/>`. |
| REQ-017 | Yes | — | Yes | — | Unit on popover open + content; Playwright interaction. |
| REQ-018 | Yes | — | Yes | — | Unit covers URL update; Playwright covers full flow. |
| REQ-019 | Yes | — | Yes | — | Same as REQ-018. |
| REQ-020 | Yes | — | — | — | Unit on `ArchiveListingPage` with `q` param. |
| REQ-021 | Yes | — | — | — | Unit on result-meta render. |
| REQ-022 | Yes | — | Yes | — | Unit on empty-state render. |
| REQ-023 | Yes | — | — | — | Unit on `highlightTerms` util. |
| REQ-024 | — | Yes | — | — | Hono route test: 201-char `q` → 400. |
| REQ-025 | — | Yes | — | — | Hono route test: inverted range → 400. |
| REQ-026 | — | Yes | — | — | Hono route test: `from=garbage` → 400. |
| REQ-027 | — | Yes | — | — | Stub logger; assert one entry per request. |
| REQ-028 | — | — | — | Yes | Manual perf gate: seed 1k archives, run 100 queries, P95 ≤ 200 ms. Captured in functional-verify report. |
| REQ-029 | — | Yes | — | — | DB introspection of function source + column expression. |
| EDGE-001 | — | Yes | — | — | Same suite as REQ-001/005. |
| EDGE-002 | Yes | — | — | — | Frontend hook test for min-length gate. |
| EDGE-003 | — | Yes | — | — | API test with `q="claude -agentic"`. |
| EDGE-004 | Yes | — | — | — | Serializer unit covers override precedence. |
| EDGE-005 | Yes | Yes | — | — | Serializer + repo test with null digest fields. |
| EDGE-006 | — | Yes | — | — | Same as REQ-004. |
| EDGE-007 | — | — | — | Yes | Manual reasoning + comment in code; not unit-testable cheaply. |
| EDGE-008 | — | Yes | — | — | API test with seeded `'Côté'` row, `q="cote"`. |
| EDGE-009 | — | Yes | — | — | API test with multi-token `q`. |
| EDGE-010 | — | Yes | — | — | Hono route test with `limit=1000`. |
| EDGE-011 | — | Yes | — | — | Hono route test with `limit=-1`. |
| EDGE-012 | Yes | — | — | — | Serializer unit with synthetic 100 KB content; truncation verified. |
| EDGE-013 | — | — | — | Yes | Verified at probe stage; documented in spec; migration uses `IF NOT EXISTS`. |
| EDGE-014 | — | Yes | Yes | — | API + Playwright cover. |
| EDGE-015 | Yes | — | Yes | — | Unit on preset selection; Playwright interaction. |
| EDGE-016 | — | Yes | — | — | API test with `from === to`. |
| EDGE-017 | Yes | — | — | — | Unit on result row: term-only-in-story → no `<mark>`. |
| EDGE-018 | Yes | — | — | — | Component snapshot showing literal `<script>` rendered as text. |
| EDGE-019 | Yes | — | — | — | Same as EDGE-018 for the result-meta strip. |

## Verification Scenarios

These run during the `functional-verify` stage at the end of the pipeline. The first two are inherited from library-probe Step 6 (verification stubs). The rest exercise the feature end-to-end.

### VS-0-rdp-render: Library probe — react-day-picker SSR range render
**Type:** node script
**Run:** see `docs/spec/add-archive-keyword-search/probes/verification-stubs.md`
**Expected:** exit 0, `ok: true` for all DOM checks.

### VS-0-unaccent-fts: Library probe — Postgres unaccent + FTS
**Type:** bash
**Run:** `bash docs/spec/add-archive-keyword-search/probes/unaccent/probe.sh`
**Expected:** exit 0, `ALL OK` in log; all 7 functional checks pass (extension, accent strip, immutable wrapper, generated tsvector, English stem match, accent-insensitive match, websearch operators).

### VS-1-empty-query: GET /api/archives/search with no params
**Type:** api
**Run:** `curl -s 'http://localhost:3001/api/archives/search'`
**Expected:** 200 OK; `archives.length` equals number of reviewed archives in DB (capped at 50); shape matches `ArchiveListItem`; no `q`/`from`/`to` echoed.

### VS-2-keyword-only: keyword match against seeded content
**Type:** api
**Run:** seed an archive whose digest summary contains the unique token `xenotron-9000`, then `curl 'http://localhost:3001/api/archives/search?q=xenotron-9000'`.
**Expected:** 200; exactly that one archive returned; `total === 1`.

### VS-3-range-only: date-range filter without keyword
**Type:** api
**Run:** seed three archives with `completed_at` `2026-04-01`, `2026-04-15`, `2026-05-01`, then `curl 'http://localhost:3001/api/archives/search?from=2026-04-10&to=2026-04-30'`.
**Expected:** 200; only the Apr 15 archive returned.

### VS-4-keyword-and-range: combined filter
**Type:** api
**Run:** combine VS-2 and VS-3 conditions.
**Expected:** 200; intersection of both filters; `total` reflects intersection.

### VS-5-override-precedence: search hits override, not original recap
**Type:** api
**Run:** seed an archive whose `raw_items.metadata.recap.summary === 'original'` and whose `RankedItemRef.summary === 'overridden-token'`. Save via `PATCH /api/admin/archives/:runId`. Then `curl '…/search?q=overridden-token'`.
**Expected:** archive present in results; query for `q=original` returns the archive absent (override won).

### VS-6-accent-insensitive: query without accent matches accented content
**Type:** api
**Run:** seed an archive whose digest summary contains `'Côté'`. `curl '…/search?q=cote'`.
**Expected:** archive returned.

### VS-7-frontend-empty: UI empty state
**Type:** ui (Playwright)
**Run:** Navigate to `/?q=zzz-no-match-zzz` against a DB without that term.
**Expected:** Mock Frame 3 layout: eyebrow `NO MATCHES`, serif headline contains `zzz-no-match-zzz`, no row elements.

### VS-8-frontend-search-flow: type → results → clear
**Type:** ui (Playwright)
**Run:** Navigate `/`. Type `claude` in the search input. Wait 300 ms. Click `Clear`.
**Expected:** After typing: URL contains `q=claude`; result-meta strip visible; rows filtered. After Clear: URL has no `q`; full listing restored; month headers visible again.

### VS-9-frontend-range-picker: open chip, pick preset, apply
**Type:** ui (Playwright)
**Run:** Click date chip, click `Last 30 days` preset, click `Apply`.
**Expected:** Popover closes; URL has `from`/`to` params spanning 30 days; chip reads `<MMM D> – <MMM D>, YYYY`; result-meta strip includes ` · <range>`.

### VS-10-perf-gate: P95 < 200 ms at 1k archives
**Type:** perf (manual / scripted)
**Run:** Seed 1,000 reviewed archives (synthetic), run 100 sequential `GET /api/archives/search?q=<random-token>` queries.
**Expected:** P95 latency ≤ 200 ms.

## Out of Scope

- Search inside `/admin` (admin dashboard lists *runs*, not curated archives — separate feature).
- Search inside `/admin/review/:runId` to find a specific story within one run.
- Pagination beyond `limit` (use date-range to narrow further). No `offset`/cursor in v1.
- Phrase search via quoted strings — `websearch_to_tsquery` supports it natively, but UX (auto-balanced quotes, highlighting) is deferred.
- Per-source / per-author filters beyond keyword inclusion.
- Saved searches, search history, or suggestions/autocomplete.
- Server-side rate limiting beyond `q.length ≤ 200` and `limit ≤ 50`.
- Full bullet/bottom-line highlighting in the UI (only digest headline + digest summary get inline highlights).
- Non-English stemming. (Project content is overwhelmingly English; non-English tokens still match exactly, but won't stem.)
- Backfill telemetry beyond a one-time migration log.
