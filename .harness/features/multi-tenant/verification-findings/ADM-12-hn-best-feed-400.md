# Finding: HN `best` feed fails with Algolia 400 → fails the entire run

- **Feature:** ADM-12 (trigger pipeline run) / HN collector
- **Role:** Admin (`tenant_admin`)
- **Severity:** **Blocker** — the default HN config fails every run.
- **Suspected scope:** Pipeline collection (HN). Not tenant-isolation related. Affects all tenants equally.
- **Status:** ✅ **FIXED** (2026-06-17).

## Resolution (applied)
`packages/pipeline/src/collectors/hn.ts`:
1. `buildSearchUrl` no longer sends the `points` numericFilter to the `best` feed (the `/search` relevance index); it keeps `created_at_i` and omits `numericFilters` entirely when empty. `newest` (`/search_by_date`) still filters on `points`.
2. The `best` feed is post-filtered by `points > threshold` in code, preserving the documented points floor.
3. The feed loop now wraps each feed in try/catch: a single feed's failure is recorded as a `failed` `SourceUnitResult` and collection continues with the surviving feeds; the collector only throws when **every** feed fails (cancellation still propagates).

Run-level orchestration already degraded gracefully (`run-process.ts:626` fails the run only when `failureCount > 0 && successCount === 0`), so no change was needed there.

Tests (`packages/pipeline/tests/unit/collectors/hn.test.ts`): best-feed query omits points / keeps created_at_i; degrades to surviving feed; throws when all feeds fail; post-filters best below threshold. All green (1211 pipeline unit tests pass). Live: a default-config run (`newest`+`best`) now fetches both feeds (no 400) and proceeds past collection.

## Expected
Triggering a run with the default HN configuration (`POST /api/runs {topN, hn:{sinceDays}}`) collects HN stories and proceeds through shortlist → rank → recap → completed.

## Observed
Run fails almost immediately at the `collecting` stage:
```
GET /api/runs/<id> →
  status: "failed", stage: "failed",
  sources.hn: { status:"failed", itemsFetched:0, errors:["Non-retryable HTTP error: 400"] }
  error: "hn: Non-retryable HTTP error: 400"
```
Pipeline log: `source.failed: hn` → `run.failed: hn: Non-retryable HTTP error: 400`.

A control run with `hn.feeds:["newest"]` (excluding `best`) **completes successfully** (8 items fetched, 3 ranked, recap generated, archived). This isolates the fault to the `best` feed.

## Root cause (confirmed against the live HN Algolia API)
`packages/pipeline/src/collectors/hn.ts` `buildSearchUrl()` (≈ lines 212–235):

```ts
const numericFilters = [`points>${points}`];           // points defaults to 20
if (sinceDays) numericFilters.push(`created_at_i>${cutoff}`);
const params = new URLSearchParams({ query, tags:"story", optionalWords,
  numericFilters: numericFilters.join(","), hitsPerPage });
const endpoint = feed === "best" ? "search" : "search_by_date";   // ← the split
```

- `newest` → `/api/v1/search_by_date` — accepts `numericFilters=points>20` → **200**.
- `best`   → `/api/v1/search` (relevance index) — **rejects** `points` filtering:

```
$ curl '.../api/v1/search?...&numericFilters=points%3E20%2Ccreated_at_i%3E...'
400 {"code":400,"message":"invalid numeric attribute(points),
     attribute not specified in numericAttributesForFiltering setting"}
```

HN's Algolia **relevance** index (`search`) does not list `points` in `numericAttributesForFiltering`, so any `points>N` filter on the `best` feed is rejected with a non-retryable 400. The `search_by_date` index does allow it. This is an external-API behavior the code does not account for (the same `numericFilters` are applied to both endpoints).

**Amplifying issue (design):** `DEFAULT_FEEDS = ["newest","best"]`, and a single source's non-retryable error is treated as fatal for the whole run, so the broken `best` feed takes down an otherwise-healthy `newest` collection and the entire pipeline run. Even partial-feed success does not degrade gracefully.

## Reproduction
```bash
# Fails (default feeds include "best"):
curl -b admin.txt -X POST localhost:3001/api/runs -d '{"topN":3,"hn":{"sinceDays":2}}'
# → run status "failed", hn error "Non-retryable HTTP error: 400"

# Succeeds (newest only):
curl -b admin.txt -X POST localhost:3001/api/runs -d '{"topN":3,"hn":{"sinceDays":3,"feeds":["newest"]}}'
# → run status "completed"

# Direct API proof:
curl -s -o /dev/null -w '%{http_code}\n' 'https://hn.algolia.com/api/v1/search_by_date?tags=story&numericFilters=points%3E20'  # 200
curl -s              -w '\n'             'https://hn.algolia.com/api/v1/search?tags=story&numericFilters=points%3E20'           # 400 invalid numeric attribute(points)
```

## Notes for the (future) fix — NOT applied
Two independent angles, listed for the record only:
1. Don't apply `points` numericFilter on the `best`/`search` endpoint (or post-filter by points client-side for that feed).
2. Make per-feed / per-source collection failures non-fatal (degrade to the feeds/sources that succeeded) so one broken feed can't fail the whole run.
