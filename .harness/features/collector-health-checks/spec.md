# SPEC: Collector Health Checks

**Source:** docs/spec/collector-health-checks/design.md
**Generated:** 2026-06-03

## Glossary

- **Checkable collector** — one of `hn`, `reddit`, `twitter`, `blog`, `web_search` (`blog` = the
  "Web" settings row).
- **Strategy** — the per-collector probe that resolves credentials/config, performs a live fetch
  against the collector's real dependency, and parses/validates the response.
- **Snapshot** — the latest `CollectorHealthResult` for each of the five checkable collectors.
- **Terminal status** — `healthy`, `failed`, or `never` (anything except `running`).

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Event-driven | When an admin POSTs to the trigger endpoint with a `collector`, the system shall enqueue a health check targeting only that collector. | Response 202 with body `{ enqueued: ["<collector>"] }`; a `collector-health` job is added to the dedicated queue with `collectors:["<collector>"]`. | Must |
| REQ-002 | Event-driven | When an admin POSTs to the trigger endpoint with no `collector`, the system shall enqueue a health check targeting all enabled collectors. | Response 202 with body `{ enqueued: [<all enabled>] }`; job payload `collectors` equals the set of collectors whose `*Enabled` flag is true. | Must |
| REQ-003 | Event-driven | When a manual trigger is accepted, the system shall write `status:"running"` to each targeted collector's Redis key before the worker begins. | After the POST returns 202, `GET` snapshot shows each targeted collector with `status:"running"`, `trigger:"manual"`, `durationMs:null`, `reason:null`. | Must |
| REQ-004 | Event-driven | When the health-check job runs a collector strategy, the system shall execute the collector's real auth-resolve + live-fetch + parse path using the saved configuration. | Strategy calls the same low-level primitive the production collector uses (Algolia search / Reddit RSS+parse / rettiwt authenticated read / Crawlee crawl / Tavily search) against the live service. | Must |
| REQ-005 | Event-driven | When a strategy completes successfully, the system shall persist `status:"healthy"` with a non-null `durationMs` to that collector's Redis key. | Redis key `collector-health:<c>` holds `{status:"healthy", durationMs:<number>, reason:null, checkedAt:<ISO>}`. | Must |
| REQ-006 | Unwanted | If a strategy throws, times out, or returns a non-2xx / unparseable response, then the system shall persist `status:"failed"` with a non-null classified `reason`. | Redis key holds `{status:"failed", reason:"<concise reason>"}`; the raw error appears only in the structured log. | Must |
| REQ-007 | Ubiquitous | The system shall persist each collector's latest health result in Redis with no expiry. | `TTL collector-health:<c>` returns `-1` (persists); the value survives a worker restart. | Must |
| REQ-008 | Event-driven | When an admin GETs the snapshot endpoint, the system shall return exactly one entry per checkable collector. | Response `{ collectors: CollectorHealthResult[] }` has length 5; a collector with no Redis key is returned with `status:"never"`, `trigger:null`, `checkedAt:null`. | Must |
| REQ-009 | Ubiquitous | The system shall run health checks on a dedicated `collector-health` BullMQ queue/worker, separate from the `processing` queue. | A distinct queue named `collector-health` exists; the `processing` worker's job-name switch is unchanged except for no new health case; `processing` worker concurrency is not set to 1. | Must |
| REQ-010 | Unwanted | If a single collector's strategy fails, then the system shall still run and persist results for all other targeted collectors. | With one strategy forced to throw, the other targeted collectors' Redis keys reach a terminal status (`healthy`/`failed`). | Must |
| REQ-011 | Event-driven | When the pipeline schedule settings are saved or the API boots, the system shall upsert a repeatable `collector-health` job whose cron fires `COLLECTOR_HEALTH_LEAD_MINUTES` (30) before `pipelineTime` in `scheduleTimezone`. | `reconcileCollectorHealthSchedule` calls `upsertJobScheduler("collector-health:default", {pattern: toCronMinusMinutes(pipelineTime,30), tz})`; changing `pipelineTime` updates the cron. | Must |
| REQ-012 | Unwanted | If `scheduleEnabled` is false, then the system shall remove the repeatable `collector-health` scheduler. | `reconcileCollectorHealthSchedule` calls `removeJobScheduler("collector-health:default")`; no repeatable job remains. | Must |
| REQ-013 | Event-driven | When the scheduled (cron) health-check job runs, the system shall target all enabled collectors and write `status:"running"` with `trigger:"scheduled"` at job start. | The scheduled job's targeted collectors show `trigger:"scheduled"` and pass through `running` before terminal. | Must |
| REQ-014 | Event-driven | When a health-check job finishes with at least one failed targeted collector, the system shall post one Slack message listing each failed collector with its reason, tagged with the trigger source. | A single `postToWebhook` call carries a Block Kit message naming each failed collector + reason and the trigger (`manual`/`scheduled`). | Must |
| REQ-015 | Unwanted | If `SLACK_WEBHOOK_URL` is unset, then the system shall not attempt a Slack post and shall not fail the job. | No webhook POST is made; job completes normally. | Must |
| REQ-016 | Unwanted | If the Slack webhook POST returns non-2xx or errors, then the system shall log `slack.collector_health.failed` and shall not fail the job. | Job exits successfully; a warn log with that event is emitted; no exception propagates. | Must |
| REQ-017 | Ubiquitous | The admin settings page shall render a health-check trigger control beside each collector row and a single "Check all" control. | Each of the 5 collector rows has a "Check" control; a "Check all" control is present in the SaveBar region. | Must |
| REQ-018 | Event-driven | When an admin opens a collector's health modal, the system shall display that collector's latest result: status, reason (if failed), checkedAt, duration, and detail. | The modal renders the snapshot entry's fields; a `never` entry renders "Never checked". | Must |
| REQ-019 | State-driven | While any watched collector has `status:"running"`, the UI shall poll the snapshot endpoint and shall stop polling once every watched collector reaches a terminal status. | The react-query `refetchInterval` returns a positive interval while any watched collector is `running` and returns `false` once none are. | Must |
| REQ-020 | Unwanted | If a strategy exceeds its per-collector timeout, then the system shall persist `status:"failed"` with `reason` indicating a timeout. | Timeouts: blog 35s, twitter/web_search 15s, hn/reddit 10s; on exceed, the key holds `status:"failed"`, `reason` mentioning timeout. | Should |
| REQ-021 | Unwanted | If a targeted collector has no usable saved configuration, then the system shall persist `status:"failed"` with a reason directing the operator to configure it. | Reason equals `"not configured — add sources at /admin/settings"` (or equivalent); no live fetch is attempted. | Must |
| REQ-022 | Unwanted | If a targeted collector's required credential is missing, then the system shall persist `status:"failed"` with a reason naming the missing secret. | Reason names the exact secret (e.g. `TAVILY_API_KEY` / Twitter cookies) and where to set it. | Must |
| REQ-023 | Ubiquitous | All health-check API routes shall be admin-gated. | An unauthenticated request to the trigger or snapshot endpoint returns 401 (or redirects via the admin gate); no health data is served unauthenticated. | Must |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | "Check all" with zero enabled collectors | 202 with `{ enqueued: [] }`; snapshot unchanged; no Slack. | REQ-002 |
| EDGE-002 | Reddit targeted with empty `subreddits` | `failed`, reason "not configured". | REQ-021 |
| EDGE-003 | Twitter targeted with no cookies configured | `failed`, reason names Twitter cookies + `/admin/settings`. | REQ-022 |
| EDGE-004 | Blog targeted with no `sources` | `failed`, reason "not configured". | REQ-021 |
| EDGE-005 | `web_search` targeted with `TAVILY_API_KEY` unset | `failed`, reason names `TAVILY_API_KEY`. | REQ-022 |
| EDGE-006 | Collector never checked, snapshot read | Entry returned with `status:"never"`, nulls; UI shows "Never checked"; not counted as `running`. | REQ-008, REQ-019 |
| EDGE-007 | `pipelineTime` is `00:15`, lead 30 → cron crosses midnight | `toCronMinusMinutes("00:15",30)` yields `45 23 * * *`; scheduler registered with that pattern. | REQ-011 |
| EDGE-008 | Two checks of the same collector enqueued back-to-back | Both run (worker concurrency 1 serializes); the later terminal write is the persisted value. | REQ-009 |
| EDGE-009 | Blog crawl succeeds (crawl-only) but real run would later fail at LLM discovery | Blog reports `healthy` (LLM discovery deliberately not exercised). | REQ-004 |
| EDGE-010 | Manual trigger while a `run-process` job is active | Health check runs on the dedicated queue without waiting for the pipeline job; pipeline job is not delayed. | REQ-009 |
| EDGE-011 | Twitter cookies present but expired/invalid | `failed`, reason classified as auth (rotate cookies). | REQ-006, REQ-022 |
| EDGE-012 | HN/Tavily returns HTTP 429 | `failed`, reason classified as rate limit. | REQ-006 |
| EDGE-013 | Individual check of a disabled-but-configured collector | Runs the strategy using saved config (disabled flag does not block an explicit single-collector check). | REQ-001 |

