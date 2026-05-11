# SPEC: Auto-post to LinkedIn and X after newsletter send

**Source:** `docs/plans/2026-05-11-auto-social-post-on-review-design.md`
**Library probe:** `docs/spec/auto-social-post-on-review/library-probe.md` (verdict: PASS)
**Generated:** 2026-05-11

## Requirements

### Trigger and integration into worker

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-001 | Event-driven | When the `newsletter-send` worker finishes sending emails for a reviewed run, the system shall invoke `linkedinNotifier.notifyArchiveReady({ runId })` and `twitterNotifier.notifyArchiveReady({ runId })`. | Both notifier methods are called exactly once per send-newsletter job in the post-send phase. Verified by worker integration test that asserts `notifyArchiveReady` mock invocations. | Must |
| REQ-002 | Event-driven | When both notifier calls have settled, the system shall pass per-platform results to `slackNotifier.notifyNewsletterSent({ ..., socialResults })`. | Slack notifier receives `socialResults: { linkedin: SettledReport, twitter: SettledReport }` with `status ∈ {'posted','skipped','failed'}`. Verified by worker integration test asserting the Slack-notifier mock argument shape. | Must |
| REQ-003 | Ubiquitous | The system shall invoke the LinkedIn and X notifiers concurrently using `Promise.allSettled`. | Test that throws from one notifier does not prevent the other from being called or completing. | Must |

### Post composition

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-010 | Ubiquitous | The system shall compose post text from `digest_headline`, `digest_summary` (optional), and the archive URL `${PUBLIC_BASE_URL}/archive/${runId}`. | `composePosts({ digestHeadline, digestSummary, archiveUrl })` returns `{ linkedinText, twitterText }` with text in the form `"<headline>\n\n<summary>\n\n<url>"`. Unit-tested. | Must |
| REQ-011 | Ubiquitous | The system shall omit the summary line and its preceding blank line when `digestSummary` is null. | Output is exactly `"<headline>\n\n<url>"` (no trailing or duplicate blank lines). Unit-tested. | Must |
| REQ-012 | Ubiquitous | The system shall produce a `twitterText` of at most 280 characters when measured per X's t.co rules (URL counts as 23 chars regardless of actual length). | Unit tests cover lengths exactly at 280 and one over. | Must |
| REQ-013 | Unwanted | If composing the X text within 280 chars requires truncation, then the system shall truncate `digestSummary` first (replacing dropped chars with a single trailing `…`); only if removing `digestSummary` entirely is still over 280 shall the system truncate `digestHeadline`. | Unit tests assert the truncation order with fixtures that force each branch. The archive URL is never truncated. | Must |
| REQ-014 | Unwanted | If `digest_headline` is null or empty, then the system shall not POST to either platform and shall log a structured event `social.skipped:no_headline` at WARN level. | Notifier returns `{ status: 'skipped', reason: 'no_headline' }` without calling the API client. Unit-tested per platform. | Must |

### Per-platform notifier behavior

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-020 | Ubiquitous | The system shall short-circuit the LinkedIn notifier with `{ status: 'skipped', reason: 'not_configured' }` when `LINKEDIN_CLIENT_ID` is unset at process start. | The wiring in `processing.ts` returns `null` for `linkedinNotifier`, and `Promise.allSettled` receives a `Promise.resolve(null)` per the design's null-check pattern. Worker integration test asserts no API call attempts. | Must |
| REQ-021 | Ubiquitous | The system shall short-circuit the X notifier with the same pattern when `TWITTER_CLIENT_ID` is unset. | Same as REQ-020 with `twitterNotifier`. | Must |
| REQ-022 | Event-driven | When a notifier is invoked and its platform's `*_posted_at` column on `run_archives` is already non-null, the system shall return `{ status: 'skipped', reason: 'already_posted' }` and shall not POST to the platform API. | Unit test with archive row where `linkedin_posted_at` is preset asserts no API call attempt. | Must |
| REQ-023 | Event-driven | When a notifier successfully POSTs, the system shall set `run_archives.{platform}_posted_at = now()` AND merge `{ {platform}Permalink: <url> }` into `run_archives.social_metadata`. | DB row reflects both updates within the same transaction. Integration test verifies. For LinkedIn the permalink uses the full `urn:li:share:<id>` form (per library-probe finding). | Must |
| REQ-024 | Event-driven | When a notifier's POST fails (any non-2xx response or thrown exception from the API client), the system shall log a structured ERROR event including `runId`, `platform`, and the platform's error code/body, and shall return `{ status: 'failed', reason: <short string> }` without setting `*_posted_at` or merging into `social_metadata`. | Unit tests for each failure class (auth/rate-limit/server-error) assert the log call and the unchanged DB state. | Must |
| REQ-025 | Unwanted | If LinkedIn returns HTTP 422 with `errorDetails.inputErrors[].code === "DUPLICATE_POST"`, then the LinkedIn notifier shall treat the response as success-equivalent: set `linkedin_posted_at = now()`, log `social.linkedin.duplicate_treated_as_success` at WARN level, and return `{ status: 'posted', reason: 'duplicate_treated_as_success' }`. The notifier shall NOT store a permalink in `social_metadata.linkedinPermalink` because the duplicate response does not carry a URN. | Unit test with a mocked 422 DUPLICATE_POST response asserts both the DB update and the absence of a permalink. | Must |
| REQ-026 | Ubiquitous | The system shall guarantee that `notifyArchiveReady(...)` never throws. All errors are caught internally and reported via the return value. | Unit test that injects a failure in every internal step (token fetch, refresh, API call, DB update) and asserts the promise resolves (does not reject). | Must |

