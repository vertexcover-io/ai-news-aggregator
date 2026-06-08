# Centralized Observability & Reliable Alerting

> **Verification:** ✅ PASSED — see [verification/proof-report.md](verification/proof-report.md)
> **Quality gate:** ✅ PASS (11/11 checks, mutation 4/4 killed)
> **PR:** _(filled in below)_

## What was built

A centralized, internal incident-alerting system so the operator is notified the moment
anything breaks — closing the gap that let the last run's enrichment failures
(`arxiv.org — net::ERR_TUNNEL_CONNECTION_FAILED`) pass silently with no Slack alert.

The root cause was never a flaky Slack transport — **no code path sent an alert on errors
at all**. This feature adds the missing instrumentation plus a durable, deduplicated alert
pipeline:

- **One `incidents` table** is the centralized record of every break across api + pipeline.
- **A shared `AlertDispatcher`** persists each incident durably *first*, then attempts Slack
  delivery — deduplicating by fingerprint with a per-fingerprint cooldown so 30 identical
  failures collapse into one alert with an occurrence count (no fatigue), and never throwing
  into the caller (a capture failure can't break a run or a request).
- **Instrumentation hooks** route every break to the dispatcher: process crash handlers,
  BullMQ `failed` listeners, link-enrichment/collector failure sites, a run-finalization
  **degradation evaluator** (enrichment failure-rate, zero-yield sources, partial publish),
  and a Hono 5xx middleware.
- **At-least-once delivery:** a bounded `alert-delivery` sweep retries undelivered incidents,
  so an alert is never silently lost even if Slack is momentarily unreachable.
- **An `/admin/incidents` page** lists every incident across runs with severity/status
  filters and Resolve / Mute actions — the centralized tracking surface.

Decision (chosen by the operator): **build internal, no new vendor** (no Sentry/Datadog),
**Slack** channel, scope = **errors + degradation**.

## Reviewer index

| Artifact | What it is |
|----------|------------|
| [design.md](design.md) | Problem, approaches, chosen design, diagrams, decisions |
| [spec.md](spec.md) | EARS requirements (REQ-001..026), edge cases, verification matrix |
| [plan.md](plan.md) | 4-phase implementation plan + context-map decisions honored |
| [library-probe.md](library-probe.md) | NOT_APPLICABLE — pure-internal, reuses the existing Slack webhook |
| [learnings.md](learnings.md) | Task-specific learnings captured |
| [verification/proof-report.md](verification/proof-report.md) | The PASS verdict + UI-claim screenshots |
| [verification/adversarial-findings.md](verification/adversarial-findings.md) | Role-swap break attempts + results |

**Library-probe:** NOT_APPLICABLE — no new external dependency; reuses the already-integrated
`SLACK_WEBHOOK_URL` via the existing `postToWebhook` primitive.

## Phases

1. **shared** — `incidents` schema (migration 0039) + types + constants + `AlertDispatcher` + Slack alert channel + `evaluateRunHealth`.
2. **pipeline** — `IncidentRepository` (dedup ON CONFLICT upsert) + crash/job/enrichment capture + degradation hook + `alert-delivery` worker (retry sweep).
3. **api** — `IncidentRepository` + Hono 5xx capture + crash handlers + `GET`/`PATCH /api/admin/incidents` (behind `requireAdmin`) + alert-delivery scheduler.
4. **web** — `/admin/incidents` page (list, filters, Resolve/Mute, empty state) + nav entry.

## Notes for the reviewer

- **Tests never send a real Slack message** — alert *triggering* is asserted via the incident
  row / a stubbed `AlertChannel`; no test points `SLACK_WEBHOOK_URL` at a real `hooks.slack.com`.
- **New decisions recorded** in the context map (D-115..D-118): incidents use their own
  fingerprint+cooldown dedup (parallel to D-107/D-111); the alert-delivery queue follows the
  D-110 dedicated-queue pattern, with the pipeline **idempotently self-registering** its sweep
  scheduler (deliberate redundancy so the worker is self-sufficient — `upsertJobScheduler` is
  idempotent and both sides use the same key + interval).
- **Backwards compatible:** additive table + Slack builder only; legacy runs with null
  telemetry produce no false degradation incident; `SLACK_WEBHOOK_URL` unset → incidents still
  tracked in the admin page, delivery skipped.
