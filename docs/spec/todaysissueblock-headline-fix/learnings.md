# Learnings — `todaysissueblock-headline-fix`

## The bug

`TodaysIssueBlock.tsx` (home "Today's Issue" block) and `ArchivePageHeader.tsx` (the `/archive/:runId`
page it links to) both rendered an issue's headline from the same inputs (`topStoryTitle`,
`digestHeadline`) but with **reversed precedence**:

- Archive header: `pickHeadline(topStoryTitle, digestHeadline)` — top story first.
- Home block (before fix): `digestHeadline ?? topItems[0]?.title ?? "Today's issue"` — digest first,
  plus a different terminal fallback (`"Today's issue"` vs `"An archived issue"`).

When an issue had both a digest headline and a differing top-story title, the home block and the
linked archive page showed different headlines for the same issue.

## The fix (one line)

`TodaysIssueBlock` now calls the shared
`pickHeadline(issue.topItems[0]?.title ?? null, issue.digestHeadline)` imported from
`ArchivePageHeader`. Both surfaces now route through one derivation function, so they can never
diverge.

## Reusable learning (promoted)

Promoted to a project rule:
`.claude/rules/learnings/shared-derivation-not-inline-duplication.md` —
"Two surfaces that render the same logical value must share ONE derivation function, not
re-implement the precedence inline."

## Verification notes

- The local test DB had 30 archives but all with empty `ranked_items` and zero `raw_items`, so the
  "both present & differ" case had to be seeded. I scoped one reviewed archive to be the unique
  latest in the 48h window with a `ranked_items[0].title` override differing from `digest_headline`,
  proved home `<h2>` === archive `<h1>` === top-story title via Playwright MCP, then restored the DB.
- The home-listing top-title resolution (`buildTopItems`: `ref.title ?? recap.title ?? raw.title`)
  and the archive-detail resolution (`hydrateRankedItems`: `ref.title ?? recap.title ?? row.title`)
  are independent code paths but mirror each other — the cross-surface invariant depends on BOTH the
  shared `pickHeadline` AND these matching input-resolution chains.
- e2e suite failures observed during the gate (`settings`/`sources`/`must-read` e2e:
  `user_settings.shortlist_size` NOT NULL with no default) are pre-existing environmental DB drift —
  reproduced identically with the fix stashed — and are unrelated to this web-only change.
