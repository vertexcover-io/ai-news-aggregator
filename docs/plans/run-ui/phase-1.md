# Phase 1: Shared types + collector sinceDays

> **Status:** pending
> **Traces to:** REQ-020, REQ-021, REQ-022, REQ-023

## Overview

Introduces all new shared types consumed by api, pipeline, and web. Adds `sinceDays?: number`
to both `HnCollectConfig` and `RedditCollectConfig` and applies the filter in each
collector. After this phase, the type layer for the whole feature is stable and
subsequent phases can import from `@newsletter/shared`.

## Implementation

**Files to create:**
- `packages/shared/src/types/run.ts` — new file

**Files to modify:**
- `packages/shared/src/types/index.ts` — re-export everything from `./run`
- `packages/pipeline/src/types.ts` — add `sinceDays?: number` to `HnCollectConfig` and `RedditCollectConfig`
- `packages/pipeline/src/collectors/hn.ts` — apply sinceDays filter after fetch, before upsert
- `packages/pipeline/src/collectors/reddit.ts` — apply sinceDays filter
- `packages/pipeline/tests/unit/collectors/hn.test.ts` — add sinceDays unit tests
- `packages/pipeline/tests/unit/collectors/reddit.test.ts` — add sinceDays unit tests

### `packages/shared/src/types/run.ts`

```typescript
export type SourceType = "hn" | "reddit" | "blog";

export type RunStatus = "running" | "completed" | "failed";
export type RunStage =
  | "queued"
  | "collecting"
  | "processing"
  | "ranking"
  | "completed"
  | "failed";

export type SourceStatus = "pending" | "running" | "completed" | "failed";

export interface SourceRunState {
  status: SourceStatus;
  itemsFetched: number;
  errors: string[];
}

export interface RankedItem {
  id: number;                // raw_items.id
  rawItemId: number;         // alias retained for hydration consumers
  title: string;
  url: string;
  sourceType: SourceType;
  author: string | null;
  publishedAt: string | null; // ISO
  engagement: { points: number; commentCount: number };
  score: number;
  rationale: string;
}

export interface RankedItemRef {
  rawItemId: number;
  score: number;
  rationale: string;
}

export interface RunState {
  id: string;
  status: RunStatus;
  stage: RunStage;
  topN: number;
  startedAt: string;   // ISO
  updatedAt: string;   // ISO
  completedAt: string | null;
  sources: {
    hn?: SourceRunState;
    reddit?: SourceRunState;
    blog?: SourceRunState;  // future web collector
  };
  rankedItems: RankedItemRef[] | null;
  warnings: string[];
  error: string | null;
}

/**
 * Payload submitted by the /run frontend. Collector-specific config types live
 * in @newsletter/pipeline and are re-declared here as structural types to avoid
 * a web→pipeline dependency.
 */
export interface RunSubmitHnConfig {
  keywords?: string[];
  pointsThreshold?: number;
  sinceDays: number;
}

export interface RunSubmitRedditConfig {
  subreddits: string[];
  sort?: "hot" | "new" | "top";
  limit?: number;
  sinceDays: number;
}

export interface RunSubmitPayload {
  topN: number;
  hn?: RunSubmitHnConfig;
  reddit?: RunSubmitRedditConfig;
  // web?: ... intentionally omitted — deferred from MVP.
}
```

### sinceDays filter

In each collector, after transformation to `RawItemInsert[]` but **before**
`repo.upsertItems(items)`:

```typescript
if (config.sinceDays !== undefined && config.sinceDays > 0) {
  const cutoff = Date.now() - config.sinceDays * 86_400_000;
  const before = items.length;
  items = items.filter(i => {
    if (!i.publishedAt) return true; // keep items with unknown date
    const t = new Date(i.publishedAt).getTime();
    return Number.isFinite(t) && t >= cutoff;
  });
  const dropped = before - items.length;
  if (dropped === 0 && before > 0) {
    logger.warn({ sinceDays: config.sinceDays, fetched: before }, "sinceDays filter dropped 0 items — feed may be truncated");
  }
}
```

Apply the identical pattern in both `hn.ts` and `reddit.ts`.

**Note on `RawItemInsert.publishedAt`:** the schema column is `timestamp`. In the
collector, items being passed into `upsertItems` hold Date objects (not strings) per
the existing pattern — inspect the current code and match. The filter uses
`new Date(...).getTime()` which works for both.

## What to test

Per `harness:testing` and `superpowers:test-driven-development`, write tests RED first.

1. **HN `sinceDays` unit test** (REQ-021):
   - Fixture: generate 10 mock items with `date_published` spanning 0–14 days ago.
   - Call `collectHn` with mocked fetch returning the fixture and `config.sinceDays = 7`.
   - Assert the mocked repo was called with exactly the items ≤ 7 days old.
2. **Reddit `sinceDays` unit test** (REQ-023):
   - Fixture: 10 mock posts with `created_utc` spanning 0–30 days.
   - Assert only items within 7 days are upserted.
3. **sinceDays filter dropping zero items emits a warning log** (EDGE-004):
   - Pass fixture where all items are within window; assert a `warn`-level log is
     emitted with `msg` containing `"sinceDays filter dropped 0 items"`.
4. **Existing tests must still pass.** No behavior change when `sinceDays` is undefined.

**Commit:** `feat(VER-run-ui): add shared run types and collector sinceDays filter`

## Done When

- [ ] `packages/shared/src/types/run.ts` exists and is exported via `index.ts`.
- [ ] `HnCollectConfig` and `RedditCollectConfig` have `sinceDays?: number`.
- [ ] Both collectors apply the filter and emit the "no-op filter" warning.
- [ ] New unit tests pass; existing tests unchanged.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test:unit` green from repo root.
