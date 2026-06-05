# Code Review — VER-94

**Verdict:** APPROVE WITH SUGGESTIONS

## Summary
Clean, focused UI/UX polish that delivers every REQ in spec.md: removes the right rail and `totalCount` prop on `ArchiveStoryCard`, drops the month-filter chips on the listing page, and rebrands the public shell as "Sieve / The Daily Read" with the Blog link in nav and footer. Diff is tight (308 deletions, 80 insertions), TypeScript-strict, and all dead code from the deletion path is genuinely unreferenced. Tests were updated to assert the new behavior (positive cases) rather than just removed.

## Critical defects
(none)

## Important suggestions
- **`packages/web/CLAUDE.md` is now stale.** It still describes the listing page as having "filter chips" and references `FilterChip.tsx` under `archive-listing/`. Same file also still says story cards use a "3-column" grid. Spec rule says docs should track reality; recommend a follow-up sync (or fold into this PR) so future contributors don't re-derive removed behavior. The repo-root `CLAUDE.md` has the same issue ("supports client-side month filtering via filter chips", "3-column `120px / 1fr / 120px` grid").
- **Footer wordmark "Sieve" is unlinked.** REQ-7 only requires the *nav* wordmark to navigate home, so this isn't a defect, but it's a small inconsistency: the brand text appears twice in the footer ("Sieve · Made by Vertexcover · blog.vertexcover.io") with the brand portion being plain text. Either link it or drop it.

## Nits
- `PublicLayout.tsx` brand `<Link>` has `hover:text-neutral-600` but no explicit `focus-visible` style. The Tailwind/browser default focus ring will still show, so this passes accessibility, but neighboring nav anchors don't have explicit focus styles either — consistent, just worth mentioning since the spec rubric asked.
- `ArchiveListingPage.tsx`: `Math.min(visibleCount, data.archives.length)` in the `.slice(0, …)` call is now redundant — `slice` already clamps. Three lines, not worth a fix on its own, just a leftover from the filtered-set days.
- The deleted-test comments (`// VER-94: month filter chips removed. Tests REQ-022 through REQ-026 deleted.`, and similar EDGE-008/009 commentary) are useful as a paper trail but are arguably comment debt per the code-quality rule. Acceptable here because they explain *why* the previously-numbered tests are absent.
- Double em-dash style: the title is set to `"Sieve — The Daily Read"` (em-dash, U+2014) — make sure the source file is UTF-8 and the spec's exact codepoint matches. (Verified: matches spec REQ-4 exactly.)

## Spec coverage matrix
| REQ | Implemented? | Tested? | Notes |
| --- | --- | --- | --- |
| REQ-1 (no filter chips) | ✓ | ✓ | `getFilterChips().length === 0` asserted in 4 listing tests including normal/error/empty/single-month |
| REQ-2 (Sieve wordmark in nav) | ✓ | ✓ | `screen.getByText("Sieve")` in listing test |
| REQ-3 (hero copy) | ✓ | ✓ | `heading level:1, name:"The Daily Read"`; tagline literal `"AI news worth your morning."` |
| REQ-4 (document title) | ✓ | ✓ | `document.title === "Sieve — The Daily Read"` test |
| REQ-5 (nav links: Sieve home + Blog ext) | ✓ | partial | Blog link has correct `target="_blank"` and `rel="noopener noreferrer"`. No explicit unit test asserts the `href`/`rel` on the Blog `<a>`; only the footer link is asserted (`/blog\.vertexcover\.io/`). Low risk but a tighter test would not hurt |
| REQ-6 (footer blog link) | ✓ | ✓ | regex match in listing test |
| REQ-7 (Sieve navigates home) | ✓ | ✗ | Implemented via `<Link to="/">`; no click test. Static verification only |
| REQ-8 (no right rail) | ✓ | ✓ | Explicit test "does not render a right rail" |
| REQ-9 (rank shown once in left rail) | ✓ | ✓ | `ArchivePage` test asserts `/N°.*01/` and `/N°.*02/` against left rail |
| REQ-10 (source label once in eyebrow, no host badge) | ✓ | partial | `truncateHost` removed; eyebrow tests still pass. No explicit assertion that `x.com` (EDGE-4) is absent. Low risk |
| REQ-11 (2-col grid template) | ✓ | ✓ | className contains `md:grid-cols-[120px_minmax(0,1fr)]` |
| EDGE-1 (empty list) | ✓ (preserved) | ✓ | existing REQ-028 test still passes filter-chip count |
| EDGE-2 (fetch error) | ✓ (preserved) | ✓ | existing REQ-027 test |
| EDGE-3 (single-month) | ✓ | ✓ | rewritten as "VER-94: single-month fixture renders one group header and zero filter chips" |
| EDGE-4 (twitter x.com host) | ✓ (host badge removed entirely, so trivially holds) | ✗ | no explicit assertion |
| EDGE-5 (rank=1 lead) | ✓ | ✓ | existing tests for `01` + `LEAD STORY` |

## Files reviewed
- `packages/web/src/components/ArchiveStoryCard.tsx` — looks good; clean removal of `totalCount`, `truncateHost`, and right rail. Grid template matches REQ-11
- `packages/web/src/components/archive-listing/FilterChip.tsx` — deleted; no remaining importers (verified with grep across `packages/web/src` and `packages/web/tests`)
- `packages/web/src/components/archive-listing/format.ts` — `buildMonthChips`/`MonthChip` removal is safe; no remaining references
- `packages/web/src/layouts/PublicLayout.tsx` — looks good; `Link` for brand, `target="_blank" rel="noopener noreferrer"` on Blog and footer external link
- `packages/web/src/pages/ArchiveListingPage.tsx` — looks good; state simplified from `{month, count}` to `useState<number>(10)`. Tagline + h1 + title all match spec
- `packages/web/src/pages/ArchivePage.tsx` — minimal one-line change to drop `totalCount`
- `packages/web/tests/unit/ArchivePage.test.tsx` — replaced `01 / 02` / `02 / 02` assertions with positive left-rail content checks (good — tests new behavior)
- `packages/web/tests/unit/ArchiveStoryCard.test.tsx` — prop drops are mechanical; new test asserts right-rail absence (positive case for new behavior)
- `packages/web/tests/unit/pages/ArchiveListingPage.test.tsx` — REQ-022..REQ-026 and EDGE-009 deletions are genuine since the filter-chip feature no longer exists. Replacement tests assert new copy and chip absence. Helper `getFilterChips()` retained as an absence assertion — sensible
