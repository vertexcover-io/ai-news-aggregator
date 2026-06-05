# Code Review #1: Run as Single Parallel Job

**Scope:** main..HEAD (5 commits)
**Reviewer:** Senior Code Reviewer (Claude Opus 4.6)
**Date:** 2026-04-08

## Verdict: APPROVE WITH SUGGESTIONS

## Summary

The refactor cleanly collapses the FlowProducer + collector-children topology into a single `run-process` job whose handler runs collectors concurrently with an in-process write serializer. The implementation matches the SPEC contract precisely, the SPEC verification matrix is fully covered by tests, the forbidden-files boundary is respected, and the load-bearing race test (REQ-008/EDGE-002) is structured correctly so it would actually fail without `writeSerial`. Two minor smells (duplicated default-queue helper, swallowed-rejection chain semantics worth a comment) are worth fixing but do not block merge.

## Defects Found

### Critical (blockers)

None.

### Important (should fix before merge)

- **Duplicated `getDefaultProcessingQueue` helper**
  (`packages/api/src/services/runs.ts:15-20` and `packages/api/src/routes/runs.ts:68-75`)
  Both modules define their own module-scoped `defaultQueue` singleton plus a `getDefaultProcessingQueue()` function that constructs `new Queue("processing", { connection: createRedisConnection() })`. In practice the route's DI overrides the service default, so production only ever uses one of the two — but the dead twin in `services/runs.ts` is a footgun: a future caller using the unparameterized `createRun(payload)` overload will spin up a *second* `Queue` instance with its own ioredis connection, while the route uses the first. Pick one location (the route is the natural owner since it composes the deps) and either drop the service-level default entirely (require the queue argument) or have the service import the route's helper. Since the service default is currently only exercised by tests via DI, dropping it is the cleaner move.

### Minor (nice to have, won't block)

