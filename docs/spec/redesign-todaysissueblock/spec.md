# Spec — Redesign `TodaysIssueBlock` (Concept C, clean, mobile-friendly)

## Summary

Rebuild `packages/web/src/components/home/TodaysIssueBlock.tsx` as a clean, full-width,
single-link "front-page running order" for the most-recent reviewed digest on the home page.
Remove the decorative rust `§` cover plate. Keep the existing Ledger color theme and typography.
Make the entire block a link to `/archive/:runId`. Surface the day's top stories with their
source provenance. Be mobile-friendly.

No API, schema, type, or `HomePage` wiring changes. Props remain `{ issue: ArchiveListItem }`.

## Requirements

### REQ-1 — Remove the `§` cover plate
The right-column decorative `<div role="img">` rust `§` plate is deleted. No replacement
decorative element. The component is a single column.

### REQ-2 — Whole block is one link
The eyebrow, headline, dek, running order, and read line are wrapped in a single
`react-router-dom` `<Link to={`/archive/${issue.runId}`}>`. No nested interactive elements
(no inner `<Link>`/`<button>` — nesting anchors is invalid HTML).

### REQ-3 — Lead content
- Eyebrow (rust, `font-mono`, uppercase, tracked): `TODAY'S ISSUE · <Weekday>, <Month Day>`
  using the existing `Intl.DateTimeFormat` weekday + month/day formatting off `issue.runDate`
  (parsed via the existing local-date parse so the date doesn't shift by timezone).
- Headline (`font-serif`, medium, `clamp()` size, ink): `issue.digestHeadline`, falling back to
  `issue.topItems[0]?.title`, then `"Today's issue"`.
- Dek (`font-serif` italic, muted): `issue.digestSummary`; **omitted entirely when null**.

### REQ-4 — Running order
When `issue.topItems` is non-empty, render an ordered list (max 3 rows — the API already caps
`topItems` at 3). Each row:
- zero-padded index (`01`, `02`, …) in rust `font-mono`,
- story title in `font-serif`,
- a source label (`font-mono`, uppercase, muted) derived from `sourceType` via a label map:
  `hn → Hacker News`, `reddit → Reddit`, `twitter → X`, `rss → RSS`, `github → GitHub`,
  `blog → Blog`, `newsletter → Newsletter`, `web_search → Web`. Unknown values → the raw value
  uppercased.
When `topItems` is empty, the list (and its surrounding rules) are not rendered.

### REQ-5 — Read affordance
A rust `font-mono` line with a right arrow:
- `+ N more inside →` when `issue.storyCount > shownCount` (N = `storyCount - shownCount`,
  `shownCount = topItems.length`);
- otherwise `Read today's issue →`.
The arrow nudges right on block hover (enhancement only).

### REQ-6 — Mobile friendly
- Headline scales via `clamp()` and does not horizontally overflow at 390px.
- Running-order rows: at `sm+` a 3-track grid (`index | title | source`); at `<sm` the source
  tag stacks **beneath** the title (rows become `index | title` with source on its own line),
  so long titles wrap normally and are never reduced to one word per line.
- No fixed horizontal padding on the component; horizontal gutters come from the parent home
  frame (`px-4 sm:px-6 md:px-8 … md:px-20`), matching sibling blocks.
- The block is a single tappable link with a comfortable target; nothing essential is
  hover-only.

### REQ-7 — Theme + typography preserved
Colors stay the Ledger tokens (`#fafaf7`, `#14110d`, `#8c3a1e`, `#6b6557`, `#e7e2d6`).
Fonts stay `font-serif` (Newsreader) + `font-mono` (Geist Mono). No new colors introduced.

### REQ-8 — Code quality
- Exported function keeps an explicit `ReactElement` return type.
- No `any`, no unsafe casts (project strict-TS rules).
- `@newsletter/shared` imported only via subpath (`/types`) — never the root barrel
  (per `web-shared-subpath-imports` learning).
- `data-section="todays-issue"` attribute retained for any existing hooks/tests.

## Verification Scenarios

(Folded from `verification/verification-stubs.md`; re-run by functional-verify with Playwright.)

- **VS-1 Card removed** — no `§` cover-plate / `role="img"` plate in the DOM.
- **VS-2 Whole block is one link** — single anchor to `/archive/<runId>`; clicking the headline
  or a story title navigates there.
- **VS-3 Running order + source tags** — top items render numbered with source labels mapped
  from `sourceType`.
- **VS-4 Read affordance** — `+N more inside →` when `storyCount > shown`, else `Read today's issue →`.
- **VS-5 Graceful degradation** — empty `topItems` hides the list; null `digestSummary` hides the
  dek; null `digestHeadline` falls back to top-item title then literal.
- **VS-6 Mobile (390px)** — headline no overflow; titles not crushed; source stacks under title;
  block still one link. Screenshot captured.
- **VS-7 Theme preserved** — Ledger colors + Newsreader/Geist Mono retained.

## Acceptance

- `pnpm --filter @newsletter/web typecheck` → 0 errors (after `@newsletter/shared` build).
- `pnpm --filter @newsletter/web lint` → no new errors beyond the 17 pre-existing warnings.
- New/updated unit test for `TodaysIssueBlock` passes (covers VS-1..VS-5).
- Playwright desktop + 390px mobile screenshots prove VS-1, VS-2, VS-6, VS-7.
- `HomePage` integration unchanged; no console errors on `/`.
