# Design: Run as a single parallel job

**Date:** 2026-04-08
**Status:** Draft (pre-implementation)
**Scope:** `packages/api/src/services/runs.ts`, `packages/pipeline/src/workers/run-process.ts`, `packages/pipeline/src/workers/collection.ts` (deprecation)

**Files touched:** exactly two — `runs.ts` and `run-process.ts`. **Zero new files.**

## Problem Statement

Today, when a user submits a run from the web UI with multiple sources (HN + Reddit + Web), the collectors execute **sequentially**, not in parallel. Each collector is also its own BullMQ job, so the observable state is "three separate jobs trickling through one at a time" rather than "one run executing in parallel." The user wants the whole run to be treated as a single job and for its collectors to run concurrently — safely, and with minimal disruption to the current system.

## Context

### Current architecture

The run lifecycle today (see `packages/api/src/services/runs.ts:14-83`):

1. API receives `POST /api/runs` with an `HN + Reddit + Web` payload.
2. API writes an initial `RunState` to Redis at key `run:{runId}` as a JSON blob with a per-source `sources` map.
3. API uses BullMQ's `FlowProducer` to enqueue a tree:
   - **Parent** — `run-process` in the `processing` queue (dedups + ranks)
   - **Children** — one `*-collect` job per source in the `collection` queue
4. BullMQ's flow semantics block the parent until *all* children complete.
5. The `collection` worker (`packages/pipeline/src/workers/collection.ts:123`) drains children one at a time.
6. When all children are done, the parent `run-process` job runs dedup → rank → final state update.
7. Frontend polls `GET /api/runs/:runId` which reads the JSON blob from Redis.

### Why collectors run sequentially

The `collectionWorker` is constructed without a `concurrency` option:

```ts
// packages/pipeline/src/workers/collection.ts:123
export const collectionWorker = new Worker(
  "collection",
  handleCollectionJob,
  {
    connection: createRedisConnection(),
    stalledInterval: 30000,
    maxStalledCount: 2,
  },
);
```

BullMQ defaults `concurrency` to **1**. The FlowProducer is correctly fanning children out; they just land in a one-slot worker and get drained serially. The parallelism is present at the queue layer and absent at the consumer layer.

### Why the naive fix ("set concurrency: 3") is unsafe

`run-state.ts` uses non-atomic read-modify-write on a single Redis key and documents this explicitly (see `packages/pipeline/src/services/run-state.ts:1-10`):

> "Contention on the same key is limited to a collector child and the parent job running simultaneously, which doesn't happen in the fan-out/fan-in flow (parent starts only after children finish). Simple read-modify-write is sufficient."

Bumping concurrency violates that invariant. Two sibling collectors finishing near-simultaneously would both `GET` the same `RunState` blob, each mutate their own source slot, and race on `SET`. The second write silently clobbers the first. From the frontend, one source would appear stuck on `pending` forever even though its collector succeeded.

So the real problem isn't "how do we make collectors run in parallel" — BullMQ can do that trivially. The real problem is "how do we make the *state mutations* safe under parallel writers." That's the choice that shapes the design.

## Requirements

### Functional

- Submitting a run from the UI with N sources runs those N collectors concurrently within a single logical run.
- Per-source state (`status`, `itemsFetched`, `errors`) remains visible to the frontend as it progresses — not just at the end.
- Dedup and ranking run exactly once, after all collectors have terminated (successfully or with error).
- Partial success remains supported: if HN fails but Reddit + Web succeed, the run proceeds to dedup/rank with the items that were collected.
- The frontend poll contract (`GET /api/runs/:runId` → current `RunState` JSON shape) does not change.

### Non-functional

- **Safety under concurrency:** no lost state updates between sibling collectors.
- **Retry granularity per source:** transient errors in a single collector should retry that collector without restarting siblings.
- **Observability:** logs must still attribute progress to a specific source and run.
- **Small blast radius:** user directive is "whatever is safe and does not disrupt the current system." Touch as few files as possible and do not change the public API or Redis schema.
- **Idempotent:** the run job must remain safe to retry as a whole if BullMQ redelivers it (existing pipeline rule).

### Edge cases

