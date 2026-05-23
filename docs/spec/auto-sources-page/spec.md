# SPEC — Auto Sources Page

**Feature:** `auto-sources-page`
**Design doc:** `docs/plans/2026-05-23-auto-sources-page-design.md`
**Date:** 2026-05-23

A public `/sources` page that builds itself from data already in the system. No hand-curated source lists, no LLM classification. Sections derive from the `SourceType` enum; rows derive from `run_archives.sourceTelemetry`. Augmented with Today / This Week / In Digest / Status columns. Shows the live `rankingPrompt`.

## Requirements (EARS)

### REQ-001 — Public route and layout
**When** a visitor navigates to `/sources`, **the system shall** serve the Sources page rendered inside `PublicLayout` (no admin gate, no authentication required).

### REQ-002 — Section taxonomy from SourceType enum
**When** the page renders, **the system shall** create at most one section per `SourceType` enum value (`hn`, `reddit`, `twitter`, `rss`, `github`, `blog`, `newsletter`, `web_search`), in that fixed order, using labels from a centrally-defined `SOURCE_TYPE_SECTION_LABELS` mapping in `@newsletter/shared/constants`.

### REQ-003 — Empty sections omitted
**When** a `SourceType` has zero rows in the lookback window (7 days), **the system shall** omit the entire section (no "No items" placeholder).

### REQ-004 — Row identity by sourceTelemetry identifier
**When** the page renders rows within a section, **the system shall** aggregate by `(sourceType, identifier)`, where `identifier` is derived from `raw_items` URL via the pure function `deriveRawItemIdentifier({sourceType, url, sourceUrl})` defined in `@newsletter/shared/services`.

### REQ-005 — Identifier derivation rules (exhaustive switch on SourceType)
**When** `deriveRawItemIdentifier` is called, **the system shall** apply this rule per `SourceType` with a `never`-checked exhaustive switch:
- `hn` → `"news.ycombinator.com"`
- `reddit` → `r/<subreddit>` from `/r/([^/]+)/` regex on URL (case-preserved)
- `twitter` → `@<handle>` from `(?:x\.com|twitter\.com)/([^/]+)/status/` regex
- `rss` → hostname of URL (lowercased)
- `github` → `<owner>/<repo>` from `github\.com/([^/]+)/([^/]+)` regex
- `blog` → hostname of URL (lowercased)
- `newsletter` → hostname of URL (lowercased)
- `web_search` → fixed string `"web search"`

If the regex does not match (malformed URL), fall back to hostname; if URL is missing/empty, return `"unknown"`.

### REQ-006 — Per-row columns
**When** the page renders a row, **the system shall** display:
- **Display name** — `sourceTelemetry.displayName` for the matching `(sourceType, identifier)`; if no telemetry entry has been seen, fall back to the `identifier` itself.
- **Today count** — count of `raw_items` with matching `(sourceType, derived identifier)` and `collected_at >= start_of_today_UTC`.
- **Week count** — same, with `collected_at >= now - 7 days`.
- **In digest count** — count of distinct `raw_items.id` referenced by `ranked_items[].rawItemId` across all `run_archives` rows with `reviewed=true` AND `status='completed'` AND `completed_at >= now - 7 days`, restricted to items matching this row's `(sourceType, derived identifier)`.
- **Status** — one of `healthy | failing | idle` per REQ-008.

### REQ-007 — Row sort order
**When** rows are listed within a section, **the system shall** sort them by `todayCount desc, displayName asc` (case-insensitive).

### REQ-008 — Status classification
**When** computing per-row status, **the system shall** classify as:
- `healthy` — most recent telemetry entry for the row has `status="completed"` AND `itemsFetched>0` AND the row's `lastFetchedAt >= now - 14 days`.
- `failing` — most recent telemetry entry has `status="failed"` OR `lastFetchedAt is null` OR `lastFetchedAt < now - 14 days` (with some prior telemetry existing).
- `idle` — otherwise.

### REQ-009 — Ranking prompt displayed in full
**When** the page renders, **the system shall** display the live `user_settings.rankingPrompt` value verbatim in a styled monospace block at the bottom of the page (no collapse, no truncation, no expand button — fully visible).

