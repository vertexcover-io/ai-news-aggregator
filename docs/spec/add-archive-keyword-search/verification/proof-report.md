# Functional Verification — Proof Report

**Spec:** add-archive-keyword-search
**Run at:** 2026-05-07
**Result:** ALL SCENARIOS PASS

| Scenario | Pass/Fail | Evidence path |
|----------|-----------|---------------|
| VS-0-rdp-render (react-day-picker SSR) | PASS | `verification/rdp-probe.log` (`ok: true`, all DOM checks true) |
| VS-0-unaccent-fts (Postgres unaccent + websearch) | PASS | `verification/unaccent-probe.log` (`ALL OK`) |
| VS-1 empty query | PASS | `verification/api-e2e.log` (covered in `archives-search.e2e.test.ts`) |
| VS-2 keyword-only | PASS | `verification/api-e2e.log` |
| VS-3 range-only | PASS | `verification/api-e2e.log` |
| VS-4 keyword + range | PASS | `verification/api-e2e.log` |
| VS-5 override precedence | PASS | `verification/api-e2e.log` |
| VS-6 accent-insensitive | PASS | `verification/api-e2e.log` |
| VS-7 frontend empty state | PASS | `verification/web-e2e.log` (1/3 Playwright) |
| VS-8 frontend search flow | PASS | `verification/web-e2e.log` (2/3 Playwright) |
| VS-9 frontend date-range chip | PASS | `verification/web-e2e.log` (3/3 Playwright) |
| VS-10 perf gate (P95 ≤ 200 ms @ 1k archives) | PASS | `verification/perf-report.json` — **P95 = 14.37 ms** (P50 9.45 ms, P99 24.53 ms) |

## Summary

- API e2e: 3 files, 20 tests, all passed (`archives-search.e2e.test.ts`, `archives-search-migration.e2e.test.ts`, `run-archives-repo-search-text.e2e.test.ts`).
- Playwright e2e: 3/3 passed in `archive-search.spec.ts`.
- Bench: P95 14.37 ms — ~14× under the 200 ms gate.
- Library probes both green; no regressions in `unaccent` extension or `react-day-picker@9` SSR rendering.

No baseline failures touched. The 2 pre-existing failures in `runs.e2e.test.ts` were not exercised by this verification (out of scope).
