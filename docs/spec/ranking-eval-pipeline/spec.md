# SPEC — Ranking Eval Pipeline

**Status:** Draft (generated from `design.md` v2 + `library-probe.md` + `verification/verification-stubs.md`)
**Date:** 2026-05-22
**Linear:** VER (AI Newsletter)
**Source design:** `docs/spec/ranking-eval-pipeline/design.md`
**Source probe:** `docs/spec/ranking-eval-pipeline/library-probe.md`

---

## Glossary

- **Fixture** — JSON snapshot of a ranking input pool, persisted in `evals/ranking/fixtures/`. Three sources: `run` (DB-derived), `manual` (URL-paste), `calendar` (Mode-B transient or saved).
- **Ground truth** — JSON file of per-cluster labels (`must` / `nice` / `drop`) for a fixture, persisted in `evals/ranking/groundtruth/`.
- **Replay** — running the live ranker code (`@newsletter/pipeline/src/rank.ts` candidate-shape entry point) against a fixture with a specified prompt + model, producing a ranked list.
- **Mode A (scored)** — replay against a fixture that has ground truth; emits nDCG@10, precision@10, must-include recall, rank-1-is-must, per-item diff.
- **Mode B (A/B)** — replay against a calendar date (no ground truth required); emits two ranked lists side-by-side (saved prompt vs draft prompt).
- **Cost window** — the count of fixtures replayed in a single `--all` / "Run on all fixtures" invocation. Default 20, configurable up to 60, hard-confirmable beyond.
- **Cache** — disk-backed key/value store under `evals/ranking/cache/responses/` keyed by `sha256(prompt + fixtureId + model)`. Gitignored.
- **EARS** — Easy Approach to Requirements Syntax: Ubiquitous / Event-driven / State-driven / Unwanted requirement classes.

---

## Requirements

### Fixture lifecycle

| ID | Type | Requirement | Acceptance Criterion | Priority |
|---|---|---|---|---|
| REQ-001 | Event-driven | When `pnpm --filter @newsletter/pipeline eval:export-fixtures` is invoked, the system shall read `raw_items` for the last N days (default 15, configurable via `--days N`), join with `run_archives` for dedup-cluster snapshots and `originalRankerOutput`, and write one file per run to `evals/ranking/fixtures/run-<YYYY-MM-DD>-<runId>.json`. | After running the command on a DB containing K reviewed runs in the last 15 days, exactly K files of the form `run-*.json` exist under `evals/ranking/fixtures/`; each file passes `FixtureSchema.parse` from `@newsletter/shared/types/eval-ranking`; CLI exit code is `0`. | Must |
| REQ-002 | Ubiquitous | The export CLI shall be idempotent: re-running with the same `--days` value shall overwrite existing files byte-identically unless `--force` is set, and shall not duplicate fixtures. | Running the CLI twice in succession leaves the file count and SHA-256 of each fixture identical; second run prints `skipped: N (already exported)` for unchanged files. | Must |
| REQ-003 | Event-driven | When an admin POSTs newline-separated URLs to `POST /api/admin/eval/fixtures` (gated by `requireAdmin`), the system shall fetch each URL through the existing `packages/pipeline/src/services/link-enrichment` service (concurrency capped by `WEB_CRAWLER_CONCURRENCY`, default 4), assemble a `Fixture` with `source: 'manual'`, `engagement: null`, synthetic `rawItemId` integers starting at 1, and write `evals/ranking/fixtures/manual-<slug>-<unix-ms>.json`. | A POST with body `{ urls: ["https://a", "https://b"], slug: "test" }` returns HTTP `201` with `{ fixtureId: "manual-test-<ts>" }`; the file exists on disk; each `FixtureItem.enrichedLink` is populated from the enrichment service; items whose fetch failed have `enrichmentStatus: 'failed'` and remain in the fixture. | Must |
| REQ-004 | Ubiquitous | Every `Fixture` shall record `model: string` pinned at creation time (default `claude-haiku-4-5-20251001`), and replay shall default to that pinned model. | A fixture loaded via `FixtureSchema.parse` has a non-empty `model` field; `runEval()` with no model override sends `fixture.model` to the Anthropic SDK. | Must |
| REQ-005 | Event-driven | When the admin requests `GET /api/admin/eval/fixtures` (gated by `requireAdmin`), the system shall return an array `[{ fixtureId, source, date, model, exportedAt, itemCount, gradingStatus: 'ungraded' \| 'in_progress' \| 'graded' }]` covering all files under `evals/ranking/fixtures/`. | A GET returns HTTP `200` with a JSON array; `gradingStatus === 'graded'` iff `evals/ranking/groundtruth/<fixtureId>.json` exists on disk; `'in_progress'` is reserved for future Postgres-backed working-state and is never returned in v1; otherwise `'ungraded'`. | Must |
| REQ-006 | Event-driven | When a manual fixture is created with URLs containing duplicates by exact string match, the system shall dedupe those entries before enrichment and emit `{ duplicatesDropped: N }` in the response body. | POST with `["https://x", "https://x", "https://y"]` returns `{ fixtureId, duplicatesDropped: 1 }` and the resulting fixture contains exactly two items. | Should |

