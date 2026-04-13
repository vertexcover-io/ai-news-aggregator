# SPEC: Persistent Run Archives

**Source:** docs/plans/2026-04-13-persistent-date-archives-design.md
**Generated:** 2026-04-13

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Ubiquitous | The `run_archives` table shall exist in the Drizzle schema with columns: `id` (uuid PK), `rankedItems` (jsonb), `topN` (integer), `profileName` (text, nullable), `completedAt` (timestamp), `createdAt` (timestamp with default) | Table exists in schema, migration generates without errors, columns match specified types | Must |
| REQ-002 | Event-driven | When a run completes successfully (status transitions to `completed`), the pipeline shall insert the run's `rankedItems`, `topN`, `profileName`, and `completedAt` into the `run_archives` table | After a completed run, querying `run_archives` by `runId` returns the correct `rankedItems` array, `topN` value, `profileName`, and `completedAt` timestamp | Must |
| REQ-003 | Event-driven | When `GET /api/runs/:runId` finds no data in Redis, the API shall query `run_archives` by `id` | API returns a 200 response with archive data when Redis key has expired but `run_archives` row exists | Must |
| REQ-004 | Event-driven | When `GET /api/runs/:runId` retrieves data from `run_archives`, the API shall reconstruct a `RunState` with `status: "completed"` and pass `rankedItems` through `hydrateRankedItems` | The response body matches the `RunState` shape with fully hydrated `RankedItem[]` including recap content from `raw_items.metadata.recap` | Must |
| REQ-005 | Ubiquitous | The `GET /api/runs/:runId` endpoint shall try Redis first, then fall back to PostgreSQL | When Redis contains the run, the response is served from Redis without querying `run_archives`. When Redis is empty, the response is served from `run_archives` | Must |
| REQ-006 | Ubiquitous | The frontend `/archive/:runId` route shall work without any changes | No modifications to `ArchivePage.tsx`, `ArchiveStoryCard.tsx`, `useRunState` hook, or `App.tsx` routing | Must |
| REQ-007 | Event-driven | When the same `runId` is re-processed, the pipeline shall upsert into `run_archives` (update existing row) rather than fail with a duplicate key error | Re-processing a run updates the `rankedItems`, `completedAt`, and other fields in the existing row | Should |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | PostgreSQL write fails after run completes | Archive remains accessible via Redis for its TTL (3600s). Error is logged with `runId` and structured context. Archive becomes inaccessible after Redis expires. | REQ-002 |
| EDGE-002 | `GET /api/runs/:runId` with a `runId` that exists in neither Redis nor `run_archives` | API returns 404 (or null/not-found response consistent with current behavior) | REQ-003, REQ-005 |
| EDGE-003 | `raw_items` rows referenced by an archived ranking have been deleted or modified since archival | `hydrateRankedItems` filters out items it cannot find. Archive renders with fewer items than originally ranked. No error thrown. | REQ-004 |
| EDGE-004 | `GET /api/runs/:runId` for an in-progress run (exists in Redis with status `running`) | API returns the Redis data as-is (existing behavior unchanged). `run_archives` is never queried. | REQ-005 |
| EDGE-005 | `run_archives` row has `rankedItems` as an empty array | API returns a valid `RunState` with `rankedItems: []`. Frontend renders the archive page with no story cards. | REQ-004 |

## Verification Matrix

| REQ/EDGE ID | Unit Test | Integration Test | Manual Test | Notes |
|-------------|-----------|-----------------|-------------|-------|
| REQ-001 | Yes | No | No | Verify schema definition compiles and migration generates |
| REQ-002 | Yes | No | No | Test archive repository insert function with mock DB |
| REQ-003 | Yes | No | No | Test API fallback logic: Redis miss triggers PG query |
| REQ-004 | Yes | No | No | Test reconstructed RunState shape matches expected contract |
| REQ-005 | Yes | No | No | Test Redis-first, PG-fallback ordering |
| REQ-006 | No | No | Yes | Verify no frontend files are modified |
| REQ-007 | Yes | No | No | Test upsert behavior with duplicate runId |
| EDGE-001 | Yes | No | No | Test that PG write failure is logged, does not crash worker |
| EDGE-002 | Yes | No | No | Test 404/null response when runId not found anywhere |
| EDGE-003 | Yes | No | No | Test hydrateRankedItems with missing raw_items rows |
| EDGE-004 | Yes | No | No | Test that in-progress run from Redis skips PG lookup |
| EDGE-005 | Yes | No | No | Test empty rankedItems array produces valid RunState |

## Out of Scope

- Archive index/browsing page (`/archive` listing all available archives)
- Date-based routing (`/archive/dd-mm-yyyy`) — rejected due to multiple runs per day
- Retention policy or automatic cleanup of old `run_archives` rows
- Data migration of previously completed runs from Redis to PostgreSQL
- Modifications to the frontend archive page, story cards, or routing
- Changes to the Redis TTL or run state management for active runs
