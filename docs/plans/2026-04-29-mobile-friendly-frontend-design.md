# Mobile-Friendly Frontend — Design

**Date:** 2026-04-29
**Branch:** feat/mobile-friendly-frontend
**Status:** Approved (brainstorm)

## Problem Statement

The newsletter web app (React + Vite + Tailwind) was built desktop-first. The Ledger
aesthetic relies on rigid 3-column grids with fixed-pixel side rails (120px) and large
horizontal padding (`px-20`). On phones (≤768px), these layouts squeeze content into
2–3 words per line, hide critical metadata behind `md:` gates, and ship tap targets
below the 44×44 px accessibility minimum. The codebase has only ~18% responsive
utility coverage (25 of 138 layout utilities). We need a mobile-friendly pass across
the public listing, the per-run archive view, and admin pages including the DnD
review — without abandoning the Ledger identity.

## Context

- **Stack:** React 19 + Vite + Tailwind v4.2 (default breakpoints).
- **Routes in scope (all):** `/` (public listing), `/archive/:runId` (public recap),
  `/admin/login`, `/admin` (dashboard), `/admin/review/:runId` (DnD), `/admin/settings`,
  the manual `/run` page.
- **Verification:** Playwright MCP at three viewports — 375 (iPhone SE), 768 (tablet),
  1280 (desktop). The harness drives `pnpm --filter @newsletter/web dev`.
- **Min target width:** 375 px. Below that we degrade gracefully but do not test.
- **Aesthetic:** Preserve Ledger — Newsreader serif, Geist Mono eyebrows, `#FAFAF7`
  background, `#8C3A1E` rust accent, hairline dividers. No redesign.

## Requirements

### Functional

- **F1.** Every page in scope renders with no horizontal scroll at 375 px width.
- **F2.** The 3-column grids on `/` (`120px / 1fr / 120px`) and `/archive/:runId`
  (`120px / 1fr / 120px`, plus story cards) collapse to a single stacked column at
  `< md` (768 px). Date/issue rail content moves inline above the headline as a
  Geist-Mono eyebrow row; the meta rail (`N stories / Read →`) moves under the chip
  row.
- **F3.** All interactive elements (filter chips, "Load more", "Run Now", login form
  inputs, DnD handles, nav links, "+ N more" chip) have a hit area of ≥ 44 × 44 px on
  mobile per WCAG 2.5.5 / Apple HIG.
- **F4.** Admin DnD review (`/admin/review/:runId`) supports touch reordering on mobile.
  Use `@dnd-kit` `TouchSensor` with a 250 ms activation delay and a 5 px tolerance
  to avoid hijacking scroll. Provide a visible drag handle on each card (≥ 44 px).
- **F5.** The admin runs table on the dashboard reflows to a stacked card layout on
  `< sm` (640 px) — each row becomes a card with label/value rows; no `overflow-x-auto`
  fallback that hides columns.
- **F6.** Top nav and footer adapt: brand text shrinks one size on mobile; the "About"
  link stays visible (no hamburger needed for this nav size).

### Non-functional

- **N1.** No regression in desktop appearance (≥ 768 px) — every responsive change is
  additive (`md:` overrides). Existing baseline screenshots at 1280 px must remain
  visually equivalent.
- **N2.** Lighthouse mobile performance must not regress more than 3 points vs.
  baseline (CSS-only changes; no new heavy assets).
- **N3.** The whole pass should be CSS / class-only changes plus a small DnD sensor
  swap. No new dependencies. No layout JS.
- **N4.** Type-safe — no `any`, follow project rules. No new lint warnings.

### Edge cases

- **E1.** Very long story headlines wrap without overflowing on 375 px (test with a
  120-char synthetic title).
- **E2.** Story image with extreme aspect ratio (panorama / portrait) does not blow
  out the card width or force horizontal scroll.
- **E3.** A run with 0 stories on `/archive/:runId` still renders cleanly on mobile
  (empty state must fit).
- **E4.** Filter chips on the listing page wrap to multiple rows on mobile rather than
  truncating or scrolling horizontally.
- **E5.** DnD on touch must not start when the user is scrolling the page — the
  250 ms hold + 5 px tolerance covers this; verify with Playwright touch emulation.
- **E6.** Admin login form fits on 375 px keyboard-open (~ 320 px effective height
  after iOS keyboard).
