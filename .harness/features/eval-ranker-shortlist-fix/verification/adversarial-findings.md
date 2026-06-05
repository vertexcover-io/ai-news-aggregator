# Adversarial findings — eval-ranker-shortlist-fix

Role-swap critic pass. Targets are spec ACs/edge cases NOT directly re-proven by the live
UI happy-path (computed by diffing spec EDGE-* / REQ-* against `claims.json` coverage). All
scenarios run live against the running API (port 3000) + Postgres (5433) with seeded data.

## 1. Attack surface derived

- **EDGE-001** (two runs, same calendar day) — spec edge; claims cover it only via e2e seam test, not live. (spec-gap)
- **REQ-005 / EDGE-003** (legacy archive, `run_id = NULL` items → time-window fallback + dedup) — live behavior under a real archive + window. (spec-gap)
- **EDGE-002** (empty / zero-width pool → `itemCount: 0`; ab run → "run source pool empty"). (spec-gap)
- **EDGE-004** (an item re-collected by a later run; `run_id` moves forward) — REQ-009 consistency under mutation. (spec-gap)
- **Boundary inputs** on `GET /calendar-runs?date=` (malformed, impossible calendar dates, empty, SQL injection) and on `GET /calendar-runs/:runId` (non-uuid, missing uuid). (derived)

## 2. Scenarios attempted

| ID | Category | Description | Inputs | Verdict |
|----|----------|-------------|--------|---------|
| ADV-1 | Unexpected sequence / attribution | Two completed runs (R1, R2) on the same UTC day, each with its own run_id-stamped raw_items | R1 (7-item pool) + R2 (2-item pool) | EXPECTED |
| ADV-1b | Attribution isolation | R2 detail must contain only R2 items; no R1 leak | `GET /calendar-runs/{R2}` | EXPECTED |
| ADV-1c | Consistency | Day list shows both runs with distinct per-run itemCount | `GET /calendar-runs?date=` | EXPECTED |
| ADV-2 | Legacy fallback | Archive whose items have `run_id=NULL`, collected "yesterday"; window must catch them and dedup | 3 legacy items (1 dup) | EXPECTED |
| ADV-3a | Empty pool | Archive with no run_id items and a 1-second window in year 2000 → `itemCount: 0` | `GET /calendar-runs/{R4}` | EXPECTED |
| ADV-3b | Error path | ab-mode run against an empty-pool run | `POST /run` mode=ab | EXPECTED |
| ADV-4 | Boundary input | Malformed / impossible / empty / SQL-injection date params | `not-a-date`, `2026-13-40`, `2026-02-30`, ``, `2026-05-23'; DROP TABLE raw_items;--` | EXPECTED (see note) |
| ADV-4b | Injection | Confirm `raw_items` table intact after injection attempt | `SELECT count(*)` | EXPECTED (13 rows, intact) |
| ADV-4c | Boundary input | Detail with a non-uuid runId param | `/calendar-runs/not-a-uuid` | DEFECT (minor, pre-existing) |
| ADV-4d | Boundary input | Detail with well-formed but nonexistent uuid | all-zero uuid | EXPECTED (404 run_not_found) |
| ADV-5 | Stale-state / mutation | Move one R1 item's run_id forward to R2 (EDGE-004); verify both detail and list itemCount track the move and stay equal | `UPDATE raw_items SET run_id=R2 WHERE external_id='evalseed-5'` | EXPECTED |

## 3. Defects

### ADV-4c — `GET /api/admin/eval/calendar-runs/:runId` returns a raw HTTP 500 for a non-uuid runId (severity: minor, PRE-EXISTING — not introduced by this feature)

Reproduction:
```
GET /api/admin/eval/calendar-runs/not-a-uuid   -> HTTP 500 "Internal Server Error"
GET /api/admin/eval/calendar-runs/xyz%20123    -> HTTP 500 "Internal Server Error"
```
Actual: a malformed runId is passed straight into `getCompletedRunDetail`, which builds
`WHERE run_archives.id = 'not-a-uuid'` and Postgres rejects the uuid cast; the route has no
`z.uuid()` guard, so the error surfaces as a bare 500.
Expected: a 400 (`invalid_id`) or 404, mirroring the sibling `GET /runs/:id` route which DOES
validate with `runIdParamSchema = z.uuid()`.

Why this is NOT a blocker for this feature:
- The route handler `app.get("/calendar-runs/:runId", …)` is **pre-existing committed code**
  (introduced in `388188f`, present in HEAD). This feature's working-tree diff to
  `admin-eval.ts` does not touch this route's validation — verified via `git diff HEAD`.
- The well-formed-but-missing uuid path correctly returns `404 {"error":"run_not_found"}`.
- The UI never produces a malformed runId: the eval page only passes uuids it received from
  the list endpoint, so the live user-facing flow cannot hit this.
- It is a genuine, real bug worth a follow-up (add `z.uuid()` to the param), but it is out of
  scope for the pool-attribution/dedup/itemCount feature under verification.

### ADV-4 (note, not a defect) — impossible calendar dates accepted by the regex

`2026-13-40` and `2026-02-30` pass the `^\d{4}-\d{2}-\d{2}$` regex and return `{runs: []}`.
Harmless (no run matches the window) and the regex is pre-existing committed
`calendarRunsQuerySchema`, unchanged by this feature. Recorded for completeness; not a defect.

## 4. Cannot assess

- None. Every derived scenario was runnable live against the seeded DB + API.

## 5. Honest declaration

Defects found: 1 (ADV-4c — minor, pre-existing, out of this feature's scope; not a blocker).

I genuinely tried to break the feature. The most promising attack was the same-day double-run
(ADV-1, EDGE-001) — this is the exact scenario the old time-window approach got wrong (it would
have merged both runs' items into a single pool), so if the run_id attribution were faulty I
expected R1's pool to leak R2's items or the itemCounts to be wrong. It held perfectly: R1=7,
R2=2, fully isolated. The second-most-promising attack was mutating run_id forward mid-flight
(ADV-5, EDGE-004) to see if the list and detail itemCount would diverge (REQ-009) — they tracked
the mutation together (R1 6/6, R2 3/3). The only crack I found (ADV-4c) is a pre-existing
input-validation gap on a route this feature did not modify and the UI cannot trigger.
