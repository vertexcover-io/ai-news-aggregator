# Personalized Two-Stage Ranking — Design

**Status:** Draft
**Date:** 2026-04-09
**Base branch:** `feat/claude-model-switch` (this work stacks on top, PR targets that branch, not `main`)
**Builds on:** `2026-04-08-rank-prompt-redesign-design.md` (topic-agnostic rubric — extended, not replaced)
**Linear:** VER (AI Newsletter)

---

## Problem

The current ranker (`packages/pipeline/src/processors/rank.ts`) sends `{id, title, url, sourceType, publishedAt, engagement}` to Claude Haiku with a topic-agnostic rubric (Novelty / Signal-vs-hype / Actionability). It has five concrete failure modes:

1. **No concept of what the reader wants.** High scores are possible on topics neither Ritesh nor Aman cares about.
2. **Buries gems.** Items the users actually care about don't rank because the ranker has no profile to anchor against.
3. **Sees only headlines.** Title alone is too thin to judge a piece's real value — the body and HN/Reddit discussion carry most of the signal, and the body is already on `raw_items.content` for many items but unused.
4. **Ignores recency.** A three-day-old story and a three-hour-old story score identically. For a daily newsletter, stale content is low-value even when it's topically relevant.
5. **Ignores comments even though they're collected.** Both the HN and Reddit collectors run a second-pass `fetchComments` call and write `RawItemComment[]` into `metadata.comments`, but the ranker never reads the column.

## Context

- **Users:** two fixed today (Ritesh, Aman); design must be ready for N users with isolated preferences.
- **Corpus:** up to 100 candidates per run after dedup, across HN / Reddit / web blogs.
- **Today's pipeline:** one BullMQ worker runs `collect → dedup → rank` in-process and writes `rankedItems: RankedItemRef[]` to Redis run-state (type in `packages/shared/src/types/run.ts:34`). Frontend polls and hydrates.
- **Existing knobs:** only `topN` and per-source collection filters.
- **Current LLM stack (from `feat/claude-model-switch`):** Claude Haiku 4.5 via `@ai-sdk/anthropic`, `ANTHROPIC_API_KEY` validated at pipeline boot. No embedding provider is currently installed — Anthropic does not ship one.
- **What's already on `raw_items.content` today** (verified against collectors at `packages/pipeline/src/collectors/{web,hn,reddit}.ts`):
  - **Blog:** full article markdown, always (web collector scrapes every post via Jina Reader at collection time).
  - **HN:** `story_text` for self-posts (Ask/Show HN) only. Link posts are `content: null`.
  - **Reddit:** `selftext` for self-posts only. Link posts are empty.
