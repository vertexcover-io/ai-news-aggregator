# SPEC: PostHog Error Tracking (supersedes the custom incident system)

**Source:** `.harness/features/posthog-error-tracking/design.md`
**Generated:** 2026-06-09

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Ubiquitous | The system shall expose a single pure `resolvePostHogConfig(settings, env)` from `@newsletter/shared` consumed by both api and pipeline. | Both `packages/api` and `packages/pipeline` import the resolver from `@newsletter/shared` (one definition); `pnpm typecheck` passes; no duplicate resolver body remains in `packages/api/src/lib`. | Must |
| REQ-002 | Event-driven | When `captureException(error, context?)` is called in api, the system shall send an `$exception` event to PostHog via the existing settings-backed client. | With a fake/spy PostHog client, calling the api `captureException` invokes `client.captureException` (or `capture` of `$exception`) exactly once with the error and merged context. | Must |
| REQ-003 | Event-driven | When the api Hono app handles an unhandled error or a response with status ≥ 500, the system shall call `captureException` with `{ method, path }` context and then return the existing 500 response shape. | An `app.onError` is registered; a route that throws yields a 500 JSON body AND triggers one `captureException` carrying method + path. | Must |
| REQ-004 | Unwanted | If a handled `HTTPException` has status < 500, then the system shall NOT call `captureException`. | A thrown `HTTPException(404/401)` returns its status and triggers zero `captureException` calls. | Must |
| REQ-005 | Event-driven | When the api process emits `uncaughtException` or `unhandledRejection`, the system shall capture the error, flush PostHog (bounded), then exit non-zero. | Handlers are registered for both signals; each calls `captureException` then `flush()` (bounded by a timeout) before `process.exit(1)`. | Must |
| REQ-006 | Ubiquitous | The pipeline package shall provide a PostHog client module (`lib/posthog.ts`) resolved from env, exposing `captureException`, `capturePipelineEvent`, and `shutdownPostHog`. | `posthog-node` is a `packages/pipeline` dependency pinned `5.34.2`; the module constructs a client with `enableExceptionAutocapture: true`; all three functions are exported and typecheck. | Must |
| REQ-007 | Event-driven | When a pipeline BullMQ job in the collection, processing, or collector-health queue fails AND has exhausted its retries, the system shall call `captureException` with `{ queue, jobId, jobName }` context. | For each of the 3 `failed` listeners, a job at terminal attempt triggers exactly one `captureException`; existing failure logging is preserved. | Must |
| REQ-008 | Unwanted | If a pipeline job fails but will still be retried (attempts remaining), then the system shall NOT call `captureException`. | A `failed` event where `job.attemptsMade < job.opts.attempts` triggers zero `captureException` calls. | Must |
| REQ-009 | Event-driven | When the pipeline process emits `uncaughtException` or `unhandledRejection`, the system shall capture the error, flush PostHog (bounded), then exit non-zero. | Handlers registered for both signals; each captures then flushes before `process.exit(1)`. | Must |
| REQ-010 | Ubiquitous | The system shall provide a pure `evaluateRunHealth(input)` in `@newsletter/shared` that returns degradation findings for: enrichment failure rate over threshold, zero-yield sources, and partial publish. | Given crafted telemetry inputs, the function returns the correct finding set with no IO; threshold constant defaults to `0.3`. | Must |
| REQ-011 | Event-driven | When `finalizeRun` completes a run, the system shall call `evaluateRunHealth` with the run's telemetry and emit one `pipeline_run_degraded` PostHog event per finding. | With a spy client and telemetry yielding N findings, finalizeRun emits exactly N `capturePipelineEvent("pipeline_run_degraded", …)` calls carrying `{ runId, kind, severity }`. | Must |
| REQ-012 | Unwanted | If PostHog is unconfigured (`POSTHOG_ENABLED=false` or no token), then every capture path shall be a silent no-op that neither throws nor alters control flow. | With token absent, `captureException`/`capturePipelineEvent` return without throwing and without constructing a client; api requests and pipeline jobs behave identically to before. | Must |
| REQ-013 | Unwanted | If a PostHog transport/config error occurs during a capture call, then the system shall swallow it and not propagate to the caller. | A client whose method throws/rejects does not cause `captureException`/`capturePipelineEvent` to throw; at most one `warn` is logged. | Must |
| REQ-014 | Ubiquitous | The system shall add no new required environment variables. | The feature reads only the pre-existing `POSTHOG_PROJECT_TOKEN`/`POSTHOG_API_KEY`/`POSTHOG_HOST`/`POSTHOG_ENABLED`; a full run with none of them set still completes (capture no-ops). | Must |
| REQ-015 | Ubiquitous | The capture path shall not block the api request path or a pipeline job (no `await flush()` on the hot path). | `captureException`/`capturePipelineEvent` do not `await flush()`; flush occurs only in shutdown/crash handlers. | Must |
| REQ-016 | Ubiquitous | The system shall document the PostHog-native alert configuration (issue created/reopened, spike detection, and a `pipeline_run_degraded` insight alert → Slack) in `alerts-setup.md`. | `.harness/features/posthog-error-tracking/alerts-setup.md` exists and describes all three alert configs with the destination channel. | Should |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | PostHog network/transport error mid-capture. | Swallowed; single `warn` log; caller unaffected. | REQ-013 |
| EDGE-002 | Fatal crash exits before autocapture flushes. | Explicit handler captures + bounded `flush()` before `process.exit`. | REQ-005, REQ-009 |
| EDGE-003 | A job fails but will be retried. | Not captured; only the terminal attempt is. | REQ-008 |
| EDGE-004 | Hundreds of per-URL link-enrichment failures in one run. | Not captured as individual exceptions; they feed the enrichment-failure-rate degradation finding (one aggregate event). | REQ-010, REQ-011 |
| EDGE-005 | `POSTHOG_HOST` set but token absent. | Resolver returns `enabled:false`; no client constructed; captures no-op. | REQ-012 |
| EDGE-006 | Legacy run with null/empty telemetry reaches finalizeRun. | `evaluateRunHealth` returns zero findings (no false positives); zero events emitted. | REQ-010, REQ-011 |
| EDGE-007 | Operator edits PostHog settings at `/admin/settings` at runtime (api). | Next `captureException` picks up new config via the existing 30s-TTL `loadConfig`/`refreshPostHogConfig` path. | REQ-002 |

