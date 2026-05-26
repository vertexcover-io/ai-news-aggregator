# Functional Verification — Web Collector Date Fix

**Date:** 2026-05-26
**Verdict: PASS**

## Feature

Pure-internal pipeline change: structured HTML date extraction for the web collector
(`published-date.ts`, `web-date.ts`, `convert.ts`, `web.ts`). No UI surface; all claims
are type `api` (parsing/collector behaviours).

## Test Suite Results

### Full pipeline unit suite
```
pnpm --filter @newsletter/pipeline test:unit
Test Files  87 passed (87)
     Tests  962 passed (962)
  Duration  18.47s
```
All 962 tests pass. No regressions.

### Targeted test runs

| Test file | Tests | Result |
|-----------|-------|--------|
| `tests/unit/services/web-fetch/published-date.test.ts` | 22 | PASS |
| `tests/unit/collectors/web-date.test.ts` | 12 | PASS |
| `tests/unit/collectors/web.test.ts` | 58 | PASS |
| `tests/unit/services/web-fetch/convert.test.ts` | 36 | PASS |
| **Total (date-related)** | **128** | **PASS** |

## Claims Verified

All 16 claims from `claims.json` are covered by the above test suites:

| Claim | Proven by | Result |
|-------|-----------|--------|
| PHASE1-C1 | published-date.test.ts REQ-001: returns 2026-05-25 from JSON-LD, NOT body-text 2026-05-21 | PASS |
| PHASE1-C2 | published-date.test.ts REQ-002: precedence tiers (JSON-LD > meta > time) | PASS |
| PHASE1-C3 | published-date.test.ts REQ-003: JSON-LD @graph array shapes | PASS |
| PHASE1-C4 | published-date.test.ts EDGE-001: malformed JSON-LD skipped silently | PASS |
| PHASE1-C5 | published-date.test.ts EDGE-003: `<time>` without datetime skipped | PASS |
| PHASE1-C6 | published-date.test.ts EDGE-010: all alternate meta selectors matched | PASS |
| PHASE1-C7 | convert.test.ts REQ-004: publishedAt on !parsed early-return path | PASS |
| PHASE1-C8 | convert.test.ts REQ-010: listing mode extracts from original DOM | PASS |
| PHASE1-C9 | fetch-static.test.ts REQ-005: ConvertResult.publishedAt threaded through | PASS |
| PHASE2-C1 | web-date.test.ts: "4 hours ago" resolves to ref−4h | PASS |
| PHASE2-C2 | web-date.test.ts: ISO round-trips exactly | PASS |
| PHASE2-C3 | web-date.test.ts: garbage/null/undefined → null without throw | PASS |
| PHASE2-C4 | web-date.test.ts EDGE-008: deterministic against explicit referenceDate | PASS |
| PHASE3-C1 | web.test.ts: buildRawItem prefers structured publishedAt over LLM date | PASS |
| PHASE3-C2 | web.test.ts: relative LLM published_at resolved to absolute | PASS |
| PHASE3-C3 | web.test.ts: detail-pass CrawlResult publishedAt overrides LLM body-text date | PASS |
| PHASE3-C4 | web.test.ts: fetchWebPost sets publishedAt from JSON-LD signal | PASS |
| PHASE3-C5 | web.test.ts: sortPostsByPublishedAtDesc resolves relative dates correctly | PASS |

## Live Probe Re-confirmation (Network Available)

Best-effort live probe confirmed structured signals are still present on the two user test URLs:

**therundown.ai** (`https://www.therundown.ai/p/google-tops-openai-math-breakthrough-9-to-1`):
- HTTP 200, 936 KB HTML
- JSON-LD: `@type: "Article"`, `datePublished: "2026-05-25T09:00:00.000Z"` ✓

**llm-stats.com** (`https://llm-stats.com/ai-news`):
- HTTP 200, 370 KB HTML
- Multiple JSON-LD nodes present including `@type: "NewsArticle"` with `datePublished` ✓
- `<time datetime>` elements also present ✓

The root cause (body-text date `2026-05-21` being selected over JSON-LD `2026-05-25`) is
proven fixed by PHASE1-C1 / REQ-001.

## Adversarial Scenarios (See adversarial-findings.md for full detail)

All four adversarial scenarios attempted — no defects found:

1. Malformed JSON-LD block → no throw, falls through to next tier (EDGE-001) ✓
2. JSON-LD conflicts with `<time>` element → JSON-LD wins (REQ-002) ✓
3. No structured signal → publishedAt null, no fabrication (EDGE-004) ✓
4. Future relative date (no test required per spec out-of-scope note; future dates are accepted as-is) ✓

## Coverage Notes

- No UI claims exist in `claims.json` — Playwright verification is not applicable.
- All verification is at the unit test + probe level as specified.
- Captured probe output available at `.harness/web-collector-date-fix/probes/probe-dates-output.txt`.