### Token storage and refresh

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-030 | Ubiquitous | The system shall provide a `social_tokens` Postgres table with columns `(platform TEXT PRIMARY KEY, access_token TEXT NOT NULL, refresh_token TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, metadata JSONB, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`. | Migration `0015_auto_social_post.sql` (Drizzle-Kit-generated from a schema edit) creates the table with these columns and the PK. Verified by post-migration `\d social_tokens` introspection. | Must |
| REQ-031 | Ubiquitous | The system shall expose a repository `SocialTokensRepo` in `packages/pipeline/src/repositories/social-tokens.ts` with methods `getToken(platform): Promise<SocialTokenRow \| null>` and `saveToken(platform, tokens): Promise<void>`. | Repo built via factory `createSocialTokensRepo(db)`. Type and method signatures match. Unit-tested with a real DB fixture. | Must |
| REQ-032 | Event-driven | When the notifier needs an access token, the system shall acquire it within a single transaction beginning with `SELECT ... FOR UPDATE` on the `social_tokens` row for that platform. | Integration test with two concurrent notifier invocations (real Postgres) demonstrates serialised refresh — exactly one refresh API call is observed when both invocations would otherwise refresh. | Must |
| REQ-033 | Event-driven | When the current `expires_at` is more than 60 seconds in the future, the system shall reuse the existing access token without calling the refresh endpoint. | Unit test: with `expires_at = now() + 5min`, no refresh HTTP call is made. | Must |
| REQ-034 | Event-driven | When the current `expires_at` is at or within 60 seconds of `now()`, the system shall call the platform's refresh endpoint, persist the returned `access_token`, `refresh_token`, and `expires_at` (committing in the same transaction), and use the new access token for the upcoming POST. | Unit test: with expired token + mocked refresh endpoint, asserts new tokens written to the row before the POST happens. | Must |
| REQ-035 | Unwanted | If the refresh endpoint returns a non-2xx response, then the system shall log `social.{platform}.refresh_failed` at ERROR including the response body, leave the row unchanged, and return `{ status: 'failed', reason: 'refresh_failed' }` from `notifyArchiveReady`. | Unit test with mocked refresh failure asserts the log call, untouched DB row, and notifier return value. | Must |

### Slack message extension

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-040 | Event-driven | When `slackNotifier.notifyNewsletterSent` is called with a `socialResults` field, the system shall append a "Social posts" section block to the Slack message containing one line per platform: `<emoji> <Platform>: <status>` plus a permalink anchor when `status === 'posted'` and a short reason when `status !== 'posted'`. | Unit test on `message-builder.ts` asserts the rendered blocks contain the expected substrings for: both posted, both failed, one of each, both skipped. | Must |
| REQ-041 | Ubiquitous | The system shall omit the "Social posts" block when `socialResults` is undefined, preserving the pre-existing Slack message format byte-for-byte. | Snapshot test of the existing message-builder output with `socialResults` absent equals the current baseline output. | Must |
| REQ-042 | Ubiquitous | The system shall continue to perform Slack idempotency via `run_archives.slack_notified_at` independently of the social-posting columns. | Existing Slack-notifier tests continue to pass; no changes to `slack_notified_at` semantics. | Must |

