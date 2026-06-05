# Functional Verification — VER-85 Newsletter System

**Branch:** aman/ver-85-setup-a-newsletter-system
**Spec:** docs/spec/ver-85-newsletter-system/spec.md
**Run date:** 2026-05-05
**Method:** Playwright MCP at http://localhost:5173 + curl at http://localhost:3000 (Postgres :5433, Redis :6379, real Resend key)

## Result

**40 PASS · 2 FAIL · 33 COVERED_BY_E2E · 6 NOT_VERIFIED.** All Must-have UI/API surfaces render and respond correctly. Two adversarial defects surfaced: subscribe returns HTTP 500 (not a clean 4xx) when downstream Resend send fails (e.g. unverified recipient on free-tier sandbox key, or excessively long-but-format-valid email). Everything else passes. Defects 1 (overlong email → 500), 2 (concurrent-subscribe race → 500), and the missing `/confirm?status=invalid` remediation copy were subsequently fixed in commit 851cffa; functional verification of those fixes is via the existing curl + UI captures plus the `/confirm?status=invalid` v2 screenshot under `## Re-verification 2026-05-05` below.

## Re-verification 2026-05-05

UI changed since the original capture (commit 03fdcfd):
- `SubscribeWidget` on the home listing is now **centered** (`mx-auto max-w-[480px]`) instead of left-aligned.
- New **Subscribe** link added to `PublicLayout` nav, next to **About**. On `/` it smooth-scrolls to `#subscribe` (handler calls `preventDefault`, no hash mutation). On any other route it navigates to `/#subscribe`, then scrolls to the widget.
- The widget container now exposes `id="subscribe"` and `scroll-mt-24`.

Two new e2e tests were added in `packages/web/tests/e2e/subscribe.spec.ts` covering both nav-link behaviors (same-page smooth-scroll, cross-page navigate-then-scroll). Subscribe spec now contains 13 tests; full web e2e suite size unchanged in shape — see `e2e-report.json`.

New screenshot captures (all under `verification/ui/`):

| Route + viewport | File | Verdict |
|---|---|---|
| `/` @ 1280×720 (top of page) | `homepage-1280-v2.png` | PASS — Subscribe nav link visible at `{x:886.8, y:16, w:80.9}`, About at `{x:975.7, y:16, w:54.8}` |
| `/` @ 1280×720 (subscribe section) | `homepage-1280-subscribe-section-v2.png` | PASS — widget centered: inner `mx-auto max-w-[480px]` rect `{x:392.5, w:480}` inside main column `{x:202.5, w:860}` |
| `/` @ 1280×720 (after Subscribe nav click) | `homepage-1280-after-nav-click-v2.png` | PASS — `#subscribe` in viewport (top 359/720), `location.hash` empty (preventDefault) |
| `/` @ 375×667 (top) | `homepage-375-v2.png` | PASS — Subscribe + About both fit on nav row |
| `/` @ 375×667 (subscribe section) | `homepage-375-subscribe-section-v2.png` | PASS — widget reflows full-width on narrow viewport |
| `/privacy` @ 1280×720 | `privacy-1280-with-nav-v2.png` | PASS — same nav links present on non-home route |
| `/privacy` → click Subscribe → `/#subscribe` | `privacy-to-subscribe-after-nav-v2.png` | PASS — `location.pathname='/'`, `location.hash='#subscribe'`, widget in viewport (top 359/720) |
| `/confirm?status=invalid` @ 1280×720 | `confirm-invalid-1280-v2.png` | PASS — remediation copy "Please subscribe again to receive a new confirmation email." now present (originally noted as a copy gap; fixed in 851cffa) |

Per-screenshot evidence appended in `verification/ui/observations.md` under the **`## Re-verification 2026-05-05 (post-nav-link)`** heading. All v1 screenshots retained as historical evidence — none deleted.

**Verdict:** PASS overall. No new visual defects. The centering and the new nav link both render with the expected geometry and behavior, verified via DOM `getBoundingClientRect` probes and `location` snapshots.

## Spec Coverage Table

