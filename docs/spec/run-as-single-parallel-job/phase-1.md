# Phase 1: Single-Job Refactor

**Phase Goal:** Replace the FlowProducer+children topology with a single `run-process` BullMQ job that runs collectors in parallel in-process, with serialized per-source state writes and partial-success handling.

**TDD Discipline:** Tests first, implementation second, tests green before moving on. Run `pnpm typecheck && pnpm lint && pnpm test:unit` after each task. Never skip the verification step.

**Spec references:** `docs/spec/run-as-single-parallel-job/spec.md`

---

## Task 1: Extend RunProcessJobData and add collectFns dep (types only, no behavior change yet)

**Files:**
- Modify: `packages/pipeline/src/workers/run-process.ts` (lines 29-55)

**Goal:** Introduce the new job data shape (`collectors` record + `blog` added to sourceTypes union) and the `collectFns` injection seam in `RunProcessDeps`. This is a type-only change — the handler still behaves identically until Task 3 wires it up. After this task the project still typechecks and tests still pass.

- [ ] **Step 1: Write a failing test that asserts `RunProcessDeps` accepts `collectFns`**

Add this test to `packages/pipeline/tests/unit/workers/run-process.test.ts` just above the existing `describe` block's closing brace (keep all existing tests intact):

```ts
// REQ-015: collectFns injection seam exists on RunProcessDeps
it("REQ-015: createRunProcessWorker accepts collectFns option", async () => {
  const runStateMock = makeMockRunState(makeRunState());
  const hn = vi.fn();
  const reddit = vi.fn();
  const web = vi.fn();
  const worker = createRunProcessWorker({
    runState: runStateMock.service,
    loadFn: vi.fn(() => Promise.resolve([])),
    rankFn: vi.fn(),
    collectFns: { hn, reddit, web },
  });
  expect(worker).toBeDefined();
});
```

- [ ] **Step 2: Run the test — expected FAIL with `Object literal may only specify known properties, and 'collectFns' does not exist in type 'CreateRunProcessWorkerOptions'`**

Run:
```bash
pnpm --filter @newsletter/pipeline test:unit tests/unit/workers/run-process.test.ts
```

Expected: compile error about `collectFns` not being a valid option. This proves the seam doesn't exist yet.

- [ ] **Step 3: Add the `collectors` field to `RunProcessJobData`, `collectFns` to `RunProcessDeps` and `CreateRunProcessWorkerOptions`, import collector functions**

In `packages/pipeline/src/workers/run-process.ts`, modify the imports and type declarations:

```ts
import { Worker, Queue } from "bullmq";
import type IORedis from "ioredis";
import {
  createRedisConnection,
  getDb,
  type AppDb,
  type SourceType,
} from "@newsletter/shared/db";
import { createLogger } from "@newsletter/shared/logger";
import { dedupCandidates } from "@pipeline/processors/dedup.js";
import {
  rankCandidates,
  type RankResult,
  type RankOptions,
  type RankCandidate,
} from "@pipeline/processors/rank.js";
import {
  createRunStateService,
  type RunStateService,
} from "@pipeline/services/run-state.js";
import {
  loadCandidatesSince,
  type LoadCandidatesFn,
  type Candidate,
} from "@pipeline/services/candidate-loader.js";
import { collectHn } from "@pipeline/collectors/hn.js";
import { collectReddit } from "@pipeline/collectors/reddit.js";
import { collectWeb } from "@pipeline/collectors/web.js";
import { createRawItemsRepo } from "@pipeline/repositories/raw-items.js";
import type {
  HnCollectConfig,
  RedditCollectConfig,
  WebCollectConfig,
} from "@pipeline/types.js";
import type { CollectorResult } from "@newsletter/shared";

const logger = createLogger("worker:run-process");

export interface RunCollectorsPayload {
  hn?: HnCollectConfig;
  reddit?: RedditCollectConfig;
  web?: WebCollectConfig;
}

export interface RunProcessJobData {
  runId: string;
  topN: number;
  sourceTypes: ("hn" | "reddit" | "blog")[];
  collectors: RunCollectorsPayload;
}

export interface RunProcessJobLike {
  name: string;
  id?: string;
  data: RunProcessJobData;
}

export interface RunProcessResult {
  rankedCount: number;
}

export type RankFn = (
  candidates: RankCandidate[],
  options: RankOptions,
) => Promise<RankResult>;

export type HnCollectFn = (
  deps: { rawItemsRepo: ReturnType<typeof createRawItemsRepo> },
  config: HnCollectConfig,
) => Promise<CollectorResult>;

export type RedditCollectFn = (
  deps: { rawItemsRepo: ReturnType<typeof createRawItemsRepo> },
  config: RedditCollectConfig,
) => Promise<CollectorResult>;

export type WebCollectFn = (
  deps: { rawItemsRepo: ReturnType<typeof createRawItemsRepo> },
  config: WebCollectConfig,
) => Promise<CollectorResult>;

export interface CollectFns {
  hn: HnCollectFn;
  reddit: RedditCollectFn;
  web: WebCollectFn;
}

export interface RunProcessDeps {
  runState: RunStateService;
  db: AppDb;
  loadFn: LoadCandidatesFn;
  rankFn: RankFn;
  collectFns: CollectFns;
}
```

Also update `CreateRunProcessWorkerOptions`:

```ts
export interface CreateRunProcessWorkerOptions {
  connection?: IORedis;
  runState?: RunStateService;
  db?: AppDb;
  loadFn?: LoadCandidatesFn;
  rankFn?: RankFn;
  collectFns?: Partial<CollectFns>;
}
```

And update `createRunProcessWorker` to wire the default collectFns:

```ts
export function createRunProcessWorker(
  options: CreateRunProcessWorkerOptions = {},
): Worker<RunProcessJobData, RunProcessResult> {
  const connection = options.connection ?? createRedisConnection();
  const runState = options.runState ?? createRunStateService(connection);
  const db = options.db ?? getDb();
  const loadFn = options.loadFn ?? loadCandidatesSince;
  const rankFn: RankFn =
    options.rankFn ?? ((candidates, opts) => rankCandidates(candidates, opts));
  const collectFns: CollectFns = {
    hn: options.collectFns?.hn ?? collectHn,
    reddit: options.collectFns?.reddit ?? collectReddit,
    web: options.collectFns?.web ?? collectWeb,
  };

  const deps: RunProcessDeps = { runState, db, loadFn, rankFn, collectFns };

  return new Worker<RunProcessJobData, RunProcessResult>(
    "processing",
    (job) => handleRunProcessJob(deps, job as RunProcessJobLike),
    { connection },
  );
}
```

**Note:** Existing test mocks for `makeMockRunState` do not need changes — they already satisfy `RunStateService`. The `Queue` import on line 1 is used in later tasks — add it now to avoid churn.

- [ ] **Step 4: Update existing test job payloads to include the new `collectors` field**

Every existing test in `packages/pipeline/tests/unit/workers/run-process.test.ts` uses `baseJob.data` without `collectors`. Update the `JobLike` interface and `baseJob` near lines 37-46 and 112-120:

