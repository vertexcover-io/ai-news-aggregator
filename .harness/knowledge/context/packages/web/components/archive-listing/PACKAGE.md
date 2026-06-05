---
governs: packages/web/src/components/archive-listing/
last_verified_sha: ad0153a
key_files: [ArchiveRow.tsx, SubscribeInline.tsx, DateRangePopover.tsx, DateRangeChip.tsx, SearchBar.tsx, FilterTabs.tsx, EmptyResults.tsx, ResultMeta.tsx, format.ts]
flow_fns: [ArchiveRow.tsx::ArchiveRow, SearchBar.tsx::SearchBar]
decisions: [D-021]
status: active
---

# components/archive-listing/ — public archive listing components

## Purpose

Components for the public archive listing on the home page (`/`) and the archive detail page (`/archive/:runId`): Ledger-aesthetic issue rows with date blocks, headline, dek, and story count, plus search and date-range filtering UI.

## Public surface

| Component | Effect |
|---|---|
| `ArchiveRow({ item, issueNumber, featured, highlightTerms? })` | **(live — consumed by `HomePage`)** Single issue row: 3-column grid (date block \| headline + dek \| story count + "Read →"), linked to `/archive/:runId` when stories exist |
| `SubscribeInline({ variant })` | **(live — consumed by `ArchivePage`)** Inline subscribe prompt rendered mid-archive or mid-issue |
| `DateRangePopover({ value, onChange, onApply })` | Calendar popover with presets (Last 7/30/90 days, This year, All time) + custom date picker — used only by `DateRangeChip` |
| `SearchBar` / `DateRangeChip` / `FilterTabs` / `EmptyResults` / `ResultMeta` | **(ORPHANED — no page consumes them, see Gotchas)** search/date-range/month-filter listing UI from the old `listArchives`/`searchArchives` flow; still exported, no live consumer |
| `format.ts` | `parseLocalDate(runDate)` — creates UTC Date from "YYYY-MM-DD" string |

## Depends on / used by

- **Uses:** `lib/highlightTerms`, `lib/dateRange`
- **Used by:** `pages/HomePage.tsx` (ArchiveRow only), `pages/ArchivePage.tsx` (SubscribeInline only). The home listing now sources from `GET /api/home` via `api/home.ts::getHome` + the `components/home/*` blocks — the search/filter components no longer have a consumer.

## Data flows

```
ArchiveRow({ item, featured, highlightTerms }):
  item: { runId, runDate, storyCount, topItems, leadSummary, digestHeadline, digestSummary }
    → hasStories = storyCount > 0
    → headline = applyHighlight(topItems[0]?.title ?? digestHeadline ?? "—", highlightTerms)
    → dek = digestSummary ?? (featured ? leadSummary : null)
    → 3-column grid:
       ├─ DateBlock: DOW (mono) | day (serif) | year (mono)
       ├─ headline (serif, featured: 28px else 22px) + dek (14.5px sans, line-clamp-2)
       └─ "N stories" + "Read →" (mono uppercase, underlined)              (D-021)
  Row wrapped in <Link to={/archive/:runId}> when hasStories

SearchBar → URL-synced search input:
  value → onChange → updates URL param `?q=`
    └─ Clear button resets value + URL param
```

## Gotchas / landmines

- **ArchiveRow empty run handling** (D-021): An archive run with `storyCount === 0` and `topItems.length === 0` renders "No stories" in mono instead of a serif headline, and the row is NOT a link. This handles edge cases like a run that completed but ranked zero items.
- **Date parsing**: `parseLocalDate` creates a UTC date from `YYYY-MM-DD` (e.g., `2026-05-15` → `Date(2026,4,15,0,0,0,0,UTC)`). This is used for display formatting only (e.g., `Intl.DateTimeFormat`), not for calculations. The actual archive ordering uses the server's `runDate`.
- **highlightTerms** is passed through from search results: the `ArchiveRow` can render with `<mark>` tags around matching terms when the row comes from a search query. The highlight function escapes regex special characters before building the pattern.
- **`MonthHeader.tsx` was deleted** (dead-code removal a844f41) — month-group headers are no longer rendered on `/`. The home listing switched to `GET /api/home` (`HomePagePayload` + `components/home/*` blocks) and no longer does client-side month grouping/search/date-range filtering. The `SearchBar`/`DateRangeChip`/`FilterTabs`/`EmptyResults`/`ResultMeta` components survive as orphans (still exported, no consumer) — candidates for a future dead-code sweep.

## Decisions

### D-021: ArchiveRow is not a link when no stories

**Why:** A run with zero stories has no content to show on the detail page. Linking to it would show an empty page with "No stories in this issue." — wasteful.

**Tradeoff:** The operator can't access the archive detail page for a zero-story run from the listing. They can still reach it via the admin dashboard. Acceptable — zero-story runs shouldn't exist in production (they occur only during pipeline edge cases).

**Governs:** `components/archive-listing/ArchiveRow.tsx`