- **What's on `raw_items.metadata.comments` today:**
  - **HN:** populated via `fetchComments` at `hn.ts:269`.
  - **Reddit:** populated via `fetchComments` at `reddit.ts:272`.
  - **Blog:** empty by source design (blogs don't have comment sections the collector can reach).
- **Existing reusable helper:** `fetchMarkdown(url)` in `packages/pipeline/src/collectors/web.ts` — wraps Jina Reader with retry, backoff, non-retryable status handling, and optional `JINA_API_KEY`. Used as-is for any on-demand body fetch; moved to a shared service module to avoid a collector cross-import (see C3).

## Requirements

### Functional

- **F1.** Each run accepts an optional `profileName` referring to a `profiles/<name>.yaml` file at the repo root.
- **F2.** Profile shape: `{name: string, topics: string[], antiTopics?: string[]}`. Hand-authored, validated at submission.
- **F3.** Ranking is two-stage: a cheap Voyage-embedding stage-1 shortlists candidates against the profile; a stage-2 Claude rerank reads the shortlist with body, comments, and recency context.
- **F4.** The rank stage uses `raw_items.content` directly when non-null. For HN and Reddit link posts (`content IS NULL`), it calls `fetchMarkdown(url)` inline, only for shortlisted items. Body loading is input prep inside `rank.ts`, not a separate pipeline stage.
- **F5.** The rank stage uses `raw_items.metadata.comments` directly. Blog items have empty arrays and must not be penalized — the prompt contains an explicit source-neutrality rule.
- **F6.** Publish date influences ranking in both stages via exponential recency decay.
- **F7.** The wire shape (`RankedItemRef = {rawItemId, score, rationale}`) is unchanged — no frontend churn.
- **F8.** Ranking stays topic-agnostic at its core. Nothing in the prompt or filter hardcodes domain terminology; all domain specificity lives in the profile.
- **F9.** Profile-less runs still work, using the existing three-axis topic-agnostic rubric plus post-LLM recency decay.

### Non-functional

- **NF1. Latency.** End-to-end ranking (stage-1 + body fetch + stage-2) ≤ 60 s for a 100-candidate → 20-item shortlist.
- **NF2. Cost.** Well within Voyage's 200M free-tier tokens (effectively free at this scale — see Voyage decision below) and within a few cents of Claude Haiku cost per run.
- **NF3. Observability.** Each stage logs input/output counts, duration, and per-item score breakdowns so profiles can be tuned without reading code.
- **NF4. Determinism.** Temperature 0 for the Claude call; stable shortlist ordering via `(score DESC, rawItemId ASC)`.
- **NF5. Failure isolation.** A failed body fetch leaves that item with `body: null` (ranked title-only) but does not fail the run. An embedding or LLM failure fails the run loudly — no silent fallback to "no profile" mode.
- **NF6. Type safety & package boundaries.** All new types in `@newsletter/shared`; no `any`; pipeline and API communicate only through DB and job payloads.

## Key Insights

1. **The rubric rework was necessary but not sufficient.** Topic-agnostic scoring made ranking fair; it didn't make it personal. Relevance is a missing axis, not a replacement for the existing three.
2. **We're already storing the signals we need, and throwing them away.** Body is on `raw_items.content` for blogs and self-posts (candidate-loader just doesn't `SELECT` it). Comments are on `raw_items.metadata.comments` for HN and Reddit (same story). Both gaps are one-column SELECT changes. The only real new fetch work is HN/Reddit link posts, and only for the ~20 that survive stage-1 — reusing the existing `fetchMarkdown` helper.
3. **Two-stage retrieval is the standard shape for a reason.** Embedding-based filtering cheaply drops the 80% of candidates that obviously don't match, so Claude only rereads the 20 that matter. This is the pattern every major news/feed system uses (Discover, Feedly, UR4Rec, CoT-Rec).
4. **Hand-authored profiles are fine for two users.** Learned user embeddings are built for platforms with millions of interactions. With two users, a hand-written YAML carries more signal than any cold-start learner.
5. **Absent comments are not a negative signal.** Blogs have no comments by source design. A ranker that implicitly rewards discussion volume would systematically under-rank blogs. Comments are additive context, never a scoring requirement — and the prompt must state this explicitly.
6. **Recency is the cheapest signal we have and it's free.** `publishedAt` is already populated on every row; an exponential decay costs nothing and meaningfully reshapes the shortlist for a daily newsletter.

## Architectural Decisions

### C1. Profile loading lives in the API, not the worker

Profiles are read from `profiles/*.yaml` (repo root) at run submission, validated with zod, and injected as a parsed `UserProfile` object into the BullMQ job payload. Reasons: (a) validation errors surface to the user immediately via HTTP 400; (b) the pipeline stays a pure compute service with no filesystem config; (c) matches the existing pattern where run config is constructed in the API route.

### C2. Stage-1 filter uses Voyage AI embeddings

**Model:** `voyage-3.5-lite`. **Dimensions:** 512 (Matryoshka-configurable; 512 is cheap and fast with strong NDCG@10). **Env var:** `VOYAGE_API_KEY`, validated at pipeline boot alongside `ANTHROPIC_API_KEY`. **Integration:** a ~30-line fetch wrapper at `packages/pipeline/src/services/embeddings.ts` calling `POST https://api.voyageai.com/v1/embeddings` — no SDK dependency.

**Why Voyage:**
- **Free tier is effectively unlimited at this scale.** 200M lifetime tokens per account (not monthly). A run embeds ~100 titles × 15 tokens + ~10 topics × 5 tokens ≈ 2K tokens. At 2 runs/day × 365 days ≈ 1.5M tokens/year → the free tier lasts 130+ years.
- **Best-in-class retrieval quality at the free/cheap tier.** voyage-3.5-lite outperforms OpenAI `text-embedding-3-large` by 6.34% on NDCG@10, at $0.02/1M after the free tier.
- **Anthropic's official embedding partner.** Natural pairing with the claude-model-switch branch.
- **Zero new npm dependencies** — single REST endpoint.

**Embedding target:** candidate `title` only. Keeps per-run embedding cost bounded and avoids needing body text during stage-1 (body is only loaded after shortlisting).

**Scoring formula:**
```
relevance = max(cos(title, topic)) − α × max(cos(title, antiTopic))   // α = 0.5 default
recency   = exp(−ageHours / halfLifeHours)                              // halfLifeHours = 48 default
score     = relevance × recency
```

