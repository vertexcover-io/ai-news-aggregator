# SPEC: Run as a Single Parallel Job

**Source:** `docs/plans/2026-04-08-run-as-single-parallel-job-design.md`
**Generated:** 2026-04-08

## Context

Today, a run submitted from the web UI enqueues a BullMQ `FlowProducer` tree: one parent `run-process` job plus one `*-collect` child per source. Children are drained sequentially by a `collection` worker running at concurrency 1, so collectors execute one after the other even though the flow fans out correctly.

This spec defines the behavior of a refactor that collapses the run into a **single BullMQ job** whose handler runs the requested collectors concurrently in-process, then proceeds through the existing dedup and rank stages. The goals are: real parallelism, safety under concurrency, progressive per-source status updates visible to the polling frontend, and zero disruption to the API contract or Redis state schema.

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Event-driven | When a run is submitted via `POST /api/runs` with a payload containing one or more source configs, the system shall enqueue exactly one BullMQ job on the `processing` queue. | BullMQ `processing` queue contains 1 job with `name = "run-process"`; `collection` queue contains 0 new jobs for this run; no `FlowProducer` call is made. | Must |
| REQ-002 | Event-driven | When enqueueing the run-process job, the system shall set its BullMQ `jobId` equal to the `runId`. | Inspecting the enqueued job returns `job.id === runId`; a second `createRun` call with the same `runId` does not add a second job to the queue. | Must |
| REQ-003 | Ubiquitous | The run-process job payload shall carry the collector configurations (`hn`, `reddit`, `web`) for whichever sources were requested. | `job.data.collectors` is a record containing exactly the keys present in the submitted payload; absent sources are absent from the record (not `null` or `undefined` entries). | Must |
| REQ-004 | Event-driven | When the run-process job starts, the system shall set the run stage to `collecting` before invoking any collector. | `runState.get(runId).stage === "collecting"` is observable before the first collector call, verified via a spy on `runState.setStage`. | Must |
| REQ-005 | State-driven | While in the `collecting` stage, the system shall invoke all requested collectors concurrently in the same Node process. | Using controlled deferred collectors, the start times of each collector overlap — every collector's `start` callback fires before any collector's `resolve` is called. | Must |
| REQ-006 | Event-driven | When a collector resolves successfully, the system shall update the corresponding source state to `status: "completed"` with the returned `itemsFetched` count before any other collector has finished. | Using a fast HN collector (resolves at t=10ms) and a slow Reddit collector (resolves at t=200ms), a `runState.get(runId)` call at t=50ms returns `sources.hn.status === "completed"` and `sources.reddit.status === "running"`. | Must |
| REQ-007 | Event-driven | When a collector rejects, the system shall update the corresponding source state to `status: "failed"` with the error message in `errors`, and the system shall continue running the remaining collectors. | With an HN collector that throws `Error("boom")` and a Reddit collector that resolves normally, the final state has `sources.hn.status === "failed"`, `sources.hn.errors` includes `"boom"`, and `sources.reddit.status === "completed"`. | Must |
| REQ-008 | Ubiquitous | The collecting stage shall serialize all state writes from collector completion callbacks through an in-process promise chain. | Two fake collectors that resolve in the same microtask tick produce a final state where both sources are marked `completed` (no lost update). | Must |
| REQ-009 | Event-driven | When all requested collectors have settled and at least one succeeded, the system shall set the run stage to `processing` and proceed to dedup. | `runState.setStage(runId, "processing")` is called exactly once after every collector has settled and before `loadCandidatesSince` is invoked. | Must |
| REQ-010 | Unwanted | If every requested collector fails, then the system shall mark the run as `status: "failed"` with an aggregated error message, skip dedup and ranking, and complete the job. | With all collectors throwing, the final `runState` has `status: "failed"`, `stage: "failed"`, `rankedItems: null`, and `rankFn` is never called. | Must |
| REQ-011 | Event-driven | When dedup and ranking complete successfully, the system shall update the run to `status: "completed"`, `stage: "completed"`, and populate `rankedItems`. | Final `runState` matches existing behavior for successful runs: `status === "completed"`, `rankedItems.length <= topN`, `completedAt` set to an ISO timestamp. | Must |
| REQ-012 | Ubiquitous | The system shall preserve the existing `GET /api/runs/:runId` response shape and the existing Redis `run:{runId}` JSON schema. | Snapshot test of the response body for a completed run matches the pre-refactor shape; no keys added, removed, or renamed in `RunState`. | Must |
| REQ-013 | Ubiquitous | The system shall not create any new source files outside of the two files being modified (`packages/api/src/services/runs.ts` and `packages/pipeline/src/workers/run-process.ts`). | `git diff --name-status` for the change lists zero new files under `packages/**/src/`; only modified files. | Must |
| REQ-014 | Ubiquitous | The system shall not modify `packages/pipeline/src/services/run-state.ts`, any collector file, `dedup.ts`, `rank.ts`, or `candidate-loader.ts`. | `git diff` shows zero changes in these files. | Must |
| REQ-015 | Ubiquitous | The run-process worker shall expose the collector functions via `RunProcessDeps` so tests can inject fakes. | `createRunProcessWorker` accepts a `collectFns` option; `RunProcessDeps` interface includes `collectFns: { hn, reddit, web }`; existing `loadFn` and `rankFn` injection points remain unchanged. | Must |
| REQ-016 | Event-driven | When only a subset of sources is requested (e.g. only `hn`), the system shall invoke only those collectors and not instantiate or call unrequested collectors. | Using fake `collectFns` where `reddit` and `web` throw if called, a run submitted with only `hn` completes successfully and the reddit/web fakes are never invoked. | Must |
| REQ-017 | Ubiquitous | The system shall log a per-source completion event (`run.source.completed` or `run.source.failed`) with `runId`, `sourceType`, `itemsFetched` (on success), and `durationMs`, equivalent to the current collection worker log output. | Log spy captures one `run.source.completed` entry per successful collector and one `run.source.failed` entry per failed collector, each with the required structured fields. | Should |
| REQ-018 | Ubiquitous | The `collection` queue and worker shall remain in the codebase unchanged for this PR but shall not receive any new jobs. | `collection.ts` worker file is unmodified; BullMQ `collection` queue size stays at 0 for new runs submitted after the deploy. | Should |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | Two concurrent `createRun` calls produce the same `runId` (e.g. client double-click, BullMQ stall redelivery). | BullMQ deduplicates on `jobId`; exactly one `run-process` job exists in the queue; only one worker instance ever executes the handler for that run. | REQ-002 |
| EDGE-002 | A fast collector and a slow collector resolve such that the slow one's `.then` microtask enters the `run-state` read-modify-write cycle while the fast one is mid-update. | The promise-chain serializer orders the writes; the final state contains both sources' completion, neither clobbered. | REQ-008 |
| EDGE-003 | Collector throws synchronously before its first `await` (e.g. invalid config at the top of the function). | The synchronous throw is caught by the task wrapper's `try/catch`; source is marked `failed` with the error message; other collectors continue. | REQ-007 |
| EDGE-004 | Collector resolves with `itemsStored: 0` (fetched but found nothing new). | Source is marked `completed` with `itemsFetched: 0`; run proceeds to dedup/rank; if no other source contributed items either, the all-empty path (existing behavior) runs. | REQ-006 |
| EDGE-005 | All collectors resolve with `itemsStored: 0` — all succeed but no items collected. | Run completes with `status: "completed"`, `rankedItems: []`, and a `"no items collected"` warning — preserving existing run-process behavior for empty candidate sets. | REQ-011 |
| EDGE-006 | Ranking (`rankFn`) throws after all collectors succeeded. | Run is marked `status: "failed"`, `stage: "failed"`, `error` populated; source states remain `completed` (items were collected; only ranking failed). | REQ-011 |
| EDGE-007 | BullMQ redelivers the run-process job after partial execution (worker crash mid-run). | Since `jobId === runId`, no duplicate concurrent handler runs; on redelivery, collectors re-execute from scratch but their DB upserts are idempotent; dedup+rank runs over the same raw_items; final state is identical to a single successful execution. | REQ-002, REQ-008 |
| EDGE-008 | A collector that internally exhausts its retry ladder (2+ minutes of backoff) stalls the collecting stage. | `Promise.all` waits for the slowest task; overall stage stays `collecting` until the slow collector settles; fast collectors' sources are already `completed` in state (visible to poll); no outer timeout is enforced in this PR. | REQ-005, REQ-006 |
| EDGE-009 | Run submitted with zero source configs. | API-layer zod validation rejects the request with a 4xx before `createRun` runs; no job is enqueued. | REQ-001 |
| EDGE-010 | Partial DB commit inside a collector (e.g. HN upserts items 1-49, then item 50 throws). | Collector rejects; HN source marked `failed`; items 1-49 remain in `raw_items` and will be picked up by `loadCandidatesSince` and ranked. (Pre-existing behavior, not introduced by this refactor; documented for clarity.) | REQ-007 |
| EDGE-011 | Frontend polls `GET /api/runs/:runId` during the collecting stage at intervals of 1s. | Each poll returns a `RunState` whose `sources` reflects the most recent per-source status (e.g. `hn: completed`, `reddit: running`, `web: running`). `stage` remains `collecting` until all settle. | REQ-006, REQ-012 |
| EDGE-012 | Deploy lands while a FlowProducer-based run is already in flight. | The old flow parent waits for child jobs that the new API no longer enqueues; the old run eventually stalls and BullMQ marks it failed after its stall timeout. Operational mitigation: drain queues before deploy. | REQ-018 |
| EDGE-013 | One collector succeeds with items, another collector fails. | Run proceeds to dedup/rank with the successful collector's items; failed source is visibly `failed` in final state; `rankedItems` is populated from the surviving candidates. | REQ-007, REQ-009 |

