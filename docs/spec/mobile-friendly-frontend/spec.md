# SPEC: Mobile-Friendly Frontend

**Source:** docs/plans/2026-04-29-mobile-friendly-frontend-design.md
**Generated:** 2026-04-29

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Ubiquitous | The system shall render every in-scope page (`/`, `/archive/:runId`, `/admin/login`, `/admin`, `/admin/review/:runId`, `/admin/settings`, `/run`) without horizontal scroll at a viewport width of 375 px. | `document.documentElement.scrollWidth ≤ window.innerWidth + 1` for each route at width 375 (Playwright assertion). | Must |
| REQ-002 | Event-driven | When the viewport width is below 768 px, the system shall collapse the `120px / 1fr / 120px` grid on `/` to a single column with date/issue rendered as a Geist Mono eyebrow row above the headline and the meta block ("N stories / Read →") rendered below the chip row. | At width 375, the listing row's grid has `grid-template-columns: 1fr` (one column); eyebrow text contains the day-of-week + date + issue number; meta text follows the chips. | Must |
| REQ-003 | Event-driven | When the viewport width is below 768 px, the system shall collapse the `120px / 1fr / 120px` grids on `/archive/:runId` (page-level and per-story-card) to a single column with the rank/source rendered as an inline eyebrow row above the headline. | At width 375, page wrapper grid and `ArchiveStoryCard` grid both compute to one column; rail content (rank N°, source) appears as a row above the headline. | Must |
| REQ-004 | Ubiquitous | The system shall ensure every visible interactive element (`button`, `a[href]`, `input`, `[role="button"]`, drag handles, filter chips, "+ N more" chip, "Load more" button) has a bounding rect of at least 44 × 44 CSS pixels at viewport width 375 px. | Playwright queries each interactive element and asserts `rect.width ≥ 44 && rect.height ≥ 44` for every visible non-`pointer-events:none` candidate. | Must |
| REQ-005 | Event-driven | When a user touches and holds a review card on `/admin/review/:runId` for at least 250 ms with movement under 5 px, the system shall start a drag interaction; otherwise it shall let the page scroll. | DnD `useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })` is wired alongside `PointerSensor`. Playwright touch hold + drag at 375 px reorders the items; a quick-flick swipe scrolls without reordering. | Must |
| REQ-006 | Event-driven | When the viewport width is below 640 px, the system shall render the dashboard runs table as a stacked card list (one card per run with label/value rows) and shall hide the tabular layout. | At width 375, no `<table>` is visible on `/admin`; instead, one card per run appears containing the same fields (status, started, duration, links). At width ≥ 640, the table is visible and the card list is hidden. | Must |
| REQ-007 | Event-driven | When the viewport width is below 768 px, the system shall apply mobile typography: hero `text-3xl` (≤ 30 px), section headlines `text-2xl` (≤ 24 px), body `text-base` (16 px), interactive labels ≥ 14 px. | Playwright `getComputedStyle` on the hero/headline/body elements at width 375 returns font-size values within the stated ranges. | Must |
| REQ-008 | Ubiquitous | The system shall horizontally pad page containers with `px-4` at widths below 640 px, `sm:px-6` at 640–767 px, and the existing desktop padding (`md:px-8` or `md:px-20`, per page) at ≥ 768 px. | Computed `padding-left`/`padding-right` on the outer container of each in-scope page matches the breakpoint-appropriate value at 375, 768, 1280. | Must |
| REQ-009 | Event-driven | When the viewport width is below 768 px, the system shall wrap filter chips on the listing page across multiple rows rather than truncating or scrolling horizontally. | At width 375, no element inside the chip row has `scrollWidth > clientWidth`; chips appear on ≥ 2 rows when there are enough chips to require wrapping. | Should |
| REQ-010 | Ubiquitous | The system shall preserve the existing desktop layout (≥ 768 px) so that no element has different computed style at 1280 px compared to the baseline build. | Visual screenshot at 1280 px is functionally equivalent to the pre-change baseline (manual review); responsive overrides use `md:`/`sm:` modifiers, not unconditional changes. | Must |
| REQ-011 | Event-driven | When the viewport width is below 768 px, the system shall render the admin DnD review with a visible drag handle of at least 44 × 44 px on each card. | At width 375, every `ReviewCard` exposes a button or icon element matching `[data-dnd-handle="true"]` (or equivalent role) with bounding rect ≥ 44 × 44 px. | Must |
| REQ-012 | Ubiquitous | The system shall ensure no in-scope page introduces new console errors during navigation at any of the three test viewports. | `browser_console_messages` returns zero messages of type `error` after navigation and basic interaction. | Must |
| REQ-013 | Ubiquitous | The system shall not introduce new runtime dependencies, custom Tailwind breakpoints, or layout-control JavaScript. | `git diff main -- pnpm-lock.yaml` shows no additions; no new `tailwind.config` breakpoint keys; responsive logic implemented via Tailwind utility classes. | Must |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | A story headline contains 120 characters of unbroken text. | Headline wraps inside the column without horizontal overflow at width 375 (uses `break-words` / `min-w-0`). | REQ-001, REQ-002, REQ-003 |
| EDGE-002 | A story image has an extreme aspect ratio (e.g. 4:1 panorama or 1:3 portrait). | Image fits the card width with `max-h-[60vw]` on mobile; no horizontal scroll is introduced. | REQ-001, REQ-003 |
| EDGE-003 | A run has zero stories on `/archive/:runId`. | Empty state renders cleanly at width 375 with the same padding scheme; no broken layout. | REQ-003, REQ-008 |
| EDGE-004 | The listing has more filter chips than fit one row at 375 px. | Chips wrap to additional rows; no horizontal scroll inside the chip container. | REQ-009 |
| EDGE-005 | A user attempts to scroll the review page on mobile by swiping over a `ReviewCard`. | The page scrolls; no drag begins (the 250 ms / 5 px constraint is not met). | REQ-005 |
| EDGE-006 | A user holds a `ReviewCard` for ≥ 250 ms then drags. | A drag begins and the card can be reordered. | REQ-005, REQ-011 |
| EDGE-007 | iOS keyboard opens on `/admin/login`, reducing effective viewport height to ~ 320 px. | Form remains scrollable; inputs and submit button are reachable; no overlap. | REQ-001, REQ-008 |
| EDGE-008 | The "+ N more" chip on a listing row needs to be tapped on a 375 px screen. | The chip target is ≥ 44 × 44 px. | REQ-004 |
| EDGE-009 | Sub-pixel rounding on a high-DPR mobile device causes `scrollWidth` to be 1 px greater than `innerWidth`. | Treated as no overflow (assertion uses `≤ innerWidth + 1`). | REQ-001 |
| EDGE-010 | A page is viewed at exactly 768 px (the `md` breakpoint boundary). | The desktop layout is active (Tailwind `md:` is min-width 768). | REQ-002, REQ-003, REQ-008 |
| EDGE-011 | A page is viewed at 1280 px after the change. | The page is visually equivalent to the pre-change baseline. | REQ-010 |
| EDGE-012 | Long admin run-row label/value text on stacked card layout (e.g. UUID-shaped run id) is shown at 375 px. | Wraps with `break-all` or `truncate` such that the card width does not exceed the container. | REQ-006 |

