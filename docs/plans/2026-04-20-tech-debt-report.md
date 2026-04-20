# Tech Debt Report — 2026-04-20

Scope: full repo | Files scanned: 128 | GitHub parent issue: #75

## Findings

### HIGH: `collectReddit` cyclomatic complexity ~31
- **File:** `packages/pipeline/src/collectors/reddit.ts:359`
- **Rule:** high-cyclomatic-complexity
- **Detail:** The function handles subreddit iteration, per-item deduplication, comment fetching with rate limiting, and date-based `sinceDays` filtering — all in one ~90-line body with ~31 branches. Any change to one concern requires reasoning about the whole function.
- **Fix:** Decompose into three focused helpers: `collectSubreddit(fetchFn, subreddit, config)` → `RawItemInsert[]`, `enrichWithComments(items, fetchFn, signal, config)` → `void`, and `applyDateFilter(items, sinceDays)` → `RawItemInsert[]`. `collectReddit` becomes an orchestrator.

### HIGH: `fetchWithRetry` duplicated in HN and Reddit collectors
- **File:** `packages/pipeline/src/collectors/hn.ts:299` AND `packages/pipeline/src/collectors/reddit.ts:124`
- **Rule:** code-duplication
- **Detail:** Both implement identical exponential backoff (`Math.pow(2, attempt) * 1000`), the same non-retryable 4xx detection (`status >= 400 && status < 500 && status !== 429`), and the same `"Non-retryable"` prefix check. HN's version accepts a `parse` callback; Reddit's returns `unknown`. They will drift as collectors evolve.
- **Fix:** Extract `fetchWithRetry<T>(fetchFn, url, parse, retries)` into `packages/pipeline/src/lib/fetch-with-retry.ts` using HN's generic signature (Reddit passes identity parse). Both `MAX_RETRIES = 3` merge into one exported constant.

### MEDIUM: Unused `postgres` dependency in `@newsletter/api`
- **File:** `packages/api/package.json:26`
- **Rule:** unused-dependency
- **Detail:** `postgres: 3.4.7` is declared as a dependency but never imported anywhere in `packages/api/src/`. The API accesses the database through `@newsletter/shared`, which owns its own `postgres` dep.
- **Fix:** Remove `"postgres": "3.4.7"` from `packages/api/package.json` dependencies.

### MEDIUM: Unused `yaml` dependency in `@newsletter/api`
- **File:** `packages/api/package.json:27`
- **Rule:** unused-dependency
- **Detail:** `yaml: 2.8.3` is declared as a dependency but never imported anywhere in `packages/api/src/`. No YAML parsing or serialization exists in the API layer.
- **Fix:** Remove `"yaml": "2.8.3"` from `packages/api/package.json` dependencies.

### MEDIUM: `extractFallbackImage` cyclomatic complexity ~19
- **File:** `packages/pipeline/src/collectors/web.ts:48`
- **Rule:** high-cyclomatic-complexity
- **Detail:** Three separate loops (og:image meta, twitter:image meta, link[rel=icon]) each with nested attribute extraction and URL resolution, plus a base-tag override block. Correct but hard to extend or test each extraction path in isolation.
- **Fix:** Extract `extractMetaImage(html, effectiveBase)` (og:image + twitter:image loop) and `extractIconFallback(html, effectiveBase)` (link loop). `extractFallbackImage` becomes a three-line priority chain calling these helpers.

### LOW: `sinceDays` filtering duplicated in HN and Reddit collectors
- **File:** `packages/pipeline/src/collectors/reddit.ts:439` AND `packages/pipeline/src/collectors/hn.ts:256`
- **Rule:** code-duplication
- **Detail:** Identical cutoff calculation (`sinceDays * 86_400_000`) and drop-count logging pattern in both collectors. A change to filtering semantics (e.g. using a different date field) must be made in two places.
- **Fix:** Extract `filterBySinceDays(items: RawItemInsert[], sinceDays: number): RawItemInsert[]` into `packages/pipeline/src/lib/date-filter.ts`. Both collectors import and call it.