### Test-post button (admin)

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-050 | Event-driven | When the operator submits `POST /api/settings/test-social-post` with body `{ platform: 'linkedin' \| 'twitter' }` from an authenticated admin session, the system shall enqueue a `social-test-post` BullMQ job carrying `{ platform, requestId }` and return `{ requestId }` with HTTP 202. | API integration test using a stub queue asserts the enqueue call and the response shape; unauthenticated calls return 401. | Must |
| REQ-051 | Event-driven | When the pipeline dispatcher receives a `social-test-post` job, the system shall invoke the same per-platform api-client used by the notifier with body `"[Test post — please ignore] <ISO date>"` and shall write the result `{ status, permalink?, error? }` to the Redis key `social-test:<requestId>` with TTL 300 seconds. | Worker test with a stubbed api-client asserts the Redis SET with EXPIRE and the expected payload shape. | Must |
| REQ-052 | Event-driven | When the operator polls `GET /api/settings/test-social-post/:requestId`, the system shall return `{ status: 'pending' }` while the Redis key is absent, the stored result `{ status, permalink?, error? }` once present, and `{ status: 'expired' }` after TTL elapses. | API integration tests cover the three states. | Must |
| REQ-053 | Ubiquitous | The system shall display, in the `/admin/settings` page, a "Social posting" section with: configured-state indicators for LinkedIn and X (derived from whether a `social_tokens` row exists), one "Send test post" button per configured platform, and inline result text when a request resolves. | Playwright test loads `/admin/settings` with a seeded `social_tokens` row, clicks the LinkedIn button (with stubbed pipeline that succeeds), and asserts the success line renders. | Must |

### Operability and configuration

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-060 | Ubiquitous | The system shall provide a script at `scripts/auth-linkedin.ts` runnable via `pnpm tsx scripts/auth-linkedin.ts` that performs an OAuth 2.0 authorization-code exchange against `https://www.linkedin.com/oauth/v2/accessToken` using `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, captures `access_token`/`refresh_token`/`expires_in`, fetches the person URN via `GET https://api.linkedin.com/v2/userinfo`, and upserts the `social_tokens` row for `platform = 'linkedin'`. | Manual run completes without exceptions and inserts a row. Script's signature behavior covered by unit test on the helper functions (URL construction, token-response parsing, userinfo extraction). | Must |
| REQ-061 | Ubiquitous | The system shall provide an analogous script at `scripts/auth-twitter.ts` performing OAuth 2.0 PKCE against the X token endpoint and upserting the `social_tokens` row for `platform = 'twitter'`. | Same as REQ-060, mirrored. | Must |
| REQ-062 | Unwanted | If `scripts/auth-linkedin.ts` receives a token response with no `refresh_token` field, then the script shall print a setup-help message instructing the operator to enable "Programmatic refresh tokens" on the LinkedIn dev app's Auth tab, write the access-token-only row to `social_tokens` (refresh_token = empty string), and exit non-zero. | Script test with a mocked response asserts the message and exit code. | Should |
| REQ-063 | Ubiquitous | The system shall add `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_API_VERSION`, `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET` to `.env.example` with placeholder values and a one-line description above each. | `git diff .env.example` shows the additions; existing entries unchanged. | Must |

