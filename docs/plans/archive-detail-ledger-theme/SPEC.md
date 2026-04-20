# SPEC: Archive Detail — Ledger Theme Translation

**Source:** `docs/plans/2026-04-20-archive-detail-ledger-theme-design.md`
**Generated:** 2026-04-20
**Mockups:** `docs/plans/2026-04-20-archive-detail-ledger-mockups/` — `vU5pz.png` (full page), `0GE85.png` (hero), `eHhn1.png` (story N°01), `oiQRS.png` (story N°02). Export pending — see design doc.

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Ubiquitous | The `/archive/:runId` page shall render with background color `#FAFAF7`, primary text `#1A1A1A`, accent `#8C3A1E`, and hairline divider color `#1A1A1A1A`. | Computed styles on `body`/root and section dividers match exactly. | Must |
| REQ-002 | Ubiquitous | The page shall use Newsreader serif (`--font-serif`) for all display type (hero headline, story headlines, ledes, bottom-line quotes) and Geist Mono (`--font-mono`) for all eyebrows, source meta, and counters. | All elements of each role carry the corresponding `font-family`. | Must |
| REQ-003 | Event-driven | When the page mounts with a completed run, it shall render a mono hero eyebrow matching `<WEEKDAY_UPPERCASE> · <MONTH DD, YYYY> · ISSUE N°<issueNumber>`. | DOM contains the exact format; tested with fixed clock. | Must |
| REQ-004 | Event-driven | When the run has a non-empty `leadSummary`, the page shall render `leadSummary` as the hero serif headline; otherwise it shall render the top-ranked story's title. | Two unit tests (with/without leadSummary) assert headline text. | Must |
| REQ-005 | Ubiquitous | The page shall render a meta subline under the hero in the form `<N> stories` with pluralization (`1 story` when N=1). | Renders exactly `1 story` for 1 and `8 stories` for 8. | Must |
| REQ-006 | Ubiquitous | The page shall render exactly one story section per element of `rankedItems`, in the array's order. | Story-section count equals `rankedItems.length`. | Must |
| REQ-007 | Ubiquitous | Each story section shall lay out in a 3-column CSS grid with columns `120px`, `minmax(0, 1fr)`, `120px`. | Computed `grid-template-columns` matches on each section (above 720px viewport). | Must |
| REQ-008 | Ubiquitous | Each story section's left rail shall render a mono `N°` eyebrow and a serif display number equal to the 1-based rank, zero-padded to two digits when rank < 10. | Rank 1 renders `01`; rank 12 renders `12`. | Must |
| REQ-009 | State-driven | While a story is rank 1, the left rail shall additionally render a mono `LEAD STORY` tag in accent color below the display number. | Tag present exactly for rank 1; absent for all other ranks. | Should |
| REQ-010 | Ubiquitous | Each story shall render a mono eyebrow containing `<SOURCE_UPPERCASE> · <FORMATTED_DATE>` and append `· ▲ <POINTS>` when `points > 0` and `· <COMMENTS> COMMENTS` when `commentCount > 0`. | Unit tests for each permutation (both, only points, only comments, neither). | Must |
| REQ-011 | Ubiquitous | Each story headline shall render as an `<a>` element with `href=item.url`, `target="_blank"`, and `rel="noopener noreferrer"`. | Three attributes present on every headline anchor. | Must |
| REQ-012 | Event-driven | When `item.imageUrl` is truthy, the story shall render an image plate with `object-fit: cover`, 1px `#1A1A1A14` border, `border-radius: 0`, and no box-shadow. | Computed styles on image element match. | Must |
| REQ-013 | Unwanted | If the image `onError` fires, the story shall unmount the image element and continue to render the remaining content unchanged. | Error-triggered render shows section without image but all other fields. | Must |
| REQ-014 | Event-driven | When `item.recap.summary` is non-empty, the story shall render the summary as italic serif text (`font-style: italic`, `font-family: Newsreader`). | Summary text present with italic computed style. | Must |
| REQ-015 | Unwanted | If `item.recap` is null, the story shall render `item.rationale` as non-italic serif text in place of the lede and omit bullets and bottom-line blocks. | With null recap, only rationale renders; UNPACKED and BOTTOM LINE absent. | Must |
| REQ-016 | Event-driven | When `item.recap.bullets` has length ≥ 1, the story shall render an `UNPACKED` mono eyebrow and one list item per bullet with an accent-color em-dash (`—`) marker. | Eyebrow present, list length equals bullets length, markers are `—` in `#8C3A1E`. | Must |
| REQ-017 | Event-driven | When `item.recap.bottomLine` is non-empty, the story shall render a `BOTTOM LINE` block with a 3px-wide `#8C3A1E` left rule and italic serif body. | Rule element exists with `width: 3px` and `background: #8C3A1E`; body has `font-style: italic`. | Must |
| REQ-018 | Ubiquitous | Each story shall render a `READ THE ORIGINAL →` mono link with `href=item.url`, dark text (`#1A1A1A`), accent-colored arrow (`#8C3A1E`), and underline. | Computed styles and href present. | Must |
| REQ-019 | Ubiquitous | The page shall render source type as uppercase monospaced text with letter-spacing; colored pill backgrounds (`bg-orange-100`, `bg-blue-100`, etc.) shall not appear in the rendered tree. | No elements carry the removed class list; text content is uppercase. | Must |
| REQ-020 | State-driven | While the run query is loading, the page shall render three placeholder rows in the 120/fill/120 grid with `animate-pulse` and the page chrome (nav, footer) shall still render. | Skeleton contains exactly 3 rows and has `role=status` or `aria-busy`. | Must |
| REQ-021 | Unwanted | If the run fetch returns an error, the page shall render an `ERROR` mono eyebrow, serif `Couldn't load this issue` headline, and a `← All issues` link to `/`. | Exact strings present; link `href="/"`. | Must |
| REQ-022 | Unwanted | If the fetch succeeds but `data` is `null`/`undefined`, the page shall render `This issue isn't here` (serif) with `It may have been removed or never existed.` (mono). | Exact strings present. | Must |
| REQ-023 | State-driven | While `run.status !== "completed"`, the page shall render an `IN PROGRESS` mono eyebrow and `Today's issue is still being curated.` serif message. | Exact strings present; story list absent. | Must |
| REQ-024 | Ubiquitous | The page shall render a back link to `/` in the top nav (right side, mono pill) and a second back link at the page bottom (left of the end rail). | Two anchor elements with `href="/"` exist. | Must |
| REQ-025 | Event-driven | When viewport width is below 720px, the 3-column grid shall collapse to a single column and the serif display number shall hide in favor of a `N°<rank>` prefix inside the mono eyebrow. | JSDOM-matched class applied at breakpoint; Tailwind responsive classes verified. | Should |
| REQ-026 | Ubiquitous | The page shall render the same `<Nav>` component used by the listing page (URL mark, About link). | Same component import or identical DOM structure. | Must |
| REQ-027 | Ubiquitous | The page shall render the same `<Footer>` component used by the listing page (`Made by Vertexcover`, `RSS · Archive`). | Same component or identical DOM. | Must |
| REQ-028 | Ubiquitous | The page shall set `document.title` to `Issue N°<issueNumber> — <runDate>` and a meta description to the hero headline. | `document.title` and `<meta name="description">` assertions pass after mount. | Should |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | Run's `rankedItems` is empty (length 0). | Hero renders; story list section renders a serif `No stories in this issue.` line and no sections. | REQ-006 |
| EDGE-002 | Story has no `imageUrl`. | Section renders without the image plate; spacing between headline and lede collapses. | REQ-012 |
| EDGE-003 | `<img>` `onError` fires after render (broken URL, 403). | Image element unmounts; section re-flows without error overlay. | REQ-013 |
| EDGE-004 | Story has `recap.summary` but empty `recap.bullets`. | UNPACKED eyebrow and list are omitted; BOTTOM LINE still renders if present. | REQ-016 |
| EDGE-005 | Story has `recap` with missing `bottomLine` (null/empty string). | BOTTOM LINE block is omitted; READ THE ORIGINAL link remains. | REQ-017 |
| EDGE-006 | Story has `recap = null`. | Rationale renders as non-italic serif lede; no UNPACKED, no BOTTOM LINE. | REQ-015 |
| EDGE-007 | `engagement.points === 0` and `engagement.commentCount === 0`. | Eyebrow shows only `<SOURCE> · <DATE>`; no trailing separators or empty counters. | REQ-010 |
| EDGE-008 | `engagement.points > 0` but `commentCount === 0`. | Eyebrow includes `· ▲ <POINTS>` but no comments segment. | REQ-010 |
| EDGE-009 | Story rank is ≥ 10 (e.g., 12). | Display number renders as two digits `12`, no padding. | REQ-008 |
| EDGE-010 | Rank 1 story in a single-story run. | `LEAD STORY` tag still renders; meta subline reads `1 story`. | REQ-009, REQ-005 |
| EDGE-011 | Run `leadSummary` is an empty string `""` (not null). | Hero falls back to top-story title (empty string counts as missing). | REQ-004 |
| EDGE-012 | Very long headline (> 180 chars) or very long source hostname. | Headline wraps inside the middle column without pushing the right rail; hostname truncates at ~28 chars with ellipsis. | REQ-007 |
| EDGE-013 | Network fetch rejects with a thrown error (offline). | ERROR state renders (REQ-021); no unhandled promise rejection bubbles up. | REQ-021 |
| EDGE-014 | User visits at viewport width 360px. | Grid collapses to single column; `N°01` appears inline in the eyebrow. | REQ-025 |
| EDGE-015 | Run is in `cancelled` terminal status. | IN PROGRESS message replaced with `This issue was cancelled.` (serif) + mono subline. | REQ-023 |
| EDGE-016 | Run fetch is still loading (no data yet). | Skeleton from REQ-020 renders; no console errors. | REQ-020 |
| EDGE-017 | Page is visited with a `runId` that is not a valid UUID (`/archive/xyz`). | NOT FOUND state from REQ-022 renders (hooks into 404 response). | REQ-022 |

