# SPEC: Personalized Two-Stage Ranking

**Source:** `docs/plans/2026-04-09-personalized-ranking-design.md`
**Generated:** 2026-04-09
**Linear:** VER (AI Newsletter)
**Base branch:** `feat/claude-model-switch` — this work stacks on the Claude Haiku switch. PR targets that branch, not `main`.
**LLM stack:** Claude Haiku 4.5 via `@ai-sdk/anthropic` (from base branch). Embeddings: Voyage AI `voyage-3.5-lite` via REST (new).
**New env vars:** `VOYAGE_API_KEY` (required at pipeline worker boot).
**Profile location:** `profiles/*.yaml` at repo root.

---

## Requirements

### Profile loading and validation

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Event-driven | When a run is submitted with a `profileName` field, the API shall load the corresponding `profiles/<profileName>.yaml` file from the repo root. | Given a valid `profileName`, the job payload enqueued on the processing queue contains a parsed `UserProfile` object with `name`, `topics`, and `antiTopics` fields. | Must |
| REQ-002 | Event-driven | When the API parses a profile file, it shall validate the parsed object against a zod schema requiring `name: string`, `topics: string[]` (min length 1), and optional `antiTopics: string[]`. | A profile missing `topics` is rejected at submission; a profile with valid shape is accepted. | Must |
| REQ-003 | Unwanted | If a submitted `profileName` does not match any file in the profiles directory, then the API shall reject the submission with HTTP 400 and an error body naming the missing profile. | POST `/api/runs` with `profileName: "nonexistent"` returns 400 with body `{ error: "profile not found: nonexistent" }`. | Must |
| REQ-004 | Unwanted | If a profile file fails YAML parsing or schema validation, then the API shall reject the submission with HTTP 400 and an error body naming the failure. | Malformed YAML returns 400 with a structured error identifying the file and line. | Must |
| REQ-005 | Event-driven | When a run is submitted without a `profileName` (field omitted or `null`), the system shall proceed with a profile-less run. | The enqueued job payload has `profile: null`; the run completes using the topic-agnostic rubric. | Must |
| REQ-006 | Ubiquitous | The `UserProfile` type shall be defined in `@newsletter/shared` and re-exported from both the API and pipeline packages. | Importing `UserProfile` from `@newsletter/shared` resolves; neither API nor pipeline defines its own copy. | Must |
| REQ-007 | Ubiquitous | The API shall expose `GET /api/profiles` returning a JSON array of available profile names discovered in `profiles/*.yaml`. | Endpoint returns `{ profiles: string[] }` where each string is a profile file stem (e.g. `"aman"`, `"ritesh"`). | Must |
| REQ-008 | Event-driven | When the pipeline worker boots, it shall validate that `VOYAGE_API_KEY` is set and non-empty. | Worker startup fails fast with a clear error message if `VOYAGE_API_KEY` is missing or empty, in the same pattern as `ANTHROPIC_API_KEY` validation. | Must |
| REQ-009 | Ubiquitous | The embeddings client shall be a single module at `packages/pipeline/src/services/embeddings.ts` that wraps `POST https://api.voyageai.com/v1/embeddings` using `fetch` — no SDK dependency. | Module exists, exports a single `embedBatch(inputs: string[]): Promise<number[][]>` function, and no `voyageai` or similar package appears in `package.json`. | Must |

### Candidate loading

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-010 | Ubiquitous | The `candidate-loader` SELECT shall include `raw_items.content` and `raw_items.metadata` columns. | Running the loader returns `Candidate` objects with populated `content` and `comments` fields; Drizzle query plan references both columns. | Must |
| REQ-011 | Ubiquitous | The `Candidate` type shall expose `content: string \| null` and `comments: RawItemComment[]`. | TypeScript compilation passes when consumers read `candidate.content` and `candidate.comments`; no `any` used. | Must |
| REQ-012 | Ubiquitous | For blog items, `candidate.comments` shall be an empty array when the row's `metadata.comments` is empty or missing. | A blog `raw_item` inserted with `metadata: { comments: [] }` loads as `candidate.comments.length === 0`. | Must |

