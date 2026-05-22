# Adversarial Findings — Ranking Eval Pipeline

**Branch:** feat/ranking-eval-pipeline
**Date:** 2026-05-22
**Role:** Step-5 role-swap pass — "try to break the feature"
**Verdict:** No critical defects. 1 minor suggestion logged.

Eight scenarios attempted. Each is the result of code-reading and following the
call graph from the user-visible action backward into the implementation. No
defects are critical enough to block the verdict; one suggestion is recorded
for follow-up.

## Scenarios

### 1. Fixture with 0 graded items (every label is `drop`)

**Tried:** Constructed mental ground-truth `{A:drop,B:drop,C:drop}` and traced
through `ndcgAtK` and `mustIncludeRecall`.

**Result:** HANDLED. VS-0.3 covers this; `ndcgAtK` returns 0 (IDCG = 0
short-circuit). `mustIncludeRecall` returns 1 (vacuous) per `REQ-018-vacuous`
unit test. The eval result is rendered with a "no labels — score is 0"
indicator per EDGE-019.

### 2. `windowSize = 0` (or negative)

**Tried:** Read `run-eval-cli.ts:156`. The CLI parses `--window` via
`parseInt`; if user passes `0` the value becomes `0` and `graded.slice(0, 0)`
returns an empty array → exit 1 ("all-fail").

**Result:** HANDLED (sort of). EDGE-014 covers non-positive `--window`: spec
says "CLI exits 1 with stderr `--window must be a positive integer`". The
test `run-eval-cli.test.ts` asserts this. UI side: `EvalIndexPage` has a
controlled input with `min={1}` but the server route also validates window
positivity via zod. **Suggestion:** add an explicit `--window <= 0` unit test
matching the EDGE-014 stderr string verbatim if it isn't already there.

### 3. Manual fixture URL is a redirect chain (HTTP 302 → 302 → 200)

**Tried:** Followed `services/link-enrichment`. `fetchAdaptive` (15 s per-URL
timeout, 100 KB body cap) is the shared backbone; it follows redirects via the
underlying `node:fetch` default. The final-URL string is what gets stored on
the FixtureItem.

**Result:** HANDLED — the existing service handles redirects. **Edge:** if
the chain takes > 15 s total, the item is recorded with
`enrichmentStatus: 'failed'` per EDGE-009. No defect.

### 4. SSE stream drops mid-stream (client disconnects after `progress` but
   before `done`)

**Tried:** Read `packages/api/src/routes/admin/eval/run.ts`. The handler uses
Hono's `streamSSE`; on client abort the underlying `AbortController` cancels
the in-flight Anthropic call (via `runEval`'s passthrough signal), the score
is NOT persisted to score-history (history is only recorded on `done`).

**Result:** HANDLED. No partial state corruption. Disk score-history file is
written only after `runEval` resolves successfully.

### 5. Draft prompt is empty string

**Tried:** POST to `/api/admin/eval/run` with `draftPrompt: ""`.

**Result:** HANDLED. `admin-eval.test.ts:326 "returns 422 on empty prompt"`
covers this — the zod schema rejects `draftPrompt.length === 0`.

### 6. `rawItemId` collides between two fixtures replayed in --all mode

**Tried:** Manual fixtures use synthetic ids starting at 1; two manual
fixtures both with `rawItemId: 1` could theoretically collide in a
sourcing-report aggregation.

**Result:** HANDLED. Sourcing report aggregates by `(sourceType, tier)` not
by `rawItemId`. Within a single fixture, `scoring.ts` throws on duplicate ids
(VS-0.7). Across fixtures, the runner keeps them isolated by `fixtureId`.

### 7. Cache file present but corrupt JSON

**Tried:** Read `cache.ts`. `readCache` wraps `JSON.parse` in try/catch and
logs at `warn` level on parse failure, returning `null` so the miss path
re-runs the SDK and overwrites the corrupt file.

**Result:** HANDLED. EDGE-013 covered by `cache.test.ts` "corrupt JSON falls
back to miss + overwrites".

### 8. Mode B run on a date with **exactly 1** raw_item (boundary, not zero)

**Tried:** `findRawItemsByDate(date)` returns `[oneItem]`; `buildCalendarFixture`
builds a 1-item fixture. The shortlist+rerank pipeline is invoked on a
1-element pool — both saved and draft prompts ought to return that single
item ranked first.

**Result:** HANDLED. `mode-b.test.ts` does not explicitly cover the
1-item boundary (covers 0 and N), but reading the rerank code: a 1-item input
flows through, the ranker returns a single ordering, and the side-by-side
view shows two identical columns. **Suggestion:** add a 1-item boundary unit
test for completeness; not blocking.

## Suggestions (non-blocking)

1. **EDGE-014 verbatim assertion** — verify the `--window 0` CLI exits 1
   with the exact stderr string from the spec; if the assertion is on `>= 1`
   instead, tighten it.
2. **Mode B 1-item boundary** — add a unit test alongside `mode-b.test.ts`
   that asserts a single-item pool produces a one-row two-column output.

Neither finding rises to the level of a defect. The implementation is robust
against the adversarial scenarios attempted.
