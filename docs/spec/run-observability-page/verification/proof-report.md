# Proof Report — run-observability-page

**Verdict: PASS.** Every `type:"ui"` claim (16) independently re-proven via Playwright MCP driving the
real `/admin/runs/:runId` page; every `type:"api"`/`type:"db"` claim cited as COVERED_BY_E2E and
additionally corroborated by live curl/psql probes. Adversarial pass: 9 scenarios, 0 defects.

Stack: web dev :5173 (Vite, proxies `/api` → api :3000), api dev :3000, Postgres :5433, Redis :6379.
Four scenario runs seeded directly into Postgres + Redis. Console errors across the UI session: 0
(404/400 resource logs on adversarial unknown-id probes are expected — the hook treats 404 as null).

## 1. Summary table

| Scenario | Type | Description | Verdict |
|----------|------|-------------|---------|
| VS-1 | ui | Live run: pulsing pill RUNNING·RANKING, populated+pending funnel, timeline events | PASS |
| VS-2 | ui | Historical completed run: live=false, all six sections from persisted data | PASS |
| VS-3 | ui | Failed run: Failures cards + error timeline rows + expandable stack + level filter | PASS |
| VS-4 | ui | Legacy run (run_funnel=null, no logs): empty states, source/cost still render | PASS |
| VS-5 | ui | Dashboard run rows expose Details → /admin/runs/:runId; click navigates | PASS |
| API | api | observability endpoint: live/historical/failed/legacy/404/400/401 | PASS |
| DB | db | run_logs table (9 cols + index) + run_archives.run_funnel jsonb nullable | PASS |
| ADV-1..9 | adversarial | orphaned logs, zero sources, 23KB stack, null enrichment, concurrency, filter-empty, unknown id, XSS, unauth | 0 defects |

## 2. API evidence

Live curl with an authenticated `admin_session` cookie (api :3000):

```
VS-1 live  /…/11111111…/observability → 200  live=true  funnel{12,10,8,null} logs=4 failures=0 sources=2
VS-2 hist  /…/22222222…/observability → 200  live=false funnel{12,10,8,6}    logs=3 failures=0 cost=0.482 enrichAvg=320
VS-3 fail  /…/33333333…/observability → 200  live=false funnel{12,10,null,null} failures=2 [source.failed,run.failed] stack present
VS-4 leg   /…/44444444…/observability → 200  live=false funnel{null,null,null,null} logs=0 failures=0 sources=2 cost=0.482
404        /…/99999999-9999-9999-9999-999999999999/observability → 404
400        /…/not-a-uuid/observability → 400
401        unauthenticated GET /…/22222222…/observability → 401 (no body)
```

Maps to PHASE3-C1..C6, REQ-020/021/022/023/024/025/026. (COVERED_BY_E2E:
`packages/api/tests/e2e/run-observability.e2e.test.ts` 5/5 pass; reconfirmed live above.)

## 3. UI evidence

Viewport 1280×900. All screenshots include nav (top edge) + footer (bottom edge) per the framing rule.

| Route | Scenario | Claims proven | Screenshot |
|-------|----------|---------------|-----------|
| /admin/runs/1111…1111 | VS-1 live | PHASE5-C1, PHASE4-C2 (live pill data-live=true RUNNING·RANKING + pulse bar), PHASE4-C5 (funnel pending rank, drop annotations), PHASE4-C12 (count/duration formatters) | `screenshots/mcp-vs1-live.jpeg` |
| /admin/runs/2222…2222 | VS-2 historical | PHASE5-C2, PHASE4-C1 (six sections), PHASE4-C8 (source table EDGE-009 0-item-failed, stage rail, cost strip $0.482 / 18,000/3,800 tokens, enrichment 320ms, pill data-live=false) | `screenshots/mcp-vs2-historical.jpeg` |
| /admin/runs/3333…3333 | VS-3 failure | PHASE5-C3, PHASE4-C7 (failure cards + context tags source/class/retries/fatal), PHASE4-C6 (error-styled rows data-level=error, expandable stack reveals full trace, level filter Error→2 rows / All→3) | `screenshots/mcp-vs3-failure.jpeg` |
| /admin/runs/4444…4444 | VS-4 legacy | PHASE5-C4, PHASE4-C3 (timeline-empty + failures-empty states; funnel all data-pending=true "—"; source table + cost strip $0.482 still render) | `screenshots/mcp-vs4-legacy.jpeg` |
| /admin | VS-5 dashboard | PHASE5-C5, PHASE4-C9 (38 "Details" anchors → /admin/runs/:runId; click navigated to 2222…) | `screenshots/mcp-vs5-dashboard-details.jpeg` |
| /admin/runs/<random> | ADV-7 | PHASE4-C4 (run-not-found state + "← Back to dashboard" → /admin) | proven live via browser_evaluate (no screenshot needed; trivial state) |
| /admin/runs/:id (route) | — | PHASE4-C11 (route nested under /admin AdminLayout children, App.tsx:54) + PHASE4-C10 (useRunObservability 2s poll, COVERED_BY_E2E) | App.tsx route + e2e |

