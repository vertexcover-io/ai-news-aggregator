# Verification Proof Report — web-search-collector

<!-- QG:VERDICT:PASS -->

**Spec:** [docs/spec/web-search-collector/spec.md](../spec.md)
**Date:** 2026-05-20
**Run-id for E2E:** `36a931c9-af82-4a11-813e-0f1601b94957`

## Scenario matrix

| Scenario | Status | Evidence |
|----------|--------|----------|
| VS-0.1 — Tavily SDK live call (probe re-run) | PASSED | `node .harness/web-search-collector/probes/probe.mjs` returned `ok: true`; both queries returned ≥1 result with keys `[title, url, content, rawContent, score, publishedDate, favicon]`. |
| VS-0.2 — Collector multi-query roundtrip | PASSED | `pnpm exec tsx .harness/web-search-collector/probes/collector-roundtrip.mjs` from the pipeline package returned `itemsFetched: 6, itemsStored: 6, unitResultsCount: 2`, all stored items had `sourceType === "web_search"` and `metadata.provider === "tavily"`. |
| VS-0.3 — URL dedup across queries | PASSED | Unit test `packages/pipeline/tests/unit/collectors/web-search.test.ts → "URL dedup across queries keeps higher rawScore"` passed under `pnpm --filter @newsletter/pipeline test:unit` (711/711 tests pass). |
| VS-0.4 — Missing API key | PASSED | Unit test `packages/pipeline/tests/unit/collectors/web-search/providers-factory.test.ts` (3 tests) passed; factory throws `Error("TAVILY_API_KEY is required for the tavily web-search provider")` when `tavilyApiKey` is undefined. |
| VS-0.5 — Settings round-trip (admin UI ↔ DB) | PASSED | `.harness/web-search-collector/e2e-report.json` from Phase 7: `executed: 1, passed: 1, failed: 0`. Scenario name: `"web-search settings round-trip"`. |
| VS-0.6 — Validation rejects bad input | PASSED | Live `PUT /api/settings` with `{ query: "", sinceDays: 0, maxItems: 999 }` returned HTTP 400 with zod issues on all three fields. Also covered by `packages/api/tests/unit/validate.test.ts` (458/458 API tests pass). |
| VS-0.7 — End-to-end pipeline run | PASSED | Settings updated to web-search-only via API. `POST /api/runs/now` -> run id `36a931c9…`. Polled to `status: completed`. Postgres: `select count(*) from raw_items where source_type='web_search'` = 10. `run_archives` row has `ranked_count = 5`. |

## Live commands run

1. **VS-0.1:** `node .harness/web-search-collector/probes/probe.mjs` -> `{"ok":true,"probes":[{"q":"agentic AI","count":5,...},{"q":"context engineering LLM","count":3,...}]}`
2. **VS-0.2:** `pnpm exec tsx .harness/web-search-collector/probes/collector-roundtrip.mjs` (from `packages/pipeline`) -> `pass: true`, 6 items stored, both unit results `completed`, all stored items `sourceType=web_search, provider=tavily`.
3. **VS-0.3 / VS-0.4:** `pnpm --filter @newsletter/pipeline test:unit` -> 711/711 pass.
4. **VS-0.5:** Phase 7 e2e (`.harness/web-search-collector/e2e-report.json`) -> 1/1 pass.
5. **VS-0.6:** `curl -X PUT /api/settings -d '{...queries:[{query:"",sinceDays:0,maxItems:999}]}'` -> 400 with zod issues on `query`, `sinceDays`, `maxItems`.
6. **VS-0.7:**
   - `curl -X POST /api/runs/now` -> `runId=36a931c9-af82-4a11-813e-0f1601b94957` (HTTP 202)
   - Polling -> reached `status: completed, stage: completed` at ~50s
   - `psql ... -c "select source_type, count(*) from raw_items where source_type='web_search'"` -> `web_search | 10`
   - `psql ... -c "select status, jsonb_array_length(ranked_items) from run_archives where id='36a931c9...'"` -> `completed | 5`

## Final verdict

**PASSED** — all seven verification scenarios completed with expected evidence. The Tavily-backed `web-search` collector is wired through settings, the run-process worker, the link-enrichment pipeline, dedup, and the two-stage ranker; produces archive-quality output indistinguishable from existing collectors.
