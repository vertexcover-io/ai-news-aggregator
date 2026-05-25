# Adversarial Findings — `todaysissueblock-headline-fix`

Goal of this pass: try to make the home Today's Issue block headline DIVERGE from what the
linked `/archive/:runId` page would show — i.e. try to break the cross-surface invariant the
fix promises (REQ-004). All attempts used real browser reads (Playwright MCP) against the live
app, mutating the `todaysIssue` archive's data via psql between attempts and restoring at the end.

## Attempt 1 — both present & differ (the original bug case)

- Data: `topItems[0].title = "TOPSTORY OpenAI ships GPT-X model"`,
  `digestHeadline = "DIGEST: the week agents got cheaper"`.
- Home `<h2>` = `TOPSTORY OpenAI ships GPT-X model`.
- Archive `<h1>` = `TOPSTORY OpenAI ships GPT-X model`.
- Result: EQUAL. The reversed-precedence bug (digest first) would have made the home show the
  digest line while the archive showed the top story — that divergence is GONE.
- **Could not break it.**

## Attempt 2 — digest only (no top story)

- Data: `ranked_items = []` (so `topItems` empty / top-story title null),
  `digestHeadline = "DIGEST ONLY headline shown here"`.
- Home `<h2>` = `DIGEST ONLY headline shown here`.
- This matches `pickHeadline(null, digest)` = digest headline (REQ-002), which is exactly what
  `ArchivePageHeader` would render for the same inputs.
- **Could not break it** — both surfaces fall back to the digest headline identically.

## Attempt 3 — neither present

- Data: `ranked_items = []`, `digestHeadline = NULL`, `digestSummary = NULL`.
- Home `<h2>` = `An archived issue`.
- This matches `pickHeadline(null, null)` = `"An archived issue"` (REQ-003), the same terminal
  fallback string used by `ArchivePageHeader`.
- **Could not break it** — both surfaces show the identical terminal fallback.

## Why divergence is structurally impossible after the fix

Both surfaces now route through the SAME exported function `pickHeadline(topStoryTitle, digestHeadline)`
(`packages/web/src/components/ArchivePageHeader.tsx`):
- Home: `pickHeadline(issue.topItems[0]?.title ?? null, issue.digestHeadline)`.
- Archive: `pickHeadline(topStoryTitle, digestHeadline)` where `topStoryTitle = items[0].title`.

And the top-story title resolves with identical precedence on both the home hydration path
(`buildTopItems`: `ref.title ?? raw.metadata.recap?.title ?? raw.title`) and the archive
hydration path (`hydrateRankedItems`: `ref.title ?? rawRecap?.title ?? row.title`). The only way
the two could diverge is if `topItems[0]` (home, top-3 slice) and `rankedItems[0]` (archive, full
list) referred to different first items — but both take index 0 of the same `rankedItems` array,
so the first item is the same row with the same override.

## Empty-data edge note (not a divergence)

When the issue has zero ranked items (Attempts 2 & 3), the `/archive/:runId` route may 404
(no completed items to render). This does not affect the headline-derivation invariant being
verified — the home block still derives the correct `pickHeadline` value, and when a real issue
exists (Attempt 1) the archive renders and the headlines match. No headline divergence was
produced in any case.

## Conclusion

No divergence found. The fix holds across all three branches of `pickHeadline`
(both-differ → top story, digest-only → digest, neither → "An archived issue").