### Grading

| ID | Type | Requirement | Acceptance Criterion | Priority |
|---|---|---|---|---|
| REQ-007 | Event-driven | When an admin navigates to `/admin/eval/grade/:fixtureId` (gated by the existing `admin_session` cookie middleware on the web side), the system shall load the fixture, dedup-collapse near-duplicate items into one representative (highest-engagement), display title + source + age + thumbnail by default, and expose single-keystroke labels: `1` = must, `2` = nice, `3` = drop, `space` = expand enrichment description. | Playwright test: page renders one row per dedup cluster; pressing `1`/`2`/`3` on a focused row applies the label visibly within 100 ms; pressing `space` toggles the description panel. | Must |
| REQ-008 | Ubiquitous | The grading UI shall persist in-progress label state to `localStorage` keyed by `(fixtureId, gradedBy)`, and shall restore that state on page reload without server round-trip. | Apply 5 labels, reload — all 5 are visible; localStorage key `eval-grading:<fixtureId>:<gradedBy>` contains the same labels as JSON. | Must |
| REQ-009 | State-driven | While at least one cluster in the fixture is unlabeled, the "Export & download" / "Save to repo" buttons in the grading UI shall remain disabled with a "label all clusters first" hint. | Playwright test: with 1 cluster unlabeled, both buttons have `disabled` attribute; labeling the last cluster removes `disabled` within 100 ms. | Must |
| REQ-010 | Event-driven | When the admin clicks "Download & I'll commit it" on a fully-labeled fixture, the browser shall receive a file download named `<fixtureId>.json` with content matching `GroundTruthSchema`: `{ fixtureId, gradedBy: string[], gradedAt: ISO, labels: [{ rawItemId, tier }] }`. | Playwright test: download triggered, file content parses against `GroundTruthSchema`; `labels.length` equals cluster count; every cluster representative `rawItemId` appears in `labels`. | Must |
| REQ-011 | Event-driven | When the admin clicks "Save to repo" AND the server has `NODE_ENV !== 'production'` AND `process.env.EVAL_WRITE_TO_REPO === 'true'`, the system shall accept `POST /api/admin/eval/groundtruth/:fixtureId` and write `evals/ranking/groundtruth/<fixtureId>.json`. In all other environments the route shall return HTTP `403`. | Integration test under `NODE_ENV=test`, `EVAL_WRITE_TO_REPO=true`: POST returns `201` and file exists on disk. Same POST with `EVAL_WRITE_TO_REPO=false` returns `403` with body `{ error: 'EVAL_WRITE_TO_REPO disabled' }`. | Must |
| REQ-012 | Event-driven | When a ground-truth file is written for a fixture that already has one, the system shall append the new grader's name to `gradedBy` (first-write-wins ordering), overwrite `labels`, and never delete the prior file's `gradedBy` entries. | Save twice with `gradedBy=['aman']` then `gradedBy=['ritesh']`: final file has `gradedBy === ['aman','ritesh']` and the latest `labels`. | Must |

### Eval, scoring, cost, and iteration

