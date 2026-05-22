# Ranking Eval Pipeline — Design v2

**Status:** Draft
**Date:** 2026-05-22
**Source:** discussion captured in `docs/transcript/19-05-2026.md`, `docs/transcript/19-05-2026.txt`, `docs/transcript/21-05-2026.txt`
**Supersedes:** `design.md` (this v2 keeps the aligned core and adds gaps Ritesh explicitly called for in the 21-05 follow-up sync)
**Linear:** VER (AI Newsletter)

---

## Why a v2

The earlier `design.md` captured the *core* eval loop (export historical fixtures → grade in UI → replay current ranker → score nDCG) accurately and that core stands. But the 21-05-2026 sync surfaced four requirements that the v1 design either didn't cover or treated as out-of-scope. Ritesh was explicit about each, so v2 folds them in:

1. **Manual-fixture creation in the UI** — "you could just come and put up 12–15 links … it doesn't need to always depend upon the run." Faster onboarding than waiting for graded days. (21-05, 27:34)
2. **Eval runnable from the admin UI, not just CLI** — "ideally we should expose it in both the places … then you have actually built a system which is like an evaluator system." (21-05, 30:34)
3. **"No-fixture" calendar replay** — pick any past date, run the current (or a draft) prompt against that day's pool, see the new ranking. No grading required. *This is the feature Ritesh personally wants for his own iteration.* (21-05, 31:25)
4. **Prompt-iteration as the inner loop** — the ranking prompt now lives in the admin UI (`user_settings.rankingPrompt`, see migration 0026). The eval is the loop that makes prompt edits an evidence-driven activity. The iteration must happen *in the UI*, alongside the prompt editor.

v2 also fixes one small mismatch: Ritesh asked for **top 10**, not top 12, as the target newsletter size (21-05, 39:00 — "ideally try to avoid more than 10, actually we should make 10 and not 12, and it could be less also").

Everything else from v1 — append-only fixtures, dedup-collapse grading, model pinning, LLM response cache, sourcing-report-as-byproduct, file-on-disk ground truth — carries over unchanged.

---

## Problem Statement

(unchanged from v1) Ranking quality is a black box. We can't quantify, compare, or reproduce bad days. The unlock isn't a smarter ranker; it's a measurement loop.

The v2 framing tightens this: the measurement loop has to live *next to the prompt editor*. If iterating means "edit the prompt in /admin/settings → trigger a full pipeline run → wait → eyeball the archive," the loop is too slow and nobody runs it. The eval must compress that loop to seconds (cache-hit) or a small handful of dollars (cache-miss), and it must do so from the same screen the prompt is edited on.

## Context

(carries from v1, with one addition)

- Two synthetic eval scripts already exist (`evaluate-rank-prompt.ts`, `evaluate-run-rank-prompt.ts`). Hand-written 12-candidate fixtures, binary pass/fail. They are smoke tests, not a ground-truth eval set. They stay; the new pipeline is a separate command.
- Live ranker is two-stage: `shortlist.ts` (recency-decay top-K) → `rank.ts` (Claude Haiku, 3-axis rubric, structured output via `generateObject`).
- `raw_items` rows survive runs (no TTL). Last 15 days of pool data is recoverable via a single `SELECT … WHERE created_at >= now() - interval '15 days'`. Backfill is an export job, not a re-collect job.
- `run_archives.rankedItems` holds the final ranker output per reviewed archive.
- **New in v2 context:** the ranking prompt is admin-editable at `/admin/settings` (`user_settings.rankingPrompt`, seeded by migration 0026 with the verbatim `DEFAULT_RANKING_PROMPT`). The pipeline re-reads it on every run. Any eval that involves a "draft prompt" must override this stored value at replay time without mutating it.
- The deferred `personalized-ranking-design.md` (profile-based rerank) does not block this v2; fixtures and ground truth carry over if profiles ship.

## Requirements

### Functional

Three feature surfaces. Each requirement is tagged with the surface it belongs to: **[Fixture]** = data-capture infra, **[Grade]** = ground-truth UI, **[Eval]** = the replay/scoring loop.

#### Fixture lifecycle

