# Proof Report: Eval Calendar Rework

Verdict: PASSED

## Summary

The ranking eval pipeline rework meets the specified behavior in tests and browser verification. API claims executed 19 backend route tests. UI claims were re-proven with Playwright against the live Vite app using deterministic admin/API route mocks.

## Evidence

| Claim | Verdict | Evidence |
|-------|---------|----------|
| PHASE1-C1 | PASSED | `admin-eval.test.ts` rejects legacy Top-N fields and requires `fixtureId`. |
| PHASE1-C2 | PASSED | `admin-eval.test.ts` covers `GET /api/admin/eval/calendar-runs`. |
| PHASE1-C3 | PASSED | `admin-eval.test.ts` covers selected `runIds`, draft-only ranking, calendar report persistence. |
| PHASE1-C4 | PASSED | `admin-eval.test.ts` covers empty selection and per-run failure isolation. |
| PHASE2-C1 | PASSED | `docs/spec/eval-calendar-rework/verification/screenshots/PHASE2-C2-calendar-run-picker.png`; browser query: Top-N count `0`, window slider count `0`, fixture select count `1`. |
| PHASE2-C2 | PASSED | `docs/spec/eval-calendar-rework/verification/screenshots/PHASE2-C2-calendar-run-picker.png`; browser query: calendar checkbox count `1`, visible `Morning digest`. |
| PHASE2-C3 | PASSED | `docs/spec/eval-calendar-rework/verification/screenshots/PHASE2-C3-calendar-report-dialog.png`; browser query: `Previous story`, `Draft story`, and saved prompt snapshot visible. |
| PHASE3-C1 | PASSED | `docs/spec/eval-calendar-rework/verification/screenshots/PHASE3-C1-C2-fixture-import-dialog.png`; dialog count `1`, ranked item and source URL visible. |
| PHASE3-C2 | PASSED | `docs/spec/eval-calendar-rework/verification/screenshots/PHASE3-C1-C2-fixture-import-dialog.png`; imported textarea value `https://example.com/a`. |
| PHASE4-C1 | PASSED | `docs/spec/eval-calendar-rework/verification/screenshots/PHASE4-C1-calendar-run-drawer-report.png`; report tab count `1`, previous and draft ranking rows visible. |
| PHASE4-C2 | PASSED | `docs/spec/eval-calendar-rework/verification/screenshots/PHASE4-C2-legacy-modeb-breakdown.png`; report tab count `0` for legacy Mode B row. |

## Spec Coverage

| Requirement | Verdict | Evidence |
|-------------|---------|----------|
| REQ-001 | MET | PHASE1-C1, PHASE2-C1 |
| REQ-002 | MET | PHASE1-C1 |
| REQ-003 | MET | PHASE1-C1, shared/API typecheck |
| REQ-004 | MET | PHASE1-C2, PHASE2-C2 |
| REQ-005 | MET | ADV-1: empty date showed no-runs state and disabled run button. |
| REQ-006 | MET | PHASE2-C2 |
| REQ-007 | MET | PHASE2-C2 unit request assertion |
| REQ-008 | MET | PHASE1-C3 |
| REQ-009 | MET | PHASE1-C3, PHASE2-C3, PHASE4-C1 |
| REQ-010 | MET | PHASE1-C3, PHASE2-C3, PHASE4-C1 |
| REQ-011 | MET | PHASE1-C3 |
| REQ-012 | MET | PHASE2-C3 |
| REQ-013 | MET | PHASE3-C1 |
| REQ-014 | MET | PHASE3-C1 |
| REQ-015 | MET | PHASE3-C2 |
| REQ-016 | MET | PHASE3-C2 |
| REQ-017 | MET | Unit test imports from calendar `sourcePool`, disables rows without source payloads, and submits imported sources through `createManualFixture`. |
| REQ-018 | MET | Existing manual URL paste tests still pass. |

## Commands

- `pnpm --filter @newsletter/web exec vitest run --project unit tests/unit/EvalIndexPage.test.tsx tests/unit/EvalManualFixturePage.test.tsx tests/unit/RunDetailDrawer.test.tsx`: 37 passed.
- `pnpm --filter @newsletter/api exec vitest run --project unit src/routes/__tests__/admin-eval.test.ts`: 19 passed.
- `pnpm --filter @newsletter/web typecheck`: passed.
- `pnpm --filter @newsletter/api typecheck && pnpm --filter @newsletter/shared typecheck && pnpm --filter @newsletter/pipeline typecheck`: passed.
- `pnpm --filter @newsletter/web lint`: passed with 15 pre-existing warnings.
- `pnpm --filter @newsletter/api lint`: passed.

## Adversarial Pass

See `docs/spec/eval-calendar-rework/verification/adversarial-findings.md`.

No defects were found. Attempted empty calendar dates, date-switch stale selection, fixture import detail 500 recovery, and duplicate source import.

## Not Executed

- Full live API/browser integration against the real database was not executed; browser verification mocked admin/API responses. Backend route and persistence behavior is covered by API unit tests.
- Real ranking provider calls were not executed to avoid external cost and nondeterminism.