| ID | Type | Requirement | Acceptance Criterion | Priority |
|---|---|---|---|---|
| REQ-013 | Event-driven | When the admin POSTs to `/api/admin/eval/run` with body `{ mode: 'scored', fixtureId, draftPrompt, bypassCache? }`, the server shall stream Server-Sent Events of shape `event: progress` / `event: result` / `event: done`, where `result` carries an `EvalResult` with `perFixture[0].scored: EvalScore`. | Integration test: SSE stream emits at least one `progress` event and exactly one `done` event; the final `EvalResult` parses against `EvalResultSchema`. HTTP status of the SSE connection is `200`. | Must |
| REQ-014 | Event-driven | When the admin POSTs to `/api/admin/eval/run` with `{ mode: 'ab', date, draftPrompt }`, the server shall synthesise a transient fixture from `raw_items` for that date, run shortlist + rank with both the saved `user_settings.rankingPrompt` AND `draftPrompt` in parallel, and stream `perFixture[0].ab: { savedRanking, draftRanking }` with `top 10` of each. | Integration test against a seeded DB: response includes two ranked arrays of length ≤ 10; both rankings include only `rawItemId`s present in that date's `raw_items`. | Must |
| REQ-015 | Event-driven | When `pnpm --filter @newsletter/pipeline eval:ranking` is invoked, the CLI shall accept `--fixture <id>`, `--all`, `--prompt-file <path>`, `--dry-run`, `--no-cache`, `--diff`, `--json`, `--window N`, `--force-window N`, share the same `runEval()` core as the API, and write JSON to stdout when `--json` is passed. | `pnpm eval:ranking --fixture <id> --json` produces parseable JSON on stdout matching `EvalResultSchema`; exit code `0` on success. `--dry-run` makes zero Anthropic API calls (verifiable by a mock SDK call counter) and exit code `0`. | Must |
| REQ-016 | Ubiquitous | The scoring function `ndcgAtK(ranked, groundTruth, k)` shall implement standard binary-graded nDCG with the relevance mapping `must = 3, nice = 1, drop = 0`, using `log2(i + 1)` discount for position `i ∈ {1..k}`, and shall return `0` when IDCG is `0`. | Unit tests VS-0.1 through VS-0.4 pass; tolerance `1e-9` for VS-0.1, `1e-4` for VS-0.2. | Must |
| REQ-017 | Ubiquitous | The scoring function `precisionAtK(ranked, groundTruth, k)` shall return `count_of_(must \| nice)_in_first_k / k` where the denominator is exactly `k` even if `ranked.length < k`. | Unit test VS-0.6 passes: 3 hits in a length-5 ranking at k=10 returns `0.3`. | Must |
| REQ-018 | Ubiquitous | The scoring function `mustIncludeRecall(ranked, groundTruth, k)` shall return `count_of_must_in_first_k / total_must_in_groundtruth`, returning `0` when `total_must` is `0`. | Unit test VS-0.5 passes: 2-of-3 `must` recovered at k=10 returns `2/3` within `1e-9`. | Must |
| REQ-019 | Ubiquitous | The scoring function `rankOneIsMustInclude(ranked, groundTruth)` shall return `true` iff `ranked[0]?.rawItemId` maps to a `must` label in ground truth. | Unit test: rank-1 labeled `must` returns `true`; rank-1 labeled `nice` returns `false`; empty ranking returns `false`. | Must |
| REQ-020 | Ubiquitous | The scoring function `perItemDiff(ranked, groundTruth)` shall return `Array<{ rawItemId, rankerRank: number \| null, groundTruthTier }>` covering the **union** of all `rawItemId`s in either input, where `rankerRank` is `null` for items in ground truth but not in the ranked output. | Unit test: ranked=[A,B], gt has C labeled `must` → result includes `{ rawItemId: C, rankerRank: null, groundTruthTier: 'must' }`. | Must |
| REQ-021 | Ubiquitous | The scoring functions `ndcgAtK`, `precisionAtK`, `mustIncludeRecall` shall throw an `Error` naming the duplicate `rawItemId` when the ranked output contains any duplicate. | Unit test VS-0.7 passes: input with rawItemId `1` twice causes `expect(() => ndcgAtK(...)).toThrow(/duplicate.*rawItemId.*1/)`. | Must |
| REQ-022 | Ubiquitous | The eval system shall maintain an on-disk LLM response cache at `evals/ranking/cache/responses/<sha256(prompt+fixtureId+model)>.json` (gitignored). On cache hit, `runEval()` shall return the cached ranked output without invoking the Anthropic SDK. On cache miss, it shall call the SDK once and persist the response. | Integration test with a mocked Anthropic SDK: first call hits SDK (call count = 1) and writes file; second call with identical inputs hits cache (call count still 1) and elapsed time on second call is `< 2000 ms`. | Must |
| REQ-023 | State-driven | While `--all` or "Run on all fixtures" is selected with no explicit window, the system shall replay only the most recent 20 fixtures by `gradedAt` descending. With `--window N` (or UI input) the cap shall be raised to at most 60. Beyond 60, `--force-window N` is required AND the UI shall display a confirmation modal showing estimated USD cost. | CLI: `--all` on 30 graded fixtures runs exactly 20. `--window 60` on the same set runs exactly 30. `--window 100` exits `1` with stderr `--force-window required for N > 60`. `--force-window 100` runs 30 fixtures. | Must |
| REQ-024 | Ubiquitous | Before any replay that issues Anthropic calls, the system shall display an **estimated** USD cost; after replay, it shall display the **actual** USD cost based on token counts returned by the SDK. | CLI: `eval:ranking --fixture <id>` prints `estimated: $0.0XX` before the SDK call and `actual: $0.0XX` after. UI: SSE `progress` events include `estimatedUsd`; final `result` includes `totalCost.usd`. | Must |
| REQ-025 | Ubiquitous | The eval system shall aggregate must-include labels across all graded fixtures by `sourceType` into a sourcing report `Array<{ sourceType, mustIncludeCount, niceCount, dropCount }>`, surfaced in CLI stdout (when `--all` or `--json`) and in the `/admin/eval` results panel. | Unit test: given 3 fixtures each with 5 graded items across `hn`/`reddit`/`twitter`, the aggregator returns the correct counts grouped by source. UI Playwright: panel renders one row per source after a Mode-A run with multiple fixtures. | Should |
| REQ-026 | Event-driven | When the admin clicks "Save as current prompt" on `/admin/eval`, the UI shall show a diff-confirmation modal of `user_settings.rankingPrompt` vs the draft, and on confirm shall call `PUT /api/settings` with the new prompt. | Playwright test: click button → modal shows red/green diff; click Confirm → `PUT /api/settings` fires with body `{ rankingPrompt: <draft> }`; modal closes; `GET /api/settings` afterwards returns the draft. | Must |
| REQ-027 | Event-driven | When `/admin/eval` mounts, it shall fetch the current prompt via `GET /api/settings` and seed the local editor state with `rankingPrompt`. Edits to the editor shall not auto-persist to the server. | Playwright test: open page → editor textarea matches the server's `rankingPrompt`; type a character; `GET /api/settings` still returns the original prompt; only Run or Save-as-current touches the server. | Must |
| REQ-028 | Ubiquitous | Mode A on a single fixture with a cache hit shall complete end-to-end (click "Run" → scored result rendered) in `< 2000 ms`. Cache miss on a single fixture shall complete in `< 30000 ms`. Mode B on a single date shall complete in `< 60000 ms`. | Playwright performance assertion using `performance.now()` deltas on a local DB with seeded fixtures. | Should |
| REQ-029 | Ubiquitous | The eval system shall use `temperature: 0` on every Anthropic call and shall send the fixture's pinned `model`, making replays deterministic given (prompt, fixtureId, model). | Integration test: two replays with cache disabled (`--no-cache`) on the same fixture produce byte-identical `EvalResult.perFixture[0].scored.ndcgAt10`. SDK call payload inspector confirms `temperature: 0`. | Must |
| REQ-030 | Unwanted | If a single fixture in an `--all` or windowed-replay batch throws during replay or scoring, the system shall log the error with `fixtureId`, skip that fixture, and continue with the remaining fixtures. The final exit code shall be `0` if at least one fixture succeeded, otherwise `1`. | Integration test: inject a thrown error in one of three fixtures → stderr contains `fixture <id>: <error>`; the other two appear in `EvalResult.perFixture`; exit code `0`. All three failing → exit code `1`. | Must |
| REQ-031 | Unwanted | If Mode B is requested for a date with no `raw_items` rows, the API shall return HTTP `404` with body `{ error: 'no raw_items for date <date>' }`, and the CLI equivalent shall exit `1` with the same message on stderr. The UI date picker shall grey out unavailable dates fetched from `GET /api/admin/eval/calendar-availability`. | Integration test on an empty DB: POST `{ mode: 'ab', date: '2020-01-01' }` → `404`. Playwright: dates with zero items show `disabled` style on the calendar. | Must |
| REQ-032 | State-driven | While the draft prompt on `/admin/eval` is byte-identical to the saved `user_settings.rankingPrompt`, the Mode-B "Run" button shall display a hint "draft matches saved — edit the prompt to see a diff" and shall not issue duplicate parallel LLM calls (it may either short-circuit to rendering one column twice, or disable Run; implementation chooses one). | Playwright test: with draft == saved, Run button either disabled OR clicking Run produces zero or one Anthropic calls (call counter inspected); hint text is visible. | Should |
| REQ-033 | Event-driven | When `EvalResult` is computed for a Mode-A run, the system shall compare against the most recent prior cached score for the same `fixtureId` and include `aggregate.deltaVsPrevious[]` in the result for downstream display. | Integration test: run Mode A twice with different prompts on the same fixture → second `EvalResult.aggregate.deltaVsPrevious[0]` is `{ fixtureId, previousNdcg, currentNdcg, delta }` and `delta === currentNdcg - previousNdcg` within `1e-9`. | Should |
| REQ-034 | Ubiquitous | All shared types (`Fixture`, `FixtureItem`, `GroundTruth`, `GroundTruthLabel`, `EvalScore`, `EvalResult`, `EvalRunRequest`) and their zod schemas shall live in `@newsletter/shared/types/eval-ranking.ts` and be exported via a dedicated subpath `@newsletter/shared/types/eval-ranking` per the `web-shared-subpath-imports` learning. Web code shall never import them from the root barrel. | ESLint passes with a new `no-restricted-imports` rule (or existing one extended) forbidding `@newsletter/shared` root imports for eval types from `packages/web/`. `pnpm --filter @newsletter/web build` succeeds with no Node-builtin warnings. | Must |
| REQ-035 | Ubiquitous | All new API routes (`/api/admin/eval/*`) shall be mounted under the existing `requireAdmin` middleware. Unauthenticated requests shall receive HTTP `401`. | Integration test: each route called without `admin_session` cookie returns `401`. With valid cookie returns `200`/`201`/`404` per the route's contract. | Must |
| REQ-036 | Ubiquitous | The replay + scoring core (exported from `@newsletter/pipeline/src/eval/index.ts`) shall be importable by both the CLI (`@newsletter/pipeline/src/scripts/eval-ranking.ts`) and the API handler (`@newsletter/api/src/routes/admin/eval/run.ts`), with no HTTP framework imports in the pipeline package. | ESLint passes the existing pipeline→hono restriction; `pnpm --filter @newsletter/pipeline build` succeeds; the API handler imports `runEval` from `@newsletter/pipeline` via the workspace reference. | Must |

