# Phase 5: Processing queue + run-process parent worker

> **Status:** pending
> **Depends on:** Phases 2, 3, 4
> **Traces to:** REQ-040, REQ-041, REQ-042, REQ-044, REQ-063 (Redis write), REQ-070, REQ-071, REQ-080 (partial), REQ-083, REQ-084, REQ-085, EDGE-001, EDGE-013

## Overview

Adds a new `processing` BullMQ queue, a `run-process` worker that is the parent
node in the FlowProducer flow, and a query helper for loading candidate items
from Postgres by timestamp window. The parent job dedups → ranks → writes
final `rankedItems` to Redis run-state.

## Library research note

Use **context7** before wiring to confirm current `bullmq` FlowProducer API:
- How a parent job handler accesses its children's results / failure state
- Whether `getChildrenValues()` / `getDependencies()` is still the preferred path
- Behavior when a child fails: does the parent still fire? (REQ-040 asserts yes)
- Any new `children` step options introduced in 5.x

Per `.claude/rules/research-and-validation.md`, do not assume.

## Implementation

**Files to create:**
- `packages/pipeline/src/queues/processing.ts`
- `packages/pipeline/src/workers/run-process.ts`
- `packages/pipeline/src/services/candidate-loader.ts`
- `packages/pipeline/tests/unit/workers/run-process.test.ts`
- `packages/pipeline/tests/e2e/run-process.e2e.test.ts`

**Files to modify:**
- `packages/pipeline/src/index.ts` — instantiate and start the new worker alongside collection
- `packages/shared/src/db/queries/raw-items.ts` (new file, or add to schema.ts) — export `findCollectedSince(db, { since, sourceTypes })`

### `queues/processing.ts`

```typescript
import { Queue } from "bullmq";
import { createRedisConnection } from "@newsletter/shared";

export const PROCESSING_QUEUE_NAME = "processing";

export const processingQueue = new Queue(PROCESSING_QUEUE_NAME, {
  connection: createRedisConnection(),
});
```

### `services/candidate-loader.ts`

```typescript
import { and, gte, inArray } from "drizzle-orm";
import type { AppDb } from "@newsletter/shared";
import { rawItems } from "@newsletter/shared/db/schema";
import type { SourceType } from "@newsletter/shared";

export interface Candidate {
  id: number;
  title: string;
  url: string;
  sourceType: SourceType;
  author: string | null;
  publishedAt: Date | null;
  engagement: { points: number; commentCount: number };
}

export async function loadCandidatesSince(
  db: AppDb,
  since: Date,
  sourceTypes: SourceType[],
): Promise<Candidate[]> {
  if (sourceTypes.length === 0) return [];
  const rows = await db
    .select({
      id: rawItems.id,
      title: rawItems.title,
      url: rawItems.url,
      sourceType: rawItems.sourceType,
      author: rawItems.author,
      publishedAt: rawItems.publishedAt,
      engagement: rawItems.engagement,
    })
    .from(rawItems)
    .where(
      and(
        gte(rawItems.collectedAt, since),
        inArray(rawItems.sourceType, sourceTypes),
      ),
    );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    url: r.url,
    sourceType: r.sourceType,
    author: r.author,
    publishedAt: r.publishedAt,
    engagement: r.engagement,
  }));
}
```

**EDGE-013 fallback:** If `runState.startedAt` cannot be read (e.g. Redis TTL
expired) the parent uses `new Date(Date.now() - 10 * 60 * 1000)` as the `since`
window and logs a warning.

### `workers/run-process.ts`

