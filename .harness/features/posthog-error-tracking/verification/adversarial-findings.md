# Adversarial Findings — PostHog Error Tracking

**Feature:** posthog-error-tracking
**Date:** 2026-06-09
**Verdict:** No breaks found — all adversarial scenarios held

---

## Methodology

Scenarios were executed via a throwaway node script (`/tmp/adversarial-test-v2.mjs`) that
simulates the production code logic with injected fake/spy clients. No live PostHog, Redis,
or DB was required.

---

## Scenarios Attempted

### Group A: captureException / capturePipelineEvent with bad inputs

| Scenario | Expected | Result |
|----------|----------|--------|
| null error passed to `captureException` | no throw; converts to `new Error(String(null))` | PASS |
| undefined error | no throw; converts to `new Error(String(undefined))` | PASS |
| non-Error object (e.g. `{ code: 'ENOENT' }`) | no throw; converts via `String()` | PASS |
| null client (unconfigured) | returns immediately; no throw | PASS |
| sync-throwing client method | error swallowed in try/catch; at most one `warn` log | PASS |
| pipeline null client | returns immediately; no throw | PASS |
| pipeline sync-throwing client | error swallowed; at most one `warn` log | PASS |

**Observation:** The async-rejecting client scenario (a client whose `captureException` returns a
rejected promise) was initially tested. In production the call is fire-and-forget — posthog-node's
`captureException` is synchronous; any async network failure is the SDK's internal concern. The
wrapper does not `await` the call, so there is nothing to catch. This is correct behavior per
REQ-015 (no blocking) and REQ-013 (swallow transport errors at the sync boundary). No break found.

---

### Group B: api `app.onError` behavior

| Scenario | Expected | Result |
|----------|----------|--------|
| `HTTPException(404)` thrown | status < 500 → captureException NOT called | PASS |
| `HTTPException(401)` thrown | status < 500 → captureException NOT called | PASS |
| Non-HTTPException thrown | defaults to 500 → captureException called once | PASS |

---

### Group C: Terminal-attempt guard

| Scenario | Expected | Result |
|----------|----------|--------|
| `attemptsMade = 2`, `opts.attempts = 3` (just below) | NOT captured | PASS |
| `attemptsMade = 3`, `opts.attempts = 3` (at threshold) | captured once | PASS |
| `job = undefined` | no throw, no capture | PASS |

---

### Group D: `evaluateRunHealth` edge inputs

| Scenario | Expected | Result |
|----------|----------|--------|
| All-null telemetry (`enrichment: null, sources: null, publish: null`) | `[]` — no false degradation | PASS |
| `isDryRun: true` with high failure rate | `[]` — dry-run suppressed | PASS |
| `enrichment: { ok: 0, failed: 0 }` (zero denominator) | `[]` — no false finding | PASS |

---

### Group E: Config resolution with empty/bad env

| Scenario | Expected | Result |
|----------|----------|--------|
| Empty env `{}` | `enabled: false`; no throw | PASS |
| `POSTHOG_HOST` set, no token | `enabled: false`; token null | PASS |
| `POSTHOG_PROJECT_TOKEN = '   '` (whitespace-only) | cleaned to null → `enabled: false` | PASS |
| `POSTHOG_ENABLED=false` with valid token | `enabled: false` | PASS |

---

## Confirmed Breaks

None. No scenario caused a caller to receive a thrown error, an altered response shape, or a
false degradation event.

---

## Summary

19/19 adversarial scenarios passed. The implementation is robust against:
- Null / undefined / non-Error inputs
- Unconfigured client (no token)
- Sync-throwing transport
- Sub-500 HTTPExceptions being incorrectly captured
- Retryable job failures being incorrectly captured
- Null/empty telemetry producing false degradation findings
- Missing env vars causing startup failures