## Verification Matrix

| REQ ID | Unit Test | Integration Test | E2E Test | Manual Test | Notes |
|--------|-----------|-----------------|----------|-------------|-------|
| REQ-001 | No | No | Yes | No | Playwright MCP at 375/768/1280 — assert `scrollWidth ≤ innerWidth + 1`. |
| REQ-002 | No | No | Yes | No | Playwright DOM query for grid + eyebrow at 375. |
| REQ-003 | No | No | Yes | No | Playwright DOM query for grid + rank rail at 375 on `/archive/:runId`. |
| REQ-004 | No | No | Yes | No | Playwright `evaluate` over interactive selectors → bounding rect check. |
| REQ-005 | No | No | Yes | No | Playwright touch hold/drag emulation; verify reorder. |
| REQ-006 | No | No | Yes | No | Playwright DOM check for `<table>` absence at 375 and presence at 1280. |
| REQ-007 | No | No | Yes | No | Playwright `getComputedStyle` on hero/headline. |
| REQ-008 | No | No | Yes | No | Playwright `getComputedStyle` for paddingLeft at all three viewports. |
| REQ-009 | No | No | Yes | No | Playwright DOM check chip row `scrollWidth ≤ clientWidth`. |
| REQ-010 | No | No | No | Yes | Manual visual diff at 1280 (reviewer eyeballs screenshot). |
| REQ-011 | No | No | Yes | No | Playwright DOM query for `[data-dnd-handle="true"]` and bounding rect. |
| REQ-012 | No | No | Yes | No | Playwright `browser_console_messages` after each navigation. |
| REQ-013 | No | No | No | Yes | Code review checks no lockfile changes, no new breakpoints. |
| EDGE-001 | No | No | Yes | No | Inject a 120-char title via DevTools or a fixture run; verify no overflow. |
| EDGE-002 | No | No | Yes | No | Use a fixture story image with extreme ratio; verify card containment. |
| EDGE-003 | No | No | No | Yes | Manually navigate to a 0-story run if available; otherwise skip. |
| EDGE-004 | No | No | Yes | No | Verify chip-row wrap at 375 with present filter set. |
| EDGE-005 | No | No | Yes | No | Playwright touch swipe over card; assert order unchanged + page scrolled. |
| EDGE-006 | No | No | Yes | No | Playwright touch hold ≥ 250 ms + drag; assert order changed. |
| EDGE-007 | No | No | No | Yes | Manual on real device or emulated keyboard. |
| EDGE-008 | No | No | Yes | No | Covered by REQ-004 selector list. |
| EDGE-009 | No | No | Yes | No | Implicit in REQ-001 tolerance (+1 px). |
| EDGE-010 | No | No | Yes | No | Playwright at exactly 768. |
| EDGE-011 | No | No | No | Yes | Manual visual diff at 1280. |
| EDGE-012 | No | No | Yes | No | Verify card width ≤ container at 375 with synthetic long values. |

## Out of Scope

- Custom Tailwind breakpoints or `tailwind.config` changes beyond what already exists.
- Replacing the existing typography scale (Newsreader / Geist Mono).
- A redesign of the Ledger aesthetic or content hierarchy on mobile.
- Container queries (`@container`).
- Mobile-only navigation (hamburger menu, drawer, etc.).
- Adding Vitest or Playwright snapshot tests committed to the repo.
- Lighthouse score gate (no CI mobile audit added).
- Service-worker / offline / install-as-app PWA behaviors.
- Changes to the email or pipeline packages.
- Performance optimizations beyond ensuring no regression.
