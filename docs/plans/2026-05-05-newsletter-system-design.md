# Newsletter System — Design

## Problem Statement

The newsletter currently has no public subscriber list, no subscription UI, no email delivery system, and no deliverability analytics. We need to:
1. Let visitors subscribe to a daily newsletter from the public archive homepage and from every story page.
2. Send new subscribers today's reviewed archive immediately (if one exists for today).
3. Deliver the daily newsletter to all active subscribers when an admin saves a reviewed archive (or manually triggers a send).
4. Ensure emails don't land in spam (DKIM/SPF/DMARC via Amazon SES on `mail.vertexcover.io`).
5. Support Gmail-native one-click unsubscribe, feedback reply-to forwarding, and a full deliverability analytics dashboard for admins.

## Context

The project is a TypeScript monorepo (Turborepo + pnpm) with four packages:
- `@newsletter/shared` — Drizzle DB schema, types, utils
- `@newsletter/api` — Hono REST API, session auth, job enqueueing
- `@newsletter/pipeline` — BullMQ workers (no HTTP)
- `@newsletter/web` — React + Vite frontend

Currently `RESEND_API_KEY` is in `.env.example` but no email code exists. The task specifies Amazon SES as the primary provider, with the architecture designed for easy provider swapping. The daily archive pipeline is complete — the gap is purely the subscriber/delivery/analytics layer.

## Requirements

### Functional Requirements

1. **Subscribe widget** — An email input form appears on the homepage (`/`) and at the bottom of every archive story page (`/archive/:runId`).
2. **Double opt-in** — On subscribe, send a confirmation email. Subscription is active only after the user clicks the confirm link.
3. **Immediate welcome send** — If a reviewed archive exists for today's date, send it to the new subscriber after confirmation.
4. **Privacy Policy page** (`/privacy`) and **Terms of Service page** (`/terms`) — linked from the subscribe widget and email footer.
5. **Amazon SES integration** — All transactional and newsletter email sent via SES from `mail.vertexcover.io`. Architecture uses a thin `EmailProvider` interface so the provider can be swapped.
6. **Daily send (auto)** — When admin saves a reviewed archive (`PATCH /api/admin/archives/:runId`), automatically enqueue a `send-newsletter` job to deliver to all confirmed subscribers.
7. **Force send button** — Admin can trigger a send from the archive review UI at any time.
8. **Unsubscribe** — Every email contains a signed unsubscribe link. `GET /unsubscribe?token=...` marks subscriber inactive. `List-Unsubscribe` + `List-Unsubscribe-Post` headers enable Gmail one-click flow (user taps Unsubscribe in Gmail, Gmail POSTs silently — no redirect needed).
9. **Feedback reply-to** — Newsletter `Reply-To` is set to the Google Group address (e.g. `newsletter-feedback@vertexcover.io`) so replies from readers are forwarded to both Ritesh and Aman.
10. **SES event webhooks** — SES publishes bounce/complaint/delivery/open/click events via SNS. A new public endpoint `POST /api/webhooks/ses` receives and stores these events for analytics.
11. **Deliverability Analytics admin page** (`/admin/analytics`) — Time-range filter (daily, weekly, monthly, custom range). Metrics: total subscriptions, unsubscriptions, emails sent, failures, blocks, spam complaints, opens, link clicks.

### Non-Functional Requirements

- **Deliverability** — SPF, DKIM, DMARC configured on `mail.vertexcover.io`. Unsubscribes processed within the same request. Complaint suppression list auto-managed by SES.
- **Security** — Unsubscribe tokens are HMAC-signed (same `SESSION_SECRET`). Confirmation tokens expire after 24 hours. SNS webhook verifies the SNS message signature.
- **Scalability** — Send jobs processed by the existing BullMQ pipeline worker (no new process). Large send batches handled via BullMQ job per subscriber or batched SES `SendBulkEmail`.
- **Provider swap** — A single `EmailProvider` interface (`send(params): Promise<void>`) is injected. Swapping SES for Resend is a one-line config change.
- **Observability** — All send/bounce/complaint events logged with structured context (runId, subscriberId, messageId).

### Edge Cases and Boundary Conditions

