# Screenshot Observations

Expected ordering note: admin pages render the left admin navigation first, then page header/content, then the targeted selector panel; archive pages render the back link, issue header, share row, then story list.

## PHASE2-C1 Eval Calendar Date

Screenshot: `docs/spec/date-selectors-admin-timezone/verification/screenshots/PHASE2-C1-eval-calendar-date.png`

- Spec check: REQ-003, REQ-009, PHASE2-C1 MET. Playwright evidence returned `value: "2026-05-22"`, `max: "2026-05-22"` with mocked `scheduleTimezone: "America/Adak"` while the UTC date was already 2026-05-23. The mocked run text `Timezone smoke run` was visible.
- Open visual review: Page ordering is coherent: admin nav on the left, prompt/results content, then Mode B controls on the right. No overlap or clipping observed in the selector panel.

## PHASE2-C2 Fixture Import Date

Screenshot: `docs/spec/date-selectors-admin-timezone/verification/screenshots/PHASE2-C2-fixture-import-date.png`

- Spec check: REQ-004, REQ-009, PHASE2-C2 MET. Playwright evidence returned `value: "2026-05-22"`, `max: "2026-05-22"` with mocked `scheduleTimezone: "America/Adak"` and the mocked `Fixture smoke run` row visible.
- Open visual review: The import date control, run list, and form body remain in the expected left-column order. No overlapping text or broken empty/loading state observed.

## PHASE2-C3 Archive Issue Date

Screenshot: `docs/spec/date-selectors-admin-timezone/verification/screenshots/PHASE2-C3-archive-issue-date.png`

- Spec check: REQ-008, EDGE-004, PHASE2-C3 MET. Playwright evidence returned eyebrow text `SATURDAY · MAY 23 · 2026` for API payload `startedAt: "2026-05-22T19:44:00.000Z"` and `issueDate: "2026-05-23"`.
- Open visual review: The back link, issue date, headline, dek, and story body are vertically ordered. No visible clipping or overlap in the issue header.

## PHASE2-C4 Analytics Date Range

Screenshot: `docs/spec/date-selectors-admin-timezone/verification/screenshots/PHASE2-C4-analytics-date-range.png`

- Spec check: REQ-005, PHASE2-C4 MET. Playwright evidence returned `from: "2026-04-23"`, `to: "2026-05-22"`, `toMax: "2026-05-22"` with mocked `scheduleTimezone: "America/Adak"`.
- Open visual review: Header, date controls, granularity select, and metric cards render in order with no overlap.
