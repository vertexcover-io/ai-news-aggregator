# @newsletter/pipeline

BullMQ workers that collect, process, and prepare newsletter items.

## Responsibilities
- Collectors fetch from external sources (HN, Reddit, Web/blog)
- `web-collect` accepts a list of blog post URLs, uses Gemini 2.5 Flash Lite to derive CSS selectors per page, and extracts content via Cheerio
- Workers dispatch jobs to collectors based on job name
- Repository modules handle DB access (via @newsletter/shared schema)

## Key Dependencies
- `cheerio` — HTML parsing and CSS selector evaluation for web collector
- `@google/genai` — Gemini SDK for LLM-based selector extraction

## Web Collector Architecture
- `src/llm.ts` — GeminiClient interface, createGeminiClient(), truncateHtml(), extractArticleSelectors()
- `src/collectors/web.ts` — collectWeb() accepts URL list, calls llm.ts per URL for selectors, extracts via Cheerio
- No selector caching — each URL gets fresh selector extraction

## Rules
- No HTTP framework — this is a standalone Node process
- Workers call plain collector functions — no business logic in workers
- Use `createRawItemsRepo(db)` for DB access, not raw `db.insert()`
- Jobs must be idempotent — safe to retry
- Use `@pipeline/*` path aliases, never relative imports
- Web collector types (`WebCollectConfig`, etc.) are defined in `src/types.ts`, not in shared

## Path Aliases
- `@pipeline/*` → `src/*` (configured in tsconfig.json, tsup.config.ts, vitest.config.ts)
- `@pipeline-tests/*` → `tests/*` (vitest.config.ts only)

## Commands
pnpm dev          # Start with tsx watch
pnpm build        # Build with tsup
pnpm typecheck    # Type check
pnpm test:unit    # Run unit tests
pnpm test:e2e     # Run e2e tests (requires DB + Redis)