## Verification Matrix

| REQ/EDGE ID | Test Level | Test Name | Rationale for Level | Notes |
|-------------|-----------|-----------|---------------------|-------|
| REQ-001 | unit | test_REQ_001_shared_resolve_posthog_config_single_source | pure config resolver moved to shared | typecheck-enforced; assert env + settings precedence |
| REQ-002 | unit | test_REQ_002_api_capture_exception_calls_client | spy client, pure call path | |
| REQ-003 | integration | test_REQ_003_api_onerror_captures_5xx | crosses Hono app boundary | use app harness + spy capture |
| REQ-004 | integration | test_REQ_004_api_onerror_skips_sub_500_httpexception | crosses Hono app boundary | 404/401 → zero captures |
| REQ-005 | unit | test_REQ_005_api_crash_handler_captures_and_flushes | handler logic with spy client | assert capture→flush→exit order (exit stubbed) |
| REQ-006 | unit | test_REQ_006_pipeline_posthog_module_surface | module exports + client construction | env-resolved; disabled when no token |
| REQ-007 | unit | test_REQ_007_pipeline_failed_terminal_captures | listener logic, spy client | job at terminal attempt |
| REQ-008 | unit | test_REQ_008_pipeline_failed_retryable_skips | listener logic, spy client | attemptsMade < attempts |
| REQ-009 | unit | test_REQ_009_pipeline_crash_handler_captures_and_flushes | handler logic with spy client | capture→flush→exit |
| REQ-010 | unit | test_REQ_010_evaluate_run_health_findings | pure function | all three signal types + threshold |
| REQ-011 | unit | test_REQ_011_finalize_run_emits_degraded_events | finalizeRun with spy client | N findings → N events |
| REQ-012 | unit | test_REQ_012_capture_noop_when_unconfigured | pure guard | no client constructed, no throw |
| REQ-013 | unit | test_REQ_013_capture_swallows_transport_error | spy client throws | no propagation, one warn |
| REQ-014 | unit | test_REQ_014_no_new_required_env_vars | config resolver with empty env | enabled:false, no throw |
| REQ-015 | unit | test_REQ_015_capture_does_not_await_flush | capture path inspection | flush only in shutdown/crash |
| REQ-016 | unit | test_REQ_016_alerts_setup_doc_exists | doc presence assertion | grep alerts-setup.md for 3 alert configs |
| EDGE-001 | unit | test_EDGE_001_transport_error_swallowed | covered alongside REQ-013 | |
| EDGE-002 | unit | test_EDGE_002_crash_flush_before_exit | covered alongside REQ-005/009 | |
| EDGE-003 | unit | test_EDGE_003_retryable_job_not_captured | covered alongside REQ-008 | |
| EDGE-004 | unit | test_EDGE_004_enrichment_failures_aggregate_to_finding | covered alongside REQ-010 | rate over threshold → one finding |
| EDGE-005 | unit | test_EDGE_005_host_without_token_disabled | covered alongside REQ-012 | |
| EDGE-006 | unit | test_EDGE_006_null_telemetry_zero_findings | covered alongside REQ-010 | backward-compat |
| EDGE-007 | integration | test_EDGE_007_api_runtime_settings_refresh | crosses settings-provider boundary | TTL path picks up new config |

