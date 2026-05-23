# Adversarial Findings — Ranking Eval UI Bug Fixes

## 1. Attack Surface Derived

- **Report action state:** completed rows should have report actions; running/error/legacy rows should not.
- **Scope transition:** Top-N and Single fixture are mutually exclusive, so selecting a fixture while Top-N is active must not leave contradictory UI state.
- **SSE payload trust boundary:** live UI consumes additive report fields from streamed JSON.
- **Stale/error recovery:** an error progress row after a successful run should clear the previous report affordance.

## 2. Scenarios Attempted

| ID | Category | Description | Inputs | Verdict |
|----|----------|-------------|--------|---------|
| ADV-001 | Unexpected sequence | Select Top-N, then inspect whether fixture select is still usable before selecting a fixture. | Browser state after clicking `Top-N recent`: `fixtureSelectState={"disabled":false,"topNChecked":true}` | EXPECTED |
| ADV-002 | Error recovery | Replace SSE response with an error progress row after a prior successful report row, then run Top-N. | SSE: `{"fixtureId":"adversarial-error-fixture","status":"error","error":"simulated failure"}` | EXPECTED |
| ADV-003 | Broken affordance check | Inspect report buttons after the error progress row. | Browser DOM: `reportButtons=[]`, row text `adversarial-error-fixtureerror—————simulated failure—` | EXPECTED |
| ADV-004 | Visual regression | Capture the error-row state after the adversarial run. | Screenshot `docs/spec/ranking-eval-pipeline-bugs/verification/screenshots/adversarial-error-no-report.png` | EXPECTED |

## 3. Defects

No defects found.

## 4. Cannot Assess

- Real Anthropic-backed ranking output was not invoked during browser verification. The browser route was stubbed to avoid external model calls; API SSE payload construction is covered by `packages/api/src/routes/__tests__/admin-eval.test.ts`.

## 5. Honest Declaration

No defects found across 4 scenarios attempted. Categories exercised: unexpected scope transitions, error recovery, broken report affordance checks, and visual regression. The most promising attack was replacing a successful report-producing run with an error-only SSE row, because stale row state could have left a misleading `Report` button behind; the DOM showed no report buttons and the row displayed the simulated failure instead.
