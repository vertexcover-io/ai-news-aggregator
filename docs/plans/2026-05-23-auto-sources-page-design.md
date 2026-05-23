# Auto Sources Page — Design

## Problem

The marketing/preview HTML at `file:///tmp/agentloop-previews/sources.html` shows a hand-curated `/sources` page with five sections (Community, Labs & Companies, Independent Voices, Research, Newsletters We Trust). The current product has no equivalent public page — the codebase exposes `/admin/sources/:runId` (gated, per-run debug view) but nothing public.

Three requirements from the user:

1. **Build the page automatically from data already in the system.** No hand-curated source lists, no LLM call to classify section names. Sections must derive from values already stored on `raw_items` / `run_archives`.
2. **Augment with Shape B (Live Dashboard columns).** Each source row shows: items collected **today**, items collected **this week**, items that made it **in digest** this week, last-fetched status. Status is healthy / failing based on the most recent run's per-source telemetry.
3. **Show the ranking prompt.** Display the live `user_settings.rankingPrompt` on the same page so visitors understand how the curation is done.

The page must live on the public `/sources` route, gated by nothing, and reachable from the existing PublicLayout nav (which currently has no Sources link).

## Constraints from the codebase

- The repo already has a clean `SourceType` enum on `raw_items.sourceType`: `"hn" | "reddit" | "twitter" | "rss" | "github" | "blog" | "newsletter" | "web_search"`. This is the natural section axis — eight values, fixed at the schema level, no LLM needed.
- `run_archives.sourceTelemetry: RunSourceTelemetry` already holds per-source-unit telemetry per run, including `identifier` (e.g. subreddit name, blog domain), `displayName`, `itemsFetched`, `status`, `errors`, `durationMs`. **This is the row-level identity** — within each `SourceType` section, rows are aggregated by `identifier`.
- `run_archives.rankedItems: RankedItemRef[]` is the curated list that made it into the digest. Joining `rankedItems` back to `raw_items` (via `rawItemId`) gives the per-source "in digest" count.
- `raw_items.collectedAt` is the timestamp for "items collected today / this week".
- `user_settings` is a singleton row holding `rankingPrompt` (TEXT, ≤20000 chars).
- The PublicLayout (`packages/web/src/layouts/PublicLayout.tsx`) wraps `/` and `/archive/:runId` with the Ledger aesthetic. The Sources page lives in the same layout.
- `packages/web/src/App.tsx` defines routes. `/sources` doesn't exist (`/admin/sources/:runId` does but is unrelated).

## Non-goals