### Schema and migration

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-070 | Ubiquitous | The system shall add `linkedin_posted_at TIMESTAMPTZ NULL`, `twitter_posted_at TIMESTAMPTZ NULL`, and `social_metadata JSONB NULL` columns to the `run_archives` table. | Drizzle schema edit + generated migration `0015_auto_social_post.sql` apply cleanly to a fresh DB and to a DB seeded from migration `0014`. Verified by `pnpm migrate:up` and `\d run_archives`. | Must |
| REQ-071 | Ubiquitous | The system shall keep the migration additive — no `DROP`, no `NOT NULL` on existing rows, no destructive default backfills. | `pnpm migrate:up` against a DB containing existing `run_archives` rows succeeds and the new columns are NULL on all pre-existing rows. | Must |
| REQ-072 | Ubiquitous | The migration shall be generated via `pnpm --filter @newsletter/shared db:generate` (Drizzle Kit) rather than hand-written SQL, to satisfy the `no-raw-alter-table` lint rule. | Lint passes after the migration is added. | Must |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|--------------|
| EDGE-001 | Send-worker is invoked for a run whose `digest_headline` is NULL (legacy archive). | Both notifiers return `{ status: 'skipped', reason: 'no_headline' }`. No DB writes. Slack message reports both as skipped. Email send proceeds normally. | REQ-014, REQ-001 |
| EDGE-002 | Composed Twitter text length is exactly 280 characters. | `composePosts` returns the text unchanged. Unit test fixture asserts no truncation. | REQ-012 |
| EDGE-003 | Composed Twitter text is 281 characters because `digestSummary` is one char too long. | `composePosts` truncates `digestSummary` to fit, ending it with `…`. | REQ-013 |
| EDGE-004 | Composed Twitter text is over 280 even with `digestSummary` removed entirely (long headline). | `composePosts` truncates `digestHeadline` to fit, ending with `…`. URL is preserved. | REQ-013 |
| EDGE-005 | Two `social-test-post` jobs for the same platform are enqueued within seconds (operator double-clicks the button). | Two BullMQ jobs run sequentially. Both attempts hit the platform API, but the second hits LinkedIn duplicate-detection (REQ-025) → success-equivalent result. Operator sees the result of whichever poll matches their requestId. | REQ-025, REQ-050, REQ-051 |
| EDGE-006 | Two pipeline workers refresh the same X token simultaneously. | Postgres `SELECT ... FOR UPDATE` serializes the refresh — the second worker sees the row already updated within its transaction window and reuses the new token. | REQ-032 |
| EDGE-007 | LinkedIn API version `202511` is sunset (HTTP 400 with version-error body) at runtime. | Notifier returns `{ status: 'failed', reason: 'api_version_sunset' }`, logs the response body, leaves DB unchanged. Slack reports the failure. Operator must bump `LINKEDIN_API_VERSION`. | REQ-024 |
| EDGE-008 | X account credits are exhausted (HTTP 402 CreditsDepleted, observed in library-probe). | Notifier returns `{ status: 'failed', reason: 'credits_depleted' }`, logs the response, leaves DB unchanged. Slack reports the failure. | REQ-024 |
| EDGE-009 | Slack notifier is `null` (`SLACK_WEBHOOK_URL` unset) but social posts succeed. | DB columns are still updated correctly. No Slack call is attempted. No exception thrown. | REQ-001, REQ-023 |
| EDGE-010 | The `social_tokens` row for a configured platform is missing (token never seeded). | Notifier returns `{ status: 'failed', reason: 'no_token' }` without attempting any HTTP call. Logs a WARN. | REQ-024, REQ-031 |
| EDGE-011 | Operator runs `scripts/auth-linkedin.ts` but the LinkedIn app does not have programmatic refresh tokens enabled. | Script writes a row with `refresh_token = ''`, prints setup instructions, exits non-zero. The notifier later treats `refresh_token === ''` as "cannot refresh" and falls back to using the access token directly until it expires; once expired, returns `{ status: 'failed', reason: 'refresh_unavailable' }`. | REQ-062, REQ-035 |
| EDGE-012 | A reviewed run is re-sent (worker invoked twice for same `runId`) — possible if the operator manually re-enqueues. | Both notifiers see `*_posted_at` already set and return `{ status: 'skipped', reason: 'already_posted' }`. No second post on either platform. | REQ-022 |
| EDGE-013 | Both notifier env vars are unset (no LinkedIn, no X). | Worker passes `socialResults: { linkedin: { status: 'skipped', reason: 'not_configured' }, twitter: { ... } }` to Slack notifier. Slack message renders the "Social posts" block with both as skipped. | REQ-020, REQ-021, REQ-040 |
| EDGE-014 | The `composePosts` archive URL is missing trailing slash issues — `PUBLIC_BASE_URL` set with or without trailing `/`. | `composePosts` (or its caller) joins URL parts safely so the final URL never contains `//archive` or `archive/` artifacts. Unit-tested with both `https://x.com` and `https://x.com/` as base. | REQ-010 |
| EDGE-015 | Test-post Redis result is polled after TTL expiry. | `GET /api/settings/test-social-post/:requestId` returns `{ status: 'expired' }`. UI shows a "result no longer available" message. | REQ-052 |

## Verification Matrix

