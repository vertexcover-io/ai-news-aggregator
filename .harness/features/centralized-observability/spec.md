# SPEC: Centralized Observability & Reliable Alerting

**Source:** .harness/features/centralized-observability/design.md
**Generated:** 2026-06-08

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Event-driven | When an uncaught exception or unhandled rejection occurs in a long-running process (api server or pipeline worker), the system shall record a `critical` incident before the process exits | A `critical` incident row with category `worker_crash` (pipeline) / `api_crash` (api) is persisted; process then exits with code 1 | Must |
| REQ-002 | Event-driven | When a process-level crash handler runs, the system shall attempt Slack delivery within a bounded time and exit regardless | Crash handler resolves (delivery attempted) OR a timeout fires; `process.exit(1)` is always reached | Must |
| REQ-003 | Event-driven | When a BullMQ job exhausts its retries (`worker.on('failed')` with no attempts remaining), the system shall record an `error` incident carrying queue, job name, and failure reason | An `error` incident with category `job_failed` and `context` containing `{ queue, jobName, reason }` is persisted | Must |
| REQ-004 | Event-driven | When link enrichment or a collector fails for a source, the system shall route that failure through the centralized capture facility | `captureIncident` is invoked at the enrichment/collector failure site (category `enrichment_failed` / `collector_failed`) in addition to the existing log line | Must |
| REQ-005 | Event-driven | When the API returns a 5xx from an unhandled route error, the system shall record an `error` incident with route and request context | An `error` incident with category `api_5xx` and `context` containing the request path is persisted by the Hono error middleware | Must |
| REQ-006 | Event-driven | When a run finalizes on the `completed` branch with enrichment failure-rate exceeding `ENRICHMENT_FAILURE_RATE_THRESHOLD`, the system shall record a `warning` incident | A `warning` incident with category `run_degraded` is persisted when `failed/(ok+failed) > threshold`; not persisted when at/below threshold | Must |
| REQ-007 | Event-driven | When a run finalizes and a source that has historical items yields zero items, the system shall record a `warning` incident | A `warning` incident with category `run_degraded` (reason `zero_yield`) is persisted for that source | Should |
| REQ-008 | Event-driven | When publishing partially fails (≥1 channel succeeds and ≥1 fails), the system shall record an `error` incident | An `error` incident with category `publish_partial_failure` is persisted | Should |
| REQ-009 | Ubiquitous | The system shall deduplicate incidents by a stable fingerprint composed of category + source + normalized signature | Two captures with equal fingerprint produce ONE row with `occurrences = 2`, not two rows | Must |
| REQ-010 | Event-driven | When a duplicate incident is captured within `INCIDENT_ALERT_COOLDOWN_MS` of the last alert, the system shall increment `occurrences` and update `last_seen_at` without sending a new Slack message | After two rapid captures, `occurrences = 2` and exactly ONE Slack POST was made | Must |
| REQ-011 | Ubiquitous | The system shall compute the cooldown decision from the pre-update `notified_at` value (never the just-bumped `last_seen_at`) and advance `notified_at` only when a Slack send is attempted | Given a row last notified > cooldown ago, the next capture sets `shouldNotify = true`; `notified_at` is unchanged on captures that do not attempt a send | Must |
| REQ-012 | Event-driven | When an incident of severity ≥ `warning` is newly notifiable, the system shall attempt Slack delivery; for severity `info` it shall never attempt delivery | `warning`/`error`/`critical` incidents trigger a Slack POST attempt; `info` incidents persist with `notified_at = null` and no POST | Must |
| REQ-013 | Ubiquitous | The system shall persist an incident before attempting Slack delivery (durable-first) | The incident row exists even when the Slack POST throws/returns not-ok | Must |
| REQ-014 | Unwanted | If a Slack delivery fails, then the system shall leave the incident undelivered (`notified_at = null`, `delivery_attempts` incremented) for retry | After a failed POST, `notified_at IS NULL` and `delivery_attempts >= 1` | Must |
| REQ-015 | Event-driven | When the delivery sweep runs, the system shall re-attempt undelivered incidents (severity ≥ warning, `notified_at IS NULL`) in a bounded batch of at most `ALERT_SWEEP_BATCH_SIZE` | The sweep selects ≤ batch-size rows and marks each delivered on success | Must |
| REQ-016 | Unwanted | If an incident's `delivery_attempts` reaches `ALERT_MAX_DELIVERY_ATTEMPTS`, then the sweep shall stop retrying it | A row at the cap is excluded from the sweep's selection | Must |
| REQ-017 | Ubiquitous | The capture facility shall never throw into its caller | A capture invoked while the repository rejects resolves without throwing (caller continues) | Must |
| REQ-018 | Unwanted | If the incident persist itself fails, then the system shall emit a Pino `fatal` log and not throw | On repo failure, a `fatal`-level log is emitted and `capture` resolves | Must |
| REQ-019 | State-driven | While `SLACK_WEBHOOK_URL` is unset, the system shall record incidents but skip Slack delivery (no retry loop) | Incidents persist; no POST attempted; row not left in an infinitely-retried state | Must |
| REQ-020 | Event-driven | When `GET /api/admin/incidents` is requested, the system shall return incidents newest-first filterable by `status` and `severity` | Endpoint returns 200 with incidents ordered by `last_seen_at` desc; `?status=open&severity=critical` filters correctly | Must |
| REQ-021 | Event-driven | When `PATCH /api/admin/incidents/:id` sets `status`, the system shall update that incident's status to `open`, `resolved`, or `muted` | Endpoint returns 200 and the row's `status` reflects the new value; invalid status → 400 | Must |
| REQ-022 | State-driven | While an incident is `muted`, the system shall keep counting occurrences but not attempt Slack delivery | A capture for a muted fingerprint increments `occurrences` with no POST | Should |
| REQ-023 | Ubiquitous | The `/api/admin/incidents` routes shall be protected by the `requireAdmin` middleware | Unauthenticated request to either route returns 401/redirect | Must |
| REQ-024 | Event-driven | When the operator opens `/admin/incidents`, the web app shall list incidents with severity, title, source, occurrence count, first/last seen, status, and run link | The page renders a row per incident with those fields; a run link is present when `run_id` is set | Must |
| REQ-025 | Event-driven | When the operator clicks Resolve or Mute on an incident, the web app shall PATCH the status and reflect the new state | After clicking Resolve, the row shows `resolved` (or leaves the open filter) without a full reload | Must |
| REQ-026 | Ubiquitous | All `incidents` DB access shall go through repository factories in `src/repositories/**`; the shared dispatcher shall depend only on an injected `IncidentRepository` interface | `@newsletter/shared` dispatcher imports no `drizzle-orm`; `newsletter/enforce-repository-access` lint passes | Must |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | Slack webhook is down at capture time | Incident persisted; delivery marked failed; retried by sweep; never lost | REQ-013, REQ-014, REQ-015 |
| EDGE-002 | The same uncaught exception fires repeatedly (crash storm) | Dedup collapses to one incident + occurrence count; cooldown prevents a Slack flood | REQ-009, REQ-010 |
| EDGE-003 | The incident insert itself fails (DB down) | Facility emits Pino `fatal` and does not throw; no crash of the caller | REQ-017, REQ-018 |
| EDGE-004 | Legacy archive with null funnel/telemetry at finalization | Degradation evaluator skips rules it has no data for; no false incident | REQ-006, REQ-007 |
| EDGE-005 | Dry-run archive (`isDryRun = true`) finalizes degraded | Degradation/publish incidents suppressed (matches existing notifier dry-run guard) | REQ-006, REQ-008 |
| EDGE-006 | Sweep races a fresh capture for the same row | Guarded update (`mark delivered WHERE not delivered`) sends at most once per cooldown | REQ-011, REQ-015 |
| EDGE-007 | Enrichment fails for many distinct URLs on one domain | Fingerprint keyed on domain (not full URL) → one incident, bounded row count | REQ-009 |
| EDGE-008 | Successful Slack POST but `markDelivered` write is lost | At-least-once: sweep may re-send; duplicate ping accepted (no cross-process idempotency) | REQ-014, REQ-015 |
| EDGE-009 | PATCH with an unknown status value | Endpoint returns 400; row unchanged | REQ-021 |
| EDGE-010 | `/admin/incidents` with zero incidents | Page renders an empty state, not an error | REQ-024 |

