# Eval Run Report — Two-Tab Redesign + "Items Sent for Ranking"

**Verification verdict:** ✅ **PASS** — see [verification/proof-report.md](./verification/proof-report.md) (12/12 UI claims re-proven via Playwright against the live app).

**PR:** https://github.com/vertexcover-io/ai-news-aggregator/pull/183

## What was built

The `/admin/eval/runs` run-detail modal was redesigned to fix two issues:

1. **The report was cramped.** The modal used a fixed split (wide prompt pane + narrow tabbed area), squeezing the rankings into a tiny column. It is now **two full-width tabs**: **Prompt & Cost** (prompt snapshot + score breakdown + cost breakdown) and **Report** (the rankings, given the full modal width). Applies to both Mode A (scored) and Mode B (calendar). The four scroll regions (two ranking columns + two prompt panes) scroll independently with hidden scrollbars.

2. **Only the ranked-output count was visible.** The Report tab now opens with a 3-cell funnel — **Sent for ranking → Ranked (top-N) → Cost** — where "Sent for ranking" is the deduped candidate-pool size actually fed to the LLM ranker (distinct from the ranked output, which is capped at top-N). A "(sent − ranked) items considered but not surfaced" note explains the gap, and the Report tab label carries a compact `N → ranked` hint chip. The pool size is persisted as an **optional** `poolSize` inside the existing `eval_runs.scoreBreakdown` JSONB (no DB migration), so runs created before this change degrade gracefully (Sent cell + chip omitted, no NaN).

The visual design was produced as a `frontend-design` mock and approved before implementation: [docs/mocks/eval-report-redesign.html](../../mocks/eval-report-redesign.html).

## Reviewer index

| Artifact | Purpose |
|----------|---------|
| [spec.md](./spec.md) | EARS requirements (REQ-001..010), edge cases, verification matrix |
| [plan.md](./plan.md) | 3-phase implementation plan + phase graph |
| [library-probe.md](./library-probe.md) | Dependency gate — NOT_APPLICABLE (no external deps) |
| [learnings.md](./learnings.md) | Task-specific learnings (optional-field fixtures; shared-DB e2e contention) |
| [verification/proof-report.md](./verification/proof-report.md) | Functional verification verdict + per-claim Playwright evidence |
| [verification/adversarial-findings.md](./verification/adversarial-findings.md) | Adversarial role-swap pass (7 scenarios, 0 defects) |
| [verification/screenshots/](./verification/screenshots/) | Live UI screenshots per claim |
| [../../mocks/eval-report-redesign.html](../../mocks/eval-report-redesign.html) | Approved frontend-design mock (visual source of truth) |

## Library probe

**NOT_APPLICABLE** — no external dependency introduced. All capabilities use libraries already in the stack (React, @tanstack/react-query, Hono, zod, Tailwind, pure-CSS hidden scrollbars). No alternatives needed.

## Implementation summary

- **Phase 1** (`shared` + `api`): added optional `poolSize` to `CalendarRunReportEntry` (done) and `PerFixtureResult`; populated from the deduped pool length at both Mode B (`detail.sourcePool.length`) and Mode A (`fixture.pool.length`) build sites in `admin-eval.ts`. Zod schemas kept aligned. 32 unit tests.
- **Phase 2** (`web`): restructured `RunDetailDrawer` into two full-width tabs; default-tab logic preserved. 18 component tests.
- **Phase 3** (`web`): added the `RankingFunnel`, full-width two-column rankings, hidden-scrollbar `scrollbar-none` utility, and the Report-tab hint chip across `CalendarReportComparison` (Mode B) and `ReportTab` (Mode A). 62 unit tests.

**Totals:** 112 net-new tests, 0 failures. Quality gate PASS (9/9 checks).
