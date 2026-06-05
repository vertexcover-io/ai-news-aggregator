# Web Collector — Surface Structured Data (JSON-LD + Next.js) to Discovery LLM

> **Verification verdict:** ✅ PASS — see [verification/proof-report.md](verification/proof-report.md)
> **Quality gate:** PASS (9/9; check 9 N/A — pipeline-only feature, no UI)
> **PR:** https://github.com/vertexcover-io/ai-news-aggregator/pull/210

## Summary

Modern aggregator/SPA listing pages (e.g. `llm-stats.com/ai-news`) put their item lists in
embedded JSON — JSON-LD `<script type="application/ld+json">` and Next.js flight data
(`self.__next_f.push`, `__NEXT_DATA__`) — not as static `<a href>` anchors. The web
collector built its discovery-LLM markdown by stripping all `<script>` tags first, so that
structured data was discarded and the "Today" news section was silently dropped (only
outbound arxiv research links survived). This change extracts the raw JSON blobs **before**
stripping, hands them to the discovery LLM verbatim (single combined 120 KB cap, markdown
first — no per-site parsing), drops the markdown-substring URL gate so JSON-only URLs
survive, and skips the Pass-2 detail fetch for self-referential `#item-<realurl>` URLs
(building those items from the discovery LLM's title + date). Live dry-run against
llm-stats.com/ai-news now captures **23 items** (Techmeme, Wired, Bloomberg, Last Week in
AI, The Rundown AI) with `structuredDataBytes=157059` — the original bug is fixed.

## Artifacts

| Document | Purpose |
|----------|---------|
| [spec.md](spec.md) | Testable requirements (REQ-001–011), edge cases (EDGE-001–008), verification matrix |
| [plan.md](plan.md) | 3-phase implementation plan + codebase context |
| [learnings.md](learnings.md) | Why Readability/Turndown discarded the data; the generic fix |
| [verification/proof-report.md](verification/proof-report.md) | Verdict, REQ→test mapping, live dry-run item list |
| [verification/adversarial-findings.md](verification/adversarial-findings.md) | Role-swap pass: break attempts + findings |

_(design.md is gitignored per repo convention.)_

## External dependencies

None — pure-internal feature. Uses existing `jsdom` (DOM querying) and the existing `ai`
SDK discovery call. No new libraries, no new env keys.

## Implementation (4 commits)

1. `feat(pipeline): extract JSON-LD + Next.js structured data in convert listing mode` — `ConvertResult.structuredData`
2. `feat(pipeline): pass structured data to web discovery LLM, drop markdown URL gate` — 120 KB cap, gate removal
3. `feat(pipeline): build self-referential listing items from discovery, skip Pass-2` — `resolvesToListing`
4. `fix: scope structured-data extraction to listing mode + log structuredDataBytes (from review)`
