# SPEC: VER-85 Newsletter System

**Source:** docs/plans/2026-05-05-newsletter-system-design.md
**Generated:** 2026-05-05

---

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Ubiquitous | The system shall display a subscribe widget on the archive listing page (`/`) | Subscribe widget (email input + opt-in checkbox) renders in the page hero section | Must |
| REQ-002 | Ubiquitous | The system shall display a subscribe widget at the bottom of every archive story page (`/archive/:runId`) | Subscribe widget renders after the last story section on every archive page | Must |
| REQ-003 | Event-driven | When a visitor submits their email in the subscribe widget, the system shall create a `pending` subscriber record and send a confirmation email | `POST /api/subscribe` returns 200; a `subscribers` row exists with `status='pending'`; confirmation email delivered to the submitted address within 30s | Must |
| REQ-004 | Ubiquitous | The system shall not create duplicate subscriber records for the same email address | If the same email is submitted a second time, `POST /api/subscribe` returns 200 and no duplicate row is created | Must |
| REQ-005 | Event-driven | When a subscriber clicks the confirmation link (`GET /api/confirm?token=...`), the system shall set their status to `confirmed` and display a success page | Subscriber `status` changes from `pending` to `confirmed`; browser renders `/confirm` with a success message | Must |
| REQ-006 | Event-driven | When a new subscriber is confirmed and a reviewed archive exists for today's date, the system shall send them that archive as a welcome email | Within 60s of confirmation, the subscriber receives an email with the today's reviewed archive content | Must |
| REQ-007 | Unwanted behavior | If the confirmation token is expired (older than 24 hours), then the system shall display an "link expired" page and not activate the subscription | Browser renders `/confirm` with an expiry message; subscriber `status` remains `pending` | Must |
| REQ-008 | Unwanted behavior | If the confirmation token is invalid or not found, then the system shall return a 400 response | `GET /api/confirm?token=garbage` returns HTTP 400 | Must |
| REQ-009 | Event-driven | When an admin saves a reviewed archive (`PATCH /api/admin/archives/:runId`), the system shall enqueue a `send-newsletter` job to deliver the archive to all `confirmed` subscribers | BullMQ `send-newsletter` job is enqueued within 1s of the PATCH response; job payload contains `runId` and list of confirmed subscriber IDs | Must |
| REQ-010 | Event-driven | When an admin triggers force-send (`POST /api/admin/archives/:runId/send`), the system shall enqueue a `send-newsletter` job for that archive | BullMQ `send-newsletter` job is enqueued within 1s; returns HTTP 202 | Must |
| REQ-011 | Event-driven | When a `send-newsletter` job is processed, the system shall send the rendered newsletter HTML email to each confirmed subscriber | Each confirmed subscriber receives one email; `email_sends` rows are created with `sentAt` populated | Must |
| REQ-012 | Ubiquitous | The system shall not send duplicate emails to a subscriber for the same archive | If `email_sends` row already exists for `(subscriberId, runArchiveId)`, the send is skipped for that subscriber | Must |
| REQ-013 | Ubiquitous | Every outbound newsletter email shall include a signed unsubscribe link in the footer | Email HTML contains `<a href="/unsubscribe?token=...">Unsubscribe</a>`; token is HMAC-SHA256 signed with `SESSION_SECRET` | Must |
| REQ-014 | Ubiquitous | Every outbound newsletter email shall include `List-Unsubscribe` and `List-Unsubscribe-Post` headers for Gmail one-click unsubscribe | Email headers contain `List-Unsubscribe: <https://.../unsubscribe?token=...>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` | Must |
| REQ-015 | Event-driven | When a subscriber visits `GET /api/unsubscribe?token=...` with a valid token, the system shall set their status to `unsubscribed` and render an unsubscribe success page | `status` changes to `unsubscribed`; `unsubscribedAt` is set; browser renders `/unsubscribe` success page | Must |
| REQ-016 | Event-driven | When Gmail posts a one-click unsubscribe request to `POST /api/unsubscribe`, the system shall process it identically to the GET flow | Subscriber `status` changes to `unsubscribed`; returns HTTP 200 | Must |
| REQ-017 | Unwanted behavior | If an unsubscribe token is invalid or already used, then the system shall return HTTP 200 without revealing whether the subscriber exists | Both valid-already-done and invalid tokens return HTTP 200 with success page | Must |
| REQ-018 | Ubiquitous | Every outbound newsletter email shall have `Reply-To` set to the Google Group address | Email headers contain `Reply-To: <NEWSLETTER_REPLY_TO_EMAIL>` (configured via env var) | Must |
| REQ-019 | Event-driven | When SES sends a bounce notification via SNS to `POST /api/webhooks/ses`, the system shall mark the affected subscriber's status as `bounced` | Subscriber `status` becomes `bounced`; `ses_events` row created with `eventType='bounce'` | Must |
| REQ-020 | Event-driven | When SES sends a complaint notification via SNS to `POST /api/webhooks/ses`, the system shall mark the affected subscriber's status as `complained` | Subscriber `status` becomes `complained`; `ses_events` row created with `eventType='complaint'` | Must |
| REQ-021 | Event-driven | When SES sends a delivery, open, or click notification via SNS to `POST /api/webhooks/ses`, the system shall store the event in `ses_events` | `ses_events` row created with the correct `eventType`, `messageId`, and `occurredAt` | Must |
| REQ-022 | Unwanted behavior | If the SNS webhook receives a `SubscriptionConfirmation` message, then the system shall automatically confirm the SNS subscription by fetching the `SubscribeURL` | HTTP GET is made to `SubscribeURL`; returns HTTP 200 | Must |
| REQ-023 | Ubiquitous | The system shall deduplicate SNS events using a unique constraint on `(messageId, eventType)` in `ses_events` | A second identical SNS notification for the same `(messageId, eventType)` does not create a duplicate row | Must |
| REQ-024 | State-driven | While a subscriber has status `bounced`, `complained`, or `unsubscribed`, the system shall exclude them from all newsletter sends | Subscribers with these statuses are not included in the `send-newsletter` job recipient list | Must |
| REQ-025 | Ubiquitous | The system shall expose a public `/privacy` page | `GET /privacy` returns HTTP 200 with Privacy Policy content | Must |
| REQ-026 | Ubiquitous | The system shall expose a public `/terms` page | `GET /terms` returns HTTP 200 with Terms of Service content | Must |
| REQ-027 | Ubiquitous | The subscribe widget shall link to `/privacy` and `/terms` | Subscribe widget contains visible links to both pages; checkbox label references data usage | Must |
| REQ-028 | Ubiquitous | The newsletter email footer shall contain links to `/privacy` and `/terms` | Email HTML footer contains working links to privacy and terms pages | Must |
| REQ-029 | Ubiquitous | The admin analytics page (`/admin/analytics`) shall display total subscription count, unsubscription count, emails sent, bounces, complaints, opens, and clicks for a selected date range | `GET /api/admin/analytics?from=&to=&granularity=daily|weekly|monthly` returns all 7 metrics; page renders them | Must |
| REQ-030 | Ubiquitous | The email provider shall be configurable via `EMAIL_PROVIDER` env var, defaulting to `resend` during development and `ses` in production | Setting `EMAIL_PROVIDER=resend` routes all sends through Resend; `EMAIL_PROVIDER=ses` routes through AWS SES; no code change needed to switch | Must |
| REQ-031 | Ubiquitous | The newsletter email shall render in the Ledger aesthetic (serif headlines, rust accent, hairline dividers, matching the archive page) | Email HTML matches the archive page visual style: Newsreader font stack, `#8C3A1E` rust accent, `#FAFAF7` background | Should |
| REQ-032 | Ubiquitous | The system shall validate the SNS message signature before processing webhook events | If signature verification fails, `POST /api/webhooks/ses` returns HTTP 400 and no event is stored | Must |

