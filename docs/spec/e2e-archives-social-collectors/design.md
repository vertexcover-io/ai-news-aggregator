# Design — e2e coverage for archives, social, and untested collectors

**Status:** Approved (auto-flow)
**Date:** 2026-05-21
**Spec name:** `e2e-archives-social-collectors`
**Bundles covered:** Audit options 2, 3, 4 (Archive Management & Publishing; Social & Email Workers; Untested Collectors)

## Problem statement

Bundle 1 (auth + run lifecycle) landed in PR #173. This PR closes the
remaining audit gaps:

- **Bundle 2 — Archive Management:** `GET /api/archives`, `GET /api/archives/:runId`, `DELETE /api/admin/archives/:runId`, review-page remove-item flow, review-page inline-edit (title/summary/bullets/bottomLine/imageUrl).
- **Bundle 3 — Social & Email Workers:** LinkedIn-post worker, Twitter-post worker, daily-run scheduler (live BullMQ scheduler), social-health worker.
- **Bundle 4 — Untested Collectors:** Twitter collector (via rettiwt), web-search collector (Tavily), and the existing `run-flow.e2e.test.ts` seam test gets its missing assertions filled in.

## Context

Per CLAUDE.md, the codebase has rich unit-test coverage for every
worker, collector, and route. The audit identified **e2e** gaps —
behaviour against real DB + Redis + BullMQ (+ a real or faked external HTTP
service).