---

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|---|---|---|---|
| EDGE-001 | Run-derived fixture contains `raw_items.metadata.enrichedLink === null` (old row before link-enrichment shipped). | Fixture stores `enrichedLink: null`, `enrichmentStatus: 'skipped'`. Replay sends title-only candidate to ranker (same as live). Scoring proceeds normally. | REQ-001, REQ-004 |
| EDGE-002 | Run-derived fixture's `originalRankerOutput` references a prompt that no longer exists in `user_settings`. | Fixture stores `originalRankerOutput` verbatim for diff display only. Scoring always uses the current replay output, never the original. | REQ-001 |
| EDGE-003 | Grader closes browser mid-grade with 30 of 50 clusters labeled. | localStorage retains all 30 labels keyed by `(fixtureId, gradedBy)`. On reopen, labels are restored and `Export & download` is disabled until the remaining 20 are labeled. | REQ-008, REQ-009 |
| EDGE-004 | Two admins commit ground-truth files for the same fixture in sequence. | First commit's `gradedBy` is preserved; second commit appends its name; labels are overwritten by the second. | REQ-012 |
| EDGE-005 | Fixture's pinned `model` returns a 404 / deprecated from Anthropic at replay time. | CLI prints `fixture <id>: model <model> deprecated` and exits `1` for that fixture; in `--all` mode it is skipped per REQ-030. Operator regrades with current model to produce a new fixture; the old fixture is tagged `model_deprecated: true` in a follow-up manifest commit (manual). | REQ-004, REQ-030 |
| EDGE-006 | Dedup cluster boundaries differ between fixture-creation time and replay time. | Fixture freezes its `dedupClusters` snapshot; replay and scoring use the frozen clusters. Cluster-drift is an independent, future-axis concern. | REQ-001 |
| EDGE-007 | Mode B picks a date with zero `raw_items`. | API returns `404`; CLI exits `1`; UI date picker greys the date out. | REQ-031 |
| EDGE-008 | Mode B draft prompt is byte-identical to saved prompt. | UI shows a hint and does not issue duplicate parallel LLM calls. | REQ-032 |
| EDGE-009 | Manual-fixture URL fails enrichment (404, paywall, timeout > 15 s, > 100 KB body). | Item is still added with `enrichmentStatus: 'failed'` and best-effort recovered fields; grader sees the failure indicator. | REQ-003 |
| EDGE-010 | A ground-truth `must` item appears in zero current sources for a given fixture (sourcing gap). | Sourcing report surfaces the gap as a row with zero counts under the relevant source. Ranker score is unaffected. | REQ-025 |
| EDGE-011 | `PUT /api/settings` race: admin clicks "Save as current prompt" while another tab also saves. | Last write wins (existing PUT semantics). The eval page does not introduce optimistic-lock; future improvement noted in design Risks. | REQ-026 |
| EDGE-012 | Manual fixture POST contains the exact same URL twice. | Server dedupes by exact-string match before enrichment; response includes `duplicatesDropped: N`. | REQ-006 |
| EDGE-013 | LLM response cache file is corrupt JSON. | Cache miss path executes (treat unparseable file as absent), the corrupt file is overwritten with the fresh response. Logged at `warn` level. | REQ-022 |
| EDGE-014 | `--window` flag value is non-positive or non-integer. | CLI exits `1` with stderr `--window must be a positive integer`. | REQ-023 |
| EDGE-015 | `runEval()` invoked with `mode: 'scored'` but no ground-truth file exists for the fixtureId. | API returns `400` with `{ error: 'no groundtruth for fixture <id>' }`; CLI exits `1` with the same message. | REQ-013, REQ-015 |
| EDGE-016 | Fixture file under `evals/ranking/fixtures/` fails `FixtureSchema.parse`. | The fixture is reported in `GET /api/admin/eval/fixtures` index with `gradingStatus: 'ungraded'` and a `parseError` field; `runEval` on it returns `400`. | REQ-005 |
| EDGE-017 | Production deploy reaches the `POST /api/admin/eval/groundtruth/:fixtureId` route. | Route returns `403` regardless of payload because `NODE_ENV === 'production'`. | REQ-011 |
| EDGE-018 | Admin pastes 250 URLs into the manual-fixture builder. | Server enriches them with concurrency capped by `WEB_CRAWLER_CONCURRENCY` (≈ 4 parallel); the UI displays per-URL progress. No hard ceiling beyond the existing service's behaviour. | REQ-003 |
| EDGE-019 | An empty ground-truth file (zero labels) is loaded. | `ndcgAtK` returns `0` (VS-0.4); the eval result is rendered with a clear "no labels — score is 0" indicator. | REQ-016 |

