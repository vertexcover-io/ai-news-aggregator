# Tech Debt Report — 2026-04-14 — full repo

**Scanned:** 115 TypeScript files | **Date:** 2026-04-14 | **Branch:** main @ `025c15a`  
**Findings:** 0 critical, 3 high, 14 medium, 15 low

GitHub parent issue: https://github.com/vertexcover-io/ai-news-aggregator/issues/50

---

## High (3)

### 1. `drizzle-orm` in `devDependencies` but used in production (pipeline)
- **file:** `packages/pipeline/package.json:30`
- **category:** dependency
- **rule:** misclassified-dependency
- **severity:** High
- **detail:** `packages/pipeline/src/repositories/raw-items.ts`, `candidates.ts`, and `run-archives.ts` all import from `"drizzle-orm"` at runtime. It is only in `devDependencies` — a `pnpm install --prod` would omit it and break the build artifact.
- **fix_hint:** Move `"drizzle-orm": "0.42.0"` from `devDependencies` to `dependencies` in `packages/pipeline/package.json`.

### 2. Architecture rules set to `"warn"` instead of `"error"` in eslint.config.mjs
- **file:** `eslint.config.mjs:65`
- **category:** architecture
- **rule:** lax-enforcement-severity
- **severity:** High
- **detail:** All 5 architectural boundary rules use `"warn"` — ESLint exits 0 on warnings so CI does not block layer violations. Affected: pipeline→hono, pipeline→api, web→drizzle-orm, api routes→direct db, collector-return-shape, enforce-repository-access.
- **fix_hint:** Change all 5 rule severity values from `"warn"` to `"error"` in `eslint.config.mjs`.

### 3. `RunArchivesRepo` interface defined separately in api and pipeline
- **file:** `packages/api/src/repositories/run-archives.ts:16`
- **category:** architecture
- **rule:** split-repository-interface
- **severity:** High
- **detail:** Both packages define `RunArchivesRepo` and `createRunArchivesRepo` against the same Drizzle table. Interface names collide; two factories must be maintained in sync.
- **fix_hint:** Document the intentional split explicitly, or unify as a single interface in shared with read/write sub-interfaces.

---

## Medium (14)

### 4. Dead code: legacy `FlowProducer` singleton in flow.ts
- **file:** `packages/api/src/lib/flow.ts:1`
- **category:** code-smell
- **rule:** dead-code
- **severity:** Medium
- **detail:** `flow.ts` exports `getFlowProducer()` but is not imported anywhere. Per CLAUDE.md it was "kept for rollback and no longer used."
- **fix_hint:** Delete `packages/api/src/lib/flow.ts`.

### 5. Duplicate `Queue` singleton across routes/runs.ts and services/runs.ts
- **file:** `packages/api/src/services/runs.ts:17`
- **category:** code-smell
- **rule:** duplicated-singleton
- **severity:** Medium
- **detail:** Two independent `Queue("processing", ...)` singletons exist in the same process — one in `services/runs.ts:17` and one in `routes/runs.ts:100`. Creates an extra Redis connection and makes ownership unclear.
- **fix_hint:** Remove the queue singleton from `services/runs.ts`. Queue should be owned at one layer and passed as a parameter.

### 6. GET /api/archives route handlers lack try-catch at DB boundary
- **file:** `packages/api/src/routes/archives.ts:26`
- **category:** error-handling
- **rule:** missing-error-handling
- **severity:** Medium
- **detail:** `findById()` and `hydrateRankedItems()` are awaited with no error handling. A DB connection failure propagates as an unhandled rejection, exposing raw errors to the client.
- **fix_hint:** Wrap DB/Redis calls in try-catch and return `c.json({ error: "internal error" }, 500)`.

### 7. Magic number: `10 * 60 * 1000` inline in run-process.ts
- **file:** `packages/pipeline/src/workers/run-process.ts:275`
- **category:** code-smell
- **rule:** magic-number
- **severity:** Medium
- **detail:** The 10-minute fallback window is expressed as inline arithmetic `10 * 60 * 1000`. The log message says "10-minute fallback" but the literal is not tied to that string — they can drift.
- **fix_hint:** Extract `const FALLBACK_WINDOW_MS = 10 * 60 * 1000;` at module scope.

### 8. Stale local `ShortlistCandidate` type in rank.ts
- **file:** `packages/pipeline/src/processors/rank.ts:29`
- **category:** code-smell
- **rule:** dead-code
- **severity:** Medium
- **detail:** Comment says "TODO: remove when phase 5 lands". Phase 5 (shortlist.ts) has shipped. The local type and its stale comment are dead code.
- **fix_hint:** Import the canonical type from `@newsletter/shared` or shortlist processor and delete the local declaration.