## Verification Matrix

| REQ/EDGE ID | Test Level | Test Name | Rationale for Level | Notes |
|-------------|-----------|-----------|---------------------|-------|
| REQ-001 | integration | test_REQ_001_crash_records_critical_incident | crash handler + repo boundary | inject a throwing handler; assert repo received critical incident |
| REQ-002 | unit | test_REQ_002_crash_handler_always_exits | pure control-flow w/ injected exit+timeout | mock `process.exit` + clock |
| REQ-003 | unit | test_REQ_003_job_failed_records_error_incident | failed-listener callback logic | call the `failed` handler with a job stub |
| REQ-004 | unit | test_REQ_004_enrichment_failure_captures_incident | failure-site wiring | spy on injected capture at enrichment catch |
| REQ-005 | integration | test_REQ_005_api_5xx_records_incident | Hono middleware + repo | throw in a test route; assert incident |
| REQ-006 | unit | test_REQ_006_high_enrichment_failure_rate_degraded | pure threshold logic | `evaluateRunHealth` over telemetry fixture |
| REQ-007 | unit | test_REQ_007_zero_yield_source_degraded | pure rule logic | fixture w/ a zero-yield source |
| REQ-008 | unit | test_REQ_008_partial_publish_records_error | pure rule logic | fixture w/ mixed channel results |
| REQ-009 | integration | test_REQ_009_dedup_by_fingerprint | upsert ON CONFLICT against real DB | two captures, assert one row, occurrences=2 |
| REQ-010 | integration | test_REQ_010_cooldown_suppresses_second_alert | dedup + delivery against DB + fake channel | assert exactly one send |
| REQ-011 | unit | test_REQ_011_cooldown_uses_pre_update_notified_at | shouldNotify computation | pure function over prior-row state |
| REQ-012 | unit | test_REQ_012_info_severity_never_alerts | severity gating logic | assert no send for info |
| REQ-013 | integration | test_REQ_013_durable_first_persist_before_send | repo + failing channel | channel throws; row still present |
| REQ-014 | integration | test_REQ_014_failed_delivery_marks_undelivered | repo + failing channel | assert notified_at null, attempts++ |
| REQ-015 | integration | test_REQ_015_sweep_redelivers_bounded_batch | repo + channel sweep | seed >batch undelivered; assert ≤batch sent |
| REQ-016 | integration | test_REQ_016_sweep_skips_capped_incidents | repo selection | row at cap excluded |
| REQ-017 | unit | test_REQ_017_capture_never_throws | injected rejecting repo | capture resolves |
| REQ-018 | unit | test_REQ_018_persist_failure_logs_fatal | injected rejecting repo + spy logger | assert fatal log |
| REQ-019 | unit | test_REQ_019_slack_unset_skips_delivery | dispatcher w/ disabled channel | persist yes, send no |
| REQ-020 | e2e | test_REQ_020_list_incidents_filtered | admin journey | covered by VS-2 via Playwright |
| REQ-021 | integration | test_REQ_021_patch_status_updates_incident | route + repo | PATCH then GET reflects change |
| REQ-022 | unit | test_REQ_022_muted_counts_no_alert | dispatcher status gating | muted fingerprint: occurrences++ no send |
| REQ-023 | integration | test_REQ_023_incidents_routes_require_admin | auth middleware | unauth → 401 |
| REQ-024 | e2e | test_REQ_024_incidents_page_lists_rows | admin UI render | covered by VS-2 |
| REQ-025 | e2e | test_REQ_025_resolve_mute_updates_row | admin UI action | covered by VS-2 |
| REQ-026 | unit | test_REQ_026_shared_dispatcher_no_drizzle_import | lint/structure | enforce-repository-access + no drizzle import in shared dispatcher |
| EDGE-001 | integration | test_EDGE_001_webhook_down_persists_and_retries | repo + sweep | covered alongside REQ-014/015 |
| EDGE-002 | integration | test_EDGE_002_crash_storm_collapses | dedup | many captures → one row |
| EDGE-003 | unit | test_EDGE_003_db_down_logs_fatal_no_throw | injected rejecting repo | same harness as REQ-018 |
| EDGE-004 | unit | test_EDGE_004_null_telemetry_no_false_incident | evaluator guard | null funnel/telemetry → no incident |
| EDGE-005 | unit | test_EDGE_005_dry_run_suppresses_degradation | evaluator guard | isDryRun → no incident |
| EDGE-006 | integration | test_EDGE_006_sweep_capture_race_sends_once | guarded update | concurrent-ish: mark-where-not-delivered |
| EDGE-007 | unit | test_EDGE_007_fingerprint_domain_scoped | fingerprint fn | distinct URLs same domain → one fingerprint |
| EDGE-008 | integration | test_EDGE_008_at_least_once_resend | sweep after lost mark | undelivered row re-sent |
| EDGE-009 | integration | test_EDGE_009_patch_invalid_status_400 | route validation | bad status → 400 |
| EDGE-010 | e2e | test_EDGE_010_empty_incidents_empty_state | UI empty state | covered by VS-2 |