## Verification Scenarios

### VS-0-posthog-api-surface: Library probe — posthog-node API surface + no-throw
**Type:** api
**Run:**
```bash
cd packages/api && node -e "
const { PostHog } = require('posthog-node');
const p = PostHog.prototype;
const ok = ['captureException','capture','identify','flush','shutdown'].every(m => typeof p[m] === 'function');
if (!ok) { console.error('MISSING METHODS'); process.exit(1); }
const ph = new PostHog('phc_probe_fake', { host: 'https://us.i.posthog.com', flushAt: 1, flushInterval: 0 });
ph.captureException(new Error('vs0'), 'vs0', { probe: true });
ph.capture({ distinctId: 'vs0', event: 'pipeline_run_degraded', properties: { kind: 'probe' } });
ph.shutdown().then(() => { console.log('VS0_OK'); }).catch(() => { console.log('VS0_OK'); });
"
```
**Expected:** prints `VS0_OK`, exit 0.

### VS-0-posthog-live (OPTIONAL — only if POSTHOG_PROJECT_TOKEN set)
**Type:** api
**Run:** capture a synthetic exception against the real project and confirm ingestion success.
**Expected:** Skipped/UNTESTABLE when no token; success when a token is present.

## Out of Scope

- **No in-app incident UI.** No `/admin/incidents` page, no `incidents` table, no durable
  incident store — error viewing is PostHog's dashboard (the whole reason for choosing PostHog).
- **No alert delivery code.** No `AlertDispatcher`, fingerprint dedup, or `alert-delivery`
  sweep worker. Dedup/grouping/cooldown are PostHog-native; alert routing is PostHog UI config.
- **No per-URL enrichment exception capture.** Individual enrichment failures stay telemetry
  counters (feed the degradation finding), not PostHog issues.
- **No deletion/migration of #267 code.** #267 is unmerged and absent from `main`; it is
  superseded and closed separately by the operator, not edited here.
- **No web/frontend changes.** `posthog-js` analytics in web is untouched; this feature is
  api + pipeline + shared only.
- **No new env vars and no programmatic alert creation.** Alerts are configured once in the
  PostHog UI per `alerts-setup.md`.