### 9. `archive.write_failed` catch silently completes the run
- **file:** `packages/pipeline/src/workers/run-process.ts:405`
- **category:** error-handling
- **rule:** swallowed-exception
- **severity:** Medium
- **detail:** If `archiveRepo.upsert` fails, the error is logged but the run is marked `completed` anyway. The `/archive/:runId` page will 404 with no signal to the user.
- **fix_hint:** Update run state to include a `archiveWriteFailed` warning, or surface via `deps.runState.update`.

### 10. `fetchWithRetry` duplicated across 3 collectors
- **file:** `packages/pipeline/src/collectors/hn.ts:179`
- **category:** duplication
- **rule:** duplicated-retry-logic
- **severity:** Medium
- **detail:** Identical exponential-backoff retry logic (3 retries, 2^n*1000 ms, "Non-retryable" sentinel) in hn.ts:179, reddit.ts:121, and markdown-fetch.ts:23.
- **fix_hint:** Extract shared `fetchWithRetry()` into `packages/pipeline/src/services/http.ts`.

### 11. Run-state TTL constant duplicated across api and pipeline
- **file:** `packages/api/src/services/runs.ts:11`
- **category:** duplication
- **rule:** duplicated-constant
- **severity:** Medium
- **detail:** `TTL_SECONDS = 3600` in api/services/runs.ts and `RUN_STATE_TTL_SECONDS = 3600` in pipeline/services/run-state.ts govern the same Redis key expiry. Can silently diverge.
- **fix_hint:** Move to `packages/shared/src/constants/index.ts` as `RUN_STATE_TTL_SECONDS` and import in both.

### 12. Redis key format `run:${runId}` in 3 places across 2 packages
- **file:** `packages/api/src/routes/runs.ts:82`
- **category:** duplication
- **rule:** duplicated-constant
- **severity:** Medium
- **detail:** Key format constructed independently in routes/runs.ts:82, services/runs.ts:77, and pipeline/services/run-state.ts:23. A key schema mismatch silently breaks run-state reads.
- **fix_hint:** Export `runKey(runId: string): string` from `@newsletter/shared` alongside the TTL constant.

### 13. `JSON.parse(raw) as RunState` without runtime validation
- **file:** `packages/api/src/routes/runs.ts:86`
- **category:** type-safety
- **rule:** type-assertion-abuse
- **severity:** Medium
- **detail:** Stale schema produces a partially-initialized object silently. The API route also bypasses the pipeline's `RunStateService`.
- **fix_hint:** Validate with a zod schema or add null/undefined guards.

### 14. `as HnCollectConfig` / `as RedditCollectConfig` / `as WebCollectConfig` casts in collection worker
- **file:** `packages/pipeline/src/workers/collection.ts:70`
- **category:** type-safety
- **rule:** type-assertion-abuse
- **severity:** Medium
- **detail:** `switch` on `job.name` narrows logically but the `as` casts bypass TypeScript narrowing. Malformed job data silently passes the wrong config type.
- **fix_hint:** Use a discriminated union on `job.data` keyed by `job.name`, or validate at worker startup with zod.

### 15. `(await res.json()) as VoyageResponse` on unvalidated external API response
- **file:** `packages/pipeline/src/services/embeddings.ts:54`
- **category:** type-safety
- **rule:** type-assertion-abuse
- **severity:** Medium
- **detail:** If Voyage API returns an error body or changes schema, downstream code crashes with an unhelpful error.
- **fix_hint:** Add guard: `if (!Array.isArray(json?.data)) throw new Error(...)`.

### 16. `archiveRepo` optional in `RunProcessDeps` but always provided in production
- **file:** `packages/pipeline/src/workers/run-process.ts:118`
- **category:** code-smell
- **rule:** optional-required-dep
- **severity:** Medium
- **detail:** `archiveRepo?: RunArchivesRepo` is optional in `RunProcessDeps` but `createRunProcessWorker` always provides it. Makes it easy to accidentally deploy without archive persistence.
- **fix_hint:** Make `archiveRepo` required in `RunProcessDeps`. Use an extended options interface only in tests.

### 17. `CandidatesRepo.findSince` has no unit test
- **file:** `packages/pipeline/src/repositories/candidates.ts:1`
- **category:** code-smell
- **rule:** missing-test
- **severity:** Medium
- **detail:** Core query feeding the entire dedup/shortlist/rank pipeline has no dedicated unit test — only implicitly covered by e2e tests.
- **fix_hint:** Add unit tests verifying `gte(collectedAt, since)` and `inArray(sourceType, sourceTypes)` filter combinations.

---

## Low (15)

### 18. `msw` unused devDependency in pipeline
- **file:** `packages/pipeline/package.json:32`
- **category:** dependency | **rule:** unused-dependency | **severity:** Low
- **fix_hint:** `pnpm --filter @newsletter/pipeline remove msw`

### 19. `dotenv` in shared production dependencies but never imported
- **file:** `packages/shared/package.json:24`
- **category:** dependency | **rule:** unused-dependency | **severity:** Low
- **fix_hint:** Remove from `packages/shared/package.json` dependencies.