## Verification Matrix

| ID | Unit Test | Integration Test | E2E Test | Manual Test | Notes |
|--------|-----------|-----------------|----------|-------------|-------|
| REQ-001 | Yes | No | No | Yes | Computed-style check via RTL + visual sign-off on localhost |
| REQ-002 | Yes | No | No | No | Query font-family on role-distinct elements |
| REQ-003 | Yes | No | No | No | Fake timer for deterministic weekday |
| REQ-004 | Yes | No | No | No | Two fixtures: with/without leadSummary |
| REQ-005 | Yes | No | No | No | Parametric test over N ∈ {0, 1, 8} |
| REQ-006 | Yes | No | No | No | Assert `getAllByRole("article")` length |
| REQ-007 | Yes | No | No | Yes | JSDOM reports grid template; manual narrow-width check |
| REQ-008 | Yes | No | No | No | Fixture with ranks 1, 2, 12 |
| REQ-009 | Yes | No | No | No | Assert LEAD STORY appears iff rank 1 |
| REQ-010 | Yes | No | No | No | Four-way parametric test for eyebrow permutations |
| REQ-011 | Yes | No | No | No | Attribute assertions on anchor |
| REQ-012 | Yes | No | No | Yes | Computed style; visual check real photo |
| REQ-013 | Yes | No | No | No | Fire `onError` via RTL; assert image unmounted |
| REQ-014 | Yes | No | No | No | Assert `italic` computed style |
| REQ-015 | Yes | No | No | No | Fixture with `recap: null` |
| REQ-016 | Yes | No | No | No | Assert list length and marker color |
| REQ-017 | Yes | No | No | No | Rule element color + width |
| REQ-018 | Yes | No | No | No | Attribute + color assertions |
| REQ-019 | Yes | No | No | No | Assert class list does NOT contain the old pill classes |
| REQ-020 | Yes | No | No | No | `react-query` suspended state via MSW |
| REQ-021 | Yes | No | No | No | MSW 500 response |
| REQ-022 | Yes | No | No | No | MSW 404 response |
| REQ-023 | Yes | No | No | No | Fixture run with `status="running"` |
| REQ-024 | Yes | No | No | No | Find all `a[href="/"]`, assert count ≥ 2 |
| REQ-025 | Yes | No | No | Yes | RTL + Tailwind class assertion; real-browser manual check |
| REQ-026 | Yes | No | No | No | Same `<Nav>` component import |
| REQ-027 | Yes | No | No | No | Same `<Footer>` component import |
| REQ-028 | Yes | No | No | No | Assert `document.title` and meta after mount |
| EDGE-001 | Yes | No | No | No | Fixture with zero items |
| EDGE-002 | Yes | No | No | No | Fixture with no imageUrl |
| EDGE-003 | Yes | No | No | No | Fire onError |
| EDGE-004 | Yes | No | No | No | Fixture with empty bullets |
| EDGE-005 | Yes | No | No | No | Fixture with null bottomLine |
| EDGE-006 | Yes | No | No | No | Fixture with null recap |
| EDGE-007 | Yes | No | No | No | Fixture with 0/0 engagement |
| EDGE-008 | Yes | No | No | No | Fixture with points only |
| EDGE-009 | Yes | No | No | No | Rank 12 fixture |
| EDGE-010 | Yes | No | No | No | Single-story run fixture |
| EDGE-011 | Yes | No | No | No | `leadSummary: ""` fixture |
| EDGE-012 | Yes | No | No | Yes | Unit + visual check |
| EDGE-013 | Yes | No | No | No | MSW network error |
| EDGE-014 | Yes | No | No | Yes | Breakpoint class + manual |
| EDGE-015 | Yes | No | No | No | Fixture with `status="cancelled"` |
| EDGE-016 | Yes | No | No | No | Covered by REQ-020 skeleton test |
| EDGE-017 | Yes | No | No | No | MSW 404 covers it |

