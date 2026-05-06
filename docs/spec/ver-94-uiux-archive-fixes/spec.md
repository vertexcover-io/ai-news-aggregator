# SPEC — VER-94: UI/UX polish on archive pages

**Linear:** [VER-94](https://linear.app/vertexcover/issue/VER-94/uiux-issues-on-the-archive-page)
**Design doc:** [`docs/plans/2026-05-06-ver-94-uiux-fixes-design.md`](../../plans/2026-05-06-ver-94-uiux-fixes-design.md)

This spec uses [EARS](https://alistairmavin.com/ears/) format for requirements.

## Scope

Public archive surfaces only:
- `/` — `ArchiveListingPage` (shell: `PublicLayout`)
- `/archive/:runId` — `ArchivePage` (shell: `PublicLayout`)
- Shared shell — `PublicLayout` (Nav + Footer)

Out of scope: `/admin/*`, `/run`, API, pipeline, DB.

---

## Requirements

### REQ-1 — Listing page: no month-filter chips

**While** rendering the `/` archive listing page, **the system shall not** render any month-filter chip buttons or a filter row (`button[data-filter-chip]` count must be 0).

### REQ-2 — Listing page: brand wordmark = "Sieve"

**While** rendering any page wrapped by `PublicLayout`, **the system shall** display the text `"Sieve"` as the brand wordmark in the nav.

### REQ-3 — Listing page: hero copy

**While** rendering `/` with archive data, **the system shall** display:
- An `<h1>` containing the text `"The Daily Read"`.
- A subheadline containing the text `"AI news worth your morning."`.

### REQ-4 — Document title

**While** the user is on `/`, **the system shall** set `document.title` to `"Sieve — The Daily Read"`.

### REQ-5 — Header navigation links

**While** rendering `PublicLayout`'s nav, **the system shall** include:
- A `<Link to="/">` whose visible text is `"Sieve"`.
- An `<a>` with `href="https://blog.vertexcover.io"`, `target="_blank"`, and `rel` containing `noopener` and `noreferrer`, whose visible text is `"Blog"`.
- (existing) Subscribe and About links.

### REQ-6 — Footer blog reference

**While** rendering `PublicLayout`'s footer, **the system shall** include a link with `href="https://blog.vertexcover.io"` whose visible text is `"blog.vertexcover.io"`.

### REQ-7 — Brand wordmark navigates home

**When** the user clicks the `"Sieve"` brand wordmark in the nav from any page, **the system shall** navigate to `/`.

### REQ-8 — Post page: no right rail

**While** rendering `/archive/:runId` with one or more stories, **the system shall not** render any element with `[data-rail="right"]` inside any story article.

### REQ-9 — Post page: rank shown exactly once per story

**While** rendering a story article on `/archive/:runId`, **the system shall** display the rank exactly once, inside the left rail (`[data-rail="left"]`), as the literal `N°` followed by the two-digit zero-padded rank.

### REQ-10 — Post page: source label shown exactly once per story

**While** rendering a story article on `/archive/:runId`, **the system shall** display the source label (e.g. `TWITTER`, `HN`) exactly once, inside the eyebrow line of the middle column, and shall not also render the URL host as a separate badge.

### REQ-11 — Post page: grid template

**While** rendering a story article on `/archive/:runId` at the `md` breakpoint and above, **the system shall** use a 2-column grid with template `120px minmax(0, 1fr)`.

---

## Edge cases

### EDGE-1 — Empty archive list

**When** `listArchives` returns `{ archives: [] }`, **the system shall** render the existing empty-state copy `"No issues yet. Check back soon."`, render no filter chips, and render no "Load more" button.

### EDGE-2 — Archive listing fetch error

**When** `listArchives` rejects, **the system shall** render the existing error copy `"Couldn't load issues"`, render no filter chips, and render no "Load more" button.

### EDGE-3 — Single-month listing fixture

**When** all archives in the listing fall in a single calendar month, **the system shall** render exactly one `<h2>` month group header and zero filter chips.

### EDGE-4 — Post page with `sourceType="twitter"` whose URL host is `x.com`

**When** rendering a Twitter story (where `sourceType` is `"twitter"` and `item.url`'s host is `x.com`), **the system shall** display only the `TWITTER` eyebrow label and not also render `x.com` anywhere in the article.

### EDGE-5 — Post page rank with `rank=1`

**While** rendering the lead story (rank=1) on `/archive/:runId`, **the system shall** display `01` (zero-padded) in the left rail's serif numeral, the literal `N°` label above it, and a `LEAD STORY` rust-accented mono label.

---

## Verification scenarios

### VS-1 — Listing renders Sieve brand and headline (unit)

Render `<ArchiveListingPage />` inside `PublicLayout` with `makeArchives(3, "2026-04")`.
Assert: `screen.getByText("Sieve")` truthy; `screen.getByRole("heading", {level:1, name:"The Daily Read"})` truthy; `getFilterChips().length === 0`; `screen.getByText(/blog\.vertexcover\.io/)` truthy.
**Covered by:** `packages/web/tests/unit/pages/ArchiveListingPage.test.tsx > VER-94: renders Sieve nav, hero, archive list, blog/footer when data loads`.

### VS-2 — Document title is `"Sieve — The Daily Read"` (unit)

Render `<ArchiveListingPage />` with `makeArchives(1, "2026-04")`.
Assert: `document.title === "Sieve — The Daily Read"`.
**Covered by:** `tests/unit/pages/ArchiveListingPage.test.tsx > VER-94: document.title`.

### VS-3 — Filter chips removed in normal, error, and empty states (unit, 3 tests)

Already-passing tests REQ-027 (error), REQ-028 (empty), and the new VER-94 single-month test all assert `getFilterChips().length === 0`.
**Covered by:** `tests/unit/pages/ArchiveListingPage.test.tsx`.

### VS-4 — Story article has no right rail (unit)

Render `<ArchiveStoryCard item={baseItem} rank={1} />`.
Assert: `container.querySelector('[data-rail="right"]')` is `null`.
**Covered by:** `tests/unit/ArchiveStoryCard.test.tsx > does not render a right rail (rank/source dedup, VER-94)`.

### VS-5 — Story article uses 2-col grid template (unit)

Render `<ArchiveStoryCard item={itemWithRecap} rank={1} />`.
Assert: `article.className` contains `md:grid-cols-[120px_minmax(0,1fr)]`.
**Covered by:** `tests/unit/ArchiveStoryCard.test.tsx > collapses to single-column layout on mobile with rank rail visible inline`.

### VS-6 — Post page rank in left rail only (unit)

Render `<ArchivePage />` with two completed-run stories.
Assert: each `<article>`'s left rail textContent matches `/N°.*01/` (and `/N°.*02/`); no right-rail elements present.
**Covered by:** `tests/unit/ArchivePage.test.tsx > completed with 2 stories`.

### VS-7 — Functional verification (live)

Start `pnpm --filter @newsletter/web dev`, load `/`, then a fixture archive page.
Take screenshots; manually inspect:
- Sieve wordmark and Blog link visible in header
- Headline reads "The Daily Read"; subheadline reads "AI news worth your morning."
- No month-filter chips above archive list
- Footer contains `blog.vertexcover.io` text/link
- Click "Sieve" wordmark → URL becomes `/`
- On a post page: each story has only one rank indicator (left rail) and one source label (eyebrow)

**Recorded in:** [`verification/proof-report.md`](./verification/proof-report.md).

---

## Out-of-scope changes shipped (transparency)

The implementation also deleted unused code that was orphaned by the change:
- `packages/web/src/components/archive-listing/FilterChip.tsx` — no remaining callers.
- `buildMonthChips` and `MonthChip` exports from `format.ts` — no remaining callers.

These are dead-code deletions, not new behavior, and are covered by the typecheck (build would fail if anything still imported them).
