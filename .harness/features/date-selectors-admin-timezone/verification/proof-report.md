# Proof Report

Spec: `date-selectors-admin-timezone`
Date: 2026-05-23
Verdict: PASSED

## Evidence Summary

| Area | Evidence | Result |
|------|----------|--------|
| Shared utility | `pnpm --filter @newsletter/shared exec vitest run --project unit tests/unit/utils/timezone-date.test.ts` | 3 passed |
| API/repository | `pnpm --filter @newsletter/api exec vitest run --project unit src/routes/__tests__/admin-eval.test.ts tests/unit/repositories/run-archives.test.ts tests/unit/routes/archives-list.test.ts tests/unit/archives-route.test.ts tests/unit/archives-search-route.test.ts` | 94 passed |
| Web UI/unit | `pnpm --filter @newsletter/web exec vitest run --project unit tests/unit/ArchivePageHeader.test.tsx tests/unit/EvalIndexPage.test.tsx tests/unit/EvalManualFixturePage.test.tsx tests/unit/lib/dateSelectorTimezone.test.ts tests/unit/ArchivePage.test.tsx tests/unit/pages/ArchivePage.test.tsx` | 62 passed |
| Typecheck | `pnpm --filter @newsletter/shared typecheck`, `pnpm --filter @newsletter/api typecheck`, `pnpm --filter @newsletter/pipeline typecheck`, `pnpm --filter @newsletter/web typecheck` | all exit 0 |
| Lint | `pnpm --filter @newsletter/shared lint`, `pnpm --filter @newsletter/api lint`, `pnpm --filter @newsletter/pipeline lint`, `pnpm --filter @newsletter/web lint` | all exit 0; web reports existing warnings |
| Browser | Playwright MCP against `http://localhost:5174` with mocked settings timezone `America/Adak` | UI claims independently verified |

## Requirement Coverage

| ID | Verdict | Evidence |
|----|---------|----------|
| REQ-001 | MET | `timezone-date.test.ts` verifies `Asia/Kolkata` maps `2026-05-22T19:47:55.923Z` to `2026-05-23`. |
| REQ-002 | MET | `timezone-date.test.ts` and adversarial ADV-001 verify invalid timezone fallback to UTC. |
| REQ-003 | MET | `EvalIndexPage.test.tsx` plus PHASE2-C1 screenshot `docs/spec/date-selectors-admin-timezone/verification/screenshots/PHASE2-C1-eval-calendar-date.png`; Playwright returned `value/max: "2026-05-22"` for `America/Adak`. |
| REQ-004 | MET | `EvalManualFixturePage.test.tsx` plus PHASE2-C2 screenshot `docs/spec/date-selectors-admin-timezone/verification/screenshots/PHASE2-C2-fixture-import-date.png`; Playwright returned `value/max: "2026-05-22"` and visible mocked run. |
| REQ-005 | MET | PHASE2-C4 screenshot `docs/spec/date-selectors-admin-timezone/verification/screenshots/PHASE2-C4-analytics-date-range.png`; Playwright returned `from: "2026-04-23"`, `to/max: "2026-05-22"`. |
| REQ-006 | MET | `admin-eval.test.ts` verifies timezone passed to `listCalendarRunsByDate`; `eval-exports.ts` SQL converts completed_at from UTC to configured timezone date. |
| REQ-007 | MET | `run-archives.test.ts` verifies `listReviewed({ timezone: "Asia/Kolkata" })` returns `runDate: "2026-05-23"`. |
| REQ-008 | MET | PHASE2-C3 screenshot `docs/spec/date-selectors-admin-timezone/verification/screenshots/PHASE2-C3-archive-issue-date.png`; Playwright returned `SATURDAY · MAY 23 · 2026` for near-midnight timestamp with API `issueDate`. |
| REQ-009 | MET | Eval and fixture row timestamp formatting now uses `formatDateTimeForTimezone`; PHASE2-C1 and PHASE2-C2 browser screenshots cover the adjacent run-selection surfaces. |
| EDGE-001 | MET | Routes default to UTC when no `getSettingsRepo` is injected; utility fallback covers missing value. |
| EDGE-002 | MET | `safeTimezone` invalid timezone test and adversarial ADV-001. |
| EDGE-003 | MET | API/repository tests for near-midnight UTC completion. |
| EDGE-004 | MET | Archive header uses date-only `issueDate` and UTC formatting for date-only input; PHASE2-C3 screenshot. |
| EDGE-005 | MET | Existing zod date validation and `archives-search-route.test.ts` invalid date cases. |

## UI Claim Proof

- PHASE2-C1: `/admin/eval?mode=ab` date selector proof in `docs/spec/date-selectors-admin-timezone/verification/screenshots/PHASE2-C1-eval-calendar-date.png`.
- PHASE2-C2: `/admin/eval/fixtures/new` date selector proof in `docs/spec/date-selectors-admin-timezone/verification/screenshots/PHASE2-C2-fixture-import-date.png`.
- PHASE2-C3: `/archive/:runId` issue date proof in `docs/spec/date-selectors-admin-timezone/verification/screenshots/PHASE2-C3-archive-issue-date.png`.
- PHASE2-C4: `/admin/analytics` date range proof in `docs/spec/date-selectors-admin-timezone/verification/screenshots/PHASE2-C4-analytics-date-range.png`.

## Adversarial Pass

See `docs/spec/date-selectors-admin-timezone/verification/adversarial-findings.md`.

Summary: no defects found across 6 scenarios. One browser packaging defect was discovered during verification before the final pass; it was fixed by importing timezone helpers from `@newsletter/shared/utils/timezone-date`, then re-tested with browser console errors at 0.

## Not Executed

- A live database browser flow with a real near-midnight archive was not executed. Repository and route tests cover the SQL/date behavior; browser checks used mocked API payloads to isolate UI timezone rendering.