### Shortlist stage (stage-1 filter)

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-020 | State-driven | While a run has a non-null profile, the shortlist stage shall compute `score = relevance × recencyDecay(ageHours)` for each candidate. | Unit test: given a fixed profile, candidate, and stubbed `embedBatch`, `shortlistStage` returns the expected score matching the formula. | Must |
| REQ-021 | State-driven | While a run has a non-null profile, the shortlist stage shall compute `relevance = max(cos(titleEmbedding, topicEmbedding)) − α × max(cos(titleEmbedding, antiTopicEmbedding))` using cosine similarity. The default `α` is 0.5. | Unit test with stubbed `embedBatch` verifies the relevance formula on a fixed input. | Must |
| REQ-022 | State-driven | While a run has a null profile, the shortlist stage shall score candidates by `recencyDecay(ageHours)` only, with no embedding work. | Profile-less run: `embedBatch` is not called; top K candidates are those with the highest recency score. | Must |
| REQ-023 | Ubiquitous | The shortlist stage shall forward the top K candidates (default K=20, configurable per run) ranked by score to the rank stage. | Given 100 candidates and K=20, exactly 20 candidates are passed to the rank stage. | Must |
| REQ-024 | Ubiquitous | The shortlist stage shall not read or use `candidate.engagement.points` or `candidate.engagement.commentCount` in its scoring. | Grep of `shortlist.ts` contains no reference to `.points` or `.commentCount`; a unit test mutates engagement fields and asserts the score is unchanged. | Must |
| REQ-025 | Event-driven | When the shortlist stage runs with a profile, it shall call `embedBatch` exactly twice per run: once for all candidate titles and once for all profile topics + antiTopics. | Stubbed `embedBatch` records exactly 2 invocations regardless of candidate count. | Must |
| REQ-025a | Ubiquitous | The `embeddings.ts` service shall use the `voyage-3.5-lite` model and request 512-dimensional output. | Unit test with stubbed `fetch` asserts the outgoing HTTP request body names the model and a 512-dim output. Exact Voyage request shape (parameter names, asymmetric query/document encoding) is an implementation detail to verify against current Voyage docs during planning. | Must |
| REQ-026 | Unwanted | If a candidate has `publishedAt === null`, then the shortlist stage shall assign it the recency decay value of a 24-hour-old item. | Unit test: candidate with `publishedAt: null` receives `recency = exp(−24 / halfLifeHours)`. | Must |
| REQ-027 | Ubiquitous | The shortlist stage shall log, at INFO level, the candidate count, shortlist size K, shortlist duration, and the full per-candidate score breakdown (relevance, recency, combined) at DEBUG level. | Log output contains one structured INFO line with `{candidateCount, shortlistSize, durationMs}` and DEBUG lines per candidate with `{id, relevance, recency, combined}`. | Must |
| REQ-028 | Ubiquitous | Shortlist ordering shall be deterministic: primary sort `score DESC`, secondary sort `rawItemId ASC`. | Unit test with two candidates of identical score returns them ordered by ascending `rawItemId`. | Must |

### Recency decay

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-030 | Ubiquitous | The `recencyDecay` function shall compute `exp(−ageHours / halfLifeHours)`. | Unit test: `recencyDecay(0, 48) === 1`; `recencyDecay(48, 48) === Math.exp(-1)` within floating-point tolerance. | Must |
| REQ-031 | Ubiquitous | `halfLifeHours` shall default to 48 and be overridable via a per-run config field. | Default run: `halfLifeHours === 48`. Run with `{halfLifeHours: 24}` in payload uses 24 in both stages. | Must |