- **E7.** "+ N more" listing chip remains tappable and not visually swallowed by the
  chip row when chips wrap.

## Key Insights

1. **The 120 px rails are the single biggest mobile pain point** — every Ledger
   surface uses them, and they steal half the screen width on a phone. The fix is
   uniform: `grid-cols-[120px_minmax(0,1fr)_120px]` becomes `grid-cols-1` at
   `< md`, with rail content reflowing as eyebrows/meta rows.
2. **Most issues are CSS-only.** Only DnD touch support requires a code change, and
   it's a one-line sensor swap.
3. **Aesthetic preservation favors stacking over redesign.** The chosen "minimal"
   approach keeps the Ledger feel by reusing the same Geist Mono eyebrows and rust
   accents — they just appear above/below the headline instead of beside it.
4. **Tailwind v4 + default breakpoints are sufficient.** No need for custom
   breakpoints; `sm:` (640), `md:` (768), `lg:` (1024) align with our needs.
5. **Browser-harness verification beats screenshot diffs** — assertions on
   `document.scrollingElement.scrollWidth <= window.innerWidth`, computed font sizes,
   and tap-target bounding rects produce deterministic pass/fail rather than fuzzy
   pixel diffs.

## Architectural Challenges

- **Where do "rail contents" go on mobile?** Decision: above headline as a single
  Geist Mono row with `·` separators, e.g. `MON · APR 21, 2026 · ISSUE No. 014`.
  Meta block ("N stories / Read →") moves below the chip row, right-aligned.
- **DnD touch sensor activation strategy.** Decision: use `@dnd-kit` `TouchSensor`
  with `activationConstraint: { delay: 250, tolerance: 5 }` alongside the existing
  `PointerSensor` (which handles mouse). Drag handle becomes a visible Lucide grip
  icon at 44 × 44 px on the left edge of each ReviewCard.
- **Admin runs table on mobile.** Decision: render two layouts conditionally —
  `hidden sm:block` for the table, `sm:hidden` for a stacked card list. No JS branch.
- **Where in the codebase do these changes land?** Per-component, with priority order
  documented in the SPEC. No shared "mobile" CSS file — Tailwind utilities only.

## Approaches Considered

### A. Minimal stacking (chosen)
Add `md:` responsive overrides on existing components; collapse 3-col grids to 1-col
on mobile. Swap DnD sensors. Estimated 8–12 component touches + 1 sensor change.

**Pros:** Smallest diff, lowest risk, preserves desktop pixel-perfectly.
**Cons:** Some redundancy (rail content rendered twice via `hidden md:flex`).

### B. Reflow with mobile-specific hierarchy
Hide entire rails on mobile, build compact mobile cards. Reorganize content priority.
**Pros:** Cleaner mobile result, less DOM duplication.
**Cons:** Diverges from Ledger aesthetic (no eyebrow chrome on mobile feels less
"newspaper"); more design decisions needed; bigger diff.

### C. Mobile-first refactor with container queries
Rebuild components mobile-first with `@container` rules.
**Pros:** Cleanest long-term; resilient to layout changes.
**Cons:** Large rewrite, full re-test of desktop, weeks of work for a personal-use
newsletter. Out of scope.

**Choice: A.** Aligns with the user's "minimal, preserve aesthetic" direction and the
project's explicit anti-scope-creep rule.

## High-Level Design

### Breakpoint plan
- **`< md` (mobile, < 768 px):** stacked single-column layouts, eyebrow rows,
  reduced typography, bigger tap targets.
- **`md` (tablet, 768–1023 px):** desktop layout begins; rails appear; current
  desktop styles apply.
- **`lg+` (≥ 1024 px):** unchanged from today.

### Components to update

