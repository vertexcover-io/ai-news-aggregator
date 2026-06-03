---
governs: packages/web/src/hooks/
last_verified_sha: 5a2ff20
key_files: [useReview.ts, usePool.ts, useReviewFilters.ts, useRunList.ts, useRunPolling.ts, useRunObservability.ts, useEvalRuns.ts, useGradingProgress.ts, useSettings.ts, useArchive.ts]
flow_fns: [useReview.ts::useReview, usePool.ts::usePool, useRunList.ts::useRunList, useEvalRuns.ts::useEvalRuns]
decisions: [D-009, D-010]
status: active
---

# hooks/ — React Query + local state management

## Purpose

Custom hooks that connect the typed API client to components via `@tanstack/react-query`. Hooks handle data fetching, polling, mutation invalidation, and local UI state (filter sets, accumulation, dirty tracking).

## Public surface

| Hook | Effect |
|---|---|
| `useAdminSession()` | `useQuery(["admin","me"], fetchMe)` — retries 0 on `UnauthenticatedError`, 1 on other errors |
| `useArchive(runId)` | `useQuery(["archive", runId], getArchive)` — public, no poll, no retry |
| `useReview(runId)` | Loads admin archive → render-time hydration of ranked items → exposes reorder/remove/add/field-edit + dirty state |
| `usePool({ runId, enabled })` | Paginated pool queries with client-side accumulation, sort/filter/search state, `loadMore` pagination |
| `useReviewFilters()` | Client-side `Set<string>` state for `shortlistedOnly` + `selectedSourceTypes` + `selectedSources` + `isFiltered` |
| `useRunList(limit?)` | Polls `GET /api/runs` every 2s while any run is active |
| `useRunPolling(runId)` | Polls `GET /api/runs/:runId` every 2s until terminal status |
| `useRunObservability(runId)` | Polls `GET /api/admin/runs/:runId/observability` every 2s until terminal; 404 → null |
| `useSettings()` | `useQuery(["settings"], getSettings)` — no poll, refetchOnWindowFocus: false |
| `useSourceFacets(runId)` | `useQuery(["source-facets", runId], getSourceFacets)` |
| `useRunSources({ runId, enabled })` | `useQuery(["run-sources", runId], getRunSources)` — stale for 30s |
| `useRunSourceItems(runId, sourceKey, expanded)` | Lazy query enabled only when `expanded=true` |
| `useDeleteArchive()` | Mutation that calls `deleteArchive` then invalidates `["runs"]` |
| `useTriggerSocialPost(runId)` | Mutation wrapping `triggerSocialPost`; invalidates `["runs"]` on success |
| `useEvalFixture(id)` | `useQuery(["eval","fixture", id], getEvalFixture)` |
| `useEvalFixtures()` | `useQuery(["eval","fixtures"], listEvalFixtures)` |
| `useEvalRuns()` | Paginated eval runs with URL-synced filters, client-side q search, 250ms debounce |
| `useGradingProgress(fixtureId, gradedBy)` | `localStorage`-backed per-fixture grading labels (`Record<rawItemId, Tier>`) with `isComplete` check |
| `useIsSubscribed()` | Reads `localStorage` subscription flag, listens to `storage` + `newsletter-subscription-change` events |

## Depends on / used by

- **Uses:** `api/` (typed client functions), `lib/` (subscriptionStorage for `useIsSubscribed`)
- **Used by:** `pages/`, `components/`

## Data flows

```
useReview(runId) → UseReviewResult:
  useQuery(["archive", runId], getAdminArchive) → RunStateResponse | null
    ├─ Render-time hydration: completedKey !== hydratedId
    │    → setInitial(items), setCurrent(items), setHydratedId(completedKey)          (D-004)
    ├─ reorder(fromIdx, toIdx): splice-based array swap → setCurrent
    ├─ remove(id): filter out of current + addedIds
    ├─ addPending({ tempId, url }): append to pending[]
    ├─ resolvePending(tempId, item): remove from pending, append item to current, mark addedIds
    ├─ updateItemField(id, field, value): map over current, patch recap.title/summary/bullets/bottomLine
    └─ isDirty: sameOrder(initial, current) || pending.length>0 || pendingPromotes.length>0 || itemFieldsChanged

usePool({ runId, enabled }) → UsePoolReturn:
  State: sort, source, sourceTypes, sources, shortlisted, q, offset, accumulated[]
    → useQuery(["pool", runId, ...filter state], getPool(runId, { sort, source, sourceTypes, sources, shortlisted, q, offset, limit: 20 }))
       ├─ filter key changes → reset accumulated, set offset=0
       ├─ loadMore → offset += 20, append new items to accumulated (dedup by id)
       └─ return { items: accumulated, total, hasMore, loadMore, setSort, setSource, ... }

useRunList(limit?) → UseQueryResult<RunSummary[]>:
  useQuery(["runs", { limit }], listRuns(limit))
    ├─ refetchInterval: if data.some(status===running || status===cancelling) → 2000ms
    └─ otherwise → false (no polling)

useEvalRuns() → UseEvalRunsResult:
  useSearchParams() → URL params → filter: { q, mode, status, fixtureId, page }
    ├─ 250ms debounce on q (minimum 2 chars to activate)
    ├─ useQuery(["eval-runs", { page, perPage, mode, status, fixtureId }], listEvalRuns)
    │    with placeholderData: keepPreviousData
    └─ Client-side filter: if effectiveQ → filter runs by id/include/fixtureId match → narrowed results
```

## Gotchas / landmines

- **`useReview` render-time hydration** (D-004): Hydration happens during render, not in useEffect. The `completedKey !== hydratedId` guard ensures re-hydration only when a new completed archive arrives. This pattern avoids React 19 Strict Mode double-render issues.
- **`usePool` accumulation dedup**: `loadMore` appends items that are NOT already in `accumulated` (checked by `id`). If a filter change resets offset but the same items come back, they populate from scratch correctly because `accumulated` was cleared.
- **`useRunPolling` treats null as not-found then stops**: After one poll that returns null (404), `dataUpdateCount > 0 && data === null` triggers and polling stops. This prevents infinite 404 polling for runs that don't exist.
- **`useEvalRuns` client-side search**: The backend list endpoint doesn't accept a `q` param — client-side filtering narrows the current page only. Acceptable for "find this prompt hash in my last few runs" use case; not suitable for large datasets.

## Decisions

### D-009: usePool client-side accumulation over server-side offset pagination

**Why:** Changing a filter (sort, source, shortlisted) resets offset to 0 and clears accumulated items. The pool endpoint returns fresh results, and `loadMore` appends. This keeps the filter-reset UX simple while supporting infinite scroll.

**Tradeoff:** Items can appear twice if a new item is added between page fetches (race condition). The dedup-by-id guard in the render-time sync mitigates this but doesn't eliminate the gap if an item moves from page 2 to page 1 between loads.

**Governs:** `hooks/usePool.ts`

### D-010: Poll stops on terminal status only, not on first null

**Why:** `useRunObservability` stops polling on terminal status (completed/failed/cancelled) OR on null after first fetch. Without the `dataUpdateCount > 0` guard, a 404 on first poll would stop immediately — but the initial load might be racing the archive create. The guard ensures we try at least once before treating null as terminal.

**Tradeoff:** A genuinely non-existent runId produces one 404 before stopping. Acceptable.

**Governs:** `hooks/useRunObservability.ts`
