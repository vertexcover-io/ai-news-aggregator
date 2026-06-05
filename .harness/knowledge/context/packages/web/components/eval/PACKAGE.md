---
governs: packages/web/src/components/eval/
last_verified_sha: ad0153a
key_files: [RunDetailDrawer.tsx, CalendarReportComparison.tsx, ReportTab.tsx, PromptDiffModal.tsx, EvalResultsPanel.tsx, EvalAggregateHero.tsx, RunsTable.tsx, RunsFilterBar.tsx, RunsPagination.tsx, ManualFixturePipelinePanel.tsx]
flow_fns: [RunDetailDrawer.tsx::RunDetailDrawer, CalendarReportComparison.tsx::CalendarReportComparison]
decisions: [D-019, D-020]
status: active
---

# components/eval/ — ranking eval admin UI

## Purpose

UI for the ranking eval pipeline: prompt editor (Mode A Scored + Mode B Calendar), per-fixture scoring results, run history, manual fixture creation, and grading keyboard UI. The eval system lets the operator tune the ranking prompt against graded ground truths without affecting the live pipeline.

## Public surface

| Component | Effect |
|---|---|
| `RunDetailDrawer({ runId, onClose })` | Modal with two tabs: **Prompt & Cost** (prompt snapshot + score-breakdown + cost-breakdown) and **Report** (full-width two-column rankings). Visibility is driven by `runId !== null` (no `open` prop). Done runs with report data default to Report tab; running/failed/legacy runs default to Prompt & Cost. |
| `CalendarReportComparison({ report, density })` | Mode B two-column comparison: Previous ranking (left) vs Draft-prompt ranking (right) + prompt panes. Exports `RankingFunnel` (3-cell: Sent for ranking → Ranked (top-N) → Cost, with "(sent − ranked) items considered" note). |
| `ReportTab({ actualRanking, expectedRanking, scoreSheet, poolSize, costUsd })` | Mode A Expected-vs-Actual ranking comparison with score strip, reusing `RankingFunnel`. |
| `EvalAggregateHero({ rows, totalUsd, running })` | Aggregate stats across all fixtures: mean nDCG@10, mean P@10, mean Recall, total cost. |
| `EvalResultsPanel({ rows, onReport })` | Per-fixture results with progress indicators during a running eval. |
| `PromptDiffModal({ open, current, draft, saving, onCancel, onConfirm })` | Diff view between saved prompt and draft before saving. (The standalone `PromptEditor.tsx` textarea was removed as dead code in a844f41 — prompt editing now lives inline in `pages/EvalIndexPage.tsx`.) |
| `RunsTable({ runs, onView })` | Table of past eval runs with status/cost/report links. |
| `RunsFilterBar({ filter, setFilter })` / `RunsPagination` | Filter controls and pagination for the eval runs listing. |
| `ManualFixturePipelinePanel` / `ManualFixtureSourceMixPanel` | UI for creating manual eval fixtures from URLs. |
| `ABResultsPanel` / `SourcingReportPanel` | Mode A/B results and sourcing breakdown. |
| `DiffBody` / `ComparePromptsDialog` | Prompt comparison utilities. |
| `GradeProgressRing` / `GradeKeyboardHintBar` / `ClusterRow` | Grading keyboard UI for `/admin/eval/grade/:fixtureId`. |

## Depends on / used by

- **Uses:** `api/eval` (typed API client + SSE stream), `hooks/useEvalFixture`, `hooks/useEvalFixtures`, `hooks/useEvalRuns`, `hooks/useGradingProgress`, `@newsletter/shared/types/eval-ranking`
- **Used by:** `pages/EvalIndexPage.tsx`, `pages/EvalRunsPage.tsx`, `pages/EvalManualFixturePage.tsx`, `pages/EvalGradePage.tsx`

## Data flows

```
RunDetailDrawer({ runId, open, onClose }):
  useQuery(["eval-run", runId], getEvalRun(runId)) → EvalRun
    → Two tabs: "Prompt & Cost" | "Report"
       ├─ Has report data (done + actualRanking) → default to Report tab
       │    Report tab label: "Report [N → ranked]" hint chip when poolSize known       (D-019)
       └─ Running / failed / legacy → default to Prompt & Cost
  Prompt & Cost tab:
    ├─ Prompt snapshot (non-editable)
    ├─ Score breakdown (per-fixture or aggregate)
    └─ Cost breakdown (USD)
  Report tab (Mode A: scored; Mode B: calendar):
    ├─ Mode A: ReportTab(actualRanking, expectedRanking, scoreSheet, poolSize)
    │    Left column: Expected (graded) ranking
    │    Right column: Actual (LLM-produced) ranking
    │    Each item: rank, title, summary, tier badge (must/nice/drop)
    └─ Mode B: CalendarReportComparison(report, density)
         Left: Previous ranking, Right: Draft-prompt ranking
         RankingFunnel: Sent → Ranked → Cost with pool size context

CalendarReportComparison:
  report: CalendarRunReportEntry
    → RankingFunnel (3-cell funnel):
       ├─ Sent: report.poolSize (deduped pool sent to LLM)     — omitted if null (D-020)
       ├─ Ranked: report.draftRanking.length (top-N output)
       └─ Cost: report.cost.usd
    → Two ranking columns (scrollbar-none, independently scrolling at lg breakpoint):
       ├─ Left: "Previous" — report.previousRanking items with recap
       └─ Right: "Draft" — report.draftRanking items with recap
    → Two prompt panes below rankings (scrollbar-none)
```

## Gotchas / landmines

- **SSE stream abort on unmount**: `EvalIndexPage` stores `streamRef.current` and calls `abort()` in the cleanup effect. Without this, an SSE stream continues consuming resources after the user navigates away.
- **sessionStorage run state persistence**: `EvalIndexPage` persists scored-mode results to `sessionStorage` (with a 1-hour TTL). This survives page refreshes but not tab closes. The persisted state is versioned (`RUN_STATE_VERSION = 1`) so format changes clear stale data.
- **Mode B requires dirty prompt**: The calendar eval mode checks `dirty` (draft !== saved) before allowing a run. This prevents running an eval that would produce identical results to the saved prompt.
- **`RankingFunnel` poolSize null handling** (D-020): Legacy runs without a persisted `poolSize` omit the Sent cell and hint chip — no NaN, no "undefined" display. The funnel gracefully degrades to just "Ranked → Cost".

## Decisions

### D-019: RunDetailDrawer tab default based on report data presence

**Why:** A done eval run with report data is most interesting for its comparison view. A running/failed/legacy run's prompt and cost are the only available data. Defaulting to the Report tab when data exists saves a click.

**Tradeoff:** Operators who want to see the prompt first for a done run need to click the Prompt & Cost tab. The tab label hint chip (`N → ranked`) helps them understand what the Report tab contains.

**Governs:** `components/eval/RunDetailDrawer.tsx`

### D-020: RankingFunnel graceful degradation on null poolSize

**Why:** `poolSize` is an optional field in `scoreBreakdown`/`CalendarRunReportEntry` JSONB added after the eval system launched. Legacy runs don't have it. The funnel must render correctly for both old and new runs.

**Tradeoff:** The "items considered but not surfaced" note is suppressed for legacy runs, which loses information for those runs. Acceptable — the data doesn't exist to compute it.

**Governs:** `components/eval/CalendarReportComparison.tsx`, `components/eval/ReportTab.tsx`
