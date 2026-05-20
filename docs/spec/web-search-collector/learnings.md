# Learnings — web-search-collector

## 1. Tavily SDK contract drift: `publishedDate` (camelCase) vs `published_date` (raw HTTP)

The `@tavily/core` JS SDK normalises Tavily's HTTP response fields to camelCase (`publishedDate`, `rawContent`, `responseTime`) while the underlying REST API uses snake_case (`published_date`, `raw_content`, `response_time`). The spec REQ-002 was written against the SDK shape (correct), but reviewers / future maintainers who skim the Tavily web docs (REST examples) will see snake_case and may "fix" the field name. The live probe at `.harness/web-search-collector/probes/probe.mjs` is the canonical reference and its log (`usage-shape.live.log`) shows the actual SDK keys.

**Generalisation:** when the spec depends on field names from a third-party SDK that wraps a REST API, always pin the **SDK field names** as the contract (not the REST docs) and link the live probe log next to the type definition.

## 2. Tavily `includeRawContent` vs `extract`: don't confuse the snippet pipeline

Tavily's `search` API can return either a short `content` snippet or a full-page `rawContent` when `includeRawContent: true`. The collector deliberately uses `includeRawContent: false` because:

1. Per-article scraping is the link-enrichment service's job (`fetchAdaptive` with Crawlee+Readability).
2. `rawContent` triples token cost on the Tavily side AND duplicates work.

A separate Tavily `/extract` endpoint exists for full-page extraction — also explicitly **not** used. This decision belongs in `design.md`; flagged here as a recurring confusion-point.

## 3. The pre-existing `web` source name almost collided with `web-search`

The project already has a `web` collector (the LLM URL-discovery + Crawlee scraper for company-blog firehoses). The new collector needed a distinct identifier. We chose `web_search` (snake_case for the DB constraint / source-type union) and `web-search` (kebab-case for the directory). The naming is unambiguous in code but **easy to confuse in prose** — the spec text repeatedly distinguishes "the existing `web` collector" from "the new `web-search` collector". Future readers of the README / sources list should keep these visually distinct.

## 4. ESLint `require-await` bites test mocks of async interfaces

`vi.fn<[I], Promise<O>>().mockImplementation(async (i) => ...)` is the natural pattern for mocking an async interface in vitest, but ESLint's `@typescript-eslint/require-await` rule flags the `async` since the body has no `await`. The project enables `require-await` and does **not** disable it for tests. Two acceptable resolutions:

1. Suppress with a top-of-file `/* eslint-disable @typescript-eslint/require-await */` (chosen here — small surface, no behaviour change).
2. Rewrite as `(i) => Promise.resolve(...)` (idiomatic but noisy).

If we hit this pattern in more tests, consider adding a per-folder override in `eslint.config.mjs` for `**/tests/**` rather than per-file suppressions.

## 5. Worktree-vs-shared-Redis can mask "pipeline picked up the job" bugs

During VS-0.7, the run sat in `queued` indefinitely because the pipeline worker running against the same Redis was from a **different worktree** (`feat-admin-pipeline-cost-analysis`) that didn't know about the new `web-search` source-type. The job was being picked up — but routed through code that ignored the new collector entirely. This is a generic worktree footgun: shared infra (Redis, Postgres) means any one stale worker can swallow jobs that should be processed by the current worktree's worker.

**Generalisation:** before functional verification, audit running workers (`ps aux | grep "src/index.ts"`) and ensure the one bound to the current worktree's `node_modules` is the only one consuming from the BullMQ queue, or kill the others.