```ts
interface JobLike {
  name: string;
  id?: string;
  data: {
    runId: string;
    topN: number;
    sourceTypes: ("hn" | "reddit" | "blog")[];
    collectors: { hn?: unknown; reddit?: unknown; web?: unknown };
  };
}

const baseJob: JobLike = {
  name: "run-process",
  id: "job-1",
  data: {
    runId: "run-1",
    topN: 3,
    sourceTypes: ["hn", "reddit"],
    collectors: {},
  },
};
```

Empty `collectors: {}` is valid for the pre-existing tests because they don't exercise the collecting stage (they go straight to the empty-candidates or ranking paths).

- [ ] **Step 5: Run typecheck and full unit test suite to verify nothing regressed**

```bash
pnpm typecheck
pnpm --filter @newsletter/pipeline test:unit
```

Expected: typecheck clean, all existing run-process tests still pass, the new REQ-015 seam test passes.

- [ ] **Step 6: Commit**

```bash
git add packages/pipeline/src/workers/run-process.ts packages/pipeline/tests/unit/workers/run-process.test.ts
git commit -m "feat(VER): add collectFns seam to run-process deps

Introduces RunCollectorsPayload, CollectFns, and extends RunProcessJobData
with a collectors field. No behavior change yet — wiring arrives in the
next task. Existing tests updated to include collectors: {} in baseJob."
```

---

## Task 2: Write failing tests for the collecting stage (TDD RED)

**Files:**
- Modify: `packages/pipeline/tests/unit/workers/run-process.test.ts`

**Goal:** Add all the new-behavior tests before the implementation exists. These tests cover REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-010, REQ-016, REQ-017, EDGE-002, EDGE-003, EDGE-013. Each test must fail with the current (unchanged) handler — that failure proves the test actually exercises the new code path.

- [ ] **Step 1: Add test helpers for controlled deferred collectors and stage-tracking**

At the top of `run-process.test.ts` after the existing imports, add:

```ts
interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
```

- [ ] **Step 2: Add the REQ-004 test (stage is set to "collecting" before any collector runs)**

```ts
it("REQ-004: sets stage to 'collecting' before invoking any collector", async () => {
  const runStateMock = makeMockRunState(makeRunState());
  const seenStagesAtFirstCall: string[] = [];
  const hn = vi.fn(async () => {
    seenStagesAtFirstCall.push(
      runStateMock.stageCalls.map((s) => s.stage).join(","),
    );
    return { itemsFetched: 0, itemsStored: 0, failures: 0, durationMs: 1 };
  });
  const worker = createRunProcessWorker({
    runState: runStateMock.service,
    loadFn: vi.fn(() => Promise.resolve([])),
    rankFn: vi.fn(),
    collectFns: { hn, reddit: vi.fn(), web: vi.fn() },
  });
  await worker.handler({
    ...baseJob,
    data: {
      ...baseJob.data,
      sourceTypes: ["hn"],
      collectors: { hn: { sinceDays: 1 } as unknown as HnCollectConfig },
    },
  });
  // At least one stage transition ("collecting") must have happened before the
  // collector was called.
  expect(seenStagesAtFirstCall[0]).toContain("collecting");
});
```

Also add `import type { HnCollectConfig, RedditCollectConfig, WebCollectConfig } from "@pipeline/types.js";` near the top of the file.

- [ ] **Step 3: Add the REQ-005 test (parallel dispatch — all collectors start before any resolve)**

```ts
it("REQ-005: invokes all requested collectors concurrently", async () => {
  const runStateMock = makeMockRunState(makeRunState());
  const hnStart = createDeferred<void>();
  const redditStart = createDeferred<void>();
  const webStart = createDeferred<void>();
  const hnResolve = createDeferred<CollectorResult>();
  const redditResolve = createDeferred<CollectorResult>();
  const webResolve = createDeferred<CollectorResult>();

  const hn = vi.fn(async () => {
    hnStart.resolve();
    return hnResolve.promise;
  });
  const reddit = vi.fn(async () => {
    redditStart.resolve();
    return redditResolve.promise;
  });
  const web = vi.fn(async () => {
    webStart.resolve();
    return webResolve.promise;
  });
  const worker = createRunProcessWorker({
    runState: runStateMock.service,
    loadFn: vi.fn(() => Promise.resolve([])),
    rankFn: vi.fn(),
    collectFns: { hn, reddit, web },
  });

  const handlerPromise = worker.handler({
    ...baseJob,
    data: {
      ...baseJob.data,
      sourceTypes: ["hn", "reddit", "blog"],
      collectors: {
        hn: { sinceDays: 1 } as unknown as HnCollectConfig,
        reddit: {
          subreddits: ["LocalLLaMA"],
          sinceDays: 1,
        } as unknown as RedditCollectConfig,
        web: {
          sources: [{ name: "x", listingUrl: "https://x.com" }],
          maxItems: 5,
        } as unknown as WebCollectConfig,
      },
    },
  });

  // All three must have started before any resolves.
  await Promise.all([
    hnStart.promise,
    redditStart.promise,
    webStart.promise,
  ]);
  hnResolve.resolve({ itemsFetched: 1, itemsStored: 1, failures: 0, durationMs: 1 });
  redditResolve.resolve({ itemsFetched: 2, itemsStored: 2, failures: 0, durationMs: 1 });
  webResolve.resolve({ itemsFetched: 3, itemsStored: 3, failures: 0, durationMs: 1 });
  await handlerPromise;
});
```

- [ ] **Step 4: Add the REQ-006 test (progressive per-source state updates — fast source flips before slow source finishes)**

```ts
it("REQ-006: progressively marks sources completed as each collector resolves", async () => {
  const runStateMock = makeMockRunState(makeRunState());
  const redditGate = createDeferred<CollectorResult>();
  const updateSourceCalls: Array<{
    type: string;
    patch: Record<string, unknown>;
  }> = [];
  runStateMock.service.updateSource = vi.fn(
    (_runId: string, type: string, patch: Record<string, unknown>) => {
      updateSourceCalls.push({ type, patch });
      return Promise.resolve();
    },
  );

  const hn = vi.fn(async () => ({
    itemsFetched: 5,
    itemsStored: 5,
    failures: 0,
    durationMs: 1,
  }));
  const reddit = vi.fn(async () => redditGate.promise);
  const worker = createRunProcessWorker({
    runState: runStateMock.service,
    loadFn: vi.fn(() => Promise.resolve([])),
    rankFn: vi.fn(),
    collectFns: { hn, reddit, web: vi.fn() },
  });

  const handlerPromise = worker.handler({
    ...baseJob,
    data: {
      ...baseJob.data,
      sourceTypes: ["hn", "reddit"],
      collectors: {
        hn: { sinceDays: 1 } as unknown as HnCollectConfig,
        reddit: {
          subreddits: ["LocalLLaMA"],
          sinceDays: 1,
        } as unknown as RedditCollectConfig,
      },
    },
  });

  // Wait a few microtasks for HN to propagate its state update.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  const hnCompleted = updateSourceCalls.find(
    (c) => c.type === "hn" && c.patch.status === "completed",
  );
  const redditCompleted = updateSourceCalls.find(
    (c) => c.type === "reddit" && c.patch.status === "completed",
  );
  expect(hnCompleted).toBeDefined();
  expect(hnCompleted?.patch.itemsFetched).toBe(5);
  expect(redditCompleted).toBeUndefined(); // reddit still gated

  redditGate.resolve({
    itemsFetched: 2,
    itemsStored: 2,
    failures: 0,
    durationMs: 1,
  });
  await handlerPromise;
});
```