Topic embeddings are computed once per run, not per candidate. Anti-topics are scored as a negative contribution, never hard-filtered (the "cryptographic signing" vs "crypto" case).

### C3. Body loading is inline in the rank stage, not a separate pipeline stage

Verification against `packages/pipeline/src/services/candidate-loader.ts` confirmed the loader already runs a `SELECT` over `raw_items` for every candidate — it just omits the `content` and `metadata` columns. Adding them is a one-line change and gives us body and comments for free on blog items, HN self-posts, and Reddit self-posts.

**Only real fetch work:** HN and Reddit link posts where `content IS NULL`. For those — and only those, only for the ~20 shortlisted items — `rank.ts` calls the shared `fetchMarkdown(url)` helper with `p-limit` concurrency (default 3) and a per-item timeout (default 15s). Failures leave the body `null`, the item is ranked title-only, and a WARN is logged. The run does not fail.

**No new pipeline stage, no new intermediate type.** A dedicated `enrich` stage would be pure ceremony — for blog-only runs it'd have zero work to do. Instead, `Candidate` in `candidate-loader.ts` gains `content: string \| null` and `comments: RawItemComment[]`, and `rank.ts` gains a small `loadBodies(shortlist)` helper for the link-post case.

**Helper relocation:** `fetchMarkdown` and its constants move from `packages/pipeline/src/collectors/web.ts` to `packages/pipeline/src/services/markdown-fetch.ts`, re-imported by the web collector. Avoids the rank stage cross-importing from a collector.

### C4. Recency applies in both stages

- **Stage-1:** `score = relevance × exp(−ageHours / halfLifeHours)`, `halfLifeHours` default 48, configurable per-run. Items with `publishedAt === null` are treated as 24h old (middle value — neither dominate nor get buried).
- **Stage-2:** each item is presented to Claude with `publishedAt` and a human-readable age ("4h ago", "2d ago"). Recency is an explicit tiebreaker within score bands, not a separate axis.
- **After the Claude call:** the returned LLM score is multiplied by `recencyDecay(ageHours)` one more time, deterministically. This floors the final score on recency even if Claude ignores the tiebreak rule.

### C5. Relevance is the gating axis of a four-axis rubric

When a profile is present, the rubric becomes four axes: **Relevance**, Novelty, Signal-vs-hype, Actionability. Relevance is *gating* — a very low Relevance score caps the overall score regardless of the other axes. This preserves the 2026-04-08 engagement-neutrality rework (three existing axes untouched) while anchoring scores on "is this what the user asked for."

When the profile is null (F9), the prompt reverts to the three-axis topic-agnostic rubric. Post-LLM recency decay still applies.

### C6. Multi-user shape today = file-based profiles

`profiles/*.yaml` at repo root, one file per user. The `/run` form gets a profile dropdown populated from a new `GET /api/profiles` endpoint. The submission payload adds `profileName: string | null`. No DB schema change. When real auth lands later, profiles move to a `user_profiles` Postgres table.

## Pipeline

```
collect  →  dedup  →  shortlist (NEW)  →  rank (REWORKED, inline body loading)  →  persist
```

### Data shapes (in `@newsletter/shared`)

```ts
interface UserProfile {
  name: string
  topics: string[]           // ≥1 required
  antiTopics?: string[]      // optional
}

// Extend the existing Candidate (candidate-loader) and RankCandidate with:
interface CandidateExtensions {
  content: string | null                // from raw_items.content via SELECT
  comments: RawItemComment[]             // from raw_items.metadata.comments via SELECT
}

// RankedItemRef stays unchanged on the wire:
interface RankedItemRef {
  rawItemId: number
  score: number
  rationale: string
}
```

### shortlist stage (stage-1)

- **Input:** up to 100 candidates (already loaded with `content`, `comments` from the extended SELECT) + `UserProfile | null` + `halfLifeHours`.
- **If profile is null:** skip embeddings; score = `recencyDecay(ageHours)`; forward top K by recency.
- **If profile is non-null:** embed each profile topic + antiTopic once via Voyage (one batched call). Embed candidate titles (one batched call). Compute the scoring formula from C2 per candidate.
- **Output:** top K candidates (K=20 default, configurable) ordered by `(score DESC, rawItemId ASC)`. Per-candidate breakdown logged at DEBUG.
- **Does not read:** `candidate.engagement.points` or `candidate.engagement.commentCount` — preserves the 2026-04-08 engagement-neutrality decision.

### rank stage (stage-2)

