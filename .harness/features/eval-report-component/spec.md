# SPEC: Eval Run Report — Two-Tab Redesign + "Items Sent for Ranking"

**Source:** docs/spec/eval-report-component/design.md
**Generated:** 2026-05-23
**Surface:** `/admin/eval/runs` run-detail modal (`RunDetailDrawer`)
**Approved mock:** `docs/mocks/eval-report-redesign.html` (+ `mock-1-prompt-cost-tab.png`, `mock-2b-report-modeB-hidden-scroll.png`, `mock-3-report-modeA.png`) — the visual source of truth.

## Summary

Restructure the eval run-detail modal from a fixed prompt/tabs split into **two full-width tabs** — "Prompt & Cost" (prompt snapshot + score/cost breakdown) and "Report" (rankings, full width) — for both Mode A (scored) and Mode B (calendar). Add an "items sent for ranking" funnel to the Report tab that surfaces the candidate-pool size (items sent to the LLM ranker) alongside the ranked-output count, where "sent for ranking" = the deduped fixture/pool size.

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Ubiquitous | The run-detail modal shall present its body as exactly two tabs labelled "Prompt & Cost" and "Report". | Modal renders two `role="tab"` controls with accessible names "Prompt & Cost" and "Report"; no third tab. | Must |
| REQ-002 | Event-driven | When the "Prompt & Cost" tab is active, the modal shall display the prompt snapshot and the score breakdown and the cost breakdown within that single tab panel. | The active `prompt-cost` panel contains the prompt-snapshot region, a score-breakdown table, and a cost-breakdown table. | Must |
| REQ-003 | Event-driven | When the "Report" tab is active, the modal shall render the two ranking columns spanning the full modal width. | The `report` panel's ranking columns container uses a full-width two-column layout (not nested inside a half-width pane). | Must |
| REQ-004 | State-driven | While report data is available for a run, the modal shall default to the "Report" tab on open. | Opening a done run that carries report data shows the Report panel active without user interaction. | Must |
| REQ-005 | State-driven | While report data is unavailable (running, failed, or legacy run), the modal shall default to the "Prompt & Cost" tab. | Opening such a run shows the Prompt & Cost panel active. | Must |
| REQ-006 | Ubiquitous | Each of the four scroll regions (previous/expected ranking, draft/actual ranking, saved prompt, draft prompt) shall be independently scrollable with its scrollbar visually hidden. | Each region has its own overflow container; computed style hides the scrollbar (`scrollbar-width: none` / `::-webkit-scrollbar` collapsed); scrolling one region does not move the others. | Must |
| REQ-007 | Event-driven | When the Report tab renders for a run with a known pool size, the system shall display a funnel showing items sent for ranking and items ranked. | Funnel shows the "sent for ranking" count (= pool size) and the "ranked" count (= ranked-output length) for the run. | Must |
| REQ-008 | Ubiquitous | The "items sent for ranking" value shall equal the deduped candidate-pool size that was fed to the LLM ranker. | For a Mode B run, the funnel's sent count equals `detail.sourcePool.length` (= persisted `poolSize`); for Mode A it equals the fixture pool size. | Must |
| REQ-009 | Event-driven | When a Mode B comparison run completes, the system shall persist the pool size on the report entry. | The persisted `CalendarRunReportEntry` (status `done`) carries a numeric `poolSize` equal to `sourcePool.length`. | Must |
| REQ-010 | Ubiquitous | The Report tab label shall display a compact "N → ranked" hint reflecting the funnel counts. | Tab label includes a count chip of the form `<sent> → <ranked>` when pool size is known. | Should |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | A run persisted before this change has no `poolSize` on its report entry (legacy). | The funnel omits the pool/sent steps (or shows "—") and the rest of the report renders without error; the tab hint chip is hidden. | REQ-007, REQ-008, REQ-010 |
| EDGE-002 | The candidate pool size equals the ranked-output count (pool ≤ 10, nothing dropped). | Funnel shows equal sent and ranked counts; the "considered but not surfaced" note shows 0 (or is suppressed). | REQ-007 |
| EDGE-003 | A Mode B selected run has an empty source pool. | The existing `"run source pool empty"` error path is unchanged; an `error` report entry is produced with no `poolSize`; the modal renders the error state, not a funnel. | REQ-009 |
| EDGE-004 | A run is still running when the modal opens. | Modal defaults to "Prompt & Cost"; the Report tab shows the existing running placeholder (no funnel with bogus zeros). | REQ-005, REQ-007 |
| EDGE-005 | A failed run with an error message. | Modal defaults to "Prompt & Cost"; the existing error banner renders; Report tab shows the failed empty-report state. | REQ-005 |
| EDGE-006 | Mode A run (scored) opened. | Two-tab layout and funnel apply; ranking columns are Expected (graded) vs Actual (ranker); funnel sent = fixture pool size, ranked = actual-ranking length. | REQ-001, REQ-003, REQ-007 |

## Verification Matrix

| ID | Unit Test | Integration Test | E2E Test | Manual Test | Notes |
|--------|-----------|-----------------|----------|-------------|-------|
| REQ-001 | Yes | No | Yes | Yes | Web unit on tab labels; Playwright MCP visual confirm vs mock |
| REQ-002 | Yes | No | No | Yes | Web unit asserts prompt + both breakdown tables in one panel |
| REQ-003 | Yes | No | Yes | Yes | Full-width layout class assertion + visual confirm |
| REQ-004 | Yes | No | Yes | No | Default-tab logic unit + e2e open |
| REQ-005 | Yes | No | No | No | Default-tab logic unit (running/failed/legacy) |
| REQ-006 | Yes | No | No | Yes | Unit asserts hidden-scrollbar class on 4 regions; manual scroll check |
| REQ-007 | Yes | No | Yes | Yes | Funnel render unit + Playwright confirm `N → 10` |
| REQ-008 | Yes | Yes | No | No | Web unit on funnel value; api unit that `poolSize === sourcePool.length` |
| REQ-009 | Yes | Yes | No | No | shared type round-trip; api AB-route unit populates `poolSize` |
| REQ-010 | Yes | No | No | Yes | Tab hint chip unit; visual confirm |
| EDGE-001 | Yes | No | No | Yes | Legacy entry without `poolSize` renders gracefully |
| EDGE-002 | Yes | No | No | No | Equal counts render |
| EDGE-003 | Yes | Yes | No | No | Empty pool → error entry, no `poolSize` |
| EDGE-004 | Yes | No | No | No | Running placeholder, no funnel |
| EDGE-005 | Yes | No | No | No | Failed banner + empty report |
| EDGE-006 | Yes | No | Yes | Yes | Mode A two-tab + funnel |

## Verification Scenarios (VS-0 — from library-probe)

None. Library probe verdict is **NOT_APPLICABLE** — no external dependency introduced; nothing to re-probe. Functional verification drives the running app via Playwright MCP per the matrix above.

## Out of Scope

- No change to the live collect → dedup → shortlist → rank pipeline output (only `run_id` stamping and report presentation, both unchanged here except the new persisted `poolSize`).
- No new database tables or columns — `poolSize` rides inside the existing `eval_runs.scoreBreakdown` JSONB.
- No redesign of the runs *list* table, the filter bar, the pagination, or the compare-prompts dialog.
- No change to Mode A ground-truth grading logic; only the report *presentation* changes.
- No live re-ranking inside the modal — funnel counts are read from persisted/derived values.
- No change to the public archive routes (eval data is admin-only and untouched here).