| REQ/EDGE | Unit | Integration | E2E (Playwright) | Manual / Probe | Notes |
|---|---|---|---|---|---|
| REQ-001 | Yes | Yes | No | No | Worker integration test with mocked notifiers. |
| REQ-002 | Yes | Yes | No | No | Same test, asserts Slack-notifier args. |
| REQ-003 | Yes | No | No | No | Test that one notifier throwing does not block the other. |
| REQ-010 | Yes | No | No | No | Pure function. |
| REQ-011 | Yes | No | No | No | |
| REQ-012 | Yes | No | No | No | Boundary tests at 280 chars. |
| REQ-013 | Yes | No | No | No | Truncation order. |
| REQ-014 | Yes | No | No | No | Per-platform notifier guard. |
| REQ-020 | Yes | Yes | No | No | Worker wiring assertion. |
| REQ-021 | Yes | Yes | No | No | Same. |
| REQ-022 | Yes | Yes | No | No | DB fixture with `*_posted_at` set. |
| REQ-023 | Yes | Yes | No | Manual: real LinkedIn post + permalink visible | LinkedIn permalink uses full `urn:li:share:<id>`. |
| REQ-024 | Yes | No | No | No | Per failure class. |
| REQ-025 | Yes | No | No | No | Mocked 422 DUPLICATE_POST response. |
| REQ-026 | Yes | No | No | No | Inject failure at every step. |
| REQ-030 | No | Yes | No | Manual: `\d social_tokens` | Migration applies. |
| REQ-031 | Yes | Yes | No | No | Real-DB integration test. |
| REQ-032 | No | Yes | No | No | Two concurrent invocations against real Postgres. |
| REQ-033 | Yes | No | No | No | Mocked clock + token TTL. |
| REQ-034 | Yes | Yes | No | No | Mocked refresh endpoint. |
| REQ-035 | Yes | No | No | No | Mocked refresh failure. |
| REQ-040 | Yes | No | No | No | Snapshot/substring assertions on rendered blocks. |
| REQ-041 | Yes | No | No | No | Backwards-compat snapshot. |
| REQ-042 | Yes | No | No | No | Re-run existing Slack tests. |
| REQ-050 | Yes | Yes | No | No | API route test with stubbed queue. |
| REQ-051 | Yes | Yes | No | No | Worker test with stubbed api-client and Redis. |
| REQ-052 | Yes | Yes | No | No | Three-state polling test. |
| REQ-053 | No | No | Yes | No | Playwright test against `/admin/settings`. |
| REQ-060 | Yes (helpers) | No | No | Manual: one-shot OAuth | Full script can't be unit-tested end-to-end. |
| REQ-061 | Yes (helpers) | No | No | Manual: one-shot OAuth | Same. |
| REQ-062 | Yes | No | No | No | Mocked token response. |
| REQ-063 | No | No | No | Manual: diff `.env.example` | Trivial. |
| REQ-070 | No | Yes | No | Manual: `pnpm migrate:up` | Migration verified by post-migrate query. |
| REQ-071 | No | Yes | No | No | Migrate against seeded DB. |
| REQ-072 | No | No | No | Lint: `pnpm lint` passes | `no-raw-alter-table`. |
| EDGE-001 | Yes | Yes | No | No | |
| EDGE-002 | Yes | No | No | No | |
| EDGE-003 | Yes | No | No | No | |
| EDGE-004 | Yes | No | No | No | |
| EDGE-005 | No | Yes | No | No | Two-job worker test. |
| EDGE-006 | No | Yes | No | No | Concurrent-refresh test. |
| EDGE-007 | Yes | No | No | No | Mocked 400 sunset response. |
| EDGE-008 | Yes | No | No | No | Mocked 402 CreditsDepleted response. |
| EDGE-009 | Yes | Yes | No | No | Worker test with `slackNotifier = null`. |
| EDGE-010 | Yes | No | No | No | Notifier with no token row. |
| EDGE-011 | Yes | No | No | Manual: full script run | Script + notifier branch. |
| EDGE-012 | Yes | Yes | No | No | Re-run worker with same `runId`. |
| EDGE-013 | Yes | Yes | No | No | Both env unset. |
| EDGE-014 | Yes | No | No | No | URL join. |
| EDGE-015 | Yes | Yes | No | No | TTL-expired Redis state. |

## Verification Scenarios

### VS-0a: Library probe — twitter-api-v2 OAuth 2.0 refresh + tweet
- **Type:** api
- **Run:** `set -a; source .env.harness; set +a; node docs/spec/auto-social-post-on-review/probes/twitter-api-v2/probe-create-delete.mjs`
- **Status at probe time:** VERIFIED-AUTH-ONLY — refresh + token rotation worked end-to-end; POST blocked by HTTP 402 CreditsDepleted (account billing state, not technical).
- **Expected at functional-verify time:** Once X account has Free-tier enrollment OR PPU credits, exit 0 with PAYLOAD_SAMPLE present including `tweet.id` and `delete` confirmation.
- **Notes:** Probe script depends on `twitter-api-v2@1.29.0` installed in `/tmp/probe-twitter-*`. Re-run requires a fresh `npm i twitter-api-v2` in the probe dir. Reads `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET`, `TWITTER_TEST_REFRESH_TOKEN` from `.env.harness`.

