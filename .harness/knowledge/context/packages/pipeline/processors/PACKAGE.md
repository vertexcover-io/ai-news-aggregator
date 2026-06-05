---
governs: packages/pipeline/src/processors/
last_verified_sha: 5a2ff20
key_files: [dedup.ts, dedup-groups.ts, shortlist.ts, rank.ts, rank-prompts.ts, rank-body-loader.ts, recap.ts, digest-meta.ts]
flow_fns: [dedup.ts::dedupCandidates, shortlist.ts::shortlistCandidates, rank.ts::rankCandidates, rank-body-loader.ts::loadBodiesForShortlist, recap.ts::generateRecap, digest-meta.ts::generateDigestMeta]
decisions: [D-040, D-041, D-042]
status: active
---

# processors/ — pure stage functions for the newsletter pipeline

## Purpose
Each processor is a pure function that transforms data between pipeline stages. No side effects beyond the injected dependencies (LLM calls, DB reads via repo interfaces, cost tracking). Processors are called by the `run-process` worker in sequence: collect → dedup → shortlist → rank.

## Public surface
- `dedupCandidates(items)` → `T[]` — URL-canonical dedup; highest-engagement survivor wins
- `canonicalizeUrl(input)` → `string` — strips tracking params, hash, trailing slash, lowercases hostname
- `computeDedupGroups(items)` → `DedupGroupResult` — returns survivor IDs + dropped-to-winner mapping for UI
- `shortlistCandidates(candidates, options)` → `ShortlistResult` — stage-1 Claude Haiku LLM picks top-N by title
- `rankCandidates(shortlist, options)` → `RankResult` — stage-2 Claude Sonnet LLM rerank with recap content + digest meta
- `loadBodiesForShortlist(candidates, options)` → `Map<number, string | null>` — fetches article bodies for candidates missing content
- `generateRecap(item, options)` → `RecapContent` — standalone recap generation for a single add-post item
- `generateDigestMeta(items, options)` → `DigestMeta` — standalone digest headline/summary/hook/twitterSummary generation

## Depends on / used by
- Uses: `ai` / `@ai-sdk/anthropic`, `@pipeline/services/recency`, `@pipeline/services/cost-tracker`, `@pipeline/services/web-fetch`, `@newsletter/shared`
- Used by: `workers/run-process.ts`, `services/add-post-helper.ts`, `eval/index.ts`

## Data flows

### rankCandidates(shortlist, options) → RankResult
  shortlist → loadBodiesForShortlist (parallel fetch, 3 concurrency, 15s timeout)
    → buildPromptItems (age, body truncation @ 2000 token budget, top-5 comments @ 200 token budget)
      → generateObject(anthropic(modelId), systemPrompt, rankedResponseSchema)
        ├─ twitterSummary > 180 chars → retry with length instruction
        ├─ schema validation fails → throw with raw LLM text
        └─ ok → validate entries (drop unknown ids, drop empty titles)
                → apply recencyDecay to scores → sort by adjusted score → slice topN
                  → track cost (stage: "rank") → RankResult { rankedItems, digestHeadline, digestSummary, hook, twitterSummary }
  (rank prompt comes from user_settings.rankingPrompt, re-read per job)
  (recap voice block is RECAP_VOICE_BLOCK const, shared with recap.ts)

### shortlistCandidates(candidates, options) → ShortlistResult
  candidates → { id, title } only (body/engagement stripped)
    → generateObject(anthropic(modelId), systemPrompt, { ids: string[] })
      → filter unknown ids (LLM hallucination guard) → ShortlistResult
  ({{N}} in system prompt interpolated to shortlistSize)

### loadBodiesForShortlist(candidates, options) → Map<number, string | null>
  candidates → filter (skip if content already present)
    → pLimit(concurrency=3) → fetchMarkdown(url, "article") with 15s timeout
      ├─ ok  → Map.set(id, body)
      └─ err → Map.set(id, null), log warn
  (content already present from collector → skip fetch entirely)

## Gotchas / landmines
- **`inputTokens` includes cached for non-Anthropic**: If a future model swap introduces a non-Anthropic provider, the cost tracker's `extractUsage` must subtract `cachedInputTokens` from `inputTokens` before billing. Anthropic already reports cache-miss-only. (D-040)
- **Rank prompt is admin-editable**: `rankingPrompt` lives in `user_settings` and is re-read per job. The ranker no longer validates `rationale` against a hard-coded axis list — the Zod schema only requires non-empty string. (D-041)
- **Recap voice block is shared**: `RECAP_VOICE_BLOCK` in `rank-prompts.ts` is the editorial instructions reused by both `rank.ts` (inline recap during rerank) and `recap.ts` (standalone add-post recap). Changes affect both paths.
- **No per-item breakdowns from shortlist**: The shortlist stage no longer produces scored breakdowns (was removed to support admin-editable prompts). `ShortlistResult.breakdowns` is typed `never[]` for back-compat. (D-042)

## Decisions
- **D-040**: Provider-aware `extractUsage` dispatches by model prefix. Why: DeepSeek and Gemini SDKs report total `inputTokens` including cached; Anthropic reports cache-miss only. The extractor normalizes before billing. Tradeoff: new providers require adding a prefix branch. Governs: shared `cost.ts`.
- **D-041**: Drop rationale-axis validation from ranker. Why: the hard-coded axis list fought the admin-editable prompt feature — operators writing custom axis vocabulary would have every item dropped. Tradeoff: the ranker no longer enforces rationale quality beyond non-empty string. Governs: `processors/rank.ts`.
- **D-042**: Shortlist produces no per-item scoring. Why: the LLM shortlister picks top-N IDs by title — no engagement/scoring math. Tradeoff: the ranker can't use shortlist scores for tie-breaking (acceptable — recency decay dominates). Governs: `processors/shortlist.ts`.
