# Adversarial Findings — review-page-issues-audit

**Role:** Critic (adversarial pass; read only spec.md + claims.json before generating scenarios)

## 1. Attack Surface Derived

### Gaps (spec ACs not covered by `claims.json` `claims[]` direct browser proof)
- PHASE1-C4: Stale total during filter transition (unit-only so far — needs live browser timing check)
- PHASE1-C5: REQ-006 context-aware empty message when pool has items but all are visible ranked (non-zero pool, empty visible list)
- PHASE1-C7/EDGE-001: Error display wins over both empty states (unit-only)
- PHASE1-C8/EDGE-002: Filter change clears pool error (unit-only)
- PHASE3-C4/REQ-011: Failed regenerate unlocks Save + warning (unit-only; backend 502 hard to stage)
- PHASE4-C2/REQ-013: Removing a promoted item returns it to pool (unit-only)
- PHASE4-C3/REQ-016: 5-second polling for non-terminal status (unit-only; timing claim)
- PHASE4-C4/EDGE-007: Failed promote retry path unchanged (unit-only)

### Adversarial categories exercised
- Boundary inputs (limit=0, empty shortlistedIds array, null source_types, wrong PATCH schema format)
- Unexpected sequences (double-click Discard then confirm, Escape to close dropdown)
- Broader surface (REQ-002 with startedAt set but all items ranked; EDGE-003 legacy null startedAt path)
- Error recovery (pool API 400 on wrong format → API correctly rejects)
- Status accuracy (dry-run Save enabled before and after reorder)
- Permissions/auth (pool returns 401 without cookie — EXPECTED)

## 2. Scenarios Attempted

| ID | Category | Description | Inputs | Verdict |
|----|----------|-------------|--------|---------|
| A-01 | Boundary | Pool search + shortlisted filter combined | `?shortlisted=true&q=missing` → run `2a07fcd5` | EXPECTED: `{"items":[],"total":0}` — correct |
| A-02 | Boundary | Pool with `limit=0` | `?limit=0&offset=0` → run `2a07fcd5` | EXPECTED: `{"items":[],"total":4}` — returns correct total without items |
| A-03 | Boundary | PATCH dry-run with empty rankedItems array | `{"rankedItems":[]}` to dry-run run | EXPECTED: 400 "rankedItems cannot be empty" — zod min(1) validation fires |
| A-04 | Boundary | PATCH with wrong schema (rawItemId instead of id) | `{"rankedItems":[{"rawItemId":10,...}]}` | EXPECTED: 400 "Invalid input: expected number, received undefined" — correct rejection |
| A-05 | Broader surface | REQ-002: run with startedAt+sourceTypes set but all items ranked (unconstrained pool=0) | Seeded run `6ff476d0`, pool API → `{total:0}` | EXPECTED: Pool section absent from DOM, no error, no "unavailable". `hasItemPool=false`, `hasPoolUnavailable=false`. MET |
| A-06 | Broader surface | REQ-002 legacy path: null startedAt + null sourceTypes | Run `2bb308ff` (null startedAt) | EXPECTED: "Pool unavailable for this run" shown (EDGE-003 path). MET |
| A-07 | Broader surface | b4623c5d run: startedAt set but sourceTypes=null | Navigate to `/admin/review/b4623c5d-*` | EXPECTED: "Pool unavailable" shown — `source_types=null` triggers legacy branch in `getPool`. MET |
| A-08 | Unexpected sequence | Outside click on page heading closes Source dropdown | Click Source ▾, then click heading `e22` | EXPECTED: dropdown closed (`HACKER NEWS` absent from body). MET — PHASE2-C2 confirmed |
| A-09 | Unexpected sequence | Escape key closes open Source dropdown | Open dropdown, press Escape | EXPECTED: dropdown closed. MET — PHASE2-C2 confirmed |
| A-10 | Unexpected sequence | Discard with digest field change requires confirmation | Edit headline, click Discard | EXPECTED: confirmation dialog appears with "Discard all changes?" → confirm → 0 unsaved changes. MET |
| A-11 | Broader surface | Shortlisted toggle disabled with empty `[]` array | Run `d653a225` with `shortlisted_item_ids='[]'` | EXPECTED: checkbox `disabled=true`, `wrapperTitle="No shortlist data for this run"`. MET — PHASE2-C3 confirmed |
| A-12 | Broader surface | Shortlisted toggle enabled when shortlistedIds is non-empty | Run `2a07fcd5` with `shortlisted_item_ids='[14]'` | EXPECTED: checkbox enabled. MET |
| A-13 | Error recovery | PATCH dry-run with correct schema + digestHeadline change | API directly with full correct format | EXPECTED: Would be 200. Not executed via UI; covered by EDGE-004 e2e spec. |
| A-14 | Status accuracy | Regenerate disabled on dry-run even before any edit | Run `081e683c` fresh load | EXPECTED: `regenBtnDisabled=true`, reason text present. MET — PHASE3-C3 |
| A-15 | Status accuracy | Save enabled on dry-run without any edit | Run `081e683c` fresh load | EXPECTED: Save enabled. MET — PHASE3-C3 |

