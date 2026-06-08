---
governs: packages/pipeline/src/services/web-fetch/
last_verified_sha: ad0153a
key_files: [index.ts, types.ts, convert.ts, fetch-adaptive.ts, fetch-static.ts, fetch-browser.ts, published-date.ts]
flow_fns: [fetch-adaptive.ts::fetchAdaptive, convert.ts::convert]
decisions: [D-090]
status: active
---

# services/web-fetch/ — HTML→markdown conversion with static→browser fallback

## Purpose
Fetches a URL, extracts content via Readability, and converts to markdown via Turndown+GFM. Provides a static-HTTP-first-then-browser-fallback strategy (`fetchAdaptive`), with separate `fetchStatic` (HTTP + JSDOM) and `fetchBrowser` (Playwright via Crawlee) paths. Also extracts publish dates from DOM signals.

## Public surface
- `fetchAdaptive(url, mode, opts?)` → `ConvertResult` — static fetch first; falls back to browser if unhealthy result or error
- `fetchStatic(url, mode, opts?)` → `ConvertResult` — HTTP fetch + JSDOM + Readability + Turndown
- `fetchBrowser(url, mode, opts?)` → `ConvertResult` — Playwright browser fetch + Readability + Turndown
- `fetchMarkdown(url, opts)` → `string` — convenience: fetchAdaptive then return .markdown only
- `convert({ html, baseUrl, mode })` → `ConvertResult` — JSDOM + Readability + Turndown pipeline (shared by static + browser paths)
- `isHealthyResult(result)` → `boolean` — textLength >= 200
- `hasListingPostLinks(markdown)` → `boolean` — checks listing page markdown has link anchors
- `extractPublishedAt(doc)` → `Date | null` — extract publish date from DOM: JSON-LD > meta > time element

## Depends on / used by
- Uses: `jsdom`, `@mozilla/readability`, `turndown`, `turndown-plugin-gfm`, `playwright`, `crawlee`
- Used by: `services/link-enrichment/fetcher.ts`, `services/web-crawler.ts`, `processors/rank-body-loader.ts`, `collectors/web.ts`

## Data flows

### fetchAdaptive(url, mode, opts?) → ConvertResult
  url → fetchStatic(url, mode, opts)
    ├─ ok + isHealthyResult → return (static path, no browser)
    ├─ signal aborted → re-throw (propagate cancellation)
    └─ unhealthy / error → fetchBrowser(url, mode, { signal })
        → return ConvertResult (browser path)

### convert({ html, baseUrl, mode }) → ConvertResult
  html → JSDOM (silent virtual console)
    → extractPublishedAt(doc) [before Readability mutates DOM]
      → absolutizeUrls (resolve relative <a href> + <img src>)
        → Readability(doc).parse()
          ├─ Readability ok → Turndown(content) → markdown
          └─ Readability null → Turndown(body) → markdown
    → extractImageUrl (OG image > first content img > null)
      → ConvertResult { markdown, title, byline, imageUrl, textLength, publishedAt, structuredData }

## Gotchas / landmines
- **`fetchAdaptive` resultChecker depends on `hasListingPostLinks`**: When `mode="listing"` and the static result has no post link anchors, Crawlee's resultChecker returns false, forcing browser fallback. This catches JS-rendered shells (e.g. Substack landing pages) that clear the text-length bar but ship zero content in static HTML. (D-090)
- **Readability mutates the DOM**: `extractPublishedAt` must be called BEFORE Readability.parse() because Readability removes `<meta>` and `<time>` elements.
- **Crawlee Chromium path**: The web crawler passes `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` through `launchContext.launchOptions.executablePath` so Crawlee uses the apt-installed Chromium instead of downloading its bundled headless shell.

## Decisions
- **D-090**: Static-first with health check + listing-link check for browser promotion. Why: static HTTP is faster and cheaper than Playwright. The `isHealthyResult` (textLength>=200) catches JS-only pages that return empty shells. The `hasListingPostLinks` catches Substack/blog listing pages that render text but no post anchors. Tradeoff: the dual check means some pages hit both paths (acceptable — the static attempt is cheap). Governs: `services/web-fetch/fetch-adaptive.ts`, `services/web-crawler.ts`.