- **One collector hangs indefinitely** — needs a per-collector timeout so `Promise.all` isn't blocked forever.
- **All collectors fail** — run should land in a meaningful failed/empty state, not a ranking call with zero candidates dressed up as success.
- **Collector partially succeeds (fetches then throws on upsert)** — idempotent upserts already cover this; second attempt is a no-op for the already-stored rows.
- **Worker crash mid-run** — BullMQ redelivers the single run job. Collectors re-run from scratch, but upserts are idempotent and ranking is deterministic over the collected rows.
- **Run with zero sources selected** — API-layer validation already rejects this; keep that contract.
- **Rate limits on external APIs** — HN, Reddit, and Web hit different hosts. Running all three concurrently does not share a rate budget. Safe.

## Key Insights

1. **The parallelism problem is actually a consumer-concurrency problem.** BullMQ is already fanning out correctly; the worker just has one slot.
2. **The safety problem is the one that matters.** Any approach that allows multiple writers to the `run:{runId}` JSON blob without atomicity is unsafe.
3. **Collapsing to a single-owner job makes the safety problem disappear.** If exactly one Node process ever holds the write lease for a given run, its `await`-based state updates are serialized by construction. No Redis-level atomicity, no Lua, no schema change.
4. **Per-source retry does not require BullMQ job retry.** An in-process retry helper around each collector call delivers the same user-visible semantics for short-lived runs.
5. **The collectors themselves are already pure functions.** `collectHn`, `collectReddit`, `collectWeb` all have the shape `(deps, config) => Promise<CollectorResult>`. Nothing needs to change about *them* — only about who calls them.

## Architectural Challenges

### Job boundary: what does "one job" mean here?

Option space for the BullMQ topology:

- **A. Flow + concurrency:** Keep the parent/child flow, bump `collection` worker concurrency to 3, fix run-state to be atomic.
- **B. Single job, inline collectors:** One BullMQ job per run. The job handler runs `Promise.all([collectors])` internally, then dedups and ranks in the same process. No FlowProducer.
- **C. Hybrid:** Keep the parent `run-process` job but inline the collector calls into it (no child jobs, but still the same queue).

The user picked **B (single job)**. That's the shape we design for.

### State mutation ownership

Once we're in a single-job shape, the run-process worker is the *sole* **process** writing to `run:{runId}` for the duration of the job. No other consumer writes to that key while this job is executing — the cross-process concurrent-writer race is eliminated.

**However**, progressive per-collector status updates (writing `sources.hn = completed` the instant HN finishes, rather than batching at the end) reintroduce an **intra-process** race:

1. HN's `.then` callback calls `updateSource('hn')` → `await redis.get(runId)` returns `S1` → yields.
2. Reddit's `.then` fires during that yield → also `await redis.get(runId)` returns `S1` (HN hasn't written yet).
3. HN resumes, writes `S1 + hn=completed = S2`.
4. Reddit resumes, writes `S1 + reddit=completed = S3` — based on stale `S1`, not `S2`. HN's update is silently clobbered.

Node is single-threaded but not single-coroutine; `await` yields between the `get` and the `set` inside `updateState`, so any two concurrently-executing `.then` callbacks can interleave. The old flow got away with this because `concurrency: 1` on the `collection` worker was an implicit serializer — only one child ever wrote at a time.

**Fix (tiny, local):** serialize state writes inside the collecting stage via a promise chain:

```ts
let writeChain: Promise<unknown> = Promise.resolve();
const writeSerial = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = writeChain.then(fn);
  writeChain = next.catch(() => {});
  return next;
};
```

Every `runState.updateSource` call from the collecting stage goes through `writeSerial`. Reads and writes become strictly ordered, replicating the old `concurrency: 1` invariant but inside one process. No changes to `run-state.ts` itself, no Redis schema change, no Lua, no lock library.

Progressive updates are still progressive — HN flips to `completed` as soon as its collector finishes, even if Reddit is still running. The serialization only ensures that two near-simultaneous writes to the blob can't clobber each other.

### Collector dispatch reuse

`dispatchCollector` currently lives in `collection.ts:43-68` and is tied to the BullMQ job envelope. The new run-process job needs to invoke the same collector functions but not through a job envelope.

**Choice:** inline the orchestration as a private function inside `run-process.ts`. It has exactly one caller (the run-process worker), which per `.claude/rules/code-quality.md` ("no premature abstractions — three similar lines of code is better than a premature abstraction") means it does not warrant its own file. The existing `collection.ts` file and its worker are left in place during migration and deleted in a follow-up PR.

Testability is preserved by injecting the collector functions through `RunProcessDeps` (a single `runCollectorsFn` seam, or a small `collectFns` record). No new file needed — just a new dep entry and a private helper function.

### Per-source retry

**No new retry helper is needed.** All three collectors already implement exponential-backoff retry internally:

