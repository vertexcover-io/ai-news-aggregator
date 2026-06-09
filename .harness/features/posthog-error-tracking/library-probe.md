# Library Probe — posthog-error-tracking

> **Run at:** 2026-06-09
> **Verdict:** PASS

## Summary

| Library | Health | Smoke | Final |
|---|---|---|---|
| posthog-node@5.34.2 | trusted (0 thresholds tripped) | VERIFIED (API surface + no-throw); live ingestion UNTESTABLE | SELECTED |

## Selected

- **posthog-node** for error tracking (`captureException`) + custom degradation events (`capture`).
  - Already a production dependency (pinned `5.34.2` in `packages/api/package.json`, in active analytics use).
  - **API surface VERIFIED** against the installed version: `captureException`, `capture`, `identify`, `flush`, `shutdown` all present (`typeof === 'function'`).
  - **No-throw VERIFIED:** constructing a client and calling `captureException(new Error(...), distinctId, props)` and `capture({event, distinctId, properties})` does not throw synchronously; `shutdown()` resolves. This proves the exact signatures the design relies on (F2/F5/F9).
  - Evidence: `.harness/runtime/posthog-error-tracking/probes/posthog-node/probe-api-surface.log`, `health.json`.
  - Health: npm latest `5.36.7`, modified `2026-06-09`, not deprecated — actively maintained.

## What is UNTESTABLE (and why it's acceptable)

- **Live ingestion → real PostHog Issue/event.** No `POSTHOG_PROJECT_TOKEN` in `.env.harness`
  (only `DEEPSEEK_API_KEY` present). The HTTP round-trip to a real PostHog project could not be
  exercised. This is acceptable because:
  1. `posthog-node` is already sending analytics events from production via the identical client
     constructor (`new PostHog(token, { host, enableExceptionAutocapture: true })`), so transport
     is proven.
  2. The NEW path (`captureException` signature + no-throw + graceful disabled behavior) is what
     the feature adds, and that is VERIFIED above against the installed package.
- The fallback chain (direct HTTP ingestion → build-our-own) was **not** needed — the primary
  SDK passed.

## Setup Needed (optional, to enable live verification)

To exercise the live ingestion path during functional-verify (and in prod), add to project-root
`.env.harness` (gitignored — confirmed):

```
POSTHOG_PROJECT_TOKEN=phc_xxx   # a PostHog project (write) API key
POSTHOG_HOST=https://us.i.posthog.com   # optional; this is the default
```

Without it, tests cover the disabled/no-op path and assert capture calls via a fake/spy client —
which is the correct test strategy regardless (no real network in unit/e2e tests).

## Resolution

Not escalated — primary library VERIFIED on package health + API surface; live ingestion
consciously deferred to documented optional setup.

<!-- LP:VERDICT:PASS -->