## Out of Scope

- Admin review page (`/admin/review/:runId`) — operator-only, not touched by this feature.
- Backend / API changes — the `GET /api/archives/:runId` response shape is unchanged.
- Changes to the listing page (`/`) — unifying the accent color (`amber-700` vs `#8C3A1E`) is explicitly deferred per the design's Open Question #1.
- Image upload, hosting, proxying, or thumbnail generation — images continue to load from the source URL via `referrerPolicy="no-referrer"`.
- Sibling-issues (prev/next) rail — rejected during brainstorming; no API or UI work for it.
- `IN THIS ISSUE` table-of-contents band — rejected during brainstorming.
- RSS / Subscribe / Share stubs shown in the mockup's top crumb band — labels only, not wired in this feature.
- SEO `og:*` meta tags and JSON-LD — deferred.
- Dark mode — not in scope; the palette is light-only by design.
- Share link copying, reading-time calculation, print stylesheet — deferred.

## Notes for Planner

- Phase suggestion: (1) restyle `ArchivePage` shell + hero + states; (2) split `ArchiveStoryCard` → `ArchiveStorySection` with new layout; (3) responsive collapse + accessibility sweep.
- The existing `PublicLayout` already wraps `/` and `/archive/:runId`; reuse its nav/footer if it exists, else lift from `ArchiveListingPage.Nav`/`.Footer` into a shared component in `src/layouts/PublicLayout.tsx`.
- No new API shape means zero work on `@newsletter/api` and `@newsletter/shared`.
- Update `packages/web/src/components/ArchiveStoryCard.tsx` unit tests rather than add a second test suite — rename them with the new section name.