### REQ-010 — No subheadline / section intros
**When** sections render, **the system shall not** render any per-section intro/description text (matches the user's explicit "subheadline not needed for now" requirement). The page-level deck remains.

### REQ-011 — Single backend endpoint
**When** the frontend loads the page, **the system shall** call exactly one HTTP endpoint, `GET /api/sources/summary`, which returns the entire response body needed to render the page. No N+1 follow-up calls.

### REQ-012 — Response shape
**When** `GET /api/sources/summary` is called, **the system shall** return JSON matching:
```ts
{
  generatedAt: string;           // ISO 8601
  sections: Array<{
    sourceType: SourceType;
    rows: Array<{
      identifier: string;
      displayName: string;
      url: string | null;
      todayCount: number;
      weekCount: number;
      inDigestCount: number;
      status: "healthy" | "idle" | "failing";
      lastFetchedAt: string | null;  // ISO 8601 or null
    }>;
  }>;
  rankingPrompt: string;
}
```

### REQ-013 — No LLM call when building the page
**When** the backend constructs the response, **the system shall not** invoke any LLM. Construction is pure SQL + JS over existing tables.

### REQ-014 — No hand-curated source data in code
**When** the codebase is read, **the system shall not** contain any list of source names, subreddit names, blog names, or URLs hard-coded for the Sources page. The only static config is the eight-entry `SourceType → label` mapping (REQ-002).

### REQ-015 — Public exposure of rankingPrompt is safe
**When** `rankingPrompt` is sent over `/api/sources/summary`, **the system shall** return the verbatim contents of `user_settings.rankingPrompt`. No transformation, no redaction. (The product owner has confirmed this string is editorial-only and contains no secrets.)

### REQ-016 — Web bundle subpath imports
**When** the frontend imports shared types/constants, **the system shall** use `@newsletter/shared/types` or `@newsletter/shared/constants` subpaths — never the root `@newsletter/shared` — to avoid bundling DB code into the browser. (Enforces `web-shared-subpath-imports` learning.)

### REQ-017 — Source-type identifier derivation lives in shared
**When** `deriveRawItemIdentifier` is implemented, **the system shall** place it in `packages/shared/src/services/source-identifier.ts` and export it from `@newsletter/shared/services` so both API (for SQL CASE generation / fallback) and frontend can reference it consistently.

### REQ-018 — Postgres CASE expression aligned with JS function
**When** the API runs the count aggregation queries, **the system shall** use a Postgres `CASE` expression that mirrors `deriveRawItemIdentifier`'s logic exactly. The two must be kept in sync; a unit test feeds at least one URL per `SourceType` through both the JS function and (via a `db.execute` call) the SQL expression, asserting equality.

## Verification Scenarios

### VS-1 — Page loads with all eight sections when data exists
**Given** raw_items rows exist with at least one row per `SourceType` and at least one reviewed archive in the last 7 days, **when** a visitor opens `/sources`, **then** the page renders eight section headers in the order `Hacker News → Reddit → X (Twitter) → RSS Feeds → GitHub → Engineering Blogs → Newsletters → Web Search`, **and** the live `rankingPrompt` appears in full at the bottom.

### VS-2 — Empty sections are omitted
**Given** only `hn` and `reddit` raw_items exist in the last 7 days, **when** the page loads, **then** only "Hacker News" and "Reddit" sections render — no placeholder for the other six.

### VS-3 — Today/Week/InDigest counts are accurate
**Given** five `r/LocalLLaMA` raw_items collected today, three collected yesterday, and two of today's items appear in a reviewed archive's `rankedItems`, **when** the page loads, **then** the `r/LocalLLaMA` row shows `Today=5, This Week=8, In Digest=2`.

### VS-4 — Status reflects most-recent telemetry
**Given** the most recent reviewed archive's `sourceTelemetry` shows `(reddit, r/LocalLLaMA)` with `status="failed"`, **when** the page loads, **then** the row's status glyph is `✕ failing`.

### VS-5 — Identifier derivation matches across JS and SQL
**Given** representative URLs for each `SourceType` (`https://x.com/karpathy/status/1`, `https://reddit.com/r/LocalLLaMA/comments/abc`, `https://anthropic.com/engineering/post-x`, `https://github.com/anthropics/claude-code/blob/main/x.py`, etc.), **when** both `deriveRawItemIdentifier(item)` (JS) and the API's SQL CASE expression are evaluated on each URL, **then** the outputs are identical strings.

### VS-6 — `rankingPrompt` is the live value
**Given** an admin updates `user_settings.rankingPrompt` via `PUT /api/settings` to the string `"TEST_PROMPT_42"`, **when** any visitor opens `/sources` immediately after, **then** the rendered ranking-prompt block contains `TEST_PROMPT_42`. (No worker restart, no cache eviction needed.)

### VS-7 — No LLM calls during page render
**Given** the orchestration test harness intercepts `@ai-sdk/anthropic` calls, **when** `GET /api/sources/summary` is called, **then** zero LLM invocations are recorded.

### VS-8 — Sort order
**Given** two `reddit` rows: `r/LocalLLaMA` with `todayCount=3` and `r/MachineLearning` with `todayCount=5`, **when** the page loads, **then** `r/MachineLearning` appears above `r/LocalLLaMA`.

### VS-9 — Fall back to identifier when displayName missing
**Given** a `(sourceType, identifier)` pair appears in raw_items but the source has never produced a telemetry entry yet, **when** the page loads, **then** the row's display name equals its identifier.

### VS-10 — Public access (no admin cookie)
**Given** a request with no `admin_session` cookie, **when** the client calls `GET /api/sources/summary`, **then** the response status is `200` and the body matches the response shape in REQ-012.

### VS-11 — `pnpm typecheck` and `pnpm lint` pass
**Given** the feature is implemented, **when** `pnpm typecheck` and `pnpm lint` are run at the repo root, **then** both exit with status 0.

### VS-12 — Web bundle does not leak Drizzle into the browser
**Given** the feature is implemented, **when** `pnpm --filter @newsletter/web build` is run, **then** the bundle does not contain `postgres` or `drizzle-orm` modules. (Enforces REQ-016 via build output inspection.)

## Out of scope

- Bar charts / sparklines per source.
- Per-source detail page.
- Caching / CDN headers on the endpoint.
- Adding sources that the system *aspires* to scrape but doesn't yet (only sources with actual data appear).
- Source sub-categorization (e.g. splitting `blog` into "Labs" / "Independent" — explicitly rejected).

## Risks (recap from design)

1. **Identifier alignment between JS function and SQL CASE expression.** Single source of truth: keep the JS function authoritative; the SQL CASE is generated from the same constants where possible, and a unit test cross-checks them.
2. **Old raw_items rows may have weird/null URLs** — the function's "fall back to hostname, then to `unknown`" guards against this.
3. **`web_search` collapses to a single row** — by design (the search engine itself, not the individual result domains).
