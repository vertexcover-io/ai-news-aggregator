# Design: Fix headline mismatch in `TodaysIssueBlock`

## Problem

On the public home page (`/`), the **Today's Issue** block (`TodaysIssueBlock`) shows
a headline for the latest issue. Clicking "Read today" navigates to the archive
detail page (`/archive/:runId`) — the canonical rendering of that newsletter issue.
For issues that have both a `digestHeadline` and a top-story title that differ, the
headline shown in `TodaysIssueBlock` does **not** match the headline shown on the
archive page.

## Root cause

The two surfaces derive the issue headline with **reversed fallback precedence**:

| Surface | File | Precedence |
|---------|------|-----------|
| Archive detail ("the actual newsletter") | `packages/web/src/components/ArchivePageHeader.tsx` → `pickHeadline()` | `topStoryTitle` → `digestHeadline` → `"An archived issue"` |
| Today's Issue block | `packages/web/src/components/home/TodaysIssueBlock.tsx:23-24` | `digestHeadline` → `topItems[0].title` → `"Today's issue"` |

```ts
// ArchivePageHeader.pickHeadline — top story wins
if (topStoryTitle) return topStoryTitle;
if (digestHeadline) return digestHeadline;
return "An archived issue";

// TodaysIssueBlock — digest headline wins (REVERSED)
const headline = issue.digestHeadline ?? (issue.topItems[0]?.title ?? "Today’s issue");
```

The underlying title strings are otherwise identical: both
`buildTopItems()` (feeding `topItems[0].title`) and the archive page's `rankedItems`
hydration resolve the top-story title via the same three-tier precedence
(`ref.title ?? recap.title ?? raw.title`). So the **only** divergence is the
order in which `digestHeadline` vs the top-story title is preferred. When
`digestHeadline` is present and differs from the top-story title (the common case
for issues created after VER-96), the two views disagree.

## Chosen fix

Make `TodaysIssueBlock` use the **same** headline precedence as the canonical
archive view, by reusing the already-exported `pickHeadline(topStoryTitle, digestHeadline)`
function from `ArchivePageHeader.tsx`.

```ts
import { pickHeadline } from "../ArchivePageHeader";
// ...
const headline = pickHeadline(issue.topItems[0]?.title ?? null, issue.digestHeadline);
```

`pickHeadline` already returns a non-empty string (its final fallback is
`"An archived issue"`), so the `?? "Today’s issue"` fallback in the current code is
no longer needed — the top-story/digest fallback chain plus `pickHeadline`'s own
terminal default fully covers the empty case.

### Why reuse rather than re-implement

Re-implementing the precedence inline in `TodaysIssueBlock` would reintroduce the
exact drift hazard that caused this bug. A single shared function is the only way to
guarantee the home block and the archive page can never disagree again. `pickHeadline`
is already exported and pure (no React dependency), so importing it is free.

### Scope boundaries (no scope creep)

- Only `TodaysIssueBlock.tsx` changes its headline derivation.
- The terminal fallback string changes from `"Today’s issue"` to `pickHeadline`'s
  `"An archived issue"`. This only surfaces when an issue has neither a top-story
  title nor a digest headline — an edge case that effectively never occurs for a
  reviewed issue (a reviewed issue always has ≥1 ranked story). Accepted as the cost
  of consistency; the archive page already shows `"An archived issue"` in that case,
  so the two stay aligned.
- No backend, type, or data-flow changes. `topItems` and `digestHeadline` are already
  on `ArchiveListItem` and populated identically to the archive page's inputs.

## External Dependencies & Fallback Chain

None. This is a pure frontend change reusing an existing in-repo function (`pickHeadline`)
and existing data already present on `ArchiveListItem`. No new libraries, APIs, or
services are introduced.

- **Primary:** reuse `pickHeadline` from `packages/web/src/components/ArchivePageHeader.tsx`.
- **Fallback:** none required (no external dependency).

## Verification

1. **Unit (component):** Render `TodaysIssueBlock` with an `issue` that has a
   `digestHeadline` differing from `topItems[0].title`; assert the rendered `<h2>`
   equals `topItems[0].title` (matching `pickHeadline` precedence), not the digest headline.
2. **Cross-surface invariant:** For the same `(topStoryTitle, digestHeadline)` inputs,
   assert `TodaysIssueBlock`'s headline === `pickHeadline(topStoryTitle, digestHeadline)`
   === the archive page header's headline.
3. **Fallback cases:** digestHeadline-only (no top story) → digest headline shown;
   neither present → `"An archived issue"`.
4. **E2E (Playwright):** Load `/`, read the Today's Issue `<h2>`, follow "Read today",
   read the archive `<h1>`, assert the two strings are equal.