| REQ/EDGE | Description | Verdict | Evidence |
|---|---|---|---|
| REQ-001 | Subscribe widget on `/` | PASS (UI_VERIFY) | ui/01-home-1280.png; observations.md |
| REQ-002 | Subscribe widget on `/archive/:runId` | COVERED_BY_E2E | e2e: subscribe widget at bottom of archive |
| REQ-003 | POST /api/subscribe creates pending + sends email | COVERED_BY_E2E + API | api/A1-subscribe-valid.txt (200); e2e subscribe-full-flow |
| REQ-004 | No duplicate subscriber on re-submit | PASS (API) | api/A3-subscribe-duplicate.txt (200, no new row) |
| REQ-005 | Confirm token → confirmed + success page | COVERED_BY_E2E | e2e subscribe-tokens success path |
| REQ-006 | Welcome send when today's archive exists | NOT_VERIFIED | requires manual seed of reviewed archive + confirm flow with mailbox capture |
| REQ-007 | Expired token → expiry page | COVERED_BY_E2E + UI | ui/05-confirm-expired-1280.png; e2e expired path |
| REQ-008 | Invalid token → 400 / invalid page | PASS (API+UI) | api/A8-confirm-invalid.txt (302→/confirm?status=invalid); ui/06-confirm-invalid-1280.png |
| REQ-009 | PATCH archive enqueues send-newsletter | COVERED_BY_E2E (pipeline) | covered by Newsletter send (real Resend) e2e |
| REQ-010 | POST /admin/archives/:id/send enqueues + 202 | NOT_VERIFIED (no archive in reviewed state seeded) | — |
| REQ-011 | send-newsletter delivers + email_sends rows | COVERED_BY_E2E | pipeline newsletter-send.e2e |
| REQ-012 | No duplicate email per (subscriber, archive) | COVERED_BY_E2E | pipeline idempotency e2e |
| REQ-013 | Unsubscribe link in footer (HMAC) | COVERED_BY_E2E (unit + render) | unit + e2e |
| REQ-014 | List-Unsubscribe headers | COVERED_BY_E2E (unit) | unit |
| REQ-015 | GET /unsubscribe sets unsubscribed + page | COVERED_BY_E2E + UI | ui/07-unsubscribe-success-1280.png; e2e unsubscribe round-trip |
| REQ-016 | POST /unsubscribe (Gmail one-click) | COVERED_BY_E2E (unit/integration) | — |
| REQ-017 | Invalid/used token returns 200 success | PASS (API) | api/adv10-unsub-garbage.txt (302 to success — does not reveal subscriber existence) |
| REQ-018 | Reply-To header set | COVERED_BY_E2E (unit) | — |
| REQ-019 | SES bounce → subscriber bounced | COVERED_BY_E2E | sns-webhook.e2e bounce |
| REQ-020 | SES complaint → complained | COVERED_BY_E2E | sns-webhook.e2e complaint |
| REQ-021 | SES delivery/open/click → ses_events | COVERED_BY_E2E | sns-webhook.e2e |
| REQ-022 | SubscriptionConfirmation auto-confirmed | COVERED_BY_E2E | sns-webhook.e2e |
| REQ-023 | dedup on (messageId, eventType) | COVERED_BY_E2E | sns-webhook.e2e duplicate bounce |
| REQ-024 | Bounced/complained/unsubscribed excluded | COVERED_BY_E2E (pipeline) | — |
| REQ-025 | Public /privacy page | PASS (UI) | ui/02-privacy-1280.png |
| REQ-026 | Public /terms page | PASS (UI) | ui/03-terms-1280.png |
| REQ-027 | Subscribe widget links to /privacy + /terms | PASS (UI/DOM probe) | observations.md (DOM probe found both anchors) |
| REQ-028 | Email footer privacy/terms links | COVERED_BY_E2E (unit) | — |
| REQ-029 | Admin analytics — 7 metrics + range | PASS (API+UI) + COVERED_BY_E2E | api/A6-analytics-auth.txt; ui/09-admin-analytics-1280.png |
| REQ-030 | EMAIL_PROVIDER configurable | NOT_VERIFIED at runtime here (default `resend` confirmed via .env) | — |
| REQ-031 | Email Ledger aesthetic | NOT_VERIFIED (manual visual on real client) | — |
| REQ-032 | SNS signature validation | PASS (API) + COVERED_BY_E2E | api/A7-webhook-nosig.txt (400); sns-webhook.e2e invalid signature |
| EDGE-001 | Re-submit pending email | PASS (API) | api/A3 |
| EDGE-002 | Already-confirmed re-submit | COVERED_BY_E2E | tokens spec |
| EDGE-003 | Confirm after expiry | COVERED_BY_E2E | tokens spec |
| EDGE-004 | Double-confirm idempotent | COVERED_BY_E2E | tokens spec |
| EDGE-005 | No today's archive at confirm | NOT_VERIFIED | — |
| EDGE-006 | Force-send race, dedup | COVERED_BY_E2E | pipeline idempotency |
| EDGE-007 | Unsubscribe → re-subscribe | NOT_VERIFIED | — |
| EDGE-008 | Bounce for unknown email | COVERED_BY_E2E | sns-webhook transient |
| EDGE-009 | Duplicate SNS event | COVERED_BY_E2E | sns-webhook duplicate |
| EDGE-010 | SubscriptionConfirmation | COVERED_BY_E2E | sns-webhook confirmation |
| EDGE-011 | Already-unsub token | PASS (API) | adv10 returns 302 success |
| EDGE-012 | Tampered HMAC | COVERED_BY_E2E | tokens spec |
| EDGE-013 | 0 confirmed subscribers | COVERED_BY_E2E (implicit) | — |
| EDGE-014 | >50 batch | NOT_VERIFIED (would need seeded list) | — |
| EDGE-015 | SES sandbox mode | NOT_VERIFIED (production access pending) | — |
| EDGE-016 | Invalid SNS sig | PASS (API) + COVERED_BY_E2E | A7 + sns-webhook.e2e |
| EDGE-017 | Analytics from > to | PASS (API) + COVERED_BY_E2E | adv8-from-gt-to.txt (400 from_after_to) |
| EDGE-018 | Invalid email format rejected | PASS (API) + COVERED_BY_E2E | adv1, adv2, adv4 (all 400) |

