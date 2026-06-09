# PostHog Error Tracking (supersedes the custom incident system #267)

> **Verification:** ✅ PASS — [verification/proof-report.md](verification/proof-report.md)
> **Quality gate:** ✅ PASS (8 checks, 0 blocked)
> **PR:** _(filled in after creation)_

## Summary

Implements error tracking on the already-adopted PostHog platform across `api` + `pipeline`,
plus a rebuilt-minimal run-health degradation evaluator emitted as PostHog custom events. This
gives the operator grouped error views + native alerting (issue created/reopened, spike
detection, and a `pipeline_run_degraded` insight alert → Slack) **without** the bespoke in-house
incident system proposed in the still-open PR #267 — which this work supersedes.

Key context discovered during brainstorm: PR #267 is **unmerged and absent from `main`**, and
PostHog was **already integrated for analytics** (`posthog-node@5.34.2` in api, `posthog-js` in
web). So this is a clean, additive implementation — not a deletion/migration — and adds **no new
env vars** (the existing `POSTHOG_PROJECT_TOKEN`/`POSTHOG_HOST`/`POSTHOG_ENABLED` are reused).
Every capture path is a silent no-op when PostHog is unconfigured.

## What changed

- **shared**: new `@newsletter/shared/analytics` subpath — pure `resolvePostHogConfig` (moved from
  api) + pure `evaluateRunHealth` degradation evaluator (threshold 0.3).
- **api**: `captureException` helper, a Hono `app.onError` (captures ≥500 / unhandled only, skips
  <500 HTTPExceptions), and `uncaughtException`/`unhandledRejection` crash handlers (capture →
  bounded flush → exit).
- **pipeline**: `posthog-node@5.34.2` dependency + a process-level client; capture wired into the
  3 BullMQ `failed` listeners (terminal attempt only), crash handlers, and shutdown flush.
- **pipeline**: `finalizeRun` emits one `pipeline_run_degraded` event per degradation finding.
- **docs**: [alerts-setup.md](alerts-setup.md) — operator runbook for the PostHog UI alert config.

## Reviewer index

| Artifact | Purpose |
|----------|---------|
| [design.md](design.md) | Problem, context, chosen approach, diagrams, dependency + fallback chain |
| [spec.md](spec.md) | EARS requirements (16 REQ + 7 EDGE) + verification matrix |
| [plan.md](plan.md) | 5-phase implementation plan + context-map decisions/standards honored |
| [library-probe.md](library-probe.md) | posthog-node verdict (API surface VERIFIED; live ingestion UNTESTABLE — no token) |
| [alerts-setup.md](alerts-setup.md) | PostHog UI alert configuration runbook |
| [verification/proof-report.md](verification/proof-report.md) | Functional verification verdict (PASS) |
| [verification/adversarial-findings.md](verification/adversarial-findings.md) | 19 break-attempt scenarios (no confirmed breaks) |

## Library probe

- **Selected:** `posthog-node@5.34.2` (already a prod dependency). API surface (`captureException`,
  `capture`, `flush`, `shutdown`) VERIFIED against the installed version; no-throw confirmed.
- **UNTESTABLE:** live ingestion to a real PostHog project (no `POSTHOG_PROJECT_TOKEN` in
  `.env.harness`) — acceptable, SDK already in prod analytics use. No fallback needed.

## Follow-up (operator)

- Close PR #267 as superseded by this work.
- Configure the PostHog alerts per [alerts-setup.md](alerts-setup.md).
- Optionally add a `POSTHOG_PROJECT_TOKEN` to `.env.harness` to enable live-ingestion verification.
