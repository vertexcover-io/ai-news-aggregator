# Design: Admin Settings Timezone for Date Selectors

## Problem Statement

Date selection currently mixes UTC dates, database timestamp dates, and browser-local dates. A run stored as `2026-05-22 19:47` can appear as `May 23` in the archive detail page for an Asia/Kolkata browser, while calendar eval run lookup still searches the raw database day `2026-05-22`. Users expect date pickers and archive issue dates to use the same timezone configured in admin settings.

## Context

- Admin settings already persist `scheduleTimezone` as an IANA timezone.
- The scheduler uses `scheduleTimezone` for run timing.
- The eval calendar selectors call `GET /api/admin/eval/calendar-runs?date=YYYY-MM-DD`.
- `packages/pipeline/src/repositories/eval-exports.ts` currently filters calendar runs with `date_trunc('day', completed_at) = date`.
- Archive list items compute `runDate` with `completedAt.toISOString().slice(0, 10)`.
- Archive detail renders `startedAt` with `Intl.DateTimeFormat` without a fixed timezone, so browser timezone controls the issue date.
- `run_archives.completed_at` and `started_at` are `timestamp without time zone`, so interpretation must be explicit and consistent.

## Requirements

### Functional

1. Date selector defaults for admin-facing date inputs shall use `settings.scheduleTimezone`, not UTC or the browser timezone.
2. Calendar eval date lookup shall interpret the selected date in `settings.scheduleTimezone`.
3. Manual fixture date import shall use the same calendar-run lookup behavior as calendar eval.
4. Archive issue dates shown in archive list/detail shall match the configured timezone day used by admin date selectors.
5. Analytics date selector defaults shall use `settings.scheduleTimezone`.
6. Date/time labels near selected runs shall display in `settings.scheduleTimezone`.

### Non-Functional

- The implementation should not add a new runtime dependency.
- Invalid or missing settings timezone should safely fall back to UTC.
- Existing API clients that omit timezone parameters should still work.
- The date boundary logic should be testable without browser timezone dependence.

### Edge Cases

- A run completed near midnight UTC must belong to the admin-settings local date, not the UTC date.
- A user in a different browser timezone must see the same archive issue date as other users.
- A missing settings row must not break public archive pages or eval date selectors.
- Daylight-saving transitions must use IANA timezone formatting, not fixed offsets.

## Key Insights

- The source of truth for calendar-day semantics should be `scheduleTimezone`.
- Native `<input type="date">` values are date-only strings; the app must decide which timezone those strings represent.
- Filtering by day is safest when converting each row's timestamp to the chosen timezone date in SQL.
- Public archive pages need a stable issue-date field from the API; otherwise browser timezone will keep causing mismatches.

## Architectural Challenges

- `run_archives.completed_at` is not timezone-aware, but the app already treats its serialized ISO output as an instant. This design keeps that behavior and makes day grouping explicit.
- Public archive routes currently do not read settings, so they need a small settings dependency or a helper that can obtain `scheduleTimezone`.
- Web pages should avoid duplicating timezone date logic in each component.

## Approaches Considered

### Approach A: Keep UTC Everywhere

Use UTC for date selectors and change archive detail to format in UTC.

Trade-off: simple, but it ignores the admin setting and contradicts scheduler semantics.

### Approach B: Browser Timezone Everywhere

Use browser-local dates for selectors, labels, and archive issue dates.

Trade-off: matches one user's view, but two users in different timezones would see different archive days and filters.

### Approach C: Admin Settings Timezone Everywhere

Use `settings.scheduleTimezone` for date picker defaults, API day filters, archive issue dates, and nearby labels.

Trade-off: requires plumbing timezone into a few API/UI seams, but it matches the user's mental model and existing scheduler configuration.

## Chosen Approach

Use Approach C. Add small timezone-date utilities in shared code for formatting `YYYY-MM-DD`, computing display labels, and validating timezone fallback. API endpoints that return or filter calendar dates read `scheduleTimezone` from settings and use it consistently. Web pages use the same timezone from `useSettings` for date defaults and labels.

## High-Level Design

1. Shared timezone utility:
   - `formatDateInTimezone(date, timezone): YYYY-MM-DD`
   - `formatDateTimeInTimezone(date, timezone): display string`
   - `safeTimezone(timezone): string`
2. Calendar run lookup:
   - Admin eval router reads `scheduleTimezone`.
   - Eval exports repository filters completed runs by `(completed_at AT TIME ZONE <tz>)::date = <selected date>`.
   - Returned run summaries may include the effective timezone for observability.
3. Archive APIs:
   - Archive list `runDate` is computed in `scheduleTimezone`.
   - Archive detail exposes a stable date/display input that the web header formats in `scheduleTimezone`.
4. Web date inputs:
   - Eval calendar mode and manual fixture import default/max dates use `scheduleTimezone`.
   - Analytics page defaults use `scheduleTimezone`.
   - Run labels use `Intl.DateTimeFormat` with `timeZone: scheduleTimezone`.
5. Tests:
   - Unit coverage for timezone utility around the `2026-05-22T19:47Z` / Asia/Kolkata => `2026-05-23` case.
   - API tests for calendar run lookup using configured timezone.
   - UI tests for date input defaults and labels using mocked settings.

## External Dependencies & Fallback Chain

None — pure-internal feature using built-in `Intl.DateTimeFormat` and existing settings data.

## Risks and Mitigations

- Risk: SQL timezone behavior differs for `timestamp without time zone`.
  - Mitigation: cover the near-midnight case in repository/API tests and document the chosen interpretation.
- Risk: public archive routes fail if settings are absent.
  - Mitigation: fallback to UTC.
- Risk: some existing tests assume browser-local date formatting.
  - Mitigation: update tests to assert explicit timezone labels.

## Open Questions

- Whether archive public pages should expose the configured timezone label to users. This design does not add visible timezone text unless already present in nearby metadata.
