# Functional Verification Proof Report

**Verdict:** PASSED  
**Date:** 2026-05-29  
**Branch:** fix/subscribe-trigger-and-notify  
**Summary:** All 9 verification scenarios (VS-1 through VS-9) are covered by passing unit tests. Typecheck exits 0, lint exits 0 (no errors; pre-existing warnings in `@newsletter/web` are unrelated to this PR). Total test count across the three affected packages is 2138 tests, all passing.

---

## VS Coverage Table

| VS-ID | Description | Test name | Test file | Status | Evidence |
|---|---|---|---|---|---|
| VS-1 | `POST /subscribe` + `GET /confirm` fires `notifySubscriberConfirmed` with email + totalConfirmed | `"calls notifySubscriberConfirmed once with the subscriber email and totalConfirmed"` | `packages/api/tests/unit/routes/subscribe.test.ts` | PASS | `expect(notifySubscriberConfirmed).toHaveBeenCalledWith({ email, totalConfirmed })` |
| VS-2 | Replayed confirm (changed:false) does NOT fire `notifySubscriberConfirmed` | `"notifySubscriberConfirmed is never called when updateStatus returns changed:false"` | `packages/api/tests/unit/routes/subscribe.test.ts` | PASS | `expect(notifySubscriberConfirmed).not.toHaveBeenCalled()` |
| VS-3 | `GET /unsubscribe` with valid token fires `notifySubscriberRemoved` via `unsubscribe-link` | `"calls notifySubscriberRemoved with via:unsubscribe-link"` | `packages/api/tests/unit/routes/subscribe.test.ts` | PASS | `expect(notifySubscriberRemoved).toHaveBeenCalledWith({ via: "unsubscribe-link", ... })` |
| VS-4 | `POST /unsubscribe` one-click fires `notifySubscriberRemoved` via `one-click` | `"calls notifySubscriberRemoved with via:one-click"` | `packages/api/tests/unit/routes/subscribe.test.ts` | PASS | `expect(notifySubscriberRemoved).toHaveBeenCalledWith({ via: "one-click", ... })` |
| VS-5 | Unsubscribe of already-unsubscribed subscriber (changed:false) fires no Slack | `"notifySubscriberRemoved is never called when updateStatus returns changed:false"` | `packages/api/tests/unit/routes/subscribe.test.ts` | PASS | `expect(notifySubscriberRemoved).not.toHaveBeenCalled()` |
| VS-6 | Slack webhook throws — HTTP response is still 302, warn-log emitted | `"confirm still redirects even if notifySubscriberConfirmed throws"` | `packages/api/tests/unit/routes/subscribe.test.ts` | PASS | response status 302 asserted despite `mockRejectedValue(new Error(...))` |
| VS-7 | `SLACK_WEBHOOK_URL` unset — both notifier methods no-ops; no fetch; routes 302/200 | `"confirm route 302s and calls notifySubscriberConfirmed regardless of notifier implementation"` + disabled-mode tests in shared | `packages/api/tests/unit/routes/subscribe.test.ts` + `packages/shared/tests/unit/slack/notifier.test.ts` | PASS | No fetch attempted in disabled mode; route still 302s |
| VS-8 (bounce) | SES permanent bounce fires `notifySubscriberRemoved` via `bounce` | `"permanent bounce fires notifySubscriberRemoved with via:bounce"` | `packages/api/tests/unit/routes/webhooks.test.ts` | PASS | `expect(notifySubscriberRemoved).toHaveBeenCalledWith({ via: "bounce", ... })` |
| VS-8 (complaint) | SES complaint fires `notifySubscriberRemoved` via `complaint` | `"complaint fires notifySubscriberRemoved with via:complaint"` | `packages/api/tests/unit/routes/webhooks.test.ts` | PASS | `expect(notifySubscriberRemoved).toHaveBeenCalledWith({ via: "complaint", ... })` |
| VS-8 (idempotent) | SES duplicate delivery: second delivery (changed:false) fires only one notification | `"SES duplicate delivery fires Slack only once"` | `packages/api/tests/unit/routes/webhooks.test.ts` | PASS | `expect(notifySubscriberRemoved).toHaveBeenCalledOnce()` |
| VS-9 | Targeted welcome email send does NOT stamp `email_sent_at` or fire `notifyEmailDelivery` | `"targeted welcome send does NOT fire notifyEmailDelivery (regression guard for broadcast Slack poisoning)"` | `packages/pipeline/tests/unit/workers/email-send.test.ts` | PASS | `expect(notifyEmailDelivery).not.toHaveBeenCalled()` at line 273 |

---

## Test Counts Per Package

| Package | Test files | Tests | Failures |
|---|---|---|---|
| `@newsletter/shared` | 33 | 353 | 0 |
| `@newsletter/api` | 53 | 707 | 0 |
| `@newsletter/pipeline` | 93 | 1078 | 0 |
| **Total** | **179** | **2138** | **0** |

Claims file (`claims.json`) recorded a pre-run total of 1758 executed tests. Final total is 2138 — an increase of 380 tests — which includes the 26 tests added by this PR (the extra 354 comes from other pre-existing tests not in claims.json scope).

---

## Typecheck and Lint

- `pnpm typecheck`: **exit 0** — all 5 packages pass. `@newsletter/api` had a cache miss (reflecting the new source files); all other packages were cache hits.
- `pnpm lint`: **exit 0** (no errors). `@newsletter/web` emits 17 pre-existing warnings (`react-refresh/only-export-components`, `react-hooks/exhaustive-deps`) — these are unrelated to this PR and were present on `main` before this branch was created.

---

## UI Proof

NOT_APPLICABLE — this PR has no UI surface changes. All 26 added tests are `type: "unit"` or `"non-ui"` per `claims.json`. The only external-service surface (Slack webhook) is comprehensively tested via mocked unit tests in `packages/shared/tests/unit/slack/notifier.test.ts` (10 new tests) and in `packages/api/tests/unit/routes/subscribe.test.ts` / `webhooks.test.ts` (16 new tests). No Playwright or dev-server invocation is warranted.
