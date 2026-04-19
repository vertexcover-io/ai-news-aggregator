# SPEC: Ledger Archive Listing

**Source:** `docs/plans/2026-04-19-ledger-archive-listing-design.md`
**Visual source of truth:** `docs/plans/2026-04-19-ledger-archive-listing-mockup.png`
**Generated:** 2026-04-19
**Feature scope:** API list endpoint enrichment + full rewrite of the public `/` listing page.

## Requirements

### Shared types (`@newsletter/shared`)

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-001 | Ubiquitous | The system shall expose an `ArchiveListItem` interface with the fields `runId: string`, `runDate: string`, `storyCount: number`, `topItems: ArchiveTopItem[]`, `leadSummary: string \| null`. | `import { ArchiveListItem } from "@newsletter/shared"` gives a type whose assignability includes all five fields; missing any field causes a typecheck error. | Must |
| REQ-002 | Ubiquitous | The system shall expose an `ArchiveTopItem` interface with the fields `id: number`, `title: string`, `sourceType: SourceType`. | `ArchiveTopItem` is exported from `@newsletter/shared`; its shape matches the three fields exactly. | Must |

### API listing repo (`@newsletter/api`)

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-003 | Event-driven | When `RunArchivesRepo.listReviewed()` executes, the system shall populate `topItems` for each row from the first three entries of `runArchives.rankedItems` mapped to `{ id, title, sourceType }` using the joined `raw_items` row. | Given a run with `rankedItems = [refA, refB, refC, refD]`, returned `topItems` has exactly three entries corresponding to `refA`, `refB`, `refC`; the fourth is not included. | Must |
| REQ-004 | Ubiquitous | The system shall preserve the order of `rankedItems` in `topItems` (index 0 = highest rank). | For input `rankedItems = [{rawItemId: 7}, {rawItemId: 3}, {rawItemId: 11}]`, returned `topItems[0].id = 7`, `topItems[1].id = 3`, `topItems[2].id = 11`. | Must |
| REQ-005 | Unwanted | If a `rankedItems[i].rawItemId` has no matching row in `raw_items`, then the system shall omit that entry from `topItems`; remaining top items retain their relative rank order. | Given `rankedItems = [id 7 (present), id 99 (missing), id 3 (present)]`, returned `topItems = [{id: 7, ...}, {id: 3, ...}]` (length 2). | Must |
| REQ-006 | Event-driven | When the top ranked item has either a `rankedItems[0].summary` override or a `raw_items.metadata.recap.summary`, the system shall set `leadSummary` to the override when present, otherwise to `raw_items.metadata.recap.summary`. | Given `rankedItems[0] = { rawItemId: 7, summary: "override" }`, `leadSummary === "override"`. Given `rankedItems[0] = { rawItemId: 7 }` with no override and the raw item's `metadata.recap.summary === "from raw"`, `leadSummary === "from raw"`. | Must |
| REQ-007 | Unwanted | If `topItems` is empty OR the top item has neither a `summary` override nor a `metadata.recap.summary`, then the system shall set `leadSummary = null`. | Given `rankedItems = []`, `leadSummary === null`. Given top item with no override and `metadata.recap = null`, `leadSummary === null`. | Must |
| REQ-008 | Ubiquitous | The system shall call `RawItemsRepo.findByIds` at most once per `listReviewed()` invocation, passing the deduplicated union of the first three `rankedItems[i].rawItemId` values across every reviewed archive row. | Instrumenting `RawItemsRepo.findByIds` with a call-counter spy: given N reviewed archives, the spy records exactly 1 call (or 0 calls if the union is empty); the `ids` argument of that call contains every top-3 `rawItemId` from every row with no duplicates. | Must |
| REQ-009 | Ubiquitous | The system shall obtain `title` and `sourceType` in `topItems` from the joined `raw_items` row, not from `rankedItems[i]` fields. | Even if a future schema change adds `title` to `RankedItemRef`, `topItems[i].title` still equals `raw_items.title` for the corresponding `rawItemId`. | Must |

### API listing route (`@newsletter/api`)

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-010 | Ubiquitous | `GET /api/archives` shall return HTTP 200 with JSON body `{ archives: ArchiveListItem[] }` sorted by `completedAt DESC`. | Integration test against the Hono app returns status 200; `body.archives` is ordered by descending `runDate`; all items match `ArchiveListItem` shape. | Must |
| REQ-011 | Ubiquitous | The `GET /api/archives` route shall remain public (no `requireAdmin` middleware). | Calling the route without an `admin_session` cookie returns 200 (not 401). | Must |