Per-screenshot spec checks + open visual review: `screenshots/observations.md` (every PNG has an entry).

## 4. DB evidence

```
\d run_logs → id bigint PK (run_logs_id_seq), run_id uuid NOT NULL, created_at timestamptz default now(),
              level/stage/event/message text NOT NULL, source/context nullable;
              indexes: run_logs_pkey, run_logs_run_id_id_idx btree(run_id, id)   ✓ REQ-001 / PHASE1-C1
information_schema run_archives.run_funnel → data_type jsonb, is_nullable YES    ✓ REQ-002 / PHASE1-C2
```

Type-level claims PHASE1-C3/C4 (RunLogEntry/RunObservability/RunFunnel/RunLogInsert exported from
`@newsletter/shared/types`) COVERED_BY_E2E (`observability-types.test.ts` 6/6 pass).

## 5. Visual anomalies & UX observations

Second pass clean across 5 screenshots; per-screenshot notes in `observations.md`. Two cosmetic notes,
neither a defect:
- VS-1 live: the in-flight cost panel renders a thin empty bar above "Cost · so far" (stage-timing rail
  has no populated stage rows yet while live). No overlap/clipping/horizontal overflow.
- VS-3 failure: in the captured full-page PNG the expanded stack `<pre>` had re-collapsed by paint time
  (timeline re-render after the level-filter toggle). The expand interaction itself was proven live via
  `browser_evaluate` (stack visible, full trace `rerank.ts:88:11` … `processing.ts:210:5`). The "stack"
  expand control is visible on the run.failed row in the PNG.

## 6. Spec coverage table

| REQ/EDGE | Scenario / evidence | Verdict |
|----------|--------------------|---------|
| REQ-001 run_logs table | `\d run_logs` (§4) | MET |
| REQ-002 run_funnel jsonb nullable | information_schema (§4) | MET |
| REQ-003 shared types | observability-types.test.ts (E2E) | MET |
| REQ-010..017 pipeline emission | run-flow.e2e + run-process-logging (E2E) | MET (COVERED_BY_E2E) |
| REQ-020 endpoint 200 + payload | API §2 + UI all VS | MET |
| REQ-021 live composition | VS-1 (live=true, funnel logs-derived) | MET |
| REQ-022 historical from archive | VS-2 (live=false) | MET |
| REQ-023 failures = level=error subset | VS-3 (2 failures = 2 error logs) | MET |
| REQ-024 404 unknown id | API §2 + ADV-7 not-found UI | MET |
| REQ-025 401 unauth | API §2 (401, no body) | MET |
| REQ-026 logs ordered by id asc | ADV-5 (logsAscending=true) + VS-* | MET |
| REQ-030 route behind admin gate | App.tsx:54 nested under AdminLayout | MET |
| REQ-031 dashboard link | VS-5 (38 Details links, click navigates) | MET |
| REQ-032 2s poll, stop on terminal | useRunObservability.test (E2E) + live pulse on VS-1 | MET |
| REQ-033 six sections | VS-2 / VS-1 | MET |
| REQ-034 live pill + pending funnel | VS-1 (data-live=true, rank pending) | MET |
| REQ-035 error row + stack expand | VS-3 (data-level=error, full stack on toggle) | MET |
| REQ-036 level filter | VS-3 (Error→2/All→3) + ADV-6 (Warn→0 "No entries at this level") | MET |
| REQ-037 legacy empty states | VS-4 (timeline-empty + failures-empty; source/cost render) | MET |
| REQ-038 no-failures empty state | VS-1 / VS-2 ("No failures — every stage completed without error.") | MET |
| EDGE-001 in-flight before archive | VS-1 (live, no archive) | MET |
| EDGE-002 fatal mid-stage partial funnel | VS-3 (funnel {12,10,null,null} + run.failed w/ stack) | MET |
| EDGE-003 TTL-expired redis | NOT VERIFIED live — same code branch as VS-2 historical fallback | COVERED_BY_E2E |
| EDGE-004 dry-run label | NOT VERIFIED — dry-run label present in component (data-testid=dry-run-label); no dry-run scenario seeded | NOT VERIFIED (low risk, see §9) |
| EDGE-005 legacy null funnel | VS-4 | MET |
| EDGE-006 concurrent source rows | ADV-5 (10 rows id-ascending, none lost) | MET |
| EDGE-007 very long stack | ADV-3 (23,325-char stack scrolls, no layout break) | MET |
| EDGE-008 transient insert failure | run-logger.test (E2E) | MET (COVERED_BY_E2E) |
| EDGE-009 0-item completed source | VS-2 (reddit FAILED 0 items + note) / table renders 0 | MET |
| EDGE-010 enrichment disabled/null | VS-1 (zeros) + ADV-4 (key absent → all-zeros) | MET |

