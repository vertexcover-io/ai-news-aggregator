---
governs: packages/api/src/routes/
last_verified_sha: 5a2ff20
key_files: [subscribe.ts, archives.ts, runs.ts, settings.ts, admin-eval.ts, linkedin-oauth.ts, webhooks.ts, admin.ts, admin-runs.ts, admin-must-read.ts, admin-social-credentials.ts, archives-search.ts, home.ts, must-read.ts, sources.ts, analytics.ts, analytics-config.ts]
flow_fns: [subscribe.ts::POST /subscribe, subscribe.ts::GET /confirm, archives.ts::PATCH /:runId, archives.ts::DELETE /:runId, runs.ts::POST /:runId/post/:channel, settings.ts::PUT /, webhooks.ts::POST /ses, linkedin-oauth.ts::POST /start, linkedin-oauth.ts::GET / (callback)]
decisions: [D-001, D-004, D-007]
status: active
---

# routes/ — Hono route handlers

## Purpose

Route handlers are thin: validate input with zod → call a service or repo → return JSON. Every route file exports a factory function that accepts injected dependencies and returns a `Hono` app. Default factories wire production implementations; tests inject mocks.

## Public surface

- `admin.ts` — `POST /login`, `POST /logout`, `GET /me` (session management)
- `admin-eval.ts` — eval pipeline UI routes (fixtures, calendar runs, SSE streaming)
- `admin-must-read.ts` — CRUD for must-read entries + URL preview
- `admin-runs.ts` — per-run observability, source items, raw items listing
- `admin-social-credentials.ts` — CRUD for LinkedIn/Twitter/Twitter-collector credentials
- `analytics-config.ts` — public PostHog config endpoint
- `analytics.ts` — admin-gated analytics metrics
- `archives-search.ts` — public FTS search over archives
- `archives.ts` — public listing + detail, admin review PATCH, add-post, pool, promote, regenerate-digest-meta, force-send, delete
- `home.ts` — public home page composite (today's issue + featured canon + recent)
- `linkedin-oauth.ts` — admin POST /start, admin GET /status, public GET /callback
- `must-read.ts` — public must-read listing
- `runs.ts` — POST /, POST /now, GET /, GET /:runId, POST /:runId/cancel, POST /:runId/post/:channel
- `settings.ts` — GET /, PUT /
- `sources.ts` — public GET /summary
- `subscribe.ts` — POST /subscribe, GET /confirm, GET/POST /unsubscribe
- `webhooks.ts` — POST /ses (SNS-verified SES event ingestion)

## Depends on / used by

**Uses:** repositories, services, lib/, `@newsletter/shared`, `@newsletter/pipeline` (dynamic imports)
**Used by:** `app.ts` (mounted via `app.route()`), `index.ts`

## Data flows

```
POST /subscribe → { ok: true }:
  body → subscribeBodySchema.parse(email)
    → findByEmail → existing? → 200 { ok: true } (idempotent)
    → create({ email, status: "pending" })
      ├─ unique violation (23505) → 200 { ok: true }
      └─ success → issueSubscriberToken → updateConfirmToken → sendConfirmationEmail

GET /confirm?token= → 302 redirect:
  token → verifySubscriberToken(token, "confirm", secret)
    ├─ !valid → redirect /confirm?status=expired|invalid
    └─ valid → updateStatus(subscriberId, "confirmed")
        → countConfirmed → Slack notify (only if changed)
        → getMostRecentReviewedArchiveId
          ├─ exists → enqueue email-send for that archive
          └─ null → skip
        → redirect /confirm?status=success

PATCH /api/admin/archives/:runId → updated archive:
  body → archivePatchSchema.parse → patchArchive(runId, input, deps)
    ├─ NotFoundError → 404
    ├─ ValidationError → 400
    └─ updated → selectImmediatePublishChannels → enqueue past-due channels
        (double-publish guard: sentAt[channel] != null → skip)

POST /api/webhooks/ses → { ok: true }:
  rawBody → verifySnsMessage (signature + cert validation)
    → SubscriptionConfirmation → fetch SubscribeURL → 200
    → Notification → JSON.parse inner Message
      → find emailSend by messageId → subscriberId
      → upsert sesEvents (idempotent on messageId+eventType)
      ├─ Delivery → capture analytics email_delivered
      ├─ Bounce (Permanent) → updateStatus(subscriberId, "bounced")
      └─ Complaint → updateStatus(subscriberId, "complained")
    → 200

POST /api/runs/:runId/post/:channel → 202 | 409:
  channel → socialChannelSchema.parse → runId → UUID regex guard
    → archiveRepo.findById → null → 404
    → dryRun / !reviewed / !completed / alreadyPosted → 409 with reason
    → queue.add(jobName, { runId }) → 202
```

## Gotchas / landmines

- **`/api/archives/search` must be mounted before `/api/archives`.** Otherwise Hono's router matches `/search` against the `/:runId` catch-all.
- **LinkedIn OAuth callback is not admin-gated** (D-001). Mounted before `adminApp` in `app.ts`.
- **The `DELETE /:runId` route performs Redis ghost cleanup.** `redis.del` return count distinguishes ghost-cleanup from true-404.
