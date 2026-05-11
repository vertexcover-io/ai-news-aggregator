# Auto-post to LinkedIn and X after newsletter send — Design

**Date:** 2026-05-11
**Status:** Draft
**Author:** Aman + Claude (orchestrate pipeline)
**Spec dir:** `docs/spec/auto-social-post-on-review/`

## 1. Problem

After the operator reviews a newsletter run and the digest emails go out, we want the system to automatically publish a short social post about the issue to **LinkedIn (personal profile)** and **X (personal account)**. The post must use the `digest_headline` produced during ranking (e.g. "Today's digest: AI labs converge on multimodal agents") as its lead line, the `digest_summary` as the supporting paragraph, and a link to the public archive page (`PUBLIC_BASE_URL/archive/<runId>`) as the call to action.

Today the same trigger point already fires a Slack notification with delivery telemetry. This design extends that exact pattern so that operators don't have to manually copy the headline into LinkedIn and X every day.

## 2. Goals

- **G1.** When the `newsletter-send` worker finishes sending a reviewed run's emails, it also posts to LinkedIn and X.
- **G2.** Each post uses `digest_headline` + `digest_summary` + archive URL. If `digest_headline` is missing, the post is skipped (warning logged) — fallbacks would change brand voice unpredictably.
- **G3.** Posting to one platform never blocks the other; failures are logged but never break the email send or the Slack notification.
- **G4.** Idempotency: re-running the worker for the same run never double-posts.
- **G5.** The operator gets a one-time OAuth setup per platform, then the system handles token refresh transparently.
- **G6.** The Slack message reports the per-platform outcome so the operator notices auth/rate-limit drift without reading pipeline logs.
- **G7.** A "Send test post" button in `/admin/settings` lets the operator verify their tokens work without waiting for a real run.

## 3. Non-goals

- LinkedIn **company-page** posting — requires Community Management API approval. Out of scope; revisit if there's demand.
- Image attachments — LinkedIn requires a separate Images API upload step; X relies on og:image scraping at the destination. Skipped for this iteration.
- Per-run opt-out toggle in the review UI — env-level on/off is enough for a two-person team. Revisit if needed.
- Retries / scheduling / time-zone-aware posting — single attempt, fire-and-forget, log failures.
- Multi-account support (multiple X handles, multiple LinkedIn profiles).
- Analytics on post performance.

## 4. User flow

1. Operator clicks **Save Review** on a run (or `AUTO_REVIEW=true` in pipeline) → run is marked reviewed → send-newsletter job is enqueued (unchanged).
2. Pipeline `newsletter-send` worker sends emails to confirmed subscribers (unchanged).
3. **NEW**: After email send completes, worker calls `linkedinNotifier.notifyArchiveReady(runId)` and `twitterNotifier.notifyArchiveReady(runId)` independently, in parallel.
4. Each notifier:
   - Reads the archive (digest fields, ranked items).
   - Skips silently if its env vars are unset (matches Slack pattern).
   - Skips if `digest_headline` is null — logs `social.skipped:no_headline`.
   - Skips if its idempotency column (`linkedin_posted_at` / `twitter_posted_at`) is already set.
   - Reads its OAuth tokens from `social_tokens`. Refreshes if expired. Persists rotated tokens back.
   - Composes the post text via the shared `compose.ts` module.
   - POSTs to the platform API.
   - On success: writes `linkedin_posted_at` / `twitter_posted_at` and stores the returned permalink in `metadata.linkedinPermalink` / `metadata.twitterPermalink` (jsonb on `run_archives.social_metadata` — see §6.1).
   - On failure: logs at ERROR, records nothing.
5. Worker calls existing `slackNotifier.notifyNewsletterSent(...)` with the **per-platform results merged in** so the Slack message reports all three outcomes (email send, LinkedIn, X).

## 5. Architecture

