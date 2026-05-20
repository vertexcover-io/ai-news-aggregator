# Verification stubs (from Stage 1.5 probe)

These are the scenarios functional-verify must re-run live in Stage 5. They mirror what the probe already proved works.

## VS-0.1 — Tavily SDK live call (news topic, days, maxResults)

**Pre:** `TAVILY_API_KEY` present in env.

**Steps:**
1. Construct `tavily({ apiKey })`.
2. Call `client.search("agentic AI", { topic: "news", days: 7, maxResults: 5, includeImages: true, includeRawContent: false })`.

**Expected:**
- Returns within 10s.
- `res.results.length >= 1`.
- Each result has `title`, `url`, `content`, `score`, `publishedDate`.
- `publishedDate` parses as a valid Date.

## VS-0.2 — Multi-query collector roundtrip

**Pre:** `TAVILY_API_KEY` present; in-memory `rawItemsRepo` mock.

**Steps:**
1. Run `collectWebSearch(deps, { queries: [{ query: "agentic AI", sinceDays: 7, maxItems: 3 }, { query: "context engineering LLM", sinceDays: 14, maxItems: 3 }] })`.

**Expected:**
- `CollectorResult.itemsFetched >= 2` and `<= 6`.
- `unitResults` has 2 entries, one per query.
- All upserted items have `sourceType: "web_search"` and `metadata.provider: "tavily"`.

## VS-0.3 — URL dedup across queries

**Pre:** Provider mock that returns the same URL for two different queries.

**Steps:**
1. Run `collectWebSearch` with two queries, both producing `https://example.com/x`.

**Expected:**
- `itemsFetched: 2`, `itemsStored: 1` (URL dedup before upsert).
- The dedup keeps the result from the query with the higher `score`.

These three stubs become VS-0.1 / VS-0.2 / VS-0.3 in the spec.
