# Archive Keyword Search — Design

**Date:** 2026-05-07
**Author:** Aman + Claude (orchestrate pipeline)
**Spec dir:** `docs/spec/add-archive-keyword-search/`
**UI mock:** `docs/spec/add-archive-keyword-search/mocks/search-ui.html` (4 frames, approved)

## Problem Statement

The public archive listing at `/` shows reviewed newsletter issues grouped by month with a "Load more" control. As the archive grows past a few dozen issues, readers and the team need a way to find specific issues by keyword (model name, company, story author, etc.). The search must cover the **entire content** the team has produced — digest headline/dek and every story's title, source, author, summary, bullets, and bottom line — not only the lightly-loaded fields the listing currently shows.

## Context

- Public listing today: `GET /api/archives` returns all reviewed archives (no pagination, no search) with only digest headline/summary, top-3 item titles, and a `leadSummary`. The frontend (`ArchiveListingPage.tsx`) slices to 10 visible rows and grows on "Load more".
- Story content is **not** in the listing payload. Full recap (`summary`, `bullets`, `bottomLine`, source, author) is only fetched on the detail route `/archive/:runId`.
- Story content can be **overridden** during review: `RankedItemRef` may carry per-item `summary`/`bullets`/`bottomLine` overrides that take precedence over `raw_items.metadata.recap` at hydration time. Search must respect overrides.
- Postgres 16, no FTS yet. `pg_trgm` and `unaccent` extensions are available.
- `/api/archives` is **public** — search must be safe to expose without auth, and must avoid sequential scans on every keystroke.

## Requirements

### Functional

1. A search input on `/` that searches the **entire content** of every reviewed archive: digest headline, digest summary, and per-story title, source, author, **effective summary, bullets, bottom line** (override-aware).
2. A date-range picker beside the search input. Filter narrows results to archives whose `completedAt` (review date / publish date) falls within the chosen range. Quick presets: Last 7/30/90 days, This year, All time.
3. Result rows visually identical to existing listing rows — no per-row "Matched in X" decoration. Inline `<mark>` highlighting on the digest headline / dek when the term appears there. (Matches inside story content do not get inline highlights — the row simply appears.)
4. Empty / no-match state with helpful copy.
5. "All time" + empty query = current behavior unchanged.

### Non-functional

- **Latency:** P95 < 200 ms for queries returning ≤ 50 archives, on a corpus of ~1,000 archives × ~12 stories each (~12,000 story rows).
- **Public-safe:** Cannot allow a malicious query to DoS the DB. Use indexed FTS, not ILIKE; cap query length; cap per-request return size.
- **Override-aware:** Overrides applied at review time must be searchable immediately after review save (no stale FTS).
- **Backwards-compatible:** Pre-VER-96 archives (no `digest_headline`/`digest_summary`) still searchable via fallbacks.

### Edge cases

