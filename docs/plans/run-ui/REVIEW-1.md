# Code Review 1 — Run UI feature

**Branch:** `feat/VER-run-ui` (base: `main`)
**Reviewer:** code-review (Opus 4.6 1M)
**Date:** 2026-04-07
**Scope:** `git diff main..HEAD` — ~5,700 LOC across api, pipeline, web, shared (66 files)

**Verdict: REQUEST CHANGES**

A single critical runtime bug (built pipeline cannot start) plus a few important SPEC deviations and one user-facing message mismatch. The implementation is otherwise high quality: well-structured, dependency-injected, broadly tested, and architecturally compliant. Once the prompt-loading and copy-text issues are fixed, this is APPROVE WITH SUGGESTIONS.

---

## Defect summary

| Severity | Count |
|----------|-------|
| Critical | 1 |
| Important | 4 |
| Minor | 7 |

---

## Critical

### C1. Built pipeline crashes on startup — `rank-system.md` path resolves outside `dist`

**File:** `/media/aman/external/vertexcover/newletter/.worktrees/run-ui/packages/pipeline/src/processors/rank.ts:14-18`

```ts
const PROMPT_URL = new URL("../../prompts/rank-system.md", import.meta.url);
export const rankSystemPrompt: string = readFileSync(
  fileURLToPath(PROMPT_URL),
  "utf-8",
);
```

The `readFileSync` runs at top-level module load. After `tsup` bundles the pipeline into a single `dist/index.js`, `import.meta.url` becomes `file:///.../packages/pipeline/dist/index.js`, so `../../prompts/rank-system.md` resolves to `packages/prompts/rank-system.md` (one directory above the package), which does not exist.

**Verified empirically:** loading the built artifact errors with

```
ENOENT: no such file or directory, open '/.../packages/prompts/rank-system.md'
```

`pnpm start` in pipeline therefore exits before any worker is registered. Unit tests pass because Vitest imports the source TS file (`src/processors/rank.ts`) where the relative path is correct.

`packages/pipeline/tsup.config.ts:15-22` already copies `prompts/` into `dist/prompts/`, but the URL never points there. The `onSuccess` copy is currently dead code.