- [ ] **Step 5: Add the REQ-007 / EDGE-013 test (one collector fails, others continue, dedup/rank still runs)**

```ts
it("REQ-007/EDGE-013: marks failing source as failed and continues with successes", async () => {
  const runStateMock = makeMockRunState(makeRunState());
  const updateSourceCalls: Array<{
    type: string;
    patch: Record<string, unknown>;
  }> = [];
  runStateMock.service.updateSource = vi.fn(
    (_runId: string, type: string, patch: Record<string, unknown>) => {
      updateSourceCalls.push({ type, patch });
      return Promise.resolve();
    },
  );

  const hn = vi.fn(async () => ({
    itemsFetched: 3,
    itemsStored: 3,
    failures: 0,
    durationMs: 1,
  }));
  const reddit = vi.fn(async () => {
    throw new Error("boom");
  });
  const loadFn = vi.fn(
    (): Promise<Candidate[]> => Promise.resolve([makeCandidate(1)]),
  );
  const rankFn = vi.fn(
    (): Promise<RankResult> =>
      Promise.resolve({
        rankedItems: [{ rawItemId: 1, score: 0.9, rationale: "ok" }],
        candidateCount: 1,
        rankedCount: 1,
      }),
  );
  const worker = createRunProcessWorker({
    runState: runStateMock.service,
    loadFn,
    rankFn,
    collectFns: { hn, reddit, web: vi.fn() },
  });

  const result = await worker.handler({
    ...baseJob,
    data: {
      ...baseJob.data,
      sourceTypes: ["hn", "reddit"],
      collectors: {
        hn: { sinceDays: 1 } as unknown as HnCollectConfig,
        reddit: {
          subreddits: ["LocalLLaMA"],
          sinceDays: 1,
        } as unknown as RedditCollectConfig,
      },
    },
  });

  const hnCompleted = updateSourceCalls.find(
    (c) => c.type === "hn" && c.patch.status === "completed",
  );
  const redditFailed = updateSourceCalls.find(
    (c) => c.type === "reddit" && c.patch.status === "failed",
  );
  expect(hnCompleted).toBeDefined();
  expect(redditFailed).toBeDefined();
  expect(redditFailed?.patch.errors).toEqual(["boom"]);

  // Ranking still ran because HN succeeded.
  expect(rankFn).toHaveBeenCalledOnce();
  expect(result.rankedCount).toBe(1);
});
```

- [ ] **Step 6: Add the REQ-008 / EDGE-002 race serialization test — the load-bearing one**

This is the test that catches the intra-process read-modify-write race. It must actually exercise the race: the fake `updateSource` must yield between "read" and "write" so two near-simultaneous calls from different collectors can interleave without serialization.

```ts
it("REQ-008/EDGE-002: serializes state writes so concurrent collectors do not clobber each other", async () => {
  // Simulated store with a controlled yield between read and write.
  const store = new Map<string, Record<string, unknown>>();
  store.set("run-1", { hn: null, reddit: null, web: null });

  const updateSource = vi.fn(
    async (_runId: string, type: string, patch: Record<string, unknown>) => {
      const current = store.get("run-1");
      // yield — mimics real Redis GET latency; without writeSerial, the second
      // concurrent call will read the same snapshot and overwrite the first
      await new Promise((r) => setImmediate(r));
      const next = { ...current, [type]: patch };
      store.set("run-1", next);
    },
  );

  const runStateMock = makeMockRunState(makeRunState());
  runStateMock.service.updateSource = updateSource;

  // Two collectors that resolve in the same microtask tick.
  const hn = vi.fn(() =>
    Promise.resolve({
      itemsFetched: 1,
      itemsStored: 1,
      failures: 0,
      durationMs: 0,
    }),
  );
  const reddit = vi.fn(() =>
    Promise.resolve({
      itemsFetched: 2,
      itemsStored: 2,
      failures: 0,
      durationMs: 0,
    }),
  );

  const worker = createRunProcessWorker({
    runState: runStateMock.service,
    loadFn: vi.fn(() => Promise.resolve([])),
    rankFn: vi.fn(),
    collectFns: { hn, reddit, web: vi.fn() },
  });

  await worker.handler({
    ...baseJob,
    data: {
      ...baseJob.data,
      sourceTypes: ["hn", "reddit"],
      collectors: {
        hn: { sinceDays: 1 } as unknown as HnCollectConfig,
        reddit: {
          subreddits: ["LocalLLaMA"],
          sinceDays: 1,
        } as unknown as RedditCollectConfig,
      },
    },
  });

  // Both sources must be present — neither overwritten.
  const final = store.get("run-1");
  expect(final?.hn).toMatchObject({ status: "completed" });
  expect(final?.reddit).toMatchObject({ status: "completed" });
});
```

- [ ] **Step 7: Add the REQ-009 test (stage transitions to "processing" exactly once after collecting)**

```ts
it("REQ-009: sets stage to 'processing' exactly once after all collectors settle", async () => {
  const runStateMock = makeMockRunState(makeRunState());
  const hn = vi.fn(async () => ({
    itemsFetched: 1,
    itemsStored: 1,
    failures: 0,
    durationMs: 1,
  }));
  const loadFn = vi.fn((): Promise<Candidate[]> => Promise.resolve([]));
  const worker = createRunProcessWorker({
    runState: runStateMock.service,
    loadFn,
    rankFn: vi.fn(),
    collectFns: { hn, reddit: vi.fn(), web: vi.fn() },
  });

  await worker.handler({
    ...baseJob,
    data: {
      ...baseJob.data,
      sourceTypes: ["hn"],
      collectors: { hn: { sinceDays: 1 } as unknown as HnCollectConfig },
    },
  });

  const processingCalls = runStateMock.stageCalls.filter(
    (s) => s.stage === "processing",
  );
  expect(processingCalls).toHaveLength(1);
});
```

- [ ] **Step 8: Add the REQ-010 test (all collectors fail → run marked failed, dedup/rank skipped)**

```ts
it("REQ-010: marks run as failed and skips ranking when every collector fails", async () => {
  const runStateMock = makeMockRunState(makeRunState());
  const hn = vi.fn(async () => {
    throw new Error("hn boom");
  });
  const reddit = vi.fn(async () => {
    throw new Error("reddit boom");
  });
  const loadFn = vi.fn((): Promise<Candidate[]> => Promise.resolve([]));
  const rankFn = vi.fn();
  const worker = createRunProcessWorker({
    runState: runStateMock.service,
    loadFn,
    rankFn,
    collectFns: { hn, reddit, web: vi.fn() },
  });

  const result = await worker.handler({
    ...baseJob,
    data: {
      ...baseJob.data,
      sourceTypes: ["hn", "reddit"],
      collectors: {
        hn: { sinceDays: 1 } as unknown as HnCollectConfig,
        reddit: {
          subreddits: ["LocalLLaMA"],
          sinceDays: 1,
        } as unknown as RedditCollectConfig,
      },
    },
  });

  expect(rankFn).not.toHaveBeenCalled();
  expect(loadFn).not.toHaveBeenCalled();
  const last = runStateMock.updates.at(-1);
  expect(last?.status).toBe("failed");
  expect(last?.stage).toBe("failed");
  expect(last?.error).toContain("hn boom");
  expect(last?.error).toContain("reddit boom");
  expect(last?.rankedItems).toBeNull();
  expect(result).toEqual({ rankedCount: 0 });
});
```

