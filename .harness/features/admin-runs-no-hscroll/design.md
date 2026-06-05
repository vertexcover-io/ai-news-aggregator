# Design: Remove horizontal scroll on `/admin` Recent runs

## Problem

The `Recent runs` table on `/admin` (rendered by `RunsTable` at ≥640px) is horizontally scrollable. The user wants the component to stretch to fill the available width and fit all columns inside the viewport — only vertical scroll allowed on the page.

## Root cause

Three contributors, in order of impact:

1. `packages/web/src/components/ui/table.tsx:12` — the shared `Table` primitive wraps every table in `<div data-slot="table-container" className="relative w-full overflow-x-auto">`. This produces a horizontal scrollbar whenever the inner table is wider than its container.
2. `TableHead` / `TableCell` apply `whitespace-nowrap` to every cell. Text-heavy cells (Date, Publish date) and especially the right-aligned `Action` cell can never wrap to reclaim width.
3. `RunsTable` uses `px-6 py-3` (24px horizontal) on every header and cell — ~336px of padding alone across 7 columns. The Action cell additionally packs three controls (primary button + `SocialOverflowMenu` ⋮ + `Trash2` icon button) with a non-wrapping `flex`.

Combined, the table needs ~1100–1300px of horizontal room. Below that, the container scrolls.

## Approach

Scope the fix to the `RunsTable` only — do not modify the shared `Table` primitive (used in many pages where horizontal scroll is desirable / acceptable, e.g. cost dialog, eval results, observability tables).

Three concrete changes, all in `RunsTable.tsx`:

1. **Disable the container's horizontal scroll for this table only.** Apply a descendant override on the outer wrapper:
   `[&_[data-slot=table-container]]:overflow-x-visible`. This neutralizes the primitive's `overflow-x-auto` for this instance only.
2. **Let text cells wrap.** Add `whitespace-normal` to `TableHead`/`TableCell` className on Date, Publish date, Status, Items, Sources (Sources contains two buttons — allow them to wrap onto a second line on narrow viewports via `flex-wrap`).
3. **Tighten padding.** Replace `px-6 py-3`/`px-6 py-4` with `px-3 py-3`/`px-3 py-4`. Saves ~210px across the row.
4. **Allow the Action cell to wrap.** Add `flex-wrap` to the action `div` so primary button + ⋮ + delete can flow to a second row instead of forcing horizontal scroll on the tightest viewports.

## Non-goals

- No changes to `RunsCardList` (already vertical-only on <640px).
- No changes to the global `Table` primitive.
- No layout changes to other pages.
- No removal of columns — all current columns remain visible.

## Verification

- Open `/admin` at a typical desktop width (1280px–1920px): table fills width, no horizontal scrollbar.
- Shrink browser to ~640px (just above the table/card breakpoint): table still fits without horizontal scroll; buttons in Action and Sources may wrap to a second line.
- Page only scrolls vertically.
- All other pages with tables (cost dialog, observability, eval, etc.) remain unchanged — verify by visiting them.

## Files touched

- `packages/web/src/components/dashboard/RunsTable.tsx` — wrapper className, cell paddings, whitespace-normal, action `flex-wrap`.

No new dependencies, no API changes, no schema changes.
