# Functional Verification — Proof Report: eval-ranker-shortlist-fix

**Verdict: PASSED.** The calendar-mode (Mode B) eval re-ranks the deduplicated set of items
collected during the selected run, attributed by `raw_items.run_id` (time-window fallback for
legacy archives), with a consistent `itemCount` between the calendar list and the run detail.
The required UI claim **PHASE4-C1 / VS-6** was independently re-proven via Playwright MCP browser
driving (not via a passing `.test.tsx`). One minor, pre-existing, out-of-scope defect (ADV-4c)
was found in the adversarial pass; it does not block this feature.

Date: 2026-05-23 · Branch: `feat/ranking-eval-pipeline` (feature changes uncommitted in worktree)

## 1. Summary table

| Scenario | Type | Description | Verdict |
|----------|------|-------------|---------|
| PHASE4-C1 / VS-6 | ui | Calendar list row shows itemCount = deduped pool size (7), distinct from ranked count (top 3) | PASSED |
| PHASE4-C1 / VS-6 | ui | Comparison report draft ranking surfaces pool items beyond the original rankedItems | PASSED |
| PHASE4-C2 | ui | Comparison column counts reflect ranking lengths (3 vs 7), not pool size | PASSED |
| VS-3 / REQ-009 | api/db | list itemCount == detail itemCount (both = deduped pool size) | PASSED |
| REQ-006 | api/db | dedup applied to eval pool — URL-duplicate collapses to higher-engagement survivor | PASSED |
| REQ-007 | api | ab rerank receives the deduped pool; draft ranks beyond-ranked items | PASSED |
| REQ-004 / EDGE-001 | api/db | attribution by run_id; two same-day runs isolated | PASSED (adversarial ADV-1) |
| REQ-005 / EDGE-003 | api/db | legacy `run_id=NULL` items → time-window fallback + dedup | PASSED (adversarial ADV-2) |
| EDGE-002 | api | empty pool → itemCount 0; ab run → "run source pool empty" | PASSED (adversarial ADV-3) |
| EDGE-004 | api/db | run_id moves forward; list & detail itemCount track together | PASSED (adversarial ADV-5) |
| VS-1,2,4,5 / REQ-001,002,008 | db/e2e | schema, stamping, dedup, fallback | COVERED_BY_E2E (see §7) |

## 2. API evidence

