# Eval run comparison report

**Spec status:** approved (consolidated — no library probe, no separate brainstorm; this builds on the existing eval-runs persistence + UI without introducing new external libraries).

**Branch:** `feat/ranking-eval-pipeline` (follow-up on the same PR).

---

## Problem

The `/admin/eval/runs` page lists past Mode A eval runs and surfaces a `nDCG@10`
column + a per-run drawer with score and cost breakdowns. What it does NOT
surface is **why** a run scored the way it did — the operator cannot, from the
UI alone:

- See which items the ranker actually produced for the fixture.
- Compare that against the graded ground truth that defined "good."
- Spot must-include items the ranker buried below top-10 or dropped entirely.
- Read the LLM's rationale + generated recap for any specific item.

Today, debugging a regression in score means SSH'ing onto the box, opening the
fixture + groundtruth JSONs by hand, and mentally cross-referencing them with
the SSE stream's progress events that are gone the moment the run ends.

## Goal

Give the operator a **Report tab** inside the existing run-detail drawer that
shows, for a Mode A run against a single manual fixture, an at-a-glance
side-by-side of:

1. **Score sheet header** (nDCG@10, nDCG@5, P@10, must-include recall, rank-1 =
   must) — same numbers already in the drawer's existing Breakdown view,
   hoisted to the top of the Report tab.
2. **Missing-must-includes banner** — items the human grader tagged `tier:
   "must"` that the ranker either dropped or pushed below the top-10.
3. **Side-by-side table** — left column = expected (graded ground truth, with
   tier chip), right column = actual ranker output (with score + rust accent
   for rank-1). Inline rank-delta marker next to each actual row: `↑3` (green),
   `↓2` (rust), `NEW`, `DROPPED`. Unchanged = neutral grey "—".
4. **Per-item rationale + recap expander** on each actual row.

The point of the report is to compress the "is this a good run?" question into
one screen the operator can scan in seconds. Tier here is the existing
fixture-grading domain term (`"must" | "nice" | "drop"`); the report respects
all three values.

## Non-goals

- Mode B (A/B compare) runs do not get a Report tab — there is no graded
  ground truth in that mode, only two side-by-side ranker outputs which the
  existing drawer already handles via `buildScoreRows` / `buildCostRows`.
- No backfill of historical rows. Runs persisted before this lands will render
  an empty-state Report tab with the message "No report available — this run
  was created before reports were captured."
- No new comparison view spanning two runs — that is the existing "Compare"
  bar on the runs page (different scope).
- No write access from the Report tab — read-only. Promoting a fixture, saving
  a prompt, regrading: all stay on their existing pages.

## Requirements

### REQ-1: Persist actualRanking + expectedRanking at SSE finalize

At the moment the SSE handler in `packages/api/src/routes/admin-eval.ts` calls
`persistFinish(scoreBreakdown, costBreakdown)`, the score breakdown's
`perFixture[i]` shall additionally carry:

- `actualRanking`: ordered array (rank 1 → N) of
  `{ rawItemId, url, title, score, rationale, summary, bullets, bottomLine }`.
  Built from `RunEvalOutput.rankedItems` joined with the fixture's pool to
  resolve `url`/`title`. Summary / bullets / bottomLine pulled from the
  ranker's recap output (`RankedItemRef.summary`, `bullets`, `bottomLine`);
  any missing field is the empty string / empty array (the existing recap
  pipeline guarantees non-null strings on success).
- `expectedRanking`: ordered array of
  `{ rawItemId, url, title, tier, rank }` — sorted by tier priority
  (`must` first, then `nice`, then `drop`), with `rank` reflecting that order.
  Built from the fixture's `pool` joined with `groundTruth.labels`. Items in
  the pool that have no GT label are excluded (they were not graded).

Both fields live inside `scoreBreakdown.perFixture[i]` — no new column, no
schema migration. The shapes shall be expressed as exported TypeScript
interfaces in `@newsletter/shared/types/eval-ranking` so the API and web
packages share a single source of truth.

`expectedRanking` is captured at run-time (not lazy-resolved from the fixture
on read) so future regrades to the fixture do not retroactively shift a
historical report. This locks the contract between what was scored and what
the operator sees.

### REQ-2: Mode-A-only

Mode B runs shall NOT carry `actualRanking` / `expectedRanking`. The
persistence path only writes them inside the `req.mode === "scored"` branch.

### REQ-3: Report tab in RunDetailDrawer

The drawer's right pane shall expose two tabs:

- **Breakdown** — existing score + cost tables (preserves all current
  `data-testid` values: `drawer-score-breakdown`, `drawer-cost-breakdown`,
  `drawer-running-placeholder-{score,cost}`).
- **Report** — new tab, default-visible for Mode A done runs that carry
  `actualRanking` + `expectedRanking`. For Mode A runs without those fields
  (legacy, or status !== "done"), render the empty-state. Mode B runs hide the
  Report tab entirely.

