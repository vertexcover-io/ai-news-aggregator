# SPEC: Crawlee Web Collector (Replace Jina)

**Linear:** [VER-81](https://linear.app/vertexcover/issue/VER-81)
**Design doc:** `docs/plans/2026-04-29-crawlee-web-collector-design.md`
**Spec dir:** `docs/spec/crawlee-web-collector/`
**Date:** 2026-04-29

## Glossary

- **Adaptive crawler:** Crawlee's `AdaptivePlaywrightCrawler`, which tries plain HTTP first and transparently falls back to Playwright/Chromium when results are unhealthy.
- **Convert:** the pure function that turns raw HTML into clean markdown plus extracted metadata (title, byline, image).
- **Healthy result:** a `ConvertResult` with `textLength >= 200`. Anything below triggers automatic browser fallback.
- **Listing mode:** convert path used for blog index/landing pages — skips Readability, strips nav/script/style/footer/aside, runs Turndown over the body. Used by stage-1 discovery.
- **Article mode:** convert path used for individual posts — runs Mozilla Readability + Turndown. Used by stage-2 detail extraction and the single-post add-post flow.
- **CrawlJob:** one URL plus enough context (`{ kind, sourceName, postUrl?, mode }`) to route the result back to the right per-source bucket and identify failures.
- **Job (BullMQ):** a single newsletter run dispatched to the pipeline worker. Each Crawlee crawler is constructed and torn down within one BullMQ job.

## Functional Requirements (EARS format)

### REQ-01 — Drop Jina from the fetch path

WHEN the pipeline fetches markdown for any source page or post
THE SYSTEM SHALL NOT make any HTTP request to `r.jina.ai` or send any `JINA_API_KEY` header.

EDGE-01a: The file `packages/pipeline/src/services/markdown-fetch.ts` SHALL be deleted.
EDGE-01b: The `JINA_API_KEY` environment variable SHALL be removed from `.env.example`.
EDGE-01c: The `JINA_API_KEY` mention SHALL be removed from `CLAUDE.md`'s "required env vars" line.

### REQ-02 — Convert function (pure)

WHERE `mode === "article"`, the `convert(html, baseUrl, mode)` function SHALL:
- Parse the HTML with `jsdom`.
- Run `@mozilla/readability` `Readability(doc).parse()`.
- IF parse returns `null` THEN return `{ markdown: "", title: null, byline: null, imageUrl: <extracted>, textLength: 0 }`.
- ELSE convert `parsed.content` (HTML) to markdown via `turndown` with `turndown-plugin-gfm`. Set `title = parsed.title`, `byline = parsed.byline`, `textLength = parsed.textContent.length`.

WHERE `mode === "listing"`, the `convert(html, baseUrl, mode)` function SHALL:
- Parse the HTML with `jsdom`.
- Remove all `<script>`, `<style>`, `<nav>`, `<footer>`, `<aside>` elements from the document.
- Convert the remaining body HTML to markdown via `turndown` with `turndown-plugin-gfm`.
- Set `title = doc.title || null`, `byline = null`, `textLength = doc.body.textContent.length`.

ALWAYS, the function SHALL extract `imageUrl` from the **original** (pre-strip) DOM:
- Prefer `<meta property="og:image">` content.
- Then `<meta name="twitter:image">` or `<meta name="twitter:image:src">` content.
- Then `<link rel="icon">` or `<link rel="shortcut icon">` href.
- Resolve all candidates against `baseUrl` (and any `<base href>` tag).
- Skip `data:` URIs and non-http(s) URLs.
- Return `null` if none found.

EDGE-02a: The function MUST NOT perform any I/O (no `fetch`, no `readFileSync`, no Playwright calls).
EDGE-02b: The function MUST be synchronous OR return a resolved Promise — but it MUST NOT depend on AbortSignal.

### REQ-03 — Health check predicate

WHEN any caller (the static fetcher, the adaptive fetcher, or the Crawlee `resultChecker`) needs to decide "is this result usable?"
THE SYSTEM SHALL call `isHealthyResult(result)` which SHALL return `true` if and only if `result.textLength >= 200`.

EDGE-03a: The threshold `200` SHALL be a named constant exported from `convert.ts` (`HEALTHY_TEXT_LENGTH`) so it can be tuned in one place.

### REQ-04 — Static fetcher

WHEN `fetchStatic(url, mode, opts)` is invoked
THE SYSTEM SHALL:
1. Call `fetch(url, { signal: opts.signal })` (or the injected `opts.fetchFn`).
2. If response is not 2xx, throw `Error("HTTP <status> for <url>")`.
3. Otherwise, read the body as text and call `convert(body, url, mode)`. Return the `ConvertResult`.

EDGE-04a: If `opts.signal` is already aborted, throw immediately.
EDGE-04b: If `opts.signal` aborts mid-fetch, the rejected `fetch` error propagates unchanged.

### REQ-05 — Browser fetcher

WHEN `fetchBrowser(url, mode, opts)` is invoked
THE SYSTEM SHALL:
1. Launch `chromium` headless via `playwright`.
2. Open a new page, `page.goto(url, { timeout: 20_000, waitUntil: "load" })`.
3. Read `page.content()`.
4. Close the browser (always, even on error).
5. Call `convert(html, url, mode)` and return the `ConvertResult`.

EDGE-05a: If `opts.signal` aborts at any point, the browser SHALL be closed and the abort error propagates.
EDGE-05b: The browser SHALL be closed in a `finally` block — no leaked Chromium processes on error paths.

### REQ-06 — Adaptive single-page fetcher (single-post path)

WHEN `fetchAdaptive(url, mode, opts)` is invoked
THE SYSTEM SHALL:
1. Try `fetchStatic(url, mode, opts)`.
2. IF static path threw OR `isHealthyResult(staticResult)` is `false`, THEN call `fetchBrowser(url, mode, opts)` and return its result (regardless of health).
3. ELSE return the static result.

EDGE-06a: A network error from the static path SHALL trigger the browser fallback (not propagate).
EDGE-06b: An abort from `opts.signal` SHALL NOT trigger the browser fallback — abort propagates.
EDGE-06c: A browser-path failure SHALL propagate to the caller.

### REQ-07 — Public `fetchMarkdown` re-export (single-post path)

WHEN `fetchMarkdown(url, { mode, signal })` (re-exported from `services/web-fetch/index.ts`) is invoked
THE SYSTEM SHALL call `fetchAdaptive(url, mode, { signal })` and return `result.markdown` as a string.

EDGE-07a: The function signature SHALL be a strict superset of the deleted Jina `fetchMarkdown` for caller compatibility — except that `mode` is required.

### REQ-08 — Crawler wrapper exists with the contract from the design doc

WHEN `runWebCrawl(jobs, deps)` is invoked
THE SYSTEM SHALL:
1. Construct a new `AdaptivePlaywrightCrawler` configured with:
   - `maxConcurrency: deps.maxConcurrency ?? Number(process.env.WEB_CRAWLER_CONCURRENCY ?? 4)`
   - `maxRequestRetries: 3`
   - `requestHandlerTimeoutSecs: 20`
   - `sameDomainDelaySecs: 1`
   - `respectRobotsTxtFile: true`
   - `renderingTypeDetectionRatio: 0.1`
   - `resultChecker` that returns `isHealthyResult(...)` against the converter output stashed for the request
2. Run the crawler over `jobs.map(j => ({ url: j.url, userData: { kind, sourceName, postUrl?, mode } }))`.
3. Inside `requestHandler`, obtain HTML (from `body` for static path or `await page.content()` for browser path) and call `convert(html, request.loadedUrl, userData.mode)`. Stash the result + `renderedWith` (`"static"` | `"browser"`) for that URL.
4. Inside `failedRequestHandler`, record `{ ok: false, error: <truncated error message> }` for the failed URL.
5. Return `Map<url, CrawlResult>` — one entry per input job (success or failure).

EDGE-08a: The crawler SHALL be constructed **per call** to `runWebCrawl` (no module-level singleton).
EDGE-08b: After `crawler.run()` returns, the function SHALL log `crawler.stats` to the pipeline logger inside the existing `"collection completed"` log event.
EDGE-08c: When `deps.signal` aborts, the function SHALL call `crawler.teardown()` (fire-and-forget); the awaiting `crawler.run()` SHALL resolve naturally; remaining unfinished jobs SHALL be reported as `{ ok: false, error: "cancelled" }`.

### REQ-09 — No on-disk Crawlee state

WHEN the pipeline worker process boots (`packages/pipeline/src/index.ts`)
THE SYSTEM SHALL call `Configuration.getGlobalConfig().set('persistStorage', false)` BEFORE any code that could construct a Crawlee object runs.

EDGE-09a: After any pipeline test or run, no directory named `storage` SHALL exist anywhere under the worktree (verified by an e2e test).
EDGE-09b: The setting SHALL be applied even in test mode (handled via the same boot path or test setup).

### REQ-10 — Chromium presence assertion at boot

WHEN the pipeline worker process boots
THE SYSTEM SHALL verify that the Playwright Chromium binary is present (e.g. by calling `chromium.executablePath()` or attempting a quick launch).

IF the binary is missing, the worker SHALL exit 1 with a single-line error containing the substring `pnpm exec playwright install chromium`.

EDGE-10a: This check SHALL run after `Configuration.set('persistStorage', false)` and after dotenv but BEFORE the BullMQ worker subscribes to the queue.

### REQ-11 — `collectWeb` refactor (batch flow)

WHEN `collectWeb(deps, config)` is invoked
THE SYSTEM SHALL:
1. Build a list of listing-mode `CrawlJob`s, one per source.
2. Call `runWebCrawl(listingJobs, { signal: deps.signal })` — one crawler instance.
3. For each successful listing result, run `discoverPostUrls(listingUrl, result.markdown, llmModel)` (LLM, parallel across sources, NOT inside the crawler budget).
4. Apply existing post-processing: `validateDiscoveredUrls`, `sortPostsByPublishedAtDesc`, `applySinceDays`, max-items cap, dedupe against `rawItemsRepo.findExistingExternalIds(...)`.
5. Build a list of detail-mode `CrawlJob`s for all surviving post URLs across all sources.
6. Call `runWebCrawl(detailJobs, { signal: deps.signal })` — one crawler instance, distinct from the listing one.
7. For each successful detail result, run `extractPostFields(postUrl, result.markdown, llmModel)` (LLM, parallel, NOT inside the crawler budget) and call `buildRawItem(postUrl, result.markdown, mergedFields)` using `result.imageUrl` as the image fallback.
8. Aggregate `failures[]` from both `runWebCrawl` calls AND from LLM-stage exceptions, mapped to existing failure stages (`discovery-fetch`, `discovery-llm`, `discovery-empty`, `detail-fetch`, `detail-llm`, `validate`).
9. Call `rawItemsRepo.upsertItems(allItems)` once.
10. Return a `WebCollectorResult` with the same shape as today.

EDGE-11a: The redundant second `fetchFn(post.url)` HTTP call inside the old `processOnePost` (used only for OG image extraction) SHALL be removed — the image now comes from the converter result.
EDGE-11b: The `pLimit` import and `postConcurrency` config field SHALL be removed (Crawlee owns concurrency now).
EDGE-11c: If `config.sources.length > 0` AND every source's listing fetch failed, `collectWeb` SHALL throw `Error("all sources failed")` — preserves existing behavior.
EDGE-11d: `WebCollectorResult.failures` SHALL be `undefined` (not an empty array) when there are zero failures — preserves existing behavior.

### REQ-12 — `fetchWebPost` refactor (single-post path)

WHEN `fetchWebPost(url, deps)` is invoked
THE SYSTEM SHALL:
1. Call `fetchAdaptive(url, "article", { signal: deps.signal, fetchFn: deps.fetchFn })` directly — NOT through `runWebCrawl`.
2. Build a `RawItemInsert` using `result.markdown` as `content`, `result.title` (falling back to existing `extractTitle(markdown, url)` when `title` is null) as the title, and `result.imageUrl` as `imageUrl`.

EDGE-12a: All other fields (`sourceType`, `externalId`, `publishedAt: null`, `engagement`, `metadata`, etc.) SHALL preserve the existing values exactly.

### REQ-13 — Source schema unchanged

WHEN any consumer reads or writes a `BlogSource` value
THE SYSTEM SHALL find the same fields as before (no `renderMode`, no `forceBrowser`, no migrations).

### REQ-14 — `tsup` externals

WHEN the pipeline package is built via `pnpm --filter @newsletter/pipeline build`
THE SYSTEM SHALL externalize `playwright`, `crawlee`, `@mozilla/readability`, `jsdom`, `turndown` (and `turndown-plugin-gfm` if pulled in) — i.e. they SHALL NOT be inlined into the bundle.

EDGE-14a: A passing build verifies this; no separate test required, but the bundle output SHALL contain literal `import` lines for these packages (verified by a quick `grep` in the gate or by package.json `external` config inspection).

### REQ-15 — Documentation

WHEN a developer reads `README.md`
THE SYSTEM SHALL show a one-time setup step containing the literal string `pnpm exec playwright install chromium`.

WHEN a developer reads `CLAUDE.md`
THE SYSTEM SHALL NOT mention `JINA_API_KEY` and SHALL mention the new `web-fetch/` services module location.

WHEN a developer reads `packages/pipeline/CLAUDE.md`
THE SYSTEM SHALL describe the new `services/web-fetch/` and `services/web-crawler.ts` layout.

### REQ-16 — `.env.example`

WHEN a developer reads `.env.example`
THE SYSTEM SHALL NOT contain `JINA_API_KEY`.
THE SYSTEM SHALL contain `WEB_CRAWLER_CONCURRENCY=4` as an optional override (with comment).

### REQ-17 — Crawler stats logged

WHEN a `runWebCrawl` invocation completes (successfully or with failures)
THE SYSTEM SHALL log a structured log line at `info` level containing at minimum: `requestsFinished`, `requestsFailed`, `requestsRetries`, browser-vs-static handler run counts, and rendering-type misprediction count.

EDGE-17a: This log SHALL be visible in the existing `"collection completed"` log event emitted by `collectWeb`, OR as a sibling `"crawler stats"` event in the same run — either is acceptable so long as the values are queryable.

## Non-Functional Requirements

### REQ-NFR-01 — No regression in `raw_items.content` shape

WHEN `collectWeb` finishes a successful run
THE SYSTEM SHALL store `raw_items.content` as a markdown string compatible in shape with what Jina previously produced — meaning the LLM extraction prompts, the review UI, and the archive UI SHALL render the content without code changes.

(Verification: existing `extractPostFields` LLM prompt continues to work; spot-check via one e2e against a real fixture page.)

### REQ-NFR-02 — Per-host politeness

WHEN multiple URLs share the same host
THE SYSTEM SHALL space requests to that host by at least 1 second (Crawlee `sameDomainDelaySecs: 1`).

### REQ-NFR-03 — Robots respected

WHEN a source's robots.txt disallows the crawler
THE SYSTEM SHALL skip the request rather than fetching it (Crawlee `respectRobotsTxtFile: true`).

### REQ-NFR-04 — Unit tests fast and offline

ALL unit tests SHALL run without booting Chromium and without making any network call.
The single e2e test that boots a real `AdaptivePlaywrightCrawler` SHALL hit only an in-process http server serving fixture HTML.

## Acceptance Criteria

The work is **complete** when ALL of the following hold:

1. `pnpm typecheck` exits 0.
2. `pnpm lint` exits 0 (warnings allowed only at the baseline count of 5).
3. `pnpm test:unit` exits 0 (or exits 1 only because of the **pre-existing** eslint-plugin REQ-060 failure documented in baseline.json — net new failures = 0).
4. `pnpm --filter @newsletter/pipeline build` exits 0 and produces a bundle that does NOT inline `playwright`, `jsdom`, `crawlee`, `@mozilla/readability`, or `turndown`.
5. The file `packages/pipeline/src/services/markdown-fetch.ts` does not exist.
6. The file `packages/pipeline/src/collectors/web-image-fallback.ts` does not exist (logic folded into `convert.ts`).
7. The file `packages/pipeline/tests/unit/services/markdown-fetch.test.ts` does not exist.
8. New files exist: `packages/pipeline/src/services/web-fetch/{index,types,convert,fetch-static,fetch-browser,fetch-adaptive}.ts` and `packages/pipeline/src/services/web-crawler.ts`.
9. New unit tests exist for `convert.ts` (snapshot-style with at least 4 fixture HTMLs covering article/listing/og-image/twitter-image/favicon/null-readability cases), `fetch-static.ts`, `fetch-adaptive.ts`, and `web-crawler.ts` (behind the `runWebCrawl` interface, NOT against real Crawlee internals).
10. One e2e test exists that boots a real `AdaptivePlaywrightCrawler` against an in-process fixture HTTP server, confirming integration works AND no `./storage/` directory is created.
11. Existing `collectors/web.test.ts` is updated to mock at the `runWebCrawl` boundary (not at the old `fetchFn` boundary) and continues to cover partial-failure handling, dedupe, since-days, and max-items behavior.
12. After running the pipeline test suite, no directory named `storage` exists anywhere under the worktree.
13. `JINA_API_KEY` does not appear in `.env.example`, `CLAUDE.md`, or any source/test file (other than git history).
14. `README.md` includes the literal string `pnpm exec playwright install chromium`.
15. `WEB_CRAWLER_CONCURRENCY` is documented in `.env.example` with an example value of `4`.
16. The pipeline `package.json` lists exact-pinned versions of `crawlee`, `playwright`, `@mozilla/readability`, `jsdom`, `turndown`, `turndown-plugin-gfm` (and `@types/turndown` in devDependencies).
17. `packages/pipeline/tsup.config.ts` lists the heavy/native deps in `external`.
18. `packages/pipeline/CLAUDE.md` and root `CLAUDE.md` reflect the new module layout (no stale `services/markdown-fetch.ts` references; no `JINA_API_KEY` in required env vars).

## Out of Scope (verification: these MUST NOT change)

- `BlogSource`, `RawItemInsert`, `WebCollectorResult` type shapes.
- The `raw_items` DB schema or any migration.
- The review UI (`/admin/review/:runId`), the archive UI (`/archive/:runId`, `/`), or the email-delivery layer.
- LLM prompts (`discoverPostUrls`, `extractPostFields`, ranking/recap prompts), models, or providers.
- The HN, Reddit, and other non-web collectors.
- `compose.yml`.
- Containerization / Dockerfile.
- Adding `renderMode` or any per-source override field.

## Verification Matrix

| Requirement | Verification |
|---|---|
| REQ-01 | `grep -rin "jina" packages/ .env.example CLAUDE.md` returns nothing material |
| REQ-02 | `convert.test.ts` snapshot fixtures cover article + listing + null-readability paths |
| REQ-03 | `convert.test.ts` covers `isHealthyResult` boundary at 199 / 200 / 201 chars |
| REQ-04 | `fetch-static.test.ts` covers 200, 404, abort |
| REQ-05 | Covered by e2e (`fetch-browser.ts` is verified through the real crawler) |
| REQ-06 | `fetch-adaptive.test.ts` covers healthy-static, unhealthy-static→browser, abort, browser-failure |
| REQ-07 | `web-fetch/index.test.ts` covers `fetchMarkdown(url, { mode })` returning a string |
| REQ-08 | `web-crawler.test.ts` covers job→userData encoding, failure mapping, signal→teardown wiring |
| REQ-09 | e2e test asserts no `./storage/` directory created |
| REQ-10 | Boot smoke test asserts presence-check exists; manual: rename chromium binary, observe error |
| REQ-11 | Updated `collectors/web.test.ts` covers partial failures, dedupe, sinceDays, maxItems |
| REQ-12 | Updated `fetchWebPost` test covers article-mode adaptive call + RawItemInsert shape |
| REQ-13 | `BlogSource` type has no new fields (typecheck) |
| REQ-14 | Build smoke check on `dist/` |
| REQ-15, REQ-16 | Visual diff in PR review |
| REQ-17 | Manual log inspection during e2e or unit test that intercepts logger calls |
| REQ-NFR-01 | Spot-check during `/run` smoke test (manual, post-merge) |
| REQ-NFR-02, NFR-03 | Crawlee config object asserted in `web-crawler.test.ts` |
| REQ-NFR-04 | All unit tests run with `vitest run` in <30s without network/Chromium |
