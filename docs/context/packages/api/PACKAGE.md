---
governs: packages/api/src/
last_verified_sha: 5a2ff20
sub_packages: [auth, lib, lib/email, lib/email/templates, repositories, routes, services]
decisions: [D-001, D-002, D-003, D-004, D-005, D-006, D-007]
status: active
---

# api — Hono REST API for enqueueing pipeline jobs, serving archives, managing settings, and delivering email

## Purpose

The API package is the HTTP boundary for the newsletter system. It serves public archive listings, the admin dashboard, subscription flows, webhook ingestion, and the LinkedIn OAuth connect flow. It owns no processing logic — that belongs to `@newsletter/pipeline`. Communication with the pipeline is through the shared PostgreSQL database (via repositories) and Redis (BullMQ queues for job enqueueing, run-state for live observability).

## Public surface

- `GET /api/health` — liveness check
- `GET /api/archives` — public listing of reviewed archives
- `GET /api/archives/search` — FTS search over archives
- `GET /api/archives/:runId` — public single archive detail
- `GET /api/home` — public home composite (today's issue + featured canon + recent)
- `GET /api/must-read` — public must-read listing
- `GET /api/sources/summary` — public source telemetry + ranking prompt
- `POST /api/subscribe` — subscribe (issues confirmation email)
- `GET /api/confirm` — confirm subscription (token in query)
- `POST /api/admin/login` — admin session issue
- `POST /api/admin/logout` — admin session clear
- All other routes under `/api/runs`, `/api/settings`, `/api/admin/*` are admin-gated.

## Depends on / used by

**Uses:** `@newsletter/shared` (types, constants, DB client, Redis, logging, scheduling helpers), `@newsletter/pipeline` (add-post, eval exports — dynamic imports at the boundary), `hono`, `bullmq`, `@react-email/components`, `posthog-node`, `@aws-sdk/client-sesv2`, `resend`, `rettiwt-api` (only in `services/twitter-handle-resolver.ts` — the single allowed architectural exception)

**Used by:** `@newsletter/web` (frontend), the pipeline (reads settings and archives from DB), LinkedIn's OAuth server (redirects to callback)

## Data flows (spine)

- **Subscribe flow**: `POST /api/subscribe` → creates pending subscriber → issues HMAC confirmation token → sends confirmation email (see `routes/subscribe.ts` trace)
- **Confirm flow**: `GET /api/confirm` → verifies HMAC token → transitions subscriber to confirmed → enqueues `email-send` → notifies Slack (see `routes/subscribe.ts` trace)
- **Run creation**: `POST /api/runs` → validates config → calls `startRun` (shared) → seeds Redis run-state → enqueues `run-process` BullMQ job
- **Review save**: `PATCH /api/admin/archives/:runId` → validates reorder → computes review diff → atomically updates archive + review_edits → enqueues immediate publish jobs for past-due channels (see `services/review.ts::patchArchive` trace)
- **Observability**: `GET /api/admin/runs/:runId/observability` → branches live (Redis) vs historical (run_archives + run_logs) and composes one `RunObservability` payload
- **SES webhook**: `POST /api/webhooks/ses` → SNS signature verification → SES event parse → upsert `ses_events` → bounce/complaint → update subscriber status → Slack notification
- **LinkedIn OAuth**: `GET /api/admin/social-credentials/linkedin/oauth/callback` → validates CSRF state → exchanges code → fetches userinfo → encrypts + saves tokens → redirects
- **Settings save**: `PUT /api/settings` → validates + resolves Twitter handles → upserts `user_settings` → reconciles BullMQ schedulers

## Sub-packages

| Sub-package | Role |
|---|---|
| auth/ | Admin session tokens (HMAC) + cookie-based middleware gate |
| lib/ | Package-private helpers: validation schemas, error classes, PostHog, SNS verifier, subscriber tokens |
| lib/email/ | Email provider abstraction (Resend / SES) |
| lib/email/templates/ | React Email JSX templates (confirmation, newsletter, welcome) |
| repositories/ | Drizzle DB access layer — one repo per table/domain |
| routes/ | Hono route handlers — thin request/response boundary |
| services/ | Business logic between routes and repositories |

## Gotchas / landmines

- **LinkedIn OAuth callback is not admin-gated.** LinkedIn's browser redirect cannot carry the `admin_session` cookie, so this single route is mounted BEFORE `adminApp` in `app.ts` and secured only by the Redis-stored CSRF state token. (D-001)
- **`rettiwt-api` is imported in `services/twitter-handle-resolver.ts` only.** This is the single architectural exception. (D-002)
- **`search_text` must be recomputed when digest headline/summary changes.** `patchArchive` computes the effective post-patch headline/summary and passes them to `serializeArchiveSearchText`. (D-003)
- **`run_archives.updateRankedItems` is a partial UPDATE** — it only writes `ranked_items`, `reviewed`, `search_text`, `updated_at`, and optional digest-meta fields.

## Decisions

- **D-001:** LinkedIn OAuth callback is mounted outside the admin gate. **Why:** Browser redirect from LinkedIn cannot carry the admin_session cookie. **Tradeoff:** The callback relies on an unguessable Redis CSRF state (consume-once). **Governs:** `app.ts`, `routes/linkedin-oauth.ts`.
- **D-002:** `rettiwt-api` is allowed only in `services/twitter-handle-resolver.ts`. **Why:** Handle resolution needs the Twitter API, but the api package must not import pipeline code. **Governs:** `services/twitter-handle-resolver.ts`.
- **D-003:** `updateRankedItems`/`updateRankedItemsInTx` are partial UPDATEs. **Why:** The review UI only sends reordering + field overrides + digest-meta. Writing `topN` would require the caller to know the correct value. **Governs:** `repositories/run-archives.ts`.
- **D-004:** Dynamic imports of `@newsletter/pipeline` at the route boundary. **Why:** Enforced by eslint `no-restricted-imports`; api must not statically bundle pipeline code. **Governs:** `routes/archives.ts`.
- **D-005:** `raw_items.run_id` is the preferred attribution column. **Why:** The collect stage stamps `run_id` on every upserted raw_items row. **Governs:** `repositories/raw-items.ts`.
- **D-006:** `subscribers.updateStatus` uses `WHERE status != $newStatus` to return changed flag. **Why:** Callers gate Slack notifications on changed=true to avoid firing on idempotent replays. **Governs:** `repositories/subscribers.ts`.
- **D-007:** `DELETE /api/admin/archives/:runId` performs Redis ghost cleanup. **Why:** A run whose archive upsert never reached the DB still has a Redis key. **Governs:** `routes/archives.ts`.
