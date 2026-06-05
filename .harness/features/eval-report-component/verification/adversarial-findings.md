# Adversarial Findings — Eval Run Report Two-Tab Redesign

**Role:** critic (role-swap). Goal: break the funnel/tab redesign, not confirm it.
**Context break:** generated from spec ACs + claims.json gaps only.

## 1. Attack surface derived

Gaps (spec ACs not directly in `claims.json` claims[], or boundary/recovery surfaces):

- **EDGE-002** (equal counts, pool ≤ ranked): not a claim → does the "considered but not surfaced" note show "0" or a negative? *(spec-gap)*
- **Cost rendering**: `RankingFunnel` renders `${costUsd.toFixed(4)}` — what if cost is null/non-finite (legacy run, cache hit, error)? Could throw / show `NaN`. *(derived: error-recovery)*
- **Legacy poolSize undefined**: funnel must omit Sent without `NaN`/`undefined` and hide the tab chip — boundary value `undefined`. *(EDGE-001, claim-coverage-gap on the negative)*
- **Responsive / resize**: shrink the modal to mobile width — does the `lg:grid-cols-2` two-column report overlap, clip, or overflow horizontally? *(derived: boundary layout)*
- **Scroll cross-talk**: the four hidden-scrollbar regions — does scrolling one move the others (a regression the hidden scrollbar could mask)? *(REQ-006 negative)*
- **Tab default with error data**: an all-error Mode B run has no usable report — does it still try to render a funnel with bogus zeros, or fall back? *(EDGE-003/EDGE-005 boundary)*

## 2. Scenarios attempted

| ID | Category | Description | Inputs | Verdict |
|----|----------|-------------|--------|---------|
| A1 | Boundary value | Open legacy Mode B run with NULL poolSize; inspect funnel for NaN/undefined | run `1b0c68d7` | EXPECTED — Sent cell omitted, "considered" note suppressed, no NaN, tab chip absent |
| A2 | Error recovery | Open all-error Mode B run; confirm no funnel with bogus zeros | run `dcaaf159` (calendarRuns[0]=error) | EXPECTED — shows "This run failed before producing a ranking. See the error banner for details."; no funnel |
| A3 | Error recovery | Cost = null / non-finite → `toFixed(4)` crash or `NaN`? | code path: `RunDetailDrawer` costUsd derivation | EXPECTED — `costUsd` guarded: `Number.isFinite(cost.usd) ? cost.usd : 0`; EvalIndex uses `?? 0`. Never throws. Legacy run rendered "$0.0066"; cache-hit EvalIndex dialog rendered "$0.0000" not NaN |
| A4 | Boundary layout | Resize modal to 390×800 (mobile); check two-column report for overlap/overflow | viewport 390px | EXPECTED (with note) — report grid collapses to 1 column (`gridTemplateColumns: 283px`), funnel intact, no NaN. Horizontal overflow exists (`scrollWidth 812 > clientWidth 390`) but **all overflowing nodes are `inDialog:false`** — the runs-list filter bar + table behind the modal, which spec §Out-of-Scope explicitly excludes ("No redesign of the runs list table, the filter bar"). Modal/funnel content has zero overflow. Pre-existing, out-of-scope. |
| A5 | REQ-006 negative | Scroll ranking column 1 by 200px; assert columns 2/3/4 stay at scrollTop 0 | Mode B run `ec9b5c7d` | EXPECTED — before `[0,0,0,0]` → after `[200,0,0,0]`; regions are independent |
| A6 | Boundary value | EDGE-002 equal counts (sent == ranked): is "considered but not surfaced" shown with 0 or negative? | code: `RankingFunnel` (no live run available) | EXPECTED — `notSurfaced = sent>ranked ? sent-ranked : 0`; note rendered only when `notSurfaced > 0`. Equal counts → note suppressed, never negative |
| A7 | Boundary value | Mode A funnel with sent(15) > ranked(5): note math | run `ac8874d9` | EXPECTED — "10 items considered but not surfaced." (15-5=10) |

## 3. Defects

**None.** No DEFECT-class issues (no misleading message, lost/corrupted data, stale UI, 500 to user, silent no-op, permission leak, or broken recovery path) were found.

The one anomaly (A4 horizontal overflow at mobile width) is confined to out-of-scope page chrome (runs-list table/filter bar) behind the modal, not the feature under test, and is explicitly excluded by the spec's Out of Scope section. Recorded as EXPECTED, not a defect.

## 4. Cannot assess

- **Live in-flight "running" run (EDGE-004):** could not produce a genuinely running eval to screenshot the running placeholder — eval runs complete in seconds. The failed/no-report branch (A2) exercises the same "no funnel" code path and the unit test covers the running placeholder. Logic-equivalent.
- **Live pool==ranked run (EDGE-002):** no completed run had a deduped pool small enough to equal the top-N; assessed via source (A6).

## 5. Honest declaration

No defects found across 7 scenarios attempted. Categories exercised: boundary values (null poolSize, equal counts, sent>ranked), error recovery (error entry, null/non-finite cost), responsive layout (mobile resize), and the REQ-006 scroll-independence negative.

The most promising attack was A3 (cost `toFixed(4)` on a null/non-finite value) — a classic "happy-path number assumed" crash. It didn't land because both call sites independently coerce to a finite number before the funnel sees it (`RunDetailDrawer` via `Number.isFinite(...) ? cost.usd : 0`, `EvalIndexPage` via `reportRow.cost?.usd ?? 0`), and the legacy + cache-hit runs confirmed "$0.0000"/"$0.0066" rather than "$NaN" in the live UI. The second-most promising (A4 mobile overflow) traced entirely to the out-of-scope runs-list chrome behind the modal, not the redesigned modal content.
