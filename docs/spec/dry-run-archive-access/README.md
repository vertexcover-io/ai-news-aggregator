# Dry-Run Archive — Hidden from Listing, Accessible by Direct Link

**Verification verdict:** ✅ PASSED — see [verification/proof-report.md](verification/proof-report.md)
**PR:** https://github.com/vertexcover-io/ai-news-aggregator/pull/190

## Summary

A reviewed dry-run newsletter archive previously failed to load when opened via "View Archive": the public
route `GET /api/archives/:runId` returned **404** for any `is_dry_run = true` archive (an intentional
"avoid leaking existence" guard). The user wants dry runs **hidden from the public listing** but **reachable by
their direct link with no auth**. This change removes the single dry-run 404 guard from the public detail route
so a reviewed, completed dry run renders at `/archive/:runId` for anyone holding its UUID link, while the
listing (`GET /api/archives`) and search continue to exclude dry runs via the unchanged `is_dry_run = false`
SQL filter. Missing and un-reviewed archives still 404. The admin route, schema, and frontend are unchanged.

The fix is a one-line deletion plus updated unit tests and a doc line.

## Artifacts

| Document | What it covers |
|----------|----------------|
| [design.md](design.md) | Problem, current behavior, the decision, scope, no external deps |
| [spec.md](spec.md) | EARS requirements (REQ-001…006), edge cases, verification matrix |
| [plan.md](plan.md) | Single-phase plan + codebase context |
| [library-probe.md](library-probe.md) | NOT_APPLICABLE — no external dependencies |
| [learnings.md](learnings.md) | Stash-and-reproduce attribution; deliberate-guard product call; seed-SQL gotcha |
| [verification/proof-report.md](verification/proof-report.md) | Live PASS evidence (API curl + Playwright UI proof) |
| [verification/adversarial-findings.md](verification/adversarial-findings.md) | Break-it pass: leak surfaces, 404 guards, silent UI failure — 0 defects |
| verification/screenshots/ | PHASE1-C6 browser proof (archive renders; listing omits) |

## Library probe verdict

**NOT_APPLICABLE** — the change uses only the existing Hono + Drizzle + Vitest stack (verified by the
Stage-0 baseline). No new library, API, or SDK introduced; no alternatives evaluated.

## Changed files

- `packages/api/src/routes/archives.ts` — removed the public-route `if (archive.isDryRun) return 404` guard.
- `packages/api/tests/unit/archives-route.test.ts` — flipped R-14 (dry run → 200), added un-reviewed-dry-run
  404 + listing-excludes-dry-run + un-reviewed-live 404; kept live + admin regression.
- `packages/api/CLAUDE.md` — updated the archives route description.