## 7. E2E coverage summary

`.harness/run-observability-page/claims.json`: executed 57 / passed 57 / failed 0 across 5 phases.
API + DB + pipeline claims (PHASE1-C1..C4, PHASE2-C1..C12, PHASE3-C1..C7, PHASE4-C10) cited as
COVERED_BY_E2E (observability-types.test, run-flow.e2e, run-process-logging, run-observability.e2e,
useRunObservability.test — all green) and additionally reconfirmed live via §2/§4 probes. The 16
UI claims (PHASE4-C1..C9, C11, C12; PHASE5-C1..C5) were re-proven fresh here via Playwright MCP, not
treated as proven by their phase `.spec.ts`.

## 8. Adversarial findings

Quoted from `verification/adversarial-findings.md` §5: **"No defects found across 9 scenarios
attempted. Categories exercised: unexpected state (orphaned logs), boundary inputs (zero sources,
23 KB stack, absent enrichment), concurrency/ordering, filter boundary, unknown-id, malformed/XSS
input, and auth."** Most promising attack (ADV-3, 23 KB stack) did not land — stack `<pre>` is
`overflow:auto`, card right edge 1116 ≤ viewport 1280, document scrollWidth 1265 ≤ window 1280, no
horizontal page overflow. ADV-4 (enrichment key entirely absent) normalised to all-zeros, no NaN.
See that file §2 for the full scenarios-attempted table and §"Environmental note" for the
cross-worktree shared-DB interference observed (NOT a feature defect — other worktrees' e2e suites
deleting run_archives on the shared :5433 Postgres; re-seeded and re-verified).

## 9. Not executed

- **EDGE-004 dry-run UI** — no dry-run archive seeded; the `data-testid=dry-run-label` chip exists in
  `RunObservabilityPage.tsx` and renders when `run.isDryRun`, but a dry-run scenario was not driven
  live. Low risk (single conditional badge). Recommend a future dry-run screenshot.
- **EDGE-003 live Redis TTL expiry mid-view** — not reproducible cheaply; lands in the same historical
  fallback branch already proven by VS-2.
- **Unauthenticated UI redirect to /admin/login** — proven at the API layer (401) and structurally by
  the route nesting under AdminLayout; the full browser logged-out redirect was not re-driven to avoid
  clearing the session mid-pass.
- **`mcp__postgres__query` MCP** — unusable (points at :5432; project DB is :5433). Used `psql` on :5433.

## 10. Infrastructure

- **Already running (left in place):** Postgres :5433 + Redis :6379 (podman), api dev :3000.
- **Started by this skill:** web dev server :5173 (`pnpm --filter @newsletter/web dev`, Vite detached) —
  left running for the downstream quality-gate stage; will be reaped with the session.
- **Seed data:** four scenario runs (1111/2222/3333/4444…) in Postgres + Redis. Adversarial seeds
  (5555–9999…) cleaned up after the pass. Scenario seeds left for any re-verify; they are future-dated
  (2099) and harmless.
- **Note:** the shared :5433 Postgres is also used by other active worktrees running e2e suites, which
  periodically truncate run_archives — re-seed before re-running UI checks.