- `collectors/hn.ts:137` — `fetchWithRetry` with non-retryable 4xx detection
- `collectors/reddit.ts:100` — same pattern
- `collectors/web.ts:19-50` — same pattern with `RETRY_BASE_DELAY_MS` constant

By the time a collector throws, it has already exhausted its retries for transient errors. The outer layer only needs `try/catch` (via `Promise.allSettled`) to capture the terminal failure and mark the source as `failed`. Adding an outer retry would retry the *entire* collector on top of the inner retries — wrong layer, risks duplicated work on DB upserts, and doesn't improve reliability.

This is per-source retry at the collector layer, which is where it already lives.

### Partial-success orchestration

`Promise.allSettled` instead of `Promise.all`. Each collector's outcome is processed independently:

- On `fulfilled`: update source state to `completed` with `itemsFetched`.
- On `rejected`: update source state to `failed` with `errors` populated. Continue.

After all settle, if *all* collectors failed, mark the run failed (not empty-completed) and skip ranking. If at least one succeeded, proceed to dedup/rank with whatever was stored.

### Timeouts

Each collector gets a per-call timeout (e.g., 90s) to protect against hangs. A timed-out collector is treated as a retryable failure. After exhausting retries, it becomes a partial failure and the rest of the run continues.

## Approaches Considered

### Approach A: Flow + worker concurrency + Lua/atomic state

Keep the FlowProducer tree. Bump `collection` worker concurrency to 3. Rewrite `run-state.ts` updates to be atomic (Lua script or WATCH/MULTI) to handle concurrent sibling writers.

**Pros**
- Preserves BullMQ-level per-source retry (each child has its own attempts counter).
- Smallest change to the job topology.

**Cons**
- Requires rewriting `run-state.ts`, which is the package's most load-bearing Redis module.
- Lua/WATCH complexity for a single-worker MVP is over-engineering.
- Doesn't match the user's mental model of "one job per run."
- Observability stays multi-job, which is what the user is trying to get away from.

### Approach B: Single run job with inline parallel collectors *(chosen)*

One BullMQ job per run. The run-process handler orchestrates collectors via `Promise.allSettled` with per-source retry and timeouts, then runs dedup + rank in the same process.

**Pros**
- Matches the user's requested mental model ("one job per run").
- Single-writer invariant for `run:{runId}` holds by construction — no run-state changes.
- Per-source retry preserved via in-process helper.
- Dead-simple observability: one BullMQ job ID per run.
- Smallest diff to the code that matters: API loses the flow tree, run-process gains a pre-dedup collector phase.

**Cons**
- Loses BullMQ-level per-source retry (an in-process wrapper replaces it).
- Whole-run retry on Node crash (acceptable for MVP).
- `collection.ts` worker and queue become dead code (can be deleted in a follow-up).

### Approach C: Hybrid parent + inline collectors

Keep the `run-process` parent job but remove child jobs from the flow and inline collectors into the parent. Essentially B, but pretending to still be A at the API layer.

**Pros**
- Same safety and parallelism benefits as B.

**Cons**
- FlowProducer overhead with no children is awkward — might as well drop it.
- No real advantage over B.

## Chosen Approach: B

### High-level flow

```
POST /api/runs
  │
  ▼
createRun (api/src/services/runs.ts)
  │ - writes initial RunState to Redis
  │ - enqueues ONE BullMQ job: { name: "run-process", queue: "processing", data: {...} }
  │   (no FlowProducer, no children)
  │
  ▼
run-process worker (pipeline/src/workers/run-process.ts)
  │
  ├─▶ Stage: collecting
  │     runCollectors(runId, payload)
  │       │ Promise.allSettled:
  │       │   ├─▶ withRetry(() => collectHn(...))     ─┐
  │       │   ├─▶ withRetry(() => collectReddit(...)) ─┤  parallel
  │       │   └─▶ withRetry(() => collectWeb(...))    ─┘
  │       │
  │       │ as each settles:
  │       │   runState.updateSource(runId, type, completed | failed)
  │       │
  │       ▼
  │     [ if all failed → runState.update(failed), return ]
  │
  ├─▶ Stage: processing  → loadCandidatesSince → dedup
  ├─▶ Stage: ranking     → rankCandidates
  └─▶ Stage: completed   → runState.update(completed, rankedItems)
```

### Concrete code changes

#### `packages/api/src/services/runs.ts`