- Subscriber submits the same email twice → return success silently (idempotent), don't send a second confirmation.
- Confirmation token clicked twice → second click is a no-op (already confirmed).
- Confirmation token expired (>24h) → return "link expired, please subscribe again" page.
- Archive has already been sent to a subscriber (re-triggered force send) → skip if `email_sends` record already exists for that subscriber + runId.
- SES bounce → mark subscriber `status = 'bounced'`, exclude from future sends.
- SES complaint/spam → mark subscriber `status = 'complained'`, exclude from future sends, log.
- Unsubscribe token for unknown or already-unsubscribed user → return success (idempotent, don't leak info).
- SNS webhook delivers duplicate events (at-least-once) → upsert on `ses_events` table (idempotent).
- SNS sends a `SubscriptionConfirmation` message type → auto-confirm by fetching `SubscribeURL`.
- Welcome send: today's reviewed archive not found → proceed with subscription, skip the welcome send (don't fail).
- Large subscriber list → SES `SendBulkEmail` API handles up to 50 recipients per call; batch accordingly.

## Key Insights

1. **SES SNS webhooks are the right analytics source** — SES doesn't expose a polling "analytics" API; it pushes events via SNS to an HTTP endpoint. This is the standard pattern and the only way to get per-email open/click/bounce data in real time.
2. **One-click unsubscribe is seamless in Gmail** — With `List-Unsubscribe-Post: List-Unsubscribe=One-Click` header, Gmail shows "Unsubscribe" at the top. Clicking it POSTs to our endpoint silently — the user never leaves Gmail. No page redirect is involved.
3. **Double opt-in protects sender reputation** — Without it, any typo or malicious submission could add invalid addresses, increasing bounce rates and hurting the SES sender reputation score.
4. **Provider abstraction is thin** — A single `send(params)` function is enough for the MVP. We don't need a factory or DI container — just a `createEmailProvider(config)` factory that returns the right impl based on `EMAIL_PROVIDER` env var.
5. **BullMQ already handles retries** — We don't need custom retry logic for failed sends; BullMQ's job retry policy covers transient SES failures.
6. **SES domain identity requires DNS changes** — Verifying `mail.vertexcover.io` requires adding CNAME records for DKIM (3 records), an SPF TXT record, and a DMARC TXT record on the root domain. These are one-time infra steps, not code.

## Architectural Challenges

1. **Provider abstraction without over-engineering** — The `EmailProvider` interface must be simple enough to swap but expressive enough to carry SES-specific headers (List-Unsubscribe, Reply-To). Solution: pass a `SendEmailParams` object that includes all headers; each provider ignores headers it doesn't support.
2. **SNS signature verification** — SNS messages include a `SigningCertURL` and `Signature`. We must verify this before trusting the payload. Solution: use the `@aws-sdk/sns-message-validator` or verify manually using the published algorithm.
3. **Token-based unsubscribe without a DB lookup on every request** — HMAC-signing the subscriber ID means we can verify the token without a DB read for the common case (valid token), and only hit the DB to update status.
4. **Send deduplication** — Force-send can be triggered multiple times. Solution: `email_sends` table with a unique constraint on `(subscriber_id, run_archive_id)`.
5. **Batching large send lists** — SES `SendBulkEmail` has a 50-destination limit per call. Solution: BullMQ job chunks the subscriber list into batches of 50 and creates child jobs or loops internally.

## Approaches Considered

### Approach A: Full Amazon SES (primary)

Use `@aws-sdk/client-ses` for sending and SNS for event webhooks. Domain: `mail.vertexcover.io`. Provider interface wraps the SDK call.

**Pros:** Meets the explicit requirement, lowest per-email cost at scale, full bounce/complaint management built in, SNS webhooks are the canonical SES analytics source.
**Cons:** Requires AWS account setup, DNS changes, SES sandbox → production promotion (requires AWS support request). Initial setup friction.
**Risk:** SES sandbox limits sending to verified addresses only until production access is granted — blocks real subscriber sends during development.

### Approach B: Resend (interim, already in stack)

Use the existing Resend dependency for now, design the provider interface so SES can be wired in later.

**Pros:** Zero AWS setup, Resend has a generous free tier, no DNS changes required (Resend handles deliverability on its own domain).
**Cons:** Doesn't meet the stated requirement (Amazon SES). Resend's webhooks are different from SNS — analytics code would need to be rewritten when switching.
**Risk:** Tech debt if the provider switch is deferred indefinitely.

### Approach C: Dual-provider with feature flag

Implement both SES and Resend providers behind `EMAIL_PROVIDER=ses|resend` env var.