- **F1. [Fixture] Historical export CLI.** `pnpm --filter @newsletter/pipeline eval:export-fixtures [--days 15] [--force]` reads the last N days of `raw_items` by `runId`, joins with `run_archives` for dedup-cluster snapshots and the original ranker output, writes `evals/ranking/fixtures/run-<date>-<runId>.json`. Idempotent.
- **F2. [Fixture] Manual fixture builder (UI).** `/admin/eval/fixtures/new` lets an admin paste a newline-separated list of URLs. The server fetches each URL through the existing `link-enrichment` service (same code path as the live pipeline) to populate title, description, OG image, body markdown, then writes `evals/ranking/fixtures/manual-<slug>-<timestamp>.json`. Source-type is inferred from URL host or marked `manual`. Engagement is null. This satisfies Ritesh's "manually create 100 lists" path (21-05, 27:00).
- **F3. [Fixture] Fixture pins the model.** Every fixture records `model: "claude-haiku-4-5-20251001"` (or whatever was used at fixture-creation time). Replay defaults to the pinned model.
- **F4. [Fixture] Fixture index.** `GET /api/admin/eval/fixtures` returns all fixtures (run-derived + manual) with grading status (`ungraded` / `in_progress` / `graded`) and item counts. Drives the eval landing page.

#### Grading

- **F5. [Grade] Admin grading route.** `/admin/eval/grade/:fixtureId` loads any fixture (run or manual) and lets the grader mark each undeduped item **must-include / nice-to-have / drop** via single-keystroke shortcuts (`1` / `2` / `3`). Title + source + age + thumbnail visible by default; `space` expands the enrichment description.
- **F6. [Grade] Dedup-collapsed rows.** Near-duplicate items collapsed by the live `dedup` stage are pre-collapsed in the UI. One representative (highest-engagement) per cluster, with a `+N duplicates` badge. The grader's label applies to the whole cluster. Manual fixtures skip dedup (small N, no collapse).
- **F7. [Grade] Resumable progress.** Mid-grade state lives in browser localStorage keyed by `(fixtureId, gradedBy)`. Reopening the same fixture resumes where left off. "Export & commit" only enables when every cluster has a label.
- **F8. [Grade] Ground-truth file output.** Saving produces `evals/ranking/groundtruth/<fixtureId>.json`: `{ fixtureId, gradedBy: string[], gradedAt, labels: [{ rawItemId, tier }] }`. The UI offers a "Download & I'll commit it" affordance (file download) AND a "Save to repo" path (POST to a dev-only endpoint that writes the file directly — gated behind an env flag for local dev only, never enabled in prod).
- **F9. [Grade] Append-only.** Re-grading an existing fixture appends a second `gradedBy` signature and overwrites labels. The fixture is never edited.

#### Eval & iteration

- **F10. [Eval] Admin eval page is the inner loop.** `/admin/eval` hosts a **prompt editor (preloaded with `user_settings.rankingPrompt`)**, a **fixture / date picker**, a **Run** button, and a **results panel**. This is where Ritesh and Aman iterate. The page never mutates `user_settings.rankingPrompt` unless the admin clicks **"Save as current prompt"** explicitly.
- **F11. [Eval] Two modes on the same page.**
  - **Mode A — Graded fixture (scored).** Pick a fixture that has ground truth. Run with the draft prompt. Output is the nDCG@10 + precision@10 + must-include recall + rank-1-is-must + per-item diff, **plus** delta vs the last cached score on this same fixture.
  - **Mode B — Calendar replay (unscored A/B).** Pick a past date from a calendar (any date with raw_items, no ground truth required). The system runs **two** rankers in parallel: (a) the currently-saved `user_settings.rankingPrompt`, (b) the draft prompt in the editor. Output is a side-by-side ranked list (top 10 from each). No score, no ground truth — pure human eyeball comparison. This is the feature Ritesh personally said he wants (21-05, 31:25–32:08).
