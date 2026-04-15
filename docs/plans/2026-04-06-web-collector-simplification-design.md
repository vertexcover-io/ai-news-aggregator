# Web Collector Simplification Design

## Problem Statement

The web collector is split across 3 files (web.ts, web-auto.ts, web-selectors.ts) + selector-cache.ts, while other collectors (HN, Reddit) are single files. The current design scrapes index pages to discover articles, caches selectors, and has complex retry logic. The new scope is simpler: given a list of blog post URLs, extract content using Gemini-derived selectors + Cheerio, and store.

## Key Decisions

- **Gemini derives selectors, Cheerio extracts** — keeps LLM calls cheap, extraction deterministic
- **List of URLs** — config takes an array, processes sequentially with delay
- **Single collector** — replace both `web-collect` and `web-auto-collect` with one `web-collect`
- **Skip on failure** — if extraction fails for a URL, log and continue to the next
- **Helper in top-level `llm.ts`** — Gemini client + selector extraction in `src/llm.ts` (reusable by future summarization/ranking)
- **Job name: `web-collect`** — single job name, remove `web-auto-collect`

## Files to Delete

- `src/collectors/web-auto.ts`
- `src/collectors/web-selectors.ts`
- `src/collectors/selector-cache.ts`
- `src/collectors/web.ts` (replaced entirely)
- Test files: `web-auto.test.ts`, `web-selectors.test.ts`, `web.test.ts`
- Fixture: `web-index.html`

## New File Structure

```
src/
  llm.ts              — GeminiClient interface, createGeminiClient(), truncateHtml(), extractArticleSelectors()
  collectors/
    web.ts            — collectWeb() — single collector, list of URLs
```

## New Types (in `src/types.ts`)

```typescript
export interface WebCollectConfig {
  urls: string[];
  sourceType: "blog" | "rss";
}

export interface WebCollectJobData {
  config: WebCollectConfig;
}
```

Remove: `WebSourceSelectors`, `WebSourceConfig`, `WebAutoSourceConfig`, `WebAutoCollectConfig`, `WebAutoCollectJobData`.

## Data Flow (per URL)

1. Fetch HTML with retry (`fetchWithRetry`)
2. Truncate HTML, send to Gemini -> get CSS selectors for title/content/author/date
3. Cheerio evaluates selectors against full HTML -> extract text
4. Build `RawItemInsert` — externalId = URL pathname, url = URL, sourceUrl = URL
5. Upsert via `rawItemsRepo`
6. If extraction fails at any step, log warning, skip to next URL

## Worker Changes

- Remove `web-auto-collect` case
- `web-collect` case creates `GeminiClient` from `src/llm.ts` and passes it as dep
- No more `SelectorCache` dependency

## LLM Module (`src/llm.ts`)

- `GeminiClient` interface + `createGeminiClient(apiKey)` factory
- `truncateHtml(html, maxLength)` — strips scripts/styles, truncates
- `extractArticleSelectors(html, client)` — sends to Gemini, parses/validates JSON response
- Returns `{ title: string, content: string, author?: string, date?: string }`

## Edge Cases

- URL fetch fails: retry with backoff, then skip
- Gemini returns empty/bad selectors: skip URL, log warning
- Cheerio finds no title: skip URL, log warning
- Duplicate URLs in config: upsertItems handles dedup via unique constraint
- Malformed URL: throws from new URL(), caught by try/catch in URL loop