### Rank stage body loading (inline input prep)

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-040 | Event-driven | When the rank stage processes a shortlisted candidate with `content !== null`, it shall use that value as the body without making any network call. | Unit test: blog candidate with `content: "<markdown>"` results in zero calls to the `fetchMarkdown` mock. | Must |
| REQ-041 | Event-driven | When the rank stage processes a shortlisted candidate with `content === null`, it shall call `fetchMarkdown(url)` to retrieve the article body. | Unit test: HN link-post candidate with `content: null` and `url: "https://..."` triggers exactly one call to the `fetchMarkdown` mock with that URL. | Must |
| REQ-042 | Ubiquitous | The rank stage's body fetches shall run with bounded concurrency via `p-limit`, with the limit configurable and defaulting to 3. | Unit test: 10 link-post candidates and a blocking mock resolve in ceil(10/3)=4 batches. | Must |
| REQ-043 | Ubiquitous | Each body fetch shall have a per-item timeout, defaulting to 15 seconds. | Unit test: a fetch that never resolves is aborted after the configured timeout; the candidate's body remains null. | Must |
| REQ-044 | Unwanted | If a body fetch fails with any error or times out, then the rank stage shall leave the candidate's body as `null` and continue ranking the remaining items. | Unit test: one of three candidates' fetches throws; the rank stage still produces 3 items in the output, with the failing item's body null. | Must |
| REQ-045 | Unwanted | If every body fetch fails, then the rank stage shall still produce a ranked output based on titles alone; the run shall not fail. | Integration test: mock `fetchMarkdown` to always throw; the run reaches `completed` status. | Must |
| REQ-046 | Event-driven | When a body fetch fails, the rank stage shall emit a WARN log containing the candidate's URL and the truncated failure reason. | Log output contains `{event: "body_fetch_failed", url, error}` for each failed fetch. | Must |
| REQ-047 | Ubiquitous | The `fetchMarkdown` helper shall live in `packages/pipeline/src/services/markdown-fetch.ts` and be imported by both the web collector and the rank stage. | Neither `rank.ts` nor `web.ts` contains the Jina URL string directly; both import `fetchMarkdown` from the services module. | Must |

### Rank stage comment loading and source neutrality

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-050 | Ubiquitous | The rank stage shall read the `comments` array from each shortlisted candidate without making any network call. | Unit test: candidate with `comments: [...]` is ranked without any HTTP mock being triggered. | Must |
| REQ-051 | Ubiquitous | The rank prompt shall include the top N comments per item, where N defaults to 5 and comments are token-budgeted at 200 tokens per comment. | Prompt snapshot test: for a candidate with 10 comments, exactly 5 appear; each is truncated at the token budget. | Must |
| REQ-052 | Ubiquitous | The rank prompt shall contain a verbatim source-neutrality rule: `"Blog posts have no comments by source design. Do not penalize items that lack discussion. Use comments as extra context when present, never as a scoring requirement."` | Prompt snapshot test: the above string appears verbatim in the assembled system prompt. | Must |
| REQ-053 | State-driven | While ranking a candidate with `comments.length === 0`, the rank stage shall not include a "no comments available" warning in the prompt that could bias the LLM. | The prompt for an empty-comment candidate contains no language suggesting the absence is a problem; the comments section is simply omitted or marked with a neutral `(none)` marker. | Must |
| REQ-054 | Ubiquitous | The rank stage shall produce scores for blog items (no comments) that are within a tight band of equivalent HN/Reddit items on a matched-content test set. | Golden-set test: two near-identical items (same topic, comparable body length) with and without comments score within ±5 points. | Should |

### Rank stage prompt and scoring

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-060 | Ubiquitous | The rank stage shall present each item to the LLM with: `id`, `title`, `url`, `sourceType`, `publishedAt`, human-readable age string, stage-1 score, body (truncated to a configurable per-item token budget, default 2000 tokens), and top N comments. | Prompt snapshot test verifies all 9 fields appear for each item. | Must |
| REQ-061 | Ubiquitous | When a profile is present, the rank prompt shall contain four scoring axes: Relevance, Novelty, Signal-vs-hype, Actionability. | Prompt snapshot test asserts each axis label appears. | Must |
| REQ-062 | State-driven | While a profile is present, the rank prompt shall instruct the LLM that Relevance is the gating axis: a very low Relevance score caps the overall score regardless of the other axes. | Prompt snapshot test contains the word "gating" and an explicit statement that low Relevance caps the overall score. | Must |
| REQ-063 | Ubiquitous | The rank prompt shall not hardcode any domain terminology (e.g. "AI", "LLM", "model", "React", "Python") outside of example text derived from the user's profile. | Grep of the prompt constant shows no domain keywords in the rubric sections. | Must |
| REQ-064 | Ubiquitous | The rank stage's LLM call shall use temperature 0. | Code review: `generateObject({ temperature: 0, ... })`. A unit test injecting a mock LLM asserts the temperature field. | Must |
| REQ-065 | Ubiquitous | The rank stage's rationale output shall name the driving scoring axis for each item (e.g. "strong relevance — matches your 'agent frameworks' topic"). | Unit test with a mock LLM returning rationales without an axis name fails a post-validation check. | Must |
| REQ-066 | Ubiquitous | After the LLM returns scores, the rank stage shall multiply each score by `recencyDecay(ageHours)` before persisting, ensuring freshness is enforced deterministically. | Unit test: LLM mock returns score 90 for a 48h-old item; persisted score is `90 × exp(−1) ≈ 33.1`. | Must |
| REQ-067 | Ubiquitous | The rank stage output shall conform to `RankedItemRef { rawItemId: number, score: number, rationale: string }`. | Type check and runtime zod validation pass on the persisted output. | Must |

