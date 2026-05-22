# SPEC: Eval-runs persistence + collector reuse in manual fixtures

**Source:** Follow-up to ranking-eval-pipeline (PR #179)
**Generated:** 2026-05-22
**Stage:** Stage B of the eval-redesign sequence (mocks → backend → UI rewire). This SPEC is backend-only — no UI changes.

## Background

Two related backend additions, kept in one PR because they share the same `runEval` and `createManualFixture` call sites:

1. **Persistent eval runs.** Every Mode A / Mode B run currently lives only in the SSE stream's process memory plus a per-fixture jsonl on disk. A new `eval_runs` Postgres table makes the run history durable, queryable, and survivable across server restarts. The Stage C UI rewire will surface this table via `/admin/eval/runs`.

2. **Collector resolution for manual fixtures.** `createManualFixture` currently routes every pasted URL through a generic web-fetch + Readability path. The admin review page's "Add a post" flow already has URL→collector resolution (`detectAddPostSourceType()` + `dispatchFetch()`) that uses native HN / Reddit collectors for those domains. The manual fixture builder should reuse that path so fixtures contain real engagement counts and comments for matched sources.

## Design references

The HTML mocks at `docs/mocks/eval-redesign/` define what Stage C will build on top of this backend. This backend is the **contract** that those screens consume — when in doubt about a field name, payload shape, or filter, the mock is the source of truth.

| Mock | Backend it depends on |
|------|----------------------|
| [`01-eval-index.html`](../../mocks/eval-redesign/01-eval-index.html) | The aggregate-hero strip reads `score_breakdown.aggregate.meanNdcgAt10` and `cost_breakdown.totalUsd` from the just-completed run. The saved-vs-draft sidecar reads the *previous* run for the same fixture by the saved `promptHash`. |
| [`02-eval-grade.html`](../../mocks/eval-redesign/02-eval-grade.html) | No backend change needed. |
| [`03-eval-fixture-new.html`](../../mocks/eval-redesign/03-eval-fixture-new.html) | REQ-7 / REQ-8 (collector resolution) — the design notes already say the chip preview is gone; users only see the result after submit. The post-submit navigation target is `/admin/eval?fixtureId=<id>` (handled in Stage C). |
| [`04-eval-runs.html`](../../mocks/eval-redesign/04-eval-runs.html) | REQ-5 (list endpoint with `mode` + `status` filters), REQ-6 (detail endpoint). The "Compare prompts" CTA is **client-side** in Stage C — see REQ-11 below. |
| [`05-states.html`](../../mocks/eval-redesign/05-states.html) | REQ-6 — the drawer renders `prompt_snapshot`, `score_breakdown`, `cost_breakdown` directly. |

## End-to-end navigation flows

These flows must be **smooth** — no orphan states, no surprise redirects. The backend's job is to make sure the URL parameters, response shapes, and call patterns line up so Stage C can implement them without a round-trip.

### Flow A: "Build a fixture and immediately eval it"

1. User clicks **+ New fixture** on `/admin/eval`.
2. Pastes URLs on `/admin/eval/fixtures/new`, hits **Build fixture**.
3. Server resolves each URL through its native collector (REQ-7), persists the fixture jsonl.
4. UI navigates to `/admin/eval?fixtureId=<new-id>` — the fixture is pre-selected in Mode A picker (already implemented in commit `d37ecb3`).
5. User clicks **Run scored eval**. SSE stream starts.
6. At stream start, a row INSERTs in `eval_runs` (REQ-2). User sees per-fixture rows stream in (sessionStorage persists them — implemented in `d37ecb3`).
7. Stream ends. Row UPDATEs to `done` (REQ-3). UI shows the aggregate hero strip.

**Backend contract this flow depends on:**
- The new fixture's `fixtureId` is in the URL within ≤200ms of the POST response (we don't gate on that in this PR — already works).
- The `eval_runs` row writes don't block the SSE — they're fire-and-forget with error logging (EDGE-1.4 / EDGE-3.2).

### Flow B: "Browse past runs and inspect one"

1. User clicks **Past runs** on `/admin/eval` (links to `/admin/eval/runs`).
2. Page calls `GET /api/admin/eval/runs?page=1&perPage=20`.
3. User clicks a run id or prompt hash. UI navigates to `/admin/eval/runs/:id` (or opens a drawer).
4. Page calls `GET /api/admin/eval/runs/:id`. The drawer renders `prompt_snapshot` (left pane), `score_breakdown` + `cost_breakdown` (right pane).