---

## Verification Matrix

| ID | Unit | Integration | E2E (Playwright) | Manual | Notes |
|---|---|---|---|---|---|
| REQ-001 | — | Yes | — | — | CLI run against seeded DB; assert files and schema. |
| REQ-002 | — | Yes | — | — | Hash check across two runs. |
| REQ-003 | — | Yes | — | — | Mocked link-enrichment with two URLs. |
| REQ-004 | Yes | — | — | — | Schema check + SDK call inspector. |
| REQ-005 | — | Yes | — | — | Index endpoint vs filesystem state. |
| REQ-006 | — | Yes | — | — | POST with duplicates. |
| REQ-007 | — | — | Yes | — | Playwright keyboard interaction. |
| REQ-008 | — | — | Yes | — | LocalStorage round-trip. |
| REQ-009 | — | — | Yes | — | Disabled-state toggle. |
| REQ-010 | — | — | Yes | — | Download intercepted, content parsed. |
| REQ-011 | — | Yes | — | — | Env-gated route. |
| REQ-012 | — | Yes | — | — | Two sequential POSTs. |
| REQ-013 | — | Yes | — | — | SSE stream parsed. |
| REQ-014 | — | Yes | Yes | — | Integration for shape; Playwright for two-column render. |
| REQ-015 | — | Yes | — | — | CLI invocation, JSON parse. |
| REQ-016 | Yes | — | — | — | VS-0.1 – VS-0.4. |
| REQ-017 | Yes | — | — | — | VS-0.6. |
| REQ-018 | Yes | — | — | — | VS-0.5. |
| REQ-019 | Yes | — | — | — | Lead-story unit test. |
| REQ-020 | Yes | — | — | — | Union diff unit test. |
| REQ-021 | Yes | — | — | — | VS-0.7. |
| REQ-022 | — | Yes | — | — | Mock SDK call counter + timing. |
| REQ-023 | — | Yes | — | — | CLI exit codes per window. |
| REQ-024 | — | Yes | Yes | — | CLI stdout for estimate/actual; UI panel renders both. |
| REQ-025 | Yes | — | Yes | — | Aggregator unit test + UI panel. |
| REQ-026 | — | — | Yes | — | Diff modal + PUT verified. |
| REQ-027 | — | — | Yes | — | Mount + edit isolation. |
| REQ-028 | — | — | Yes | — | Performance.now deltas. |
| REQ-029 | — | Yes | — | — | Two `--no-cache` replays. |
| REQ-030 | — | Yes | — | — | Injected failure in one fixture. |
| REQ-031 | — | Yes | Yes | — | 404 + greyed-out dates. |
| REQ-032 | — | — | Yes | — | Equal prompts → hint. |
| REQ-033 | — | Yes | — | — | Two sequential Mode-A runs. |
| REQ-034 | — | Yes | — | — | ESLint + web build. |
| REQ-035 | — | Yes | — | — | Per-route 401 check. |
| REQ-036 | — | Yes | — | — | Build + ESLint cross-package. |
| EDGE-001 | — | Yes | — | — | Fixture with null enrichedLink. |
| EDGE-002 | — | Yes | — | — | Original prompt diff display. |
| EDGE-003 | — | — | Yes | — | LocalStorage resume. |
| EDGE-004 | — | Yes | — | — | Two-POST append. |
| EDGE-005 | — | Yes | — | Yes | Deprecation re-grade flow has a manual final step. |
| EDGE-006 | Yes | — | — | — | Frozen-cluster test. |
| EDGE-007 | — | Yes | Yes | — | API 404 + UI grey. |
| EDGE-008 | — | — | Yes | — | Equal prompts. |
| EDGE-009 | — | Yes | — | — | Mocked failing enrichment. |
| EDGE-010 | Yes | — | — | — | Sourcing gap row. |
| EDGE-011 | — | — | — | Yes | Manual race test. |
| EDGE-012 | — | Yes | — | — | URL dedup at POST. |
| EDGE-013 | — | Yes | — | — | Corrupt cache file. |
| EDGE-014 | — | Yes | — | — | CLI flag validation. |
| EDGE-015 | — | Yes | — | — | Missing ground truth. |
| EDGE-016 | — | Yes | — | — | Invalid fixture in index. |
| EDGE-017 | — | Yes | — | — | Production env guard. |
| EDGE-018 | — | — | — | Yes | Manual smoke for large paste. |
| EDGE-019 | Yes | — | — | — | Empty ground truth. |