## Verification Scenarios

### VS-1: Operator is alerted to a degraded run (derived from design Flow 1 / 3)
1. Trigger a pipeline run whose enrichment fails above the threshold (or invoke the degradation evaluator with a degraded telemetry fixture) → a `warning` `run_degraded` incident is persisted.
2. Inspect the configured Slack channel (or the fake channel in test) → exactly one alert message was sent, naming the failing source(s) and failure ratio, with a link to the run observability page.
3. Re-run / re-capture the same degraded source within the cooldown → no new Slack message; the incident's `occurrences` increments.
4. A worker uncaught exception fires → a `critical` incident is recorded and an alert is attempted before the process exits.

### VS-2: Operator reviews and clears incidents (derived from design Flow 2) — UI
1. Navigate to `/admin/incidents` (authenticated) → a table lists incidents with severity, title, source, occurrence count, first/last seen, status, and a run link where applicable.
2. With zero incidents present, the page shows an empty state (not an error).
3. Apply the filter Open + critical → only matching incidents remain.
4. Click **Resolve** on an incident → it transitions to `resolved` and leaves the Open filter without a full page reload.
5. Click **Mute** on a noisy incident → it stops alerting on future captures but remains visible.
6. An unauthenticated visit to `/admin/incidents` (or the API route) is rejected by the admin gate.

## Out of Scope

- No new external vendor / SaaS (no Sentry, Datadog, Grafana, OpenTelemetry).
- No PagerDuty / phone / on-call paging.
- No Prometheus `/metrics` endpoint, distributed tracing, or metrics scraping.
- No replacement of the existing per-run observability page — this complements it.
- No public / end-user surface — operator-only, behind the admin gate.
- No auto-resolve of incidents in v1 (manual Resolve only; deferred per design Open Questions).
- No incident retention/archival sweep in v1 (table stays small at internal-tool scale).
- No cross-process Slack delivery idempotency — duplicate pings on lost `markDelivered` are accepted (at-least-once).