```
packages/pipeline/src/
  social/
    compose.ts              # pure: (headline, summary, url) -> {linkedin, twitter} | null
    linkedin/
      api-client.ts         # raw fetch against /rest/posts; pure HTTP
      notifier.ts           # idempotency check + token refresh + compose + POST + mark
      oauth.ts              # token-refresh logic (used by notifier and CLI script)
      types.ts
    twitter/
      api-client.ts         # thin wrapper around twitter-api-v2
      notifier.ts           # mirrors linkedin/notifier.ts
      oauth.ts
      types.ts
    test-post.ts            # entry point used by the social-test-post BullMQ job
  repositories/
    run-archives.ts         # extend with markLinkedInPosted, markTwitterPosted
    social-tokens.ts        # NEW: getToken(platform), saveToken(platform, tokens)
  workers/
    newsletter-send.ts      # extended to call both notifiers + pass results to Slack notifier
    processing.ts           # extended to wire up notifiers from env vars + handle social-test-post
  queues/
    social-test-post.ts     # NEW: BullMQ queue + enqueue helper

packages/api/src/
  routes/
    settings.ts             # extend: POST /api/settings/test-social-post {platform: 'linkedin'|'twitter'}
                            # enqueues the social-test-post BullMQ job
  repositories/
    social-tokens.ts        # NEW: thin read-only used by /admin/settings to display "configured" state

packages/web/src/
  pages/
    SettingsPage.tsx        # add a "Social posting" section with two test buttons + status

packages/shared/src/
  slack/
    notifier.ts             # accept optional socialResults in NotifyNewsletterSentInput
    message-builder.ts      # render new "Social posts" block when socialResults provided

packages/shared/src/db/
  schema.ts                 # add columns to run_archives + new social_tokens table
  migrations/
    0015_auto_social_post.sql

scripts/
  auth-linkedin.ts          # one-time OAuth via localhost callback; writes to social_tokens
  auth-twitter.ts           # same with PKCE
```

### 5.1 Why pipeline-only (not @newsletter/shared)

The notifiers run only inside the pipeline worker. Putting them in `packages/shared/social/` would force `@newsletter/api` and `@newsletter/web` to type-resolve `twitter-api-v2` and the LinkedIn API surface even though they never call them. Pipeline-only keeps the dependency graph clean and matches the existing rule that pipeline owns long-running integration concerns. The API talks to pipeline through BullMQ for the test-post button — same boundary the rest of the system uses.

### 5.2 Composition module (single source of truth)

```ts
// packages/pipeline/src/social/compose.ts
export interface ComposeInput {
  digestHeadline: string;       // required; caller short-circuits on null
  digestSummary: string | null;
  archiveUrl: string;
}
export interface ComposedPosts {
  linkedinText: string;          // no length cap; LinkedIn allows 3000 chars
  twitterText: string;           // ≤ 280 chars accounting for t.co (URL = 23 chars)
}
export function composePosts(input: ComposeInput): ComposedPosts;
```

Template (both platforms):
```
{digestHeadline}

{digestSummary}             ← omitted if null

{archiveUrl}
```

For X: if `digestHeadline + "\n\n" + digestSummary + "\n\n" + url` exceeds 280, truncate `digestSummary` first (then `digestHeadline` if still over, with `…`). Keep the URL intact.

### 5.3 Token storage

`social_tokens` table (one row per platform):

| column         | type                  | notes                                               |
|----------------|-----------------------|-----------------------------------------------------|
| platform       | text PRIMARY KEY      | `'linkedin'` or `'twitter'`                         |
| access_token   | text NOT NULL         | encrypted at rest? — see §10                        |
| refresh_token  | text NOT NULL         |                                                     |
| expires_at     | timestamptz NOT NULL  | when access_token expires                           |
| metadata       | jsonb                 | platform-specific (e.g. LinkedIn `personUrn`)       |
| updated_at     | timestamptz NOT NULL  | auto-updated on save                                |

The notifier wraps token reads in `SELECT … FOR UPDATE` to prevent two concurrent jobs from refreshing simultaneously (Postgres row lock). Refresh path:
1. `BEGIN; SELECT … FOR UPDATE`
2. If `expires_at` > now() + 60s buffer, return as-is, `COMMIT`.
3. Otherwise call platform refresh endpoint, `UPDATE social_tokens SET …`, `COMMIT`, return new tokens.

### 5.4 Worker integration

```ts
// packages/pipeline/src/workers/newsletter-send.ts (sketch)
const [linkedinResult, twitterResult] = await Promise.allSettled([
  deps.linkedinNotifier?.notifyArchiveReady({ runId }) ?? Promise.resolve(null),
  deps.twitterNotifier?.notifyArchiveReady({ runId }) ?? Promise.resolve(null),
]);

const socialResults = {
  linkedin: settledToReport(linkedinResult),
  twitter: settledToReport(twitterResult),
};

if (deps.slackNotifier) {
  await deps.slackNotifier.notifyNewsletterSent({
    runId,
    delivery: { ... },          // unchanged
    socialResults,              // NEW optional field
  });
}
```

