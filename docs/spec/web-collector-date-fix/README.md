# Web Collector Date Extraction & Relative-Date Resolution

> **Final verification:** ✅ PASS — see [verification/proof-report.md](verification/proof-report.md)
> **Quality gate:** ✅ PASS (9/9 checks)
> **PR:** https://github.com/vertexcover-io/ai-news-aggregator/pull/208

## Summary

The web (blog) collector previously extracted publish dates by asking an LLM to read
Readability-cleaned markdown. This failed when a page exposed its publish date only in
structured metadata (JSON-LD `datePublished`, `<meta property="article:published_time">`,
`<time datetime>`) — which Readability strips before the markdown reaches the LLM — and it
did not reliably resolve relative dates like "4 hrs ago". Probes against the two reported
URLs confirmed the root cause: `therundown.ai` carries its true date (`2026-05-25`) only in
JSON-LD, while the markdown the LLM saw contained only an unrelated body-text date
(`2026-05-21`); `llm-stats.com` carries per-article dates in JSON-LD + `<time>` while
rendering "N hrs ago" client-side.

The fix extracts the publish date from structured HTML signals during conversion (on the
original DOM, before Readability), threads it through `ConvertResult.publishedAt`, and adds a
`chrono-node`-backed `resolvePublishedDate` for relative/natural-language strings. At the
collector layer the **structured date wins**; the resolver is the fallback. Applied to all
three web date paths: batch listing discovery, per-post detail extraction, and the single-post
add-post fetcher (which previously hardcoded `null`).

## Library probe verdict

`chrono-node@2.9.1` — **SELECTED** (trusted: MIT, zero runtime deps, bundled types,
3.2M weekly downloads, last push 2026-05). Verified 4/4 use cases (relative, natural absolute,
ISO passthrough, garbage→null). No pivots. See [library-probe.md](library-probe.md).

## Artifacts

| Document | Purpose |
|----------|---------|
| [design.md](design.md) | Problem, root-cause probe evidence, approaches, chosen design |
| [spec.md](spec.md) | EARS requirements (REQ-001..011), edge cases, verification matrix |
| [plan.md](plan.md) | 3-phase implementation plan + phase graph |
| [library-probe.md](library-probe.md) | chrono-node validation (PASS) |
| [learnings.md](learnings.md) | Task-specific pipeline learnings |
| [verification/proof-report.md](verification/proof-report.md) | Functional verification verdict (PASS) |
| [verification/adversarial-findings.md](verification/adversarial-findings.md) | Adversarial scenarios attempted |

## What changed (code)

- `packages/pipeline/src/services/web-fetch/published-date.ts` *(new)* — `extractPublishedAt(doc)`: JSON-LD → meta → `<time>` precedence, on the original DOM.
- `packages/pipeline/src/services/web-fetch/types.ts` / `convert.ts` — `ConvertResult.publishedAt` populated + threaded through `fetchStatic`/`fetchBrowser`/`fetchAdaptive`.
- `packages/pipeline/src/collectors/web-date.ts` *(new)* — `resolvePublishedDate(raw, referenceDate)` via `chrono-node`, `Date.parse` fallback, `null` on failure.
- `packages/pipeline/src/collectors/web.ts` — structured-wins precedence in `buildRawItem`/detail pass/`fetchWebPost`; `sortPostsByPublishedAtDesc`/`applySinceDays` route through the resolver with an injectable `referenceDate`.

**Tests:** 962 pipeline unit tests pass (+ new `published-date.test.ts` 22, `web-date.test.ts` 12, 6 wiring tests in `web.test.ts`).
