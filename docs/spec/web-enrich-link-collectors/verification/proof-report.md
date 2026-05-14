# Functional Verification — web-enrich-link-collectors

**Date:** 2026-05-14
**Branch:** feat/web-enrich-link-collectors
**Verdict:** PASSED

## Method

The feature is collector-internal: no UI, no API route, no DB migration. Live verification consisted of:
1. **Unit suite** — 631 tests pass across 59 files, covering FR-1 .. FR-21 and VS-1 .. VS-11.
2. **Live smoke script** — drove `enrichRawItems` directly against `https://example.com/` plus three synthetic items (self-post, SSRF, duplicate URL) using a real `EnrichmentContext`. Captured raw output below as evidence.

## Live smoke output

```
{"event":"enrichment.fetched","url":"https://example.com/","domain":"example.com","status":"ok","durationMs":1267,"contentType":"html","textLength":111}
{"id":"smoke-1","url":"https://example.com/","status":"ok","title":"Example Domain","textLength":111}
{"id":"smoke-2","url":"https://reddit.com/r/x/comments/def","status":"skipped","skipReason":"no-url"}
{"id":"smoke-3","url":"http://127.0.0.1:1234/admin","status":"skipped","skipReason":"invalid-url"}
{"id":"smoke-4","url":"https://example.com/","status":"ok","cacheHit":true,"title":"Example Domain","textLength":111}
counters: {"attempted":1,"ok":2,"failed":0,"skipped":2,"cacheHits":1,"totalFetchMs":1267,"skippedReasons":{"no-url":1,"invalid-url":1}}
```

## What this confirms

| Behaviour | Evidence |
|----|----|
| Real fetch via `fetchAdaptive` returns Readability content | smoke-1: `status: "ok"`, `title: "Example Domain"`, `textLength: 111` |
| Self-post detection (`url === sourceUrl`) | smoke-2: `skipReason: "no-url"` |
| SSRF guard (127.0.0.1) | smoke-3: `skipReason: "invalid-url"`, no network call made |
| Cross-source URL cache (1 fetch for 2 items) | smoke-4: `cacheHit: true`; `counters.attempted === 1`, `counters.ok === 2`, `counters.cacheHits === 1` |
| Telemetry counters aggregate correctly | `skippedReasons: { "no-url": 1, "invalid-url": 1 }` |
| Structured logging (`enrichment.fetched`) | Pino JSON line with `event`, `url`, `domain`, `status`, `durationMs`, `contentType`, `textLength` |

## Scenarios covered by unit tests (no live re-run needed)

| Scenario | Test file |
|----|----|
| VS-1 Reddit link/self-post | `tests/unit/collectors/reddit-enrichment.test.ts` |
| VS-2 HN Ask vs arxiv + imageUrl fallback | `tests/unit/collectors/hn-enrichment.test.ts` |
| VS-3 Twitter entities.urls extraction + same-platform | `tests/unit/collectors/twitter-enrichment.test.ts` |
| VS-4 Cross-source dedup | `tests/unit/services/link-enrichment/index.test.ts` + live smoke smoke-4 |
| VS-5 Non-HTML media skip | `tests/unit/services/link-enrichment/url-classifier.test.ts` |
| VS-6 15s timeout | `tests/unit/services/link-enrichment/fetcher.test.ts` |
| VS-7 Run cancellation | `tests/unit/services/link-enrichment/index.test.ts` |
| VS-8 Invalid URL + SSRF | `tests/unit/services/link-enrichment/url-classifier.test.ts` (extended for SSRF) |
| VS-9 Telemetry counters | `tests/unit/services/link-enrichment/telemetry.test.ts` |
| VS-10 No schema migration | `git diff main..HEAD -- packages/shared/migrations/` returns nothing |
| VS-11 Markdown size cap | `tests/unit/services/link-enrichment/fetcher.test.ts` |
