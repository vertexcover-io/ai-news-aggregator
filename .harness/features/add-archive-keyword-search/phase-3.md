# Phase 3: Write-path wiring

> **Status:** pending

## Overview

Make every code path that mutates an archive's reviewed/rankedItems also write `search_text` using the Phase 1 serializer. Two callsites:

1. **API review-save**: `RunArchivesRepo.updateRankedItems(id, items)` (called by `PATCH /api/admin/archives/:runId`).
2. **Pipeline AUTO_REVIEW**: `archiveRepo.upsert(...)` in `packages/pipeline/src/workers/run-process.ts` lines 500–541.

Both paths must call `serializeArchiveSearchText` with the **effective** rankedItems (post-curation) and the corresponding `raw_items` rows, then include `search_text` in the same UPDATE/UPSERT statement.

## Implementation

**Files:**
- Modify: `packages/api/src/repositories/run-archives.ts` — `updateRankedItems` signature accepts `rawItemsById` (or fetches it inside) and writes `search_text` in the same UPDATE.
- Modify: `packages/api/src/routes/archives.ts` (admin PATCH handler) — fetch raw items by id, pass to repo.
- Modify: `packages/pipeline/src/workers/run-process.ts` — when calling `archiveRepo.upsert`, also compute `search_text` and pass it.
- Modify: pipeline's `archiveRepo` interface (wherever it lives — likely also in `packages/api/src/repositories/run-archives.ts` or a parallel pipeline repo; the explorer found `archiveRepo.upsert` in pipeline so verify path during TDD).
- Test: `packages/api/tests/unit/run-archives-repo.test.ts` — assert `search_text` is included in UPDATE; OR an e2e test against real DB.
- Test: `packages/pipeline/tests/unit/run-process.test.ts` — assert `search_text` passed to `archiveRepo.upsert`.

**Pattern to follow:** existing repo write methods. The `updateRankedItems` change is additive — same transaction, one extra column.

**What to test:**
- After review-save with overrides, `run_archives.search_text` contains override values, not original recap values (re-tests REQ-008/EDGE-004 end-to-end at the integration boundary).
- Pipeline AUTO_REVIEW path produces same `search_text` as API path for identical inputs (REQ-011).
- Reviewer removed an item: removed item's content no longer in `search_text`.
- Reviewer added a post (POST `/api/admin/archives/:runId/add-post`): added post's content present in `search_text` after the next save.

**Traces to:** REQ-008, REQ-011.

**Algorithm note (signature change):**

The repo currently signature is `updateRankedItems(id, items)`. To write `search_text`, the repo needs the raw items. Two options:

- (a) Caller passes `rawItemsById` along with `items`. The route handler already has access via the existing flow that hydrates the response.
- (b) Repo fetches raw items itself via a `rawItemsRepo` it knows about (DI).

Pick (a): minimal change, repo stays narrow, callers (route handler + pipeline) already query raw_items for hydration. The function becomes:

```ts
async updateRankedItems(
  id: string,
  items: RankedItemRef[],
  rawItemsById: Map<number, RawItemRow>,
  digest: { headline: string | null; summary: string | null },
): Promise<RunArchiveRow>
```

Inside it computes `search_text` via the shared serializer and includes it in the SET clause.

**Done when:**
- [ ] Both write paths set `search_text` identical to what the serializer produces
- [ ] Unit/integration tests cover the override-precedence parity between paths
- [ ] No regressions in existing review-save tests
- [ ] `pnpm typecheck && pnpm test:unit` clean

**Commit:** `feat(VER-XX): write search_text on archive review-save and AUTO_REVIEW`