`settledToReport` maps `PromiseSettledResult` → `{ status: 'posted'|'skipped'|'failed', reason?: string, permalink?: string }`. Notifier never throws (already documented in §4); this is defensive against unknown bugs.

### 5.5 Test-post button flow

1. Operator clicks **Send test post → LinkedIn** in `/admin/settings`.
2. Web → `POST /api/settings/test-social-post { platform: 'linkedin' }`.
3. API enqueues a one-shot BullMQ `social-test-post` job to the pipeline.
4. Pipeline worker (in `processing.ts` dispatcher) handles the job by calling `social/test-post.ts`, which composes a hardcoded test message ("Test post from <date> — please ignore") and calls the same api-client used by the notifier.
5. Job result (`{ status, permalink?, error? }`) is written to a Redis key with TTL 5 minutes; API polls it and returns to the UI.

This is a small amount of plumbing but it gives the operator a feedback loop without leaving the admin UI, and exercises the same code path the production notifier uses.

## 6. Schema changes

### 6.1 `run_archives` additions
- `linkedin_posted_at TIMESTAMPTZ NULL` — idempotency for LinkedIn.
- `twitter_posted_at TIMESTAMPTZ NULL` — idempotency for X.
- `social_metadata JSONB NULL` — `{ linkedinPermalink?: string, twitterPermalink?: string, linkedinError?: string, twitterError?: string }`. Nullable, no default.

### 6.2 New `social_tokens` table
See §5.3.

### 6.3 Migration
`packages/shared/src/db/migrations/0015_auto_social_post.sql`:
```sql
ALTER TABLE run_archives
  ADD COLUMN linkedin_posted_at TIMESTAMPTZ,
  ADD COLUMN twitter_posted_at TIMESTAMPTZ,
  ADD COLUMN social_metadata JSONB;

CREATE TABLE social_tokens (
  platform TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  metadata JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

The custom eslint rule `no-raw-alter-table` requires we use Drizzle Kit to generate this — done via `pnpm migrate:generate` after editing `schema.ts`.

## 7. Environment variables

| var                       | required for | notes                                                              |
|---------------------------|--------------|--------------------------------------------------------------------|
| `LINKEDIN_CLIENT_ID`      | LinkedIn     | from LinkedIn developer app                                        |
| `LINKEDIN_CLIENT_SECRET`  | LinkedIn     |                                                                    |
| `LINKEDIN_API_VERSION`    | LinkedIn     | default `202511`; bump quarterly to avoid sunset                  |
| `TWITTER_CLIENT_ID`       | X            | from X developer app (OAuth 2.0 PKCE)                             |
| `TWITTER_CLIENT_SECRET`   | X            |                                                                    |
| `PUBLIC_BASE_URL`         | both         | already exists; used to build archive URL                         |

**Disabling pattern:** if `LINKEDIN_CLIENT_ID` is unset → LinkedIn notifier is `null` in deps and silently disabled. Same for X. This matches the existing Slack pattern (`SLACK_WEBHOOK_URL` unset → no Slack notifier wired).

The actual access/refresh tokens live in `social_tokens`, not `.env` — set via the auth scripts (§9).

## 8. External Dependencies & Fallback Chain

This section is required by the `library-probe` skill. Each external dependency is listed with its primary choice and ordered fallbacks; library-probe will live-test the primary against credentials in `.env.harness`.

### Dep 1: X / Twitter v2 API — write tweet

- **Primary:** `twitter-api-v2` npm package (plhery), v1.20+, against `POST /2/tweets`.
  - Auth: OAuth 2.0 PKCE user-context, refresh token from `social_tokens`.
  - Probe: post a test tweet "[probe] test from newsletter — please ignore", then delete it.
  - Probe creds: `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET`, `TWITTER_TEST_REFRESH_TOKEN` in `.env.harness`.
- **Fallback 1:** Same library, but using OAuth 1.0a User Context with PIN-based flow (older auth model that doesn't require refresh-token rotation).
- **Fallback 2:** **Typefully API** (REST v2) — third-party scheduler at $8/mo, posts to both LinkedIn and X with a single API key. We'd lose direct posting but gain a simpler auth surface.
- **Failure mode if all three fail:** Disable X posting, log loud warning, ship with LinkedIn-only.

### Dep 2: LinkedIn `/rest/posts` — personal profile post

- **Primary:** Raw `fetch` against `https://api.linkedin.com/rest/posts` with `Authorization: Bearer <access_token>`, `LinkedIn-Version: 202511`, `X-Restli-Protocol-Version: 2.0.0`.
  - Scope: `w_member_social` (no Marketing Developer Platform approval needed).
  - Author URN: `urn:li:person:<id>` from auth-script handshake.
  - Probe: create a post with body "[probe] test from newsletter — please ignore", capture the returned `urn:li:share:…` ID, then `DELETE /rest/posts/{urn}` to clean up.
  - Probe creds: `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_TEST_REFRESH_TOKEN`, `LINKEDIN_TEST_PERSON_URN` in `.env.harness`.
