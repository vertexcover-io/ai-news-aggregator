# SPEC: Admin Settings Timezone for Date Selectors

**Source:** docs/spec/date-selectors-admin-timezone/design.md
**Generated:** 2026-05-23

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Ubiquitous | The system shall derive date-only strings from the configured admin `scheduleTimezone`. | Given instant `2026-05-22T19:47:55.923Z` and timezone `Asia/Kolkata`, the shared utility returns `2026-05-23`. | Must |
| REQ-002 | Ubiquitous | The system shall fall back to `UTC` when the configured timezone is missing or invalid. | Given an invalid timezone, date formatting and date filtering complete without throwing and use UTC output. | Must |
| REQ-003 | Event-driven | When the admin eval calendar date selector loads, the system shall default and cap dates using `scheduleTimezone`. | With mocked current instant `2026-05-22T19:47:55.923Z` and settings `Asia/Kolkata`, the date input value/max is `2026-05-23`. | Must |
| REQ-004 | Event-driven | When the manual fixture import date selector loads, the system shall default and display run dates using `scheduleTimezone`. | With mocked settings `Asia/Kolkata`, the import date defaults to `2026-05-23` and run timestamps display with the configured timezone. | Must |
| REQ-005 | Event-driven | When the analytics page date selectors initialize, the system shall compute default `from` and `to` dates using `scheduleTimezone`. | With mocked current instant `2026-05-22T19:47:55.923Z` and settings `Asia/Kolkata`, the `to` value is `2026-05-23`. | Should |
| REQ-006 | Event-driven | When the calendar-runs API receives a selected date, the system shall interpret that date in admin `scheduleTimezone`. | A run completed at `2026-05-22T19:47:55.923Z` is returned for `date=2026-05-23` when settings timezone is `Asia/Kolkata`. | Must |
| REQ-007 | Ubiquitous | The archive list API shall compute `runDate` using admin `scheduleTimezone`. | The archive row for the same near-midnight run returns `runDate: "2026-05-23"` when settings timezone is `Asia/Kolkata`. | Must |
| REQ-008 | Ubiquitous | The archive detail header shall render the issue date using admin `scheduleTimezone`, not browser timezone. | A browser running in UTC and a browser running in America/Los_Angeles both render `SATURDAY · MAY 23 · 2026` for the near-midnight Asia/Kolkata run. | Must |
| REQ-009 | Ubiquitous | Date/time labels adjacent to calendar run selections shall display in admin `scheduleTimezone`. | Eval calendar and fixture import run rows show the same configured-timezone date/time for the same run. | Should |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | No settings row exists | Date utilities and APIs use `UTC`; pages still render. | REQ-002 |
| EDGE-002 | Settings timezone is invalid | API and UI fall back to UTC without crashing. | REQ-002 |
| EDGE-003 | Run completes near UTC midnight | The run belongs to the configured timezone date. | REQ-001, REQ-006, REQ-007 |
| EDGE-004 | Browser timezone differs from admin timezone | Archive issue date remains stable across browser timezones. | REQ-008 |
| EDGE-005 | Date selector sends an invalid date string | Existing API validation rejects the request with 400. | REQ-006 |

## Verification Matrix

| REQ ID | Unit Test | Integration Test | E2E Test | Manual Test | Notes |
|--------|-----------|-----------------|----------|-------------|-------|
| REQ-001 | Yes | No | No | No | Shared timezone utility test. |
| REQ-002 | Yes | Yes | No | No | Utility and route fallback tests. |
| REQ-003 | Yes | No | Yes | No | Eval page unit plus browser verification. |
| REQ-004 | Yes | No | Yes | No | Manual fixture page unit plus browser verification. |
| REQ-005 | Yes | No | No | No | Analytics page unit test. |
| REQ-006 | Yes | Yes | No | No | API route/repository test. |
| REQ-007 | Yes | Yes | No | No | Archive repo/API test. |
| REQ-008 | Yes | No | Yes | No | Component unit and browser screenshot. |
| REQ-009 | Yes | No | Yes | No | Eval/manual fixture UI tests and browser verification. |
| EDGE-001 | Yes | Yes | No | No | Missing settings fallback. |
| EDGE-002 | Yes | Yes | No | No | Invalid timezone fallback. |
| EDGE-003 | Yes | Yes | Yes | No | Near-midnight fixture. |
| EDGE-004 | Yes | No | Yes | No | Browser timezone-independent rendering. |
| EDGE-005 | Yes | Yes | No | No | Existing date validation remains. |

## Out of Scope

- Changing the database column types from `timestamp` to `timestamptz`.
- Adding visible timezone labels to every public archive date.
- Changing scheduler behavior; it already uses `scheduleTimezone`.
- Reworking non-date controls.

## Verification Scenarios

### VS-0 Library Probe

Not applicable: no new external dependency.