## Verification Matrix

| ID | Unit Test | Integration Test | Manual Test | Notes |
|--------|-----------|-----------------|-------------|-------|
| REQ-001 | Yes | Yes | No | Unit: `runs-service.test.ts` asserts queue state via mock. Integration: e2e submits a run and inspects Redis queue. |
| REQ-002 | Yes | Yes | No | Unit: assert `jobId` on the enqueue call. Integration: second `createRun` with same runId does not duplicate. |
| REQ-003 | Yes | No | No | `runs-service.test.ts` asserts `job.data.collectors` shape. |
| REQ-004 | Yes | No | No | `run-process.test.ts` spies on `runState.setStage`. |
| REQ-005 | Yes | No | No | `run-process.test.ts` with controlled deferreds verifies concurrent start. |
| REQ-006 | Yes | No | Yes | Unit: fast/slow fake collectors. Manual: submit real run and watch frontend flip sources one by one. |
| REQ-007 | Yes | No | No | `run-process.test.ts` with throwing fake collector. |
| REQ-008 | Yes | No | No | Two collectors resolving in the same microtask tick — critical race test. |
| REQ-009 | Yes | No | No | Spy on `setStage` order. |
| REQ-010 | Yes | No | No | All fakes throw; assert rank never called and run failed. |
| REQ-011 | Yes | Yes | No | Unit: happy path. Integration: existing e2e still passes with shape unchanged. |
| REQ-012 | Yes | Yes | No | Snapshot test of response body. |
| REQ-013 | No | No | Yes | Reviewer checks `git diff --name-status` during PR review. |
| REQ-014 | No | No | Yes | Reviewer checks `git diff` for untouched files. |
| REQ-015 | Yes | No | No | TypeScript compile + test construction of `RunProcessDeps`. |
| REQ-016 | Yes | No | No | Fakes for unused collectors throw if called. |
| REQ-017 | Yes | No | No | Log spy / structured log capture. |
| REQ-018 | No | Yes | Yes | Integration: observe `collection` queue stays empty. Manual: operator verifies post-deploy. |
| EDGE-001 | Yes | Yes | No | Unit: deterministic runId + double `createRun`. |
| EDGE-002 | Yes | No | No | Race test with controlled microtask ordering. |
| EDGE-003 | Yes | No | No | Fake that throws before first `await`. |
| EDGE-004 | Yes | No | No | Fake returning `itemsStored: 0`. |
| EDGE-005 | Yes | No | No | All fakes return `itemsStored: 0`; assert existing empty-set behavior. |
| EDGE-006 | Yes | No | No | Fake `rankFn` that throws. |
| EDGE-007 | No | Yes | No | Integration: simulate BullMQ redelivery by re-adding the job with the same id. |
| EDGE-008 | Yes | No | Yes | Unit: one collector never resolves within the test window; others complete and reflect completed state. Manual: observe. |
| EDGE-009 | Yes | No | No | Existing `validate.test.ts` covers zod rejection. |
| EDGE-010 | No | No | Yes | Pre-existing behavior; documented only. Reviewer acknowledges. |
| EDGE-011 | No | Yes | Yes | Integration: poll during a run. Manual: observe frontend. |
| EDGE-012 | No | No | Yes | Operational; covered by deploy runbook, not tests. |
| EDGE-013 | Yes | Yes | No | Mixed success/failure in unit; real partial run in integration. |