### Web frontend (`@newsletter/web`)

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-012 | Ubiquitous | `ArchiveListingPage` shall render (in order) a nav bar, a hero, a filter row, month-grouped rows, a Load more control, and a footer. | Render the component with fixture data; the DOM contains, in document order, elements matching each section. | Must |
| REQ-013 | Ubiquitous | Each archive row shall render a date block (day-of-week mono eyebrow, serif `MMM D` date, mono `YYYY · N°X` sub) where `N = total − index`. | For an archive at index 2 in a list of 82, the date block sub text equals `"2026 · N°80"`. | Must |
| REQ-014 | Ubiquitous | Each archive row shall render a main column containing the serif headline taken from `topItems[0].title` (rendered in full, no truncation) and a chip row containing the first up-to-three `topItems[i].title` values, each truncated such that when `title.length > 28` the visible chip text equals `title.slice(0, 27) + "…"` (28 visible code points total), otherwise the full title, followed by `+ (storyCount − topItems.length) more` when `storyCount > topItems.length`. | Given `topItems = [{title: "A very long headline that goes on and on"}, {title: "Short"}, {title: "Medium length title"}]`, `storyCount = 7`: headline displays the full first title; chips display `"A very long headline that g…"` (28 visible chars), `"Short"`, `"Medium length title"`; trailing text displays `"+ 4 more"`. | Must |
| REQ-015 | Ubiquitous | Each rendered chip shall have an HTML `title` attribute equal to the full (untruncated) `topItems[i].title`. | Query the first chip in the DOM; its `title` attribute equals the full original title string regardless of truncation. | Must |
| REQ-016 | Ubiquitous | Each archive row shall render a right-column meta block with `"{storyCount} {storyCount === 1 ? "story" : "stories"}"` in mono and a `Read →` link whose `href` equals `/archive/{runId}`. | For an archive `{runId: "abc", storyCount: 12}`, the right column contains text `"12 stories"`; for `{storyCount: 1}`, the text is `"1 story"`; the anchor `href` is `/archive/abc`. | Must |
| REQ-017 | Event-driven | When `index === 0` AND `leadSummary !== null` AND `leadSummary !== ""`, the row's root element shall carry `data-featured="true"` and shall render an additional dek element containing the `leadSummary` text. When the condition is not met, the row's root element shall NOT carry `data-featured="true"` and no dek element shall render. | Render a list whose first archive has `leadSummary = "foo bar"`: the first row's root has attribute `data-featured="true"` and a descendant element's text equals `"foo bar"`. Render a list whose first archive has `leadSummary = null`: no row in the DOM has `data-featured="true"` and no dek element exists on the first row. | Must |
| REQ-018 | Event-driven | When the page's React Query loader is in `isLoading` state, the system shall render skeleton placeholders matching the existing `SkeletonRows` behavior (at least three animated rows). | Render with a query mock stuck in loading; the DOM contains three elements with the `animate-pulse` class. | Should |
| REQ-019 | Event-driven | When `data` has loaded, the system shall render at most 10 archive rows initially across all month groups combined. | Given `data.archives.length = 25`, immediately after first render the DOM contains exactly 10 row elements. | Must |
| REQ-020 | Event-driven | When the user activates the Load more control, the system shall reveal 10 additional rows in the currently visible set (or the remainder if fewer than 10 remain). | Clicking Load more with 25 archives visible-10 → visible-20 → visible-25; after the third click the DOM contains 25 rows and the Load more control is no longer rendered. | Must |
| REQ-021 | State-driven | While the number of visible rows is greater than or equal to the currently-filtered archive count, the Load more control shall not be rendered. | Given 8 archives and no filter, initial render does not include a Load more control. Given 25 archives filtered to a month with 5 results, the Load more control is not rendered. | Must |
| REQ-022 | Ubiquitous | The filter row shall render an `All` chip (with total count) and one chip per distinct month present in the data (in the same order as the month groups below — newest first), each chip labeled with the abbreviated month name and the count of issues in that month. | Given archives spanning Apr (2), Mar (3), Feb (1): the filter row contains four chips in order `All 6`, `Apr 2`, `Mar 3`, `Feb 1`. | Must |
| REQ-023 | Event-driven | When the user activates a month chip, the system shall filter the rendered list to only archives whose `runDate` falls in that month (local time), and shall mark that chip as active. | Clicking the `Mar` chip with 3 March and 2 April archives reduces the visible set to 3 rows; the `Mar` chip has the active visual treatment; the `All` chip loses the active treatment. | Must |
| REQ-024 | Event-driven | When the user activates the currently active month chip, the system shall clear the filter (return to `All` view) and mark the `All` chip as active. | Starting from the `Mar` filter, clicking `Mar` again restores all 5 rows; `All` chip is active. | Must |
| REQ-025 | Event-driven | When the user activates the `All` chip while a month filter is active, the system shall clear the filter. | Starting from the `Mar` filter, clicking `All` restores all 5 rows. | Must |
| REQ-026 | State-driven | While a month filter is active, the Load more progressive reveal shall operate over the filtered set only (initial 10, then +10 per click up to filtered total). | Filter to a month with 25 archives: initial render shows 10 filtered rows, Load more reveals to 20, then 25, then hides. | Should |
| REQ-027 | Unwanted | If `GET /api/archives` returns an error, the system shall render the text `"Couldn't load issues"` with Ledger typography (mono eyebrow + serif headline) and shall NOT render the filter row or Load more control. | With the query mocked to reject, the DOM contains an element with text `"Couldn't load issues"`; no element has the filter-chip role; no Load more button exists. | Must |
| REQ-028 | Unwanted | If `data.archives.length === 0`, the system shall render the exact text `"No issues yet. Check back soon."` with Ledger typography and shall NOT render the filter row or Load more control. | With the query resolving to `{ archives: [] }`, the DOM contains an element whose text equals `"No issues yet. Check back soon."`; no filter chips; no Load more. | Must |
| REQ-029 | Unwanted | If `storyCount === 0` on an archive, the row shall render the date block, a muted `"No stories"` label in the main column, and the right column; no chip row and no `Read →` link. | For an archive `{storyCount: 0, topItems: []}`, the DOM row contains `"No stories"` text; it contains no chip elements; it contains no anchor whose `href` ends with that `runId`. | Should |
| REQ-030 | Unwanted | If `topItems.length < 3`, the system shall render only the chips that exist and shall NOT render a `+ N more` suffix when `storyCount === topItems.length`. | For `topItems.length = 2`, `storyCount = 2`: DOM contains 2 chip elements and no `"+ N more"` text. | Must |
| REQ-031 | Event-driven | When `storyCount > topItems.length` but `topItems.length > 0`, the system shall render a trailing `+ (storyCount − topItems.length) more` text after the existing chips. | For `topItems.length = 2`, `storyCount = 5`: DOM contains 2 chips followed by the text `"+ 3 more"`. | Must |
| REQ-032 | Ubiquitous | `packages/web/index.html` shall include a `<link>` element loading both `Newsreader` and `Geist Mono` families from Google Fonts. | `cat packages/web/index.html` shows a `<link>` whose `href` references `fonts.googleapis.com` and includes the names `Newsreader` and `Geist+Mono`. | Must |
| REQ-033 | Ubiquitous | Tailwind configuration in `packages/web` shall extend `fontFamily` with a `serif` token mapping to `"Newsreader"` first and a `mono` token mapping to `"Geist Mono"` first (both with appropriate fallbacks). | Grepping the Tailwind config shows `fontFamily: { serif: ["Newsreader", ...], mono: ["Geist Mono", ...] }` or equivalent structure. | Must |
| REQ-034 | Ubiquitous | The page `<title>` shall remain `"Newsletter archive"` and the `<meta name="description">` shall remain the original tagline string. | After render, `document.title === "Newsletter archive"` and the meta description element's `content` equals the tagline string. | Should |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|--------------|
| EDGE-001 | `listReviewed()` with zero reviewed archives | Returns `[]`; no `findByIds` call fires. | REQ-003, REQ-008 |
| EDGE-002 | Reviewed archive with `rankedItems = []` (storyCount 0) | `topItems = []`, `leadSummary = null`, storyCount = 0. | REQ-003, REQ-007 |
| EDGE-003 | Reviewed archive with `rankedItems.length = 1` | `topItems` has 1 entry; `leadSummary` filled if that item has a summary, else null. | REQ-003, REQ-006, REQ-007 |
| EDGE-004 | Reviewed archive with exactly 3 rankedItems | `topItems` has 3 entries; no `+ N more` chip in the UI. | REQ-003, REQ-030 |
| EDGE-005 | Top item has `rankedItems[0].summary === ""` (empty string override) | `leadSummary = ""` (explicit override wins). Rendering treats empty string as "no dek" (skip the dek element). | REQ-006, REQ-017 |
| EDGE-006 | Top item has `rankedItems[0].summary === undefined` and `metadata.recap === null` | `leadSummary = null`. No dek rendered on featured row; row does not receive featured treatment. | REQ-007, REQ-017 |
| EDGE-007 | All 3 `rankedItems[0..2]` have their raw_items rows missing | `topItems = []`; row falls back to "no stories" rendering if `storyCount` is also 0, else renders without chips and without featured treatment. | REQ-005, REQ-029, REQ-014 |
| EDGE-008 | Archive with a single month (all archives fall in one month) | Filter row renders `All` + one month chip; month group header renders once. | REQ-022, REQ-012 |
| EDGE-009 | User toggles filter while `Load more` has already been clicked (state: `visible = 20`) | Switching to a month filter resets `visible` to `min(10, filteredCount)`. | REQ-023, REQ-026 |
| EDGE-010 | Chip title shorter than 28 characters | Chip displays the full title unchanged; no `…` suffix; `title` attr still equals the full title. | REQ-014, REQ-015 |
| EDGE-011 | Chip title exactly 28 characters | No truncation; full title rendered. | REQ-014 |
| EDGE-012 | Chip title 29 characters | Truncated to 27 characters + `…` (`…` is one Unicode codepoint; total visual length 28). | REQ-014 |
| EDGE-013 | Archive with `storyCount = 12` but `topItems.length = 0` (all raw rows missing) | Row renders serif headline fallback `"—"` (em dash) in the main column; no chips; `+ N more` suppressed because there are no chips; right column shows `12 stories` and `Read →` link. | REQ-005, REQ-014, REQ-016 |
| EDGE-014 | Load more clicked when remainder is less than 10 | The remainder is revealed (e.g., visible-15 → visible-17 when only 2 remain), then Load more disappears. | REQ-020, REQ-021 |
| EDGE-015 | Transient network failure between initial load and Load more click | Load more click does NOT re-fetch (all data already in client); it simply adjusts the visible count. | REQ-020 |
| EDGE-016 | An archive row has the same `runId` as an earlier one (shouldn't happen but defend) | Each row key uses `runId`; React rendering does not crash; duplicate rows render independently. | REQ-012 |

## Verification Matrix

| REQ ID | Unit Test | Integration Test | E2E Test | Manual Test | Notes |
|--------|-----------|------------------|----------|-------------|-------|
| REQ-001 | Yes | No | No | No | Type-level via compile error in a test fixture that tries to construct `ArchiveListItem` missing a field. |
| REQ-002 | Yes | No | No | No | Same as REQ-001. |
| REQ-003 | Yes | No | No | No | `packages/api/tests/unit/repositories/run-archives.test.ts` extended with fakes for `RawItemsRepo`. |
| REQ-004 | Yes | No | No | No | Same test file. |
| REQ-005 | Yes | No | No | No | Fake `findByIds` returns a partial set. |
| REQ-006 | Yes | No | No | No | Two fixtures: one with override, one without. |
| REQ-007 | Yes | No | No | No | Empty rankedItems and null-recap fixtures. |
| REQ-008 | Yes | No | No | No | Vitest spy on the `RawItemsRepo.findByIds` function. |
| REQ-009 | Yes | No | No | No | Construct ref with a bogus `title` field via cast-to-any and assert the returned title comes from the raw row. |
| REQ-010 | No | Yes | No | No | `archives-list.test.ts` already hits the Hono app; extend to assert new fields. |
| REQ-011 | No | Yes | No | No | `route-gating.test.ts` already covers public-ness; verify it still passes. |
| REQ-012 | Yes | No | No | No | Component test via vitest + jsdom + RTL; query by section role/testid. |
| REQ-013 | Yes | No | No | No | Snapshot-adjacent test on date block markup. |
| REQ-014 | Yes | No | No | No | Fixtures with varying title lengths. |
| REQ-015 | Yes | No | No | No | Query chip elements; assert `title` attribute. |
| REQ-016 | Yes | No | No | No | Assert anchor href value. |
| REQ-017 | Yes | No | No | No | Two fixtures, assert presence/absence of featured classes and dek. |
| REQ-018 | Yes | No | No | No | Assert skeleton rows present in loading state. |
| REQ-019 | Yes | No | No | No | 25-archive fixture; assert 10 rows initially. |
| REQ-020 | Yes | No | No | No | Click Load more; assert 20, then 25, then control gone. |
| REQ-021 | Yes | No | No | No | Small fixture (<10) hides control from the start. |
| REQ-022 | Yes | No | No | No | Fixture spanning three months; assert chip labels and counts. |
| REQ-023 | Yes | No | No | No | Click `Mar` chip; assert rendered count drops to 3. |
| REQ-024 | Yes | No | No | No | Click `Mar` twice; assert returns to All. |
| REQ-025 | Yes | No | No | No | Click `Mar` then `All`; assert returns to All. |
| REQ-026 | Yes | No | No | No | Filter to month with 25 archives; verify Load more reveals within filtered set. |
| REQ-027 | Yes | No | No | No | Mock query to reject; assert error copy. |
| REQ-028 | Yes | No | No | No | Mock empty response; assert exact empty-state string. |
| REQ-029 | Yes | No | No | No | Fixture with storyCount=0; assert "No stories" + no Read link. |
| REQ-030 | Yes | No | No | No | Fixture with topItems.length=2 storyCount=2; assert no "+ N more". |
| REQ-031 | Yes | No | No | No | Fixture with topItems.length=2 storyCount=5; assert "+ 3 more". |
| REQ-032 | No | No | No | Yes | Grep `index.html` for the Google Fonts link. |
| REQ-033 | No | No | No | Yes | Grep Tailwind config for the fontFamily mapping. |
| REQ-034 | Yes | No | No | No | Assert `document.title` and meta description after mount. |
| EDGE-001 | Yes | No | No | No | Repo test with zero rows. |
| EDGE-002 | Yes | No | No | No | Repo test with empty rankedItems. |
| EDGE-003 | Yes | No | No | No | Repo test with single rankedItem. |
| EDGE-004 | Yes | No | No | No | Both repo and component test. |
| EDGE-005 | Yes | No | No | No | Repo test + component test for rendering. |
| EDGE-006 | Yes | No | No | No | Component test: index 0, leadSummary null, assert no featured treatment. |
| EDGE-007 | Yes | No | No | No | Component test with topItems=[] and storyCount>0. |
| EDGE-008 | Yes | No | No | No | Component test with one-month fixture. |
| EDGE-009 | Yes | No | No | No | Component test for filter + visibility reset. |
| EDGE-010 | Yes | No | No | No | Component test short-title fixture. |
| EDGE-011 | Yes | No | No | No | Component test exact-28-chars fixture. |
| EDGE-012 | Yes | No | No | No | Component test 29-chars fixture. |
| EDGE-013 | Yes | No | No | No | Component test missing-raw fixture. |
| EDGE-014 | Yes | No | No | No | Component test 17-archive Load more cycle. |
| EDGE-015 | Yes | No | No | No | Component test; assert no fetch on Load more click. |
| EDGE-016 | Yes | No | No | No | Component test duplicate-runId fixture. |

## Out of Scope

- **Functional search.** The `⌘K` search pill is visual chrome only in this PR. Wiring a client-side title filter is a future task.
- **Issue-level synthesized headlines.** The featured row uses the actual top-ranked story's title, not an AI-generated "digest headline." Generating such headlines would require a new LLM call in the pipeline; deferred.
- **Cover images per issue.** `raw_items.imageUrl` exists but is per-story, not per-issue, and not surfaced in this PR.
- **Tag / category / source filter chips.** Beyond the month filter, no additional filtering taxonomy exists or is added.
- **Server-side pagination.** `GET /api/archives` continues to return the full reviewed set in one response. At current scale (<100 reviewed issues) no server pagination is required.
- **RSS feed.** The `RSS · Archive` text in the footer is visual only; no RSS endpoint ships in this PR.
- **Admin dashboard changes.** Only the public `/` route is rewritten; `/admin` and `/admin/**` are untouched.
- **Mobile-specific styling adjustments.** The design targets desktop; mobile breakpoints may look suboptimal and are not a MUST-fix for this PR. (They should not crash, however.)
- **Restyling `ArchivePage` (the detail page at `/archive/:runId`).** Only the listing at `/` is in scope.
- **Changing the repository-pattern boundary.** The decision is to compose `RawItemsRepo.findByIds` from within `listReviewed()`. Whether the repo factory gains a ctor param or the method takes an inline deps bag is a planning-phase decision, not a SPEC decision.