---

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | Subscriber submits the same email before confirming (re-submission) | `POST /api/subscribe` returns 200; no new row created; existing pending row is left as-is | REQ-003, REQ-004 |
| EDGE-002 | Subscriber who already confirmed re-submits their email | `POST /api/subscribe` returns 200 silently; no change to existing confirmed row | REQ-003, REQ-004 |
| EDGE-003 | Confirmation link clicked after token expires (>24h) | `/confirm` page shows expiry message; subscriber remains `pending` | REQ-007 |
| EDGE-004 | Confirmation link clicked a second time (already confirmed) | `/confirm` shows success page (idempotent); no error | REQ-005 |
| EDGE-005 | Today's reviewed archive does not exist at time of confirmation | Subscription is activated; no welcome send occurs; no error | REQ-006 |
| EDGE-006 | `send-newsletter` job triggered twice for same archive (force-send race) | Second job skips all subscribers who already have an `email_sends` row for that archive | REQ-012 |
| EDGE-007 | Subscriber unsubscribes, then re-subscribes via the widget | New `pending` subscriber row is created (or existing row status reset to `pending`); new confirmation email sent | REQ-003, REQ-015 |
| EDGE-008 | SES bounce for an email address not in `subscribers` table | `ses_events` row created; no subscriber status update; no error | REQ-019 |
| EDGE-009 | SNS delivers the same bounce event twice | Second event hits unique constraint on `(messageId, eventType)`; upserted/ignored; no duplicate row | REQ-023 |
| EDGE-010 | SNS `SubscriptionConfirmation` arrives at webhook endpoint | System fetches `SubscribeURL`, returns 200; does not treat it as a bounce/complaint | REQ-022 |
| EDGE-011 | Unsubscribe token for an already-unsubscribed subscriber | Returns 200 with success page; `unsubscribedAt` not overwritten | REQ-017 |
| EDGE-012 | Unsubscribe token with tampered/invalid HMAC signature | Returns 400 (token invalid); subscriber status unchanged | REQ-015, REQ-017 |
| EDGE-013 | `send-newsletter` job with 0 confirmed subscribers | Job completes successfully; no emails sent; no error | REQ-011 |
| EDGE-014 | `send-newsletter` job with >50 confirmed subscribers | Subscribers are batched into groups of ≤50; all receive emails; all `email_sends` rows created | REQ-011 |
| EDGE-015 | SES sandbox mode (production access not granted) | Emails only sent to verified addresses; system continues to function; error logged if non-verified recipient | REQ-030 |
| EDGE-016 | SNS webhook with invalid signature | `POST /api/webhooks/ses` returns HTTP 400; no event persisted | REQ-032 |
| EDGE-017 | Analytics query with from > to date range | Returns HTTP 400 with descriptive error | REQ-029 |
| EDGE-018 | Subscribe widget submitted with invalid email format | Client-side and server-side validation reject the submission; no row created | REQ-003 |

