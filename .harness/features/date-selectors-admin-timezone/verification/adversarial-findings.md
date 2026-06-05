# Adversarial Findings

## 1. Attack Surface Derived

- Spec-gap: invalid/missing timezone fallback across utilities, API routes, and UI defaults.
- Spec-gap: invalid date strings submitted to calendar/search APIs.
- Claim-coverage gap: user manually edits a date after timezone defaults are applied.
- Derived: browser bundle should not import Node-only modules through the shared package root.
- Derived: near-midnight UTC timestamps must not shift archive issue dates in the browser.

## 2. Scenarios Attempted

| ID | Category | Description | Inputs | Verdict |
|----|----------|-------------|--------|---------|
| ADV-001 | Boundary input | Invalid timezone falls back without throwing | `safeTimezone("Mars/Base")` and date formatting tests | EXPECTED |
| ADV-002 | Boundary input | Near-midnight UTC run maps to configured local date | `2026-05-22T19:47:55.923Z`, `Asia/Kolkata` | EXPECTED |
| ADV-003 | Invalid input | Calendar/search route rejects malformed date | `from=garbage`, `to=garbage`, calendar `date` schema tests | EXPECTED |
| ADV-004 | Unexpected sequence | User-selected date is not overwritten by settings-timezone effect | Date input `onChange` sets touched/override state in eval and fixture pages | EXPECTED |
| ADV-005 | Browser packaging | Web helper imports only `@newsletter/shared/utils/timezone-date` to avoid Node crypto in browser bundle | Vite page load after import change | EXPECTED |
| ADV-006 | Browser timezone drift | Archive page receives date-only `issueDate` and renders stable weekday/date | `issueDate: "2026-05-23"` with UTC timestamp one day earlier | EXPECTED |

## 3. Defects

No defects found.

## 4. Cannot Assess

- Live Postgres calendar query with a real persisted near-midnight archive was not exercised in browser verification; repository and route unit tests covered the SQL/date contract.

## 5. Honest Declaration

No defects found across 6 scenarios attempted. Categories exercised: boundary inputs, invalid input, unexpected sequence, browser packaging, and browser timezone drift. The most promising attack was the browser packaging check: the first browser run did fail because importing the shared root pulled `node:crypto` into Vite; narrowing the import to the timezone subpath fixed it and the follow-up browser sessions loaded with zero console errors.