## Out of Scope

- **Deleting the `collection` queue, worker, and related files.** Deferred to a follow-up cleanup PR once the single-job path is verified healthy in production. Keeping them in place during this change provides a safe rollback.
- **Deleting `packages/api/src/lib/flow.ts` and removing the `FlowProducer` dependency.** Same reason — deferred to the cleanup PR.
- **Adding a per-collector hard outer timeout (`Promise.race`).** Discussed during design; deferred. Collectors already have internal per-fetch retry bounds; adding an outer ceiling is a separate enhancement and not required for parity with current behavior.
- **Changing the Redis schema for `run:{runId}`** (e.g. splitting into per-source hash keys or per-source Redis keys). Explicitly rejected during design — the single-writer invariant plus in-process write serialization makes the current JSON blob safe.
- **Modifying `run-state.ts`.** The service is load-bearing and its non-atomic read-modify-write is safe under the new architecture without changes. Any refactor to `run-state.ts` is out of scope.
- **Changing the `GET /api/runs/:runId` response shape** or the frontend polling contract. Frontend changes are explicitly excluded from this PR.
- **Multi-worker scale-out** of the run-process worker. Current MVP runs a single worker; `jobId: runId` future-proofs the deduplication invariant, but horizontal scaling itself is not part of this change.
- **Tagging `raw_items` rows with `runId`** to eliminate cross-run time-window bleed. Pre-existing issue, schema change, deferred.
- **Adding frontend streaming updates** (SSE / WebSocket) instead of polling. Polling contract is preserved.
- **Adding BullMQ-level retry configuration** (`attempts`, `backoff`) to the run-process job. Existing retry lives inside each collector; the run job itself is treated as single-attempt in this PR.
- **Per-source retry at the BullMQ job level.** Retries stay inside the collectors; no separate retry layer is added.
- **Observability improvements beyond log parity** (e.g. per-run metrics, tracing spans, structured run lifecycle events). Deferred.
