# Apify-Based Reddit Collector

**Verification verdict:** ✅ PASSED — see [verification/proof-report.md](verification/proof-report.md)
**PR:** https://github.com/vertexcover-io/ai-news-aggregator/pull/291 → `feature/multi-tenant`

## Summary

Replaces the rate-limited Reddit RSS collector (batch + single-post add-by-URL) with the
Apify actor `trudax/reddit-scraper-lite` via the official `apify-client` SDK, and removes all
Reddit RSS/jsdom code. Posts now carry **real engagement** (upvotes + comment count), which the
RSS path always zeroed. The Apify API token is a **platform-level secret** stored encrypted in
`app_credentials` (`apify_api_token`), managed **only by a super-admin** through a section that
renders on `/admin/settings` solely for `super_admin` sessions; tenant admins never see it. The
token resolves **DB-first** with an `APIFY_API_KEY` env-var fallback (a row that fails to decrypt
is treated as unconfigured — no silent env fallthrough).

## Artifacts

| Document | What it is |
|---|---|
| [design.md](design.md) | Brainstorm output — problem, requirements (F/NF/EC), approach, diagrams |
| [spec.md](spec.md) | EARS requirements (REQ/EDGE), verification matrix, scenarios |
| [plan.md](plan.md) | 5-phase implementation plan + phase graph + codebase context |
| [library-probe.md](library-probe.md) | Trust gate — `apify-client` + actor verified live; **authoritative actor input/output contract** |
| [learnings.md](learnings.md) | Task-specific notes + pointers to the two global lessons captured |
| [verification/proof-report.md](verification/proof-report.md) | Functional-verification verdict (incl. live VS-0 probe + Playwright UI proof) |
| [verification/adversarial-findings.md](verification/adversarial-findings.md) | Role-swap adversarial pass (15 scenarios, 0 defects) |

## Library probe

- **Selected:** `apify-client` (npm 2.23.4, trusted) + actor **`trudax/reddit-scraper-lite`**
  (PAY_PER_EVENT, $0.004/result, 27.7k users) — verified live on both flows (subreddit listing +
  single post). No fallback needed.
- Cost: ~$0.004/post; a full 7-sub × 25-post run ≈ $0.74/day. Latency ~60–120s/run (Puppeteer
  per-post). Transient Reddit 403s are auto-retried by the actor (residential proxy).

## What this does NOT do

Posts-only (no comment collection); no per-tenant Apify accounts; the token is hidden from tenant
admins; non-Reddit collectors unchanged; the actor id is hardcoded (one-file swap).

## Merge note

Branched from `feature/multi-tenant`; **PR targets `feature/multi-tenant`** (not `main`).
`feature/multi-tenant` advanced after branch-point and also edited
`packages/web/src/pages/SettingsPage.tsx` — expect a small merge reconciliation there.