- Stop building the `FlowChildJob[]` tree.
- Replace `flowProducer.add({ name: "run-process", ..., children })` with a direct enqueue onto the `processing` queue.
- The job data now also carries the collector payloads (`hn`, `reddit`, `web`) so the run-process worker knows what to collect.
- **Set `jobId: runId`** when adding the job — BullMQ dedupes on `jobId`, so any double-submit (client retry, stall redelivery) becomes a no-op and cannot produce two concurrent run-process workers for the same run.
- The `FlowProducer` import can be dropped (or kept with a deprecation note during transition).

New job data shape (kept close to current for minimal churn):

```ts
interface RunProcessJobData {
  runId: string;
  topN: number;
  sourceTypes: ("hn" | "reddit" | "blog")[];
  collectors: {
    hn?: HnCollectConfig;
    reddit?: RedditCollectConfig;
    web?: WebCollectConfig;
  };
}
```

`sourceTypes` is retained because run-process already uses it to scope `loadCandidatesSince`. `collectors` is the new bit.

#### `packages/pipeline/src/workers/run-process.ts`

- Add a new first stage (`collecting`) implemented as a private function inside the same file.
- That function builds tasks for the requested collectors, runs them via `Promise.allSettled`, and updates per-source state as each settles.
- Keep the existing dedup/rank logic unchanged.
- Expose the collector functions through `RunProcessDeps` so tests can inject fakes.

New deps entry:

```ts
interface RunProcessDeps {
  runState: RunStateService;
  db: AppDb;
  loadFn: LoadCandidatesFn;
  rankFn: RankFn;
  collectFns: {            // NEW — injectable seam for tests
    hn: typeof collectHn;
    reddit: typeof collectReddit;
    web: typeof collectWeb;
  };
}
```

Private helper (inlined in `run-process.ts`, ~40 lines):

```ts
async function runCollecting(
  deps: RunProcessDeps,
  runId: string,
  collectors: RunProcessJobData["collectors"],
): Promise<{ successCount: number; failureCount: number }> {
  // 1. Small in-process serializer for state writes:
  let writeChain: Promise<unknown> = Promise.resolve();
  const writeSerial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = writeChain.then(fn);
    writeChain = next.catch(() => {});
    return next;
  };

  // 2. Build per-source tasks that update state the moment they finish:
  const runTask = async (type, fn) => {
    try {
      const result = await fn();
      await writeSerial(() =>
        deps.runState.updateSource(runId, type, {
          status: "completed",
          itemsFetched: result.itemsStored,
        }),
      );
      return { ok: true as const };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await writeSerial(() =>
        deps.runState.updateSource(runId, type, {
          status: "failed",
          errors: [message],
        }),
      );
      return { ok: false as const };
    }
  };

  // 3. Fire collectors in parallel, join at the end:
  const tasks = [];
  if (collectors.hn)     tasks.push(runTask("hn",     () => deps.collectFns.hn(deps, collectors.hn!)));
  if (collectors.reddit) tasks.push(runTask("reddit", () => deps.collectFns.reddit(deps, collectors.reddit!)));
  if (collectors.web)    tasks.push(runTask("blog",   () => deps.collectFns.web(deps, collectors.web!)));

  const results = await Promise.all(tasks);
  return {
    successCount: results.filter(r => r.ok).length,
    failureCount: results.filter(r => !r.ok).length,
  };
}
```

Key properties of this helper:

- **Progressive state updates**: each source flips to `completed` or `failed` the moment its collector settles; the frontend sees live progress during collection.
- **Serialized writes**: `writeSerial` chains state mutations so two concurrently-finishing collectors can't clobber each other's updates to the shared JSON blob.
- **`Promise.all` is fine here** (not `allSettled`) because each `runTask` already catches its own errors and returns a discriminated result — nothing rejects.
- **Partial success**: if one task returns `{ ok: false }` and others return `{ ok: true }`, the caller decides whether to proceed to dedup/rank. All-failed → skip ranking and mark run failed. Otherwise → proceed.

No new files. No new retry helper (collectors retry internally — see "Per-source retry" above).

#### `packages/pipeline/src/workers/collection.ts` and `src/queues/collection.ts`

**Not deleted in this PR.** Left as-is to minimize disruption and give a clean rollback point. Follow-up PR removes them once we've verified the single-job path is healthy. Documented as deprecated in the file header.

#### `packages/api/src/lib/flow.ts`

Can be removed or kept as dead code. Recommend keeping it unused (no imports) in this PR, and removing in the follow-up cleanup.

### Failure semantics