---

## Verification Matrix

| REQ/EDGE ID | Unit Test | Integration Test | E2E Test | Manual Test | Notes |
|-------------|-----------|-----------------|----------|-------------|-------|
| REQ-001 | No | No | Yes | No | E2E: subscribe widget visible on `/` |
| REQ-002 | No | No | Yes | No | E2E: subscribe widget visible on `/archive/:runId` |
| REQ-003 | Yes | Yes | Yes | No | Unit: subscribe service; Integration: POST /api/subscribe; E2E: full subscribe flow |
| REQ-004 | Yes | Yes | No | No | Unit: dedup logic; Integration: duplicate POST returns 200 |
| REQ-005 | Yes | Yes | Yes | No | Unit: confirm token service; E2E: click confirmation link |
| REQ-006 | Yes | Yes | No | No | Unit: welcome send logic; Integration: confirmed+today's archive triggers send |
| REQ-007 | Yes | Yes | No | No | Unit: token expiry check; Integration: expired token returns correct page state |
| REQ-008 | Yes | Yes | No | No | Unit: token validation; Integration: invalid token → 400 |
| REQ-009 | Yes | Yes | No | No | Unit: archive save triggers enqueue; Integration: BullMQ job enqueued |
| REQ-010 | Yes | Yes | No | No | Unit: force-send enqueue; Integration: POST → 202 + job in queue |
| REQ-011 | Yes | Yes | No | No | Unit: send-newsletter worker; Integration: email_sends rows created |
| REQ-012 | Yes | Yes | No | No | Unit: dedup check; Integration: duplicate send skipped |
| REQ-013 | Yes | No | No | Yes | Unit: email HTML contains unsubscribe link; Manual: inspect rendered email |
| REQ-014 | Yes | No | No | Yes | Unit: email headers include List-Unsubscribe; Manual: verify Gmail shows Unsubscribe button |
| REQ-015 | Yes | Yes | Yes | No | Unit: unsubscribe service; E2E: visit unsubscribe link → success page |
| REQ-016 | Yes | Yes | No | No | Unit: POST /api/unsubscribe handler; Integration: Gmail one-click POST |
| REQ-017 | Yes | Yes | No | No | Unit: idempotency; Integration: double-unsubscribe returns 200 |
| REQ-018 | Yes | No | No | Yes | Unit: email headers contain Reply-To; Manual: reply to newsletter arrives at group |
| REQ-019 | Yes | Yes | No | No | Unit: bounce handler; Integration: SNS bounce → subscriber status |
| REQ-020 | Yes | Yes | No | No | Unit: complaint handler; Integration: SNS complaint → subscriber status |
| REQ-021 | Yes | Yes | No | No | Unit: event storage; Integration: SNS open/click → ses_events row |
| REQ-022 | Yes | Yes | No | No | Unit: SubscriptionConfirmation handler; Integration: mock SNS confirm |
| REQ-023 | Yes | Yes | No | No | Unit: upsert logic; Integration: duplicate SNS event → no duplicate row |
| REQ-024 | Yes | Yes | No | No | Unit: recipient filter; Integration: bounced subscriber excluded from send |
| REQ-025 | No | Yes | Yes | No | Integration: GET /privacy → 200; E2E: page renders |
| REQ-026 | No | Yes | Yes | No | Integration: GET /terms → 200; E2E: page renders |
| REQ-027 | No | No | Yes | No | E2E: links visible in subscribe widget |
| REQ-028 | Yes | No | No | Yes | Unit: email HTML footer; Manual: inspect email footer links |
| REQ-029 | Yes | Yes | Yes | No | Unit: analytics aggregation; Integration: GET /api/admin/analytics; E2E: admin page renders charts |
| REQ-030 | Yes | No | No | No | Unit: EmailProvider factory routes to correct impl based on env var |
| REQ-031 | No | No | No | Yes | Manual: visual inspection of rendered email in email client |
| REQ-032 | Yes | Yes | No | No | Unit: SNS signature verifier; Integration: tampered signature → 400 |
| EDGE-001 | Yes | Yes | No | No | Duplicate subscribe returns 200 |
| EDGE-002 | Yes | Yes | No | No | Already-confirmed re-subscribe is no-op |
| EDGE-003 | Yes | Yes | No | No | Expired token → expiry page |
| EDGE-004 | Yes | Yes | No | No | Double-confirm is idempotent |
| EDGE-005 | Yes | Yes | No | No | No today's archive → skip welcome send |
| EDGE-006 | Yes | Yes | No | No | Duplicate send-newsletter job skips already-sent subscribers |
| EDGE-007 | Yes | Yes | No | No | Re-subscribe after unsubscribe creates new pending |
| EDGE-008 | Yes | Yes | No | No | Bounce for unknown email is stored but no subscriber update |
| EDGE-009 | Yes | Yes | No | No | Duplicate SNS event → unique constraint no-op |
| EDGE-010 | Yes | Yes | No | No | SNS SubscriptionConfirmation auto-confirmed |
| EDGE-011 | Yes | Yes | No | No | Already-unsubscribed token → 200 no-op |
| EDGE-012 | Yes | Yes | No | No | Tampered token → 400 |
| EDGE-013 | Yes | Yes | No | No | 0 subscribers → job completes cleanly |
| EDGE-014 | Yes | Yes | No | No | >50 subscribers → batched correctly |
| EDGE-015 | No | No | No | Yes | Manual: verify SES sandbox behaviour during dev |
| EDGE-016 | Yes | Yes | No | No | Invalid SNS signature → 400 |
| EDGE-017 | Yes | Yes | No | No | from > to date range → 400 |
| EDGE-018 | Yes | Yes | Yes | No | Invalid email format rejected client + server side |

