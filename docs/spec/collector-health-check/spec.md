# SPEC: Collector Health Check

**Source:** docs/spec/collector-health-check/design.md
**Generated:** 2026-06-02

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Event-driven | When the admin clicks "Check Health" on a source section, the system shall enqueue a `health-check` BullMQ job for that collector type and return 202 with the job ID within 500ms | POST /api/admin/health-check/:type returns 202, job appears in BullMQ queue | Must |
| REQ-002 | Event-driven | When the admin clicks "Check All Collectors", the system shall enqueue a `health-check` BullMQ job for all enabled collector types and return 202 with the job ID | POST /api/admin/health-check returns 202, all 5 collector types in payload | Must |
| REQ-003 | Ubiquitous | Each health check strategy shall perform a real fetch and parse through the same code paths used by the production collector, validating that at least 1 valid item is returned | Every strategy returns `status: "healthy"` only if data was fetched AND parsed successfully | Must |
| REQ-004 | Event-driven | When a health check strategy fails, the system shall classify the error and produce a concise actionable message specific to the failure mode | Failed results contain an `error` field with a human-readable message ≤200 chars, no raw stack traces or error objects | Must |
| REQ-005 | Event-driven | When at least one collector fails the automatic pre-run health check, the system shall send a Slack notification listing each failed collector with its actionable error message | Slack webhook receives a message with `🩺 Collector Health Check Failed` header and per-failure details | Must |
| REQ-006 | Unwanted | If all collectors pass the automatic health check, the system shall NOT send a Slack notification | No Slack webhook call is made when all collectors are healthy | Must |
| REQ-007 | State-driven | While `scheduleEnabled` is true, the system shall maintain a BullMQ job scheduler for `health-check` at `pipelineTime - 15 minutes` | `upsertJobScheduler` is called with HEALTH_CHECK_SCHEDULER_KEY during reconcilePipelineSchedule | Must |
| REQ-008 | Event-driven | When `pipelineTime` changes via settings save, the system shall reconcile the health-check scheduler to the new `pipelineTime - 15 minutes` within the same `PUT /api/settings` response | After saving new pipelineTime, the next health-check job fires at the new offset | Must |
| REQ-009 | Unwanted | If `scheduleEnabled` is false, the system shall remove the health-check scheduler | `removeJobScheduler(HEALTH_CHECK_SCHEDULER_KEY)` is called, no health-check jobs fire | Must |
| REQ-010 | Ubiquitous | The health-check worker shall dispatch as a separate job type (`health-check`) on the existing `processing` queue without blocking other job types | Pipeline-run, email-send, linkedin-post, and twitter-post jobs can execute concurrently with health-check | Must |
| REQ-011 | Unwanted | If a collector has no configured sources or is missing its required API key, the system shall skip that collector's health check with `status: "skipped"` and NOT treat it as a failure | Skipped collectors do not appear in Slack failure notifications, are not counted as failures | Must |
| REQ-012 | Unwanted | If the same set of collectors fails with the same errors within a 1-hour window, the system shall NOT send a duplicate Slack notification | Slack notification is debounced via Redis key `health-check:last-notified` with a hash of the failure set | Must |
| REQ-013 | Event-driven | When the admin manually triggers a health check, the system shall return the result inline in the UI (green checkmark for healthy, red X for failed with error text) | Manual check result is displayed on the settings page without requiring a Slack notification | Must |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | Health-check job is enqueued while a pipeline-run is executing | The health-check runs concurrently; BullMQ handles concurrency. Pipeline is not delayed or interrupted | REQ-010 |
| EDGE-002 | All 5 collector strategies run, 2 fail, 1 is skipped (no config), 2 pass | Slack notification lists the 2 failures with their actionable messages. The 1 skipped collector is NOT listed. The 2 healthy collectors are listed in the summary line | REQ-005, REQ-011 |
| EDGE-003 | Admin triggers a single-collector health check for a disabled collector (e.g., HN enabled=false) | API returns 404 with reason "collector not enabled" — health check is not enqueued | REQ-001 |
| EDGE-004 | Auto health check fires but Slack webhook URL is not configured | Health check executes normally, failure notification is silently skipped (same behavior as existing Slack no-op) | REQ-005 |
| EDGE-005 | Blog collector health check runs but `web_config.sources[]` is empty | Strategy returns `status: "skipped"` with `reason: "no sources configured"` — not a failure | REQ-011 |
| EDGE-006 | Twitter collector health check runs but `RETTIWT_API_KEY` is not set | Strategy returns `status: "skipped"` with `reason: "API key not configured"` — not a failure | REQ-011 |
| EDGE-007 | Two manual "Check All" requests are triggered within 2 seconds | Both jobs are enqueued (different job IDs). Both run to completion. No dedup needed for manual triggers | REQ-002 |
| EDGE-008 | Pipeline time changes from 09:00 to 14:00, health check was at 08:45 | After settings save, health-check scheduler is updated to fire at 13:45. No stale 08:45 job remains | REQ-008 |
| EDGE-009 | Blog collector health check: DeepSeek API returns a valid response but discovers 0 post URLs from the listing page | Strategy returns `status: "failed"` with `error: "LLM discovery returned no posts for \"<source>\" — listing page structure may have changed"` | REQ-003, REQ-004 |
| EDGE-010 | Reddit RSS returns HTTP 200 but the XML body contains a `parsererror` element (jsdom parse failure) | Strategy returns `status: "failed"` with `error: "RSS XML structure changed — no valid post entries found"` | REQ-003, REQ-004 |
| EDGE-011 | HN health check: Algolia returns HTTP 200 but hits array is empty | Strategy returns `status: "failed"` with `error: "response schema changed — no stories with required fields returned"` | REQ-003, REQ-004 |
| EDGE-012 | Same collector fails twice in a row with different errors (e.g., first auth error, then schema error after cookie fix) | Second failure triggers a new Slack notification because the error hash differs from the debounced one | REQ-012 |
| EDGE-013 | Health check runs, 3 collectors fail. Operator fixes one. Next auto-check: 2 fail (same errors, same set as last time) | Slack notification is debounced (same hash of 2 failures). No duplicate notification sent | REQ-012 |

