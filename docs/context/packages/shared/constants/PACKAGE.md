---
governs: packages/shared/src/constants/
last_verified_sha: 40c6b83
key_files: [index.ts, ranking-prompt.ts, shortlist-prompt.ts, social-post.ts, sources.ts, eval-ranking.ts]
flow_fns: [social-post.ts::buildLinkedinPostBody]
decisions: []
status: active
---

# constants/ — LLM prompts, UI labels, eval constants, and social-post formatting

## Purpose
Holds the canonical versions of LLM system prompts, source-type display labels, eval scoring parameters, and the LinkedIn post body assembler.

## Public surface
- DEFAULT_RANKING_PROMPT — rerank-stage LLM system prompt, composed with DIGEST_META_INSTRUCTIONS
- DIGEST_META_INSTRUCTIONS + digestSchema — standalone digest-field guidance
- DEFAULT_SHORTLIST_PROMPT — stage-1 shortlist prompt with {{N}} template placeholder
- buildLinkedinPostBody(hook, stories) → string — assembles LinkedIn post
- SOURCE_TYPE_SECTION_LABELS, SOURCE_TYPE_ORDER, TIER_RELEVANCE, EVAL_K, WINDOW_DEFAULT
- RUN_STATE_TTL_SECONDS, COST_TRACKING_LAUNCHED_AT, ENRICHED_SUMMARY_LAUNCHED_AT, MARKDOWN_EXCERPT_MAX
- Collector health (index.ts): HEALTH_CHECKABLE_COLLECTORS (`["hn","reddit","twitter","blog","web_search"]`, the canonical order), collectorHealthKey(c) → `"collector-health:<c>"` (Redis key), COLLECTOR_HEALTH_QUEUE_NAME = `"collector-health"` (the dedicated BullMQ queue, D-110), COLLECTOR_HEALTH_LEAD_MINUTES = 30 (auto-check fires this many minutes before pipelineTime)

## Data flows
buildLinkedinPostBody(hook, stories) → string:
  hook → trim() → empty? → DEFAULT_LINKEDIN_HOOK
  stories → iterate (max 5) → non-empty summary → prepend "→ " → join with \n\n → append footer

## Gotchas / landmines
1. Prompt constants must stay byte-identical with migration seeds. A drift test enforces this.
2. SHORTLIST_PROMPT uses {{N}} template placeholder — pipeline must substitute before sending.
