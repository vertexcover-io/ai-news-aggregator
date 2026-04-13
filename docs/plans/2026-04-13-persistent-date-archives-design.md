# Persistent Run Archives — Design Document

**Date:** 2026-04-13
**Status:** Draft

## Problem Statement

Run state (including the ranked items list that powers the archive page) is stored exclusively in Redis with a 1-hour TTL (`RUN_STATE_TTL_SECONDS = 3600`). Once Redis expires the key, `/archive/:runId` returns null and the archive link is permanently broken. Users who share or revisit archive links after an hour see an empty "Run not found" state.

## Context

- The actual item content (title, URL, engagement, recap data) is already persisted in PostgreSQL's `raw_items` table
- Only the **ranking result** — the ordered list of `RankedItemRef[]` (item IDs, scores, rationales, recap summaries) — lives exclusively in Redis
- The `hydrateRankedItems` function already knows how to join `RankedItemRef[]` with `raw_items` rows to produce full `RankedItem[]` for rendering
- Multiple runs can happen per day, so date-based routing (`/archive/dd-mm-yyyy`) is not viable
- The existing `/archive/:runId` route and `runId` (UUID) based addressing is the right model — it just needs a persistent backing store

## Requirements

### Functional

- **REQ-01:** Completed run archives persist indefinitely in PostgreSQL
- **REQ-02:** `GET /api/runs/:runId` returns archive data even after Redis TTL expires
- **REQ-03:** Active/in-progress runs continue to be served from Redis (no behavior change for live polling)
- **REQ-04:** Frontend `/archive/:runId` route works unchanged — no URL scheme change needed
- **REQ-05:** Archive data includes everything needed to render the archive page: ranked items with scores, rationales, and recap content

### Non-Functional

- **NFR-01:** Redis remains the primary store for active runs (low latency for polling)
- **NFR-02:** PostgreSQL is the fallback for expired runs (read path: Redis → PG)
- **NFR-03:** No data migration needed — only future completed runs are archived

### Edge Cases

- **EDGE-01:** Run completes but PG write fails — archive page works while Redis is live, then breaks. Mitigation: retry PG write, log error.
- **EDGE-02:** Run is re-processed (same runId) — upsert semantics on `run_archives` table prevents duplicates.
- **EDGE-03:** `raw_items` rows referenced by archived ranking are deleted/modified — archive renders with whatever current `raw_items` data exists (acceptable: items are append-only in practice).

## Chosen Approach

### New `run_archives` Table

Add a `runArchives` table to the Drizzle schema in `@newsletter/shared`:

| Column | Type | Description |
|--------|------|-------------|
| `id` | `uuid` | Primary key, equals the `runId` |
| `rankedItems` | `jsonb` | The `RankedItemRef[]` array as-is from the ranking result |
| `topN` | `integer` | Number of items requested |
| `profileName` | `text` (nullable) | Profile used for ranking |
| `completedAt` | `timestamp` | When the run completed |
| `createdAt` | `timestamp` | Row insertion time |

### Write Path (Pipeline)

In `run-process.ts`, after the ranking stage writes `rankedItems` to Redis and the run status becomes `completed`, also write to `run_archives` via a new repository function. This happens in the same worker, after the existing Redis write — a single additional DB insert.

### Read Path (API)

Modify `GET /api/runs/:runId` in the API:

1. Try Redis first (existing behavior) — serves active and recently-completed runs
2. On Redis miss, query `run_archives` by `id = runId`
3. If found, reconstruct a minimal `RunState` with `status: "completed"` and the stored `rankedItems`
4. Pass through existing `hydrateRankedItems` to join with `raw_items` data
5. Return the hydrated response — frontend sees no difference

### Frontend

**No changes.** The `/archive/:runId` route, `useRunState` hook, and `ArchivePage` component all work as-is. They receive the same `RunState` shape whether it came from Redis or PG.

## Approaches Considered

### A: Persist rankedItems to PostgreSQL (Chosen)

- Minimal change — one new table, one write, one fallback read
- Frontend unchanged
- Clean separation: Redis for ephemeral run state, PG for permanent archives
- Leverages existing `hydrateRankedItems` hydration logic

### B: Date-based routing (`/archive/dd-mm-yyyy`)

- Rejected: multiple runs per day makes date-based addressing ambiguous
- Would require new routing, new UI for disambiguation, new API endpoints
- Doesn't solve the persistence problem (still need PG storage somewhere)

### C: Increase Redis TTL significantly

- Rejected: Redis is not a durable store, data loss on restart/eviction
- Memory cost grows linearly with retention period
- Doesn't provide true persistence

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| PG write fails silently | Archive breaks after Redis expires | Log error, consider retry. Archive works for 1 hour regardless. |
| Schema migration on production | Brief downtime risk | Additive migration (new table), no existing table changes |
| `run_archives` table grows unbounded | Disk usage over time | Out of scope for now; future: add retention policy or soft delete |

## Open Questions

None — scope is intentionally narrow. Future work (archive index page, retention policy, archive browsing) deferred.

## Assumptions

- `runId` (UUID) is unique and stable — safe to use as PK for archives
- `raw_items` data is effectively append-only — archived rankings will always find their referenced items
- The existing `hydrateRankedItems` function handles missing items gracefully (filters them out)