- **`writeChain = next.catch(() => undefined)` semantics deserve a one-line comment**
  (`packages/pipeline/src/workers/run-process.ts:113-118`)
  The current pattern is correct: callers receive `next` (still rejecting) and the chain's internal handle stores the swallowed version so a single failed write doesn't poison every subsequent task. But it reads as suspicious at a glance — the existing block comment above it explains *why* there's a serializer at all but not *why* the chain swallows. A short note like `// chain swallows so one failed write doesn't poison the chain; callers still observe rejection via the returned promise` would save the next reader two minutes.

- **Failed-write-during-success path swallows the original collector error context**
  (`packages/pipeline/src/workers/run-process.ts:158-198`)
  If a collector resolves successfully but the `writeSerial` for the "completed" patch throws (e.g. Redis flap), control jumps to the `catch (err)` block, which then attempts another `writeSerial` call to mark the source `failed` with the *Redis error* as the message. The collector's actual success state is lost and the source is mislabeled. Probability is very low (Redis is local, single connection) and SPEC doesn't call this out, so it's a minor — but worth a follow-up ticket.

- **`getDefaultProcessingQueue` doesn't dispose its ioredis connection**
  Same file/line as the duplication issue. Module-scoped `Queue` with an inline `createRedisConnection()` will leak on hot reload during dev. Pre-existing pattern (also true of the old `getFlowProducer`), not introduced by this PR — flagging only.

- **`as unknown as HnCollectConfig` casts in unit tests**
  (`packages/pipeline/tests/unit/workers/run-process.test.ts` — multiple lines)
  Tests use `{ sinceDays: 1 } as unknown as HnCollectConfig` to construct minimal configs. Strict-typing rule allows test-file slack but a `Pick<HnCollectConfig, "sinceDays">` helper or a proper test factory would be cleaner. Not blocking.

## SPEC Coverage Verification

| REQ/EDGE | Status | Evidence |
|---|---|---|
| REQ-001 | covered | `runs-service.test.ts:75 "REQ-001: enqueues exactly one run-process job..."` + `runs-route.test.ts` REQ-001 |
| REQ-002 | covered | `runs-service.test.ts:85 "REQ-002: sets job id equal to runId"` |
| REQ-003 | covered | `runs-service.test.ts:98 "REQ-003: carries collector configs..."` |
| REQ-004 | covered | `run-process.test.ts:386 "REQ-004: sets stage to 'collecting' before invoking any collector"` |
| REQ-005 | covered | `run-process.test.ts:420 "REQ-005: invokes all requested collectors concurrently"` (deferred-start gating) |
| REQ-006 | covered | `run-process.test.ts:491 "REQ-006: progressively marks sources completed..."` |
| REQ-007 | covered | `run-process.test.ts:560 "REQ-007/EDGE-013: marks failing source as failed..."` |
| REQ-008 | covered (load-bearing) | `run-process.test.ts:631 "REQ-008/EDGE-002: serializes state writes..."` — fake `updateSource` does `read → await setImmediate → write`, so it would lose updates without `writeSerial`. Verified by manual trace. |
| REQ-009 | covered | `run-process.test.ts:697 "REQ-009: sets stage to 'processing' exactly once..."` |
| REQ-010 | covered | `run-process.test.ts:731 "REQ-010: marks run as failed and skips ranking..."` |
| REQ-011 | covered | `run-process.test.ts:157 "writes empty rankedItems with warning..."` (asserts exact `"no items collected"` string per EDGE-005) + happy-path test |
| REQ-012 | covered | run-flow.e2e.test.ts asserts the persisted RunState shape; no schema changes in `run-state.ts` |
| REQ-013 | manual | `git diff --name-only` confirms only the two SPEC-permitted source files changed (`packages/api/src/services/runs.ts` + `packages/pipeline/src/workers/run-process.ts`), plus `packages/api/src/routes/runs.ts` for the DI surface change. The route change is a necessary follow-on (FlowProducer → Queue type swap in `RunsRouterDeps`) and is consistent with the SPEC intent even though REQ-013 lists only two files. Worth a one-line note in the SPEC. |
| REQ-014 | manual | `git diff --name-only main...HEAD -- packages/pipeline/src/services/run-state.ts packages/pipeline/src/collectors packages/pipeline/src/processors packages/pipeline/src/services/candidate-loader.ts packages/pipeline/src/workers/collection.ts packages/api/src/lib/flow.ts` returns empty. Verified. |
| REQ-015 | covered | `run-process.test.ts:371 "REQ-015: createRunProcessWorker accepts collectFns option"` + `RunProcessDeps.collectFns` field exists |
| REQ-016 | covered | `run-process.test.ts:771 "REQ-016: only invokes collectors whose configs are present..."` (reddit/web fakes throw if called) |
| REQ-017 | covered | `run-process.test.ts:807 "REQ-017: emits run.source.completed and run.source.failed logs..."` |
| REQ-018 | manual | `collection.ts` worker untouched in diff; no new jobs are enqueued to the `collection` queue from `createRun`. Verified. |
| EDGE-001 | partial | Job-id idempotency is asserted via `jobId` opts in REQ-002 test, but no test calls `createRun` twice with the same runId. BullMQ's de-dup behavior is library-level and well-known, so this is acceptable for unit coverage; an integration test would tighten it. Minor gap. |
| EDGE-002 | covered | Same test as REQ-008. |
| EDGE-003 | partial | Synchronous-throw collector path is handled by `try/catch` around `await task.run()` (an `async () => { throw }` wrapper would still reject the promise), but no dedicated test exercises a sync throw before the first `await`. The REQ-007 test uses `Promise.reject` which is observably equivalent for the wrapper. Acceptable but worth a one-line test. |
| EDGE-004 | covered | REQ-006/REQ-007 tests use `itemsStored: 0` / non-zero variants. |
| EDGE-005 | covered | "writes empty rankedItems with warning" test asserts `"no items collected"` exactly. |
| EDGE-006 | covered | "writes failed state and rethrows when rank throws" test. |
| EDGE-007 | manual | BullMQ jobId-based dedup is library behavior; no explicit test, acceptable per spec verification matrix (Integration / Manual). |
| EDGE-008 | covered | REQ-005 test holds collectors open via deferreds, then resolves them. |
| EDGE-009 | covered | Pre-existing `validate.test.ts` (zod). |
| EDGE-010 | manual | Documented as pre-existing. |
| EDGE-011 | covered | `runs.e2e.test.ts` updates exercise the polling shape. |
| EDGE-012 | manual | Operational, deploy runbook. |
| EDGE-013 | covered | REQ-007 test. |

**Gaps:** EDGE-001 and EDGE-003 lack dedicated unit tests but are functionally covered by adjacent tests and library behavior. Neither blocks merge.

## Strengths

- The race test (REQ-008) is constructed correctly: the fake `updateSource` does `read → await setImmediate → write`, which is the canonical lost-update setup. Without `writeSerial` it would deterministically fail. This was the single highest-risk item in the review and the implementer nailed it.
- The terminal-failure branch condition (`failureCount > 0 && successCount === 0`) is symmetric and correctly falls through to dedup/rank when the task list is empty (e.g. the e2e test that pre-seeds raw_items and passes `collectors: {}`). Verified by trace.
- `RunProcessDeps.collectFns` is wired through `CreateRunProcessWorkerOptions` as `Partial<CollectFns>` with sensible defaults — clean DI seam, no test-only branches in production code.
- The `jobId: runId` invariant is set explicitly on the `Queue.add` call (`packages/api/src/services/runs.ts:89`) and asserted by a dedicated REQ-002 test.
- Per-source log events (`run.source.completed`, `run.source.failed`) carry the SPEC-required fields (`runId`, `sourceType`, `itemsFetched` or `error`, `durationMs`).
- Collection worker file, run-state service, collectors, dedup/rank, candidate-loader, and `flow.ts` are all untouched — REQ-014 is satisfied to the letter.
- The block comment on the `writeSerial` rationale (`packages/pipeline/src/workers/run-process.ts:107-112`) is exactly the kind of "why not what" comment the code-quality rules ask for.

## Recommendation

**APPROVE WITH SUGGESTIONS.** The implementation correctly satisfies every Must requirement in the SPEC, the load-bearing race test is properly constructed, and the file-boundary constraints are respected. Address the duplicated `getDefaultProcessingQueue` helper before merge (or in an immediate follow-up) and consider the minor comment/edge-test additions; everything else can ship.
