# Design — Redesign `TodaysIssueBlock` (Concept C, clean)

## Problem

`TodaysIssueBlock` is the hero promotion of the most-recent reviewed digest on the public
home page (`/`). The current implementation (`packages/web/src/components/home/TodaysIssueBlock.tsx`)
is a two-column grid: a left text column (date eyebrow, headline, optional dek, a small
"Read today →" pill button) and a right column holding a **decorative rust `§` cover plate**.

Two problems:

1. **The `§` plate is style without substance.** It consumes half the width and conveys no
   information. The user has asked to remove it entirely.
2. **The block doesn't earn its hero position.** Directly below it the home page renders a
   "Recent issues" list (`ArchiveRow`) showing *date → headline → dek → "N stories / Read →"*.
   With the plate gone, today's block would be indistinguishable from a recent-issue row —
   it would look like "row zero," not a front page. It also ignores the data it already
   receives: `storyCount`, `topItems[]`, and each story's `sourceType`.

## Approved visual mock (source of truth for the look)

The exact, user-approved visual is committed at
[`docs/mocks/redesign-todaysissueblock.html`](../../mocks/redesign-todaysissueblock.html)
(clean Concept C). **The implementation must reproduce this mock's layout, spacing, typography,
and styling.** Open it in a browser to see the target. All requirements below are derived from this
mock — when in doubt, match the mock.

## Decision

Rebuild the block as a **front-page "running order"** (Concept C, simplified):

- A rust mono **eyebrow**: `TODAY'S ISSUE · <Weekday>, <Month Day>`.
- The **lead**: oversized Newsreader serif headline (`digestHeadline`) + italic serif dek
  (`digestSummary`), full width, left-aligned.
- A hairline-ruled **running order**: the day's top stories (`topItems[]`, capped at 3 by the
  API) as a numbered list, each row showing a zero-padded rust index, the serif title, and a
  quiet mono **source tag** (Hacker News / Reddit / X / GitHub / …) derived from `sourceType`.
- A rust mono **read affordance**: `+ N more inside →` when `storyCount` exceeds the shown
  rows, otherwise `Read today's issue →`.
- The **entire block is a single `<Link>`** to `/archive/:runId` — every word is clickable.
  Headline shifts to rust on hover; the arrow nudges.

Explicitly **dropped** as "not required" per user direction: issue number (№), the
source-count stat, and the "Top N of M" meta labels. Keep it simple and clean.

### Color theme (unchanged — preserved verbatim)

`#fafaf7` paper · `#14110d` ink · `#8c3a1e` rust accent · `#6b6557` muted · `#e7e2d6` hairline.
Newsreader serif (`font-serif`), Geist Mono (`font-mono`). These are the existing Ledger tokens.

## Mobile-friendly requirements (explicit user ask)

- Use the page's responsive gutters; the block itself adds no fixed horizontal padding (the
  parent `PublicLayout`/home frame owns gutters via `px-4 sm:px-6 md:px-8 md:px-20`).
- The running-order rows are a 3-track grid (`index / title / source`) at `sm+`. At `<sm` the
  source tag **stacks beneath the title** (grid collapses to `index / title`, source on its own
  line) so long titles are never crushed into a one-word-per-line column.
- Headline uses `clamp()` so it scales down on small screens without overflow.
- The whole-block link keeps a comfortable tap target; no hover-only affordances are required to
  understand the block (hover is enhancement only).

## Graceful degradation

- `topItems` empty → omit the running-order list entirely (eyebrow + headline + dek + read line only).
- `digestSummary` null → omit the dek.
- `storyCount <= shownCount` → read line reads `Read today's issue →` (no "+N more").
- Headline precedence: `digestHeadline ?? topItems[0]?.title ?? "Today's issue"` (matches existing).
- Source tag: map known `SourceType` values to display labels; unknown → uppercased raw value.

## External Dependencies & Fallback Chain

**No new external dependencies.** This is a pure presentational refactor of an existing React
component using libraries already in the stack:

- `react` + `react-router-dom` (`Link`) — already used by the current component.
- Tailwind CSS utility classes — already the styling system for `@newsletter/web`.

No npm install, no new API, no schema change, no new shared subpath. `ArchiveListItem`
(`@newsletter/shared/types`) already carries every field used (`runId`, `runDate`, `storyCount`,
`topItems[]` with `sourceType`, `digestHeadline`, `digestSummary`).

→ **Library probe verdict: NOT_APPLICABLE** (no external dependency to verify).

## Out of scope

- No change to `HomePage.tsx` wiring (it already renders `<TodaysIssueBlock issue={todaysIssue} />`).
- No change to the API, `ArchiveListItem` shape, or the home endpoint.
- No change to `ArchiveRow` or other home blocks.
- No new per-issue imagery (none exists in the data model).
