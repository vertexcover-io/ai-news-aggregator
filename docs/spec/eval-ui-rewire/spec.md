# SPEC: Eval UI rewire (Stage C)

**Source:** Mocks at `docs/mocks/eval-redesign/`. Backend SPEC at `docs/spec/eval-runs-persistence-collectors/spec.md`.
**Generated:** 2026-05-22
**Stage:** Stage C of the eval-redesign sequence (mocks → backend → UI rewire). This SPEC is UI-only — no DB, no new API routes.

## Background

The mocks define the target. Stage B shipped the backend that powers them. Stage C rewires the React UI to match. Four surfaces change, one brand-new page is added:

| Surface | Mock | Change shape |
|---|---|---|
| `/admin/eval` (EvalIndexPage) | `01-eval-index.html` | Layout flip: prompt editor goes full-width with controls in a right rail; aggregate hero strip above per-fixture results; sourcing report uses stacked source bars; "Past runs" link in the page header. |
| `/admin/eval/grade/:fixtureId` (EvalGradePage) | `02-eval-grade.html` | Flat cluster rows in one bordered table; 3px rust left-rail for selection; keycap-tile label buttons (1/2/3); conic-gradient progress ring + tier bars; persistent keyboard hint bar. |
| `/admin/eval/fixtures/new` (EvalManualFixturePage) | `03-eval-fixture-new.html` | Action bar moves below the textarea + invalid-lines panel; pipeline explainer + source-mix preview rail; navigates to `/admin/eval?fixtureId=<id>` on success (not the grade page). |
| **NEW** `/admin/eval/runs` (EvalRunsPage) | `04-eval-runs.html`, `05-states.html` | Brand-new persisted-history page. Filter bar (search + mode + status segments), table with row checkboxes, "Compare prompts" bar that arms when 2 are selected, pagination, run-detail drawer. |

All four files use the shared design tokens defined in the mock theme: rust accent `#8C3A1E` for primary CTA + one status, Newsreader serif on H1 only, Geist Mono on all data, hairline neutral borders.

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-1 | Ubiquitous | The system shall implement the new `EvalRunsPage` at route `/admin/eval/runs` listing persisted eval runs from `GET /api/admin/eval/runs`. | Page renders the paginated table; default `perPage=20`; sortable by `started_at DESC` (server-side). Empty state matches mock 05 section C. | Must |
| REQ-2 | Event-driven | When a user enters a search query, selects a mode, or selects a status on `EvalRunsPage`, the system shall refetch with those filters as query params. | Each filter writes its value into `?q=` / `?mode=` / `?status=` URL state. React Query refetches on param change. | Must |
| REQ-3 | Event-driven | When the user checks exactly two run rows on `EvalRunsPage` and clicks "Compare prompts", the system shall fetch both runs in parallel via `GET /runs/:id` and display their `prompt_snapshot` side by side in a diff view. | Two parallel API calls; result rendered using `diff-match-patch` or a similar lib. The compare button is disabled at 0 or 1 selected; armed (rust) when exactly 2 are selected. | Must |
| REQ-4 | Event-driven | When the user clicks a run id or prompt hash, the system shall open a `RunDetailDrawer` showing `prompt_snapshot` on the left and `score_breakdown` + `cost_breakdown` on the right (mock 05 section B). | Drawer fetches `GET /runs/:id` on open; renders the snapshot as a line-numbered code block; renders the breakdowns as tables. | Must |
| REQ-5 | Ubiquitous | The system shall rewire `EvalIndexPage` to the mock-01 layout: prompt editor full-width with a controls right rail, aggregate hero strip above per-fixture results, sourcing report with stacked source bars. | Visual match within reason. Tests assert: editor textarea is rendered; right rail contains the mode tabs + scope toggle + fixture picker + window slider + bypass cache + run button; aggregate hero only renders when a run has completed and `rows.length > 0`. | Must |
| REQ-6 | Ubiquitous | The system shall rewire `EvalGradePage` to the mock-02 layout: flat cluster rows in one bordered table, 3px rust left-rail for the selected cluster, keycap-tile label buttons, conic-gradient progress ring, persistent keyboard hint bar. | Existing keyboard shortcuts continue to work (1/2/3/space/arrows). The progress ring's `--pct` CSS var equals `labeled/total * 100`. | Must |
| REQ-7 | Ubiquitous | The system shall rewire `EvalManualFixturePage` to the mock-03 layout: action bar (Cancel + Build fixture) below the textarea + invalid-lines panel, pipeline explainer rail on the right. | Build button is disabled until ≥1 valid URL. Invalid lines panel only renders when there are invalid lines. | Must |
| REQ-8 | Event-driven | When `EvalManualFixturePage` successfully creates a fixture, the system shall navigate to `/admin/eval?fixtureId=<new-id>` (not `/admin/eval/grade/:id`). | The fixture is pre-selected in Mode A's Single-fixture picker (existing behavior from commit `d37ecb3`). | Must |
| REQ-9 | Ubiquitous | The system shall extend the API client `packages/web/src/api/eval.ts` with `listEvalRuns(params)` and `getEvalRun(id)` helpers matching the new backend contracts. | Both helpers go through `apiFetchAdmin`. Errors throw `EvalApiError` consistent with the existing helpers in that file. | Must |
| REQ-10 | Ubiquitous | The system shall route `/admin/eval/runs` in the React Router config and link to it from the `EvalIndexPage` header. | The "Past runs" link in the EvalIndexPage page header navigates there. The runs page has a "Back to eval" link returning to `/admin/eval`. | Must |
| REQ-11 | Ubiquitous | The system shall apply the mock theme tokens (rust `#8C3A1E` on primary CTA + status, Newsreader serif on H1, Geist Mono on data) within the existing Tailwind + shadcn setup. | No new theme system. Tokens applied via inline styles or Tailwind utility classes referencing the existing CSS vars. Admin stays on neutral background — no cream. | Must |
| REQ-12 | Ubiquitous | The system shall keep the sessionStorage hydration for in-flight Mode A runs (shipped in commit `d37ecb3`) working through the layout rewire. | The hydration `useEffect` in EvalIndexPage still fires on mount; rows from a prior run are restored. | Must |