- Empty query → return all archives (existing behavior).
- Single-character query → ignore (require ≥ 2 chars to query API; below that, frontend doesn't fire).
- Multi-word query → AND semantics (all terms must match somewhere in the content).
- Phrase search ("..." quoted) — out of scope for v1; treat as plain tokens.
- Stop words (the, of, a) — Postgres english config strips them; acceptable.
- Apostrophes / accents — `unaccent` so "openai" matches "OpenAI" and "agentic" matches "agentic".
- Archive with **no reviewed `rankedItems`** (status=completed but reviewed=false) → not in search results (search is for reviewed archives only, mirroring `listReviewed`).
- Concurrency: review save + search query at the same time → search may briefly miss the new override; eventual consistency is fine because indexes are maintained transactionally.

## Key Insights

1. **Search content is precomputed at review-save time.** The listing already does not load full story content per archive — generating it on every search query would be expensive. We compute a denormalized `search_text` field per archive when an archive is created or its review is saved, and FTS-index that single column. Story-level `raw_items.metadata.recap` and per-item overrides are flattened into one big text blob; FTS handles the rest.
2. **Date filtering on `completed_at` is trivially indexed** with a B-tree; combined with a GIN FTS index, Postgres uses the most selective index first.
3. **No per-row "match in story X" decoration** (per UI feedback) → we don't have to return story-level matches. The API only returns the same shape as `listArchives` — the frontend just shows fewer rows. This dramatically simplifies both the API and the UI.

## Architectural Challenges

### 1. Where does `search_text` live and how is it kept fresh?

**Options:**
- (a) New column `search_text TEXT` + `search_tsv tsvector` on `run_archives`, populated by API write paths (review save, AUTO_REVIEW path) **and** a one-time backfill migration for existing reviewed archives.
- (b) Materialized view joining `run_archives` × `raw_items`, refreshed on every review save.
- (c) Compute on every query via a SQL expression — too slow.

**Choice: (a)**. Single source of truth, indexed, no MV refresh cadence. The override-merge logic that already exists (`hydrateRankedItems`) is mirrored once when we serialize search text. Two write sites (`PATCH /api/admin/archives/:runId` review save + AUTO_REVIEW path in pipeline) are the only places this needs to be regenerated. Backfill via a one-shot script.

### 2. How is FTS configured for English + accent-insensitive matching?

Use `to_tsvector('english', unaccent(search_text))` for both the indexed column and the query. A generated column (`GENERATED ALWAYS AS ... STORED`) keeps the tsvector automatically in sync with `search_text`, so we only have to maintain `search_text` in app code. GIN index on the tsvector column.

### 3. Date range — sent as ISO strings, validated server-side.

Query params: `?q=<term>&from=YYYY-MM-DD&to=YYYY-MM-DD`. Validation via zod. `from`/`to` interpreted in UTC against `completed_at`. Missing `from` → epoch; missing `to` → now. Inverted range → 400 error.

### 4. Search endpoint shape

`GET /api/archives/search?q=...&from=...&to=...` — separate route from `/api/archives` (per user choice). Returns the same `ArchiveListResponse` shape so the frontend can swap data sources without rewriting `ArchiveRow`. When `q` is empty, the route returns the same data as `/api/archives` filtered by date — i.e. the date-range filter applies independent of the search term.

### 5. Frontend state — URL-driven

Search query and date range serialized into URL query params (`?q=foo&from=2026-04-01&to=2026-05-07`) so links are shareable and refresh-safe. Default range is "All time" (no params). React Query key includes the params so caching just works.

### 6. Where the override merge lives for `search_text` generation

Use the existing `hydrateRankedItems` service or a small sibling `serializeArchiveSearchText(rankedItems, rawItemsById)` that returns a single string. Same override semantics. Lives in `packages/api/src/services/`. The pipeline AUTO_REVIEW path imports this from API (already a precedent? — must check; if not, move to shared). **Action:** if cross-package import is restricted by ESLint rules, the serializer lives in `@newsletter/shared` and both api + pipeline import it.

## Approaches Considered

### A. Postgres FTS with denormalized `search_text` column (chosen)

- New columns: `run_archives.search_text TEXT`, `run_archives.search_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', unaccent(coalesce(search_text, '')))) STORED`. GIN index on `search_tsv`. B-tree on `completed_at` exists implicitly via the row order, but explicit `(reviewed, completed_at DESC)` index helps.
- Write paths regenerate `search_text` on review save / AUTO_REVIEW completion.
- Query: `WHERE reviewed = true AND search_tsv @@ websearch_to_tsquery('english', unaccent($1)) AND completed_at BETWEEN $2 AND $3 ORDER BY ts_rank_cd(search_tsv, websearch_to_tsquery('english', unaccent($1))) DESC, completed_at DESC LIMIT 50`.

**Pros:** Indexed, < 50 ms typical, scales to 10k+ archives, native to Postgres (no new infra), `websearch_to_tsquery` parses user-style queries safely.
**Cons:** Backfill required for existing archives; two write paths must call the serializer; `search_text` can drift if a write path is added without updating it (mitigation: a `serializeArchiveSearchText` helper called in exactly two repo methods).

### B. Trigram (`pg_trgm`) substring search across joined tables

- GIN trigram index on each column we want to search; query joins `run_archives` × `raw_items` and ORs `column ILIKE '%term%'`.
- **Cons:** Joins fan out per archive (12 stories × text columns); index bloat is significant; multi-word queries don't compose well with trigram; ranking is awkward.
- Rejected.

### C. External search engine (Meilisearch, Typesense)

- New service. New infra. Index sync layer. Overkill for ~1k–10k documents.
- Rejected per user constraint and project conventions (no new infra).

## Chosen Approach — High-Level Design

### Data layer (`@newsletter/shared`)

Drizzle schema additions to `run_archives`:
```
search_text  text                  // denormalized search blob; nullable for unreviewed archives
search_tsv   tsvector  GENERATED ALWAYS AS (to_tsvector('english', unaccent(coalesce(search_text, '')))) STORED
```
Indexes:
- `idx_run_archives_search_tsv` GIN on `search_tsv`
- `idx_run_archives_reviewed_completed` BTREE on `(reviewed, completed_at DESC)` if not already present

Migration includes a one-shot UPDATE to populate `search_text` from existing reviewed archives by running the same serializer over current data.

### Serializer (`@newsletter/shared`)

`serializeArchiveSearchText({ digestHeadline, digestSummary, rankedItems, rawItemsById }) → string`

Concatenates with `\n\n` separators:
- `digestHeadline ?? ''`
- `digestSummary ?? ''`
- For each ranked item, in order:
  - `title`, `url-host` (e.g. `news.ycombinator.com`), `sourceType` (e.g. `reddit`, `hn`), `author`
  - **Effective** `summary` (override → recap → '')
  - **Effective** `bullets` joined with `\n` (override → recap → [])
  - **Effective** `bottomLine` (override → recap → '')

Pure function, fully unit-testable, lives in `@newsletter/shared` so both API and pipeline can import it.

### Repo (`@newsletter/api`)

`run-archives.repo.ts`:
- Modify `setReviewed(runId, rankedItems)` (and the AUTO_REVIEW path's update) to also write `search_text = serialize(...)` in the same transaction.
- New method `searchReviewed({ q, from, to, limit })` that runs the FTS query and returns the same row shape as `listReviewed()`.
- When `q` is empty/undefined, the method falls back to a date-filtered `listReviewed`.

### API route (`@newsletter/api`)

New route file `routes/archives-search.ts` mounted on the **public** Hono app:
- `GET /api/archives/search?q=&from=&to=&limit=`
- Zod schema:
  - `q`: string, max 200 chars, optional (empty → date filter only)
  - `from`, `to`: ISO date strings (`YYYY-MM-DD`), optional
  - `limit`: integer 1–50, default 50
- Returns `{ archives: ArchiveListItem[], total: number, q?: string, from?: string, to?: string }`
- 400 on invalid range / over-long query
- Logs at boundary: `{ runId: 'search', q, from, to, count, durationMs }`

### Frontend (`@newsletter/web`)

- `ArchiveListingPage.tsx` reads `q`, `from`, `to` from `useSearchParams`. Constructs query key `['archives', 'search', q, from, to]`.
- New API client function `searchArchives({ q, from, to })` in `src/api/archives.ts`.
- New components in `src/components/archive-listing/`:
  - `SearchBar.tsx` — input with leading glyph, debounced (250 ms) URL param update, `Clear` button.
  - `DateRangeChip.tsx` — chip that opens a popover with `react-day-picker` v9 in range mode + preset chips + Apply/Clear.
- `MonthHeader` is hidden when `q` is non-empty (results are sorted by relevance, grouping by month is meaningless).
- Inline `<mark>` highlight applied only to digest headline + summary client-side (simple regex of unique terms, no XSS risk because we control the source content).
- Result-meta strip above results: "**N issues** match 'q' · APR 8 – MAY 6, 2026".
- Empty state when zero matches.

### Tests

- Shared: unit tests on `serializeArchiveSearchText` (override precedence, missing fields, accent stripping is *not* the serializer's job — that's Postgres).
- API: route tests for valid/invalid params, empty q, date filter only, q only, q + range, override-bearing archives, accent-insensitive ("openai" matches "OpenAI"), websearch operators (`-`, OR), 200ms perf gate on a seeded corpus.
- Web: component tests for SearchBar (debounce, URL sync), DateRangeChip (preset selects, custom range, apply/clear), ArchiveListingPage (renders search-meta when q present, hides MonthHeader, shows empty state).
- E2E (Playwright): type query → URL updates → results filter → click clear → restored.

## External Dependencies & Fallback Chain

### `react-day-picker` (v9.x)

- **Maturity signals:** Actively maintained, ~600k weekly downloads, last release within 60 days, MIT, no deprecation flags. Used in shadcn/ui's Calendar component (which this project may have via shadcn — to be verified during library-probe).
- **Distinct use cases to probe:**
  1. Render a controlled range-mode picker showing two months side-by-side and reflect a programmatic `selected` value.
  2. Apply Tailwind class overrides via `classNames` prop to match Ledger aesthetic (rust accent on edges, warm yellow in-range, mono font on day labels).
  3. Bundle-size sanity: importing only `DayPicker` adds < 30 KB gzip.
- **Auth surface:** None.
- **Fallback chain:**
  1. `react-day-picker` v9 (chosen)
  2. `react-aria-components` `DateRangePicker` (already part of the React ecosystem, headless, accessible) — heavier API surface but very stable.
  3. Build it ourselves — two `<input type="date">` controls + native preset chips. Crude but always works.

### `unaccent` Postgres extension

- **Maturity signals:** Bundled with Postgres core since 9.0. Already enabled in many projects. Project's `compose.yml` runs Postgres 16 — must verify extension is available.
- **Distinct use cases to probe:**
  1. `CREATE EXTENSION IF NOT EXISTS unaccent;` succeeds against the local DB.
  2. `SELECT unaccent('Côté')` returns `'Cote'`.
- **Auth surface:** DB superuser to install (one-time, in migration).
- **Fallback chain:**
  1. `unaccent` (chosen)
  2. Drop accent-insensitive matching for v1 — accept that "Côté" won't match "Cote". The team's content is overwhelmingly English.

### `pg_trgm` (NOT used in v1, listed for completeness)

We are not using trigram. Documenting here so the library-probe knows it's not needed.

## Open Questions

1. Does the project's Postgres image include `unaccent` by default? Library-probe verifies.
2. Does the project already use `react-day-picker` indirectly via shadcn `Calendar`? If so, install the same major version. Library-probe verifies.
3. Should the search be debounced server-side too (rate limit per IP)? Not in v1; revisit if traffic grows.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| `search_text` drifts (a write path forgets to regenerate) | Med | High (silent search misses) | Centralize the serializer; lint rule `no-direct-rankedItems-update` (out of scope for v1, but a unit test verifies both write paths use it). |
| Generated tsvector blocks INSERT on huge `search_text` | Low | Med | Cap serializer output at 64 KB per archive (truncate per-story bottom line if needed); typical archives are < 8 KB. |
| Backfill migration locks `run_archives` table | Low (small table) | Low | Migration runs `UPDATE` in batches if row count > 5k; otherwise a single statement. |
| Public endpoint abused with very long queries | Med | Low | `q` capped at 200 chars in zod; query timeout via Postgres `statement_timeout = 5s` (already set or add). |

## Assumptions

- The team accepts English-language stemming; non-English content (occasional French/German story titles) will still match exact tokens but won't stem.
- `completed_at` (= review timestamp) is the canonical "publish date" for filtering. (Confirmed by reading current listing logic.)
- Result count cap of 50 is acceptable; user pagination is out of scope (use date-range to narrow further).
- "All time" preset = no `from`/`to` params, not a literal "1970–today" range, so SQL gets the cheapest plan.

---

**Approval gate:** This design is internal to the orchestrate pipeline; flows directly to library-probe (Stage 1.5) and spec-generation (Stage 1.7). No human gate here.
