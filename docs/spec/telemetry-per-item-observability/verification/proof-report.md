# Functional Verification Proof Report

Spec: `docs/spec/telemetry-per-item-observability/spec.md`  
Run verified: `4bd1f427-ede7-4779-b741-403f99b0af46`  
App: `http://localhost:5174` → API `http://127.0.0.1:3001`

## 1. Summary Table

| Scenario ID | Type | Description | Verdict |
|---|---|---|---|
| VS-UI-1 | ui | Expand healthy source and verify per-item panel. | PASSED |
| VS-UI-2 | ui | Verify lifecycle vocabulary, title links, reasons, hidden-scroll regions, and logs. | PASSED |
| VS-UI-3 | ui | Expand failed empty source and verify log-only panel. | PASSED |
| VS-API-1 | api | Authenticated per-source items route returns lean payload. | PASSED |
| VS-API-2 | api | Unauthenticated per-source items route is rejected. | PASSED |
| ADV | api/ui | Adversarial validation for malformed keys, auth, lazy fetch, and stale-state switching. | PASSED |

## 2. API Evidence

- `docs/spec/telemetry-per-item-observability/verification/api/VS-6-authenticated-source-items.txt`: HTTP 200 for `reddit:r/AI_Agents`, summary `{ ranked: 1, dedupDropped: 1, enrichFailed: 1 }`, `itemCount=3`, `hasDropReason=true`, `serializedLeaks=[]`, log events `source.completed` and `enrichment.summary`.
- `docs/spec/telemetry-per-item-observability/verification/api/VS-6-unauthenticated-source-items.txt`: HTTP 401 with body `{"error":"unauthorized"}`.
- `docs/spec/telemetry-per-item-observability/verification/api/adversarial-api.txt`: invalid run id and malformed source keys return 400; `twitter:@karpathy` returns HTTP 200 with empty items and one `source.failed` log.

## 3. UI Evidence

| Claim / Scenario | Route / Viewport | Screenshot | Evidence |
|---|---|---|---|
| PHASE4-C1 | `/admin/runs/4bd1f427-ede7-4779-b741-403f99b0af46`, 1280x900 | `docs/spec/telemetry-per-item-observability/verification/screenshots/PHASE4-C1-C2-expanded.png` | Fresh reload: `panelCountBefore=0`, `itemRequestsBeforeExpand=0`; after expand, one `/items` request; reddit row `aria-expanded="true"`. |
| PHASE4-C2 | `/admin/runs/4bd1f427-ede7-4779-b741-403f99b0af46`, 1280x900 | `docs/spec/telemetry-per-item-observability/verification/screenshots/PHASE4-C1-C2-expanded.png` | Shows `1 RANKED`, `1 DEDUP-DROPPED`, `1 ENRICH-FAILED`, title href, `RANKED #1`, dedup point comparison, enrich timeout reason, source log strip, and `scrollbar-none` item/log classes. |
| PHASE4-C3 | `/admin/runs/4bd1f427-ede7-4779-b741-403f99b0af46`, 1280x900 | `docs/spec/telemetry-per-item-observability/verification/screenshots/PHASE4-C3-failed-source.png` | Twitter row `aria-expanded="true"`, reddit row `aria-expanded="false"`, `itemListCount=0`, panel has `Source failed`, `source.failed`, and `Twitter cookies not configured`. |

## 4. DB Evidence

- `docs/spec/telemetry-per-item-observability/verification/api/db-seed-check.txt`: seeded run has 3 reddit raw items and run logs `source.completed`, `enrichment.summary`, and `source.failed`.

## 5. Visual Anomalies & UX Observations

Second pass clean across 2 MCP screenshots; per-screenshot notes in `docs/spec/telemetry-per-item-observability/verification/screenshots/observations.md`. No overlap, clipping, stale panel content, or broken section ordering observed.

## 6. Spec Coverage Table

