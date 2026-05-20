# Library Probe — Tavily

<!-- LP:VERDICT:PASS -->

**Date:** 2026-05-20
**Probe location:** `.harness/web-search-collector/probes/`
**Live log:** `.harness/web-search-collector/probes/usage-shape.live.log`

## Selected library

`@tavily/core@0.7.3` (npm, official Tavily Node SDK).

## What the probe did

Made two live `client.search(query, options)` calls with `topic: "news"`:

1. `"agentic AI"`, `days: 7`, `maxResults: 5` → **5 results, 200 OK**
2. `"context engineering LLM"`, `days: 14`, `maxResults: 3` → **3 results, 200 OK**

Both calls succeeded with non-empty, well-formed responses.

## Verified contract (drop-in for the spec)

### Call site

```ts
import { tavily } from "@tavily/core";
const client = tavily({ apiKey: process.env.TAVILY_API_KEY });

const res = await client.search(query, {
  topic: "news",
  days: sinceDays,         // integer, inclusive lookback
  maxResults: maxItems,    // 1..20 (per Tavily docs; not enforced by SDK type)
  includeImages: true,     // returns top-level images[] for the query
  includeRawContent: false,
});
```

### Response shape (verified)

```ts
{
  query: string;
  responseTime: number;          // seconds, server-reported
  requestId: string;
  answer: string | null;
  images: Array<{ url: string }>;  // QUERY-LEVEL featured images, NOT per result
  results: Array<{
    title: string;
    url: string;
    content: string;             // short snippet (1–3 sentences, news topic)
    rawContent: string | null;   // null when includeRawContent: false
    score: number;               // relevance score 0..1
    publishedDate: string;       // ISO-8601, e.g. "2026-04-29T14:32:00Z"
    favicon: string;             // source-site favicon URL
  }>;
}
```

## Deltas from the original design doc

| Design doc said | Reality (probe) | Fix |
|---|---|---|
| `published_date` (snake_case) on each result | `publishedDate` (camelCase) — SDK normalises | Use `publishedDate` in the Tavily adapter |
| Per-result `images[0]` | Top-level `images[]` are query-level, NOT per-result. Per-article images come from `favicon` only at the API layer | Skip top-level `images`; rely on existing link-enrichment to extract per-article OG images (same pattern as Reddit/HN/Twitter) |
| `rawScore` direct from API | Available as `score` (0..1) | Map `result.score` → `WebSearchResult.rawScore` |

Spec will fold these into the type contract.

## Alternatives considered

None re-evaluated — the SDK works and matches the design intent. If `@tavily/core` had failed, the fallback chain (declared in `design.md`) was: raw `fetch` against `https://api.tavily.com/search`. Not needed.

## Verification stubs for Stage 5 (functional-verify will re-run these)

Saved to `docs/spec/web-search-collector/verification/verification-stubs.md` — Stage 1.7 will fold them into the spec's `## Verification Scenarios`.

## Risk callouts

- **Rate / credit limit**: free tier is ~1,000 credits/mo. A single search call = 1 credit. With 5 admin queries × 1 daily run = 150/mo. Headroom is fine for MVP.
- **`publishedDate` parsing**: probe sample returns ISO-8601 with timezone — our `new Date(...)` parse is safe. Spec will define behaviour when the field is missing (treat as `null`, accept the item, mark for ranking-decay penalty downstream like other dateless items).
- **`maxResults` cap**: Tavily docs say 20 max. UI input range will be 1..20; server-side zod will enforce.
- **No `news_search` SDK method**: Tavily's "news" mode is the same `search()` call with `topic: "news"`. No separate endpoint.

## Verdict

<!-- LP:VERDICT:PASS -->

Tavily SDK verified live. Selected library: `@tavily/core@0.7.3`. Proceed to spec generation with the corrected field names.
