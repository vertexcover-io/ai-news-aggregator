# Adversarial Findings — centralized-observability

**Role:** Adversarial tester (hostile). Trying to break the feature.

---

## 1. Attack Surface Derived

**Source:** Spec gaps computed by diffing spec ACs against claims.json `proven_by` text + boundary/error-path analysis.

- **Boundary inputs (API):** Invalid status values (`deleted`, `catastrophic`), non-UUID IDs, SQL injection in query params, empty/null JSON bodies
- **Auth boundaries:** Unauthenticated GET/PATCH, expired session, cookie manipulation
- **Dedup under rapid fire:** Same fingerprint inserted 3× in rapid succession → ONE row expected
- **Cooldown logic:** Re-capture after cooldown window should re-alert; within window should not
- **NF1 (capture never throws):** Forced repo failure during capture must not propagate to caller
- **5xx middleware:** Unhandled route errors must persist incident without affecting HTTP response
- **Race condition:** Concurrent dedup with `ON CONFLICT` fingerprint uniqueness
- **Filter validation:** Invalid severity/status values in query params
- **Post-action state validity:** After Resolve/Mute, row leaves open filter correctly

---

## 2. Scenarios Attempted

| ID | Category | Description | Inputs | Verdict |
|----|----------|-------------|--------|---------|
| ADV-001 | NF1 / error recovery | Forced repo failure during capture — caller should not throw | Mock repo rejecting in unit tests; 5xx middleware e2e with failing repo | EXPECTED |
| ADV-002 | Dedup / concurrency | Same fingerprint inserted 3× rapidly — only one row, occurrences=3 | SQL: 3× `INSERT ... ON CONFLICT (fingerprint) DO UPDATE` | EXPECTED |
| ADV-003 | Boundary input | PATCH with invalid status value `"deleted"` | `PATCH /api/admin/incidents/:id` body `{status:"deleted"}` → 400 | EXPECTED |
| ADV-004 | Boundary input | PATCH with unknown UUID | `PATCH /api/admin/incidents/99999999-...` with valid status → 404 | EXPECTED |
| ADV-005 | Auth | GET incidents without auth cookie | `GET /api/admin/incidents` no cookie → 401 | EXPECTED |
| ADV-006 | Auth | PATCH incidents without auth cookie | `PATCH /api/admin/incidents/:id` no cookie → 401 | EXPECTED |
| ADV-007 | Cooldown correctness | Re-alert after cooldown window | Set `notified_at = NOW() - 2 hours`, check `should_notify = true` | EXPECTED |
| ADV-008 | Null data / EDGE-004 | Null enrichment telemetry skips degradation rule | Unit test `test_EDGE_004_null_telemetry_no_false_incident` passing | EXPECTED |
| ADV-009 | Race / concurrent dedup | Two rapid inserts same fingerprint — one row | SQL double-insert with ON CONFLICT → 1 row, occurrences=2 | EXPECTED |
| ADV-010 | Boundary input | Invalid severity filter value `"catastrophic"` | `GET /api/admin/incidents?severity=catastrophic` → 400 with zod error | EXPECTED |
| ADV-011 | Boundary input | PATCH with non-UUID ID `"not-a-uuid"` | `PATCH /api/admin/incidents/not-a-uuid` → 404 (no crash) | EXPECTED |
| ADV-012 | SQL injection | Status param with SQL injection payload | `?status=open%3B%20DROP%20TABLE%20incidents%3B--` → 400 zod enum rejection | EXPECTED |
| ADV-013 | 5xx behavior | Normal API operation after error middleware registration | `GET /api/admin/incidents?status=open` still returns 200 with data | EXPECTED |
| ADV-014 | Dry-run guard | Dry run suppresses all health incidents | Unit test `test_EDGE_005_dry_run_suppresses_degradation` passing | EXPECTED |
| ADV-015 | Muted incident | Muted incidents still count occurrences, no send | Unit test `dispatcher.test.ts::muted status suppresses send even if shouldNotify=true` passing | EXPECTED |
| ADV-016 | Delivery cap | Incidents at `ALERT_MAX_DELIVERY_ATTEMPTS` cap excluded from sweep | Integration test `test_REQ_015_sweep_redelivers_bounded_batch` passing; checked PHASE2-C5 | EXPECTED |

---

## 3. Defects

**No defects found.** All 16 scenarios resulted in EXPECTED behavior:

- Invalid inputs were rejected with 400 before reaching DB
- Auth boundaries enforced by Hono middleware (401 on both GET and PATCH)
- Dedup collapses rapid-fire captures to one row via `ON CONFLICT (fingerprint)`
- NF1 proven by both unit test (dispatcher.test.ts) and integration test (5xx middleware e2e)
- Cooldown window re-alert correctly triggers when `notified_at < NOW() - cooldown`
- SQL injection rejected by Zod enum validation before parameterized query execution
- Dry-run guard proven by unit test — no false degradation incidents

---

## 4. Cannot Assess

| Scenario | Reason |
|----------|--------|
| Real cross-process concurrency (two API servers) | Would require two separate API processes; lab environment is single-process |
| At-least-once resend after lost markDelivered (EDGE-008) | Requires timing control over network; covered by sweep integration test `test_EDGE_008_at_least_once_resend` |
| Real Slack POST verification | Hard constraint: NO real Slack webhook per lessons file. Verified via incident row persistence and stubbed channel |
| Worker crash handler timeout race | Crash handler must exit within bounded timeout — proven by unit test with mocked `process.exit` and fake timer |

---

## 5. Honest Declaration

**No defects found across 16 scenarios attempted.**

Categories exercised: boundary inputs (5 scenarios), auth (2), dedup/race (3), NF1/error-recovery (2), filter validation (2), business logic (2).

**Most promising attack that didn't land:** The SQL injection via query params (`?status=open; DROP TABLE...`). If Zod validation was missing or the status value was passed directly to raw SQL, this would be catastrophic. However, the route uses `z.enum(["open","resolved","muted"])` which rejects any non-matching string with a 400 before the value ever reaches the database layer. The Drizzle ORM then parameterizes all queries anyway, providing defense-in-depth.

**Second most promising attack:** Non-UUID ID in PATCH. If the ID was passed to SQL raw string interpolation, it could cause an injection or panic. Instead, the route returns `{"error":"not_found"}` cleanly — the Drizzle query handles the invalid format gracefully by finding no matching row.
