# Email Send Rate-Limit Hardening + Per-Recipient Retry

**Verification verdict:** ✅ PASS — see [verification/proof-report.md](verification/proof-report.md)
**PR:** https://github.com/vertexcover-io/ai-news-aggregator/pull/226

## Summary

The `email-send` worker hit Resend's rate limit (HTTP 429) during the 2026-05-29 incident
recovery, silently dropping two recipients with no retry. This change (a) paces all sends at
a configurable target (default **3 req/s**) via a **shared module-level pacer** that holds
across every `email-send` job invocation in the process — closing the cross-job burst that
caused the 429 — and (b) **retries each individual failed send up to 2 attempts** on
retryable Resend errors (`rate_limit_exceeded`, `application_error`, `internal_server_error`,
network/timeout), honoring the `retry-after` header (parsed from `result.headers`) and
falling back to 1s/2s exponential backoff, while failing fast on permanent errors. Failed
recipients are counted once (after retries) and surfaced in the existing Slack delivery summary.

A typed `EmailSendError` (`name`, `retryAfterMs`, `retryable`) in `@newsletter/shared` carries
the classification from the Resend provider wrapper to the retry loop. No new dependency, no
DB/schema/route/UI change. Worker `concurrency: 1` was considered and **rejected in code review**
(it would serialize all job types behind long-running `run-process`); the shared pacer is the
correct, sufficient guard.

## Artifacts

| Doc | Contents |
|-----|----------|
| [design.md](design.md) | Problem, root causes, approaches considered, chosen approach |
| [spec.md](spec.md) | 15 EARS requirements (REQ-001..015), 8 edge cases, verification matrix |
| [library-probe.md](library-probe.md) | resend@6.12.2 error shape — verified `error.name` + `result.headers['retry-after']` |
| [plan.md](plan.md) | Two-phase TDD plan |
| [verification/proof-report.md](verification/proof-report.md) | Gate verdict + test mapping (no UI claims → no Playwright, by design) |
| [verification/adversarial-findings.md](verification/adversarial-findings.md) | Break-it attempts on the rate ceiling + retry correctness |
| [learnings.md](learnings.md) | retry-after location correction; queue-concurrency-vs-pacer |

## Library probe verdict

**resend@6.12.2 — VERIFIED.** No new dependency. `result.error.name` exposes the retryable
codes; `retry-after` is on `result.headers`, not `result.error` (the wrapper previously
discarded it). Fallback chain: resend → existing SES provider → manual re-enqueue.

## Operator note

Prod needs **no env change** — `EMAIL_SEND_RATE_PER_SECOND` defaults to 3 when unset. To
retune (e.g. after a Resend plan upgrade), set `EMAIL_SEND_RATE_PER_SECOND` in
`/etc/newsletter/.env`. `.env.example` documents the variable.