- **Input:** shortlist (≤20 items) + profile + `halfLifeHours`.
- **Body loading (inline input prep):**
  - For each item with `content !== null`: use as body directly.
  - For each item with `content === null`: call `fetchMarkdown(url)` via `services/markdown-fetch.ts` with `p-limit` concurrency (default 3) and per-item timeout (default 15s).
  - Failures leave `body: null`; WARN logged with URL and reason; item is ranked title-only.
- **Comment reading:** `candidate.comments` read directly; empty arrays (blog items) are expected and must not trigger any penalty.
- **Prompt composition:** single Claude call with:
  - System: four-axis rubric (Relevance gating) + profile topics/antiTopics + the verbatim source-neutrality rule: `"Blog posts have no comments by source design. Do not penalize items that lack discussion. Use comments as extra context when present, never as a scoring requirement."`
  - For each item: `id`, `title`, `url`, `sourceType`, `publishedAt`, human-readable age, stage-1 score, body (truncated to 2000 tokens), top 5 comments (each truncated to 200 tokens).
  - Temperature 0.
- **Structured output:** `{ranked: [{id, score, rationale}]}`. Each rationale must name the driving axis.
- **Post-LLM adjustment:** `finalScore = llmScore × recencyDecay(ageHours)`. Deterministic, applied before persisting.

### API & UI touchpoints

- `GET /api/profiles` → `{profiles: string[]}` listing YAML file stems from `profiles/`.
- `POST /api/runs` gains optional `profileName: string | null`. Profile loaded + validated at submission; parsed object injected into job payload.
- `/run` form gains a profile dropdown populated from `/api/profiles`, plus a "No profile" option.
- `GET /api/runs/:runId` response shape is unchanged.

## Open Questions (deliberately deferred, tunable after first runs)

1. **Shortlist size K.** 20 is a guess. Log the score distribution and tune empirically.
2. **Anti-topic weight α.** 0.5 starting point.
3. **Recency half-life.** 48h starting point; 24h if users complain about staleness, 72h if the pool is thin.
4. **Body token budget.** 2000 tokens/item starting point; Claude Haiku has plenty of context headroom.
5. **Comments token budget.** Top 5 × 200 tokens starting point.
6. **Thin-shortlist threshold.** Below what combined score should we warn "your profile is too narrow"? Needs empirical data.
7. **Gating vs. blending for Relevance.** First iteration uses the gating rule; blend-instead-of-gate is a two-line change if real runs show it over-penalizes.
8. **Feedback loop.** Explicitly deferred. When it lands, use the review-accept/reject step as implicit signal.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Voyage rate limits or outage | Low | Medium | Topic embeddings computed once per run; batched candidate embeddings (one call); embedding failure fails the run loudly, not silently |
| Link-post fetch blocked (paywall, bot detection) | Low–Medium | Medium | Blog items already have body in DB (immune). Jina handles most paywalls. Fallback: title-only ranking, WARN logged |
| Recency decay wrong for the content mix | Medium | Low | `halfLifeHours` is a per-run knob; retune without redeploying |
| Thin or over-broad profile produces bad shortlist | High | Medium | Log score distribution; warn on thin shortlist; document profile-writing guidance |
| Claude implicitly penalizes blog items for lacking comments | Medium | Medium | Explicit source-neutrality rule in prompt (tested via exact-string assertion); golden-set regression test checking blog vs HN scores stay within ±5 points |
| Inline body fetch exceeds 60s latency budget | Medium | Medium | Per-item timeout 15s; `p-limit` concurrency 3; failures fall back to title-only |
| Multi-user collision (parallel runs cross profiles) | Low | High | Profile loaded per-run into the job payload; never shared mutable state |
| Gating rule over-penalizes legitimate serendipity | Medium | Medium | Revisit after first week of real runs; blend instead of gate is a small change |

## Assumptions

1. Users will hand-author their profiles and iterate on them.
2. Voyage free-tier tokens (200M lifetime per account) are effectively unlimited at this scale.
3. Link-post fetch hit rate on HN/Reddit will be ≥60% via Jina; worse than that triggers follow-up work on a headless fallback.
4. Claude Haiku 4.5 context window is comfortable for 20 items × (body + comments + rubric + profile) — well within 200K.
5. The existing `RankedItemRef` wire shape is sufficient; per-axis scores are a future UI enhancement.
6. Review/approval flow is not yet in place, so implicit feedback learning is explicitly out of scope.

---

## Next Stage

Implementation planning via `harness:planning`. The resulting plan phases map to REQ IDs in `docs/plans/personalized-ranking/SPEC.md`. Implementation runs in `.worktrees/personalized-ranking` branched from `feat/claude-model-switch`; the final PR targets that branch.