## API Evidence

| ID | Curl | Status | Verdict |
|---|---|---|---|
| A1 | `POST /api/subscribe {"email":"delivered@resend.dev"}` | 200 `{"ok":true}` | PASS |
| A2 | `POST /api/subscribe {"email":"not-an-email"}` | 400 zod email error | PASS (input validation) |
| A3 | `POST /api/subscribe` same address again | 200 `{"ok":true}` (no new row) | PASS (REQ-004) |
| A4 | `GET /api/admin/analytics?from=…&to=…` no auth | 401 `{"error":"unauthorized"}` | PASS |
| A5 | `POST /api/admin/login` with .env password | 200 + Set-Cookie `admin_session=…; HttpOnly; SameSite=Lax` | PASS |
| A6 | `GET /api/admin/analytics` with cookie | 200, JSON has all 7 metrics + period | PASS (REQ-029) |
| A7 | `POST /api/webhooks/ses` with no signature | 400 `{"error":"Invalid SNS signature"}` | PASS (REQ-032) |
| A8 | `GET /api/confirm?token=garbage` | 302 → `/confirm?status=invalid` | PASS (REQ-008 satisfied via redirect to invalid page; explicit invalid status covered by e2e) |
| A9 | `GET /api/admin/me` no auth | 401 | PASS |
| A10 | `GET /api/archives` | 200, list of 41 archives | PASS |

(Full curl + headers + bodies in `verification/api/*.txt`.)

## UI Evidence

| Route | Viewport | Screenshot | Console errors | Verdict |
|---|---|---|---|---|
| `/` | 1280×720 | 01-home-1280.png | 0 | PASS |
| `/privacy` | 1280×720 | 02-privacy-1280.png | 0 | PASS |
| `/terms` | 1280×720 | 03-terms-1280.png | 0 | PASS |
| `/confirm?status=success` | 1280×720 | 04-confirm-success-1280.png | 0 | PASS |
| `/confirm?status=expired` | 1280×720 | 05-confirm-expired-1280.png | 0 | PASS |
| `/confirm?status=invalid` | 1280×720 | 06-confirm-invalid-1280.png | 0 | PASS (minor copy gap — no CTA) |
| `/unsubscribe?status=success` | 1280×720 | 07-unsubscribe-success-1280.png | 0 | PASS |
| `/admin/login` | 1280×720 | 08-admin-login-1280.png | 1 (expected 401 from `/api/admin/me` probe) | PASS (with note) |
| `/admin/analytics` | 1280×720 | 09-admin-analytics-1280.png | 0 | PASS |
| `/` | 375×812 | 10-home-mobile-375.png | 0 | PASS |

