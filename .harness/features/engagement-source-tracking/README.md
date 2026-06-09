# Engagement Source Tracking

> **Verification:** ✅ PASS — see [verification/proof-report.md](verification/proof-report.md) · Quality gate: `QG:VERDICT:PASS`
> **PR:** https://github.com/vertexcover-io/ai-news-aggregator/pull/279

## Summary

Tags the archive links we publish to **email**, **LinkedIn**, and **X** with
`utm_source=<channel>`, so PostHog — which already auto-captures `utm_*` on every
`$pageview` — attributes incoming archive traffic to its origin channel. **Direct** traffic
(no UTM) appears natively as `(none)`. The capture side needed **zero new web code**; the
change is a small shared URL-tagging helper plus wiring it into the three notifier call
sites. The dashboard lives in PostHog's UI (insight spec documented, no in-app dashboard
code). Per-digest breakdown is free via PostHog's `$pathname` (the run UUID is in the path),
so no `utm_campaign` was added.

## What changed

- **`@newsletter/shared/utils`** — new pure `withUtmSource(url, source)` + `UtmSource` union
  (`"email" | "linkedin" | "twitter"`), built on the `URL` API (robust to trailing slashes,
  existing query params, encoding).
- **Pipeline notifiers** — email (archive ribbon + "Browse every issue →" home CTA → `email`),
  LinkedIn reply (→ `linkedin`), X reply (→ `twitter`). External per-item article links and
  the footer "subscribed at" provenance link are deliberately left untagged.

## Reviewer index

| Artifact | What it is |
|----------|-----------|
| [design.md](design.md) | Brainstorm design — problem, approach, diagrams, decisions |
| [spec.md](spec.md) | EARS requirements (REQ/EDGE) + verification matrix + scenarios |
| [plan.md](plan.md) | 2-phase implementation plan + context-map gate |
| [library-probe.md](library-probe.md) | posthog-js utm-capture probe — VERIFIED |
| [posthog-dashboard.md](posthog-dashboard.md) | PostHog insight spec to create the dashboard |
| [verification/proof-report.md](verification/proof-report.md) | Functional verification verdict |
| [verification/adversarial-findings.md](verification/adversarial-findings.md) | 19 adversarial scenarios — 0 breaks |

## Library probe

`posthog-js@1.374.0` — **VERIFIED** (already installed/live in prod). Probe proved it
auto-captures `utm_source` from the landing URL onto a `$pageview` with zero network egress
(event dropped via `before_send`). No alternatives needed.

## Tests

11 unit tests across the matrix (shared helper 7 + pipeline notifiers 4); pipeline suite
1133/1133, shared 388/388. End-to-end capture proven by the VS-0 probe (REQ-007) and the
no-utm direct case (EDGE-004).