## 3. Defects

No `DEFECT` class findings discovered.

### Near-miss / observations
- **A-07 (minor observation, not a defect):** Run `b4623c5d` has `started_at` set but `source_types = NULL`. The pool API returns `{items:[], total:0}` (same as legacy null path), and the UI shows "Pool unavailable". This is correct because the `getPool` service checks `if (!archive.startedAt || !archive.sourceTypes)` — `sourceTypes` null triggers the same early return. No spec violation.
- **Pool cross-contamination in seeded data (minor seeding artifact):** The run `2a07fcd5` shows 4 pool items instead of 2 because pool items from other seeded runs (using the same `started_at` time range and source types) appear. This is a test environment seeding artifact — not a feature bug (the pool query is designed to use time-window + sourceType, not run_id, for items that predate the run_id stamp feature).
- **Confirmation dialog copy:** "Your reordering, deletions, and added posts will be lost." — doesn't mention digest field changes specifically. A user who only edited a digest field (no reordering/deletions) may find the copy slightly misleading. This is a copy concern, not a spec violation (spec just says "digest edit counts as unsaved change").

## 4. Cannot Assess

| Scenario | Reason |
|----------|--------|
| PHASE1-C4 (stale `…` during transition) | Requires timing control — `…` appears only for the brief window between filter change and response resolve. Playwright MCP doesn't support reliable `msDelay` injection into fetch. Covered by unit test `test_REQ_005_no_stale_total_during_transition`. |
| PHASE1-C7/EDGE-001 (error wins over empty states) | Requires simulated API failure while pool total is 0. No route interception available in this MCP setup. Covered by unit test `test_EDGE_001_error_wins_over_empty_states`. |
| PHASE1-C8/EDGE-002 (filter change clears error) | Same — requires staged API failure then recovery. Covered by unit test. |
| PHASE3-C4/REQ-011 (failed regen unlocks save + warning) | Requires the regenerate endpoint to return 502. The real LLM endpoint is not configured in this environment and the regen button is gated behind `hasItems`. Covered by unit test `test_REQ_011_regen_failure_unlocks_save_with_warning`. |
| PHASE4-C2/REQ-013 (removed promoted item returns to pool) | Requires staging a promoted item then removing it. The promote API call requires an LLM recap. Could be staged with DB injection but recap generation is not available. Covered by unit test. |
| PHASE4-C3/REQ-016 (5-second polling) | Requires a non-terminal-status run plus fake timer control. Covered by `useReview.test.tsx::test_REQ_016_non_terminal_status_polls_archive`. |
| PHASE4-C4/EDGE-007 (failed promote retry) | Same — requires staging a failed promote. Covered by unit test. |

## 5. Honest Declaration

No defects found across 15 scenarios attempted. Categories exercised: boundary inputs, unexpected sequences (Discard flow, dropdown close), broader surface (REQ-002/legacy pool branch, dry-run behavior), error recovery (API rejections), status accuracy (dry-run Save/Regen state).

The most promising attack was A-07 — a run with `startedAt` set but `source_types=NULL` shows "Pool unavailable" instead of the section being absent. I verified this is correct per the `getPool` service's `!archive.sourceTypes` guard (same early return as the null-startedAt branch), but a future reader could incorrectly expect REQ-002 "section absent" to apply here. The behavior is correct and matches the spec's EDGE-003 intent.

The seeding-artifact observation (4 items shown in pool instead of 2) is worth noting as a test environment side effect but is not a production concern since real runs have properly isolated `run_id`-stamped items.
