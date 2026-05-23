# Adversarial findings — eval pipeline UI

**Date:** 2026-05-22
**Verifier:** functional-verify skill (live Playwright MCP + direct curl/DB probes)

## 1. Attack surface derived

Targets that the verifier's happy-path pass did NOT cover, derived from
`docs/spec/eval-ui-rewire/spec.md` and `docs/spec/eval-runs-persistence-collectors/spec.md`:

- **Client-side search narrowing to zero rows** (REQ-2 / mock 04 search input). The
  spec promises a narrow-to-empty result but the empty-state and the pagination
  counter are not explicitly required to update — gap worth poking.
- **Boundary inputs to the runs list / detail endpoints** (REQ-5 / REQ-6 / EDGE-5.1,
  EDGE-5.2): non-existent UUID, malformed UUID, `page=0`, `perPage=200`.
- **Boundary inputs to POST /run** (Stage B SPEC REQ-2): malformed JSON, missing
  required field.
- **HN URL that fails collector dispatch** (REQ-7 / REQ-8): does the fallback path
  produce a usable fixture entry even when the native HN collector throws on a
  bad item id?
- **Mode A run with all `web_search`/`blog` items** (no real engagement data):
  does the SSE handler still close cleanly and persist the row, even though
  the rerank produces 0 valid items?
- **Single-char search input** (EDGE-2.1): does the SEARCH_MIN_CHARS=2 guard
  hold so we don't re-filter on every keystroke?
- **Compare two runs with byte-identical `prompt_snapshot`** (EDGE-3.1): does
  the diff dialog gracefully say "no changes" instead of rendering an empty diff
  body?

## 2. Scenarios attempted

| ID | Category | Description | Inputs | Verdict |
|----|----------|-------------|--------|---------|
| ADV-1 | Boundary input (UI search) | Type "deadbeef-not-real" into the runs page search input. | string "deadbeef-not-real" | **DEFECT (minor)** — table narrows to 0 rows correctly, but the pagination counter still reads "Showing 1–2 of 2" and the empty-state card does not appear. See section 3. |
| ADV-2 | Boundary input (UI search) | Single-char search → expect debounce/guard, no narrowing. | string "x" | EXPECTED — table still shows 2 rows. EDGE-2.1 / SEARCH_MIN_CHARS=2 guard holds. |
| ADV-3 | Boundary input (UI form) | Submit fixture builder with 0 valid URLs. | empty textarea | EXPECTED — Build button is disabled, no submission possible. |
| ADV-4 | Boundary input (UI form) | Paste 2 invalid lines ("not-a-url" + "www.example.com/missing-protocol"). | textarea content | EXPECTED — invalid-lines panel renders inline with both lines + the helpful "missing https://" hint, Build button stays disabled and reads "Build fixture · 0 URLs". |
| ADV-5 | Error path (HN collector) | Build fixture containing `https://news.ycombinator.com/item?id=44550234` (likely-nonexistent HN id). | Pasted URL list | EXPECTED — REQ-8 fallback ran: fixture entry stored with `sourceType: "web_search"`, `enrichmentStatus: "skipped"`, the build still completed, the rest of the URLs in the batch were unaffected. |
| ADV-6 | Mode A error path | Run scored eval against a fixture where all items have empty enrichment / zero engagement. | Click Run on `manual-verify-stage-c-...` | EXPECTED-ish — see section 3. Run completed with `status=done`, per-fixture `status=error` and message "ranking returned no valid items"; row persisted in eval_runs with empty `score_breakdown.perFixture` entries. One observation logged below. |
| ADV-7 | Boundary input (API) | `GET /api/admin/eval/runs/00000000-0000-0000-0000-000000000000` — well-formed UUID, no row. | curl | EXPECTED — 404 `{"error":"not found"}`. |
| ADV-8 | Boundary input (API) | `GET /api/admin/eval/runs/not-a-uuid` — malformed id. | curl | EXPECTED — 400 `{"error":"invalid_id"}`. |
| ADV-9 | Boundary input (API) | `GET /runs?page=0&perPage=200` → clamping. | curl | EXPECTED — server returned `page=1, perPage=100` (EDGE-5.1, EDGE-5.2). |
| ADV-10 | Boundary input (API) | `POST /run` with body `this-is-not-json`. | curl | EXPECTED — 400 `{"error":"invalid_json"}`. |
| ADV-11 | Boundary input (API) | `POST /run` with `{"mode":"scored"}` (missing draftPrompt). | curl | EXPECTED — 422 `{"error":"invalid_body","issues":[...]}` with Zod issue detail. |
| ADV-12 | Concurrency / status | Compare two runs that used byte-identical prompts (same `prompt_snapshot`). | Click Compare with both runs ticked | EXPECTED — dialog renders, header shows `+0 / −0`, body says "No changes — both runs used the same prompt", score-delta row renders `— → —`. EDGE-3.1 fully covered. |
| ADV-13 | Recovery / persistence | After a Mode A run completes, refresh the page. | `goto /admin/eval?fixtureId=...` | EXPECTED — sessionStorage record (`eval-run-state`) is intact, the aggregate hero AND per-fixture error row are both re-rendered after refresh. REQ-12 verified. |

