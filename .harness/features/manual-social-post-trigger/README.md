# Manual LinkedIn / X (Twitter) Post Trigger

**Verification verdict:** ✅ PASS — see [verification/proof-report.md](verification/proof-report.md).
**Quality gate:** ✅ PASS (9/9 checks).

## Summary

An admin can manually post a specific newsletter run to LinkedIn or X (Twitter) directly from
an overflow (⋮) menu on each dashboard run row, gated by a confirm dialog — without waiting for
the daily schedule. The backend reuses the existing `linkedin-post` / `twitter-post` BullMQ
workers (which already accept an optional `runId` via `resolvePublishTarget`), so no new worker
code was needed; the API only adds an admin-gated enqueue route, and the dashboard surfaces each
run's posted state (timestamps + permalinks) on `RunSummary`. Once posted, the menu item turns
into a "View post ↗" link to the platform permalink. Idempotency is the workers' existing
`*_posted_at` guard, so a manual post that races the scheduled post is safe.

## Table of Contents

| Artifact | Purpose |
|----------|---------|
| [design.md](design.md) | Problem, approaches, chosen architecture (brainstorm output) |
| [spec.md](spec.md) | EARS requirements (REQ-001..014), edge cases, verification matrix |
| [plan.md](plan.md) | 3-phase implementation plan + phase graph |
| [library-probe.md](library-probe.md) | Library trust gate — **NOT_APPLICABLE** (pure-internal, no new deps) |
| [learnings.md](learnings.md) | Task-specific learnings |
| [verification/proof-report.md](verification/proof-report.md) | Functional verification verdict + per-claim screenshots |
| [verification/adversarial-findings.md](verification/adversarial-findings.md) | Role-swap break attempts |
| [verification/screenshots/](verification/screenshots/) | Playwright MCP evidence (17 UI claims) |

## Library-probe verdict

**NOT_APPLICABLE** — no external library or third-party API introduced. The LinkedIn/X platform
calls happen inside the existing, already-probed notifier path, which this feature reuses
unchanged.

## UX decisions (user-chosen)

- **Placement:** dashboard run rows, via a per-row overflow (⋮) menu (keeps rows uncluttered).
- **Safety:** a confirm dialog fires before any live post.
- **Posted state:** the platform's menu item links to the stored permalink ("View post ↗");
  falls back to a non-link "✓ Posted" when no permalink is stored.

## PR

https://github.com/vertexcover-io/ai-news-aggregator/pull/209