Every REQ and EDGE has at least one column marked. UI-surface REQs (REQ-007–010, REQ-014, REQ-024–028, REQ-031, REQ-032) are E2E. Scoring REQs (REQ-016–021, REQ-025 aggregator) are Unit. CLI REQs (REQ-001, REQ-015) are Integration.

---

## Verification Scenarios

### VS-0: nDCG correctness (verbatim from `library-probe.md` §8 via `verification-stubs.md`)

#### VS-0.1 Perfect ranking yields nDCG = 1

**Given** a ranker output `[A, B, C, D, E]` and ground truth
`{A: must, B: must, C: nice, D: nice, E: drop}` (already in ideal order),
**When** `ndcgAtK(ranked, gt, 5)` is called,
**Then** the result equals `1.0` exactly (within `1e-9` tolerance).

#### VS-0.2 Worked-example fixture (mixed tiers, ranker misses one labeled item)

**Given** ranker output `[A, B, C, D, E]` and ground truth
`{A: must, B: nice, C: drop, D: must, E: drop, F: nice}` (F labeled but not returned),
**When** `ndcgAtK(ranked, gt, 5)` is called,
**Then** the result is `0.8454` ± `1e-4`.

(Worked by hand in library-probe.md §4; verified against `sklearn.metrics.ndcg_score`.)

