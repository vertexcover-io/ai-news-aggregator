# Proof Report — Ranking Eval UI Bug Fixes

## Verdict

PASS

## Infrastructure

- Existing web server: `http://localhost:5173` returned HTTP `200`.
- Existing API server: `http://localhost:3000` returned HTTP `404` on root, confirming a process was already listening.
- No long-running server process was started by this verification pass.
- Browser verification used Playwright MCP against the live Vite page with `POST /api/admin/eval/run` route fulfillment for deterministic SSE payloads.

## Claims Coverage

| Claim | Verdict | Evidence |
|-------|---------|----------|
| PHASE1-C1 | PASSED | `docs/spec/ranking-eval-pipeline-bugs/verification/screenshots/PHASE1-C1-report-dialog.png` shows the row-level report dialog, score strip, and actual-vs-expected table for `manual-demo-1779440116981`. |
| PHASE1-C2 | PASSED | `docs/spec/ranking-eval-pipeline-bugs/verification/screenshots/PHASE1-C2-C3-results-table.png` shows a single row-level `Report` button only for the completed row; adversarial screenshot `docs/spec/ranking-eval-pipeline-bugs/verification/screenshots/adversarial-error-no-report.png` shows an error row without any report button. |
| PHASE1-C3 | PASSED | `docs/spec/ranking-eval-pipeline-bugs/verification/screenshots/PHASE1-C2-C3-results-table.png` plus DOM evidence: `fixtureSelectDisabled=false`, `fixtureValue=manual-demo-1779440116981`, `singleChecked=true`, `topNChecked=false`. |
| PHASE1-C4 | PASSED | Covered by API test `packages/api/src/routes/__tests__/admin-eval.test.ts::REQ-004: successful scored progress event includes report payload`; targeted run passed 19/19 tests. |

## Requirements Coverage

| Requirement | Verdict | Evidence |
|-------------|---------|----------|
| REQ-001 | PASSED | PHASE1-C1 / screenshot `verification/screenshots/PHASE1-C2-C3-results-table.png` shows `Report for manual-demo-1779440116981` in the completed per-fixture row. |
| REQ-002 | PASSED | PHASE1-C1 / screenshot `verification/screenshots/PHASE1-C1-report-dialog.png` shows report table rows containing `Expected proof story` and `Actual proof story`. |
| REQ-003 | PASSED | PHASE1-C2 / adversarial screenshot `verification/screenshots/adversarial-error-no-report.png` shows an error row with no report action. |
| REQ-004 | PASSED | PHASE1-C4 / API test evidence in `.harness/ranking-eval-pipeline-bugs/claims.json`; test asserts final scored progress event contains `actualRanking` and `expectedRanking`. |
| REQ-005 | PASSED | PHASE1-C3 / DOM evidence while Top-N was active: `fixtureSelectState={"disabled":false,"topNChecked":true}`. |
| REQ-006 | PASSED | PHASE1-C3 / DOM evidence after selecting fixture from Top-N: `singleChecked=true`, `topNChecked=false`, row rendered for selected fixture. |

## Edge Cases Coverage

| Edge | Verdict | Evidence |
|------|---------|----------|
| EDGE-001 | PASSED | Adversarial scenario ADV-002 showed error row `adversarial-error-fixture` with no report action. |
| EDGE-002 | PASSED | Unit test `REQ-003 EDGE-002: rows without report payload do not show report actions` passed. |
| EDGE-003 | PASSED | Report guard accepts an `actualRanking` payload array even when empty; reviewed in code and covered by report payload availability logic. |
| EDGE-004 | PASSED | Unit test `REQ-005 REQ-006: selecting a fixture from Top-N switches back to single-fixture mode` passed and browser DOM confirmed scope transition. |

## Commands Re-Run

- `pnpm --filter @newsletter/web exec vitest run --project unit tests/unit/EvalIndexPage.test.tsx` — 16 tests passed.
- `pnpm --filter @newsletter/api exec vitest run --project unit src/routes/__tests__/admin-eval.test.ts` — 19 tests passed.
- `pnpm --filter @newsletter/web typecheck` — exit code 0.
- `pnpm --filter @newsletter/api typecheck` — exit code 0.
- `pnpm --filter @newsletter/web lint` — exit code 0 with existing warnings.
- `pnpm --filter @newsletter/api lint` — exit code 0.

## Adversarial Pass

See `docs/spec/ranking-eval-pipeline-bugs/verification/adversarial-findings.md`.

## Not Executed

- Full `@newsletter/web test:unit` remains blocked by pre-existing localStorage environment failures unrelated to this change, recorded in `.harness/ranking-eval-pipeline-bugs/baseline.json`.
- Real model-backed eval run was not executed; verification used deterministic SSE route fulfillment to prove UI behavior without external API cost or flakiness.
