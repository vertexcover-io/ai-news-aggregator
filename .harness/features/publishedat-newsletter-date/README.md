# Newsletter date reflects scheduled publish date

**Verification verdict:** ✅ PASS — see [verification/proof-report.md](verification/proof-report.md)
**PR:** https://github.com/vertexcover-io/ai-news-aggregator/pull/193

## Summary

The UI now displays a newsletter issue's date as its **scheduled publish date** instead of
its pipeline-run date. A nullable `run_archives.published_at` (timestamptz, migration 0031)
is populated at successful-run finalize from the user's `emailTime` schedule (next
occurrence after the run completes, +1 day when the publish time is before the pipeline
time) via the guarded `resolveScheduledPublishAt` helper — which returns `null` (never
throws) when settings are missing, when `emailTime === pipelineTime`, or on a malformed
time, leaving `published_at` NULL on those and on failed/cancelled runs. All display
surfaces (public listing date block + month grouping, public archive detail issue date,
admin dashboard rows, and list/search ordering + issue numbering) derive the date as
`published_at` with a `completedAt` fallback, so pre-existing archives are unaffected and
no backfill is required. The raw `published_at` is kept internal — only the derived
`runDate`/`issueDate` strings are serialised on public routes.

## Artifacts

| Document | Purpose |
|----------|---------|
| [design.md](design.md) | Brainstorm output — problem, approaches, chosen design |
| [spec.md](spec.md) | EARS requirements (REQ-001..012), edge cases, verification matrix |
| [plan.md](plan.md) | 4-phase implementation plan + phase graph |
| [library-probe.md](library-probe.md) | Trust gate — NOT_APPLICABLE (pure-internal feature) |
| [learnings.md](learnings.md) | Pipeline-friction learnings from this run |
| [verification/proof-report.md](verification/proof-report.md) | Functional-verify verdict (PASS) + REQ/EDGE coverage matrix |
| [verification/adversarial-findings.md](verification/adversarial-findings.md) | Step-5 break-attempts (no defects found) |
| verification/screenshots/ | Playwright UI proofs for the 6 UI claims (C1, C2, C4, C5, C6, C7) |

## Library-probe verdict

NOT_APPLICABLE — no external dependency introduced. Reuses the existing in-repo
`publishDateForWindow` (`@newsletter/shared/scheduling`) and Drizzle/PostgreSQL already in
the stack. No new npm package, API, env var, or credential. Alternatives tried: N/A.

## Test summary

- Unit: shared 236, api 553, pipeline 891, web 643, eslint-plugin 30 — 0 failed (+24 new).
- Feature e2e: `archives.e2e` 14/14, `run-flow.e2e` 7/7.
- Typecheck 7/7, lint 0 errors. UI-proof gate: 6/6 UI claims proven with screenshots.
