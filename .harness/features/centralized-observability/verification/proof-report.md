# Proof Report — centralized-observability

**Date:** 2026-06-08  
**Verifier:** functional-verify skill  
**Spec:** `.harness/features/centralized-observability/spec.md`  
**Claims:** `.harness/runtime/centralized-observability/claims.json` (1253 executed, 1253 passed, 0 failed)  
**E2E suite:** `pnpm --filter @newsletter/web test:e2e tests/e2e/incidents.spec.ts` → 6/6 PASSED

**Overall Verdict: PASSED**

---

## Step 0 — Claims Status

- Total claims: 43 (PHASE1: 15, PHASE2: 15, PHASE3: 9, PHASE4: 7 [6 ui + 1 api-client])
- `failed: 0` — no blockers
- `type: "ui"` claims (PHASE4-C1..C6): re-proven via Playwright MCP below
- `type: "api"` and `type: "db"` claims: `COVERED_BY_E2E` — cited with proven_by test names

---

## UI Claim Evidence (Playwright MCP — Real Browser)

**Infrastructure:** API dev server (port 3001, DATABASE_URL → postgresql://localhost:5434/newsletter_test), Vite web dev server (port 5174, VITE_API_TARGET → API:3001). Incidents seeded via psql before each scenario.

### PHASE4-C1 — Incident list renders with required fields

**Screenshot:** `verification/screenshots/PHASE4-C1-incident-list-with-rows.png`

**Evidence from real browser snapshot:**
- h1 "Incidents" heading visible (`ref=e17, level=1`)
- Admin nav: Dashboard/Settings/Analytics/Eval/Canon/Incidents/View site all present
- 3 open incidents rendered in table rows:
  - Row: `"critical | Worker crashed with run | pipeline | 3 | 1h ago | 34m ago | open | Run ↗ | Resolve Mute"` — runId present → Run link at `/admin/runs/aaaaaaaa-…`
  - Row: `"critical | API server crash | api | 1 | 2h ago | 1h ago | open | — | Resolve Mute"` — runId null → "—"
  - Row: `"warning | Enrichment failure rate high | enrichment | 2 | 3h ago | 2h ago | open | — | Resolve Mute"`
- All 9 columns present: Severity, Title, Source, Occurrences, First seen, Last seen, Status, Run, Actions
- Verdict: **MET**

### PHASE4-C2 — Empty state

**Screenshot:** `verification/screenshots/PHASE4-C2-empty-state.png`

**Evidence:** After `DELETE FROM incidents`, page navigated to `/admin/incidents`. Snapshot: `paragraph "No incidents found."` visible; no "Failed to load" error text. Filter controls and header nav still present.  
Verdict: **MET**

### PHASE4-C3 — Severity filter

**Screenshot:** `verification/screenshots/PHASE4-C3-severity-filter.png`

**Evidence:** After `selectOption('critical')` on Severity dropdown, `waitFor(textGone: "Enrichment failure rate high")` succeeded. Only critical-severity rows ("Worker crashed with run", "API server crash") remain. Warning row hidden.  
Verdict: **MET**

### PHASE4-C4 — Resolve action (leaves open filter)

**Screenshot:** `verification/screenshots/PHASE4-C4-C5-resolve-mute-actions.png`

**Evidence:** Clicked Resolve on "API server crash" row; `waitFor(textGone: "API server crash")` succeeded — row removed from open filter without page navigation. PATCH intercepted and confirmed in e2e run (`waitForResponse(PATCH /api/admin/incidents)`). After action: "API server crash" absent, "Worker crashed with run" and "Enrichment failure rate high" still shown.  
Verdict: **MET**

### PHASE4-C5 — Mute action (leaves open filter)

**Screenshot:** `verification/screenshots/PHASE4-C4-C5-resolve-mute-actions.png`

**Evidence:** Clicked Mute on "Enrichment failure rate high" row; `waitFor(textGone: "Enrichment failure rate high")` succeeded — row removed from open filter without page navigation. After both actions, only "Worker crashed with run" remains (as expected — only unmutated open incident). Screenshot shows final state with 1 row.  
Verdict: **MET**

### PHASE4-C6 — Auth redirect

**Screenshot:** `verification/screenshots/PHASE4-C6-auth-redirect.png`

**Evidence:** After logout and cookie clear, navigated to `/admin/incidents`. Page URL: `http://localhost:5174/admin/login?next=%2Fadmin%2Fincidents` — redirected to login page. `?next` param preserves the intended destination. Login form visible.  
Verdict: **MET**

---

## UI Claim Summary Table

| Claim ID | Type | Verdict | Screenshot Path |
|----------|------|---------|----------------|
| PHASE4-C1 | ui | MET | `verification/screenshots/PHASE4-C1-incident-list-with-rows.png` |
| PHASE4-C2 | ui | MET | `verification/screenshots/PHASE4-C2-empty-state.png` |
| PHASE4-C3 | ui | MET | `verification/screenshots/PHASE4-C3-severity-filter.png` |
| PHASE4-C4 | ui | MET | `verification/screenshots/PHASE4-C4-C5-resolve-mute-actions.png` |
| PHASE4-C5 | ui | MET | `verification/screenshots/PHASE4-C4-C5-resolve-mute-actions.png` |
| PHASE4-C6 | ui | MET | `verification/screenshots/PHASE4-C6-auth-redirect.png` |

---

## Spec Coverage Table

| REQ/EDGE | Test Level | Test Name | Verdict | Evidence |
|----------|-----------|-----------|---------|---------|
| REQ-001 | integration | test_REQ_001_crash_records_critical_incident | COVERED_BY_E2E | PHASE2-C12 proven_by alerting.test.ts |
| REQ-002 | unit | test_REQ_002_crash_handler_always_exits | COVERED_BY_E2E | PHASE2-C12: `crash handler records critical incident then calls process.exit(1)` |
| REQ-003 | unit | test_REQ_003_job_failed_records_error_incident | COVERED_BY_E2E | PHASE2-C13 proven_by alerting.test.ts |
| REQ-004 | unit | test_REQ_004_enrichment_failure_captures_incident | COVERED_BY_E2E | PHASE2-C14 proven_by alerting.test.ts |
| REQ-005 | integration | test_REQ_005_api_5xx_records_incident | COVERED_BY_E2E | PHASE3-C4 proven_by incidents-5xx-middleware.e2e.test.ts — 2/2 tests passed |
| REQ-006 | unit | test_REQ_006_high_enrichment_failure_rate_degraded | COVERED_BY_E2E | PHASE1-C5, PHASE2-C9 proven_by run-health.test.ts |
| REQ-007 | unit | test_REQ_007_zero_yield_source_degraded | COVERED_BY_E2E | PHASE1-C6 proven_by run-health.test.ts |
| REQ-008 | unit | test_REQ_008_partial_publish_records_error | COVERED_BY_E2E | PHASE1-C7 proven_by run-health.test.ts |
| REQ-009 | integration | test_REQ_009_dedup_by_fingerprint | COVERED_BY_E2E | PHASE2-C1 proven_by incidents.e2e.test.ts; adversarial ADV-002 confirmed |
| REQ-010 | integration | test_REQ_010_cooldown_suppresses_second_alert | COVERED_BY_E2E | PHASE2-C2 proven_by incidents.e2e.test.ts |
| REQ-011 | integration | test_REQ_011_cooldown_uses_pre_update_notified_at | COVERED_BY_E2E | PHASE2-C3 proven_by incidents.e2e.test.ts; adversarial ADV-007 confirmed |
| REQ-012 | unit | test_REQ_012_info_severity_never_alerts | COVERED_BY_E2E | PHASE1-C8 proven_by dispatcher.test.ts |
| REQ-013 | integration | test_REQ_013_durable_first_persist_before_send | COVERED_BY_E2E | PHASE2-C4 proven_by incidents.e2e.test.ts |
| REQ-014 | integration | test_REQ_014_failed_delivery_marks_undelivered | COVERED_BY_E2E | PHASE2-C4 proven_by incidents.e2e.test.ts |
| REQ-015 | integration | test_REQ_015_sweep_redelivers_bounded_batch | COVERED_BY_E2E | PHASE2-C5, PHASE2-C10 proven_by incidents.e2e.test.ts + alert-delivery.test.ts |
| REQ-016 | integration | test_REQ_016_sweep_skips_capped_incidents | COVERED_BY_E2E | PHASE2-C5 (`listUndelivered returns bounded batch ≤ ALERT_SWEEP_BATCH_SIZE, excludes capped rows`) |
| REQ-017 | unit | test_REQ_017_capture_never_throws | COVERED_BY_E2E | PHASE1-C12, PHASE2-C7 proven_by dispatcher.test.ts + alerting.test.ts; adversarial ADV-001 |
| REQ-018 | unit | test_REQ_018_persist_failure_logs_fatal | COVERED_BY_E2E | PHASE1-C13 proven_by dispatcher.test.ts |
| REQ-019 | unit | test_REQ_019_slack_unset_skips_delivery | COVERED_BY_E2E | PHASE1-C11, PHASE2-C8 proven_by dispatcher.test.ts |
| REQ-020 | e2e + ui | test_REQ_020_list_incidents_filtered | COVERED_BY_E2E | PHASE3-C1 (API), PHASE4-C3 (UI screenshot); 14/14 API e2e tests passed |
| REQ-021 | integration | test_REQ_021_patch_status_updates_incident | COVERED_BY_E2E | PHASE3-C2, PHASE3-C6 proven_by admin-incidents-route.e2e.test.ts; adversarial ADV-003/ADV-004 |
| REQ-022 | unit | test_REQ_022_muted_counts_no_alert | COVERED_BY_E2E | PHASE1-C10 proven_by dispatcher.test.ts |
| REQ-023 | integration + ui | test_REQ_023_incidents_routes_require_admin | COVERED_BY_E2E | PHASE3-C3 (API), PHASE4-C6 (UI screenshot); adversarial ADV-005/ADV-006 |
| REQ-024 | e2e + ui | test_REQ_024_incidents_page_lists_rows | PLAYWRIGHT_MCP | PHASE4-C1 — screenshot with all required fields captured |
| REQ-025 | e2e + ui | test_REQ_025_resolve_mute_updates_row | PLAYWRIGHT_MCP | PHASE4-C4/C5 — screenshot after both actions; rows left open filter |
| REQ-026 | lint/structure | test_REQ_026_shared_dispatcher_no_drizzle_import | VERIFIED | `grep -r "^import.*drizzle"` in `packages/shared/src/alerting/` → no imports; `pnpm lint` passes |
| EDGE-001 | integration | test_EDGE_001_webhook_down_persists_and_retries | COVERED_BY_E2E | PHASE2-C11 proven_by alert-delivery.test.ts |
| EDGE-002 | integration | test_EDGE_002_crash_storm_collapses | COVERED_BY_E2E | PHASE2-C1 dedup test + adversarial ADV-002 (3× rapid insert → 1 row) |
| EDGE-003 | unit | test_EDGE_003_db_down_logs_fatal_no_throw | COVERED_BY_E2E | PHASE1-C13 (fatal log) + PHASE1-C12 (no throw) proven_by dispatcher.test.ts |
| EDGE-004 | unit | test_EDGE_004_null_telemetry_no_false_incident | COVERED_BY_E2E | PHASE1-C4 proven_by run-health.test.ts; adversarial ADV-008 |
| EDGE-005 | unit | test_EDGE_005_dry_run_suppresses_degradation | COVERED_BY_E2E | PHASE1-C3, PHASE2-C15 proven_by run-health.test.ts + alerting.test.ts |
| EDGE-006 | integration | test_EDGE_006_sweep_capture_race_sends_once | COVERED_BY_E2E | PHASE2-C6 proven_by incidents.e2e.test.ts (guarded markDelivered WHERE not delivered) |
| EDGE-007 | unit | test_EDGE_007_fingerprint_domain_scoped | COVERED_BY_E2E | PHASE1-C2 proven_by fingerprint.test.ts |
| EDGE-008 | integration | test_EDGE_008_at_least_once_resend | COVERED_BY_E2E | PHASE2-C5 sweep test covers undelivered-row re-delivery |
| EDGE-009 | integration | test_EDGE_009_patch_invalid_status_400 | COVERED_BY_E2E | PHASE3-C9 proven_by admin-incidents-route.e2e.test.ts; adversarial ADV-003 confirmed 400 |
| EDGE-010 | e2e + ui | test_EDGE_010_empty_incidents_empty_state | PLAYWRIGHT_MCP | PHASE4-C2 — screenshot of empty state confirmed |

---

## API / DB Claims Summary

All `type: "api"` and `type: "db"` claims are **COVERED_BY_E2E**. Tests run during verification:

- `packages/shared/tests/unit/alerting/` — 37 tests, 4 files — **ALL PASSED**
- `packages/pipeline/tests/unit/services/alerting.test.ts` — 16 tests — **ALL PASSED**
- `packages/pipeline/tests/unit/workers/alert-delivery.test.ts` — 4 tests — **ALL PASSED**
- `packages/pipeline/tests/e2e/seam/repositories/incidents.e2e.test.ts` — 12 tests — **ALL PASSED**
- `packages/api/tests/e2e/incidents-repo.e2e.test.ts` — 5 tests — **ALL PASSED**
- `packages/api/tests/e2e/incidents-5xx-middleware.e2e.test.ts` — 2 tests — **ALL PASSED**
- `packages/api/tests/e2e/admin-incidents-route.e2e.test.ts` — 7 tests — **ALL PASSED**
- `packages/web/tests/e2e/incidents.spec.ts` — 6 tests (Playwright) — **ALL PASSED**

**Grand total tests confirmed passing:** 89 tests across 8 test files

---

## Adversarial Pass Summary

16 scenarios attempted across 7 categories. **Zero defects found.** See `verification/adversarial-findings.md` for full table.

Key resilience confirmed:
- SQL injection via status/severity enum params → rejected by Zod before DB
- Non-UUID IDs → clean 404, no crash
- Auth bypasses → both GET and PATCH return 401 consistently
- Capture failure (repo down) → NF1 holds, HTTP response unaffected
- Dedup under rapid fire → single row with incremented occurrences

---

## Not Executed (Genuine Limitations)

- Real Slack delivery verification (hard constraint: no real webhook per lessons file)
- Cross-process concurrency (two simultaneous API servers) — lab environment is single-process
- Touch/gesture interactions (mobile Resolve/Mute) — desktop Chromium only
- Long-running crash handler timeout race — covered by unit test with mocked timers