### Profile-less fallback

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-070 | State-driven | While a run has a null profile, the rank prompt shall use the existing three-axis topic-agnostic rubric (Novelty, Signal-vs-hype, Actionability) without a Relevance axis. | Prompt snapshot test for profile-less runs matches the existing rubric exactly; the word "Relevance" does not appear as a scoring axis. | Must |
| REQ-071 | State-driven | While a run has a null profile, post-LLM recency multiplication (REQ-066) shall still apply. | Unit test: profile-less run with a 48h-old item has its LLM score scaled by `exp(−1)`. | Must |

### API and UI touchpoints

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-080 | Ubiquitous | The `/run` form shall present a profile dropdown populated from `GET /api/profiles`. | Playwright test: dropdown contains an entry for each YAML file in the profiles directory, plus a "No profile" option. | Must |
| REQ-081 | Ubiquitous | The `/run` form shall allow submission with no profile selected; the submitted payload has `profileName: null`. | Playwright test: selecting "No profile" and submitting results in a POST with `profileName: null`. | Must |
| REQ-082 | Event-driven | When the user submits the `/run` form with a selected profile, the POST payload shall include `profileName: string`. | Playwright test asserts the payload field. | Must |

### Persistence and wire format

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-090 | Ubiquitous | Ranked items persisted to the Redis run-state shall conform to the existing `RankedItemRef` shape: `{rawItemId, score, rationale}`. No additional fields. | `GET /api/runs/:runId` returns the same JSON shape as before this feature landed. | Must |
| REQ-091 | Ubiquitous | The `GET /api/runs/:runId` hydrated response shall include only `{rawItemId, score, rationale}` and the existing `raw_items` join fields. | Contract test against the endpoint response schema. | Must |

### Non-functional

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-100 | Ubiquitous | End-to-end ranking for a run with up to 100 candidates and a 20-item shortlist shall complete within 60 seconds measured from the worker picking up the job to writing `rankedItems` to run-state. | E2E test with stubbed collectors and a mock LLM that sleeps 500ms completes within 60s wall time. | Must |
| REQ-101 | Ubiquitous | All new data types (`UserProfile`, extended `Candidate`, extended `RankCandidate`) shall live in `@newsletter/shared` and be imported via workspace references. | `grep -r "UserProfile" packages/api packages/pipeline` shows only imports from `@newsletter/shared`. | Must |
| REQ-102 | Ubiquitous | The implementation shall not introduce any `any` types, `@ts-ignore`, or `as unknown as X` casts. | `pnpm typecheck` passes and ESLint reports zero `@typescript-eslint/no-explicit-any` violations on changed files. | Must |
| REQ-103 | Ubiquitous | Each pipeline stage (shortlist, rank) shall emit one structured INFO log at stage start and one at stage end, containing `{runId, stage, inputCount, outputCount, durationMs}`. | Log capture in an integration test shows the expected pairs. | Must |
| REQ-104 | Ubiquitous | Two concurrent runs with different profiles shall not share any mutable state; each profile is loaded into its own job payload. | Integration test: run A with profile "aman" and run B with profile "ritesh" started in parallel produce rankings consistent with their respective profiles, verified by mock LLM input inspection. | Must |