External-API policy for this PR (chosen by the user):
- **LinkedIn, Twitter posting:** **MOCKED** via msw (don't post real content).
- **Twitter collector (rettiwt):** **MOCKED** — rettiwt makes
  unauthenticated/scraping HTTP calls; safe to mock with msw.
- **Tavily web-search:** **REAL** — `@tavily/core` SDK uses fetch; idempotent
  reads; the existing pipeline already uses the live API. We'll match the
  existing pattern. Test is `--skipIf(!TAVILY_API_KEY)`.
- **Resend (email):** **MOCKED** for the new e2e tests. Existing
  `newsletter-send.e2e.test.ts` uses real Resend — we leave it alone but
  new tests don't add to live-API surface.
- **Anthropic (ranking/recap):** **NOT exercised** by these tests; not
  in scope.

## Requirements

### Functional

**Archives (Bundle 2):**
- F-AR-1: `GET /api/archives` returns reviewed archives only, JSON shape `{ archives: ArchiveListItem[] }`.
- F-AR-2: `GET /api/archives/:runId` for a reviewed archive returns 200 + full payload; for an unreviewed or missing one returns 404.
- F-AR-3: `DELETE /api/admin/archives/:runId` transactionally removes the archive row, dependent `email_sends` rows, and best-effort `redis.del("run:<id>")`. Returns 204.
- F-AR-4: Review page web e2e — user removes an item from a draft archive, saves, and the removed item no longer appears in the archive detail.
- F-AR-5: Review page web e2e — user inline-edits a recap field, saves, and the edited value appears in the archive detail.

**Social & email workers (Bundle 3):**
- F-WK-1: `handleLinkedInPostJob` against a reviewed archive: calls the LinkedIn API endpoints we intercept with msw, marks `run_archives.linkedin_posted_at`, writes `social_metadata`.
- F-WK-2: Idempotency — running the same LinkedIn job twice does NOT make a second POST.
- F-WK-3: `handleTwitterPostJob` against a reviewed archive: posts head tweet + reply with archive link, marks `twitter_posted_at`, stores both `tweetIds` in `social_metadata`.
- F-WK-4: `handleDailyRunJob` triggered by the BullMQ scheduler dispatches a `run-process` job exactly once per scheduler firing. The test forces a near-immediate fire via `upsertJobScheduler` with a short pattern.

**Collectors (Bundle 4):**
- F-CO-1: `collectTwitter` with a mocked rettiwt timeline returns mapped `RawItemInsert[]` rows persisted to `raw_items`.
- F-CO-2: `collectWebSearch` with the real Tavily SDK queries Tavily, persists results to `raw_items` with `sourceType: "web_search"` and `externalId: "tavily:<sha256(url)>"`. Skipped at runtime if `TAVILY_API_KEY` is absent.

### Non-functional

- N-1: All tests must pass under each package's existing `test:e2e` command.
- N-2: msw lifecycle (`server.listen() / resetHandlers / close`) lives in each test file's `beforeAll` / `afterEach` / `afterAll`. No global setup file.
- N-3: Keep product code changes narrow. E2E coverage may include small
  behavior fixes when the acceptance criteria expose a real mismatch, such
  as hiding unreviewed public archive detail or allowing post-save
  navigation after a successful review save.
- N-4: Add `msw` as a direct devDependency in `@newsletter/pipeline` and `@newsletter/api` (already in lockfile transitively).

### Edge cases

- E-1: LinkedIn job: archive already posted (`linkedin_posted_at !== null`) — should short-circuit, no HTTP requests.
- E-2: Twitter job: head-tweet succeeds but reply-tweet fails — should mark `twitter_posted_at`, log a warning, but NOT record a social failure (per CLAUDE.md spec).
- E-3: Daily-run with `scheduleEnabled=false` — scheduler should not have a repeatable job; we test this by reading queue's job-schedulers and asserting none exists.
- E-4: web-search collector when `TAVILY_API_KEY` missing — test is skipped (not failed).
- E-5: Archive delete on a non-existent ID — returns 404 (not 204).

## External Dependencies & Fallback Chain

| Dep | Used by | Live or mocked here | Auth | Fallback |
|---|---|---|---|---|
| LinkedIn REST API | linkedin-post worker | **mocked (msw)** | OAuth — env vars | n/a (mocking) |
| Twitter API v2 | twitter-post worker | **mocked (msw)** | OAuth 1.0a — env vars | n/a (mocking) |
| Twitter (rettiwt scrape) | twitter collector | **mocked (msw)** | none | n/a (mocking) |
| Tavily | web-search collector | **REAL** | `TAVILY_API_KEY` from .env | skip-if-no-key (no fallback, matches existing newsletter-send pattern) |
| Resend | newsletter-send worker | NOT TESTED here | n/a | n/a |
| Anthropic | rank/recap | NOT TESTED here | n/a | n/a |
| **msw** (test infra) | every social-or-collector e2e | direct devDep | n/a | already in lockfile transitively via vitest |

Verdict for library-probe: **NOT_APPLICABLE for the targeted features** — every external API is either mocked (no live probe needed) or already live in the production codebase (Tavily; the existing collector unit + pipeline collector code is proof it works). msw is mature, no probe needed.

## Approach

- One test file per feature, mirroring the bundle 1 pattern.
- API e2e files (vitest project `e2e`) for archives routes.
- Pipeline e2e files (vitest project `seam`) for workers + collectors.
- Web e2e Playwright files for review-page remove + inline-edit.

## Files to create

```
packages/api/tests/e2e/
  archives.e2e.test.ts             # GET /api/archives, GET /api/archives/:runId, DELETE /api/admin/archives/:runId

packages/pipeline/tests/e2e/seam/workers/
  linkedin-post.e2e.test.ts        # msw + real DB + real Redis
  twitter-post.e2e.test.ts         # msw + real DB + real Redis
  daily-run.e2e.test.ts            # real BullMQ scheduler + real Redis
  # social-health is a wrapper around the same notifier health-checks; e2e adds little. SKIP.

packages/pipeline/tests/e2e/seam/collectors/
  twitter.e2e.test.ts              # msw + real DB
  web-search.e2e.test.ts           # real Tavily + real DB, skip-if-no-key

packages/web/tests/e2e/
  review-remove.spec.ts            # Playwright
  review-inline-edit.spec.ts       # Playwright
```

That's **9 new files**. Total estimated tests: 18–22.

## Risks

- **R-1: msw + BullMQ Worker lifecycle.** BullMQ workers can leak open handles. Tests must `await worker.close()` and `await queue.close()` in `afterAll`.
- **R-2: daily-run scheduler timing.** BullMQ scheduler fires on cron patterns; we'll use a "every-second" pattern with a 2 s window. Risk of flake — bounded by a `vi.waitFor(...)` retry loop.
- **R-3: web-search test is conditional.** The test is `it.skipIf(!process.env.TAVILY_API_KEY)(...)`. CI without the key skips silently — that's fine; locally we run with the key.
- **R-4: Twitter collector via rettiwt.** rettiwt uses fetch internally so msw can intercept. But rettiwt may also use cookies / authenticated endpoints — we'll restrict the test to the unauthenticated `getUserTimeline` path and intercept its specific URL.

## Out of scope

- Real LinkedIn/Twitter posting tests.
- Anthropic ranking/recap e2e (huge cost, already covered by existing tests).
- `social-health` worker — its surface is health-check sentinels around the same notifiers; e2e adds little above existing notifier unit tests.
- Broad refactoring of existing tests or product code.
