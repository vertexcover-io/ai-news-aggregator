---
governs: packages/pipeline/src/services/web-fetch/
last_verified_sha: 5a2ff20
key_files: [index.ts, types.ts, convert.ts, fetch-adaptive.ts, fetch-static.ts, fetch-browser.ts, published-date.ts, proxy.ts]
flow_fns: [fetch-adaptive.ts::fetchAdaptive, convert.ts::convert, proxy.ts::resolveWebProxyUrl]
decisions: [D-090, D-080]
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
- `resolveWebProxyUrl(env?)` → `string | null` — returns the trimmed `WEB_HTTP_PROXY` value for a valid http(s) URL; `null` (fail-open, direct egress) for unset/empty/whitespace/malformed/non-http(s). Never logs the value (D-080)

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

### resolveWebProxyUrl(env?) → string | null
  env.WEB_HTTP_PROXY → trim
    ├─ falsy (unset / "" / whitespace) → null  (direct egress)
    ├─ new URL throws → warn{event:"web_proxy.malformed",reason:"unparseable"} → null  (fail-open)
    ├─ protocol not http(s) → warn{reason:"non-http-protocol"} → null  (fail-open)
    └─ valid http(s) → return trimmed raw value  (D-080)
  (consumed by fetchStatic [undici ProxyAgent dispatcher], fetchBrowser [chromium proxy], runWebCrawl [ProxyConfiguration]; warn branches log only event+reason, never the secret value)

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
- **`WEB_HTTP_PROXY` is a secret — never log it**: `resolveWebProxyUrl`'s two `warn` branches log only `{event, reason}`, never the value. No log/throw in `fetch-static.ts`, `fetch-browser.ts`, or `web-crawler.ts` interpolates the resolved proxy URL, and `crawler.stats` emits no proxy field. (D-080)
- **Injected `fetchFn` owns transport**: `fetchStatic` resolves the proxy ONLY on the default-`globalThis.fetch` path (`usingDefaultFetch = opts.fetchFn === undefined`). An injected `fetchFn` (test stub or caller-supplied transport) gets no `dispatcher` — the proxy never overrides it. The abort short-circuit runs before the dispatcher is built, so abort still works with the proxy attached. (D-080)
- **undici is a phantom-transitive dep**: `undici` was present in the pnpm store (pulled by crawlee/playwright) but NOT importable from pipeline under pnpm's strict layout until declared. `proxy.ts` / `fetch-static.ts` `import { ProxyAgent } from "undici"` only resolves because `packages/pipeline/package.json` pins `"undici":"7.24.7"` explicitly. (D-080)

## Decisions
- **D-080**: `WEB_HTTP_PROXY` routes the web collector's outbound HTTP through a single static proxy across three transport seams — `fetchStatic` (undici `ProxyAgent` per-request `dispatcher`), `fetchBrowser` (Playwright `chromium.launch({proxy})`), and `runWebCrawl` (Crawlee `ProxyConfiguration({proxyUrls:[url]})`) — resolved once by the pure `resolveWebProxyUrl`. Why: the web crawler shares an egress IP that gets rate-limited/blocked; a proxy fixes it, mirroring the existing `REDDIT_HTTP_PROXY` convention. Unset/empty/malformed/non-http ⇒ `null` ⇒ direct egress (fail-open, zero behaviour change). The URL is a secret and is never logged. An injected `fetchFn` is never proxy-wrapped (caller owns transport). `undici@7.24.7` is pinned explicitly in `packages/pipeline/package.json` because it is only a phantom-transitive dep otherwise. Threaded through `.env`, `deployment/.env.prod.example` (commented placeholder), and `.github/workflows/deploy.yml` (optional secret + env block). Tradeoff: a separate proxy var per collector family (no single global proxy) keeps blast radius small and lets each collector opt in. Governs: `services/web-fetch/proxy.ts`, `services/web-fetch/fetch-static.ts`, `services/web-fetch/fetch-browser.ts`, `services/web-crawler.ts`, `packages/pipeline/package.json`, `deployment/.env.prod.example`, `.github/workflows/deploy.yml`.
- **D-090**: Static-first with health check + listing-link check for browser promotion. Why: static HTTP is faster and cheaper than Playwright. The `isHealthyResult` (textLength>=200) catches JS-only pages that return empty shells. The `hasListingPostLinks` catches Substack/blog listing pages that render text but no post anchors. Tradeoff: the dual check means some pages hit both paths (acceptable — the static attempt is cheap). Governs: `services/web-fetch/fetch-adaptive.ts`, `services/web-crawler.ts`.
