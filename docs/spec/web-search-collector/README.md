# Web-Search Collector

**Status:** ready-to-merge
**Verification verdict:** **PASS** — see [verification/proof-report.md](./verification/proof-report.md)
**Quality gate:** **PASS** — typecheck, lint, build, and 1,689 unit tests all green vs baseline
**PR:** [#169](https://github.com/vertexcover-io/ai-news-aggregator/pull/169)

A pluggable web-search collector that surfaces niche AI news (agentic AI, context engineering, AI coding tooling, …) from the open web. Admins enter raw search queries through `/admin/settings`; each query runs through a `WebSearchProvider` (Tavily today, swappable to Brave/Exa later via the same interface) and the resulting articles feed into the existing dedup → enrichment → ranking → archive pipeline.

## What's in this folder

| File | What it is |
|------|------------|
| [design.md](./design.md) | High-level design, problem statement, fallback chain |
| [library-probe.md](./library-probe.md) | Live Tavily SDK probe results — selected `@tavily/core@0.7.3`, contract verified |
| [spec.md](./spec.md) | Requirements (REQ-001..010) + verification scenarios (VS-0.1..0.7) |
| [plan.md](./plan.md) | 7-phase implementation plan with phase graph |
| [verification/proof-report.md](./verification/proof-report.md) | Live execution evidence for every VS scenario |
| [verification/adversarial-findings.md](./verification/adversarial-findings.md) | Red-team attempts — 6/6 defended |
| [verification/verification-stubs.md](./verification/verification-stubs.md) | Probe-derived live scenarios folded into the spec |
| [learnings.md](./learnings.md) | What was surprising or non-obvious during this work |

## Provider used

`@tavily/core@0.7.3` with `topic: "news"`, configurable `days` (sinceDays) and `maxResults` (maxItems) per query. Env var: `TAVILY_API_KEY`. Free tier covers ~1,000 searches/month — plenty for a daily run with a handful of queries.

## What this PR adds

- New `web_search` source type and pluggable `WebSearchProvider` interface
- Tavily provider implementation behind that interface
- New collector at `packages/pipeline/src/collectors/web-search/` with per-query parallelism, URL dedup (keep higher-score copy), abort handling, and per-query failure isolation
- `user_settings.web_search_enabled` + `web_search_config` (jsonb) columns and migration `0025_futuristic_mariko_yashida.sql`
- Admin Settings UI card with a `useFieldArray` query editor (add / remove / edit)
- Server zod validation + client mirror
- Pipeline wiring through `run-process.ts`, `processing.ts`, and `services/runs.ts`
- 31 new unit tests + 1 Playwright e2e (settings round-trip)

## What this PR does NOT add (deliberately out of scope)

- Brave / Exa / Serper providers (the interface is ready — adding one is one new file plus a one-line factory union widen)
- Provider selector in the UI (locked to `"tavily"` via `z.literal`)
- Per-query analytics on the Run Archive page
- Tavily extract endpoint integration — content + image extraction goes through the project's existing `link-enrichment` service (Readability), matching every other collector

## How to verify locally

```bash
pnpm install
pnpm --filter @newsletter/shared db:migrate
TAVILY_API_KEY=tvly-... pnpm dev    # or run api + web separately
```

Then `/admin/settings`, enable Web Search, add a query, run it.
