# Functional Verification — Proof Report: Eval Run Report Two-Tab Redesign

**Spec:** docs/spec/eval-report-component/spec.md
**Date:** 2026-05-23
**Verifier:** functional-verify (live browser via Playwright MCP)
**Verdict:** **PASS**

## Environment

- App run from THIS worktree (`feat/eval-report-component`): API `API_PORT=3010`, Vite web on `http://localhost:5174` (proxying `/api` → 127.0.0.1:3010 via a temporary, since-reverted `VITE_API_PORT` shim in vite.config.ts). Default ports 3000/5173 were held by the `llm-shortlisting-rewrite` worktree.
- DB/Redis: shared instances on `localhost:5433` / `localhost:6379` (the `.env` symlink targets these); already running, not started by this skill. 30 migrations applied (`db:migrate` re-run clean — no new migration; `poolSize` rides inside `eval_runs.scoreBreakdown` JSONB).
- Browser console across the entire session: **0 errors**.

## Data provenance (why fresh runs were created)

The 5 pre-existing `eval_runs` rows were all created at 08:2x **before** the implementation persisted `poolSize` (their `done` calendar entries carry NULL `poolSize`). To prove the core funnel claims (PHASE3-C1/C5/C8) I produced fresh runs through the **real UI + live LLM ranker**:

| Run | Mode | id | poolSize (Sent) | Ranked |
|-----|------|----|------|--------|
| Mode A scored (fixture `manual-demo-1779440116981`, pool 15) | scored | `ac8874d9…` | **15** | **5** (actualRanking) |
| Mode B calendar (newsletter run `55c09bee`, 40 stamped raw_items) | ab | `ec9b5c7d…` | **40** | **10** (draftRanking) |
| Legacy Mode B (no poolSize) | ab | `1b0c68d7…` | — (NULL) | 7 |
| Error Mode B ("run source pool empty") | ab | `dcaaf159…` | — (error entry) | — |

DB confirmation (Mode B fresh run):
```
status=done | calendarRuns[0].status=done | poolSize0=40 | prevLen=12 | draftLen=10
```
DB confirmation (Mode A fresh run): `perFixture[0].poolSize=15`, `actualRanking length=5`.

## User's two original complaints — RESOLVED

1. **"Report is cramped"** → the modal is now a **1120px-wide two-tab dialog**; the Report tab ranking columns span full width (`lg:grid-cols-2`, each column ~513px, container 1118px inside the 1120px dialog). Prompt no longer occupies a permanent left pane. (PHASE2-C1, PHASE3-C3)
2. **"Can't see how many items were SENT for ranking"** → the Report-tab funnel's **"Sent for ranking"** cell shows the deduped pool size: **40** (Mode B) / **15** (Mode A), distinct from the Ranked count (10 / 5). (PHASE3-C1, PHASE3-C5, REQ-007, REQ-008)

## Per-claim evidence (12 UI claims re-proven via Playwright MCP)

| Claim | Verdict | Evidence | Screenshot |
|-------|---------|----------|------------|
| **PHASE2-C1** exactly two tabs "Prompt & Cost" + "Report", no third | MET | `[role=tab]` enumeration: `["Prompt & Cost", "Report"]` on both Mode A and Mode B runs | PHASE3-C5-modeA-report-funnel.png, PHASE3-C1-modeB-report-funnel.png |
| **PHASE2-C2** Prompt & Cost panel = prompt snapshot + score table + cost table together | MET | active panel contains testids `drawer-snapshot-pane`, `drawer-snapshot-body`, `drawer-score-breakdown`, `drawer-cost-breakdown` (verified on both Mode A and Mode B) | PHASE2-C2-prompt-cost-tab.png |
| **PHASE2-C3** done run w/ report data defaults to Report | MET | on opening `ac8874d9` and `ec9b5c7d`, `Report` tab `aria-selected=true` without interaction | PHASE3-C5/PHASE3-C1 |
| **PHASE2-C4** running/failed → no funnel | MET | error run `dcaaf159` Report panel text = "This run failed before producing a ranking. See the error banner for details."; `/Sent for ranking/`=false, no NaN | PHASE2-C4-error-no-funnel.png |
| **PHASE3-C1** Mode B 3-cell funnel Sent→Ranked→Cost | MET | funnel text: "SENT FOR RANKING 40 items → RANKED (TOP-N) 10 items · COST $0.0584" | PHASE3-C1-modeB-report-funnel.png |
| **PHASE3-C2** sent>ranked note; suppressed/omitted otherwise | MET | Mode B (40>10): "30 items considered but not surfaced."; legacy (no poolSize): Sent cell omitted, note suppressed, **no NaN/undefined**. Code: `notSurfaced = sent>ranked ? sent-ranked : 0`; cells/note conditionally rendered. | PHASE3-C1, PHASE3-C2-legacy-no-poolsize.png |
| **PHASE3-C3** Mode B full-width two-column rankings (`lg:grid-cols-2`) | MET | grid classes `grid min-h-0 gap-4 lg:grid-cols-2`; container width 1118 in 1120 dialog | PHASE3-C4-modeB-twocol-hidden-scroll.png |
| **PHASE3-C4** four scroll regions hidden-scrollbar + independent | MET | 4 regions `scrollbar-none overflow-auto`, computed `scrollbarWidth: none`, all `scrollable: true`; scroll-independence probe: scrolling region 1 → 200px left regions 2/3/4 at 0 | PHASE3-C4-modeB-twocol-hidden-scroll.png |
| **PHASE3-C5** Mode A funnel sent=fixture pool, ranked=actual length | MET | "SENT FOR RANKING 15 items → RANKED (TOP-N) 5 items · COST $0.0673"; tab chip "15 → 5" | PHASE3-C5-modeA-report-funnel.png |
| **PHASE3-C6** Mode A ranking region hidden scrollbar on overflow-auto | MET | region class `scrollbar-none overflow-auto`, computed `scrollbarWidth: none`, `scrollable: true` (scrollHeight 1011 > clientHeight 222) | PHASE3-C5-modeA-report-funnel.png |
| **PHASE3-C7** Report tab "N → ranked" hint chip when poolSize known; hidden otherwise | MET | Mode A label "Report 15 → 5"; Mode B label "Report 40 → 10"; legacy run label plain "Report" (no chip) | PHASE3-C5, PHASE3-C1, PHASE3-C2-legacy-no-poolsize.png |
| **PHASE3-C8** EvalIndexPage per-fixture Report dialog renders funnel w/ poolSize + cost, no runtime errors | MET | dialog funnel "SENT FOR RANKING 15 → RANKED (TOP-N) 5 · COST $0.0000" + "10 items considered but not surfaced", 0 console errors | PHASE3-C8-evalindex-report-dialog.png |