## Verification Matrix

| REQ ID | Unit Test | Integration Test | E2E Test | Manual Test | Notes |
|--------|-----------|-----------------|----------|-------------|-------|
| REQ-001 | Yes | Yes | No | No | Route enqueues to dedicated queue (mock queue). |
| REQ-002 | Yes | Yes | No | No | Enabled-set derivation from settings. |
| REQ-003 | Yes | Yes | No | No | API writes `running` pre-enqueue (fake Redis). |
| REQ-004 | Yes | No | No | Yes | Unit: strategy calls the real primitive (injected fetch); Manual: live probe per collector. |
| REQ-005 | Yes | Yes | No | No | Terminal healthy persisted. |
| REQ-006 | Yes | No | No | No | Failure classification + persist. |
| REQ-007 | Yes | Yes | No | No | Assert no TTL (`-1`) on the key. |
| REQ-008 | Yes | Yes | No | No | Snapshot always length 5, synth `never`. |
| REQ-009 | Yes | No | No | No | Assert dedicated queue exists + processing concurrency ≠ 1. |
| REQ-010 | Yes | Yes | No | No | One strategy throws; others still persist (allSettled). |
| REQ-011 | Yes | No | No | No | `reconcileCollectorHealthSchedule` cron math; change pipelineTime. |
| REQ-012 | Yes | No | No | No | scheduleEnabled=false removes scheduler. |
| REQ-013 | Yes | Yes | No | No | Scheduled job targets enabled set, trigger=scheduled. |
| REQ-014 | Yes | No | No | No | One consolidated Slack message; builder unit test. |
| REQ-015 | Yes | No | No | No | Webhook unset → no post. |
| REQ-016 | Yes | No | No | No | Webhook non-2xx → warn log, job ok. |
| REQ-017 | Yes | No | Yes | No | Web unit (controls render) + E2E (Playwright). |
| REQ-018 | Yes | No | Yes | No | Modal renders fields; E2E open modal. |
| REQ-019 | Yes | No | Yes | No | Polling stops on terminal; E2E observe running→terminal. |
| REQ-020 | Yes | No | No | No | Timeout → failed (fake timers / injected delay). |
| REQ-021 | Yes | No | No | No | No-config → failed, no fetch. |
| REQ-022 | Yes | No | No | No | Missing-secret reason. |
| REQ-023 | Yes | Yes | No | No | Unauth → 401 via requireAdmin. |
| EDGE-001 | Yes | No | No | No | |
| EDGE-002 | Yes | No | No | No | |
| EDGE-003 | Yes | No | No | No | |
| EDGE-004 | Yes | No | No | No | |
| EDGE-005 | Yes | No | No | No | |
| EDGE-006 | Yes | No | Yes | No | UI "Never checked". |
| EDGE-007 | Yes | No | No | No | Cron midnight cross. |
| EDGE-008 | Yes | No | No | No | Last-writer-wins. |
| EDGE-009 | Yes | No | No | No | Blog healthy despite no LLM step (documented limitation). |
| EDGE-010 | No | Yes | No | Yes | Dedicated queue isolation. |
| EDGE-011 | Yes | No | No | No | Auth classification. |
| EDGE-012 | Yes | No | No | No | Rate-limit classification. |
| EDGE-013 | Yes | No | No | No | Disabled-but-configured single check. |

