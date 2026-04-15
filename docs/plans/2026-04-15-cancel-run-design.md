# VER-73 — Cancel Run Button (Design)

**Linear:** https://linear.app/vertexcover/issue/VER-73/add-cancel-run-button
**Date:** 2026-04-15
**Author:** Aman

## Problem

Users have no way to stop a newsletter run once it's in progress. A misconfigured "Run Now" click today forces the user to wait through collection → embedding → Claude ranking (can take 2–5 minutes and burns Anthropic/Voyage credits) before they can try again.

## Goal

Let the user press a Cancel button next to a running run on the dashboard. The run stops as quickly as possible (mid-stage), lands in a distinct terminal `cancelled` status, and is archived so it appears in run history with a clear "Cancelled" badge.

## Non-goals

- Resuming a cancelled run.
- Cancelling individual sources within a run.
- Cancelling scheduled future runs (that's what the scheduling settings already cover).

## Decisions (confirmed by user)

1. **Abort mechanism:** AbortController threaded through the worker. Signal propagates into collectors, HTTP fetches, Voyage embedding, and the AI SDK `generateObject` call so work stops mid-stage, not only at stage boundaries.
2. **Final status:** Add `cancelling` (transient) and `cancelled` (terminal) to `RunStatus`. Extend `run_archives.status` to accept `cancelled`.
3. **UX:** Cancel button on the dashboard `RunsTable` for rows where `status === "running"`. Clicking opens a confirm dialog. On confirm, `POST /api/runs/:runId/cancel` flips Redis status to `cancelling`; when the worker finishes aborting it writes the final `cancelled` row.

## Architecture

### Cross-process cancel signal

API and pipeline are two Node processes. AbortController lives in the worker process, so the API must signal across the boundary.

**Mechanism:** Redis pub/sub on channel `run:cancel:{runId}`.

- `POST /api/runs/:runId/cancel` → validates run is in a cancellable state (status ∈ `running`) → writes `status: "cancelling"` to Redis run-state → publishes empty message on `run:cancel:{runId}`.
- Worker, at the start of `handleRunProcessJob`, creates an `AbortController` and subscribes to `run:cancel:{runId}` via a dedicated Redis client. On message, calls `controller.abort(new CancelledError())`.

No polling. Propagation latency is ~Redis RTT (~ms).

### Worker changes

- `handleRunProcessJob` accepts an injected `cancelSubscriber` dep (factory: `(runId) => { subscribe(), close() }`) so tests can simulate cancel.
- The controller's `signal` is threaded through:
  - Every collector's `fetchFn` (already an injected dep that accepts `{ signal }` today).
  - The Voyage embed call in `rank-shortlist.ts`.
  - The AI SDK `generateObject` call in `rank-rerank.ts` (supports `abortSignal`).
- At every `await` boundary, `throwIfAborted(signal)` is called so we fail fast between micro-steps.
- Catch block distinguishes `CancelledError` from other failures: writes `status: "cancelled"` to Redis + archive, skips the normal `failed` path, and returns cleanly so BullMQ doesn't retry.

### Schema changes

- `packages/shared/src/types/run.ts`: `RunStatus` gains `"cancelling" | "cancelled"`.
- `packages/shared/src/db/schema.ts`: `run_archives.status` check constraint / enum extended to include `"cancelled"`. One Drizzle migration.

### API

- New route: `POST /api/runs/:runId/cancel` in `packages/api/src/routes/runs.ts`.
  - 200 on success with updated `RunState`.
  - 404 if run not found in Redis and not in DB archive.
  - 409 if run is already `completed` | `failed` | `cancelled`.
- Depends on a new service fn `cancelRun(runId, deps)` — validates state, sets `cancelling`, publishes cancel signal.

### UI

- `packages/web/src/components/dashboard/RunsTable.tsx`: for rows with `status === "running"`, render a Cancel button (destructive variant). For `cancelling`, show button disabled with "Cancelling…" label.
- Confirm dialog using the existing shadcn `AlertDialog` pattern (check if one is already used in the app; if not, fall back to `window.confirm` to keep scope tight).
- `cancelRun(runId)` in `packages/web/src/api/runs.ts` calling the new endpoint; invalidate the runs list + polling query on success.
- Status badge in `RunsTable` gets a `cancelled` variant (gray/neutral).

### Polling

`useRunPolling.ts` already stops at terminal statuses. Add `"cancelled"` to the terminal list; keep polling during `"cancelling"`.

## Test plan

- **Unit (pipeline):** cancel published mid-collection, mid-shortlist, mid-rank → worker aborts, writes `cancelled` to Redis and archive.
- **Unit (api):** cancel a running run → 200; cancel a completed run → 409; cancel an unknown run → 404.
- **Unit (web):** RunsTable shows Cancel button for `running`, disabled for `cancelling`, gone for `cancelled`. Confirm dialog gates the API call.
- **E2E (manual):** trigger a Run Now, click Cancel within 5s, confirm, verify dashboard reflects `cancelled` status and archive lists the run with a cancelled badge.

## Rollout

Single PR. Drizzle migration ships with the code. No feature flag — cancellation is strictly additive and safe to deploy directly.