#### VS-0.3 All-`drop` ground truth → nDCG = 0

**Given** ranker output `[A, B, C]` and ground truth `{A: drop, B: drop, C: drop}`,
**When** `ndcgAtK(ranked, gt, 3)` is called,
**Then** the result is exactly `0.0` (IDCG = 0 → return 0, not NaN, not 1.0).

#### VS-0.4 Empty ground truth → nDCG = 0

**Given** ranker output `[A, B, C]` and ground truth `[]`,
**When** `ndcgAtK(ranked, gt, 3)` is called,
**Then** the result is exactly `0.0`.

#### VS-0.5 Ranker misses a `must` item → must-include recall < 1

**Given** ground truth containing three `must` items `{X, Y, Z}` plus filler,
and ranker output of length 10 that includes `X` and `Y` but **not** `Z`,
**When** `mustIncludeRecall(ranked, gt, 10)` is called,
**Then** the result is `2/3` (≈ `0.6667`), not `1.0`.

#### VS-0.6 Ranker returns fewer than k items → P@k denominator is still k

**Given** ranker output of length 5 (`[A, B, C, D, E]`) where 3 of those items
are graded `must` or `nice` in ground truth, and `k = 10`,
**When** `precisionAtK(ranked, gt, 10)` is called,
**Then** the result is `3 / 10 = 0.3` — the missing 5 slots count as misses,
the denominator is **not** clipped to `ranked.length`.

#### VS-0.7 Duplicate rawItemId in ranker output → throws

**Given** ranker output `[{rawItemId: 1}, {rawItemId: 2}, {rawItemId: 1}]`
(item 1 appears twice),
**When** any of `ndcgAtK`, `precisionAtK`, `mustIncludeRecall` is called with
this input,
**Then** the function throws an `Error` whose message names the duplicate
`rawItemId`. (Defensive boundary check; do not silently dedupe.)

### VS-1: Export fixtures from 15 days of raw_items

**Given** a DB seeded with 3 reviewed runs across the last 15 days (totaling 1,200 raw_items rows),
**When** an operator runs `pnpm --filter @newsletter/pipeline eval:export-fixtures --days 15`,
**Then** exactly 3 files appear under `evals/ranking/fixtures/run-*.json`; each file's `pool.length` equals the row count for that `runId`; the CLI prints `exported: 3, skipped: 0`; exit code is `0`.

### VS-2: Manual fixture creation enriches URLs

**Given** an authenticated admin and 5 valid public URLs,
**When** the admin POSTs `{ slug: "mvp-launch", urls: [...] }` to `/api/admin/eval/fixtures`,
**Then** HTTP `201` is returned with `{ fixtureId: "manual-mvp-launch-<ts>", duplicatesDropped: 0 }`; the on-disk fixture has 5 items each with `enrichedLink.title` non-empty (for URLs that succeed) or `enrichmentStatus: 'failed'` (for URLs that fail); `engagement` is `null` for all items.

### VS-3: Grading flow — open fixture, label clusters, download ground truth

**Given** an ungraded run-fixture with 50 dedup clusters,
**When** the grader opens `/admin/eval/grade/<fixtureId>`, presses `1`/`2`/`3` on each cluster, types `aman` into the gradedBy field, and clicks **Download & I'll commit it**,
**Then** the browser downloads `<fixtureId>.json` whose `labels.length === 50`, every cluster representative `rawItemId` appears once, `gradedBy === ['aman']`, and the file parses against `GroundTruthSchema`.

### VS-4: Mode A — scored eval emits nDCG + delta

**Given** a graded fixture and a draft prompt that differs from the saved prompt,
**When** the admin clicks **Run** in Mode A on `/admin/eval`,
**Then** the results panel renders `nDCG@10`, `precision@10`, `mustIncludeRecall`, `rankOneIsMustInclude`, and a `perItemDiff` table; if a prior cached score exists for the same fixture, `deltaVsPrevious` is shown; total round-trip is under `30000 ms` on cache miss and under `2000 ms` on cache hit.

### VS-5: Mode B — calendar replay shows two columns

**Given** a calendar date with ≥ 30 `raw_items` rows AND a draft prompt that differs from the saved prompt,
**When** the admin picks that date and clicks **Run** in Mode B,
**Then** within `60000 ms` two columns render — left titled "Saved prompt" with the top 10 from `user_settings.rankingPrompt`, right titled "Draft prompt" with the top 10 from the draft; no nDCG/precision metric is shown; cost meter shows `actual: $0.0XX`.

### VS-6: Save draft as current prompt — diff confirmation gates the write

**Given** a draft prompt that differs from the saved one,
**When** the admin clicks **Save as current prompt**,
**Then** a modal opens showing a red/green diff of saved vs draft; on **Confirm** the UI fires `PUT /api/settings` with the draft body and the modal closes; on **Cancel** no request is made; after Confirm, `GET /api/settings` returns the draft as `rankingPrompt`.

