# Ranking eval pipeline bugs

## Scope

Fix two operator-facing bugs in `/admin/eval`:

1. Completed Mode A Per-fixture results rows must provide an obvious way to view
   the actual-vs-expected report for that fixture.
2. The fixture selector must remain usable while the Mode A scope is set to
   Top-N recent, and choosing a fixture must switch back to a single-fixture run.

## Requirements

| ID | Requirement | Verification |
| --- | --- | --- |
| REQ-001 | A successful scored SSE `progress` event shall include the ranked actual items needed to render the report. | API route unit test asserts `actualRanking` is present on successful progress payloads. |
| REQ-002 | A successful scored SSE `progress` event shall include expected ranking data when ground truth exists. | API route unit test asserts `expectedRanking` is present for a grounded fixture. |
| REQ-003 | Per-fixture results shall show a `Report` action for completed rows that include report data. | Web unit test and Playwright verification open the report dialog from the row action. |
| REQ-004 | Rows without report data, including error rows and old persisted rows, shall not show a misleading report action. | Web unit test and adversarial Playwright verification cover no-action rows. |
| REQ-005 | The fixture selector shall be enabled when Mode A scope is Top-N recent. | Web unit test and Playwright verification assert the select is enabled. |
| REQ-006 | Selecting a non-empty fixture while in Top-N recent shall switch the scope to single fixture and clear forced-window state. | Web unit test asserts the next run sends `fixtureId` without `windowSize`; Playwright verification confirms the UI state. |

## Verification

- `pnpm --filter @newsletter/web exec vitest run --project unit tests/unit/EvalIndexPage.test.tsx`
- `pnpm --filter @newsletter/api exec vitest run --project unit src/routes/__tests__/admin-eval.test.ts`
- `pnpm --filter @newsletter/web typecheck`
- `pnpm --filter @newsletter/api typecheck`
- `pnpm --filter @newsletter/web lint`
- `pnpm --filter @newsletter/api lint`
- Playwright verification against `/admin/eval` with deterministic SSE route stubs.
