# Learnings — eval-ranker-shortlist-fix

## The reported symptom was not the literal bug — the root smell was the time-window pool approximation

### Problem

The bug report described the calendar eval as "only ranking the items that were already
ranked" and showing an `itemCount` that didn't match what the user expected. Read literally,
that sounds like the eval was feeding `run_archives.rankedItems` back into the ranker. It was
not — the code loaded a pool from `raw_items` by a `collectedAt BETWEEN [startedAt, completedAt]`
time window. The *observable* symptom (small pool, looks like only ranked items, list/detail
counts disagree) was a downstream consequence of a deeper design smell.

### Insight

**When a feature attributes records to a parent by a time window instead of a foreign key, the
bug surfaces as a confusing data-shape symptom, not as the obvious "wrong query."** Three
distinct defects all rolled out of the single time-window approximation:

1. **Wrong pool membership.** Two runs on the same calendar day shared one `collectedAt`
   window, so each run's eval pool was polluted with the other run's items — or, if windows were
   tight, a run's own items fell outside its `[startedAt, completedAt]` bracket and the pool
   collapsed toward only the items that happened to be referenced by `rankedItems`. That is why
   it *looked* like "only ranks the already-ranked items."
2. **No dedup at eval time.** The live pipeline dedups before ranking, but the eval pool was the
   raw windowed set, so URL-duplicates inflated and distorted it.
3. **Inconsistent `itemCount`.** The list endpoint cheaply returned `rankedItems.length` while
   the detail endpoint returned the windowed pool size — two different meanings for the same
   field.

The fix was not "tweak the window" — it was to replace approximation with exact attribution: add
`raw_items.run_id`, stamp it during collection (pointer to the most-recent run that collected the
item, updated on upsert conflict), load the pool by `WHERE run_id = $runId`, dedup the result with
the same `dedupCandidates` processor the live pipeline uses, and make *both* list and detail
report `sourcePool.length`. The time window survives only as a fallback for pre-migration
archives that have no `run_id`.

### Solution

`packages/pipeline/src/repositories/eval-exports.ts` — `loadDedupedPool` is the new single source
of truth for a run's eval pool, used by both `getCompletedRunDetail` and `listCompletedRunsByDate`:

```ts
// load by run_id first; fall back to the collectedAt window only for legacy archives
const byRunId = await db.select(RAW_ITEMS_SELECT).from(rawItems)
  .where(eq(rawItems.runId, archive.id));
const rows = byRunId.length > 0 ? byRunId
  : await db.select(RAW_ITEMS_SELECT).from(rawItems)
      .where(between(rawItems.collectedAt, archive.startedAt ?? archive.createdAt, archive.completedAt));
const fixtureItems = rows.map(buildFixtureItem);
const survivors = dedupCandidates(fixtureItems.map(f => ({ id: f.rawItemId, url: f.url, engagement: f.engagement ?? { points: 0, commentCount: 0 } })));
const survivingIds = new Set(survivors.map(s => s.id));
return fixtureItems.filter(f => survivingIds.has(f.rawItemId));   // itemCount = this.length on BOTH paths
```

Stamping happens in `workers/run-process.ts` by wrapping the repo so collectors can't forget:
`deps.rawItemsRepo.upsertItems(items.map((i) => ({ ...i, runId })))`, with `upsertItems` also
updating `run_id` in its `onConflictDoUpdate` set clause.

### Prevention / Reuse

- When a bug report's symptom is about *data shape* (counts, membership, "only shows X"), trace
  upstream to *how the set is constructed* before trusting the literal wording. The literal
  wording described an effect; the cause was attribution-by-window.
- If a feature attributes child rows to a parent by a time range, treat that as a design smell
  to flag, not a detail to preserve. Same-parent-same-window collisions and boundary exclusions
  are inherent. Prefer an explicit FK (`run_id`) stamped at write time.
- A field reported by two endpoints (list + detail) must have one definition. Compute it from
  one shared function (`loadDedupedPool().length`) — do not let one path shortcut to a cheaper
  proxy (`rankedItems.length`).

### Related

- `docs/solutions/gotchas/non-optional-jsonb-field-seed-shape-mismatch-20260523.md` — a verification
  gotcha discovered while proving this feature (seed `metadata` must match the collector-written shape).
- `docs/spec/eval-ranker-shortlist-fix/spec.md`, `.../verification/proof-report.md`