- **F12. [Eval] CLI parity.** `pnpm --filter @newsletter/pipeline eval:ranking [--fixture <id>] [--all] [--prompt-file <path>] [--dry-run] [--no-cache] [--diff] [--json]` runs Mode A from the command line. Both UI and CLI share the same replay + scoring code in `@newsletter/pipeline/src/eval/`. "Both places" was an explicit ask (21-05, 30:34).
- **F13. [Eval] Scoring metrics.**
  - **Primary:** nDCG@10 (was @12 in v1; corrected to match Ritesh's "make it 10" — 21-05, 39:00). Graded-relevance mapping: `must=3`, `nice=1`, `drop=0`.
  - **Secondary:** precision@10, must-include recall, rank-1-is-must-include (boolean), per-item diff (ranker vs ground truth), and sourcing report.
- **F14. [Eval] LLM response cache.** Disk cache keyed by `(fixtureId, prompt-hash, model)`. Cache hit → free + sub-second. Cache miss → real Anthropic call, real tokens. Cache lives under `evals/ranking/cache/responses/`, gitignored. This is the thing that makes "edit prompt, click Run, see delta in 2 seconds" possible when re-running the same prompt against a fixture you've already evaluated.
- **F15. [Eval] Cost guard for windowed replays.** When the admin runs Mode A in `--all` mode or selects a date range, the system caps replays to the most recent **20 fixtures / 20 days** by default. A `--window N` flag (CLI) or input (UI) overrides up to 60. Beyond that the system requires explicit confirmation with an estimated dollar cost. (Addresses Ritesh's "shouldn't be considering 100 days" — 21-05, 29:26.)
- **F16. [Eval] Cost transparency.** Both UI and CLI display **estimated** token spend before running and **actual** spend after. Mode B always shows estimate (it can't hit cache for the draft prompt).
- **F17. [Eval] Sourcing report as byproduct.** Aggregating must-include labels by `sourceType` across graded fixtures, surfaced in CLI and UI. Tells us where must-includes come from over time. Descriptive only, never prescriptive.
- **F18. [Eval] Save draft as current prompt.** A button on `/admin/eval` writes the draft prompt to `user_settings.rankingPrompt` (calls existing `PUT /api/settings`). Confirmation modal shows the diff before write. Closes the iteration loop.

### Non-functional

- **NF1. Grading throughput.** ~20 minutes per ~400-item fixture (≤250 after dedup). Keyboard-only, no required mouse action.
- **NF2. Iteration latency.**
  - Cache hit Mode A: < 2 s total round-trip from "Run" click to scored result.
  - Cache miss Mode A on one fixture: < 30 s (one Anthropic Haiku call).
  - Mode B on one date: < 60 s (two parallel Anthropic Haiku calls).
- **NF3. Replay determinism.** Temperature 0, model pinned by fixture, prompt-hash makes cache deterministic.
- **NF4. Fixture immutability.** Once committed, never edited. Mislabels accepted.
- **NF5. Cost transparency.** No replay runs without showing estimated cost first.
- **NF6. Failure isolation.** One failing fixture in `--all` or windowed-replay prints its error and skips; the rest complete.
- **NF7. Package boundaries.** Replay + scoring code in `@newsletter/pipeline/src/eval/` (shared by CLI and UI). API routes in `@newsletter/api/src/routes/admin/eval/`. UI in `@newsletter/web`. Fixture/ground-truth/score types + zod schemas in `@newsletter/shared`. **No new package.**
- **NF8. Audience.** Internal-only (Ritesh + Aman) for v1. The schemas (`fixtureId` strings, `gradedBy: string[]`, no userId on fixtures) are deliberately *not* multi-tenant — that's an explicit choice to keep v1 simple. v2-product-feature exposure is a future design.

### Edge Cases

(carries from v1 + v2-specific additions)

- **Old raw_items with missing enrichment.** `metadata.enrichedLink === null` → fixture stores null, replay handles null exactly as live ranker does (title-only ranking).
- **Original-ranker prompt no longer exists.** Fixture stores original output for diff display; scoring always uses current ranker's replay output. Old rankings are reference only.
- **Mid-grade distraction.** localStorage resume per `(fixtureId, gradedBy)`. Export button disabled until every cluster labeled.
- **Two admins grade same fixture.** First commit wins in git; `gradedBy` is an array, both signatures preserved.
- **Pinned model deprecated.** CLI errors loudly per fixture. Operator regrades with current model → new fixture pinned to current model; old one tagged `model_deprecated: true` in the manifest.
- **Dedup-cluster boundary evolves.** Fixture freezes clusters as they were at export time. Replay & scoring stay reproducible. Cluster-drift becomes a separate axis to evaluate later.
- **Mode B picked on a date with no `raw_items`** (e.g. before this project existed, or a day the pipeline didn't run). UI greys out unavailable dates on the calendar. CLI errors with "no raw_items found for date X."
- **Mode B with draft prompt identical to saved prompt.** Both columns render identically; the UI shows a "draft matches saved — edit the prompt to see a diff" hint instead of running two redundant LLM calls.
- **Manual fixture with an URL that fails to enrich** (404, paywall, timeout). The item is still added to the fixture with whatever data was recoverable; `enrichmentStatus: 'failed'` is recorded so the grader sees it.
- **A must-include item appears in zero current sources** (sourcing-gap). Surfaced in the sourcing report. Does not affect the ranker's score.
- **Save-as-current with concurrent settings edit.** `PUT /api/settings` already exists with the user_settings singleton; the eval "Save as current" piggybacks on it. Last write wins (existing behaviour).

## Key Insights

(v1's insights stand; v2 adds three)

1. **The eval set is the product, not the ranker.** (v1) Once measurement exists, ranker improvements are bounded — one or two prompt iterations land the wins. The compounding value is *every future change* having evidence.
2. **400 items in 20 minutes is the load-bearing constraint.** (v1) Every UI decision flows from the 3-sec-per-item budget.
3. **Backfill is export, not re-scrape.** (v1) `raw_items` survives.
4. **Sourcing eval is a free byproduct of must-include labels.** (v1)
5. **Append-only labels accept some bias for stability.** (v1)
6. **The LLM response cache is the difference between an eval that gets used and one that doesn't.** (v1)
7. **(v2) The prompt editor and the eval runner must share one screen.** Ritesh's whole framing is "I want to iterate on the prompt without running the CLI." If the iterator has to context-switch between `/admin/settings` and `/admin/eval`, the friction kills the loop. The eval page owns prompt iteration; settings owns persistence.
8. **(v2) Mode B (calendar replay, unscored A/B) is the most-used feature for the primary user.** Ritesh said outright that he won't be building ground truth himself ("that is maybe something that mostly you will be doing" — 21-05, 32:08). He'll use Mode B to eyeball-compare. Mode A is Aman's tool. Both matter, but optimising the UX for Mode B is the higher leverage.
9. **(v2) Manual fixtures are the on-ramp.** Waiting for 15 days of graded run-fixtures to validate the loop is too slow. A grader can build a 30-item manual fixture in 10 minutes, grade it, and have a working eval the same afternoon. Manual fixtures are how this pipeline earns its keep in week 1.

## Architectural Challenges

### A1. Fixture content (unchanged from v1)

Fat fixtures: full raw_items pool + dedup clusters + stage-1 shortlist + original ranker output. Replay reads from the fixture, never from the live DB. Cost: ~1–2 MB per fixture, fine for git up to ~60 fixtures.

### A2. Scoring with 3-tier labels (unchanged from v1)

`must=3, nice=1, drop=0` graded-relevance mapping → standard nDCG@10. Secondary `rank-1-is-must-include` boolean compensates for the disproportionate importance of the lead story.

### A3. Pinning the model (unchanged from v1)

Each fixture pins the model used at creation time. Replay uses pinned model. Separates "prompt got better" from "model upgrade helped."

### A4. Where grading-UI state lives (unchanged from v1)

localStorage during session, JSON file on commit. No new Postgres tables for labels.

### A5. CLI ↔ UI parity

The CLI and the admin UI **share the same replay + scoring code**, exported from `@newsletter/pipeline/src/eval/index.ts`:

```
runEval({
  fixture: Fixture,
  groundTruth: GroundTruth | null,   // null = Mode B, no scoring
  prompt: string,                     // draft OR saved
  model: string,                      // pinned by fixture
  cache: EvalCache,
}): Promise<EvalResult>
```

The admin UI calls this via a new endpoint `POST /api/admin/eval/run` that takes `{ fixtureId | date, prompt, mode: 'scored' | 'ab', windowSize? }` and streams progress over server-sent events (so the user sees per-fixture progress in `--all` mode). The CLI calls the same `runEval` directly in-process. Both paths produce the same `EvalResult` shape.

This is the load-bearing decision for the "first-class citizen" requirement: if CLI and UI diverged, the system would not be one evaluator — it would be two.

### A6. Mode B (calendar replay) data flow

Mode B doesn't need a fixture file at all. It synthesises a *transient fixture* in-memory:

1. Read `raw_items` for the selected date (`SELECT … WHERE date_trunc('day', created_at) = $1`).
2. Apply the same `shortlist` stage the live pipeline uses (recency decay, top-K).
3. Run `rankCandidates(shortlist, prompt = savedPrompt)` in parallel with `rankCandidates(shortlist, prompt = draftPrompt)`.
4. Render two columns: top 10 of each.

The transient fixture is not persisted — Mode B is meant for fast eyeballing. If the user wants to keep it, a "Save as fixture" button writes the transient pool to `evals/ranking/fixtures/calendar-<date>.json` for later grading.

### A7. Prompt-editor / settings boundary

`/admin/eval` reads the current prompt via `GET /api/settings` on mount and seeds the editor with it. The editor is local React state; edits never auto-save. Two explicit actions write to the server:

- **Run** — sends the draft prompt to `/api/admin/eval/run` (does not touch settings).
- **Save as current prompt** — `PUT /api/settings` with the draft (touches settings, confirmation modal first).

The settings page (`/admin/settings`) continues to be the canonical place for the saved prompt. The eval page is a scratchpad with a "promote to canonical" button. This prevents the iteration loop from accidentally mutating the production prompt.

### A8. Top-K cap (10 vs 12)

The newsletter target is now **10 stories or fewer** per Ritesh's 21-05 ask. Scoring metrics are computed @10 (nDCG@10, precision@10). The live ranker's `topK` in `rank.ts` is not changed by this design — that's a separate change. The eval scores against 10 because that's the operator's target; if the ranker returns 12, the eval considers only the first 10 for precision/nDCG.

### A9. Cost windowing (Ritesh's "20 days" guardrail)

`--all` mode in the CLI and the "Run on all fixtures" action in the UI both default to the **most recent 20 fixtures** by `gradedAt`. A `--window N` overrides up to **60**. Beyond 60, an explicit `--force-window N` is required and the UI shows a confirmation modal with estimated dollar cost. This bakes in Ritesh's "shouldn't consider 100 days" guidance without making the policy invisible.

## Approaches Considered

### A — Postgres-backed labels (rejected, same as v1)

Loses the PR-visible regression loop. Ritesh's explicit ask is that the eval set lives in the codebase.

### B — Postgres working state + git canonical (rejected, same as v1)

Adds a sync step that can drift. localStorage + JSON download achieves the same outcome with less risk.

### C — Stage-2-only fixtures (rejected, same as v1)

Can't detect stage-1 starvation, which is the most visible failure mode.

### D — Full-pool fixtures, file-on-disk, CLI-only (v1's chosen)

Builds the data pipeline and scoring engine but ships no UI iteration loop. Insufficient for v2 — Ritesh explicitly wants both CLI and UI, and wants the UI to be the place he personally iterates.

### E — v2 chosen: D + manual-fixture builder + admin eval page + Mode B calendar replay

Adds three things to D:

1. The `/admin/eval` page that is the prompt-iteration loop, hosting both Mode A (scored against ground truth) and Mode B (unscored A/B against a calendar date).
2. The manual-fixture builder so the loop has fuel from day one without waiting for graded run-fixtures.
3. A thin API surface that lets the UI call the exact same `runEval` the CLI calls.

This is the smallest delta from v1 that covers every requirement Ritesh stated, internal-scope only.

## Chosen Approach

Approach E. Build order:

1. **Shared types + zod schemas.** `Fixture`, `FixtureItem`, `GroundTruth`, `GroundTruthLabel`, `EvalScore`, `EvalResult`, `EvalRunRequest` in `@newsletter/shared/types/eval-ranking.ts`. Subpath export (per `web-shared-subpath-imports.md` learning).
2. **Export script (F1).** `pnpm eval:export-fixtures`. Last 15 days of `raw_items` + dedup snapshots + original ranker output → `evals/ranking/fixtures/run-*.json`. Idempotent.
3. **Scoring core (`@newsletter/pipeline/src/eval/`).** Pure functions: `ndcgAtK`, `precisionAtK`, `mustIncludeRecall`, `rankOneIsMustInclude`, `perItemDiff`, `sourcingReport`. Unit-tested in isolation. Plus `runEval()` orchestrator (consumed by CLI and API).
4. **LLM response cache.** Disk wrapper around `generateObject` in `rank.ts`'s call path. Key = `sha256(prompt + fixtureId + model)`. Hit returns instantly; miss makes the real call and persists.
5. **Replay CLI (F12).** `pnpm eval:ranking` with all flags. Uses scoring core. Reports per-fixture + aggregate + delta vs cached previous score.
6. **API surface.** `GET /api/admin/eval/fixtures`, `POST /api/admin/eval/fixtures` (manual fixture create), `POST /api/admin/eval/groundtruth/:fixtureId`, `POST /api/admin/eval/run` (Mode A + Mode B, SSE progress stream). All gated by existing `requireAdmin` middleware.
7. **Grading UI (`/admin/eval/grade/:fixtureId`).** Keyboard-driven, dedup-collapsed, localStorage-resumable, "Export & download" + dev-only "Save to repo."
8. **Manual-fixture builder (`/admin/eval/fixtures/new`).** Paste URLs → server enriches via existing `link-enrichment` → write fixture file → redirect to grader.
9. **`/admin/eval` (the iteration page).** Prompt editor (preloaded from `user_settings.rankingPrompt`), fixture / date picker, Mode A and Mode B run buttons, results panel, "Save as current prompt" action with confirmation.
10. **Sourcing-report aggregation.** Surfaced in CLI report and on `/admin/eval` (aggregate panel below the per-fixture results).

## High-Level Design

```
                    ┌─────────────────────────────────────────────┐
   raw_items (DB) ─▶│ export-fixtures CLI │ manual-fixture POST   │
                    │ (run-derived)       │ (link-enriches URLs)  │
                    └────────────┬────────┴───────────────────────┘
                                 │ writes
                                 ▼
            evals/ranking/fixtures/{run|manual|calendar}-*.json   ─── git
                                 │ read by both
                                 ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  /admin/eval/grade/:fixtureId                               │
   │  - keyboard 1/2/3, dedup-collapsed, localStorage-resumable  │
   │  - Export & download → admin commits the JSON               │
   └────────────────────────────┬────────────────────────────────┘
                                │
                                ▼
            evals/ranking/groundtruth/<fixtureId>.json   ─── git
                                │ consumed by
                                ▼
   ┌─────────────────────────────────────────────────────────────┐
   │              @newsletter/pipeline/src/eval/                 │
   │              runEval()  +  scoring functions                │
   └──────┬─────────────────────────────────────────┬────────────┘
          │ in-process                              │ via POST /api/admin/eval/run (SSE)
          ▼                                         ▼
   pnpm eval:ranking                       /admin/eval (the inner loop)
   - --all / --fixture / --window N        ┌────────────────────────────────┐
   - --prompt-file / --no-cache            │ Prompt editor (draft, in-mem)  │
   - --dry-run / --diff / --json           │ Fixture picker | Date picker   │
                                           │ Mode A (scored) │ Mode B (A/B) │
                                           │ Results panel + cost meter     │
                                           │ Save as current prompt ─▶ PUT  │
                                           │                       /api/    │
                                           │                       settings │
                                           └────────────────────────────────┘
                                │ writes (both paths)
                                ▼
       evals/ranking/cache/scores.json      ─── gitignored
       evals/ranking/cache/responses/*      ─── gitignored
```

### File layout

```
evals/
└── ranking/
    ├── fixtures/                                # checked in
    │   ├── run-2026-05-18-abc123.json
    │   ├── manual-coding-agents-launch-1747830000.json
    │   └── calendar-2026-05-15.json             # optional, written by Mode B "Save as fixture"
    ├── groundtruth/                             # checked in
    │   └── run-2026-05-18-abc123.json
    └── cache/                                   # gitignored
        ├── scores.json
        └── responses/
            └── <fixtureId>-<promptHash>-<model>.json
```

### Schema sketches (final types live in `@newsletter/shared/types/eval-ranking.ts`)

```ts
type FixtureSource = 'run' | 'manual' | 'calendar';

interface Fixture {
  fixtureId: string;                 // 'run-2026-05-18-abc123' | 'manual-…' | 'calendar-…'
  source: FixtureSource;
  date: string | null;               // YYYY-MM-DD when source ∈ {run, calendar}; null for manual
  runId: string | null;              // populated when source = 'run'
  model: string;                     // pinned at fixture-creation time
  exportedAt: string;                // ISO
  pool: FixtureItem[];
  dedupClusters: { representativeId: number; duplicateIds: number[] }[];
  originalRankerOutput: { rawItemId: number; score: number; rationale: string }[] | null;  // null for manual
}

interface FixtureItem {
  rawItemId: number;                 // synthetic IDs for manual fixtures
  title: string;
  url: string;
  sourceType: string;                // 'manual' for manual fixtures
  publishedAt: string | null;
  content: string | null;
  enrichedLink: EnrichedLink | null;
  enrichmentStatus: 'ok' | 'failed' | 'skipped';   // new field; defaults to 'ok' for legacy run fixtures
  comments: RawItemComment[];
  engagement: { points: number; commentCount: number } | null;   // null for manual
}

interface GroundTruth {
  fixtureId: string;
  gradedBy: string[];                // admin-supplied names; first-commit-wins ordering
  gradedAt: string;
  labels: { rawItemId: number; tier: 'must' | 'nice' | 'drop' }[];
}

interface EvalRunRequest {
  mode: 'scored' | 'ab';
  fixtureId?: string;                // required when mode = 'scored'
  date?: string;                     // required when mode = 'ab' (calendar)
  draftPrompt: string;
  savedPrompt?: string;              // mode='ab' only, server reads from user_settings if omitted
  windowSize?: number;               // applies when fixtureId omitted in 'scored' mode (then runs all in window)
  bypassCache?: boolean;
}

interface EvalResult {
  mode: 'scored' | 'ab';
  perFixture: {
    fixtureId: string;
    scored?: EvalScore;              // present when mode = 'scored'
    ab?: { savedRanking: RankedItem[]; draftRanking: RankedItem[] };   // present when mode = 'ab'
    cost: { promptHash: string; tokensIn: number; tokensOut: number; usd: number; cacheHit: boolean };
  }[];
  aggregate?: {                      // present when mode = 'scored' and multiple fixtures
    meanNdcgAt10: number;
    meanPrecisionAt10: number;
    sourcingReport: { sourceType: string; mustIncludeCount: number; niceCount: number; dropCount: number }[];
    deltaVsPrevious: { fixtureId: string; previousNdcg: number; currentNdcg: number; delta: number }[];
  };
  totalCost: { usd: number; totalTokensIn: number; totalTokensOut: number };
}

interface EvalScore {
  fixtureId: string;
  ndcgAt10: number;                  // primary metric; was @12 in v1
  precisionAt10: number;
  mustIncludeRecall: number;
  rankOneIsMustInclude: boolean;
  perItemDiff: { rawItemId: number; rankerRank: number | null; groundTruthTier: 'must' | 'nice' | 'drop' }[];
  ranAt: string;
  promptHash: string;
  model: string;
}
```

## External Dependencies & Fallback Chain

None — pure-internal feature. Anthropic SDK is already exercised via the existing `rank.ts` code path; no new model, no new endpoint, no new third-party API. The `link-enrichment` service used by F2 manual-fixture creation is already in production (`packages/pipeline/src/services/link-enrichment/`).

## Open Questions

1. **`gradedBy` identity.** Admin session is a shared password — no per-user identity exists. Pragmatic v1: the grading UI prompts for a name (free text) on first grade, stored in localStorage, included as `gradedBy[0]`. Not auth, just attribution. Same approach Ritesh would use signing a printed sheet.
2. **Manual-fixture URL list ceiling.** A 200-URL paste means 200 link-enrichment fetches in series. The existing service handles ~4 concurrent (`WEB_CRAWLER_CONCURRENCY`). For 200 URLs that's ~50 seconds best-case. Acceptable; the UI shows progress. If pasters consistently exceed 200, revisit with a background-job approach.
3. **Mode B parallelism cap.** Running two rankers in parallel against one date doubles the LLM spend per click. Fine for occasional use. If the UI starts auto-replaying on prompt-edit (typing in the editor), it would burn money. v1: explicit "Run" click only, no auto-run.
4. **"Save to repo" dev endpoint.** F8's dev-only endpoint writes a file to the repo's working tree. Gated by `NODE_ENV !== 'production' && process.env.EVAL_WRITE_TO_REPO === 'true'`. Production deployment has no write access to the repo, so this can't accidentally fire there — but worth double-checking the runtime sandbox before merging.
5. **Manual-fixture dedup.** Manual fixtures with overlapping URLs (e.g. paste the same article twice) — should the builder dedup at create-time or leave it for the grader? v1: dedup at create-time by exact-URL match (cheap, fixes a clear footgun). Cross-URL semantic dedup (same article on two domains) is out of scope.
6. **CI integration.** Out of scope for v1. Worth flagging that once the CLI is stable, a GitHub Action that runs eval on PRs touching `rank.ts` / `rank-prompts.ts` / `shortlist.ts` is a one-day follow-up.
7. **Summarisation eval.** Out of scope. The transcript noted the same loop pattern applies; deferred to its own design.
8. **Top-K change in the live ranker.** This design uses `nDCG@10` because Ritesh asked for 10-story newsletters. Whether to *also* change `topK` in `rank.ts` from its current value to 10 is a separate decision (and a separate PR). The eval pipeline doesn't depend on it; it just scores @10 regardless of what the ranker returns.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Grading UI is too slow → no graders → pipeline dies | High | Critical | Single-keystroke labels, dedup-collapse, localStorage resume. Pre-launch: time a full grading session yourself; if > 25 min, fix UI before asking Ritesh to grade. |
| Mode B is great but the user never grades fixtures → Mode A goes unused | Medium | Medium | Manual-fixture builder makes Mode A's on-ramp 10 minutes, not 20. Ship Mode A first (cheaper to validate), then Mode B; not the other way around. |
| LLM spend creeps because Mode B doubles per-click cost | Medium | Medium | F16 cost transparency; F15 window cap on `--all`; UI requires explicit Run click; estimated cost displayed before each run. |
| Iteration loop accidentally mutates production prompt | Low | High | `/admin/eval` is scratchpad-only; "Save as current prompt" requires explicit click + confirmation modal showing diff. Settings page remains the canonical edit surface. |
| Fixtures balloon git | Medium | Low | Monitor `git count-objects -v`. Move to LFS or separate repo if > 200 MB. |
| Mislabels skew scores (append-only) | Medium | Medium | Accepted; aggregate-across-fixtures is the meaningful number, not single-fixture scores. |
| Pinned-model deprecation | Medium | Medium | CLI errors loudly per fixture; operator regrades (new fixture pinned to current model, old tagged `model_deprecated`). |
| Grader bias toward titles → labels reward clickbait | Medium | Medium | `space`-to-expand for ambiguous titles. Audit a sample of "drop" labels after first 3 graded fixtures. |
| LLM-cache key collision | Low | High | Key = sha256(prompt + fixtureId + model). Three-way key makes accidental collision near impossible. |
| Eval-set scores rise but live newsletter doesn't (overfit) | Medium | High | Once eval set ≥ 10 fixtures, designate one as holdout — graded once, never optimised against. Periodic check: if eval-set scores rise but holdout doesn't, the pipeline is overfit. |
| Sourcing report read as prescriptive (auto-suggesting new sources) | High | Low | Surfaced as descriptive aggregates only ("must-includes came from HN / Twitter / web_search this week"); source-add decisions stay human. |
| Two admins disagree on labels | Low | Medium | First commit wins in git; `gradedBy: string[]` preserves both signatures. If frequent, add per-grader-score view later. |
| Calendar replay date with no raw_items | Low | Low | UI greys unavailable dates; CLI returns clear "no raw_items for date X" error. |

## Assumptions

1. **Admin grading is sustainable.** ~20 min × ~5 fixtures/week = 100 min weekly. Acceptable for v1; revisit if it slips.
2. **Raw_items rows from the last 15 days are intact.** Verified by `SELECT count(*) FROM raw_items WHERE created_at >= now() - interval '15 days'` before building the export script.
3. **`rankCandidates(...)` in `rank.ts` is callable from the eval CLI/API with a constructed `Candidate[]`.** Verified by the existing scripts `evaluate-rank-prompt.ts` / `evaluate-run-rank-prompt.ts` which already do this.
4. **Anthropic Haiku 4.5 stays callable for the life of the eval set.** Pinned-model regrade workflow (A3) handles deprecation when it happens.
5. **`evals/` is a fine top-level directory.** Mirrors common patterns (e.g. OpenAI's `evals/`). Not docs, not code; it's data the CLI and API consume.
6. **Sourcing-eval as a byproduct is sufficient.** A standalone sourcing-eval (with its own fixtures and metrics) waits until ranking-eval has produced useful signal.
7. **Internal-only v1, no per-user scoping.** Schemas are deliberately not multi-tenant. If end-user exposure is later in scope, fixtures gain a `userId` field and ground truth becomes per-user — both additive, no breaking change.
8. **`/admin/eval` shares the existing admin auth.** Same shared-password cookie gate that already protects `/admin/*` covers all new routes. No new auth surface.
9. **The link-enrichment service handles arbitrary admin-pasted URLs without changes.** It's already used by the live pipeline for Reddit / HN / Twitter / web-search-collector links; manual-fixture URLs are the same shape of input.

---

## Next Stage

Spec generation via `harness:spec-generation`. The build order in "Chosen Approach" maps directly to phases. Suggested phasing:

- **Phase 1** — Shared types + zod schemas + export script (no UI yet).
- **Phase 2** — Scoring functions (pure, unit-tested) + `runEval()` core.
- **Phase 3** — Replay CLI (uses a hand-written ground-truth JSON to validate end-to-end before any UI exists).
- **Phase 4** — LLM response cache + score-delta cache.
- **Phase 5** — API surface (`/api/admin/eval/*` routes + SSE stream).
- **Phase 6** — Grading UI on `/admin/eval/grade/:fixtureId`.
- **Phase 7** — Manual-fixture builder on `/admin/eval/fixtures/new`.
- **Phase 8** — `/admin/eval` iteration page with Mode A + Mode B + "Save as current prompt."
- **Phase 9** — Sourcing-report aggregation in CLI + UI.

Phases 1–4 deliver a CLI-only eval anyone (or Claude) can use today; Phases 5–9 add the UI iteration loop Ritesh personally wants.