- [ ] **Step 9: Add the REQ-016 test (only requested collectors are invoked)**

```ts
it("REQ-016: only invokes collectors whose configs are present in the payload", async () => {
  const runStateMock = makeMockRunState(makeRunState());
  const hn = vi.fn(async () => ({
    itemsFetched: 1,
    itemsStored: 1,
    failures: 0,
    durationMs: 1,
  }));
  const reddit = vi.fn(async () => {
    throw new Error("should not be called");
  });
  const web = vi.fn(async () => {
    throw new Error("should not be called");
  });
  const worker = createRunProcessWorker({
    runState: runStateMock.service,
    loadFn: vi.fn(() => Promise.resolve([])),
    rankFn: vi.fn(),
    collectFns: { hn, reddit, web },
  });

  await worker.handler({
    ...baseJob,
    data: {
      ...baseJob.data,
      sourceTypes: ["hn"],
      collectors: { hn: { sinceDays: 1 } as unknown as HnCollectConfig },
    },
  });

  expect(hn).toHaveBeenCalledOnce();
  expect(reddit).not.toHaveBeenCalled();
  expect(web).not.toHaveBeenCalled();
});
```

- [ ] **Step 10: Add the REQ-017 test (per-source log events)**

```ts
it("REQ-017: emits run.source.completed and run.source.failed logs with required fields", async () => {
  mockLoggerInfo.mockClear();
  mockLoggerError.mockClear();
  const runStateMock = makeMockRunState(makeRunState());
  const hn = vi.fn(async () => ({
    itemsFetched: 7,
    itemsStored: 7,
    failures: 0,
    durationMs: 1,
  }));
  const reddit = vi.fn(async () => {
    throw new Error("reddit blew up");
  });
  const worker = createRunProcessWorker({
    runState: runStateMock.service,
    loadFn: vi.fn(() => Promise.resolve([])),
    rankFn: vi.fn(),
    collectFns: { hn, reddit, web: vi.fn() },
  });

  await worker.handler({
    ...baseJob,
    data: {
      ...baseJob.data,
      sourceTypes: ["hn", "reddit"],
      collectors: {
        hn: { sinceDays: 1 } as unknown as HnCollectConfig,
        reddit: {
          subreddits: ["LocalLLaMA"],
          sinceDays: 1,
        } as unknown as RedditCollectConfig,
      },
    },
  });

  const sourceCompleted = mockLoggerInfo.mock.calls.find(
    (c) => (c[0] as { event?: string }).event === "run.source.completed",
  );
  const sourceFailed = mockLoggerError.mock.calls.find(
    (c) => (c[0] as { event?: string }).event === "run.source.failed",
  );
  expect(sourceCompleted).toBeDefined();
  const completedFields = sourceCompleted?.[0] as {
    runId: string;
    sourceType: string;
    itemsFetched: number;
    durationMs: number;
  };
  expect(completedFields.runId).toBe("run-1");
  expect(completedFields.sourceType).toBe("hn");
  expect(completedFields.itemsFetched).toBe(7);
  expect(typeof completedFields.durationMs).toBe("number");

  expect(sourceFailed).toBeDefined();
  const failedFields = sourceFailed?.[0] as {
    runId: string;
    sourceType: string;
    error: string;
  };
  expect(failedFields.sourceType).toBe("reddit");
  expect(failedFields.error).toBe("reddit blew up");
});
```

- [ ] **Step 11: Run tests — expect ALL new tests to FAIL**

```bash
pnpm --filter @newsletter/pipeline test:unit tests/unit/workers/run-process.test.ts
```

Expected: the 9 new tests (`REQ-004`, `REQ-005`, `REQ-006`, `REQ-007`, `REQ-008`, `REQ-009`, `REQ-010`, `REQ-016`, `REQ-017`) all fail because the handler doesn't implement the collecting stage yet. The existing tests must still pass.

Do **not** commit — we're in the RED phase. Leave the failing tests in place for Task 3.

---

## Task 3: Implement the collecting stage (TDD GREEN)

**Files:**
- Modify: `packages/pipeline/src/workers/run-process.ts` — the `handleRunProcessJob` function

**Goal:** Implement the private `runCollecting` helper and wire it into `handleRunProcessJob` at the very beginning. Preserve the existing dedup/rank flow for the non-empty-candidates path and the "no items collected" empty path. Add the new all-collectors-failed terminal path.

- [ ] **Step 1: Add the `runCollecting` private helper and the `all-failed` terminal state**