```typescript
import { Worker } from "bullmq";
import { createRedisConnection, createLogger, getDb } from "@newsletter/shared";
import { dedupCandidates } from "../processors/dedup";
import { rankCandidates } from "../processors/rank";
import { createRunStateService } from "../services/run-state";
import { loadCandidatesSince } from "../services/candidate-loader";

const logger = createLogger("pipeline:run-process");

export function createRunProcessWorker() {
  const redis = createRedisConnection();
  const runState = createRunStateService(redis);
  const db = getDb();

  return new Worker(
    "processing",
    async (job) => {
      if (job.name !== "run-process") throw new Error(`unknown job: ${job.name}`);
      const { runId, topN, sourceTypes } = job.data as {
        runId: string;
        topN: number;
        sourceTypes: ("hn" | "reddit")[];
      };
      const started = Date.now();

      // Stage: processing
      await runState.setStage(runId, "processing");

      // Determine `since` window
      const state = await runState.get(runId);
      let since: Date;
      if (state?.startedAt) {
        since = new Date(state.startedAt);
      } else {
        since = new Date(Date.now() - 10 * 60 * 1000);
        logger.warn({ runId }, "run-state missing; using 10-minute fallback window");
      }

      // Load candidates
      const rawCandidates = await loadCandidatesSince(db, since, sourceTypes);

      // Handle all-failed-collection case (REQ-044 + EDGE-001)
      if (rawCandidates.length === 0) {
        await runState.update(runId, (prev) => ({
          ...prev,
          stage: "completed",
          status: "completed",
          rankedItems: [],
          completedAt: new Date().toISOString(),
          warnings: [...prev.warnings, "no items collected"],
        }));
        logger.info({ event: "run.completed", runId, totalDurationMs: Date.now() - started, rankedItemCount: 0 }, "run.completed");
        return { rankedCount: 0 };
      }

      // Dedup
      const deduped = dedupCandidates(
        rawCandidates.map((c) => ({
          id: c.id,
          url: c.url,
          engagement: c.engagement,
          // carry-through fields needed for ranking
          title: c.title,
          sourceType: c.sourceType,
          publishedAt: c.publishedAt?.toISOString() ?? null,
          author: c.author,
        })),
      );
      logger.info({ event: "run.dedup", runId, inputCount: rawCandidates.length, outputCount: deduped.length }, "run.dedup");

      // Rank
      await runState.setStage(runId, "ranking");
      let rankResult;
      try {
        rankResult = await rankCandidates(deduped, { topN });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await runState.update(runId, (prev) => ({
          ...prev,
          stage: "failed",
          status: "failed",
          error: message,
          completedAt: new Date().toISOString(),
        }));
        throw err;
      }

      // Success
      await runState.update(runId, (prev) => ({
        ...prev,
        stage: "completed",
        status: "completed",
        rankedItems: rankResult.rankedItems,
        completedAt: new Date().toISOString(),
      }));

      logger.info({ event: "run.completed", runId, totalDurationMs: Date.now() - started, rankedItemCount: rankResult.rankedItems.length }, "run.completed");
      return { rankedCount: rankResult.rankedItems.length };
    },
    { connection: redis },
  );
}
```

**Note:** The parent worker does NOT need to inspect child results explicitly for
per-source failures — the collector workers already wrote per-source state to
Redis on failure. The parent only cares about the current state of `raw_items`
for dedup/rank. This simplifies the flow.

### `index.ts` (pipeline entrypoint) changes

Add:

```typescript
import { createRunProcessWorker } from "./workers/run-process";
// existing: collection worker setup

// Env validation
if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is required for ranking");
}
// Map to the env name @ai-sdk/google expects
process.env.GOOGLE_GENERATIVE_AI_API_KEY ??= process.env.GEMINI_API_KEY;

const runProcessWorker = createRunProcessWorker();
// graceful shutdown handling — follow existing pattern for collection worker
```

## What to test

**Unit tests (`run-process.test.ts`):**

1. **REQ-042:** `loadCandidatesSince` builds the right drizzle query — test with a
   minimal in-memory DB stub OR an e2e test with real Postgres (prefer e2e for
   drizzle query correctness — see below).
2. **REQ-044 / EDGE-001:** all-failed case — mock loader returns `[]` → worker
   sets status `completed`, stage `completed`, rankedItems `[]`, warnings
   contains `"no items collected"`.
3. **EDGE-013:** run-state get returns null → fallback window logged, candidate
   loader called with `now - 10min`.
4. **REQ-064:** rankCandidates throws → worker writes `status: "failed"`,
   `stage: "failed"`, error set, completedAt set, then rethrows.
5. **Happy path:** mock loader returns 3 items, mock dedup passes them through,
   mock rank returns 2 items → worker writes rankedItems `[2 items]` and sets
   `completed` stage/status.
6. **Logs:** assert `run.dedup`, `run.rank` (emitted by rank.ts), and `run.completed`
   logs are emitted with correct event fields.

**E2E test (`run-process.e2e.test.ts`, requires real Postgres + Redis):**

- Seed `raw_items` with 5 hn + 3 reddit items, some duplicates on canonical URL.
- Seed a run-state Redis key with `startedAt` a minute ago, `topN: 3`.
- Mock the `rankCandidates` import (or use a test double injector) to return a
  deterministic top-3 list.
- Enqueue a `run-process` job on the processing queue with matching runId/topN.
- Wait for job completion; assert Redis run-state has `stage: "completed"`,
  3 ranked items, valid `completedAt`.

**Commit:** `feat(VER-run-ui): add processing queue and run-process parent worker`

## Done When

- [ ] `processing` queue created and exported
- [ ] `run-process` worker started by pipeline entrypoint
- [ ] Env validation rejects missing GEMINI_API_KEY at boot
- [ ] Candidate loader queries `raw_items` by `collectedAt` + sourceType
- [ ] All unit + e2e tests pass
