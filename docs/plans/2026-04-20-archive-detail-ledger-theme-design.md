# Archive Detail — Ledger Theme Translation

**Date:** 2026-04-20
**Status:** Design
**Related:** existing `/archive/:runId` page, `/` Ledger listing (shipped in PR #70 / commit 5c7c295)
**Pencil draft:** `pencil-new.pen` — frame `E · Archive Detail (Ledger)` at `(x=5640, y=0)`
**Exported mockups:** `docs/plans/2026-04-20-archive-detail-ledger-mockups/`

- `vU5pz.png` — full page overview
- `0GE85.png` — hero (mono eyebrow + serif headline + meta)
- `eHhn1.png` — Story N°01 (featured, with image plate, UNPACKED list, BOTTOM LINE)
- `oiQRS.png` — Story N°02 (standard section)

> Mockup export was not completed — the Pencil document was never saved from the in-memory `pencil-new.pen` to the mockups directory, so the PNG files above do not exist. The mockups directory (`docs/plans/2026-04-20-archive-detail-ledger-mockups/`) is empty. The implementation proceeded from the written design spec and component descriptions; visual reference is the deployed page at `/archive/:runId`.

## Problem Statement

The public archive listing (`/`) and the single-issue archive detail (`/archive/:runId`)
look like they were designed by two different people. The listing is a deliberate
editorial/print "Ledger" treatment (Newsreader serif display, Geist Mono eyebrows,
cream `#FAFAF7` paper, `#8C3A1E` rust accent, hairline borders, generous whitespace,
numbered N° pattern). The detail page, by contrast, is a generic SaaS card layout
(rounded-xl cards, shadow-sm, colored source-type pills, blue link color, sans-serif
Inter body, gray-50 recap box).

A reader clicking from the listing into a single issue experiences a jarring brand
break: the entry point sets an editorial expectation the destination doesn't deliver.

## Context

Both pages are already shipped. The listing lives in
`packages/web/src/pages/ArchiveListingPage.tsx` and its components under
`src/components/archive-listing/`. The detail page is
`packages/web/src/pages/ArchivePage.tsx` plus `ArchivePageHeader.tsx` and
`ArchiveStoryCard.tsx`.

Typography tokens `--font-serif` (Newsreader) and `--font-mono` (Geist Mono) are
already exposed via `@theme` in `src/index.css` and loaded in `index.html` — the
stack is ready, the detail page simply isn't using it.

Data model is unchanged: each `RankedItem` already carries `recap.summary`,
`recap.bullets`, `recap.bottomLine`, `imageUrl`, source metadata, and engagement
counts. No API changes required.

## Requirements

### Functional

- `/archive/:runId` renders the same data as today — ordered `rankedItems` with
  source metadata, optional image, recap summary, bullets, bottom line, link to
  source.
- Back-navigation to `/` is still available from the page.
- Loading, error, not-found, and still-running states are preserved.
- Page title and meta description are still set.

### Non-functional

- Visual language matches the listing: Newsreader serif display, Geist Mono
  eyebrows with `letterSpacing`, `#FAFAF7` background, `#1A1A1A` text,
  `#8C3A1E` editorial-rust accent, hairline `#1A1A1A1A` dividers.
- Images render as plain rectangles (no `rounded-xl`, no `shadow-sm`) — treated
  as editorial plates, not card media.
- Colored source-type pills (`bg-orange-100`, `bg-blue-100`, etc.) are removed
  in favor of uppercase mono text with letter-spacing.
- Blue link accent (`text-blue-600`) is replaced with the rust accent or with
  plain dark text + underline.
- Reading column stays narrow enough for comfortable long-form reading but
  preserves the 120 / fill / 120 three-column grid the listing uses.

### Edge cases

- Stories without `imageUrl` → skip the image slot; the section collapses to
  eyebrow + headline + lede + bullets + bottom line.
- Stories without `recap` → fall back to the `rationale` string as the lede,
  no bullets or bottom line rendered (current behavior preserved).
- The run's `rankedItems` may be empty (manual run with no results) → show the
  same "no stories" empty state, styled in the new language.
- Item count in the header can be 1 ("1 story") vs many ("N stories") —
  preserve pluralization.
- Very long headlines must wrap without breaking the grid; use `textGrowth`
  / `fill_container` logic.
- Non-completed runs still show the "Run is still in progress" state — restyle
  that too so it doesn't break the vibe.

## Key Insights

1. The data model is already a perfect fit for an editorial layout — `summary`
   wants to be a lede, `bullets` want to be an em-dash list, `bottomLine`
   wants to be a pull-quote. The current sans-serif card is under-selling the
   structure we already produce.
2. The listing's N° pattern (issue numbering) is a brand asset. The detail
   page should own it back: each story gets an N°01, N°02, … on the left
   rail in the same serif display that the listing uses for the month-block
   date.
3. "Theme similar" ≠ "structurally identical". The listing is a scannable
   index; the detail is a reading experience. Share palette, typography, and
   grid — diverge in density and hierarchy.

## Architectural Challenges

- **Hero copy:** the detail page needs a headline. Three options:
  (a) the run's `leadSummary` as the dek,
  (b) the top story's title as the headline,
  (c) a generic "Issue N°82 · Friday, April 18, 2026".
  Choice: hero eyebrow is `WEEKDAY · DATE · ISSUE N°XX` in mono; below it,
  the serif display uses the run's `leadSummary` if present, otherwise the
  top story's title. This matches how the listing already treats
  `leadSummary` as a dek for the featured row.
- **Numbered rank:** today's page uses `rank` prop but doesn't render the
  number. The listing's N° treatment dictates that each story's rank becomes
  visible as a serif display number on the left rail. This is a purely
  presentational decision; no data change.
- **Image treatment:** `ArchiveStoryCard` currently renders a rounded card
  with the image at the top, inset from the page. In the Ledger language,
  images are full-bleed-within-column, square-cornered, with a 1px hairline
  border — they read as plates, not media cards. Apply consistently to
  every story that has an `imageUrl`.

## Approach

**Translate the Ledger aesthetic into the detail page, keeping the story-
content structure we already ship.** No TOC band; no sibling-issues rail.
Just hero + ordered story sections + footer, dressed in the listing's
language.

### High-level page structure

```
Nav             (shared with listing — mono URL, back button, About)
Hero            (mono issue eyebrow, serif headline/leadSummary, meta subline)
Back crumb      (mono "← The Archive", share/subscribe stubs)
Story sections  (one per rankedItem)
End rail        (prev/next issue link, "END · ISSUE N°XX")
Footer          (shared with listing)
```

### Story section anatomy

Three-column grid `120px | 1fr | 120px`, matching the listing row grid.

- **Left rail (120px):** mono `N°` eyebrow + serif display number (e.g., `01`
  at 56px for the lead, 44px for the rest). Lead story additionally shows
  `LEAD STORY` in mono rust.
- **Main (1fr):**
  1. Mono uppercase eyebrow: `SOURCE · DATE · ▲ POINTS · N COMMENTS`
     (`letterSpacing: 2`, `fill: #6B6B66`). No colored pill.
  2. Serif headline (38px for lead, 28px for the rest, `fontWeight: 500`,
     `letterSpacing: -0.4`, clickable to source URL).
  3. Image plate (if `imageUrl` present): full-column width, 320px tall for
     the lead, 220px for the rest, `object-cover`, 1px `#1A1A1A14` hairline,
     no radius, no shadow.
  4. Italic serif lede (Newsreader italic, 22px lead / 17px rest) drawn from
     `recap.summary`. Falls back to `rationale` when `recap` is null.
  5. `UNPACKED` mono eyebrow + em-dash bullets (Inter 15px/14px body, rust
     `—` markers, `lineHeight: 1.55`).
  6. `BOTTOM LINE` block: 3px rust vertical left rule, `#8C3A1E` mono
     eyebrow, serif italic pull-quote (19px lead / 17px rest).
  7. `READ THE ORIGINAL →` mono link, dark text with rust arrow, underline
     on hover.
- **Right rail (120px):** mono `01 / 08` progress counter + hostname in
  smaller mono, right-aligned.

Each section separated by a `1px #1A1A1A1A` bottom hairline, padded
`56px/44px top, 64px/48px bottom` (lead gets the bigger pair).

### Error / empty / still-running states

Restyled in the same language:

- **Loading:** three pulsing `#F2EFE7` placeholder rows in the 120/fill/120
  grid — shares the listing's skeleton approach.
- **Error:** hero stays; body shows a mono "ERROR" eyebrow + serif "Couldn't
  load this issue" + mono "← All issues" link.
- **Not found:** serif "This issue isn't here" + mono "It may have been
  removed or never existed."
- **Still running:** mono "IN PROGRESS" eyebrow + serif "Today's issue is
  still being curated."

## Rejected Alternatives

- **Re-skin cards, keep card structure.** Considered and rejected. Applying
  serif fonts to rounded-xl shadow cards is a half-measure that still looks
  like a dashboard. The point of the Ledger is the *absence* of card chrome.
- **Add an "IN THIS ISSUE" TOC band and a sibling-issues rail.** Drafted in
  the Pencil mockup and rejected after review. TOC duplicates work the
  headlines already do for an 8-item list; sibling-issues needs a new API
  shape (prev/next) or a client slice of the listing and adds weight for a
  page that's meant to feel quiet.
- **Drop images entirely for a pure typographic index.** Cleaner but loses
  the visual punctuation that makes long-scroll reading easier. Keep
  images, but as plates — not cards.

## Component Changes

- **`ArchivePage.tsx`** — replace `bg-white` shell with `bg-[#FAFAF7]`;
  widen container from `max-w-2xl` to a 1120px / `max-w-[1120px]` grid
  with `px-20`; use shared `PublicLayout` nav if it exists, else inline.
- **`ArchivePageHeader.tsx`** → rename conceptually to `ArchiveHero`. Emits
  mono issue eyebrow, serif headline (leadSummary || topStoryTitle), meta
  subline ("N stories · 6 min read"), and a mono back link.
- **`ArchiveStoryCard.tsx`** → restructure into `ArchiveStorySection.tsx`
  (new name reflects it's no longer a card). Props unchanged (`item`,
  `rank`). Layout: three-column grid, numbered rail, serif headline,
  plain-rect image, italic lede, em-dash bullets, rust-rule bottom line,
  mono "Read the original" link.
- **New presentation helpers** (optional) under `src/components/archive/`:
  `IssueEyebrow.tsx`, `BottomLineBlock.tsx`, `UnpackedList.tsx` — only if
  they're reused by the hero; otherwise keep inline.
- **Palette/tokens:** the existing `--font-serif` / `--font-mono` tokens
  are enough. No Tailwind config changes. Inline the rust color as an
  arbitrary value (`text-[#8C3A1E]`) the same way the listing already does
  (`text-amber-700` → swap to `text-[#8C3A1E]` for brand consistency, or
  keep `amber-700` if the tonal difference is acceptable — listing
  currently uses `text-amber-700`, so match that for now rather than
  introducing a new token).

Note: the Pencil mockup uses the deeper rust `#8C3A1E`; the deployed
listing uses Tailwind's `text-amber-700` which resolves slightly brighter.
Worth resolving during implementation — either bring the listing to
`#8C3A1E` or use `amber-700` on the detail page. Flagging as an open
question, not a blocker.

## Open Questions

1. **Accent color:** `#8C3A1E` (Pencil draft) or `text-amber-700` (shipped
   listing)? Picking one unifies the theme. Suggest: `#8C3A1E` for warmth
   and print-press feel; apply to both pages in the same PR or the one
   after.
2. **Hero source text:** use `leadSummary` when present, else top-story
   title. Confirm with a real issue that this reads well.
3. **Max content width:** listing uses `max-w-[860px]`; the Pencil draft
   uses 1120px inner (1280 - 80·2). A 860px column on the detail page
   would feel more "reading" and keep parity. Suggest 860-960px.
4. **Does the listing's featured-row amber day-of-week need to change?**
   Only if (1) resolves to `#8C3A1E`.

## Risks and Mitigations

- **Risk:** images with extreme aspect ratios (very tall portraits) breaking
  the 220/320px fixed-height plate.
  **Mitigation:** use `object-cover` with `max-h` — same approach as today.
- **Risk:** long source names (e.g., some blog domains) pushing the mono
  eyebrow onto two lines and breaking rhythm.
  **Mitigation:** truncate to ~28 chars (same truncation rule the listing
  applies to top-item chips).
- **Risk:** the italic Newsreader lede looking overly formal on terse
  summaries ("Shipped today.").
  **Mitigation:** cap italic to recap.summary only; `rationale` fallback
  stays roman.
- **Risk:** visual regression on smaller screens (phone/tablet).
  **Mitigation:** the 120/fill/120 grid collapses to single-column under
  720px; serif display numbers shrink to inline eyebrow
  (`N°01 · HACKER NEWS · …`).

## Assumptions

- Ledger listing aesthetic is stable — we're matching it, not rethinking it.
- No new data fields needed from the API; the page works off the same
  `RunDetail` shape used today.
- The admin review page (`/admin/review/:runId`) is out of scope for this
  design. It's an operator tool, not public-facing.
- Image placeholder colors in the Pencil mockup (`#E8E4D8`, `#EEE9DB`,
  `#EDE6D4`) are illustrative only — real images render on top of the
  frame; the fill is just a loading/fallback background.
