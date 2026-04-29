# Verification Report — Crawlee Web Collector (VER-81)

**Date:** 2026-04-29
**Branch:** `aman/ver-81-crawlee-web-collector`
**Scope:** Verify the Crawlee replacement of Jina Reader works in a live application context, not just in unit tests.

## Summary

| ID | Type | Description | Verdict |
|----|------|-------------|---------|
| VS-1 | static | No Jina references in production code (REQ-01, REQ-13) | PASS |
| VS-2 | static | No `./storage/` directory created during unit tests (REQ-09) | PASS |
| VS-3 | static | Old files removed; new web-fetch + web-crawler files present (AC #5–8) | PASS |
| VS-4 | static | README, .env.example, package deps, tsup externals correct (AC #14–17) | PASS |
| VS-5 | static | typecheck + lint + build clean; bundle does not inline native deps (AC #1–4) | PASS |
| VS-6 | api | Live `POST /api/runs/now` exercises Crawlee end-to-end | PARTIAL — crawler verified, downstream LLM blocked by external billing |
| VS-7 | api | Convert emits absolute URLs (regression caught + fixed during verification) | PASS |
| VS-8 | api | Discovery LLM call status (recorded for transparency) | EXTERNAL BLOCKER (Anthropic API credit exhausted) |

**Verdict:** Crawlee replacement contract is verified. The single live-run path that could not be exercised end-to-end is blocked by an external billing condition unrelated to this PR — the same code path would fail identically under the previous Jina-based implementation.

## Infrastructure

- PostgreSQL + Redis: running via existing podman containers (shared from `mobile-friendly-frontend` worktree, both `Up 4 hours (healthy)`).
- Pipeline + API: started via `pnpm --filter ... dev`, killed on completion.
- Chromium: installed via `pnpm --filter @newsletter/pipeline exec playwright install chromium` (Playwright 1.52.0).

## Evidence

### VS-1 — No Jina references

```
$ grep -rin 'jina' packages/pipeline/src .env.example CLAUDE.md README.md packages/pipeline/CLAUDE.md
(no matches; exit 1 — PASS)
```
Full output: `verification/static/vs-1-no-jina.txt`.

A stale `JINA_API_KEY` reference was found and removed in `packages/pipeline/src/scripts/demo-web-collector.ts` during this verification step.

### VS-2 — No on-disk Crawlee storage

```
$ pnpm --filter @newsletter/pipeline test:unit
… 35 files / 392 tests pass …
$ find . -name storage -type d -not -path './node_modules/*'
(no results — PASS)
```
Full output: `verification/static/vs-2-no-storage.txt`.

### VS-3 — File layout

All three legacy files absent (`markdown-fetch.ts`, `web-image-fallback.ts`, `markdown-fetch.test.ts`). All seven new files present (`services/web-fetch/{index,types,convert,fetch-static,fetch-browser,fetch-adaptive}.ts` + `services/web-crawler.ts`).

Full output: `verification/static/vs-3-files.txt`.

### VS-4 — Docs and config strings

- `README.md` contains the literal `pnpm exec playwright install chromium` (1 occurrence, AC #14)
- `.env.example` contains `WEB_CRAWLER_CONCURRENCY=4` (AC #15)
- Pipeline `package.json` exact-pins `crawlee@3.13.3`, `playwright@1.52.0`, `@mozilla/readability@0.6.0`, `jsdom@26.0.0`, `turndown@7.2.0`, `turndown-plugin-gfm@1.0.2` (AC #16)
- `tsup.config.ts` lists `playwright`, `crawlee`, `@mozilla/readability`, `jsdom`, `turndown` in `external` (AC #17)

Full output: `verification/static/vs-4-docs-config.txt`.

### VS-5 — Quality gates and bundle externalization

- `pnpm typecheck` → exit 0
- `pnpm lint` → exit 0
- `pnpm --filter @newsletter/pipeline build` → success; `dist/index.js` is **39 502 bytes** and `dist/chunk-*.js` is **43 334 bytes** (would be multiple MB if Crawlee/Playwright/jsdom were inlined)
- Bundle externalization grep:
  - `playwright` → kept as `import { chromium } from "playwright";`
  - `crawlee` → kept as `import { Configuration } from "crawlee";`
  - `jsdom`, `@mozilla/readability`, `turndown` → kept in chunk as ESM imports

Full output: `verification/static/vs-5-quality.txt`.

### VS-6 — Live `POST /api/runs/now`

```
$ curl -s -X POST http://localhost:3000/api/admin/login -d '{"password":"<redacted>"}'
{"ok":true} (HTTP 200)

$ curl -s -X PUT http://localhost:3000/api/settings -d '{ webConfig: 2 sources, sinceDays: 30, maxItems: 3, ... }'
HTTP 200

$ curl -s -X POST http://localhost:3000/api/runs/now -d '{}'
{"runId":"72067a5c-7b8f-48c8-a571-3825dabc8e84"}

$ # poll: status transitions running → failed within ~7s
```

**Pipeline log evidence (REQ-17 — crawler.stats logged):**

```
{"name":"crawler:web","event":"crawler.stats",
 "jobs":2,"requestsFinished":2,"requestsFailed":0,"requestsRetries":0,
 "httpOnlyRequestHandlerRuns":0,"browserRequestHandlerRuns":2,
 "renderingTypeMispredictions":0,"msg":"crawler completed"}
```

Crawler verdict: **2/2 listings fetched via Playwright browser path, 0 failures, no retries, no Jina calls**. The `crawler.stats` log line is emitted exactly once per `runWebCrawl` call inside the pipeline `"collection completed"` event, satisfying REQ-17.

The run as a whole reported `failed` because `discoverPostUrls` (LLM call) threw — see VS-8.

Full output: `verification/api/vs-6-live-run.txt`.

### VS-7 — Convert emits absolute URLs (regression caught and fixed)

While verifying VS-6 I observed that listing-mode markdown produced by `convert.ts` contained **relative** URLs (e.g. `/news/claude-opus-4-7`), whereas `validateDiscoveredUrls` does `listingMarkdown.includes(post.url)` and the LLM tends to return **absolute** URLs. This would have silently rejected every discovered post — a behavioral regression vs. the previous Jina implementation.

**Fix applied during verification:** `services/web-fetch/convert.ts` now resolves `<a href>` and `<img src>` against `baseUrl` (using JSDOM's built-in URL accessor) before Turndown sees the HTML. This applies to both `listing` and `article` modes, on the Readability-clone for article mode (so the converted output is unaffected) and on the live document for listing mode.

Two new tests in `tests/unit/services/web-fetch/convert.test.ts` cover both modes (now 392 unit tests total, all passing).

**Verification of the fix (probe via `fetchAdaptive(url, "listing")`):**

```
Sample listing-markdown URL lines after the absolutizeUrls fix:
  anthropic.com/news/anthropic-amazon-compute
  anthropic.com/news/anthropic-nec
  anthropic.com/news/claude-design-anthropic-labs
  anthropic.com/news/claude-for-creative-work
  anthropic.com/news/claude-is-a-space-to-think
  anthropic.com/news/claude-opus-4-7
  anthropic.com/news/election-safeguards-update
  anthropic.com/news/google-broadcom-partnership-compute
  anthropic.com/news/narasimhan-board
```

All URLs are now fully qualified — `validateDiscoveredUrls` will match them against an LLM that returns absolutes. Full output: `verification/api/vs-7-8-convert-and-llm.txt`.

### VS-8 — Discovery LLM blocked by external API quota

The `discoverPostUrls` LLM call against `claude-haiku-4-5-20251001` returned:

```
APICallError [AI_APICallError]: Your credit balance is too low to access the
Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.

statusCode: 400
responseBody: {"type":"error","error":{
  "type":"invalid_request_error",
  "message":"Your credit balance is too low …"}}
```

This is an **external billing condition**, not a code defect introduced by this PR. The same call site existed under the previous Jina implementation and would fail identically. Once the `ANTHROPIC_API_KEY` has billing credit, this verification step can be re-run to fully exercise the listing → discovery → detail-fetch → recap loop.

Full output: `verification/api/vs-7-8-convert-and-llm.txt`.

## DB Evidence

Skipped — the run did not reach the `raw_items` upsert stage because of the upstream LLM block (VS-8). This will be exercised once API credit is restored; structurally `raw_items` shape is unchanged (REQ-NFR-01) since `buildRawItem` and the schema were not touched in this PR.

## Cleanup

- Killed background `pnpm --filter @newsletter/api dev` and `pnpm --filter @newsletter/pipeline dev` processes.
- PostgreSQL + Redis containers left running (shared with other worktrees; not started by this skill).
- All evidence files left under `docs/spec/crawlee-web-collector/verification/` for the orchestrator's commit stage.

## Defects Found / Patches Applied During Verification

1. `packages/pipeline/src/scripts/demo-web-collector.ts` — removed stale `JINA_API_KEY` reference in module docstring (VS-1).
2. `packages/pipeline/src/services/web-fetch/convert.ts` — added `absolutizeUrls()` helper to resolve relative `href`/`src` against `baseUrl` before Turndown, in both listing and article modes (VS-7).
3. `packages/pipeline/tests/unit/services/web-fetch/convert.test.ts` — added 2 new tests covering the absolute-URL behavior in both modes.

All three changes will be committed as a fixup on top of `95f3e0a`.
