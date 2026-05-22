# SPEC: Eval Fixture Flow Fixes

**Source:** Follow-up to ranking-eval-pipeline (PR #179)
**Generated:** 2026-05-22

Two scoped UX fixes on the just-shipped ranking-eval feature.

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-1 | Event-driven | When the user clicks "Save to repo (dev)" on `/admin/eval/grade/:fixtureId` and the request succeeds, the system shall navigate to `/admin/eval?fixtureId=<id>` and pre-select that fixture as the Single-fixture target in Mode A. | After a 2xx response from `POST /api/admin/eval/groundtruth/:id/save-to-repo`, `EvalGradePage` calls `navigate("/admin/eval?fixtureId=<id>")`. `EvalIndexPage` reads `fixtureId` from `useSearchParams` on mount; if present, it sets `mode="scored"`, `scoredScope="single"`, and `fixtureId=<id>`. | Must |
| REQ-2 | State-driven | While a Mode A scored run is in flight, the system shall persist the in-flight results to `sessionStorage` so that a full page refresh restores the per-fixture rows and aggregate total visible in `EvalResultsPanel`. | On every `progress`/`aggregate` SSE event during a Mode A run, the page writes `{ version: 1, mode: "scored", scoredScope, fixtureId, windowSize, rows, totalUsd, runError, persistedAt }` to `sessionStorage["eval-run-state"]`. On `EvalIndexPage` mount, if a record exists with `mode="scored"` and `persistedAt` within the last 1 hour, it hydrates `rows`/`totalUsd`/`runError` (with `running=false`). Starting a new run or clicking Reset clears the record. | Must |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|--------------|
| EDGE-1.1 | Save-to-repo request returns non-2xx | Stay on grade page, render existing error in `save-error`, do NOT navigate. | REQ-1 |
| EDGE-1.2 | URL has `fixtureId=<id>` but `useEvalFixtures` hasn't resolved yet | Still set the local `fixtureId` state from the URL; once fixtures load, the `<select>` value reconciles. The "Run" button stays disabled while fixtures load (existing behavior). | REQ-1 |
| EDGE-1.3 | URL has `fixtureId=<id>` AND `mode=ab` simultaneously | `mode=ab` wins for the tab; `fixtureId` is still seeded so switching back to Scored shows it selected. | REQ-1 |
| EDGE-2.1 | `sessionStorage.setItem` throws (quota / disabled / SSR) | Swallow the error; the run continues uninterrupted. No console error required. | REQ-2 |
| EDGE-2.2 | Persisted record older than 1 hour on mount | Discard (treat as absent) and clear the key. | REQ-2 |
| EDGE-2.3 | Persisted record exists but `mode !== "scored"` | Ignore; only Mode A is persisted (Mode B and sourcing report are out of scope). | REQ-2 |
| EDGE-2.4 | Persisted record version mismatch | Ignore and clear. | REQ-2 |
| EDGE-2.5 | User starts a NEW run while a persisted record exists | Clear the record at the start of `handleRun` before any new event lands; rebuild from new events. | REQ-2 |
| EDGE-2.6 | Page refreshed mid-run | After refresh, the SSE stream itself is NOT resumed (server-side limitation). `running=false`, but the last partial rows + totalUsd are visible. A new Run replaces them. | REQ-2 |

## Verification Matrix

| ID | Unit | Integration | E2E | Manual | Notes |
|----|------|-------------|-----|--------|-------|
| REQ-1 | Yes | No | No | Yes | EvalGradePage unit test mocks API + react-router `useNavigate`; EvalIndexPage unit test asserts URL param → fixture-select value. |
| REQ-2 | Yes | No | No | Yes | EvalIndexPage unit test drives SSE mock events, asserts `sessionStorage` writes, then re-mounts and asserts hydration. |
| EDGE-1.1 | Yes | No | No | No | API mock rejects → no navigate. |
| EDGE-1.2 | No  | No  | No | Yes | Manual check only; covered implicitly by REQ-1. |
| EDGE-2.1 | Yes | No | No | No | Stub `sessionStorage.setItem` to throw; run completes. |
| EDGE-2.2 | Yes | No | No | No | Seed stale persistedAt; assert hydration is skipped and key cleared. |
| EDGE-2.5 | Yes | No | No | No | Persist then start new run; old rows are gone. |

## Out of Scope

- Resuming the SSE connection itself across refresh (would require server-side run-state persistence — large scope).
- Persisting Mode B (calendar) results.
- Persisting the SourcingReport panel.
- Cross-tab synchronization (`storage` event listener).
- Persisting to localStorage / IndexedDB (sessionStorage is enough — refresh-safe but tab-scoped, which matches user mental model).
