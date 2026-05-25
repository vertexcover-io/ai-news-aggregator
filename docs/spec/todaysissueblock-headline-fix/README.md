# Fix headline mismatch in `TodaysIssueBlock`

**Verification verdict:** ✅ PASS — see [verification/proof-report.md](./verification/proof-report.md)
**Quality gate:** ✅ PASS
**PR:** https://github.com/vertexcover-io/ai-news-aggregator/pull/191

## Summary

The public home page (`/`) "Today's Issue" block and the archive detail page
(`/archive/:runId`) derived an issue's headline with **reversed fallback precedence**, so
for issues that had both a `digestHeadline` and a differing top-story title, the home block
showed a different headline than the linked newsletter page. The archive page (the canonical
view) preferred the top-story title via `pickHeadline(topStoryTitle, digestHeadline)`, while
`TodaysIssueBlock` preferred `digestHeadline` inline.

The fix makes `TodaysIssueBlock` reuse the same exported `pickHeadline` function, so the two
surfaces share one source of truth and can never drift again. One-line behavior change plus a
new component unit test (7 cases incl. the cross-surface invariant) and a Playwright MCP UI proof.

## Changed code

- `packages/web/src/components/home/TodaysIssueBlock.tsx` — derive headline via `pickHeadline`.
- `packages/web/tests/unit/components/TodaysIssueBlock.test.tsx` (new) — 7 tests.
- `packages/web/tests/unit/pages/HomePage.test.tsx` — fixture aligned to correct precedence.
- `.claude/rules/learnings/shared-derivation-not-inline-duplication.md` (new) — captured learning.

## Artifacts

| Doc | Purpose |
|-----|---------|
| [design.md](./design.md) | Root-cause analysis + chosen fix |
| [spec.md](./spec.md) | EARS requirements + verification scenarios |
| [plan.md](./plan.md) | Single-phase implementation plan |
| [library-probe.md](./library-probe.md) | NOT_APPLICABLE — no external dependencies |
| [learnings.md](./learnings.md) | Task-specific notes |
| [verification/proof-report.md](./verification/proof-report.md) | Functional-verify verdict (UI proof) |
| [verification/adversarial-findings.md](./verification/adversarial-findings.md) | Adversarial pass |
| verification/screenshots/ | Playwright MCP screenshots (home `<h2>` === archive `<h1>`) |

## Library-probe verdict

NOT_APPLICABLE — no external library, API, or service introduced. The fix reuses the in-repo
pure function `pickHeadline` and data already present on `ArchiveListItem`.
