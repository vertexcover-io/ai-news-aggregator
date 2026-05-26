# Review Page Enhancements

**Final verification:** ✅ PASSED — see [verification/proof-report.md](verification/proof-report.md)
**Quality gate:** ✅ PASS (9/9 checks)
**PR:** https://github.com/vertexcover-io/ai-news-aggregator/pull/212

## Summary

Five operator-facing improvements to the admin review page (`/admin/review/:runId`),
plus two supporting backend changes. The review toolbar gains a **"Shortlisted only"**
toggle and a grouped **"Source ▾"** filter (by derived identifier — subreddit, X handle,
hostname, owner/repo) that both apply to the ranked list and the pool. Pool (non-ranked)
items gain a **collapsible inline preview** (collapsed by default) — a tweet card or a
sanitized-markdown link card built from already-stored data. Every card now shows its
**real source identifier** next to the type badge. Behind the scenes the pipeline
**persists the stage-1 shortlist set** onto the archive and **drops already-published
links at the dedup stage** so they never re-enter the pool.

The UI matches the approved mockup (see the screenshot in
[verification/screenshots/](verification/screenshots/) and `verification/mockup.html` in
the worktree).

## Contents

| Doc | What it is |
|-----|-----------|
| [spec.md](spec.md) | EARS requirements (REQ-001…022), edge cases, verification matrix |
| [plan.md](plan.md) | 4-phase implementation plan + UI contract reference |
| [learnings.md](learnings.md) | Task-specific learnings from this build |
| [library-probe.md](library-probe.md) | react-markdown + dompurify probe (gitignored locally) |
| [verification/proof-report.md](verification/proof-report.md) | Functional-verify proof + UI claim → screenshot traceability |
| [verification/adversarial-findings.md](verification/adversarial-findings.md) | Role-swap break-it pass |
| [verification/screenshots/](verification/screenshots/) | Playwright screenshots (VS-1…VS-4) |

## Library probe verdict

**PASS.** `react-markdown@10.1.0` and `dompurify@3.4.5` selected for the FR3 sanitized
markdown excerpt; both verified in-browser (no auth, no network). No alternatives needed.

## What changed (by package)

- **shared** — `run_archives.shortlisted_item_ids` (migration 0033); `ItemPreview` union +
  `sourceIdentifier`/`preview` on `RankedItem`/`PoolItem`; `shortlistedItemIds` on `RunState`.
- **pipeline** — persist shortlist ids in finalize upsert; `getPublishedCanonicalUrls()` +
  covered-link filter before `dedupCandidates` (best-effort, reviewed && !dry-run && completed).
- **api** — `buildItemPreview`; `sourceIdentifier`+`preview` hydration; pool `selectedSources`
  + `shortlistedOnly` filters (reusing `deriveRawItemIdentifierSql`); `GET /api/admin/archives/:runId/source-facets`;
  admin GET exposes `shortlistedItemIds` (public routes never do).
- **web** — `react-markdown`+`dompurify`; `SafeMarkdown`, `ExpandedPreview`, `ReviewToolbar`,
  `useReviewFilters`, `useSourceFacets`; source identifier on cards; pool inline expansion.