**Backend contract:**
- The list endpoint returns enough to render the table without N+1 detail calls. `EvalRunSummary` includes everything except the prompt snapshot.
- The detail endpoint returns the snapshot in one shot, no second call needed.

### Flow C: "Compare two prompts"

1. User checks two runs on `/admin/eval/runs`, hits **Compare prompts**.
2. **Two client-side `GET /runs/:id` calls in parallel** (see REQ-11). UI renders the side-by-side diff using a JS diff library (Stage C dependency).
3. No new endpoint. Both runs already carry their full `prompt_snapshot`.

**Backend contract:**
- Two parallel calls to `/runs/:id` cost ≤200ms total on the local DB. We don't add a `/compare?a=…&b=…` endpoint because the savings (one round trip) aren't worth a duplicated endpoint surface.

### Flow D: "A run failed; debug what happened"

1. User sees a `failed` row in the runs table with `error · rerank` chip.
2. Clicks it. Detail drawer opens, `error_message` is rendered prominently.
3. `prompt_snapshot` is still there — user can copy it and reproduce.

**Backend contract:**
- Failed runs are NEVER deleted server-side. They live in the table forever (or until manual cleanup).
- `error_message` is truncated to 512 chars but always populated on failure (EDGE-4.1).

## Requirements

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-1 | Ubiquitous | The system shall persist a row to a new `eval_runs` Postgres table for every Mode A and Mode B eval run. | Each call to `POST /api/admin/eval/run` (Mode A or B, regardless of outcome) INSERTs exactly one row into `eval_runs`. Verified by counting rows before/after in an integration test. | Must |
| REQ-2 | Event-driven | When an eval run begins, the system shall INSERT a row with `status='running'`, `started_at=now()`, `finished_at=null`, the request's `mode`, `fixture_id` (Mode A only, else null), `date` (Mode B only, else null), `draft_prompt_hash`, `draft_prompt_snapshot`, and `window_size` (Mode A Top-N only, else null). | After the route validates the request body and before the SSE stream emits any per-fixture progress, the row exists and is queryable. | Must |
| REQ-3 | Event-driven | When an eval run completes successfully, the system shall UPDATE the row with `status='done'`, `finished_at=now()`, `score_breakdown` (jsonb), and `cost_breakdown` (jsonb). | At the point the final `aggregate`/`done` SSE event is emitted, the row has all four fields populated. `score_breakdown` shape: `{ perFixture: PerFixtureResult[], aggregate: { meanNdcgAt10, ... } }` for Mode A; `{ saved: RankedItemRef[], draft: RankedItemRef[] }` for Mode B. `cost_breakdown` shape: `{ totalUsd, perFixture?: PerFixtureCost[], saved?: RunEvalCost, draft?: RunEvalCost }`. | Must |
| REQ-4 | Unwanted | If an eval run throws inside the SSE handler, then the system shall UPDATE the row with `status='failed'`, `finished_at=now()`, and `error_message` (the truncated Error.message, ≤512 chars). | The catch block in the SSE handler runs the UPDATE before emitting the `error` SSE event. Row is queryable with the failure recorded. | Must |
| REQ-5 | Event-driven | When a user calls `GET /api/admin/eval/runs`, the system shall return a paginated list of eval-run summaries sorted by `started_at DESC`, with optional filtering by `mode`, `status`, and `fixtureId`. | Response: `{ runs: EvalRunSummary[], total: number, page: number, perPage: number }`. Default `perPage=20`, `page=1`. Query params: `?mode=scored\|ab`, `?status=running\|done\|failed`, `?fixtureId=<id>`. `EvalRunSummary` excludes `prompt_snapshot` (size). Filters compose with AND. | Must |
| REQ-6 | Event-driven | When a user calls `GET /api/admin/eval/runs/:id`, the system shall return the full row including `prompt_snapshot`, `score_breakdown`, and `cost_breakdown`. | Response: `{ run: EvalRun }` with all jsonb columns hydrated as parsed JSON. 404 when id does not exist. | Must |
| REQ-7 | Ubiquitous | The system shall reuse the existing `detectAddPostSourceType()` + native collector path from the admin review "Add a post" flow when building manual fixtures, so HN / Reddit URLs go through native collectors and other URLs fall back to web fetch. | For each URL passed to `createManualFixture`, the system invokes `detectAddPostSourceType(url)` and dispatches to `fetchHnPost` / `fetchRedditPost` / `fetchWebPost` accordingly. The resulting `RawItemInsert` has the correct `sourceType` (`hn` / `reddit` / `web_search`) and real engagement data on matched sources. | Must |
| REQ-8 | Unwanted | If the chosen collector throws for a URL (network failure, parse failure, 404), then the system shall fall back to the existing generic web-fetch + Readability path for that URL only, and the fixture build shall continue. | A failing native collector does NOT abort the whole fixture build. The fallback item still has `sourceType='web_search'` and whatever Readability could extract. The error is logged but not surfaced to the user. | Must |
| REQ-9 | Ubiquitous | The system shall persist a deterministic prompt hash alongside the snapshot, computed as `sha256(prompt).slice(0,16)` via a shared util `@newsletter/shared/utils/prompt-hash`. | `eval_runs.draft_prompt_hash` matches the existing `hashPrompt()` output from `packages/pipeline/src/eval/index.ts` for the same input string. Backwards-compatible: the private `hashPrompt` is removed and replaced with the shared import. | Must |
| REQ-10 | Ubiquitous | The system shall apply a Drizzle migration creating the `eval_runs` table with no downtime, additive-only. | Migration `0027_eval_runs.sql` is generated by `pnpm --filter @newsletter/shared db:generate` from the schema change. Applying it on a database with existing data succeeds; reverting is not required for this PR. | Must |
| REQ-11 | Ubiquitous | The system shall NOT expose a dedicated `POST /runs/compare` endpoint. The two-run prompt-diff feature on `/admin/eval/runs` (mock 04) is implemented client-side from two parallel `GET /runs/:id` calls. | The `EvalRun` response carries the full `prompt_snapshot` for both runs; the client diffs them. No new server route. This keeps the API surface minimal and avoids duplicating diff logic on the server. | Must |
| REQ-12 | Event-driven | When `createManualFixture` finishes and the API route returns, the response shape shall let the UI navigate directly to `/admin/eval?fixtureId=<new-id>` (the Flow A target, not the existing `/admin/eval/grade/:id`). | The existing POST `/api/admin/eval/fixtures` response already returns `{ fixtureId, itemCount }` — no change required server-side. The navigation change is purely UI (Stage C). This REQ exists to record that the contract is intentionally unchanged and the UI is responsible for the new destination. | Must |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|--------------|
| EDGE-1.1 | Two concurrent eval-run requests arrive for the same fixture | Two distinct rows inserted, each with a unique `id` (uuid). No deduplication at this layer. | REQ-1 |
| EDGE-1.2 | A run is in `status='running'` when the API process crashes | Row stays in `running` state indefinitely. We do NOT add a sweeper in this PR — UI will show a "stuck" indicator if `started_at` is >24h old. | REQ-2, REQ-4 |
| EDGE-1.3 | `prompt_snapshot` exceeds a reasonable size | Hard cap at 65,536 chars (matches `user_settings.rankingPrompt` validation). Larger payloads truncated with `...` suffix. The hash is computed BEFORE truncation. | REQ-2, REQ-9 |
| EDGE-1.4 | The route's INSERT itself fails (DB connection error) | Stream still proceeds — we LOG the failure but do not block the run. The user gets their results; the missing row is acceptable degradation. | REQ-2 |
| EDGE-3.1 | Mode A run completes with 0 fixtures (Top-N window returned nothing) | Row updated with `status='done'`, `score_breakdown={ perFixture: [], aggregate: null }`, `cost_breakdown={ totalUsd: 0 }`. | REQ-3 |
| EDGE-3.2 | UPDATE at finalize fails (DB hiccup) | Stream proceeds, error logged. Row stays in `running` state. Same trade-off as EDGE-1.4. | REQ-3 |
| EDGE-4.1 | The error is non-Error (string thrown, undefined, etc.) | `error_message` is set to `String(err)` truncated to 512 chars. | REQ-4 |
| EDGE-5.1 | `?page=` query param is 0 or negative or NaN | Coerced to 1. | REQ-5 |
| EDGE-5.2 | `?perPage=` exceeds 100 | Clamped to 100. | REQ-5 |
| EDGE-7.1 | URL classifier matches a domain but the URL shape is malformed (e.g., HN domain but no `?id=`) | Falls through to web-fetch, same as EDGE-8. No special error. | REQ-7, REQ-8 |
| EDGE-7.2 | Two URLs in the same fixture batch resolve to the same `externalId` after collector hydration (duplicate HN item ids) | Existing dedup-by-url stays. We do NOT add post-collector dedup in this PR. | REQ-7 |
| EDGE-9.1 | Hash collision (two different prompts produce the same 16-char hex prefix) | Extremely unlikely (2^64 space). Not handled — the `prompt_snapshot` column is the source of truth. | REQ-9 |