| Situation | Behavior |
|-----------|----------|
| All collectors succeed | Stage advances, dedup + rank run, run completes |
| Some collectors succeed, some fail | Failed sources marked `failed` with errors; run proceeds to dedup + rank with successful items; `warnings` notes partial success |
| All collectors fail | Run marked `failed` with aggregated errors; dedup/rank skipped |
| Collector times out | Treated as a failure after retries exhausted; counts as partial failure |
| Node process crashes | BullMQ redelivers the single run job; whole run re-executes; idempotent upserts make this safe |

### Why this is minimal-disruption

- `run-state.ts` — **untouched**
- `collectors/*.ts` — **untouched**
- `dedup.ts`, `rank.ts` — **untouched**
- `candidate-loader.ts` — **untouched**
- API `POST /api/runs` contract — **unchanged**
- `GET /api/runs/:runId` response shape — **unchanged**
- Frontend — **unchanged**
- Redis schema (`run:{runId}` JSON blob) — **unchanged**
- `collection` queue/worker — **present but unused** (graceful deprecation)

The only files actually modified are `runs.ts` (API service) and `run-process.ts` (worker). **No new files are created.** Everything else is left alone.

## Open Questions

1. **Should we delete `collection` queue/worker in this PR or in a follow-up?** Leaning follow-up for safe rollback; the user's "don't disrupt" guidance favors this.
2. **Observability:** should we add a single `run.started` / `run.completed` log entry spanning the whole run, since it's now one job? (Currently there's a per-source log and a final rank log.)
3. **Per-collector timeout:** the internal collector retries bound the *per-request* time, but not total collector time. Do we want an outer `Promise.race` with a hard ceiling (e.g. 3 minutes) to protect against a pathological retry loop, or trust the existing per-fetch retry bounds?

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|-----------|
| Lost state updates between sibling collectors | Eliminated by single-owner job; no longer applicable | — | Architectural |
| A collector hangs and blocks the whole run | Medium | High | Per-collector timeout + retry |
| Rate-limit burst from running three collectors at once | Low (different hosts) | Medium | Per-collector retry with backoff absorbs transient 429s |
| Worker crash mid-run re-runs everything | Low | Low | Idempotent upserts make re-run cheap; run is short |
| Test coverage gap during refactor | Medium | Medium | New unit tests for `run-collectors.ts` and `retry.ts`; update `run-process.test.ts` to cover collecting stage |
| Stale `collection` worker keeps draining if someone still enqueues into it | Low | Low | API stops enqueueing into `collection` in the same PR as the run-process change; no split-brain window |

## Assumptions

- Only one run-process Node worker runs at a time (current MVP reality).
- Runs are short-lived (seconds to a couple of minutes) — in-process retry is adequate.
- Collector functions are already idempotent at the DB layer (upserts), which the current code confirms.
- The frontend only cares about the Redis `RunState` JSON shape, not about BullMQ job count or structure.
- Rate limits on HN, Reddit, and Web APIs are per-host and do not overlap.

## Test Plan

All test changes happen in existing files. No new test files.

- **`run-process.test.ts`** (update) — inject fake `collectFns` via `RunProcessDeps` and cover:
  - all collectors succeed → sources marked completed, dedup+rank run
  - one collector rejects → partial success, failed source has errors, dedup+rank still run with surviving items
  - all collectors reject → run marked failed, dedup+rank skipped
  - only requested collectors are invoked (e.g. run with only `hn` doesn't call reddit/web fakes)
  - collectors actually run concurrently (assert overlapping start times via a controlled deferred)
- **`runs-service.test.ts`** (update) — assert API enqueues a single job on the `processing` queue (no FlowProducer, no children) with the collectors payload in `data`, and with `jobId` equal to the `runId`
- **Progressive update test** — in `run-process.test.ts`, use controlled deferreds for each fake collector and assert that HN's state flips to `completed` *before* Reddit's collector resolves, proving state updates are not batched to the end
- **Serialization race test** — use two fake collectors that resolve in the same microtask tick and assert both sources end up `completed` in the final state (catches the read-modify-write clobber)
- **Double-enqueue test** — call `createRun` twice with a deterministic `runId` (via injected UUID) and assert BullMQ only has one job in the queue
- **E2E** — existing e2e with one real source, assert parity of final ranked output

## Out of Scope

- Deleting `collection` worker / queue (follow-up PR).
- Multi-worker scale-out of run-process (current MVP runs a single worker).
- Frontend streaming updates (polling contract unchanged).
- Moving to per-source Redis keys (discussed and rejected — not needed for single-job shape).