**Pros:** Enables dev/test with Resend while SES is being set up; zero-downtime switch.
**Cons:** Doubles the provider code surface, two sets of tests.
**Risk:** Complexity without proportional value if the switch happens soon after launch.

## Chosen Approach

**Approach A (SES primary) with a thin provider interface that also ships a Resend fallback implementation.**

The interface is abstract enough that both providers can implement it. During development (SES sandbox), the `EMAIL_PROVIDER=resend` env var routes to the Resend impl. When SES production access is granted, flip the env var. The SES SNS analytics webhook is implemented from day one — Resend's webhook delivers similar events via a compatible internal event schema, so the analytics layer doesn't change on switch.

This delivers the requirement (SES), protects development velocity (Resend fallback), and keeps the analytics schema provider-agnostic.

## High-Level Design

```
[Web: SubscribeWidget]
  → POST /api/subscribe {email}
      → subscribers table (status: pending)
      → enqueue confirm-email job
  
[Pipeline: confirm-email worker]
  → EmailProvider.send(confirmation email with token)

[GET /confirm?token=...]
  → verify HMAC token
  → subscribers.status = 'confirmed'
  → if today's reviewed archive exists → enqueue send-newsletter job (runId, [subscriberId])

[Admin: ReviewPage "Save" or "Send" button]
  → PATCH /api/admin/archives/:runId (save triggers auto-send)
  → POST /api/admin/archives/:runId/send (force send)
      → enqueue send-newsletter job (runId, all confirmed subscribers)

[Pipeline: send-newsletter worker]
  → fetch run_archive + raw_items
  → render HTML email template (react-email or mjml)
  → chunk confirmed subscribers into batches of 50
  → SES SendBulkEmail (or Resend batch)
  → write email_sends rows per subscriber

[SES SNS → POST /api/webhooks/ses]
  → verify SNS signature
  → upsert ses_events (type, subscriberId, messageId, timestamp)
  → on bounce/complaint: update subscriber.status

[Web: /admin/analytics]
  → GET /api/admin/analytics?from=&to=&granularity=
      → aggregate ses_events + subscribers
      → return metrics: subscriptions, unsubscriptions, sent, bounces, complaints, opens, clicks
```

### New DB Tables (shared schema)

**`subscribers`**
- `id` uuid PK
- `email` text unique
- `status` enum: `pending | confirmed | unsubscribed | bounced | complained`
- `confirmToken` text (expires 24h after creation)
- `confirmTokenExpiresAt` timestamp
- `subscribedAt` timestamp (set on confirmation)
- `unsubscribedAt` timestamp nullable
- `createdAt`, `updatedAt`

**`email_sends`**
- `id` uuid PK
- `subscriberId` uuid FK subscribers
- `runArchiveId` uuid FK run_archives
- `messageId` text (SES message ID for webhook correlation)
- `sentAt` timestamp
- unique constraint: `(subscriberId, runArchiveId)`

**`ses_events`**
- `id` uuid PK
- `messageId` text (FK to email_sends.messageId)
- `eventType` enum: `delivery | bounce | complaint | open | click | reject`
- `subscriberId` uuid nullable (resolved from messageId)
- `rawPayload` jsonb
- `occurredAt` timestamp
- unique constraint: `(messageId, eventType)` for dedup

### New API Routes

```
Public:
  POST /api/subscribe                       — create pending subscriber
  GET  /api/confirm?token=...               — confirm subscription
  GET  /api/unsubscribe?token=...           — unsubscribe
  POST /api/unsubscribe                     — Gmail one-click (List-Unsubscribe-Post)
  POST /api/webhooks/ses                    — SES SNS event receiver
  GET  /privacy                             — served by web (React page)
  GET  /terms                               — served by web (React page)

Admin-gated:
  POST /api/admin/archives/:runId/send      — force send newsletter
  GET  /api/admin/analytics                 — deliverability metrics
```

### New Web Pages/Components

- `SubscribeWidget` — email input + checkbox linking to /privacy and /terms. Used in `ArchiveListingPage` hero and `ArchivePage` story footer.
- `/privacy` — `PrivacyPolicyPage`
- `/terms` — `TermsPage`
- `/admin/analytics` — `AnalyticsPage` with date-range picker and metrics cards/charts.
- `/confirm` — `ConfirmPage` (success/expired states)
- `/unsubscribe` — `UnsubscribePage` (success state)

### Email Template