**Fix options:**
1. Read from `dist/prompts/` by using `new URL("./prompts/rank-system.md", import.meta.url)` and keep the copy step. (Same code path works in dev because `tsx` reads the source file path; you'd need a parallel `src/prompts/` symlink or different resolution for dev.)
2. Inject the prompt as a string at build time (`tsup` `loader: { '.md': 'text' }` + `import prompt from '../../prompts/rank-system.md'`). This eliminates filesystem I/O and works identically in dev and dist.
3. Resolve via `process.cwd()` + a known package-relative path, with a documented `cwd` requirement for `pnpm start`.

REQ-066 ("loaded from an external file at startup") is satisfied by option 1 or 3; option 2 is arguably the cleanest and still keeps the prompt out of `.ts` source.

This blocks the production code path entirely. **Must fix before merge.**

---

## Important

### I1. Hard-coded user-facing 404 message does not match REQ-114

**File:** `/media/aman/external/vertexcover/newletter/.worktrees/run-ui/packages/web/src/pages/RunPage.tsx:39-41`

REQ-114 mandates: `"Run not found — it may have expired. Please submit a new run."`

Implementation renders: `"Run not found (404)."`

The unit test (`packages/web/tests/unit/useRunPolling.test.tsx`) only verifies polling stops on 404 — it does not assert the message. The acceptance criterion is therefore unmet despite the test passing.

### I2. `run.rank` log payload is missing `runId` (REQ-084)

**File:** `/media/aman/external/vertexcover/newletter/.worktrees/run-ui/packages/pipeline/src/processors/rank.ts:116-123`

```ts
logger.info(
  {
    event: "run.rank",
    candidateCount: capped.length,
    rankedCount: rankedItems.length,
  },
  "run.rank",
);
```

REQ-084: *"emit a structured log `run.rank` with `runId`, `candidateCount`, and `rankedCount`"*. `runId` is missing. The other run.* logs (`run.dedup`, `run.completed`, `run.source.completed`, `run.source.failed`) all include `runId`. Either thread `runId` into `RankOptions` or have the run-process worker emit this log instead of (or in addition to) the processor.

No unit test asserts the contents of the `run.rank` log, which is why this slipped past the verification matrix entry for REQ-084.

### I3. `RunSubmitPayload` does not require a non-empty source group at the type level — schema relaxation is the only guard

**File:** `/media/aman/external/vertexcover/newletter/.worktrees/run-ui/packages/api/src/lib/validate.ts:16-26`

The Zod schema accepts `web: z.unknown().optional()` and only the route handler hard-rejects non-undefined `web`. That works, but it leaks "web exists in the schema" semantics into the API. Since web is intentionally deferred (per scope override), it would be cleaner to (a) drop `web` from the schema entirely and (b) reject any `web` key in the body in the route as a guard against the future. The current `body !== null && typeof body === "object" && "web" in body` check in `routes/runs.ts:34-41` does this defensively, so the duplication is not a bug — just a minor smell.

The actual important issue here: `RunSubmitPayload` in `@newsletter/shared/types/run.ts` has *no* `web` field at all, but the validator declares one. The shared type and API schema have drifted. Pick one source of truth. (Recommendation: drop `web` from `runSubmitSchema` and rely solely on the explicit `"web" in body` rejection in the route.)

### I4. Auth comparison is not constant-time, and the middleware accepts both `Bearer x` and `x`

**File:** `/media/aman/external/vertexcover/newletter/.worktrees/run-ui/packages/api/src/middleware/auth.ts:5-9`

```ts
const provided = header.startsWith("Bearer ") ? header.slice(7) : header;
if (!provided || provided !== password) {
  return c.json({ error: "unauthorized" }, 401);
}
```

Two issues:

1. `provided !== password` is a length-leaking equality check. For an internal MVP single-secret this is acceptable (and is consistent with the auth model in `CLAUDE.md`), but it's worth flagging because rotation or future external exposure would make it relevant. `crypto.timingSafeEqual` over fixed-length buffers is a one-line fix.
2. The middleware accepts the password sent both as `Bearer xxx` *and* as raw `xxx`. The dual-mode is tested intentionally (`auth.test.ts:39-45`) so it's deliberate. It's fine, but I'd recommend picking one form to make the contract obvious to API consumers.

Marking this Important rather than Minor only because input validation at the auth boundary is the kind of place a strict-rules project should make a deliberate decision.

---

## Minor

### M1. `dist/prompts/` copy step in tsup is dead code

`packages/pipeline/tsup.config.ts:15-22` copies `prompts/` into `dist/prompts/`, but the URL in `rank.ts` never reads from there. After fixing C1 by either embedding the prompt or repointing the URL, decide whether to keep or remove the copy step.

### M2. HN/Reddit `sinceDays` filter runs *after* comment fetching

`packages/pipeline/src/collectors/hn.ts:207-247` and `packages/pipeline/src/collectors/reddit.ts:259-313` fetch comments for items that are then dropped by the `sinceDays` filter. Functionally correct but wastes upstream API budget. Apply the date filter before the comment loop.

### M3. `sinceDays` filter keeps items where `publishedAt` is `null`

Both collectors do `if (!item.publishedAt) return true;` inside the filter. REQ-021/REQ-023 say "drop items whose date_published parses to a date older than the cutoff". The spec doesn't address null/missing dates, and keeping them is a defensible choice — but it should be a deliberate one. Consider adding a one-line comment, or dropping such items if the intent is "must be within the window".

### M4. SPEC example for `canonicalizeUrl` contradicts the implementation (and the test)

REQ-050 example says `https://Example.com/path/?utm_source=rss&ref=newsletter#section` becomes `https://example.com/path/` (preserves trailing slash). The implementation strips trailing slashes when `pathname.length > 1`, producing `https://example.com/path`, and the unit test (`dedup.test.ts:13-16`) asserts the latter. The implementation and test agree; the SPEC example is wrong. Update the SPEC, not the code.

### M5. Type-level cast in `rank.ts`

`packages/pipeline/src/processors/rank.ts:85-90`

```ts
result = (await generate({...})) as { object: z.infer<typeof rankedResponseSchema> };
```

Single `as` cast on the AI SDK return value. The strict-typing rule prohibits `as unknown as X` double-casts but a single `as` is borderline. The Vercel AI SDK's `generateObject` is generic over the schema and returns `{ object: T }` natively — passing the schema as a generic argument or using the proper overload would remove the cast entirely.

### M6. `loadCandidatesSince` has no dedicated unit test for REQ-042

The verification matrix marks REQ-042 as "Yes" for unit test, but the only coverage is in the e2e Postgres test. A small unit test with a mocked Drizzle builder would close the matrix entry and prevent regressions in the `gte(collectedAt, since)` predicate.

### M7. `RunState.sources.blog` exists in the shared type but the rest of the system uses `web`

`packages/shared/src/types/run.ts:51` declares `blog?: SourceRunState`, while the route, runs service, and frontend all reject/ignore `web`. There is no `blog`-named code path anywhere else. Either rename to `web` for consistency with the deferred future collector, or drop the field until needed (per the "no speculative features" rule in `code-quality.md`).

---

## What was done well

- **Dependency injection throughout:** `createRunsRouter`, `createRunProcessWorker`, and the run-state service all accept their dependencies, making both unit and e2e tests clean and free of `vi.mock` gymnastics in the production code.
- **Package boundaries are respected:** API has no scraping logic, pipeline has no HTTP framework, web imports only `@newsletter/shared` types. The only cross-cutting type (`RunSubmitPayload`) lives correctly in shared. Compliant with `.claude/rules/architecture.md`.
- **TypeScript hygiene is high:** explicit return types on exported functions, no `any` outside of one ESLint-suppressed `returnvalue` line in `pipeline/src/index.ts:48`, and structural type guards for unknown JSON parsing (`isJsonFeed`, `isRedditListing`).
- **Test depth is meaningful:** the run-process worker test exercises the no-items, fallback-window, rank-failure, happy-path, log-emission, and unknown-job branches; the rank processor test covers REQ-060 through REQ-066 plus EDGE-008/009/010; the dedup test covers REQ-050/051/052 and EDGE-014. These are not "doesn't throw" tests.
- **Run-state read-modify-write is documented as intentional** at the top of `services/run-state.ts`. Per task scope, I am not flagging it.
- **Pinned exact versions** in all `package.json` files (`tooling.md`).
- **Env vars added to `.env.example`** (`tooling.md`).
- **`run.started`, `run.source.completed`, `run.source.failed`, `run.dedup`, `run.completed`** all match the SPEC field-for-field. Only `run.rank` is short on `runId` (I2).

---

## Verification matrix gaps

| REQ | Gap | Severity |
|-----|-----|----------|
| REQ-042 | No unit test for `loadCandidatesSince` query shape | Minor (M6) |
| REQ-080 | No log assertion for `run.started` in any integration test | Minor |
| REQ-084 | No log assertion for `run.rank` (and the implementation is missing `runId` — see I2) | Important |
| REQ-114 | Test verifies polling stops, but does not assert the user-facing message text (see I1) | Important |
| REQ-043 | N/A — web deferred (intentional per scope override) | — |
| REQ-003 | N/A — web deferred (the env-key check is unreachable) | — |

---

## Files reviewed

- `/media/aman/external/vertexcover/newletter/.worktrees/run-ui/packages/api/src/index.ts`
- `/media/aman/external/vertexcover/newletter/.worktrees/run-ui/packages/api/src/routes/runs.ts`
- `/media/aman/external/vertexcover/newletter/.worktrees/run-ui/packages/api/src/services/runs.ts`
- `/media/aman/external/vertexcover/newletter/.worktrees/run-ui/packages/api/src/services/rank-hydration.ts`
- `/media/aman/external/vertexcover/newletter/.worktrees/run-ui/packages/api/src/middleware/auth.ts`
- `/media/aman/external/vertexcover/newletter/.worktrees/run-ui/packages/api/src/lib/validate.ts`
- `/media/aman/external/vertexcover/newletter/.worktrees/run-ui/packages/api/src/lib/flow.ts`
- `/media/aman/external/vertexcover/newletter/.worktrees/run-ui/packages/api/tests/e2e/runs.e2e.test.ts`
- `/media/aman/external/vertexcover/newletter/.worktrees/run-ui/packages/api/tests/unit/auth.test.ts`
- `/media/aman/external/vertexcover/newletter/.worktrees/run-ui/packages/pipeline/src/index.ts`
- `/media/aman/external/vertexcover/newletter/.worktrees/run-ui/packages/pipeline/src/workers/collection.ts`
- `/media/aman/external/vertexcover/newletter/.worktrees/run-ui/packages/pipeline/src/workers/run-process.ts`
- `/media/aman/external/vertexcover/newletter/.worktrees/run-ui/packages/pipeline/src/processors/dedup.ts`
- `/media/aman/external/vertexcover/newletter/.worktrees/run-ui/packages/pipeline/src/processors/rank.ts`
- `/media/aman/external/vertexcover/newletter/.worktrees/run-ui/packages/pipeline/src/services/run-state.ts`
- `/media/aman/external/vertexcover/newletter/.worktrees/run-ui/packages/pipeline/src/services/candidate-loader.ts`
- `/media/aman/external/vertexcover/newletter/.worktrees/run-ui/packages/pipeline/src/collectors/hn.ts`
- `/media/aman/external/vertexcover/newletter/.worktrees/run-ui/packages/pipeline/src/collectors/reddit.ts`
- `/media/aman/external/vertexcover/newletter/.worktrees/run-ui/packages/pipeline/tsup.config.ts`
- `/media/aman/external/vertexcover/newletter/.worktrees/run-ui/packages/pipeline/prompts/rank-system.md`
- `/media/aman/external/vertexcover/newletter/.worktrees/run-ui/packages/pipeline/tests/unit/processors/dedup.test.ts`
- `/media/aman/external/vertexcover/newletter/.worktrees/run-ui/packages/pipeline/tests/unit/processors/rank.test.ts`
- `/media/aman/external/vertexcover/newletter/.worktrees/run-ui/packages/pipeline/tests/unit/workers/run-process.test.ts`
- `/media/aman/external/vertexcover/newletter/.worktrees/run-ui/packages/shared/src/types/run.ts`
- `/media/aman/external/vertexcover/newletter/.worktrees/run-ui/packages/web/src/pages/RunPage.tsx`
- `/media/aman/external/vertexcover/newletter/.worktrees/run-ui/packages/web/src/components/RunForm/index.tsx`
- `/media/aman/external/vertexcover/newletter/.worktrees/run-ui/packages/web/src/components/StatusPanel.tsx`
- `/media/aman/external/vertexcover/newletter/.worktrees/run-ui/packages/web/src/api/client.ts`
- `/media/aman/external/vertexcover/newletter/.worktrees/run-ui/packages/web/src/api/runs.ts`
- `/media/aman/external/vertexcover/newletter/.worktrees/run-ui/packages/web/src/auth/PasswordGate.tsx`
- `/media/aman/external/vertexcover/newletter/.worktrees/run-ui/packages/web/src/auth/useAuth.ts`
- `/media/aman/external/vertexcover/newletter/.worktrees/run-ui/packages/web/src/hooks/useRunPolling.ts`
- `/media/aman/external/vertexcover/newletter/.worktrees/run-ui/packages/web/tests/unit/useRunPolling.test.tsx`