- No subscribe form on this page (the masthead's existing CTA is enough).
- No per-source detail page (clicking a source just opens its external URL in a new tab).
- No bar chart (the preview shows one but the user did not ask for a chart in the Shape-B columns — they asked for the columns themselves). Keep it tabular.
- No subheadline / section-intro text (explicitly requested).
- No external dependencies — uses the same React Query + Hono + Drizzle stack already in the repo.

## Design

### Section taxonomy — directly from `SourceType` enum

The eight `SourceType` values map 1:1 to sections, in this fixed order (curated for narrative flow, but the labels themselves come from the enum, no LLM):

| SourceType | Section label |
|------------|---------------|
| `hn` | Hacker News |
| `reddit` | Reddit |
| `twitter` | X (Twitter) |
| `rss` | RSS Feeds |
| `github` | GitHub |
| `blog` | Engineering Blogs |
| `newsletter` | Newsletters |
| `web_search` | Web Search |

The label mapping lives in **shared/constants** (`SOURCE_TYPE_SECTION_LABELS`) so frontend and backend agree. Empty sections (zero rows after the lookback window) are hidden — no "No items" placeholder.

> **No manual curation. No LLM. The section list is whatever `SourceType` enum values appear in the data within the lookback window.**

### Row identity within a section — `sourceTelemetry.identifier`

Within each section, rows are aggregated by `(sourceType, identifier)` pairs found in `run_archives.sourceTelemetry.sources`. So:
- `(reddit, "r/LocalLLaMA")` is one row,
- `(reddit, "r/AI_Agents")` is another,
- `(blog, "anthropic.com/engineering")` is a single row regardless of how many posts came in.

`displayName` from the telemetry entry is the rendered name; `identifier` is the stable key.

### Live Dashboard columns (Shape B)

Per row, four numbers + one status:

| Column | Source | Calculation |
|--------|--------|-------------|
| **TODAY** | `raw_items.collectedAt` | Count of raw_items where `sourceType=X`, source identifier matches, `collectedAt >= start_of_today_UTC` |
| **THIS WEEK** | `raw_items.collectedAt` | Same, but `collectedAt >= now - 7 days` |
| **IN DIGEST** | `run_archives.rankedItems` joined to `raw_items` | Count of `raw_items` referenced by `ranked_items` in any reviewed archive within the last 7 days where the item's `(sourceType, derived identifier)` matches the row |
| **STATUS** | most recent `run_archives.sourceTelemetry` entry for this `(sourceType, identifier)` | `healthy` if last entry's `status === "completed"` AND `itemsFetched > 0` AND last collection within 14 days; `failing` if last entry's `status === "failed"` OR no items in 14 days; `idle` if no recent telemetry for the source but identifier exists historically |

**Identifier derivation for raw_items.** `raw_items` does NOT carry a `sourceName`/`identifier` column. The "today / this week" counts must group raw_items by a *derived* identifier that aligns with telemetry's `identifier`. The derivation is per-source-type:
- `hn` → identifier is the fixed string `"news.ycombinator.com"` (HN is a single source unit; only one row).
- `reddit` → identifier is `r/<subreddit>` extracted from the item's URL (regex `/r/([^/]+)/`).
- `twitter` → identifier is `@<handle>` extracted from the URL.
- `rss`, `blog`, `newsletter` → identifier is the hostname of `raw_items.url` (or `sourceUrl` if set).
- `github` → identifier is `<owner>/<repo>` extracted from the URL.
- `web_search` → all items collapse to a single `"web search"` row.

This logic lives in a single pure function `deriveRawItemIdentifier(item: { sourceType, url, sourceUrl }): string` in **shared/services** with exhaustive switch on `SourceType` (lint-checked `never` arm).

### Status determination

`computeSourceStatus(lastTelemetry, lastCollectedAt, now): "healthy" | "failing" | "idle"`:

```
healthy   if lastTelemetry?.status === "completed" && lastTelemetry.itemsFetched > 0 && lastCollectedAt >= now - 14d
failing   if lastTelemetry?.status === "failed" OR (lastCollectedAt is null) OR (lastCollectedAt < now - 14d AND lastTelemetry exists)
idle      otherwise (e.g. telemetry exists but no items, or no telemetry yet — only show as a row if identifier seen historically)
```

Rendered as a single character: `●` (healthy, ink color), `○` (idle, muted), `✕` (failing, rust accent).

### Backend — single endpoint, no LLM, no caching tier

**New route:** `GET /api/sources/summary` — public, no admin gate.

**Response shape:**
```ts
interface SourcesSummaryResponse {
  generatedAt: string;          // ISO timestamp
  sections: SourceSection[];    // Eight (or fewer) sections, fixed enum order, empty sections omitted
  rankingPrompt: string;        // Live from user_settings.rankingPrompt
}

interface SourceSection {
  sourceType: SourceType;        // For client-side label lookup
  rows: SourceRow[];             // Sorted by todayCount desc, then displayName asc
}

interface SourceRow {
  identifier: string;            // Stable key
  displayName: string;           // Rendered name
  url: string | null;            // External link (from telemetry if available, else null)
  todayCount: number;
  weekCount: number;
  inDigestCount: number;
  status: "healthy" | "idle" | "failing";
  lastFetchedAt: string | null;  // ISO timestamp of most recent collection
}
```

**Implementation:** a single service function `buildSourcesSummary(deps: { rawItemsRepo, runArchivesRepo, userSettingsRepo })` runs three queries:

1. `raw_items` grouped by `(sourceType, derived identifier)` with `count(*) filter (where collected_at >= today)` and `count(*) filter (where collected_at >= week)` and `max(collected_at)`. The `derived identifier` is computed via a Postgres `CASE` expression mirroring `deriveRawItemIdentifier` — this keeps it in a single SQL pass.
2. `run_archives` with `status='completed'` AND `reviewed=true` AND `completed_at >= week`, with the `ranked_items` JSONB array joined to `raw_items` by `rawItemId`. Group by `(sourceType, derived identifier)`, count distinct `rawItemId`.
3. `run_archives.sourceTelemetry` from the most recent reviewed/completed archive per `(sourceType, identifier)` — fetched in a single query that grabs the last 14 days of archives and reduces in JS.

Three queries, no N+1 — joined in JS into `SourceSection[]`. The whole endpoint should be < 200 ms on a warm DB.

**Caching:** none initially. If the page is hit often we add HTTP `Cache-Control: public, max-age=300` later — for now the public archive list has no cache either, so don't pre-optimize.

### Frontend — single page, no fancy state

**New page:** `packages/web/src/pages/SourcesPage.tsx` mounted at `/sources` inside `PublicLayout`.

**Components:**
- `SourcesPage` — top-level. Uses `useQuery(["sources-summary"], fetchSourcesSummary)`.
- Inline within the page: masthead (reuses PublicLayout nav, but we add a new `Sources` link to PublicLayout's nav rendered inside the page or moved into the layout — see "Nav" below), page header (`headline + meta`), sections list, ranking-prompt panel.

**Layout** matches the preview HTML's Ledger aesthetic but uses Tailwind utilities (consistent with the rest of the codebase). Section header is mono-uppercase with a rust border-bottom; rows are a 4-column-grid (name | today | week | in digest | status) on desktop, stacked on mobile (matching the mobile pattern documented in `packages/web/CLAUDE.md`).

**Nav:** the PublicLayout currently has no Nav (it just renders `<Outlet />` and `<Footer />`). The preview HTML has its own masthead+nav. Three options:

1. Add a shared nav to PublicLayout (impacts `/` and `/archive/:runId`).
2. Render the masthead+nav inside `SourcesPage` only.
3. Leave SourcesPage standalone — full Ledger masthead inline.

**Choice: Option 2** — render masthead+nav inside SourcesPage only. The other public pages don't have a top nav today; adding one is a larger scope change.

**Ranking prompt rendering.** The full prompt (~5KB of text) is rendered at the bottom of the page in a `<pre>` block inside a styled card with a "Ranking Prompt" mono header. The text wraps (CSS `white-space: pre-wrap`) and uses the same monospace/serif typography as the rest of the page. No collapse — the user said "show the ranking prompt", not "hide it behind a details".

### Data freshness

- The endpoint reads live from Postgres on every request. Schedule changes / new runs / new prompts are visible immediately.
- The web page uses React Query default cache (5 min staleTime) — refetches on focus.

## External Dependencies & Fallback Chain

This feature has **no external dependencies**. All data is already in Postgres; computations are pure SQL + JS in our own code. No LLM, no third-party API, no new library. The library-probe stage will be a no-op (`NOT_APPLICABLE`).

## Risks

- **Identifier derivation is the foundation.** If `deriveRawItemIdentifier` doesn't match the strings the collectors put in `sourceTelemetry.identifier`, the join falls apart and rows split or duplicate. Mitigation: write the function and the collectors' identifier-emission in alignment, with table-driven unit tests covering every `SourceType`. Compare to actual telemetry values in dev.
- **`raw_items.url` may be missing for some old rows** (especially `web_search` which historically didn't always populate URL). Mitigation: fall back to `sourceUrl`, then to a fixed per-source default.
- **`rankingPrompt` is long.** 5KB of preformatted text could push page size noticeably. It's still tiny in absolute terms (~5KB gzipped is ~2KB). Render inline.
- **Public exposure of `rankingPrompt`.** The prompt is the editorial system prompt — by design the user wants this public so readers see how curation works. No secrets are encoded in it (verified by reading the constant). Safe to expose.

## Acceptance criteria

- GET `/sources` returns 200 with the Ledger-styled HTML page.
- Page shows one section per `SourceType` that has at least one row in the last 7 days. Sections appear in the fixed enum order.
- Each row shows: displayName, today count, week count, in-digest count (last 7 days), and a single status glyph.
- Row sorted by `todayCount desc, displayName asc`.
- The page shows the live `rankingPrompt` in full at the bottom of the page.
- No subheadline / section-intro is rendered (explicit requirement).
- No LLM call is made when building the page.
- No hand-curated source data lives in the code (the only static config is the eight-entry `SourceType → label` mapping).

## Out of scope (deferred)

- Sparkline / bar chart per source.
- Per-source click-through detail page.
- Showing labs / companies that the system *wants* to scrape but has no live collector for (the preview HTML lists "Cursor Blog", "Cognition", "Modal", etc. — these only appear in the data if a collector actually ran and produced telemetry for them).
- Sub-categorization within a `SourceType` (e.g. splitting "blog" into "Labs blogs" vs "Independent voices") — the user explicitly rejected this kind of taxonomy.