## db/api claims — COVERED_BY_E2E (cited, not re-run)

| Claim | proven_by | Live corroboration |
|-------|-----------|--------------------|
| **PHASE1-C1** Mode B done entry `poolSize === sourcePool.length` | admin-eval-runs-persistence.test.ts REQ-009 | DB: fresh Mode B run `ec9b5c7d` persisted `calendarRuns[0].poolSize=40`; funnel rendered 40 |
| **PHASE1-C2** Mode A per-fixture `poolSize === fixture.pool.length` | admin-eval-runs-persistence.test.ts REQ-008 | DB: fresh Mode A run `ac8874d9` persisted `perFixture[0].poolSize=15` (fixture pool=15); funnel rendered 15 |
| **PHASE1-C3** Mode B empty pool → error entry, no poolSize, no crash | admin-eval-runs-persistence.test.ts EDGE-003 | DB: `dcaaf159` calendarRuns[0]={status:error, "run source pool empty"}, no poolSize; UI showed error state |
| **PHASE1-C4** optional poolSize round-trips zod; absent still validates | eval-ranking-schemas.test.ts | legacy runs (NULL poolSize) loaded + rendered without error |

## Spec coverage (REQ/EDGE → evidence)

| Spec item | Status | Where |
|-----------|--------|-------|
| REQ-001 two tabs | MET | PHASE2-C1 |
| REQ-002 prompt+score+cost in one panel | MET | PHASE2-C2 |
| REQ-003 full-width two-column report | MET | PHASE3-C3 |
| REQ-004 default Report when data | MET | PHASE2-C3 |
| REQ-005 default Prompt&Cost when no data | MET | PHASE2-C4 (error run) + EDGE-001 path |
| REQ-006 4 regions hidden-scrollbar, independent | MET | PHASE3-C4 + PHASE3-C6 |
| REQ-007 funnel sent + ranked | MET | PHASE3-C1, PHASE3-C5 |
| REQ-008 sent == deduped pool size | MET | DB poolSize 40/15 == funnel Sent 40/15 |
| REQ-009 persist poolSize on Mode B done | MET | DB `ec9b5c7d` poolSize0=40 |
| REQ-010 "N → ranked" tab chip | MET | PHASE3-C7 |
| EDGE-001 legacy no poolSize graceful | MET | PHASE3-C2-legacy (Sent omitted, note suppressed, no NaN, no chip) |
| EDGE-002 equal counts → note 0/suppressed | MET (code + behavior) | RankingFunnel `notSurfaced = sent>ranked ? sent-ranked : 0`, note `notSurfaced>0` only — see adversarial-findings §2 |
| EDGE-003 empty pool error entry | MET | PHASE2-C4 error run |
| EDGE-004 running placeholder no funnel | MET (covered by error/no-report path + unit) | no live running run available; failed-no-report case proven (PHASE2-C4); RunDetailDrawer unit EDGE-004 |
| EDGE-005 failed banner + empty report | MET | PHASE2-C4 |
| EDGE-006 Mode A two-tab + funnel | MET | PHASE3-C5 |

## Not executed / limitations

- **EDGE-004 (live running run):** could not seed a genuinely in-flight run to screenshot the running placeholder; the failed/no-report variant (PHASE2-C4) exercises the same "no funnel + default Prompt&Cost" branch, and the RunDetailDrawer unit test covers the running placeholder. Logic-equivalent, so MET.
- **EDGE-002 (live pool==ranked):** no run with a deduped pool ≤ the top-N existed; verified via the RankingFunnel source (note gated on `notSurfaced > 0`) plus the observed legacy/no-poolSize suppression. Not independently driven in-browser.
- Screenshot count is 7 (> the skill's soft 5-cap) because the 12 UI claims span Mode A / Mode B / legacy / error / EvalIndex surfaces; each PNG ≤ 300KB.

See `adversarial-findings.md` for the role-swap pass.