- **Fallback 1:** Use `linkedin-api-client` npm package (community SDK, thin wrapper). Same endpoint, less code; tradeoff is dependency on a less-maintained package.
- **Fallback 2:** **Typefully API** as above (same fallback as X).
- **Failure mode if all three fail:** Disable LinkedIn posting, log loud warning, ship with X-only.

### Dep 3: BullMQ job + Redis (already in use)
Not a new dep — used for the `social-test-post` queue. No probe needed.

### Dep 4: Postgres (already in use)
Not a new dep — used for `social_tokens` and `run_archives` columns. No probe needed.

## 9. Auth scripts

Both scripts follow the same shape:
1. Print "Open https://….example/oauth?…" (the platform's authorize URL with scope, redirect_uri=http://localhost:8765/callback, PKCE for X).
2. Spin up an HTTP server on `localhost:8765` to capture the auth code.
3. Exchange code for tokens via the platform's token endpoint.
4. For LinkedIn: also call `GET /v2/userinfo` to fetch the `sub` (person ID) and store as `urn:li:person:<sub>` in `social_tokens.metadata.personUrn`.
5. Insert/replace the row in `social_tokens` (platform PK).
6. Print "✅ Done — token expires <date>. Re-run before then to renew."

Files: `scripts/auth-linkedin.ts`, `scripts/auth-twitter.ts`. Run via `pnpm tsx scripts/auth-twitter.ts`.

## 10. Security notes

- **Tokens at rest:** stored plaintext in Postgres. The DB is single-tenant on a private network; this matches how existing API keys are handled (e.g. ranking model key in `.env`). If we ever multi-tenant, revisit with column-level encryption.
- **Test-post permalink leakage:** the test post creates a real public post for ~few seconds before the operator deletes it (or it stays up — see open question O3). Mitigate by using a clear "[Test post — please ignore]" prefix.
- **Refresh-token race:** prevented by `SELECT … FOR UPDATE` (§5.3).
- **No CSRF for the test-post endpoint:** `/admin/*` is already behind the password-cookie gate; same protection applies.

## 11. Failure modes — explicit table

| Failure                                  | Behavior                                                                |
|------------------------------------------|-------------------------------------------------------------------------|
| `digest_headline` is null                | Skip both posts. Log `social.skipped:no_headline`. Slack reports "skipped: no headline". |
| LinkedIn env vars unset                  | LinkedIn notifier never wired into deps. Slack omits LinkedIn line.     |
| X env vars unset                         | Same.                                                                   |
| LinkedIn token expired + refresh fails   | Log error. `linkedin_posted_at` not set. Slack reports "failed: refresh". |
| X rate limited (429)                     | Log error. `twitter_posted_at` not set. Slack reports "failed: 429".    |
| LinkedIn API version sunset (400)        | Log error with body. Slack reports "failed: api_version_sunset".        |
| Already posted (idempotency hit)         | No-op. Log `social.skipped:already_posted`. No Slack noise.             |
| Concurrent worker tries to post twice    | Second one hits idempotency check → no-op. (Also row-locked at refresh.) |
| Notifier throws unexpectedly             | Caught at worker level, logged as `social.notify.unexpected_throw`. Email send and Slack notification proceed unaffected. |

## 12. Test plan

### Unit (Vitest)
- `compose.ts`: 6 tests — full template, no summary, X truncation, X exact-280-boundary, headline-too-long edge, null-headline guard (returns null).
- `social-tokens` repository: 4 tests — get when present, get when absent, save (insert), save (update existing).
- `linkedin/notifier.ts`: 7 tests with mocked `apiClient`, `archiveRepo`, `tokensRepo`:
  1. happy path: composes + posts + marks `linkedin_posted_at` + stores permalink.
  2. idempotency: pre-set `linkedin_posted_at` → no-op.
  3. null `digest_headline` → skip.
  4. `apiClient.createPost` throws → logs error, does not mark, does not throw.
  5. token expired → calls refresh → uses new token.
  6. refresh fails → logs error, does not post.
  7. archive missing → logs error, does not throw.
- `twitter/notifier.ts`: same 7 mirror tests.
- `slack/message-builder.ts`: 3 new tests — block rendered when socialResults present, block omitted when absent, partial-result rendering (one posted, one failed).

### Integration (Vitest, real Postgres + Redis via testcontainers/podman)
- `social_tokens` repo with real DB: insert + read + concurrent-update under `FOR UPDATE`.
- Worker test: dispatch a fake `newsletter-send` job with stubbed api-clients (no network), assert per-platform `*_posted_at` columns set correctly and Slack notifier called with merged results.

### Verification scenarios (folded from library-probe into spec)
- **VS-0a (X probe):** library-probe creates and deletes a real test tweet via `twitter-api-v2`. Verifies auth + write scope + delete.
- **VS-0b (LinkedIn probe):** library-probe creates and deletes a real test post via `/rest/posts`. Verifies auth + `w_member_social` + delete.
- **VS-1 (E2E reviewed run):** Trigger a reviewed run end-to-end with stubbed api-clients → assert both `*_posted_at` columns set, Slack message contains social block, no email-send disruption.
- **VS-2 (E2E missing headline):** Reviewed run with `digest_headline=null` → assert posts skipped, columns remain null, Slack reports "skipped".
- **VS-3 (Test-post button):** Click test-post button in `/admin/settings` for each platform via Playwright → assert real-or-stubbed test post fires, UI shows success/failure.

## 13. Migration / rollout

1. Single deploy: ships migration `0015_auto_social_post.sql` (additive; no downtime risk) **and** notifier code wired into the worker. With env vars unset, the system behaves identically to today (notifiers `null` → disabled).
2. Run `pnpm migrate:up` to apply the migration on the deployed DB.
3. Run `pnpm tsx scripts/auth-linkedin.ts` once; populate `LINKEDIN_*` env vars; restart pipeline.
4. Run `pnpm tsx scripts/auth-twitter.ts` once; populate `TWITTER_*` env vars; restart pipeline.
5. Use the test-post button in `/admin/settings` to verify each platform end-to-end.
6. Next reviewed run automatically posts.

## 14. Open questions

- **O1 (deferred):** Should the test post stay up briefly or auto-delete via `DELETE /rest/posts/{urn}` and `DELETE /2/tweets/:id` immediately after creation? Default for now: leave up. The "[Test post — please ignore]" prefix and the operator's awareness should suffice. Revisit if it becomes embarrassing.
- **O2 (deferred):** Quarterly reminder to bump `LINKEDIN_API_VERSION`. Could be a calendar reminder; could be a startup check that warns if the configured version is within 30 days of sunset (LinkedIn publishes sunset dates). Skip for v1.
- **O3 (deferred):** Annual LinkedIn re-consent (refresh tokens are non-rolling, max 365 days). Add a dashboard widget that surfaces "LinkedIn token expires in N days" derived from `social_tokens.expires_at` projected forward by 365 days from initial issue. Skip for v1; a 401 error in Slack will surface it.

## 15. Acceptance criteria

- [ ] Migration `0015` adds three `run_archives` columns + `social_tokens` table.
- [ ] `composePosts(...)` produces the exact templates in §5.2 and obeys the X 280-char ceiling.
- [ ] LinkedIn notifier posts to `/rest/posts` and writes `linkedin_posted_at` + permalink in `social_metadata`.
- [ ] Twitter notifier posts via `twitter-api-v2` and writes `twitter_posted_at` + permalink.
- [ ] Either notifier silently no-ops if its env vars are unset.
- [ ] Both notifiers no-op (with log) if `digest_headline` is null.
- [ ] Both notifiers no-op (with log) if their `*_posted_at` is already set.
- [ ] Worker calls both in parallel and never blocks email send.
- [ ] Slack notification renders a "Social posts" block reporting both outcomes.
- [ ] `/admin/settings` shows a "Social posting" section with two test buttons; each enqueues a `social-test-post` job and surfaces the result.
- [ ] All unit tests in §12 pass.
- [ ] library-probe verifies VS-0a and VS-0b against real test credentials.
