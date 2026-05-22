# SPEC: Eval Calendar Rework

**Source:** docs/spec/eval-calendar-rework/design.md
**Generated:** 2026-05-22

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Ubiquitous | The `/admin/eval` scored mode shall support only single-fixture runs. | The scored controls render no Top-N radio and no window-size input, and scored run requests never include `windowSize` or `forceWindow`. | Must |
| REQ-002 | Unwanted | If a scored eval request omits `fixtureId`, then the API shall reject the request. | `POST /api/admin/eval/run` with `{mode:"scored"}` emits an SSE `error` event with `fixtureId required for scored mode`. | Must |
| REQ-003 | Ubiquitous | The shared eval run request type shall not expose Top-N scored fields. | `EvalRunRequest` and `EvalRunRequestSchema` contain no `windowSize` or `forceWindow` properties. | Must |
| REQ-004 | Event-driven | When the calendar date changes in Mode B, the UI shall fetch completed newsletter runs for that date. | Selecting a date calls the calendar-runs API with `date=YYYY-MM-DD` and renders returned run rows. | Must |
| REQ-005 | State-driven | While a calendar date has no completed runs, the UI shall show an empty state and disable calendar execution. | With an empty API response, the run list displays a no-runs message and `Run calendar eval` is disabled. | Must |
| REQ-006 | Event-driven | When a user selects calendar runs, the UI shall maintain a multi-select set of run IDs. | Selecting two run checkboxes results in a run request containing exactly those two IDs. | Must |
| REQ-007 | Event-driven | When the user starts calendar eval, the UI shall send the selected run IDs and draft prompt. | `runEval` receives `{mode:"ab", date, runIds, draftPrompt}` and no saved-prompt execution fields are required. | Must |
| REQ-008 | Event-driven | When the API runs calendar eval, the system shall execute one draft ranking per selected run. | API unit tests assert `runEval` is called once per selected run and is passed `groundTruth:null` with the draft prompt. | Must |
| REQ-009 | Ubiquitous | Calendar eval reports shall compare previous archived ranking with draft-prompt ranking. | Each completed calendar result includes previous ranking rows from `run_archives.ranked_items` and draft ranking rows from the new `runEval` output. | Must |
| REQ-010 | Ubiquitous | Calendar eval reports shall expose prompt diff data for every selected run. | Each calendar report entry includes saved and draft prompt snapshots or hashes sufficient for the report dialog to render a prompt diff. | Must |
| REQ-011 | Ubiquitous | Calendar eval results shall be persisted in `eval_runs` for historical viewing. | The finished eval run stores selected run report entries in `scoreBreakdown` and per-run costs in `costBreakdown`. | Must |
| REQ-012 | Event-driven | When a calendar result row completes, the UI shall provide a report action for that run. | A completed selected-run row exposes a report button that opens previous-vs-draft ranking comparison. | Must |
| REQ-013 | Ubiquitous | The new-fixture page shall provide a date selector for run imports. | `/admin/eval/fixtures/new` renders a date input and fetches run import candidates for the chosen date. | Must |
| REQ-014 | Event-driven | When a fixture-import run is selected, the UI shall open a dialog with ranked items and source candidates. | Clicking a run preview opens a dialog showing archived ranked items and source pool rows. | Must |
| REQ-015 | Event-driven | When a user imports one source from the run dialog, the UI shall add exactly that source to the fixture draft. | Clicking an individual Import button adds one deduped source row to the fixture URL/source draft. | Must |
| REQ-016 | Event-driven | When a user imports all sources from the run dialog, the UI shall add all non-duplicate source rows to the fixture draft. | Clicking Import all adds every available source row once, deduped by raw item ID or URL. | Must |
| REQ-017 | Event-driven | When a fixture is submitted from imported run sources, the API shall create a valid fixture. | Submitting imported sources creates a fixture response with fixture ID and item count, then navigates to grading. | Must |
| REQ-018 | Ubiquitous | The existing URL-paste fixture workflow shall remain usable. | Existing manual fixture tests for pasted URLs still pass or are updated only for additive UI structure. | Must |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | A user opens scored mode after previous Top-N state was saved in session storage. | The page ignores obsolete Top-N state and renders single-fixture controls only. | REQ-001 |
| EDGE-002 | A client sends legacy `windowSize` to scored eval. | The API rejects the request rather than silently running a batch. | REQ-001, REQ-003 |
| EDGE-003 | Calendar run list fetch fails. | The UI shows an error state and disables calendar execution. | REQ-004 |
| EDGE-004 | User changes date after selecting runs. | The selected run IDs and previous calendar reports are cleared. | REQ-004, REQ-006 |
| EDGE-005 | Calendar eval starts with no selected runs. | The UI blocks execution and the API rejects `runIds:[]`. | REQ-006, REQ-007 |
| EDGE-006 | One selected run cannot reconstruct a fixture pool. | That run emits an error result without blocking other selected runs. | REQ-008, REQ-009 |
| EDGE-007 | Archived ranking references a raw item that cannot be hydrated. | The report renders a fallback ID/title and continues. | REQ-009 |
| EDGE-008 | Draft prompt matches saved prompt in Mode B. | Calendar execution remains disabled and the hint asks the user to edit the prompt. | REQ-007, REQ-010 |
| EDGE-009 | Fixture-import date has no completed runs. | The new-fixture page shows a no-runs message and no preview dialog actions. | REQ-013 |
| EDGE-010 | Run preview has no source candidates. | The dialog shows archived ranked items and an empty source-pool state; import buttons are disabled. | REQ-014 |
| EDGE-011 | User imports the same source twice. | The fixture draft keeps one row and indicates the source is already imported. | REQ-015, REQ-016 |
| EDGE-012 | User imports sources from multiple runs. | The resulting fixture does not claim a misleading single source run ID. | REQ-017 |