## Verification Matrix

| ID | Unit | Integration | E2E | Manual | Notes |
|----|------|-------------|-----|--------|-------|
| REQ-1 | No | Yes | No | No | Integration test: trigger Mode A run via SSE consumer, count rows in `eval_runs`. |
| REQ-2 | Yes | Yes | No | No | Unit: repo's `insertEvalRun` produces the right shape. Integration: row visible after SSE first event. |
| REQ-3 | Yes | Yes | No | No | Unit: `updateEvalRunFinish` writes the four fields. Integration: row in `done` after stream close. |
| REQ-4 | Yes | Yes | No | No | Force a collector to throw mid-stream; assert row in `failed`. |
| REQ-5 | Yes | Yes | No | Yes | API contract test on the new GET route, including filter combinations (`mode`, `status`, `fixtureId`, all three together). Manual: hit `/api/admin/eval/runs?page=1&perPage=5&mode=scored&status=done`. |
| REQ-6 | Yes | Yes | No | Yes | API contract test. Manual: 404 on bad id. |
| REQ-7 | Yes | No | No | Yes | Unit: `createManualFixture` called with mixed URLs invokes the right collector mocks. Manual: paste HN+Reddit+blog in the prod UI and inspect the fixture jsonl. |
| REQ-8 | Yes | No | No | No | Unit: mock the HN collector to throw; assert fixture build completes with `sourceType='web_search'` for that URL. |
| REQ-9 | Yes | No | No | No | Unit: shared util produces stable output equal to the now-removed private `hashPrompt`. |
| REQ-10 | No | Yes | No | Yes | Apply migration on local DB; verify schema. Manual: `\d eval_runs` in psql. |
| EDGE-1.3 | Yes | No | No | No | Snapshot truncation unit test. |
| EDGE-1.4, EDGE-3.2 | No | Yes | No | No | Integration: make the repo writer throw; assert the SSE stream still completes. |
| EDGE-3.1 | Yes | No | No | No | Mode A with empty fixture list → empty `perFixture`. |
| EDGE-5.1, EDGE-5.2 | Yes | No | No | No | Pagination clamping unit tests. |
| EDGE-8 / EDGE-7.1 | Yes | No | No | No | Collector throws → fallback unit test. |
| REQ-11 | No | No | No | Yes | Confirmed by the absence of the route. Manual: verify no compare endpoint is registered. |
| REQ-12 | No | No | No | Yes | Confirmed by the existing fixture POST response shape. The Stage C UI change is verified there, not here. |

## Out of Scope (deferred to future PRs)

- **UI for `/admin/eval/runs`.** The Stage C UI rewire ships this. This SPEC's API contract is its only consumer until then.
- **Dedicated comparison endpoint.** Per REQ-11, this is intentionally not built. Compare = two parallel `/runs/:id` calls + client-side diff. If profiling later shows this is slow at scale (>100 chars per snapshot × many runs), we can add a server-side endpoint then.
- **Stuck-run sweeper** (EDGE-1.2). Manual cleanup acceptable for now.
- **Run cancellation persistence.** Eval runs cannot currently be cancelled; if cancellation is added later it will need a fourth status terminal value.
- **Backfill of existing on-disk score-history.** The `evals/ranking/score-history/<fixtureId>.jsonl` files are untouched. New runs land in BOTH the table and (existing behavior) the jsonl.
- **eval_runs read-side index for prompt-hash search** (the "show me every run that used prompt X" feature). Add an index on `draft_prompt_hash` only — the UI search will be linear-time on the page of results until we know we need more.