### VS-0b: Library probe — LinkedIn /rest/posts create + delete
- **Type:** api
- **Run:** `set -a; source .env.harness; set +a; bash docs/spec/auto-social-post-on-review/probes/linkedin-rest-posts/probe-create-delete.sh`
- **Status at probe time:** VERIFIED — HTTP 201 on create (returned `urn:li:share:7459558673846054912`), HTTP 204 on delete. Full round trip.
- **Expected at functional-verify time:** exit 0 with `PAYLOAD_SAMPLE={"create_status":201,"post_urn":"urn:li:share:...","delete_status":204}`.
- **Notes:** Uses `LINKEDIN_TEST_ACCESS_TOKEN` (60-day token from one-shot OAuth via `scripts/probe/auth-linkedin.ts`) and `LINKEDIN_TEST_PERSON_URN`. Probe sets a unique date-stamped `commentary` to bypass LinkedIn's 5-minute duplicate-post detection on re-runs.

### VS-1: E2E reviewed run posts to both platforms
- **Type:** worker integration (Vitest with real Postgres + Redis, stubbed api-clients)
- **Run:** `pnpm --filter @newsletter/pipeline test:e2e -t "social posts on reviewed run"`
- **Expected:** After processing a fake `newsletter-send` job for a fixture archive with non-null `digest_headline`, `linkedin_posted_at` and `twitter_posted_at` are both set, `social_metadata` contains both permalinks, and the Slack notifier is called with `socialResults.{linkedin,twitter}.status === 'posted'`.

### VS-2: E2E reviewed run with missing headline skips both posts
- **Type:** worker integration (Vitest with real Postgres + Redis, stubbed api-clients)
- **Run:** `pnpm --filter @newsletter/pipeline test:e2e -t "social posts skip when headline missing"`
- **Expected:** Both notifiers return `{ status: 'skipped', reason: 'no_headline' }`. Both `*_posted_at` columns remain NULL. Slack notifier receives `socialResults` with both as skipped. The api-clients are not invoked.

### VS-3: Test-post button end-to-end
- **Type:** e2e (Playwright + real API + stubbed BullMQ pipeline result)
- **Run:** `pnpm --filter @newsletter/web test:e2e -t "social settings test-post"`
- **Expected:** Operator on `/admin/settings` clicks "Send test post → LinkedIn", UI shows pending state, then within 5s shows the success line including a permalink. Stubbed pipeline writes the result to Redis under the requestId.

### VS-4: Idempotency on worker re-run
- **Type:** worker integration (Vitest with real Postgres)
- **Run:** `pnpm --filter @newsletter/pipeline test:e2e -t "social posts idempotent on re-run"`
- **Expected:** Run the worker once → both `*_posted_at` set, both api-clients invoked once. Run the worker again with the same runId → no api-client invocations, both notifiers return `{ status: 'skipped', reason: 'already_posted' }`.

### VS-5: Concurrent-refresh serialization
- **Type:** integration (Vitest with real Postgres)
- **Run:** `pnpm --filter @newsletter/pipeline test:e2e -t "social tokens concurrent refresh serializes"`
- **Expected:** Two parallel `notifyArchiveReady` calls for the X notifier with an expired access token result in exactly one observed mocked-refresh-endpoint call.

## Out of Scope

- LinkedIn company-page posting (`urn:li:organization:`) — requires Community Management API approval; not pursued.
- Image attachments on posts (LinkedIn Images API upload, X media uploads). The destination archive page provides og:image for X auto-card unfurling.
- Per-run opt-out toggle in the review UI. Disabling is env-level only (unset `*_CLIENT_ID`).
- Retry / backoff. Single attempt per run, per platform. Failures are surfaced via Slack only.
- Multi-account or multi-tenant support.
- Analytics on post engagement (likes, reposts, click-through).
- Auto-bumping `LINKEDIN_API_VERSION` — operators must update manually before sunset.
- Auto-renewing LinkedIn refresh tokens beyond their 365-day non-rolling lifetime — operator must re-run the auth script annually.
- Encryption at rest for `social_tokens` columns. Single-tenant DB on private network; revisit if multi-tenant.
- Auto-deletion of test posts. Test posts created by the test-post button stay live until the operator removes them (the "[Test post — please ignore]" prefix is intentional).
- Posting to platforms other than LinkedIn personal and X personal (Mastodon, Bluesky, Threads, Facebook).