## Verification Matrix

| REQ ID | Unit Test | Integration Test | E2E Test | Manual Test | Notes |
|--------|-----------|-----------------|----------|-------------|-------|
| REQ-001 | Yes | No | Yes | No | Web unit + Playwright controls check. |
| REQ-002 | Yes | Yes | No | No | API SSE error test. |
| REQ-003 | Yes | No | No | No | Type/schema assertions by compile and unit tests. |
| REQ-004 | Yes | Yes | Yes | No | API client mocked in web tests; Playwright date change. |
| REQ-005 | Yes | No | Yes | No | Empty list UI. |
| REQ-006 | Yes | No | Yes | No | Multi-select UI and request body. |
| REQ-007 | Yes | Yes | Yes | No | API request body and Playwright run. |
| REQ-008 | Yes | Yes | No | No | API route runEval call-count test. |
| REQ-009 | Yes | Yes | Yes | No | Report payload builder + UI dialog. |
| REQ-010 | Yes | Yes | Yes | No | Prompt diff report assertions. |
| REQ-011 | Yes | Yes | No | No | eval_runs repository persistence test. |
| REQ-012 | Yes | No | Yes | No | Report action opens dialog. |
| REQ-013 | Yes | No | Yes | No | New fixture page date controls. |
| REQ-014 | Yes | Yes | Yes | No | Run preview dialog. |
| REQ-015 | Yes | No | Yes | No | Individual import. |
| REQ-016 | Yes | No | Yes | No | Import all. |
| REQ-017 | Yes | Yes | Yes | No | Fixture submit with imported source rows. |
| REQ-018 | Yes | No | No | No | Existing URL fixture tests preserved. |
| EDGE-001 | Yes | No | No | No | Session migration test. |
| EDGE-002 | Yes | Yes | No | No | Legacy payload rejection. |
| EDGE-003 | Yes | No | No | No | Mock failed query. |
| EDGE-004 | Yes | No | Yes | No | Date change clears state. |
| EDGE-005 | Yes | Yes | No | No | UI disabled + API validation. |
| EDGE-006 | Yes | Yes | No | No | Partial failure SSE test. |
| EDGE-007 | Yes | No | No | No | Report builder fallback test. |
| EDGE-008 | Yes | No | No | No | Existing dirty prompt guard updated. |
| EDGE-009 | Yes | No | No | No | New fixture empty state. |
| EDGE-010 | Yes | No | No | No | Preview dialog empty source pool. |
| EDGE-011 | Yes | No | No | No | Import dedupe. |
| EDGE-012 | Yes | Yes | No | No | Created fixture source/runId assertions. |

## Verification Scenarios

### VS-0: External dependency probes

No external dependency probes are required. See `verification/verification-stubs.md`.

### VS-1: Scored mode no longer has Top-N

Open `/admin/eval`, verify Mode A contains fixture selection and bypass cache only; no Top-N radio or window slider exists. Select one fixture and run a scored eval.

### VS-2: Calendar date loads selectable runs

Open `/admin/eval?mode=ab`, select a date with two completed runs, verify both runs render with checkboxes, select both, and confirm the run request includes both run IDs.

### VS-3: Calendar eval produces previous-vs-draft reports

Run calendar eval for two selected runs using a changed draft prompt. Verify each completed row opens a report comparing archived previous ranking with draft ranking and includes a prompt diff.

### VS-4: Calendar empty date blocks execution

Select a date with no completed runs. Verify the no-runs state appears and Run calendar eval is disabled.

### VS-5: New fixture imports sources from a run

Open `/admin/eval/fixtures/new`, select a date, open a run preview dialog, import one source, import all remaining sources, submit the fixture, and verify navigation to grading.

## Out of Scope

- Adding new external ranking providers.
- Adding a new database table for calendar reports.
- Changing the public archive or normal newsletter run ranking flow.
- Computing nDCG for calendar reports without human ground truth.
- Replaying the saved prompt in calendar mode.
