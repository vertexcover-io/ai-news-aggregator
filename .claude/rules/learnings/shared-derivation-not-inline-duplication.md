# Two surfaces that render the same logical value must share ONE derivation function — not re-implement the precedence inline

When two UI surfaces (or any two call sites) display "the same thing" — a headline, a label, a
formatted price, a status string — derived from the same inputs, they must call **one shared
function** for the derivation. The moment each surface re-implements the fallback chain inline,
the two implementations drift, and the drift is invisible until inputs hit the branch where they
disagree.

## What bit us

The public home page "Today's Issue" block (`TodaysIssueBlock.tsx`) and the archive detail page
header (`ArchivePageHeader.tsx`) both render an issue's headline from the same two inputs:
`topStoryTitle` and `digestHeadline`. They linked to each other ("Read today" → `/archive/:runId`),
so a visitor saw the headline twice.

- `ArchivePageHeader` used `pickHeadline(topStoryTitle, digestHeadline)`: **top story first**, digest
  headline as fallback, `"An archived issue"` terminal.
- `TodaysIssueBlock` re-implemented it inline as `digestHeadline ?? topItems[0]?.title ?? "Today's issue"`:
  **digest headline first** — the reversed precedence, AND a different terminal string.

For any issue that had BOTH a digest headline and a differing top-story title, the home block showed
the digest line while the linked archive page showed the top story — same issue, two different
headlines. The fix was one line: have `TodaysIssueBlock` call the same exported `pickHeadline`.

## Rule

When you find (or are about to write) a second place that displays a value already derived elsewhere:

1. **Extract / reuse the existing derivation function.** If surface A already has
   `pickHeadline(...)` / `formatX(...)` / `resolveLabel(...)`, surface B imports and calls it —
   it does not re-type the `??` / `||` / ternary chain.
2. **The function owns the precedence AND the terminal fallback.** Inline duplicates drift on both
   the ordering of the fallbacks and the final default string.
3. **Add a cross-surface invariant test:** for a table of input pairs covering every branch
   (both-present-and-differ, one-present, the-other-present, neither), assert
   `surfaceB_rendered === sharedFn(inputs)`. The "both present and differ" row is the one that
   catches reversed precedence — a happy-path "both equal" fixture will not.
4. **The inputs each surface feeds the function must resolve identically too.** Here both surfaces
   feed `firstItem.title` where the title itself resolves via `ref.title ?? recap.title ?? raw.title`
   on both the listing-hydration path and the detail-hydration path. If those resolution chains
   differ, the shared function still gets different inputs and the surfaces still diverge — verify
   the input-resolution chains match, not just the final function call.

## Heuristic

When reviewing a component that renders a headline / label / price / status, ask: "Is this value
shown anywhere else in the app?" If yes, grep for the existing derivation. If you find a `pickX` /
`formatX` / `resolveX`, this component MUST call it. If you find a second inline `a ?? b ?? "default"`
that mirrors it — that's the bug; collapse them to one function before the precedence drifts.

## Related

This is the React/cross-component sibling of
`js-sql-cross-check-must-include-edge-cases.md` (two implementations of the same logic in two
languages). Same failure mode — duplicated logic diverges — same defense — one source of truth plus
an edge-case-covering equivalence test.