In `packages/pipeline/src/workers/run-process.ts`, add this function below `handleRunProcessJob` (or above — file order doesn't matter, as long as `handleRunProcessJob` can reference it):

```ts
interface CollectingOutcome {
  successCount: number;
  failureCount: number;
  errors: string[];
}

async function runCollecting(
  deps: RunProcessDeps,
  runId: string,
  collectors: RunCollectorsPayload,
): Promise<CollectingOutcome> {
  // In-process serializer for state writes: replicates the old
  // `concurrency: 1` invariant from the collection worker. Without this,
  // two near-simultaneous updateSource calls can interleave their
  // read-modify-write cycles on the shared run:{runId} JSON blob and the
  // second writer will clobber the first. If run-state.ts ever becomes
  // atomic internally, this becomes a no-op but stays correct.
  let writeChain: Promise<unknown> = Promise.resolve();
  const writeSerial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = writeChain.then(fn);
    writeChain = next.catch(() => undefined);
    return next;
  };

  const rawItemsRepo = createRawItemsRepo(deps.db);
  const collectorDeps = { rawItemsRepo };

  type SourceKey = "hn" | "reddit" | "blog";
  interface Task {
    sourceKey: SourceKey;
    run: () => Promise<CollectorResult>;
  }

  const tasks: Task[] = [];
  if (collectors.hn) {
    const config = collectors.hn;
    tasks.push({
      sourceKey: "hn",
      run: () => deps.collectFns.hn(collectorDeps, config),
    });
  }
  if (collectors.reddit) {
    const config = collectors.reddit;
    tasks.push({
      sourceKey: "reddit",
      run: () => deps.collectFns.reddit(collectorDeps, config),
    });
  }
  if (collectors.web) {
    const config = collectors.web;
    tasks.push({
      sourceKey: "blog",
      run: () => deps.collectFns.web(collectorDeps, config),
    });
  }

  const errors: string[] = [];
  let successCount = 0;
  let failureCount = 0;

  const runTask = async (task: Task): Promise<void> => {
    const started = Date.now();
    try {
      const result = await task.run();
      await writeSerial(() =>
        deps.runState.updateSource(runId, task.sourceKey, {
          status: "completed",
          itemsFetched: result.itemsStored,
        }),
      );
      logger.info(
        {
          event: "run.source.completed",
          runId,
          sourceType: task.sourceKey,
          itemsFetched: result.itemsStored,
          durationMs: Date.now() - started,
        },
        "run.source.completed",
      );
      successCount += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await writeSerial(() =>
        deps.runState.updateSource(runId, task.sourceKey, {
          status: "failed",
          errors: [message],
        }),
      );
      logger.error(
        {
          event: "run.source.failed",
          runId,
          sourceType: task.sourceKey,
          error: message,
          durationMs: Date.now() - started,
        },
        "run.source.failed",
      );
      errors.push(`${task.sourceKey}: ${message}`);
      failureCount += 1;
    }
  };

  await Promise.all(tasks.map(runTask));

  return { successCount, failureCount, errors };
}
```

- [ ] **Step 2: Wire `runCollecting` into `handleRunProcessJob` as the first stage**

Replace the body of `handleRunProcessJob` (currently starts at line 57) with:

```ts
export async function handleRunProcessJob(
  deps: RunProcessDeps,
  job: RunProcessJobLike,
): Promise<RunProcessResult> {
  if (job.name !== "run-process") {
    throw new Error(`unknown job: ${job.name}`);
  }
  const { runId, topN, sourceTypes, collectors } = job.data;
  const started = Date.now();

  // Stage 1: collecting
  await deps.runState.setStage(runId, "collecting");
  const collecting = await runCollecting(deps, runId, collectors);

  // All collectors failed → terminal failure, skip dedup/rank
  if (collecting.failureCount > 0 && collecting.successCount === 0) {
    const errorMessage = collecting.errors.join("; ");
    await deps.runState.update(runId, (prev) => ({
      ...prev,
      stage: "failed",
      status: "failed",
      error: errorMessage,
      completedAt: new Date().toISOString(),
    }));
    logger.error(
      {
        event: "run.failed",
        runId,
        totalDurationMs: Date.now() - started,
        error: errorMessage,
      },
      "run.failed",
    );
    return { rankedCount: 0 };
  }

  // Stage 2: processing (dedup)
  await deps.runState.setStage(runId, "processing");

  const state = await deps.runState.get(runId);
  let since: Date;
  if (state?.startedAt) {
    since = new Date(state.startedAt);
  } else {
    since = new Date(Date.now() - 10 * 60 * 1000);
    logger.warn(
      { runId },
      "run-state missing; using 10-minute fallback window",
    );
  }

  const raw: Candidate[] = await deps.loadFn(
    deps.db,
    since,
    sourceTypes as SourceType[],
  );

  if (raw.length === 0) {
    await deps.runState.update(runId, (prev) => ({
      ...prev,
      stage: "completed",
      status: "completed",
      rankedItems: [],
      completedAt: new Date().toISOString(),
      warnings: [...prev.warnings, "no items collected"],
    }));
    logger.info(
      {
        event: "run.completed",
        runId,
        totalDurationMs: Date.now() - started,
        rankedItemCount: 0,
      },
      "run.completed",
    );
    return { rankedCount: 0 };
  }

  const rankCandidatesInput: RankCandidate[] = raw.map((c) => ({
    id: c.id,
    url: c.url,
    engagement: c.engagement,
    title: c.title,
    sourceType: c.sourceType,
    publishedAt: c.publishedAt ? c.publishedAt.toISOString() : null,
  }));

  const deduped = dedupCandidates(rankCandidatesInput);
  logger.info(
    {
      event: "run.dedup",
      runId,
      inputCount: raw.length,
      outputCount: deduped.length,
    },
    "run.dedup",
  );

  // Stage 3: ranking
  await deps.runState.setStage(runId, "ranking");

  let rankResult: RankResult;
  try {
    rankResult = await deps.rankFn(deduped, { topN, runId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.runState.update(runId, (prev) => ({
      ...prev,
      stage: "failed",
      status: "failed",
      error: message,
      completedAt: new Date().toISOString(),
    }));
    throw err;
  }

  await deps.runState.update(runId, (prev) => ({
    ...prev,
    stage: "completed",
    status: "completed",
    rankedItems: rankResult.rankedItems,
    completedAt: new Date().toISOString(),
  }));

  logger.info(
    {
      event: "run.completed",
      runId,
      totalDurationMs: Date.now() - started,
      rankedItemCount: rankResult.rankedItems.length,
    },
    "run.completed",
  );

  return { rankedCount: rankResult.rankedItems.length };
}
```

**Key preservations:**
- `"no items collected"` warning text is kept verbatim (REQ-011, EDGE-005).
- The existing null run-state fallback (10-minute window) is kept for EDGE-013.
- Rank-throws error path is kept identical for REQ-011 / existing failed-rank test.
- Dedup log event (`run.dedup`) is kept identical for existing log assertion test.

- [ ] **Step 3: Run the full pipeline unit test suite — all tests must now pass**

```bash
pnpm --filter @newsletter/pipeline test:unit tests/unit/workers/run-process.test.ts
```

Expected: all tests green — the 9 new REQ/EDGE tests from Task 2 plus all pre-existing tests (empty-candidates, null-state fallback, startedAt-window, rank-throws, happy path, logs, unknown-job).

If the race test (REQ-008) does not pass, the `writeSerial` chain is not being used in the right places — verify every `updateSource` call inside `runTask` is wrapped.

If the progressive-update test (REQ-006) does not pass, `runTask` is awaiting incorrectly — it must update state inside its own `.then`/`async` body, not after `Promise.all`.

- [ ] **Step 4: Run typecheck and lint**

```bash
pnpm typecheck
pnpm lint
```

Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add packages/pipeline/src/workers/run-process.ts packages/pipeline/tests/unit/workers/run-process.test.ts
git commit -m "feat(VER): add in-process collecting stage to run-process worker

- Adds runCollecting helper that dispatches requested collectors via
  Promise.all with per-task try/catch
- Serializes per-source state writes via in-process writeSerial chain
  to prevent read-modify-write clobber (REQ-008, EDGE-002)
- Emits progressive per-source completion updates so the frontend poll
  sees sources flip as each collector finishes (REQ-006)
- Handles all-collectors-failed terminal state with aggregated error
  message and skips dedup/rank (REQ-010)
- Emits run.source.completed / run.source.failed log events matching
  the previous collection worker's shape (REQ-017)
- Preserves existing empty-candidates, rank-throws, and null-state
  fallback paths verbatim"
```

---

## Task 4: Update runs-service tests (TDD RED for API changes)

**Files:**
- Modify: `packages/api/tests/unit/runs-service.test.ts`

**Goal:** Rewrite the existing FlowProducer-based tests to assert the new single-job shape (REQ-001, REQ-002, REQ-003). These tests should fail against the current `createRun` implementation, which still uses FlowProducer.

- [ ] **Step 1: Replace the FlowProducer mock with a Queue mock and rewrite the tests**

Replace the entire contents of `packages/api/tests/unit/runs-service.test.ts` with:

```ts
import { describe, it, expect, vi } from "vitest";
import type IORedis from "ioredis";
import type { Queue, JobsOptions } from "bullmq";
import type { RunState, RunSubmitPayload } from "@newsletter/shared";
import { createRun } from "@api/services/runs.js";

interface MockRedis {
  store: Map<string, { value: string; ttl: number }>;
  set: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
}

function makeRedis(): MockRedis {
  const store = new Map<string, { value: string; ttl: number }>();
  const set = vi.fn(
    (key: string, value: string, _mode: string, ttl: number) => {
      store.set(key, { value, ttl });
      return Promise.resolve("OK");
    },
  );
  const get = vi.fn((key: string) =>
    Promise.resolve(store.get(key)?.value ?? null),
  );
  return { store, set, get };
}

interface AddCall {
  name: string;
  data: Record<string, unknown>;
  opts?: JobsOptions;
}

function makeQueue(): { add: ReturnType<typeof vi.fn>; queue: Queue } {
  const calls: AddCall[] = [];
  const add = vi.fn(
    (name: string, data: Record<string, unknown>, opts?: JobsOptions) => {
      calls.push({ name, data, opts });
      return Promise.resolve({ id: opts?.jobId ?? "generated-id" });
    },
  );
  const queue = { add, name: "processing" } as unknown as Queue;
  return { add, queue };
}

const basePayload: RunSubmitPayload = {
  topN: 10,
  hn: { sinceDays: 1 },
  reddit: { subreddits: ["LocalLLaMA"], sinceDays: 1 },
};

describe("createRun — single-job shape", () => {
  it("seeds Redis run-state with status running and stage queued", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    const { runId } = await createRun(
      basePayload,
      redis as unknown as IORedis,
      q.queue,
    );

    expect(runId).toMatch(/^[0-9a-f-]{36}$/);
    const entry = redis.store.get(`run:${runId}`);
    if (!entry) throw new Error("expected redis entry to exist");
    expect(entry.ttl).toBe(3600);

    const state = JSON.parse(entry.value) as RunState;
    expect(state.id).toBe(runId);
    expect(state.status).toBe("running");
    expect(state.stage).toBe("queued");
    expect(state.topN).toBe(10);
    expect(state.sources.hn).toEqual({
      status: "pending",
      itemsFetched: 0,
      errors: [],
    });
    expect(state.sources.reddit).toEqual({
      status: "pending",
      itemsFetched: 0,
      errors: [],
    });
    expect(state.rankedItems).toBeNull();
  });

  it("REQ-001: enqueues exactly one run-process job on the processing queue", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    await createRun(basePayload, redis as unknown as IORedis, q.queue);

    expect(q.add).toHaveBeenCalledTimes(1);
    const [name] = q.add.mock.calls[0] ?? [];
    expect(name).toBe("run-process");
  });

  it("REQ-002: sets job id equal to runId", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    const { runId } = await createRun(
      basePayload,
      redis as unknown as IORedis,
      q.queue,
    );

    const [, , opts] = q.add.mock.calls[0] ?? [];
    expect((opts as JobsOptions | undefined)?.jobId).toBe(runId);
  });

  it("REQ-003: carries collector configs keyed by source for requested sources only", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    await createRun(basePayload, redis as unknown as IORedis, q.queue);

    const [, data] = q.add.mock.calls[0] ?? [];
    const payload = data as {
      runId: string;
      topN: number;
      sourceTypes: string[];
      collectors: Record<string, unknown>;
    };
    expect(payload.collectors).toEqual({
      hn: { sinceDays: 1 },
      reddit: { subreddits: ["LocalLLaMA"], sinceDays: 1 },
    });
    expect(payload.collectors).not.toHaveProperty("web");
    expect(payload.sourceTypes.sort()).toEqual(["hn", "reddit"]);
    expect(payload.topN).toBe(10);
  });

  it("only enqueues hn collector when reddit and web are omitted", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    await createRun(
      { topN: 5, hn: { sinceDays: 1 } },
      redis as unknown as IORedis,
      q.queue,
    );

    const [, data] = q.add.mock.calls[0] ?? [];
    const payload = data as {
      sourceTypes: string[];
      collectors: Record<string, unknown>;
    };
    expect(payload.collectors).toEqual({ hn: { sinceDays: 1 } });
    expect(payload.sourceTypes).toEqual(["hn"]);
  });

  it("seeds sources.blog and includes web config when payload.web is set", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    const webPayload: RunSubmitPayload = {
      topN: 5,
      web: {
        sources: [
          { name: "Anthropic", listingUrl: "https://www.anthropic.com/research" },
        ],
        maxItems: 3,
        sinceDays: 7,
      },
    };
    const { runId } = await createRun(
      webPayload,
      redis as unknown as IORedis,
      q.queue,
    );

    const entry = redis.store.get(`run:${runId}`);
    if (!entry) throw new Error("expected redis entry to exist");
    const state = JSON.parse(entry.value) as RunState;
    expect(state.sources.blog).toEqual({
      status: "pending",
      itemsFetched: 0,
      errors: [],
    });

    const [, data] = q.add.mock.calls[0] ?? [];
    const payload = data as {
      sourceTypes: string[];
      collectors: { web?: unknown };
    };
    expect(payload.sourceTypes).toEqual(["blog"]);
    expect(payload.collectors.web).toEqual({
      sources: [
        { name: "Anthropic", listingUrl: "https://www.anthropic.com/research" },
      ],
      maxItems: 3,
      sinceDays: 7,
    });
  });
});
```

- [ ] **Step 2: Run the test — expected FAIL (TypeScript will complain that `createRun` expects `FlowProducer`, not `Queue`)**

```bash
pnpm --filter @newsletter/api test:unit tests/unit/runs-service.test.ts
```

Expected: compile error on the `createRun(..., q.queue)` call site because `createRun` still takes a `FlowProducer`. This is the RED signal — leave it as-is and fix in Task 5.

Do **not** commit yet.

---

## Task 5: Rewrite createRun to use Queue + jobId (TDD GREEN for API)

**Files:**
- Modify: `packages/api/src/services/runs.ts`

**Goal:** Replace the `FlowProducer` with a direct `Queue.add` on the `"processing"` queue. Include the new `collectors` payload and set `jobId: runId` for idempotency.

- [ ] **Step 1: Replace the contents of `packages/api/src/services/runs.ts`**

```ts
import { randomUUID } from "node:crypto";
import type IORedis from "ioredis";
import { Queue } from "bullmq";
import { createRedisConnection } from "@newsletter/shared";
import type { RunState, RunSubmitPayload } from "@newsletter/shared";