App already running: API on `*:3000` (tsx, this worktree's `src/index.ts`), Vite on `[::1]:5174`
(I started Vite; API was already up). Logged in via `POST /api/admin/login`.

```
# Calendar list (UTC; no user_settings row → safeTimezone() = UTC)
GET /api/admin/eval/calendar-runs?date=2026-05-23
-> 200 {"runs":[{"runId":"c0bdf478-…","itemCount":7,"topN":3, …}]}

# Detail
GET /api/admin/eval/calendar-runs/c0bdf478-9784-4583-9d5f-433ea0c69a62
-> 200 itemCount=7  previousRanking len=3  sourcePool len=7
   pool ids = [1,2,3,4,5,6,8]   ranked ids = [1,2,3]
   dup-story occurrences in pool = 1   (id 8 survivor kept, id 7 loser excluded)

# ab-mode rerank (real LLM call, cost $0.0066)
POST /api/admin/eval/run  {mode:"ab", date:"2026-05-23", runIds:[c0bdf478], draftPrompt:…}
-> SSE done. previousRanking len=3 ids=[1,2,3]
   draftRanking len=7 ids=[2,4,6,1,3,5,8]
   draft items BEYOND previous ranked set = [4,6,5,8]
```

These confirm REQ-009 (list itemCount 7 == detail itemCount 7), REQ-006 (dedup), and REQ-007
(rerank ranks the 7-item deduped pool, surfacing 4 items the original rankedItems didn't contain).

## 3. UI evidence (Playwright MCP — browser-driven, viewport 1440×900)

| Route | Claim | Screenshot | Result |
|-------|-------|------------|--------|
| `/admin/eval?mode=ab` | **PHASE4-C1 / VS-6** | `verification/screenshots/PHASE4-C1-calendar-list-itemcount.png` | Run list row reads `c0bdf478 · 7 items · top 3` — itemCount (pool=7) distinct from ranked (top 3). MET. |
| `/admin/eval?mode=ab` → Report dialog | **PHASE4-C1 / VS-6**, PHASE4-C2 | `verification/screenshots/PHASE4-C1-comparison-beyond-ranked.png` | PREVIOUS 3 items vs DRAFT 7 items; draft surfaces "Google DeepMind paper on long-context" and "New benchmark for agentic coding tasks" (beyond the original ranked set); dedup survivor present, loser absent. MET. |

Console errors across the whole session: 0. Per-screenshot grading (spec + open visual review)
in `verification/screenshots/observations.md`.

## 4. DB evidence

Seed (mirrors real run-process output): 1 completed `run_archives` row + 8 `run_id`-stamped
`raw_items` (each `metadata = {"comments": []}`, the shape every collector writes), of which two
share canonical URL `https://example.com/dup-story`. `ranked_items` = 3 (a strict subset).

```
raw_items stamped with run_id = 8
ranked_items count            = 3
deduped pool (via API)        = 7   (dup collapsed; id 7 loser excluded, id 8 survivor kept)
migration 0028: raw_items.run_id uuid NULL + raw_items_run_id_idx  -> CONFIRMED applied
```

## 5. Visual anomalies & UX observations

Second pass clean across 2 screenshots. Layout ordering on `/admin/eval` matches the contract
(admin nav → page sub-header → page header strip → two-column grid; calendar run list in the
right column). Both screenshots include non-feature context on the top and bottom edges. No
clipping, overlap, contrast, or alignment issues. The narrow-column headline ellipsis is
intentional and the full headline is visible in the dialog. Per-screenshot notes in
`observations.md`.

## 6. Spec coverage table

| Req / Edge | Scenario | Evidence | Verdict |
|------------|----------|----------|---------|
| REQ-001 (run_id column) | migration 0028 applied | §4 DB; e2e seam | COVERED_BY_E2E |
| REQ-002 (stamp run_id) | upsert writes runId | claims VS-4c; e2e seam | COVERED_BY_E2E |
| REQ-003 (add-post NULL) | upsert without runId | claims VS-4b | COVERED_BY_E2E |
| REQ-004 (attribution by run_id) | detail loads by run_id; ADV-1 isolation | §2, ADV-1 | PASSED |
| REQ-005 (window fallback) | legacy NULL items | ADV-2 | PASSED |
| REQ-006 (dedup eval pool) | dup collapses to survivor | §2 (pool=7, dup once), §3 UI | PASSED |
| REQ-007 (rank deduped pool) | draft ranks beyond-ranked items | §2 SSE, §3 UI dialog | PASSED |
| REQ-008 (previousRanking resolves) | previous rows render | claims EDGE-005; §3 (3 prev rows) | COVERED_BY_E2E + UI |
| REQ-009 (consistent itemCount) | list 7 == detail 7; holds under EDGE-004 mutation | §2, §3 UI, ADV-5 | PASSED |
| REQ-010 (no live-pipeline change) | ranked output unchanged | claims REQ-010 guard | COVERED_BY_E2E |
| EDGE-001 (two same-day runs) | run_id isolation | ADV-1/1b/1c | PASSED |
| EDGE-002 (empty pool) | itemCount 0; ab "source pool empty" | ADV-3a/3b | PASSED |
| EDGE-003 (pre-migration archive) | window fallback + dedup | ADV-2 | PASSED |
| EDGE-004 (run_id moves forward) | reflects latest attribution | ADV-5 | PASSED |
| EDGE-005 (prev item absent from pool) | renders from RankedItemRef | claims | COVERED_BY_E2E |

No gaps left NOT VERIFIED.

## 7. E2E coverage summary

`.harness/eval-ranker-shortlist-fix/claims.json`: executed=24, passed=24, failed=0.
The pipeline e2e seam test `packages/pipeline/tests/e2e/seam/repositories/eval-exports.e2e.test.ts`
(GREEN) proves VS-5 (full calendar re-rank: real run stamps run_id → dedups → pool > rankedItems,
seeded duplicate excluded), EDGE-001, and REQ-005/EDGE-003 against live DB. API/DB claims
VS-1..VS-4 are `COVERED_BY_E2E` and were not re-run here. The full pipeline e2e suite has 5
PRE-EXISTING unrelated failures (non-uuid test run IDs in collection.e2e / run-flow / cost-tracking
/ daily-run) confirmed not introduced by this feature.

## 8. Adversarial findings

From `verification/adversarial-findings.md` — **Defects found: 1** (minor, pre-existing,
out-of-scope; not a blocker). Verbatim:

> ### ADV-4c — `GET /api/admin/eval/calendar-runs/:runId` returns a raw HTTP 500 for a non-uuid runId (severity: minor, PRE-EXISTING — not introduced by this feature)
> Actual: a malformed runId is passed straight into `getCompletedRunDetail`, which builds `WHERE run_archives.id = 'not-a-uuid'` and Postgres rejects the uuid cast; the route has no `z.uuid()` guard, so the error surfaces as a bare 500.
> Expected: a 400 (`invalid_id`) or 404, mirroring the sibling `GET /runs/:id` route which DOES validate with `runIdParamSchema = z.uuid()`.
> Why this is NOT a blocker for this feature: the route handler is pre-existing committed code (introduced in `388188f`, present in HEAD); this feature's working-tree diff to `admin-eval.ts` does not touch this route's validation (verified via `git diff HEAD`); the well-formed-but-missing uuid path correctly returns 404; the UI never produces a malformed runId.

All other adversarial scenarios (ADV-1, ADV-2, ADV-3, ADV-4/4b/4d, ADV-5) behaved correctly
(EXPECTED). The two most promising attacks — same-day double-run isolation (EDGE-001) and
run_id-moves-forward consistency (EDGE-004/REQ-009) — both held perfectly.

## 9. Not executed

- A genuinely live end-to-end run-process job (collectors + Anthropic shortlist/rerank + recap)
  was NOT triggered to produce the seed; instead the `run_archives` + `run_id`-stamped `raw_items`
  were inserted directly with the exact shape a real run produces (`metadata.comments = []`, the
  invariant every collector writes). The repo's pool-loading, dedup, and rerank were exercised
  against this data through the real running API. REQ-010 (live ranked output unchanged) is
  COVERED_BY_E2E, not re-run here.
- During the first UI attempt the ab rerank threw `Cannot read properties of undefined (reading
  'length')` because the initial seed used `metadata = {}` (no `comments` key). Root cause:
  `buildFixtureItem` sets `comments: row.metadata.comments` and `rank.ts` reads
  `candidate.comments.length`; the `Candidate.comments` / `FixtureItem.comments` types are
  non-optional and every real collector writes `metadata.comments = []`, so this is an artifact
  of unrealistic seed data, not a feature defect. Re-seeding to the real shape made the rerank
  succeed (cost $0.0066). This is documented for honesty, not a finding against the feature.

## 10. Infrastructure

- Postgres `localhost:5433` and Redis `localhost:6379`: already UP (left running).
- API server on `*:3000`: already running (tsx, this worktree). Not started by me — left running.
- Vite web dev server: **started by me** on `[::1]:5174` (5173 was taken). PID in
  `/tmp/eval_web_dev.pid` — killed in cleanup.
- Playwright browser session: one session, closed at the end.
- Seed rows (`run_id` c0bdf478… + R2/R3/R4 adversarial archives) left in the dev DB; they are
  harmless dev fixtures and reproduce the verified behavior.