---

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | User profile has only 2 topics; stage-1 finds fewer than K candidates above a minimum relevance threshold. | The shortlist stage forwards all candidates that meet the threshold (fewer than K); logs a WARN with `{event: "thin_shortlist", actualSize, threshold}`. The run proceeds to rank with the shortened list. | REQ-023, REQ-027 |
| EDGE-002 | User profile contains a very broad topic (e.g. "software") that matches nearly every candidate. | The shortlist forwards top K by score; a WARN log `{event: "over_broad_profile", avgRelevance}` fires when the mean relevance of the shortlist is above a configured threshold. The run still completes normally. | REQ-020, REQ-027 |
| EDGE-003 | A shortlisted HN link post's linked URL returns HTTP 403 (paywall). | `fetchMarkdown` throws non-retryable; the rank stage leaves `body: null`, logs WARN, and ranks the item title-only. Run completes. | REQ-044, REQ-045, REQ-046 |
| EDGE-004 | Stage-1 produces zero candidates above the threshold (e.g. profile completely mismatches today's corpus). | The rank stage is skipped; run-state is marked `completed` with `rankedItems: []`; the frontend renders an empty-state message "No matches for your profile today." | REQ-023 |
| EDGE-005 | Two runs are enqueued simultaneously, one with `profileName: "aman"` and one with `profileName: "ritesh"`. | Each job payload carries its own parsed profile; the pipeline workers rank independently; neither run's shortlist shares state with the other. | REQ-004, REQ-104 |
| EDGE-006 | Profile has `antiTopics: ["crypto"]` and a candidate is titled "New cryptographic signing scheme for X". | The candidate is scored (not hard-filtered); the antiTopic similarity contributes α × cos to the penalty but does not zero the score. The final LLM call gets a chance to evaluate it in context. | REQ-021 |
| EDGE-007 | A candidate has `publishedAt: null`. | The shortlist stage computes `ageHours` as if the item is 24h old; `recencyDecay` is `exp(-24 / halfLifeHours)`; the item is neither boosted nor buried. | REQ-026 |
| EDGE-008 | User submits a run with `profileName: "ghost"` but no `profiles/ghost.yaml` exists. | The API returns HTTP 400 with `{ error: "profile not found: ghost" }`; no job is enqueued. | REQ-003 |
| EDGE-009 | A profile file contains malformed YAML. | The API returns HTTP 400 with a parse error identifying the file; no job is enqueued. The error message does not leak filesystem paths beyond the profile stem. | REQ-004 |
| EDGE-010 | A blog item with no comments and a high-quality body is ranked alongside an HN link post on the same topic with comments. | The blog item's score is within ±5 points of the HN item when their body quality and topic alignment are equivalent (verified against a golden-set test). | REQ-052, REQ-053, REQ-054 |
| EDGE-011 | The stage-2 LLM call fails or returns invalid JSON. | The rank stage throws; the worker marks the run `failed` with an error string; Redis run-state reflects the failure. The run is not retried automatically. | REQ-067 |
| EDGE-012 | Voyage returns an error (HTTP 5xx, rate limit, invalid key) during stage-1. | The shortlist stage throws; the worker marks the run `failed` with the Voyage error surfaced in the error message. No fallback to "no profile" mode — failure must surface, not silently degrade personalization. | REQ-020, REQ-021, REQ-008 |
| EDGE-013 | A run's `halfLifeHours` is set to 0 (invalid input). | The API's zod validator rejects the submission with HTTP 400. | REQ-031 |
| EDGE-014 | A shortlisted HN link post's fetch exceeds the per-item timeout. | The fetch is aborted; the candidate's body remains null; a WARN log fires; the candidate is ranked title-only. | REQ-043, REQ-044, REQ-046 |
| EDGE-015 | A run is submitted with `profileName: null`. | The pipeline runs with no profile: shortlist uses recency only, rank uses the existing three-axis rubric, post-LLM recency multiplication still applies. | REQ-005, REQ-022, REQ-070, REQ-071 |
| EDGE-016 | A shortlisted candidate has `comments: []` but is an HN link post (collector comment fetch failed at collection time). | The rank stage treats it identically to a blog item: no penalty for missing comments. The prompt's source-neutrality rule applies. | REQ-052, REQ-053 |
| EDGE-017 | The `profiles/` directory is empty when the API starts. | `GET /api/profiles` returns `{profiles: []}`; the `/run` form dropdown shows only "No profile"; submissions without a profile still work. | REQ-005, REQ-007, REQ-080 |
| EDGE-018 | A candidate's `content` field contains 50,000+ tokens of body text. | The rank stage truncates the body to the configured per-item token budget (default 2000) before including it in the prompt. | REQ-060 |

---

## Verification Matrix

| REQ ID | Unit Test | Integration Test | Manual Test | Notes |
|--------|-----------|-----------------|-------------|-------|
| REQ-001 | Yes | Yes | No | Integration test hits API with a valid profile and inspects enqueued job |
| REQ-002 | Yes | No | No | Zod schema unit test |
| REQ-003 | Yes | Yes | No | API route test |
| REQ-004 | Yes | Yes | No | API route test with malformed fixture |
| REQ-005 | Yes | Yes | No | |
| REQ-006 | No | No | No | Enforced by TypeScript compilation + ESLint |
| REQ-007 | Yes | Yes | No | |
| REQ-008 | Yes | Yes | No | Boot-time assertion, matches existing ANTHROPIC_API_KEY pattern |
| REQ-009 | Yes | No | No | Module existence check + API shape assertion |
| REQ-010 | Yes | Yes | No | Drizzle query test + real DB integration |
| REQ-011 | No | No | No | TypeScript compilation |
| REQ-012 | Yes | Yes | No | |
| REQ-020 | Yes | No | No | Pure function test with stubbed embedding client |
| REQ-021 | Yes | No | No | |
| REQ-022 | Yes | No | No | Mock embedding client; assert zero calls |
| REQ-023 | Yes | Yes | No | |
| REQ-024 | Yes | No | No | Grep + unit test |
| REQ-025 | Yes | No | No | Call count assertion on stubbed embedBatch |
| REQ-025a | Yes | No | No | Stubbed fetch inspects outgoing request body |
| REQ-026 | Yes | No | No | |
| REQ-027 | Yes | Yes | No | Log capture test |
| REQ-028 | Yes | No | No | |
| REQ-030 | Yes | No | No | Pure math function |
| REQ-031 | Yes | Yes | No | |
| REQ-040 | Yes | No | No | Mock `fetchMarkdown`, assert zero calls |
| REQ-041 | Yes | No | No | Mock `fetchMarkdown`, assert one call per null-content item |
| REQ-042 | Yes | No | No | Concurrency test with blocking mock |
| REQ-043 | Yes | No | No | Fake timer test |
| REQ-044 | Yes | Yes | No | |
| REQ-045 | No | Yes | No | Full run with mock always throwing |
| REQ-046 | Yes | No | No | Log capture |
| REQ-047 | No | No | No | Enforced by code review + grep |
| REQ-050 | Yes | No | No | |
| REQ-051 | Yes | No | No | Prompt snapshot test |
| REQ-052 | Yes | No | No | Exact-string snapshot (see .claude/rules/learnings/test-exact-spec-mandated-strings.md) |
| REQ-053 | Yes | No | No | Prompt snapshot |
| REQ-054 | Yes | No | No | Golden-set regression test with mock LLM |
| REQ-060 | Yes | No | No | Prompt snapshot |
| REQ-061 | Yes | No | No | Prompt snapshot |
| REQ-062 | Yes | No | No | Prompt snapshot (exact-string check) |
| REQ-063 | Yes | No | No | Grep + snapshot |
| REQ-064 | Yes | No | No | Mock LLM asserts temperature field |
| REQ-065 | Yes | No | No | |
| REQ-066 | Yes | Yes | No | |
| REQ-067 | Yes | Yes | No | Zod runtime check |
| REQ-070 | Yes | No | No | Prompt snapshot for profile-less path |
| REQ-071 | Yes | No | No | |
| REQ-080 | No | No | Yes | Playwright test against real frontend |
| REQ-081 | No | No | Yes | Playwright test |
| REQ-082 | No | No | Yes | Playwright test |
| REQ-090 | No | Yes | No | Contract test against `/api/runs/:runId` |
| REQ-091 | No | Yes | No | |
| REQ-100 | No | Yes | No | E2E timing assertion |
| REQ-101 | No | No | No | Grep-based check in CI |
| REQ-102 | No | No | No | `pnpm typecheck` + ESLint in CI |
| REQ-103 | Yes | Yes | No | |
| REQ-104 | No | Yes | No | |
| EDGE-001 | Yes | No | No | |
| EDGE-002 | Yes | No | No | |
| EDGE-003 | Yes | Yes | No | Mock fetch returns 403 |
| EDGE-004 | Yes | Yes | No | Zero-shortlist integration + empty-state UI check |
| EDGE-005 | No | Yes | No | Concurrent BullMQ job test |
| EDGE-006 | Yes | No | No | |
| EDGE-007 | Yes | No | No | |
| EDGE-008 | Yes | Yes | No | |
| EDGE-009 | Yes | Yes | No | |
| EDGE-010 | Yes | No | No | Golden-set test |
| EDGE-011 | Yes | Yes | No | Mock LLM throws |
| EDGE-012 | Yes | Yes | No | Mock embedding client throws |
| EDGE-013 | Yes | No | No | Zod validation |
| EDGE-014 | Yes | No | No | Fake timer test |
| EDGE-015 | Yes | Yes | No | |
| EDGE-016 | Yes | No | No | |
| EDGE-017 | Yes | Yes | No | |
| EDGE-018 | Yes | No | No | Large-body fixture |

---

## Out of Scope

This slice deliberately does **not** implement:

- **Feedback learning.** No thumbs-up/down UI, no implicit signal from review-accept/reject decisions, no weight updates based on past runs. The profile is hand-authored and static; evolution happens by the user editing the YAML file.
- **Per-user authentication or user records.** Profiles are file-based (`profiles/<name>.yaml`), not database-backed. Multi-tenancy via a `user_profiles` Postgres table is a future slice.
- **Comment collection for the web (blog) collector.** Blog items remain without comments — this is by source design, not a bug. The ranker handles this via the source-neutrality rule.
- **Per-axis score surfacing in the UI.** The frontend continues to show only `{score, rationale}`. Displaying Relevance / Novelty / Signal-vs-hype / Actionability breakdowns is a future UI enhancement.
- **A "how this was ranked" debugging panel.** Stage-1 scores and LLM rationales are logged structured for grepping; a UI panel is future work.
- **Configurable scoring weights per axis.** Relevance is hardcoded as the gating axis; the other three carry equal weight as defined in the prompt. Tunable weights are a future slice if empirical data shows a need.
- **Engagement as a scoring signal.** Engagement (`points`, `commentCount`) remains context-only per the 2026-04-08 rubric rework. The shortlist stage explicitly does not read these fields.
- **Embedding cache persistence.** Topic embeddings are computed once per run, not cached across runs. A Redis-backed embedding cache is a future optimization if usage ever approaches the Voyage free-tier ceiling (it will not at current scale).
- **Alternative embedding providers.** Voyage `voyage-3.5-lite` is the chosen provider. Swapping to OpenAI, Cohere, or a local model is out of scope; the `embeddings.ts` module is not designed as a pluggable adapter.
- **A new processor file or intermediate type for body/comment loading.** Body loading happens inline inside the rank stage's input prep; there is no separate `enrich` stage or `EnrichedCandidate` type.
- **Headless browser / Playwright-based body fetching for paywalled sites.** Only the existing `fetchMarkdown` / Jina Reader path is used. Sites that Jina cannot reach degrade to title-only ranking.
- **Automatic profile generation or suggestion.** Users write their own YAML from scratch; there is no wizard, no inference from past reading history, no template.
- **Translation or multilingual support.** Profiles, prompts, and ranking all assume English content.

---

## Next Stage

This SPEC flows into implementation planning (`harness:planning`). Each plan phase will map to a coherent set of REQ IDs; TDD tests must reference the REQ/EDGE ID they cover (e.g. `test_REQ_052_source_neutrality_rule_in_prompt`).

**Worktree:** `.worktrees/personalized-ranking` branched from `feat/claude-model-switch`.
**PR target:** `feat/claude-model-switch` (not `main`).