const TTL_SECONDS = 3600;

export interface CreatedRun {
  runId: string;
}

let defaultQueue: Queue | null = null;

function getDefaultProcessingQueue(): Queue {
  defaultQueue ??= new Queue("processing", {
    connection: createRedisConnection(),
  });
  return defaultQueue;
}

interface RunProcessJobPayload {
  runId: string;
  topN: number;
  sourceTypes: ("hn" | "reddit" | "blog")[];
  collectors: {
    hn?: RunSubmitPayload["hn"];
    reddit?: RunSubmitPayload["reddit"];
    web?: RunSubmitPayload["web"];
  };
}

export async function createRun(
  payload: RunSubmitPayload,
  redis: IORedis = createRedisConnection(),
  processingQueue: Queue = getDefaultProcessingQueue(),
): Promise<CreatedRun> {
  const runId = randomUUID();
  const now = new Date().toISOString();
  const sources: RunState["sources"] = {};
  if (payload.hn) {
    sources.hn = { status: "pending", itemsFetched: 0, errors: [] };
  }
  if (payload.reddit) {
    sources.reddit = { status: "pending", itemsFetched: 0, errors: [] };
  }
  if (payload.web) {
    sources.blog = { status: "pending", itemsFetched: 0, errors: [] };
  }

  const initial: RunState = {
    id: runId,
    status: "running",
    stage: "queued",
    topN: payload.topN,
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    sources,
    rankedItems: null,
    warnings: [],
    error: null,
  };

  await redis.set(`run:${runId}`, JSON.stringify(initial), "EX", TTL_SECONDS);

  const sourceTypes: ("hn" | "reddit" | "blog")[] = [];
  const collectors: RunProcessJobPayload["collectors"] = {};
  if (payload.hn) {
    sourceTypes.push("hn");
    collectors.hn = payload.hn;
  }
  if (payload.reddit) {
    sourceTypes.push("reddit");
    collectors.reddit = payload.reddit;
  }
  if (payload.web) {
    sourceTypes.push("blog");
    collectors.web = payload.web;
  }

  const jobPayload: RunProcessJobPayload = {
    runId,
    topN: payload.topN,
    sourceTypes,
    collectors,
  };

  await processingQueue.add("run-process", jobPayload, { jobId: runId });

  return { runId };
}
```

**Key changes:**
- `FlowProducer` import and parameter replaced by `Queue`.
- Default queue is lazily constructed once, same pattern as the old `getFlowProducer`.
- `collectors` is built alongside `sourceTypes` from the same branching — no double-walking.
- `jobId: runId` on the `add` call — REQ-002 idempotency.
- Initial Redis state payload is byte-identical to before (REQ-012).
- `packages/api/src/lib/flow.ts` is now unused by `runs.ts` but left untouched (rollback safety, deleted in a follow-up PR).

- [ ] **Step 2: Run the runs-service unit test — expect GREEN**

```bash
pnpm --filter @newsletter/api test:unit tests/unit/runs-service.test.ts
```

Expected: all 6 tests in the file pass.

- [ ] **Step 3: Run typecheck across the monorepo**

```bash
pnpm typecheck
```

Expected: CLEAN. If the API package fails because other tests (runs-route.test.ts, runs.e2e.test.ts) still pass `FlowProducer` into `createRun`, that's expected — Task 6 fixes them.

If typecheck fails outside of the expected test files, stop and investigate.

- [ ] **Step 4: Do not commit yet — Task 6 updates the rest of the test harness**

---

## Task 6: Update runs-route and API e2e test harness

**Files:**
- Modify: `packages/api/tests/unit/runs-route.test.ts`
- Modify: `packages/api/tests/e2e/runs.e2e.test.ts`

**Goal:** Replace every `makeFlowProducer()` helper with a `makeQueue()` helper and pass the queue into `createRun` / the Hono app builder. The assertion logic in these tests was about "a job was enqueued" — it still applies, just against `queue.add` instead of `flow.add`.

- [ ] **Step 1: Check where `createRun` is called from the route**

Read `packages/api/src/routes/runs.ts` and `packages/api/src/lib/app.ts` (or wherever the Hono app is built) to confirm the DI surface that tests use. The tests call `buildApp({ flow, redis, db, ... })` or similar — find the exact option name and what it takes. Then rename `flow` → `processingQueue` (or whatever matches the route's DI shape) throughout those test files.

Run:
```bash
grep -n "flowProducer\|getFlowProducer\|FlowProducer" packages/api/src/routes packages/api/src/lib packages/api/src/services
```

Any results in `src/` (not `src/lib/flow.ts` itself) indicate a call site that also needs updating. Update them to accept a `Queue` instead of a `FlowProducer` and pass it through to `createRun`.

- [ ] **Step 2: Replace the `makeFlowProducer` helper in `runs-route.test.ts`**

In `packages/api/tests/unit/runs-route.test.ts`, replace the `makeFlowProducer` helper (around line 38) with:

```ts
function makeQueue(): {
  add: ReturnType<typeof vi.fn>;
  queue: unknown;
} {
  const add = vi.fn(
    (name: string, _data: unknown, opts?: { jobId?: string }) =>
      Promise.resolve({ id: opts?.jobId ?? `job-${name}` }),
  );
  const queue = { add, name: "processing" };
  return { add, queue };
}
```

Then find every call site that uses `makeFlowProducer()` (search within the file) and replace it with `makeQueue()`. Update variable names from `flow` → `q`. Update the option passed into `makeApp` — if the current option is `flowProducer`, change it to whatever the new `runs.ts` uses (e.g. `processingQueue`). Align with the route code from Step 1.

For assertions that looked at `flow.add.mock.calls[0][0].children`, rewrite them to inspect `q.add.mock.calls[0]` — the first element is the job name, the second is the data, the third is options. There are no children to inspect; instead, assert on `data.collectors` and `data.sourceTypes`.

- [ ] **Step 3: Do the same replacement in `runs.e2e.test.ts`**

Apply the same pattern to `packages/api/tests/e2e/runs.e2e.test.ts`. The e2e file uses `createRedisConnection` against a real Redis but still mocks the job sink (per the file comment at line 2). Replace `makeFlowProducer` with `makeQueue` and adjust `buildApp({ flow })` calls accordingly.

- [ ] **Step 4: Run the full API unit + e2e suite and fix any drift**

```bash
pnpm --filter @newsletter/api test:unit
```

Expected: all tests pass. If any test is still asserting on `children` or `flow.add`, it was missed — fix it.

```bash
pnpm --filter @newsletter/api test:e2e 2>&1 | tail -40
```

E2E tests require Redis/Postgres to be up (`pnpm infra:up`). If the e2e suite can't run locally, note it and move on — the quality gate will catch issues. Do not skip unit tests.

- [ ] **Step 5: Run typecheck and lint across the monorepo**

```bash
pnpm typecheck
pnpm lint
```

Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/services/runs.ts \
        packages/api/src/routes/runs.ts \
        packages/api/src/lib/app.ts \
        packages/api/tests/unit/runs-service.test.ts \
        packages/api/tests/unit/runs-route.test.ts \
        packages/api/tests/e2e/runs.e2e.test.ts
git commit -m "feat(VER): replace FlowProducer with Queue.add in createRun

- createRun now enqueues a single run-process job on the processing queue
  with jobId: runId for idempotent double-submit protection (REQ-001, REQ-002)
- Job data carries the collectors payload keyed by source type (REQ-003)
- Initial Redis run-state shape is unchanged (REQ-012)
- API route and test harness updated to inject a Queue instead of a
  FlowProducer; lib/flow.ts is left in place for rollback"
```