| File | Change |
|------|--------|
| `pages/ArchivePage.tsx` | Grid `120/1fr/120` → `grid-cols-1 md:grid-cols-[120px_minmax(0,1fr)_120px]`. Outer padding `px-4 sm:px-6 md:px-20`. Headline `text-3xl md:text-5xl`. |
| `components/ArchiveStoryCard.tsx` | Remove `hidden md:flex` on rails; render rails as eyebrow row above headline on mobile. Image `max-h-[60vw] md:max-h-[320px]`. |
| `components/archive-listing/ArchiveRow.tsx` | Same grid collapse. Eyebrow row with `MON · DATE · ISSUE`. Meta row under chips. Padding `px-4 md:px-2`. |
| `pages/ArchiveListingPage.tsx` | Container `px-4 md:px-6`. Filter chips `flex-wrap`, chip min-height 44 px. Hero `text-3xl sm:text-4xl md:text-5xl`. |
| `pages/DashboardPage.tsx` | Container `px-4 sm:px-6 md:px-8`. Render runs table inside `<div className="hidden sm:block">`; render stacked cards inside `<div className="sm:hidden">`. |
| `pages/ReviewPage.tsx` | Padding `px-4 sm:px-6 md:px-8`. Drag handle column added. |
| `components/review/ReviewList.tsx` + `ReviewCard.tsx` | Add 44×44 drag-handle button with grip icon. Spacing `space-y-4 sm:space-y-3`. |
| `pages/ReviewPage.tsx` (DnD setup) | Add `useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })` to the sensors array. |
| `pages/AdminLoginPage.tsx` | Container `px-4`, input `min-h-[44px]`, button `min-h-[44px]`. |
| `pages/SettingsPage.tsx` | Same padding scale; form fields min-h-44. |
| `pages/RunPage.tsx` | Same padding scale. |
| `components/PublicLayout.tsx` (Nav + Footer) | Brand `text-base sm:text-lg`; padding `px-4 sm:px-6 md:px-8`. |
| `components/ui/button.tsx` (if needed) | Ensure default variant ≥ 44 px on touch. |

### Tap-target enforcement

All buttons, links inside listing rows, chips, and form inputs get `min-h-[44px]
min-w-[44px]` (or equivalent Tailwind), or padding that yields the same.

### Typography scale

Mobile: hero `text-3xl`, headline `text-2xl`, body `text-base`, eyebrow `text-[11px]
tracking-[0.18em]` (kept — it's already small but acceptable per Ledger style).
Avoid `text-[11px]` for any *interactive* element.

### Browser-harness verification (Playwright MCP)

For each route × each viewport (375, 768, 1280):
1. Navigate to URL after `pnpm --filter @newsletter/web dev` is up (port 5173).
2. Take a screenshot for visual record.
3. Assert `document.documentElement.scrollWidth <= window.innerWidth + 1` (no horiz
   scroll; +1 px tolerance for sub-pixel rounding).
4. Query all `button`, `a[href]`, `[role="button"]` and assert each visible element
   has `getBoundingClientRect()` width ≥ 44 AND height ≥ 44 (or `pointer-events:none`).
5. On the DnD review page at 375 px, simulate a touch hold + drag and assert the
   item order changes.
6. Console must report no errors.

These assertions live in a checklist in the SPEC, executed via Playwright MCP from
the harness. No persistent Playwright test files are added to the repo.

## Open Questions

- **OQ1.** Should we add `prefers-reduced-motion` handling for any new animations?
  → No new animations introduced; nothing to do. Note in SPEC.
- **OQ2.** Filter-chip wrapping: cap at 2 rows with horizontal scroll, or unbounded
  vertical wrap? → Unbounded vertical wrap (simpler, fits Ledger).

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| DnD `TouchSensor` interferes with scroll | Medium | High | 250 ms delay + 5 px tolerance; verified via Playwright touch emulation. |
| Hidden mobile content via `hidden md:flex` rails creates duplicate DOM | Low | Low | Conditional render via `hidden`/`md:hidden` siblings; SR users see one path. Verify with axe quick check. |
| Long titles still overflow despite stacking | Low | Medium | `break-words` + `min-w-0` on grid children. Test with synthetic long title. |
| Lighthouse perf regression | Low | Low | CSS-only changes; verify with `pnpm build` size check. |
| Admin DnD touch UX feels laggy | Medium | Medium | 250 ms delay is the tested sweet spot for `@dnd-kit`. If problematic, fall back to up/down arrow buttons on mobile. |

## Assumptions

- A1. Default Tailwind breakpoints are kept (no custom config change).
- A2. The Ledger aesthetic constraints in CLAUDE.md remain the source of truth.
- A3. No new icon font / image assets are required.
- A4. `@dnd-kit/core` already in deps exposes `TouchSensor` (it does as of current
  version).
- A5. Browser-harness verification is sufficient — we are not adding Vitest snapshot
  tests for visual changes.