### 20. `@testing-library/dom` redundant explicit dep in web
- **file:** `packages/web/package.json:26`
- **category:** dependency | **rule:** unused-dependency | **severity:** Low
- **fix_hint:** Remove from web devDependencies; pulled transitively.

### 21. eslint-disable on BullMQ `returnvalue` any type
- **file:** `packages/pipeline/src/index.ts:51`
- **category:** type-safety | **rule:** any-overuse | **severity:** Low
- **fix_hint:** Cast `job.returnvalue` to `RunProcessResult` and remove the disable comment.

### 22. Bare catch in `canonicalizeUrl` swallows URL parse errors silently
- **file:** `packages/pipeline/src/processors/dedup.ts:13`
- **category:** error-handling | **rule:** swallowed-exception | **severity:** Low
- **fix_hint:** Add debug-level log inside catch if observability is needed.

### 23. Double bare catch in `fetchOgImage` — OG failures invisible
- **file:** `packages/pipeline/src/collectors/hn.ts:59`
- **category:** error-handling | **rule:** swallowed-exception | **severity:** Low
- **fix_hint:** Add `logger.debug({ url, err }, 'og_image_fetch_failed')` in outer catch.

### 24. `stalledInterval: 30000` magic literal in collection worker
- **file:** `packages/pipeline/src/workers/collection.ts:149`
- **category:** code-smell | **rule:** magic-number | **severity:** Low
- **fix_hint:** Extract `const STALLED_INTERVAL_MS = 30_000;` with explanatory comment.

### 25. `maxTokens: 16384` magic literal in rank.ts
- **file:** `packages/pipeline/src/processors/rank.ts:200`
- **category:** code-smell | **rule:** magic-number | **severity:** Low
- **fix_hint:** Extract `const RANK_MAX_TOKENS = 16_384;` near other ranking constants.

### 26. `console.log` in demo-web-collector.ts script
- **file:** `packages/pipeline/src/scripts/demo-web-collector.ts:92`
- **category:** code-smell | **rule:** console-log | **severity:** Low
- **fix_hint:** Acceptable in developer scripts; no change required.

### 27. `delay()` function defined identically in 3 files
- **file:** `packages/pipeline/src/collectors/hn.ts:175`
- **category:** duplication | **rule:** duplicated-utility | **severity:** Low
- **fix_hint:** Move alongside the retry logic in `packages/pipeline/src/services/http.ts`.

### 28. `MAX_ERROR_LENGTH = 200` duplicated with inconsistent truncation
- **file:** `packages/pipeline/src/collectors/web.ts:20`
- **category:** duplication | **rule:** duplicated-constant | **severity:** Low
- **fix_hint:** Consolidate into `truncateError(msg, max = 200)` in a pipeline-internal util.

### 29. `sourceTypes as SourceType[]` cast in run-process.ts
- **file:** `packages/pipeline/src/workers/run-process.ts:285`
- **category:** type-safety | **rule:** type-assertion-abuse | **severity:** Low
- **fix_hint:** Define `sourceTypes` as `SourceType[]` in `RunProcessJobData` from the start.

### 30. God module: run-process.ts at 484 lines
- **file:** `packages/pipeline/src/workers/run-process.ts:1`
- **category:** code-smell | **rule:** god-module | **severity:** Low
- **fix_hint:** At a natural refactor point, extract types to `run-process-types.ts` and collector runner to `collect-stage.ts`.

### 31. `submitRun`/`getRun`/`getArchive` client error paths have no unit tests
- **file:** `packages/web/src/api/runs.ts:1`
- **category:** code-smell | **rule:** missing-test | **severity:** Low
- **fix_hint:** Add unit tests with fetch mocks for the 404 → null and error → throw paths.

### 32. `useRunState.ts` and `useArchive.ts` have no unit tests
- **file:** `packages/web/src/hooks/useRunState.ts:1`
- **category:** code-smell | **rule:** missing-test | **severity:** Low
- **fix_hint:** Add `renderHook` tests following `useRunPolling.test.ts` pattern.

---

## Summary

| Category | Critical | High | Medium | Low | Total |
|---|---|---|---|---|---|
| dependency | 0 | 1 | 0 | 3 | 4 |
| architecture | 0 | 2 | 0 | 0 | 2 |
| code-smell | 0 | 0 | 6 | 5 | 11 |
| error-handling | 0 | 0 | 2 | 2 | 4 |
| duplication | 0 | 0 | 3 | 2 | 5 |
| type-safety | 0 | 0 | 3 | 2 | 5 |
| **Total** | **0** | **3** | **14** | **15** | **32** |

## Hotspots

| File | Findings | Highest Severity |
|---|---|---|
| `packages/pipeline/src/workers/run-process.ts` | 5 | Medium |
| `packages/pipeline/src/collectors/hn.ts` | 3 | Medium |
| `packages/api/src/routes/runs.ts` | 3 | Medium |
