# Design: Replace Jina with Crawlee for the web collector

**Linear:** [VER-81](https://linear.app/vertexcover/issue/VER-81)
**Date:** 2026-04-29
**Status:** Approved

## Context

The pipeline's web collector (`packages/pipeline/src/collectors/web.ts`) currently fetches every listing page and every article through **Jina Reader** (`r.jina.ai/<url>`) to receive clean markdown. The Jina-backed primitive lives in `packages/pipeline/src/services/markdown-fetch.ts` and is invoked from three call sites:

1. `processSource` → fetch the listing page → feed markdown to `discoverPostUrls` (LLM)
2. `processOnePost` → fetch the article → feed markdown to `extractPostFields` (LLM) → store as `raw_items.content`
3. `fetchWebPost` (single-post add-post flow) → one-off article fetch → store as `raw_items.content`

Operational pain points:

- **Jina rate-limits** us during full 34-source runs (102+ concurrent fetches: 34 sources × pLimit(3) posts).
- **Jina intermittently blocks** us with 4xx/5xx responses; we have no control over the failure surface.
- **JS-rendered sources** (Substack-shaped pages, lazy-rendered company blogs) come back as skeleton HTML or empty markdown; the downstream LLM extraction then produces empty/wrong fields.
- **Third-party in the hot path:** if Jina is down, the daily run is down.

## Goals

1. Eliminate Jina from the pipeline — no third-party API in the fetch path.
2. Render JS-heavy source pages correctly using a real browser, on demand only.
3. Preserve the existing `raw_items` shape, the LLM prompts, and the review/archive UX bit-for-bit.
4. Stay within the project's hard rules: stateless idempotent jobs, no `./storage/` scratch, repository pattern, no relative imports across packages, exact-pinned deps, `tsup` externals for native binaries.

## Non-goals

- Containerization / Dockerfile work for the pipeline (still runs as host process under podman-managed Postgres+Redis).
- Per-source override fields on `BlogSource` (`renderMode`, `forceBrowser`).
- Two-crawler parallelism (`CheerioCrawler` + adaptive split).
- Replacing Jina anywhere else (it has no other call sites).
- Proxy rotation, HTML caching, prompt changes, model changes, schema changes to `raw_items` / `BlogSource` / `WebCollectorResult`.

## High-Level Design

Replace `services/markdown-fetch.ts` with a new `services/web-fetch/` module owning a `fetchMarkdown(url, { mode, signal })` primitive, and a new `services/web-crawler.ts` wrapping Crawlee's `AdaptivePlaywrightCrawler` for the batch flow.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          packages/pipeline                                   │
│                                                                              │
│  collectors/web.ts                                                           │
│  ├── collectWeb (batch)        ──► services/web-crawler.ts                   │
│  │                                  └─ AdaptivePlaywrightCrawler            │
│  │                                       requestHandler ──► web-fetch/      │
│  │                                                          convert.ts      │
│  └── fetchWebPost (single)     ──► services/web-fetch/fetch-adaptive.ts     │
│                                     ├─ fetch-static.ts                       │
│                                     │   └─ fetch + jsdom + convert          │
│                                     └─ fetch-browser.ts                      │
│                                         └─ playwright + convert             │
│                                                                              │
│  services/web-fetch/                                                         │
│  ├── index.ts        public API: fetchMarkdown(url, opts)                    │
│  ├── types.ts        FetchMode, FetchResult, FetchOptions, ConvertResult    │
│  ├── convert.ts      html → Readability(article)/strip(listing)             │
│  │                   → Turndown → { markdown, title, byline, image }        │
│  │                   + isHealthyResult(r) predicate                         │
│  ├── fetch-static.ts plain fetch + jsdom + convert                          │
│  ├── fetch-browser.ts one-shot Playwright launch + convert                  │
│  └── fetch-adaptive.ts static-first; on unhealthy → browser fallback        │
│                                                                              │
│  services/web-crawler.ts                                                     │
│  └─ runWebCrawl(jobs, deps): Map<url, FetchResult>                          │
│     - new AdaptivePlaywrightCrawler per call (ephemeral)                     │
│     - resultChecker → isHealthyResult                                        │
│     - userData carries { kind: "listing"|"detail", sourceName, postUrl }    │
│     - signal → crawler.teardown()                                            │
│     - Configuration.set("persistStorage", false) at worker boot              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Decisions (locked from grill session)

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Drop Jina, drop `services/markdown-fetch.ts`, drop `JINA_API_KEY` | Rate limits, blocks, third-party dep |
| 2 | `AdaptivePlaywrightCrawler` for batch | Static-first, browser fallback built in |
| 3 | One ephemeral crawler **per BullMQ job** (per run) | Stateless workers; aligns with idempotent job rule |
| 4 | `@mozilla/readability` + `turndown` + `turndown-plugin-gfm` | Mature; mirrors Jina's output shape closely |
| 5 | `mode: "article" \| "listing"` parameter on `fetchMarkdown` | Listing pages skip Readability (it's article-only); strip nav/script/style/footer/aside before Turndown instead |
| 6 | One crawler per run; `maxConcurrency: 4` (env: `WEB_CRAWLER_CONCURRENCY`) | Browser tabs cost ~250 MB each — global budget needed |
| 7 | Cancel via `crawler.teardown()`; bounded by `requestHandlerTimeoutSecs: 20` | Crawler doesn't accept AbortSignal directly; teardown drains gracefully |
| 8 | Single-post path bypasses Crawlee — calls `fetch-adaptive.ts` directly | Add-post latency matters; queue/autoscaler overhead is wasted for one URL |
| 9 | `resultChecker` triggers built-in browser fallback when result is unhealthy | Crawlee handles JS fallback automatically — do not reimplement |
| 10 | Crawlee owns fetch retries (`maxRequestRetries: 3`); LLM retries unchanged | Don't double-retry; LLM is outside crawler |
| 11 | `requestHandlerTimeoutSecs: 20` | Bounds worst-case cancel |
| 12 | `sameDomainDelaySecs: 1` | Per-host politeness, built-in |
| 13 | `respectRobotsTxtFile: true` | Built-in; we're an internal newsletter, behave nicely |
| 14 | Default `FingerprintGenerator` (no UA override) | Whole point of using Crawlee over plain Playwright |
| 15 | `Configuration.getGlobalConfig().set('persistStorage', false)` at worker boot | No `./storage/` directory — stateless rule |
| 16 | Log `crawler.stats` into the existing `"collection completed"` log line | Built-in observability — don't reinvent |
| 17 | Stub `WebFetcher` boundary for unit tests; one e2e against local fixture HTTP server | Don't unit-test against real Crawlee/network |
| 18 | Single PR, no feature flag | Human review on `/admin/review/:runId` is the safety net |
| 19 | LLM cancel already wired via Vercel AI SDK signal — no change | Existing AbortController is reused |
| 20 | `BlogSource` schema unchanged — no `renderMode` field | `resultChecker` + auto browser fallback handles JS without per-source config |
| 21 | Delete `web-image-fallback.ts`; OG/Twitter/favicon extraction folds into `convert.ts` | Same DOM Readability is parsing — drop the redundant 2nd HTML fetch in `processOnePost` |

## Module Designs (deep modules; testable in isolation)

### `services/web-fetch/convert.ts` (deepest, purest)

Single export shape:

```ts
export interface ConvertInput {
  html: string;
  baseUrl: string;
  mode: "article" | "listing";
}
export interface ConvertResult {
  markdown: string;
  title: string | null;
  byline: string | null;        // Readability's byline (article only)
  imageUrl: string | null;      // OG/twitter/favicon
  textLength: number;           // for healthCheck
}
export function convert(input: ConvertInput): ConvertResult;
export function isHealthyResult(r: ConvertResult): boolean;  // textLength >= 200
```

Behavior:
- `mode: "article"`: parse via JSDOM, run `@mozilla/readability` `Readability(doc).parse()`. If `parse()` returns `null` → return `{ markdown: "", textLength: 0, ... }` (caller's healthCheck triggers fallback). Otherwise convert `parsed.content` (HTML) via Turndown (+ GFM plugin) to markdown. `title` from `parsed.title`; `byline` from `parsed.byline`.
- `mode: "listing"`: parse via JSDOM, remove `<script>`, `<style>`, `<nav>`, `<footer>`, `<aside>` nodes from the document, then Turndown the remaining body HTML. No Readability.
- Image extraction: scan the original DOM (not the Readability-cleaned tree) for `og:image`, `twitter:image`, `twitter:image:src`, then `<link rel="icon">` / `<link rel="shortcut icon">`, resolved against `baseUrl` and any `<base href>` tag. Skip `data:` URIs and non-http(s) URLs. (This is the existing `extractFallbackImage` logic from `web-image-fallback.ts`, preserved verbatim against the same DOM.)

**No I/O.** Pure function. Trivially fixture-testable.

### `services/web-fetch/fetch-static.ts`

```ts
export interface FetchStaticDeps { fetchFn?: typeof fetch; }
export function fetchStatic(
  url: string,
  mode: "article" | "listing",
  opts: { signal?: AbortSignal } & FetchStaticDeps,
): Promise<ConvertResult>;
```

- `fetch(url, { signal })` → if non-2xx, throw `Error("HTTP <status> for <url>")`.
- Pass body + url + mode to `convert()`. Return `ConvertResult`.

### `services/web-fetch/fetch-browser.ts`

```ts
export function fetchBrowser(
  url: string,
  mode: "article" | "listing",
  opts: { signal?: AbortSignal },
): Promise<ConvertResult>;
```

- One-shot launch: `chromium.launch({ headless: true })` → new context → new page → `page.goto(url, { timeout: 20_000, waitUntil: "load" })` → `page.content()` → `browser.close()`.
- Pass HTML + url + mode to `convert()`.
- Honor `signal` by closing the browser if aborted mid-flight.

### `services/web-fetch/fetch-adaptive.ts`

```ts
export function fetchAdaptive(
  url: string,
  mode: "article" | "listing",
  opts: { signal?: AbortSignal; fetchFn?: typeof fetch },
): Promise<ConvertResult>;
```

- Try `fetchStatic` first.
- If `isHealthyResult(result)` → return.
- Else (or on a thrown error from static path) → `fetchBrowser`. Return its result regardless of health.

### `services/web-fetch/index.ts`

```ts
export { convert, isHealthyResult } from "./convert.js";
export { fetchStatic } from "./fetch-static.js";
export { fetchBrowser } from "./fetch-browser.js";
export { fetchAdaptive } from "./fetch-adaptive.js";
export type { ConvertInput, ConvertResult, FetchMode } from "./types.js";

// Compatibility primitive used by fetchWebPost (single-post add-post flow):
// returns markdown only, mirrors the old fetchMarkdown(url) signature shape
// but with a required `mode`.
export function fetchMarkdown(
  url: string,
  opts: { mode: "article" | "listing"; signal?: AbortSignal },
): Promise<string>;
```

### `services/web-crawler.ts`

```ts
export type CrawlJob =
  | { kind: "listing"; sourceName: string; url: string }
  | { kind: "detail";  sourceName: string; postUrl: string; url: string };

export interface CrawlSuccess { ok: true;  result: ConvertResult; renderedWith: "static" | "browser"; }
export interface CrawlFailure { ok: false; error: string; }
export type CrawlResult = CrawlSuccess | CrawlFailure;

export interface RunWebCrawlDeps { signal?: AbortSignal; maxConcurrency?: number; }

export function runWebCrawl(
  jobs: CrawlJob[],
  deps?: RunWebCrawlDeps,
): Promise<Map<string /* url */, CrawlResult>>;
```

Behavior:
- `Configuration.getGlobalConfig().set('persistStorage', false)` set at worker boot in `src/index.ts` (not here — must run before any crawler is constructed).
- New `AdaptivePlaywrightCrawler` per call, configured with:
  - `maxConcurrency: deps.maxConcurrency ?? Number(process.env.WEB_CRAWLER_CONCURRENCY ?? 4)`
  - `maxRequestRetries: 3`
  - `requestHandlerTimeoutSecs: 20`
  - `sameDomainDelaySecs: 1`
  - `respectRobotsTxtFile: true`
  - `renderingTypeDetectionRatio: 0.1`
  - `resultChecker`: reads converter output stashed via `pushData()` and returns `isHealthyResult(...)`. Returning `false` triggers Crawlee's automatic browser retry.
  - `requestHandler`: reads `request.userData.mode` (derived from `kind`), gets HTML from the static body or the Playwright page (depending on which path Crawlee picked), calls `convert()`, and pushes `{ url, kind, sourceName, postUrl?, result, renderedWith }` to the dataset.
  - `failedRequestHandler`: reads `request.userData`, populates a per-job failure entry in the result map.
- Build URL→userData map → `crawler.run(jobs.map(j => ({ url: j.url, userData: { kind: j.kind, sourceName: j.sourceName, postUrl: j.postUrl, mode: j.kind === "listing" ? "listing" : "article" }})))`.
- If `signal` aborts during the run, fire `crawler.teardown()` (fire-and-forget); awaiting `crawler.run()` resolves; remaining unfinished jobs become `{ ok: false, error: "cancelled" }` entries in the result map.
- After `crawler.run()` returns, log `crawler.stats` (requests finished/failed/retried, browser-vs-static handler runs, mispredictions) to the pipeline logger at `info` level inside the `"collection completed"` event.
- Return `Map<url, CrawlResult>`.

### Updated `collectors/web.ts`

- `processSource` becomes "build a job plan" — it returns an array of `CrawlJob` (one listing + N detail URLs once the listing has been fetched and discovery LLM has run). Because discovery LLM depends on listing markdown, the existing two-phase shape inside `processSource` is preserved at a higher level:
  1. `collectWeb` collects all listing jobs from all sources, calls `runWebCrawl` once with just listings.
  2. For each successful listing, run `discoverPostUrls` (LLM, parallel across sources, no Crawlee budget).
  3. Build all detail jobs from all sources, dedupe against existing external IDs, call `runWebCrawl` once with all details.
  4. For each successful detail, run `extractPostFields` (LLM, parallel, no Crawlee budget) and `buildRawItem`.
  5. Collect `failures[]` from both `runWebCrawl` calls and from LLM stages.
  6. `repo.upsertItems(allItems)`.
- The redundant second `fetchFn(post.url)` call inside the old `processOnePost` is removed; the image already came back inside the converter result.
- `fetchWebPost(url, deps)` calls `fetchAdaptive(url, "article", { signal: deps.signal, fetchFn: deps.fetchFn })` and builds a `RawItemInsert` from the result. Title falls back to URL parsing when `result.title` is null (existing `extractTitle` helper preserved).

### Worker boot (`src/index.ts`)

Two additions before the existing dotenv + Redis bootstrap:

1. `Configuration.getGlobalConfig().set('persistStorage', false)` from `crawlee` — must run before any crawler is ever constructed.
2. Chromium presence assertion: `import { chromium } from "playwright"` and `await chromium.executablePath()` — on missing binary, Playwright throws; catch and re-throw with a clear message: `"Chromium not installed. Run: pnpm exec playwright install chromium"`. Process exits 1.

### `tsup.config.ts` (pipeline)

Add to `external`: `playwright`, `crawlee`, `@mozilla/readability`, `jsdom`, `turndown`. Per the existing `workspace-eslint-plugin-tsup-externals` learning — native binaries and heavy deps must not be inlined. The lint rule `no-bundled-readfilesync` already enforces no `readFileSync`-from-bundle patterns.

## Test Strategy

Per the project's testing rules (test external behavior, not implementation):

| Module | Test type | Fixtures |
|---|---|---|
| `convert.ts` | Unit, snapshot-style | `tests/fixtures/web/article-with-og.html`, `listing-blog-index.html`, `js-skeleton.html`, `article-twitter-image.html`, `article-favicon-only.html` |
| `fetch-static.ts` | Unit, mocked `fetch` | n/a |
| `fetch-adaptive.ts` | Unit, mocked static path | both branches: healthy → static, unhealthy → browser |
| `web-crawler.ts` | Tested behind the `runWebCrawl` interface (not against real Crawlee internals) | n/a |
| `collectWeb` (refactored) | Existing tests rewritten — mock at `runWebCrawl` boundary | n/a |
| `fetchWebPost` (refactored) | Existing tests rewritten — mock at `fetchAdaptive` boundary | n/a |
| One e2e | Real `AdaptivePlaywrightCrawler` against an in-process http server serving fixture HTML files | `tests/fixtures/web/server.ts` |

The deleted `tests/unit/services/markdown-fetch.test.ts` (5 tests) is replaced by tests under `tests/unit/services/web-fetch/`.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Wall-time regression (~30–60s slower per full run) | Acceptable for daily pipeline. `WEB_CRAWLER_CONCURRENCY` is the tuning knob. |
| Adaptive heuristic misclassifies a JS page as static and Readability returns *something* (not null) but it's wrong | `isHealthyResult` threshold (textLength >= 200) catches most. Crawlee's misprediction stat surfaces it; tighten threshold if needed. |
| Storage pollution if a future contributor forgets `persistStorage: false` | Worker boot enforces it before any crawler exists; tests assert no `./storage/` is written. |
| Chromium not installed → cryptic failure in middle of a job | Boot-time assertion in `src/index.ts` exits 1 with a clear message. |
| Cancel UX regression (instant → up to 20s) | Documented; bounded by `requestHandlerTimeoutSecs: 20`. |
| Single-post path drift from batch path on adaptive heuristic | Both call sites use the same `convert.ts` and same `isHealthyResult`. The adaptive logic differs (Crawlee's `RenderingTypePredictor` vs our simple "static-first try, browser fallback on unhealthy") but the *quality bar* is the same. |
| `tsup` inlining `playwright`/`jsdom` → broken native bindings at runtime | Externalized in `tsup.config.ts`; verified by build smoke test. |

## Operational

- New runtime deps on `@newsletter/pipeline`, exact-pinned per project rule:
  - `crawlee`
  - `playwright`
  - `@mozilla/readability`
  - `jsdom`
  - `turndown`
  - `turndown-plugin-gfm`
  - `@types/turndown` (devDep)
- `.env.example`: remove `JINA_API_KEY`, add `WEB_CRAWLER_CONCURRENCY=4` (optional override).
- `CLAUDE.md`: drop `JINA_API_KEY` from "required env vars"; rewrite the `services/markdown-fetch.ts` bullet.
- `packages/pipeline/CLAUDE.md`: rewrite the services layout bullet.
- `README.md`: add one-time setup step `pnpm exec playwright install chromium` (no `postinstall` hook — silent 450 MB download is hostile).
- `compose.yml`: unchanged (only Postgres + Redis live there).
- Containerization is out of scope; when added later, base image becomes `mcr.microsoft.com/playwright:v1.x-jammy`.
