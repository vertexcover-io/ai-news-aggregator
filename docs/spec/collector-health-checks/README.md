# Collector Health Checks

**Verification verdict:** ✅ PASS — see [verification/proof-report.md](verification/proof-report.md)
(functional-verify PASSED, UI claim C7-015 live-proven via Playwright; quality gate 9/9 PASS).

**PR:** https://github.com/vertexcover-io/ai-news-aggregator/pull/246

## Summary

Proactive per-collector health checks for the five live collectors (HN, Reddit, Twitter/X, Blog/Web,
Web Search). An operator can probe each collector — or all enabled ones — from `/admin/settings`
(per-row "Check" + a "Check all" control), and an automatic check runs ~30 minutes before each
scheduled pipeline run (re-derived whenever the pipeline schedule time changes). Each probe exercises
the collector's real auth-resolve → live-fetch → parse path with the operator's saved config, so a
pass means the collector's credentials, egress, API, and response shape currently work (the Blog
check is crawl-only by decision — it does not run LLM discovery). Results persist per collector in
Redis with no expiry, surface in a modal with live polling, and any failure posts one consolidated,
trigger-tagged Slack message. Runs on a **dedicated, non-blocking** `collector-health` queue/worker —
no DB migration, no new env var.

## Artifacts

| Doc | Purpose |
|-----|---------|
| [design.md](design.md) | Architecture, decisions (AD-1…AD-8), requirements (F/NF/E), diagrams |
| [spec.md](spec.md) | EARS requirements (REQ-001…023), edge cases, verification matrix |
| [plan.md](plan.md) | 7-phase implementation plan + phase graph + codebase context |
| [library-probe.md](library-probe.md) | Dependency trust gate — verdict `NOT_APPLICABLE` (no new library) |
| [learnings.md](learnings.md) | Pipeline-friction learnings from this run |
| [verification/proof-report.md](verification/proof-report.md) | Functional-verify verdict + live UI proof (C7-015) |
| [verification/adversarial-findings.md](verification/adversarial-findings.md) | Role-swap break-it pass (18 scenarios, 0 defects) |

## Library probe

`NOT_APPLICABLE` — introduces no new external library; reuses already-integrated deps (Algolia/HN,
Reddit RSS, rettiwt-api, Crawlee, Tavily, ioredis, BullMQ, Radix Dialog, react-query). Liveness of
those services is validated by the feature itself at runtime.

## Key facts

- **Queue isolation:** dedicated `collector-health` BullMQ queue + worker; the `processing` worker
  is intentionally not `concurrency:1`.
- **Persistence:** Redis key `collector-health:<collector>` with no TTL; snapshot always returns all
  5 collectors (synthesizing `never`).
- **Auto-check:** `reconcileCollectorHealthSchedule` upserts cron = `pipelineTime − 30 min`,
  re-derived on every settings save; removed when scheduling is disabled.
- **Slack:** one consolidated message per failed check (manual + scheduled, tagged); no archive
  marker; no-op when `SLACK_WEBHOOK_URL` unset.