| Requirement | Scenario | Evidence |
|---|---|---|
| REQ-001 | VS-UI-1 / VS-UI-3 | PHASE4-C1 and PHASE4-C3 screenshot rows plus aria evidence in `observations.md`. |
| REQ-002 | Existing collapsed-row e2e and MCP screenshots | Collapsed rows retain Source, Status, Items, Retries, Duration columns in both screenshots. |
| REQ-003 | VS-API-1 / VS-API-2 / ADV-UI-1 | API evidence files and PHASE4-C1 lazy-fetch resource timing. |
| REQ-004 | VS-UI-1 | PHASE4-C2 screenshot and API summary evidence. |
| REQ-005 | VS-UI-2 | PHASE4-C2 screenshot; title href evidence in `observations.md`. |
| REQ-006 | COVERED_BY_E2E | `orderSourceItems` unit coverage in claims PHASE1-C3 and Phase 4 e2e order assertions. |
| REQ-007 | VS-UI-2 | PHASE4-C2 screenshot and reason strings in `observations.md`. |
| REQ-008 | COVERED_BY_E2E | Claims PHASE1-C2 and PHASE3-C1. |
| REQ-009 | COVERED_BY_E2E | Claims PHASE2-C1 and PHASE3-C1. |
| REQ-010 | VS-UI-2 / VS-UI-3 | PHASE4-C2 and PHASE4-C3 screenshots plus API log events. |
| REQ-011 | VS-UI-3 / ADV-API-4 | PHASE4-C3 screenshot; adversarial failed-source API evidence. |
| REQ-012 | VS-UI-2 / VS-UI-3 | `scrollbar-none max-h... overflow-y-auto` class evidence in `observations.md`. |
| REQ-013 | COVERED_BY_E2E | LifecycleTrail unit coverage from PHASE4 claims; live-run MCP not repeated for this completed seeded run. |
| REQ-014 | VS-API-1 | `serializedLeaks=[]` in authenticated API evidence. |
| REQ-015 | COVERED_BY_E2E | Web typecheck/build evidence from coder/review phase. |
| REQ-016 | COVERED_BY_E2E | Pipeline subpath import typecheck/build evidence from coder/review phase. |
| EDGE-001 | COVERED_BY_E2E | PHASE1-C2 lifecycle matrix. |
| EDGE-002 | COVERED_BY_E2E | PHASE3 API composition tests. |
| EDGE-003 | COVERED_BY_E2E | PHASE1-C2 lifecycle matrix and PHASE3 tests. |
| EDGE-004 | VS-UI-2 | Enrich failed/skipped vocabulary covered by lifecycle/unit claims; failed enrichment visible in PHASE4-C2 screenshot. |
| EDGE-005 | COVERED_BY_E2E | SourceItemsPanel unit tests in PHASE4-C2 claim. |
| EDGE-006 | ADV-API-4 | `twitter:@karpathy` special-character route evidence; PHASE4-C4 covers URL encoding. |
| EDGE-007 | VS-UI-3 | Failed empty source screenshot and API empty payload evidence. |
| EDGE-008 | COVERED_BY_E2E | PHASE3-C3 run log source fallback coverage. |
| EDGE-009 | VS-UI-2 | Dedup loser reason includes winner title and points comparison in PHASE4-C2 screenshot. |
| EDGE-010 | NOT VERIFIED | Covered-link prior-run drop classification was not present in the deterministic seeded run; unit coverage exists for best-effort no-crash classification via PHASE1 lifecycle matrix. |

## 7. E2E Coverage Summary

Claims report `.harness/telemetry-per-item-observability/claims.json` has 13 claims, with all 1025 executed tests passing and 0 failures. API/db claims PHASE1-C1 through PHASE3-C4 and PHASE4-C4 are treated as `COVERED_BY_E2E`; UI claims PHASE4-C1, PHASE4-C2, and PHASE4-C3 were re-proven with Playwright MCP screenshots above.

## 8. Adversarial Findings

Adversarial pass clean — 8 scenarios attempted, all behaved correctly.

Quoted result from `docs/spec/telemetry-per-item-observability/verification/adversarial-findings.md`:

> No defects found across 8 scenarios attempted. Categories exercised: boundary inputs, special-character source keys, auth boundary, lazy fetch, stale-state switching, and failed-source recovery. The most promising attack was stale UI state after switching from a populated source panel to a failed empty source; it did not land because the failed panel closed the reddit row, removed the item list, and did not retain the healthy source title.

## 9. Not Executed

- Real production-scale scroll stress was not executed; deterministic local seed kept screenshots small and auditable.
- Cross-browser visual review was not executed; MCP browser evidence covers the configured Chromium browser only.
- EDGE-010 precise covered-link-filter labelling was not executed against a prior published run seed; behavior remains best-effort per spec.

## 10. Infrastructure

- Started worktree API with `API_PORT=3001 pnpm --filter @newsletter/api dev`.
- Started worktree web with `VITE_API_TARGET=http://127.0.0.1:3001 pnpm --filter @newsletter/web dev -- --host 127.0.0.1 --port 5175`; Vite served on `http://localhost:5174`.
- Existing Redis and Postgres local infrastructure were reused.
- Verification seed created by `.harness/telemetry-per-item-observability/verify-seed.mjs`; cleanup ran for run `4bd1f427-ede7-4779-b741-403f99b0af46` after verification artifacts were generated.