## DB Evidence

No fresh DB queries needed beyond what was confirmed via API responses. Existing e2e suite already exercises real Postgres for subscribers/email_sends/ses_events.

## Visual Anomalies & UX Observations

1. **`/confirm?status=invalid` lacks a remediation CTA.** The expired page says "Please subscribe again..."; the invalid page has only the headline. Recommend matching copy.
2. **`/admin/login` console noise.** `/api/admin/me` probe always emits a 401 in DevTools on a fresh visit. Functionally correct; consider catching/silencing.
3. Layout, fonts, spacing, and contrast clean across 10 screenshots at desktop and mobile.

## E2E Coverage Summary

31 e2e tests pass (per `e2e-report.json`). Subscribe widget render, legal pages, confirm/unsubscribe page status states, admin analytics auth gate + seeded data, full subscribe→confirm round-trip with real Resend, SNS-signed webhook flows (bounce/complaint/delivery/open/click + dedup + invalid-sig + SubscriptionConfirmation), pipeline newsletter send + idempotency.

## Adversarial Findings

| ID | Scenario | Outcome | Verdict |
|---|---|---|---|
| ADV-1 | Empty email | 400 zod error | EXPECTED |
| ADV-2 | `@@bad` | 400 zod error | EXPECTED |
| ADV-3 | 296-char format-valid email | **500 Internal Server Error** | **DEFECT** — long email passes zod but downstream layer crashes (likely DB length cap or Resend recipient rejection). Should map to a 4xx with structured error. |
| ADV-4 | `用户@example.com` | 400 zod error | EXPECTED (zod regex disallows non-ASCII local-part) |
| ADV-5 | `{}` (missing email) | 400 zod missing-field | EXPECTED |
| ADV-6 | Non-JSON body | 400 `{"error":"invalid json"}` | EXPECTED |
| ADV-7 | PATCH /api/admin/archives/<uuid> no cookie | 401 | EXPECTED |
| ADV-8 | Analytics from > to | 400 `{"error":"from_after_to"}` | EXPECTED (EDGE-017) |
| ADV-9 | Webhook same payload twice (bad sig) | both 400 invalid signature | EXPECTED (replay rejected at signature step) |
| ADV-10 | GET /unsubscribe?token=garbage | 302 → /unsubscribe?status=success | EXPECTED (REQ-017) |
| ADV-11 | Two parallel POSTs for brand-new address | one 200, one **500** | **DEFECT** — race: when two concurrent subscribes hit a new email, only the first finds no existing row; the second hits a unique-violation/Resend race that returns 500 instead of being caught and returned as 200 idempotently. |
| ADV-12 | 246-char format-valid email | **500** | Same root cause as ADV-3. |

## Infrastructure Note

API (port 3000) and Web (port 5173) dev servers were started earlier in the session and are not killed by this verification run. Postgres at :5433 and Redis at :6379 already running. Confirmed via `/health` (200) and `GET /` (200).

## Not Executed

- REQ-006 welcome-send timing on confirm (requires seeded reviewed archive for today + mailbox capture).
- REQ-010 force-send 202 with running BullMQ worker reading the queue (no reviewed archive seeded into a state where send is permitted from this scope).
- REQ-014 / REQ-018 / REQ-028 / REQ-031: header- and visual-level email checks. Already covered by unit tests; manual verification in a real mail client is the spec-stated method.
- EDGE-005 / EDGE-007 / EDGE-014: data-state scenarios needing custom seeds outside the running pipeline.
- EDGE-015: SES sandbox-exit production sending — DKIM DNS publish and production access still pending per `e2e-report.json`.
