# SPEC — e2e coverage for archives, social, and untested collectors

**Spec name:** `e2e-archives-social-collectors`
**Date:** 2026-05-21
**Status:** Approved
**Bundles:** Audit options 2, 3, 4

## Summary

E2E test coverage for the remaining audit gaps: archive HTTP routes,
LinkedIn/Twitter post workers, daily-run scheduler, Twitter collector,
and web-search (Tavily) collector. The implementation is primarily
additive tests, with two narrow product fixes exposed by the new coverage:
public archive detail now hides unreviewed archives, and review save
navigation bypasses the unsaved-change blocker only after a successful
save. New devDep: `msw` (for mocking external HTTP).

## Acceptance criteria (EARS)

### Archives — Bundle 2

- **REQ-AR-1:** When `GET /api/archives` is called and the DB has N reviewed archives, the response shall be 200 with body `{ archives: ArchiveListItem[] }` of length ≤ N, sorted by `completed_at desc`.
- **REQ-AR-2:** When `GET /api/archives` is called and the DB has unreviewed archives only, the response shall be 200 with body `{ archives: [] }`.
- **REQ-AR-3:** When `GET /api/archives/:runId` is called for a reviewed archive, the response shall be 200 with body matching `ArchiveDetail` (id, rankedItems, digestHeadline, digestSummary, completedAt).
- **REQ-AR-4:** When `GET /api/archives/:runId` is called for a missing/unreviewed run, the response shall be 404.
- **REQ-AR-5:** When `DELETE /api/admin/archives/:runId` is called for an existing archive, the response shall be 204, the row in `run_archives` is gone, and any `email_sends` rows referencing that runId are gone. `redis.del("run:<id>")` shall have been called (best-effort).
- **REQ-AR-6:** When `DELETE /api/admin/archives/:runId` is called for a missing runId, the response shall be 404.
- **REQ-AR-7 (web):** Given a draft archive with ≥2 items, when the operator removes one item on `/admin/review/:runId` and clicks Save, the saved archive shall not include that item.
- **REQ-AR-8 (web):** Given a draft archive, when the operator inline-edits the recap `title` on a card and clicks Save, the archive detail shall render the edited title.

### Workers — Bundle 3

- **REQ-WK-1:** Given a reviewed archive with `linkedin_posted_at = null` and msw intercepting LinkedIn `POST /v2/posts` and the upload endpoints, when `handleLinkedInPostJob` runs, it shall: (a) make at least one POST request to the mocked LinkedIn API, (b) update `run_archives.linkedin_posted_at` to a non-null timestamp, (c) write `social_metadata.linkedin.postUrn`.
- **REQ-WK-2:** Given a reviewed archive with `linkedin_posted_at` already set, when `handleLinkedInPostJob` runs again, msw shall intercept zero requests (idempotency).
- **REQ-WK-3:** Given a reviewed archive with `twitter_posted_at = null` and msw intercepting Twitter `POST /2/tweets`, when `handleTwitterPostJob` runs, it shall: (a) make exactly TWO POST requests to /2/tweets (head + reply), (b) update `run_archives.twitter_posted_at`, (c) write `social_metadata.twitter.tweetIds` with two strings.
- **REQ-WK-4:** Given a reviewed archive and msw configured so the reply tweet 500s but the head tweet succeeds, when `handleTwitterPostJob` runs, it shall: (a) update `twitter_posted_at` (head succeeded), (b) NOT record a social failure (per the design — reply failure does not demote head).
- **REQ-WK-5:** Given a `user_settings` row with `scheduleEnabled=true, pipelineTime="00:00"` and a queue scheduler configured to fire frequently (every 1 second), when the `daily-run` handler is wired to the queue, it shall handle at least one `daily-run` job within 5 seconds and that handler shall enqueue exactly one `run-process` job.
- **REQ-WK-6:** Given `scheduleEnabled=false`, after `reconcileDailyRunSchedule()` runs, `Queue.getJobSchedulers()` shall return an empty list (no daily-run scheduler present).

### Collectors — Bundle 4

- **REQ-CO-1:** Given msw intercepting `rettiwt`'s timeline endpoint with a fixture of 3 tweets, when `collectTwitter` runs against a `raw_items` repo backed by real PG, it shall return a `CollectorResult` with `itemsFetched: 3` and insert 3 rows into `raw_items` with `sourceType: "twitter"`.
- **REQ-CO-2:** Given `TAVILY_API_KEY` is present in env and a single query "AI", when `collectWebSearch` runs against real Tavily + real PG, it shall return a `CollectorResult` with `itemsFetched > 0` and insert rows into `raw_items` with `sourceType: "web_search"` and `externalId` matching `/^tavily:[0-9a-f]{64}$/`.
- **REQ-CO-3:** When `TAVILY_API_KEY` is absent, REQ-CO-2's test shall be **skipped** (not failed).

## Verification scenarios

| ID | Maps to | File |
|---|---|---|
| VS-1 | REQ-AR-1 .. AR-6 | `packages/api/tests/e2e/archives.e2e.test.ts` |
| VS-2 | REQ-AR-7, AR-8 | `packages/web/tests/e2e/review-remove.spec.ts`, `review-inline-edit.spec.ts` |
| VS-3 | REQ-WK-1, WK-2 | `packages/pipeline/tests/e2e/seam/workers/linkedin-post.e2e.test.ts` |
| VS-4 | REQ-WK-3, WK-4 | `packages/pipeline/tests/e2e/seam/workers/twitter-post.e2e.test.ts` |
| VS-5 | REQ-WK-5, WK-6 | `packages/pipeline/tests/e2e/seam/workers/daily-run.e2e.test.ts` |
| VS-6 | REQ-CO-1 | `packages/pipeline/tests/e2e/seam/collectors/twitter.e2e.test.ts` |
| VS-7 | REQ-CO-2, CO-3 | `packages/pipeline/tests/e2e/seam/collectors/web-search.e2e.test.ts` |

## Out of scope

- Real LinkedIn/Twitter posting.
- social-health worker e2e (covered by unit tests; e2e provides little).
- newsletter-send worker (already has live-Resend e2e in `newsletter-send.e2e.test.ts`).
- Anthropic-using stages.

## Definition of done

1. All 7 new test files exist.
2. `pnpm --filter @newsletter/api test:e2e` passes with the new file.
3. `pnpm --filter @newsletter/pipeline test:e2e` passes the new files (5 of them).
4. `pnpm --filter @newsletter/web test:e2e` passes the 2 new Playwright specs.
5. `pnpm typecheck` and `pnpm lint` clean.
6. msw added to pipeline + api package.json devDependencies.
