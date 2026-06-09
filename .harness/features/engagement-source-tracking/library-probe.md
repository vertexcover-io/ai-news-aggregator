# Library Probe — engagement-source-tracking

> **Run at:** 2026-06-09
> **Verdict:** PASS

## Summary
| Library | Health | Smoke | Final |
|---|---|---|---|
| posthog-js@1.374.0 | trusted | VERIFIED | SELECTED |

The feature's **new** code (URL tagging via `withUtmSource`) is pure-internal string
manipulation with **no external dependency**. The only external belief the design
relies on is PostHog's existing `utm_*` auto-capture — already integrated and live in
`packages/web`. That belief was probed and confirmed.

## Selected
- **posthog-js** for the "auto-capture `utm_source` from the landing URL onto a `$pageview`" use case.
  Evidence: `.harness/runtime/engagement-source-tracking/probes/posthog-js/probe.log`
  ```json
  { "ok": true,
    "sample": { "event": "$pageview", "utm_source": "linkedin",
                "$pathname": "/archive/3f9a2c1e-…" } }
  ```
  Method: jsdom landing URL `…/archive/<uuid>?utm_source=linkedin`, `posthog.init` with a
  `before_send` hook that inspects the event and returns `null` (drops it — zero network egress),
  then `posthog.capture("$pageview")`. The captured event carried `utm_source: "linkedin"` and the
  bare `$pathname` (confirming per-digest breakdown is free, per design).

## Pivot Log
None — primary library verified on first probe.

## Setup Needed
None. `posthog-js` + `@posthog/react` already installed; capture path already live.
(Production capture additionally requires `POSTHOG_ENABLED=true` + `POSTHOG_PROJECT_TOKEN`,
already wired via `/api/public/analytics-config` — out of scope for this feature.)

## Resolution
Not escalated.

<!-- LP:VERDICT:PASS -->