## Edge cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|--------------|
| EDGE-1.1 | `GET /runs` returns 0 rows | Empty state from mock 05-C renders, with CTAs to "Run your first eval" and "+ New fixture". | REQ-1 |
| EDGE-1.2 | `GET /runs` returns 5xx | Inline error block in the runs page body with the server message. Retry button rerefetches. | REQ-1 |
| EDGE-2.1 | Search query is < 2 chars | Debounce; do not refetch until ≥2 chars or input cleared. | REQ-2 |
| EDGE-3.1 | The two selected runs have identical prompt hashes | Diff view shows "No changes — both runs used the same prompt" and the user can still see the score deltas. | REQ-3 |
| EDGE-3.2 | One of the two parallel `/runs/:id` calls fails | Show partial result + an error banner; don't blow up the diff view. | REQ-3 |
| EDGE-4.1 | `RunDetailDrawer` opens for a `running` run with no breakdowns yet | Right pane shows "Run still in progress…" placeholders. Left pane still shows the snapshot. | REQ-4 |
| EDGE-4.2 | `RunDetailDrawer` opens for a `failed` run | The error_message is shown prominently above the right pane; breakdowns may be partial or absent. | REQ-4 |
| EDGE-7.1 | Textarea is blank on `EvalManualFixturePage` | Build button disabled; no panels render. | REQ-7 |
| EDGE-8.1 | The new fixture id contains characters that need URL encoding | `encodeURIComponent(fixtureId)` in the navigate call. | REQ-8 |
| EDGE-12.1 | sessionStorage record is for the old aggregate-row shape (pre-Stage-C) | Version-gated; old records are discarded on mount per existing behavior. | REQ-12 |

## Out of scope

- **Mode B redesign.** The Mode B tab keeps its current panel; only the Mode A side of the eval index page is restyled per mock 01. The tab toggle still works.
- **`SourcingReportPanel` stacked-bar redesign as a separate component refactor.** The new stacked-bar layout from mock 01 is implemented inline in EvalIndexPage; the existing `SourcingReportPanel.tsx` component is replaced in place.
- **Mobile reflow at <768px.** Mocks have light notes on this; we'll implement straightforward stacking but not exhaustive mobile QA in this PR.
- **Dark mode.**
- **Server-side prompt diff endpoint.** REQ-11 in the backend SPEC explicitly forbade this; client-side diff stays.
- **Drag-to-resize panels.** All split layouts are fixed-ratio.

## Verification matrix

| ID | Unit | Integration | E2E | Manual | Notes |
|----|------|-------------|-----|--------|-------|
| REQ-1 | Yes | No | No | Yes | EvalRunsPage renders mocked list; pagination buttons present. |
| REQ-2 | Yes | No | No | Yes | URL params update on filter change; refetch called with new params. |
| REQ-3 | Yes | No | No | Yes | Compare button disabled at <2 selected; armed at 2; click triggers two API calls + diff render. |
| REQ-4 | Yes | No | No | Yes | Drawer opens on row click; renders snapshot + breakdowns; closes on Esc. |
| REQ-5 | Yes | No | No | Yes | Layout snapshot test; testids for editor + right rail + aggregate hero. |
| REQ-6 | Yes | No | No | Yes | Existing grading-page tests stay green; selected-row visual state uses left-rail (`data-selected="true"`). |
| REQ-7 | Yes | No | No | Yes | Existing manual-fixture tests stay green plus assertion that the action bar is below the textarea in the DOM. |
| REQ-8 | Yes | No | No | Yes | Existing test from commit `d37ecb3` already covers `/admin/eval?fixtureId=<id>` — update if the manual page test still expects `/grade/:id`. |
| REQ-9 | Yes | No | No | No | API client unit tests for `listEvalRuns` and `getEvalRun`. |
| REQ-10 | Yes | No | No | Yes | Route registration test + link presence test on EvalIndexPage. |
| REQ-11 | No | No | No | Yes | Visual review — no automated theme test. |
| REQ-12 | Yes | No | No | No | Existing sessionStorage tests in EvalIndexPage.test.tsx must still pass. |
| EDGE-1.1 | Yes | No | No | No | Empty-list state test. |
| EDGE-3.1 | Yes | No | No | No | Two identical hashes → "no changes" message. |
| EDGE-4.1 | Yes | No | No | No | Drawer for a `running` run shows placeholders. |
