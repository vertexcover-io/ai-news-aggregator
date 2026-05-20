# Adversarial Findings — web-search-collector

Attempts to break the feature beyond the happy-path verification scenarios.

## Attempts

### A-1: 5000-char query injection
**Status:** PASS (defended at boundary)
**Evidence:** `PUT /api/settings` with `query: "A" * 5000` returned HTTP 400 with zod issue `Too big: expected string to have <=400 characters`. The query never reaches the Tavily SDK call. Drizzle parameterises the JSONB write, so even queries that pass the 400-char check are NOT interpolated into SQL.

### A-2: Override settings via runs/now body
**Status:** NOT_APPLICABLE
**Evidence:** Inspected `packages/api/src/routes/runs.ts` and `packages/pipeline/src/workers/run-process.ts`. `POST /api/runs/now` does not accept a `webSearch` body override — the worker reads `webSearchConfig` from `user_settings` for every job. The DB-first config resolution is consistent with the cross-cutting pattern (cf. credential resolver in CLAUDE.md) and means the only path to enable web-search is the Settings UI / PUT route, which is already validated.

### A-3: webSearchEnabled=true with empty queries
**Status:** PASS (defended at boundary)
**Evidence:** `PUT /api/settings` with `webSearchEnabled: true, webSearchConfig.queries: []` returned HTTP 400 with custom zod issue: `"webSearchConfig must include at least one query when enabled"`. REQ-006 zod rules combined with the cross-field `.superRefine` (verified empirically — error code `"custom"`, not `"too_small"`) enforce ≥1 query when enabled.

### A-4: Sparse topic / 0 results from provider
**Status:** PASS
**Evidence:** Code path inspection — `collectWebSearch` constructs `byUrl` map from `results`; an empty result array yields zero map entries. `unitResults` entry is still pushed with `itemsFetched: 0, status: "completed", errors: []`. `items.length === 0` short-circuits the upsertItems call (line 219 of `index.ts`: `if (items.length > 0) await deps.rawItemsRepo.upsertItems(items)`). No crash.

### A-5: Tavily 429 / rate-limit (code path inspection, not live trigger)
**Status:** PASS
**Evidence:** All provider errors flow through `Promise.allSettled` in `collectWebSearch` (line 144). The `rejected` branch at line 165 catches per-query errors and produces a `SourceUnitResult` with `status: "failed"` and the error message; other queries continue. A 429 from Tavily would surface as a thrown error from `client.search()` in `TavilyProvider.search`, which propagates to `Promise.allSettled`'s rejected branch — never escapes the collector. Verified by unit test `"per-query failure isolation"`.

### A-6: Bad numeric bounds (sinceDays=0, maxItems=999)
**Status:** PASS (defended at boundary)
**Evidence:** Same `PUT /api/settings` 400 response as A-1 included issues on `sinceDays` (`>=1`) and `maxItems` (`<=20`). Bounds match REQ-005 type definitions exactly.

## Summary

| Attack | Outcome |
|--------|---------|
| Oversize query | rejected at API boundary |
| runs/now override | not applicable — no such API surface |
| Empty queries when enabled | rejected at API boundary |
| Sparse topic / 0 results | handled gracefully, no crash |
| Provider 429 / errors | isolated per-query, run continues |
| Out-of-bound numeric inputs | rejected at API boundary |

6 attempts, 6 expected outcomes. No defects found.