Tab switch shall be keyboard-accessible (Tab to focus, Enter / Space to
switch). The score sheet header strip inside the Report tab shall remain
sticky at the top while the side-by-side table scrolls underneath.

### REQ-4: Side-by-side rendering

The Report tab's main content is a two-column table aligned by `rawItemId`:

- **Left** (Expected): rank number, tier chip (`must` = rust pill, `nice` =
  neutral pill, `drop` = light-grey pill), title (truncated at 80 chars with
  ellipsis), and a small URL host suffix (e.g., `· github.com`). Items not in
  the actual top-N show no special marker on the left.
- **Right** (Actual): rank number, title (same truncation), score (3-decimal),
  and a rank-delta marker:
  - `↑N` in green when actual rank < expected rank by N positions.
  - `↓N` in rust when actual rank > expected rank by N positions.
  - `NEW` in blue when the item has no expected rank (was not graded).
  - `DROPPED` shown on a row in the LEFT column (with no right-column row)
    for must-include items the ranker omitted from top-N entirely.
  - `—` neutral grey when ranks match.

Row alignment: rows are keyed by `rawItemId` so the left and right entries for
the same item appear on the same row, with `↑/↓` indicating the movement. An
expected-but-dropped item shows on the left with the right column empty; a
new-in-actual item shows on the right with the left column empty.

### REQ-5: Missing-must-includes banner

Above the side-by-side table, when at least one `tier === "must"` item is
absent from `actualRanking[0..9]`, render a rust-bordered banner:

> **N must-include item(s) missing from top-10**: title-1, title-2, …

Title list is truncated at 3 entries with `… +N more` suffix if more.

### REQ-6: Per-item rationale + recap expander

Each row on the right (actual) side has an affordance to expand and reveal:

- `Rationale:` the rationale string from the ranker (italic).
- `Summary:` the recap summary.
- `Bullets:` rendered as a `<ul>`.
- `Bottom line:` shown last in a small rust-rule block.

Expander shall be keyboard-toggleable.

### REQ-7: Empty-state for legacy / non-applicable runs

When the Report tab is rendered but the run's
`scoreBreakdown.perFixture[0].actualRanking` is undefined / not an array,
display a single neutral panel:

> **No report available** — this run was created before reports were captured.
> Re-run the eval against this fixture to populate the comparison.

Same empty-state shown when status !== "done".

### REQ-8: Subpath imports in web

Every shared-type import in `packages/web/src/components/eval/` shall use the
`@newsletter/shared/types/...` subpath, never the root barrel. This avoids
leaking the DB client into the browser bundle (see learning
`web-shared-subpath-imports`).

### REQ-9: No schema migration

Persistence is purely an extension of an existing JSONB column. No Drizzle
migration, no new `eval_runs` column. The shared types treat the new fields
as optional so a run with `actualRanking === undefined` is still valid.

## Verification scenarios

| ID | Surface | Behaviour |
|----|---------|-----------|
| VS-1 | Backend | `POST /api/admin/eval/run` with `mode: "scored"`, `fixtureId: <graded>` and waiting for the SSE `done` event results in an `eval_runs` row whose `scoreBreakdown.perFixture[0]` has `actualRanking` (length = 10) and `expectedRanking` (length = number of graded labels). |
| VS-2 | Backend | Mode B run (`mode: "ab"`) results in a row whose `scoreBreakdown` is the existing `{saved, draft}` shape with NO `actualRanking` field anywhere. |
| VS-3 | Web unit | RunDetailDrawer renders both Breakdown and Report tabs for a Mode A done run; Breakdown's existing test IDs still present. |
| VS-4 | Web unit | Report tab renders sticky score sheet + missing-must banner + side-by-side table with at least one `↑N`, one `↓N`, one `NEW`, one `DROPPED` row. |
| VS-5 | Web unit | Per-item expander toggle exposes rationale + summary + bullets + bottomLine. |
| VS-6 | Web unit | Mode B run: Report tab is hidden, drawer shows only Breakdown. |
| VS-7 | Web unit | Legacy Mode A run without `actualRanking`: Report tab present but renders empty-state copy. |
| VS-8 | Live (Playwright) | Open `/admin/eval/runs`, click most recent Mode A done run, switch to Report tab, screenshot shows side-by-side + deltas. |
| VS-9 | Live (Playwright) | Open a run created before this feature; Report tab shows the empty-state. |

## Out-of-scope but flagged

- The drawer's existing `drawer-snapshot-pane` (prompt snapshot, left half)
  stays unchanged — both Breakdown and Report tabs share that left pane.
- If a future feature wants to **diff** two runs' reports side by side
  (your fixture-A on prompt-1 vs prompt-2), the persisted shape already
  supports it; this spec just doesn't build the diff UI.