### VS-7: LLM cache hit returns in under 2 seconds

**Given** a fixture that has already been evaluated with a specific `(prompt, fixtureId, model)` triple,
**When** the same Mode-A eval is run again,
**Then** `evals/ranking/cache/responses/<key>.json` is read, no Anthropic SDK call is issued (verified via mock call counter), and `EvalResult` is returned in `< 2000 ms` wall-clock; the result is byte-identical to the prior run's `EvalResult.perFixture[0].scored`.

### VS-8: Cost guard enforces window cap

**Given** 30 graded fixtures on disk,
**When** the operator runs (a) `pnpm eval:ranking --all`, (b) `--all --window 60`, (c) `--all --window 100`, (d) `--all --window 100 --force-window 100`,
**Then** (a) runs 20 fixtures, exit `0`; (b) runs 30 fixtures, exit `0`; (c) exits `1` with stderr `--force-window required for N > 60`; (d) runs 30 fixtures, exit `0`. The UI equivalent of (c) opens a confirmation modal with an estimated USD cost line.

---

## Out of Scope

The following are explicitly **not** delivered by this spec and shall be deferred to follow-up designs:

- **Multi-tenant fixtures.** No `userId` field on `Fixture` or `GroundTruth`. v1 is internal-only (Ritesh + Aman). If product exposure becomes in-scope, the additive schema change is documented in design §Assumptions 7.
- **Auto-rerun on prompt edit.** The `/admin/eval` page does not auto-replay when the editor textarea changes — explicit **Run** click only (design §Open Questions 3).
- **CI integration / GitHub Action.** Running the eval on PRs that touch `rank.ts` / `rank-prompts.ts` / `shortlist.ts` is a follow-up one-day task (design §Open Questions 6).
- **Summarisation eval.** The same loop pattern applies but is deferred to its own design (design §Open Questions 7).
- **Cross-URL semantic dedup in the manual-fixture builder.** Exact-URL match only (design §Open Questions 5).
- **Changing the live ranker's `topK`** in `packages/pipeline/src/rank.ts` from its current value to 10. The eval scores @10 regardless of what the ranker returns; modifying the ranker's `topK` is a separate PR (design §A8, §Open Questions 8).
- **Per-grader-score view.** First-write-wins with `gradedBy: string[]` is the v1 conflict-resolution; surfacing per-grader scores is a future enhancement (design §Risks "Two admins disagree on labels").
- **Postgres-backed labels.** Rejected in design Approach A — labels remain file-on-disk for PR-visibility.
- **Postgres working state.** Rejected in design Approach B — localStorage + JSON download is the v1 mechanism.
- **Stage-2-only fixtures.** Rejected in design Approach C — fixtures are full-pool (stage-1 + stage-2).
- **Generic eval-set holdout discipline.** Mentioned as a future operational hygiene step (design §Risks "Eval-set scores rise but live newsletter doesn't"); not implemented in code.
- **`model_deprecated: true` manifest automation.** When a pinned model is deprecated, the regrade flow is manual; no automated tagging code is shipped in v1 (design §EDGE-005, §Risks).

---

## Ambiguities Resolved

The following ambiguities arose while reading the design and were resolved as below; flagged here so the planner/TDD stages can challenge them if needed:

1. **`requireAdmin` middleware path for new routes.** Design says "gated by existing `requireAdmin` middleware" — assumed identical to the middleware used by other `/api/admin/*` routes (cookie `admin_session`). Spec'd as REQ-035.
2. **`gradingStatus: 'in_progress'`** in REQ-005 — design mentions three statuses but `localStorage` working state is browser-only and not visible to the server. Resolved: server reports only `ungraded` / `graded`; `in_progress` is reserved for a future Postgres-backed working-state and never returned in v1.
3. **Sourcing report aggregation scope.** Design says "across graded fixtures." Assumed: aggregation runs across **all** ground-truth files visible on disk in the current `--all` / window selection — not a fixed historical window. Spec'd as REQ-025.
4. **Mode B "draft == saved" behaviour.** Design says "shows hint instead of running two redundant LLM calls" — left two implementation choices open (disable Run vs run once). Spec'd as REQ-032 with either acceptable.
5. **Exit code policy for `--all` partial failures.** Design says "skips and continues." Resolved: exit `0` if at least one fixture succeeded, `1` only when all fail. Spec'd as REQ-030.
6. **`perItemDiff` membership.** Design's `EvalResult` shape suggests the diff covers ranker output items only, but `groundTruthTier` is non-optional → it must also cover ground-truth-only items. Resolved as union with `rankerRank: null` for GT-only entries. Spec'd as REQ-020.
7. **Window-cap counting.** "20 fixtures / 20 days" — design uses both phrasings. Resolved: count fixtures, ordered by `gradedAt` descending. Spec'd as REQ-023.
8. **`gradedBy` first-write-wins.** Design says "first commit wins in git" — resolved as "first entry in the `gradedBy` array is preserved across subsequent overwrites; later signatures appended." Spec'd as REQ-012.