Only stage the files listed above that you actually modified. If `packages/api/src/routes/runs.ts` or `src/lib/app.ts` didn't need changes (because the Hono app already passes the dep transparently), omit them from the commit.

---

## Task 7: Update pipeline e2e tests for the single-job shape

**Files:**
- Modify: `packages/pipeline/tests/e2e/run-flow.e2e.test.ts`
- Modify: `packages/pipeline/tests/e2e/workers/run-process.e2e.test.ts`

**Goal:** The existing `run-flow.e2e.test.ts` exercises the old FlowProducer + collection worker + run-process parent flow. It uses fake collection workers and a real FlowProducer to assert fan-in/fan-out barrier semantics. Under the new architecture the run-process worker owns the whole flow, so these tests must be rewritten to enqueue a single `run-process` job with injected fake `collectFns` and assert the same end-to-end behavior (happy path, all-fail, partial-fail).

This task is scoped to test files only.

- [ ] **Step 1: Read the existing `run-flow.e2e.test.ts` end to end**

```bash
wc -l packages/pipeline/tests/e2e/run-flow.e2e.test.ts
```

Read all 413 lines. Identify the three existing `it` blocks (around lines 294, 342, 387) and the `seedRunState` helper. You'll keep the helper and the three scenario names but rewire how jobs are enqueued.

