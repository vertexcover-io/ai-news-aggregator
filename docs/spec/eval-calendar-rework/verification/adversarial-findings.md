# Adversarial Findings

## Attack Surface Derived

- Spec gap: empty calendar dates and date changes after selection (`REQ-005`, `EDGE-004`).
- Claim-coverage gap: fixture import recovery when run detail fetch fails (`EDGE-010` adjacent).
- Claim-coverage gap: duplicate individual imports (`EDGE-011`).
- Boundary inputs: no selected runs, no runs for date, stale selected run after date switch.

## Scenarios Attempted

| ID | Category | Description | Inputs | Verdict |
|----|----------|-------------|--------|---------|
| ADV-1 | Boundary input | Calendar eval date with no completed runs keeps execution blocked. | `/admin/eval?mode=ab`, date `2026-05-20`, mocked `{runs:[]}` | EXPECTED |
| ADV-2 | Unexpected sequence | Select a run, then change to an empty date. | Select `11111111...`, then date `2026-05-20` | EXPECTED |
| ADV-3 | Error recovery | Fixture import run detail returns 500. | `/admin/eval/fixtures/new`, date `2026-05-19`, run `bad-detail-run`, mocked 500 | EXPECTED |
| ADV-4 | Duplicate input | Import the same source twice from a run detail dialog. | Click `Import source 1` twice | EXPECTED |

## Defects

None.

## Cannot Assess

- Real database persistence under live infra was not run in browser verification because the local API/database stack was not started; API persistence is covered by `admin-eval.test.ts` claims and typechecks.
- Real model ranking calls were not executed; browser verification used deterministic network mocks to avoid external cost and nondeterminism.

## Honest Declaration

No defects found across 4 scenarios attempted. Categories exercised: boundary input, unexpected sequence, error recovery, duplicate input. The most promising attack was stale run selection after date change; the selected run disappeared and `Run calendar eval` stayed disabled, so the stale ID did not leak into a runnable state.