---

## Verification Scenarios (VS-0 — from Library Probe)

### VS-0-ses-api-connectivity: Library probe — SES API connectivity
**Type:** api
**Run:** bash docs/spec/ver-85-newsletter-system/probes/aws-sdk-client-ses/probe-ses-api-connectivity.sh
**Expected:** exit 0, JSON with `verified: true` and `statusCode: 200`

### VS-0-sns-parse: Library probe — SNS notification parsing (offline)
**Type:** unit
**Expected:** exit 0, JSON with `parsed: true` and `notificationType: "Bounce"`

### VS-0-ses-send: Library probe — SES single email send
**Type:** api
**Status:** DEFERRED — requires verified SES sender (mail.vertexcover.io domain verification pending)

---

## Out of Scope

- **Subscriber management UI** — no admin page to list, search, or manually edit subscribers (analytics only)
- **Subscriber import / bulk upload** — adding existing lists is not part of this feature
- **Multiple newsletter lists / segments** — single global list only
- **Email preferences page** — subscribers can only unsubscribe; no frequency or topic preferences
- **A/B testing or send-time optimization** — sends go to all subscribers at once
- **Public subscriber count display** — the public archive page does not show how many subscribers there are
- **Pagination on analytics** — analytics returns aggregated totals for the selected range, not paginated event logs
- **Per-subscriber open/click tracking in admin** — analytics are aggregate only, no individual tracking
- **SES domain setup automation** — DNS records and SES console steps are documented but not scripted
- **GDPR data export / right-to-erasure endpoint** — deferred to a future compliance ticket
- **Email template visual editor** — template is code-only for this version
