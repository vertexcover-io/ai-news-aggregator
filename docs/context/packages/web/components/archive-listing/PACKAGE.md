---
governs: packages/web/src/components/archive-listing/
last_verified_sha: 5a2ff20
key_files: [ArchiveRow.tsx, SearchBar.tsx, DateRangeChip.tsx, DateRangePopover.tsx, FilterTabs.tsx, MonthHeader.tsx, SubscribeInline.tsx, EmptyResults.tsx, ResultMeta.tsx, format.ts]
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
| `ArchiveRow({ item, issueNumber, featured, highlightTerms? })` | Single issue row: 3-column grid (date block | headline + dek | story count + "Read →"), linked to `/archive/:runId` when stories exist |
| `SearchBar({ value, onChange, placeholder })` | Search input with magnifying glass icon and clear button |
| `DateRangeChip({ range, onChange })` | Date range filter chip showing "ALL TIME" or formatted date range; opens `DateRangePopover` |
| `DateRangePopover({ value, onChange, onApply })` | Calendar popover with preset buttons (Last 7/30/90 days, This year, All time) + custom date picker |
| `FilterTabs({ months, selected, onSelect })` | Horizontal scrollable filter chips for month-based filtering |
| `MonthHeader({ month, year, count })` | Month group header: "JANUARY 2026 · 14 issues" |
| `SubscribeInline({ variant })` | Inline subscribe prompt rendered mid-archive or mid-issue |
| `EmptyResults({ query, from, to })` | Empty state for search results with clear-filters suggestion |
| `ResultMeta({ count, query })` | "14 results for 'agent'" meta line |
| `format.ts` | `parseLocalDate(runDate)` — creates UTC Date from "YYYY-MM-DD" string |

## Depends on / used by

- **Uses:** `lib/highlightTerms`, `lib/dateRange`
- **Used by:** `pages/HomePage.tsx`, `pages/ArchivePage.tsx`

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

## Decisions

### D-021: ArchiveRow is not a link when no stories

**Why:** A run with zero stories has no content to show on the detail page. Linking to it would show an empty page with "No stories in this issue." — wasteful.

**Tradeoff:** The operator can't access the archive detail page for a zero-story run from the listing. They can still reach it via the admin dashboard. Acceptable — zero-story runs shouldn't exist in production (they occur only during pipeline edge cases).

**Governs:** `components/archive-listing/ArchiveRow.tsx`