- [ ] **Step 2: Rewrite `run-flow.e2e.test.ts` to use a direct processing-queue enqueue with fake collectFns**

The shape of the change:
- Remove the `FlowProducer` import and instance.
- Remove the fake collection worker (the one that consumes from `COLLECT_QUEUE`).
- Keep the real `run-process` worker instance, but construct it with `collectFns` that return deterministic fake results or throw on demand, matching the `mode` field in the original children payloads (`"seed-hn"`, `"seed-reddit"`, `"fail"`, etc.).
- Replace each `flowProducer.add({ name: "run-process", ..., children: [...] })` with `processingQueue.add("run-process", { runId, topN: 3, sourceTypes, collectors }, { jobId: runId })`.
- Adjust assertions that checked for collection-queue-level behavior (there are none critical — the assertions are all on the final `runState` and `raw_items`).

Example of the happy-path rewrite (replace lines 294-340):

```ts
it("REQ-001/REQ-005: full single-job flow completes with HN+Reddit", { timeout: 60000 }, async () => {
  const runId = "run-flow-e2e-happy";
  await seedRunState(runId, 3);

  await processingQueue.add(
    "run-process",
    {
      runId,
      topN: 3,
      sourceTypes: ["hn", "reddit"],
      collectors: {
        hn: { sinceDays: 1 },
        reddit: { subreddits: ["LocalLLaMA"], sinceDays: 1 },
      },
    },
    { jobId: runId },
  );

  // ... rest of the assertions (pollUntilTerminal, expect final.status, etc.) stay identical
});
```

Where does `processingQueue` come from? Add it to `beforeAll`:
```ts
processingQueue = new Queue(PROCESS_QUEUE, { connection });
```

And close it in `afterAll` alongside the workers.

Where do the fake collectFns come from? Inject them when constructing the `run-process` worker. The existing test either spins up a worker via `createRunProcessWorker` or mocks it — locate the construction site and add `collectFns: { hn: fakeHn, reddit: fakeReddit, web: fakeWeb }` to the options. Each fake reads the scenario name from a closure variable (`"happy"`, `"allfail"`, `"mixed"`) and returns or throws accordingly.

- [ ] **Step 3: Apply the same single-job enqueue to the all-fail and mixed scenarios**

The two other `it` blocks at lines 342 and 387 follow the same pattern. Replace their `flowProducer.add({ ... children: [...] })` calls with `processingQueue.add("run-process", ...)` and make the fake collectFns throw for the failing sources.

- [ ] **Step 4: Update `packages/pipeline/tests/e2e/workers/run-process.e2e.test.ts`**

Read this file. It's 186 lines and tests `run-process` against a real Redis. Any test that enqueues a run-process job with the old `{ runId, topN, sourceTypes }` payload needs to be updated to include `collectors: {}` (empty, since that file tests the post-collecting dedup/rank path exclusively). If the file already inserts raw_items directly and then enqueues a no-collectors run-process job, `collectors: {}` is the right value. The handler will see zero tasks, `successCount: 0, failureCount: 0`, and fall through to the existing dedup/rank path with the pre-seeded raw_items.

**Edge case:** the all-failed terminal state (`failureCount > 0 && successCount === 0`) must NOT fire when `collectors` is empty — that's the "no collectors requested" case, not the "all collectors failed" case. Verify the implementation in Task 3 Step 1 handles this correctly. Re-read the condition: `if (collecting.failureCount > 0 && collecting.successCount === 0)` — with an empty tasks list, both counts are 0, so the condition is false and we proceed to dedup/rank. ✓

- [ ] **Step 5: Run the pipeline unit suite to confirm nothing regressed, then typecheck + lint**

```bash
pnpm --filter @newsletter/pipeline test:unit
pnpm typecheck
pnpm lint
```

Expected: all green.

- [ ] **Step 6: Run the pipeline e2e suite if infrastructure is available**

```bash
pnpm infra:up
pnpm --filter @newsletter/pipeline test:e2e 2>&1 | tail -80
```

Expected: all e2e scenarios pass. If infra is not available, note it — the quality gate stage will rerun these.

- [ ] **Step 7: Commit**

```bash
git add packages/pipeline/tests/e2e/run-flow.e2e.test.ts \
        packages/pipeline/tests/e2e/workers/run-process.e2e.test.ts
git commit -m "test(VER): update pipeline e2e tests for single-job run shape

- run-flow.e2e.test.ts now enqueues a single run-process job with
  injected fake collectFns instead of a FlowProducer tree with a fake
  collection worker
- run-process.e2e.test.ts job payloads include the new collectors
  field (empty when the test pre-seeds raw_items directly)"
```

---

## Task 8: Final verification and spec traceability

**Files:** none (verification only)

**Goal:** Run every check and confirm each SPEC requirement is covered by a test in the suite.

- [ ] **Step 1: Run the full monorepo gate**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
```

All three must be clean. If any fails, fix it before proceeding.

- [ ] **Step 2: Verify no forbidden files were touched**

```bash
git diff --name-only main... | sort
```

Expected list (code files) — nothing outside:
- `packages/pipeline/src/workers/run-process.ts`
- `packages/api/src/services/runs.ts`
- (optionally) `packages/api/src/routes/runs.ts` or `src/lib/app.ts` if the DI surface changed
- test files: `runs-service.test.ts`, `runs-route.test.ts`, `runs.e2e.test.ts`, `run-process.test.ts`, `run-flow.e2e.test.ts`, `run-process.e2e.test.ts`
- spec/plan/phase docs under `docs/spec/run-as-single-parallel-job/` and `docs/plans/`

Forbidden paths that must NOT appear in the diff:
- `packages/pipeline/src/services/run-state.ts`
- `packages/pipeline/src/collectors/*`
- `packages/pipeline/src/processors/dedup.ts`, `rank.ts`
- `packages/pipeline/src/services/candidate-loader.ts`
- `packages/pipeline/src/workers/collection.ts`
- `packages/api/src/lib/flow.ts`

- [ ] **Step 3: Confirm zero new src files were created**

```bash
git diff --name-status main... -- 'packages/*/src/*' | grep '^A' || echo "no new src files"
```

Expected: `no new src files`.

- [ ] **Step 4: Spec coverage spot-check**

Re-read the Verification Matrix in `docs/spec/run-as-single-parallel-job/spec.md`. For each "Yes" in the "Unit Test" column, confirm a corresponding test exists in the file listed in the "Notes" column.

If any REQ is missing a test, add one now and go back to Task 2/Task 4 pattern.

- [ ] **Step 5: No separate commit — Phase 1 is complete**

The final commit from Task 7 is the last commit of this phase. Do not create an empty verification commit.

---

## Phase 1 Complete

Hand back to the orchestrator with a phase summary:

- Files modified: 2 src files + 6 test files + 3 docs files
- Tests added: 9 new unit tests for the collecting stage + rewritten API runs-service tests + updated e2e tests
- Key behaviors verified: parallel dispatch, progressive state updates, race serialization, partial success, all-fail terminal state, per-source logs, idempotent enqueue
- Forbidden files: none modified
- Known gaps (if any): note whatever couldn't be verified locally (e.g., e2e requiring infra)