## Verification Matrix

| REQ ID | Unit Test | Integration Test | E2E Test | Manual Test | Notes |
|--------|-----------|-----------------|----------|-------------|-------|
| REQ-001 | Yes | Yes | Yes | No | E2E: Playwright clicks "Check Health" button, verifies 202 + job in queue |
| REQ-002 | Yes | Yes | Yes | No | E2E: Playwright clicks "Check All", verifies 202 |
| REQ-003 | Yes | No | No | No | Unit: mock API, verify parse validation logic per collector |
| REQ-004 | Yes | No | No | No | Unit: pass each error type, verify message ≤200 chars |
| REQ-005 | Yes | Yes | No | No | Integration: mock strategies to fail, verify Slack call |
| REQ-006 | Yes | No | No | No | Unit: verify Slack is NOT called when all pass |
| REQ-007 | No | Yes | No | No | Integration: verify upsertJobScheduler called with correct cron |
| REQ-008 | No | Yes | No | No | Integration: change pipelineTime, verify scheduler updated |
| REQ-009 | No | Yes | No | No | Integration: disable schedule, verify scheduler removed |
| REQ-010 | No | Yes | No | No | Integration: enqueue pipeline-run + health-check, verify both execute |
| REQ-011 | Yes | No | No | No | Unit: test skip conditions for all 5 collector types |
| REQ-012 | Yes | No | No | No | Unit: mock Redis, verify debounce logic |
| REQ-013 | No | No | Yes | No | E2E: Playwright checks UI state after manual check completes |

## Verification Scenarios

### VS-0: No library probes needed

No library probes were run — this feature introduces zero new external dependencies. All health checks reuse existing, production-proven APIs (Algolia, Reddit RSS, Rettiwt, Tavily, DeepSeek, Crawlee/Playwright, BullMQ, Slack Webhook).

### VS-1: Manual health check — single collector

1. Open /admin/settings
2. Expand HN section, click "Check Health"
3. Verify spinner appears on button
4. Verify result shows green checkmark "Healthy" or red X with error text
5. Verify no Slack notification is sent (manual checks don't notify Slack)

### VS-2: Manual health check — all collectors

1. Open /admin/settings
2. Click "Check All Collectors"
3. Verify aggregate result: "N healthy, M failed, K skipped"
4. Verify per-collector status indicators update

### VS-3: Auto health check — all pass

1. Set pipelineTime to 2 minutes from now
2. Wait for health-check to fire (pipelineTime - 15 min)
3. Verify all 5 strategies return healthy
4. Verify NO Slack notification is sent

### VS-4: Auto health check — failure notification

1. Set pipelineTime to 2 minutes from now
2. Cause a collector to fail (e.g., temporarily invalidate Twitter cookie)
3. Wait for health-check to fire
4. Verify Slack receives message with 🩺 header, failed collector name, and actionable error
5. Verify healthy collectors listed in summary line
6. Restore valid config

### VS-5: Schedule change propagation

1. Note current pipelineTime and health-check cron
2. Change pipelineTime in settings, save
3. Verify health-check scheduler immediately reflects new pipelineTime - 15 min
4. Change scheduleEnabled to false, save
5. Verify health-check scheduler is removed

## Out of Scope

- Historical health check result storage or dashboard — results are ephemeral (last-check timestamp only)
- Health checks for non-collector components (Resend, LinkedIn OAuth, PostHog) — the existing `social-health` job covers social credentials
- Automatic remediation (auto-refreshing tokens, retrying failed collectors) — the operator is notified and takes action
- Health check result aggregation across multiple runs — no trend analysis or "degraded over last N runs" detection
- Email notifications for health check failures — Slack only
- Health check for the `/sources` reading list page's status computation — that's a read-time computation, not a health check
- Mobile push notifications — Slack is the sole notification channel
