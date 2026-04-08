# Phase 2: Run-state Redis service + collector state reporting

> **Status:** pending
> **Depends on:** Phase 1
> **Traces to:** REQ-004, REQ-030, REQ-031, REQ-032, REQ-081, REQ-082

## Overview

Adds a typed wrapper around Redis for read/merge/write of `run:{runId}` keys with
a 1-hour TTL, and wires the existing `collection` worker to update per-source
state on start/complete/fail, plus emit the corresponding structured logs. After
this phase, collectors report progress observable via `GET /api/runs/:runId`
(which doesn't exist yet, but the Redis contract is ready).

## Implementation

**Files to create:**
- `packages/pipeline/src/services/run-state.ts`
- `packages/pipeline/tests/unit/services/run-state.test.ts`

**Files to modify:**
- `packages/pipeline/src/workers/collection.ts` — wrap handler to read `runId`
  from job data, write per-source status transitions, emit lifecycle logs.
- `packages/pipeline/src/index.ts` — export `createRunStateService` and `RUN_STATE_TTL_SECONDS`
  (used later by the api when seeding initial state).

### `run-state.ts` contract

```typescript
import type { RedisOptions } from "ioredis";
import IORedis from "ioredis";
import type { RunState, SourceRunState, SourceType, RunStage, RunStatus } from "@newsletter/shared";

export const RUN_STATE_TTL_SECONDS = 3600;
const keyOf = (runId: string): string => `run:${runId}`;

export interface RunStateService {
  get(runId: string): Promise<RunState | null>;
  set(state: RunState): Promise<void>;
  /** Optimistic merge: read, apply mutator, write back with same TTL. */
  update(runId: string, mutate: (prev: RunState) => RunState): Promise<RunState | null>;
  updateSource(
    runId: string,
    sourceType: SourceType,
    patch: Partial<SourceRunState>,
  ): Promise<void>;
  setStage(runId: string, stage: RunStage, status?: RunStatus): Promise<void>;
}

export function createRunStateService(redis: IORedis): RunStateService {
  return {
    async get(runId) {
      const raw = await redis.get(keyOf(runId));
      return raw ? (JSON.parse(raw) as RunState) : null;
    },
    async set(state) {
      const now = new Date().toISOString();
      const payload = JSON.stringify({ ...state, updatedAt: now });
      await redis.set(keyOf(state.id), payload, "EX", RUN_STATE_TTL_SECONDS);
    },
    async update(runId, mutate) {
      const prev = await this.get(runId);
      if (!prev) return null;
      const next = mutate(prev);
      await this.set(next);
      return next;
    },
    async updateSource(runId, sourceType, patch) {
      await this.update(runId, (prev) => {
        const current: SourceRunState = prev.sources[sourceType] ?? {
          status: "pending",
          itemsFetched: 0,
          errors: [],
        };
        return {
          ...prev,
          sources: { ...prev.sources, [sourceType]: { ...current, ...patch } },
        };
      });
    },
    async setStage(runId, stage, status) {
      await this.update(runId, (prev) => ({
        ...prev,
        stage,
        status: status ?? prev.status,
      }));
    },
  };
}
```

**Why merge-via-read-modify-write instead of atomic WATCH/MULTI:** MVP uses a single
collection worker + a single run-process worker, and each run has independent keys.
Contention on the same key is limited to a collector child and the parent job
running simultaneously, which doesn't happen in the fan-out/fan-in flow (parent
starts only after children finish). Simple read-modify-write is sufficient.
Document this rationale in a header comment.

### Worker wiring

Modify `packages/pipeline/src/workers/collection.ts`:

```typescript
// pseudocode — follow existing handler shape
async function handleCollectionJob(job) {
  const runId = job.data?.runId as string | undefined;
  const sourceType = jobNameToSourceType(job.name); // "hn-collect" -> "hn" etc
  const startedAt = Date.now();

  if (runId) {
    await runState.updateSource(runId, sourceType, { status: "running" });
    await runState.setStage(runId, "collecting");
  }

  try {
    const result = await dispatchCollector(job);
    if (runId) {
      await runState.updateSource(runId, sourceType, {
        status: "completed",
        itemsFetched: result.itemsStored,
      });
    }
    logger.info(
      { event: "run.source.completed", runId, sourceType, itemsFetched: result.itemsStored, durationMs: Date.now() - startedAt },
      "run.source.completed",
    );
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (runId) {
      await runState.updateSource(runId, sourceType, {
        status: "failed",
        errors: [message],
      });
    }
    logger.error(
      { event: "run.source.failed", runId, sourceType, error: message },
      "run.source.failed",
    );
    throw err; // let BullMQ mark the job failed; flow parent still fires per REQ-040
  }
}
```

**Important:** `runId` is optional on the job data. Backward-compat — existing
ad-hoc collection jobs without a runId should still work unchanged (they skip
all run-state calls).

## What to test

1. **RunStateService unit tests** (test against an in-memory mock or `ioredis-mock`
   if available; otherwise use a spy-based ioredis mock):
   - `set` then `get` round-trips all fields
   - `updateSource` creates the source entry if it doesn't exist
   - `updateSource` merges without clobbering other source entries
   - `update` returns `null` when key doesn't exist
   - TTL is set to 3600 on every `set`
2. **Collection worker unit tests:** extend the existing worker test harness.
   - Job without `runId` → behaves as before, no Redis calls.
   - Job with `runId` → calls `updateSource` with `status: "running"` before the
     collector runs, `status: "completed"` + `itemsFetched` after success.
   - Throwing collector → `updateSource` with `status: "failed"` and errors
     populated.
   - Log assertions: success log has `event: "run.source.completed"` with correct
     fields; failure log has `event: "run.source.failed"`.

**Commit:** `feat(VER-run-ui): add run-state Redis service and collector reporting`

## Done When

- [ ] `run-state.ts` service with all methods
- [ ] Collection worker updates state on start/success/failure
- [ ] Lifecycle logs emitted with structured event names
- [ ] Unit tests pass for both service and worker wrapper
- [ ] Existing tests unchanged