## 3. Defects

### DEFECT-1 (minor) — Stale pagination counter + missing empty-state when client-side filter narrows to zero

**Reproduction**
1. Navigate to `/admin/eval/runs` with ≥1 row present in the table.
2. Type a search term that matches none of the current page's runs (id / prompt hash / fixture id) — e.g. `deadbeef-not-real`.

**Actual**
- Table body correctly narrows to 0 visible rows.
- URL updates to `?q=deadbeef-not-real`.
- Pagination footer still reads `Showing 1–2 of 2` (or whatever the server's
  total was for the unfiltered query). This is computed from `data.total`,
  which is the server-side total — the client-side filter is invisible to
  the pagination component.
- The empty-state CTA card (per mock 05-C / `[data-testid="runs-empty-state"]`)
  does NOT render — its render condition is `total === 0`, not "visible rows ===
  0", so the operator gets an empty pane with no guidance.

**Expected**
- Either (a) the empty-state card appears with a "no runs match your search"
  variant, or (b) at minimum the pagination counter updates to "Showing 0 of N
  matching" so the operator understands why the table looks empty.

**Evidence**
- Screenshot: `verification/screenshots/10a-adv-search-no-results.jpeg`
- Code site: `packages/web/src/hooks/useEvalRuns.ts` — the `filteredData` memo
  narrows `data.runs` but keeps the original `data.total`; the empty-state
  branch in `EvalRunsPage` keys off `total === 0`.

**Severity:** minor (cosmetic; not data-corrupting; user can clear the search
to recover). Should fix because the experience is genuinely confusing — the
operator can't tell whether the server returned 0 runs or whether their
filter narrowed it out.

### DEFECT-2 (minor) — Mode A run with all-empty items reports `Fixtures · done = 0/1` while the run itself is `done`

**Reproduction**
1. Build a fixture where every URL falls back to `web_search` with empty
   enrichment (e.g. all-failing collectors).
2. Run scored eval on that fixture.

**Actual**
- Run completes; the eval_runs row reaches `status = done` (correct).
- Aggregate hero strip renders "Mode A · completed · 1 fixture".
- The 4th tile reads `Fixtures · done` with the value `0 / 1`.

**Expected**
- The wording is contradictory: the operator sees both "completed" AND "0/1
  done". Either the strip should drop the "done" tile when the per-fixture
  status is `error`, or it should rename to "Fixtures · scored: 0 / errored: 1"
  to capture both signals.

**Evidence**
- Screenshot: `verification/screenshots/06b-eval-run-complete.jpeg`
- Spec: REQ-5 of `eval-ui-rewire/spec.md` requires the aggregate hero to render
  when `rows.length > 0` and mode === "scored"; it does not specify how to
  count errored per-fixture entries.

**Severity:** minor / copy issue. Not a regression — it's a gap in the
spec that the implementation faithfully exhibited.

## 4. Cannot assess

- **Run detail drawer for a `running` row.** No `running` rows exist in the
  DB (both eval_runs rows are `done`). EDGE-4.1 cannot be re-proven via live
  browser here. Unit test `RunDetailDrawer.test.tsx` covers this with a mocked
  query — accepting that as sufficient evidence; would require an artificial
  long-running eval (sleep-injection) to verify live, which is out of scope.

## 5. Honest declaration

**Defects found: 2. See section 3.**

Most promising attacks: I deliberately attacked the search filter (newly wired
in `fad8f5e` per the code-review-fix commit; client-side narrowing is exactly
the place where edge cases hide) and the Mode A error path (a fixture with zero
scorable items is a realistic operator state on day-1 fixtures). Both surfaced
real defects — neither is data-corrupting, but both are user-facing copy /
state-presentation gaps that would confuse the operator.

Boundary-input attacks at the API layer (ADV-7..11) all produced the right
status codes and error shapes. The schema validation is tight; the partial-
update writers (`updateFinish`, `updateFailed`) have the right precondition
guards.