HTML email rendered server-side (string template or react-email). Structure mirrors the existing Ledger archive aesthetic:
- Header: "AI Newsletter" wordmark + issue number
- Lead story: serif headline + summary
- Story list: numbered, each with bullet points + bottom-line
- Footer: unsubscribe link, reply-to note, privacy policy link, `mail.vertexcover.io` branding

### Provider Interface

```typescript
interface SendEmailParams {
  to: string[];
  from: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>; // List-Unsubscribe etc.
  messageId?: string; // for tracking
}

interface EmailProvider {
  send(params: SendEmailParams): Promise<{ messageId: string }>;
  sendBulk(params: Omit<SendEmailParams, 'to'> & { recipients: Array<{ to: string; substitutions?: Record<string, string> }> }): Promise<{ messageIds: string[] }>;
}
```

## External Dependencies & Fallback Chain

### Primary: @aws-sdk/client-ses

- **Purpose:** Send transactional + newsletter emails via Amazon SES from `mail.vertexcover.io`.
- **Use cases to probe:**
  1. Send a single email (confirmation, welcome)
  2. Send bulk email (newsletter to 50 recipients in one call)
  3. Receive and parse an SNS notification (bounce, open, click events)
- **Maturity:** AWS SDK v3 is actively maintained by AWS. Last commit: days ago. Weekly downloads: millions. Not deprecated.
- **Auth:** AWS IAM credentials (access key + secret)
- **Required env keys:** `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `SES_FROM_EMAIL` (loaded from `.env.harness`)

### Secondary: @aws-sdk/sns-message-validator (or manual)

- **Purpose:** Verify SNS message signatures on the webhook endpoint.
- **Maturity:** Part of AWS SDK ecosystem, actively maintained.
- **Auth:** none (verifies signature from SNS payload itself)
- **Required env keys:** none

### Fallbacks (in order)

1. **Resend** (`resend` npm package, already in `package.json`) — Full-featured email API, already installed, no AWS setup needed. Webhooks deliver bounce/open/click events via HTTPS. Use during development or if SES production access is delayed.
2. **Nodemailer + SMTP** — Self-hosted SMTP or any SMTP relay. Fallback if both SES and Resend are unavailable. Deliverability analytics would require a separate webhook or polling approach.
3. **Build-our-own SMTP relay** — Last resort: configure Postfix/Haraka on a VPS. Not recommended for production.

## Open Questions

1. What is the Google Group address for feedback reply-to? (e.g. `newsletter-feedback@vertexcover.io`) — needs to be created before launch.
2. Does `mail.vertexcover.io` already exist in DNS, or does the subdomain need to be created?
3. What is the SES sending limit needed? (SES sandbox → production requires requesting production access from AWS — can take 24h).
4. Should the analytics page show individual subscriber-level data (e.g. "who opened") or only aggregates? (Recommend aggregates only for privacy).
5. Should bounced/complained subscribers ever be automatically re-subscribed? (Recommend no.)

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| SES production access delayed | Medium | High | Ship with Resend provider first, swap when SES is approved |
| SNS webhook signature verification bug allows spoofing | Low | High | Use `@aws-sdk/sns-message-validator` (tested library) not hand-rolled |
| Unsubscribe token HMAC collision | Very low | Medium | Use 32-byte HMAC-SHA256; include subscriber ID + timestamp in payload |
| Duplicate SNS event delivery causes double-open counts | Medium | Low | Unique constraint on `(messageId, eventType)` in `ses_events` |
| Confirmation email lands in spam | Low | Medium | SES DKIM/SPF/DMARC setup; plain transactional email copy |
| Large subscriber list blocks review save | Low | Medium | Enqueue BullMQ job from save handler — fire-and-forget, non-blocking |
| DNS misconfiguration breaks deliverability | Medium | High | Verify DNS records with `dig` and MXToolbox before launch |

## Assumptions

- AWS account with SES access will be available for production; Resend is acceptable for development.
- `mail.vertexcover.io` subdomain can be added to Vertexcover's DNS.
- The Google Group for feedback will be created at a known address before launch.
- Subscriber volume is small enough (hundreds to low thousands) that BullMQ single-worker processing is sufficient — no need for distributed send workers.
- The existing `SESSION_SECRET` env var is acceptable for HMAC-signing unsubscribe and confirmation tokens (avoids adding a new secret).
- Analytics aggregates only (not per-subscriber row-level queries in the UI) — acceptable for MVP.
