# Plan — e2e-archives-social-collectors

**Branch:** `feat/e2e-archives-social-collectors`
**Worktree:** `.worktrees/e2e-archives-social-collectors`

## Strategy

Three coder agents dispatched **in parallel** because the bundles don't
share code:

- **Agent A — Archives:** writes `archives.e2e.test.ts` (api) + `review-remove.spec.ts` + `review-inline-edit.spec.ts` (web).
- **Agent B — Workers:** writes `linkedin-post.e2e.test.ts`, `twitter-post.e2e.test.ts`, `daily-run.e2e.test.ts` (pipeline). Adds msw to pipeline package.json.
- **Agent C — Collectors:** writes `twitter.e2e.test.ts`, `web-search.e2e.test.ts` (pipeline). Reuses msw added by Agent B (or adds it idempotently).

After all three return: I run typecheck + lint + the test suites end-to-end myself, then aggregate claims, code-review, verify, commit, PR.

## Patterns each agent must follow

- TypeScript strict — no `any`, no `@ts-ignore`. Grandfathered exception: `as unknown as <RepoInterface>` for test fakes (matches `runs.e2e.test.ts`).
- Mirror existing patterns:
  - API e2e: `packages/api/tests/e2e/runs.e2e.test.ts` (pattern from PR #173).
  - Pipeline seam e2e: `packages/pipeline/tests/e2e/seam/workers/run-process.e2e.test.ts` and `cost-tracking.e2e.test.ts`.
  - Pipeline collector e2e: `packages/pipeline/tests/e2e/network/collectors/hn.e2e.test.ts`.
  - Web Playwright: `packages/web/tests/e2e/review-reorder.spec.ts`.
- msw setup pattern in each test file (no global setup):
  ```ts
  import { setupServer } from "msw/node";
  import { http, HttpResponse } from "msw";
  const server = setupServer();
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
  ```
- BullMQ workers in tests must `await worker.close()` and `await queue.close()` in `afterAll` — no leaked timers.
- Tests use `it.skipIf(...)` for the Tavily case.
- Each test file cleans up its own DB rows (`DELETE FROM run_archives WHERE id IN (...)`) and Redis keys.

## Per-agent file responsibilities

### Agent A (Archives + Web)
| File | LoC est | Tests |
|---|---|---|
| `packages/api/tests/e2e/archives.e2e.test.ts` | ~250 | REQ-AR-1..6 |
| `packages/web/tests/e2e/review-remove.spec.ts` | ~110 | REQ-AR-7 |
| `packages/web/tests/e2e/review-inline-edit.spec.ts` | ~110 | REQ-AR-8 |

Helpers Agent A needs:
- Seed a `run_archives` row via `pg` client directly (Playwright pattern) OR via the `/api/admin/archives/:runId` add-post + PATCH endpoints (API pattern). For Agent A's web specs, use the API-driven path so the test doesn't hardcode the schema.
- For archives.e2e.test.ts, build the api app with `createArchivesRouter(...)`. Read `packages/api/src/index.ts` to see how it's mounted. Use fakes for `RunArchivesRepo` (`createRunArchivesRepo(db)` over real DB OR a vi.fn-backed fake — match what the existing archives unit tests do).

### Agent B (Workers)
| File | LoC est | Tests |
|---|---|---|
| `packages/pipeline/tests/e2e/seam/workers/linkedin-post.e2e.test.ts` | ~250 | REQ-WK-1, WK-2 |
| `packages/pipeline/tests/e2e/seam/workers/twitter-post.e2e.test.ts` | ~270 | REQ-WK-3, WK-4 |
| `packages/pipeline/tests/e2e/seam/workers/daily-run.e2e.test.ts` | ~180 | REQ-WK-5, WK-6 |

Helpers Agent B needs:
- Read `packages/pipeline/src/social/linkedin/api-client.ts` to find exact LinkedIn URLs to intercept.
- Read `packages/pipeline/src/social/twitter/api-client.ts` for Twitter URLs.
- Read `packages/api/src/services/scheduler.ts` for `reconcileDailyRunSchedule()`.
- Add `msw@2.7.0` to `packages/pipeline/package.json` devDependencies.
- For LinkedIn/Twitter notifier construction in tests, use the resolved credentials from `process.env` (already in `.env`).
- DB seed: insert a `run_archives` row + corresponding `raw_items` so `notifier.notifyArchiveReady({ runId })` finds story content.

### Agent C (Collectors)
| File | LoC est | Tests |
|---|---|---|
| `packages/pipeline/tests/e2e/seam/collectors/twitter.e2e.test.ts` | ~180 | REQ-CO-1 |
| `packages/pipeline/tests/e2e/seam/collectors/web-search.e2e.test.ts` | ~120 | REQ-CO-2, CO-3 |

Helpers Agent C needs:
- Read `packages/pipeline/src/collectors/twitter/` to find the rettiwt URL surface to intercept.
- Read `packages/pipeline/src/collectors/web-search/providers/tavily.ts` for the live API surface.
- Add `msw` to `packages/pipeline/package.json` devDependencies IF NOT already added by Agent B (idempotent).

## After all three return — orchestrator does

1. `pnpm install` (if any package.json changed) — `msw` should already be in lockfile.
2. `pnpm --filter @newsletter/eslint-plugin build`.
3. `pnpm typecheck` → 0 errors.
4. `pnpm lint` → 0 errors.
5. `pnpm infra:up`, `pnpm --filter @newsletter/shared db:migrate`.
6. Run all new tests, aggregate output into proof-report.md.
7. Code review (2-pass).
8. Commit + PR.

## Risks

- **Concurrent agents may collide on package.json.** Mitigation: only Agent B + Agent C touch package.json (both adding msw). I'll merge their changes manually if both ran the same add.
- **BullMQ scheduler test (REQ-WK-5).** This is the riskiest single test. Plan: use `Queue.upsertJobScheduler` with `every: 1000` (1 s), assert the run-process job is added within 5 s, clean up the scheduler. If it flakes, add a 2-attempt retry.
- **rettiwt internals.** Agent C must read rettiwt source if needed to find the exact fetch URL pattern. If rettiwt's surface area is too opaque to mock cleanly, fall back to mocking the `RettiwtClient` adapter level (`packages/pipeline/src/collectors/twitter/clients/rettiwt.ts`) instead of HTTP — that's also legitimate e2e.

## Approval

User has already authorised bundles 2+3+4 in one PR with mocked external APIs (msw chosen). No additional approval gate needed.