## Verification Scenarios

> No VS-0 library-probe scenarios — `library-probe.md` verdict is `NOT_APPLICABLE` (no new external
> library). Liveness of external services is validated by the feature itself at runtime.

**VS-1 (E2E, UI):** On `/admin/settings`, click a collector's "Check" control → the row/modal shows
`running`, the UI polls, and the status resolves to a terminal value; a screenshot is captured per
collector control exercised. (Covers REQ-017, REQ-018, REQ-019.)

**VS-2 (E2E, UI):** Open the health modal for a never-checked collector → renders "Never checked".
(Covers REQ-008, EDGE-006.)

**VS-3 (Integration):** Trigger a check via the API against live services in the dev env; assert each
targeted collector's Redis key reaches a terminal status with no TTL. (Covers REQ-004, REQ-005,
REQ-007.)

## Out of Scope

- Running the Blog collector's LLM discovery/extraction step or validating `DEEPSEEK_API_KEY` (the
  blog check is crawl-only — a deliberate decision; see EDGE-009).
- Storing health history / time-series — only the latest result per collector is kept.
- Any public (non-admin) health surface.
- Gating, delaying, or aborting the pipeline run based on health results (alert-only).
- Retrying failed strategies with backoff (one probe per check; operator re-triggers).
- Adding any new external library, model, or third-party API.
- Health checks for unimplemented `SourceType`s (`rss`, `github`, `newsletter`).
