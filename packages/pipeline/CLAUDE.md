# @newsletter/pipeline

BullMQ workers that collect, process, and prepare newsletter items.

## Responsibilities
- Collectors fetch from external sources (HN, Reddit, Web/blog/RSS)
- `web-collect` uses manually configured CSS selectors (via `WebSourceConfig.selectors`)
- `web-auto-collect` uses Gemini 2.5 Flash Lite to auto-derive CSS selectors from page HTML, with a file-based selector cache to avoid repeated LLM calls
- Workers dispatch jobs to collectors based on job name
- Repository modules handle DB access (via @newsletter/shared schema)

## Key Dependencies
- `cheerio` — HTML parsing and CSS selector evaluation for web collectors
- `@google/genai` — Gemini SDK for LLM-based selector extraction (`web-auto-collect`)

## Web Collector Architecture
- `web.ts` — manual web collector (`web-collect`); requires explicit CSS selectors in config
- `web-auto.ts` — auto web collector (`web-auto-collect`); derives selectors via Gemini LLM, caches results in a JSON file
- `web-selectors.ts` — Gemini client wrapper for extracting CSS selectors from HTML
- `selector-cache.ts` — file-based JSON cache for derived selectors; keyed by index URL
- Cache invalidation: if cached selectors produce 0 articles, the cache entry is cleared and selectors are re-derived once before skipping the source

## Rules
- No HTTP framework — this is a standalone Node process
- Workers call plain collector functions — no business logic in workers
- Use `createRawItemsRepo(db)` for DB access, not raw `db.insert()`
- Jobs must be idempotent — safe to retry
- Use `@pipeline/*` path aliases, never relative imports
- Web collector types (`WebSourceConfig`, `WebAutoSourceConfig`, etc.) are defined in `src/types.ts`, not in shared

## Path Aliases
- `@pipeline/*` → `src/*` (configured in tsconfig.json, tsup.config.ts, vitest.config.ts)
- `@pipeline-tests/*` → `tests/*` (vitest.config.ts only)

## Commands
pnpm dev          # Start with tsx watch
pnpm build        # Build with tsup
pnpm typecheck    # Type check
pnpm test:unit    # Run unit tests
pnpm test:e2e     # Run e2e tests (requires DB + Redis)
