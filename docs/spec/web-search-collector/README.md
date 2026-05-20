# Web-Search Collector

**Verification verdict:** PASS — see [verification/proof-report.md](./verification/proof-report.md)
**PR:** _(filled in after push)_

## Summary

Adds a `web-search` collector that surfaces niche AI news (agentic AI, context engineering, AI coding, …) from the open web. Admin enters raw search queries via the Settings page; the collector runs each query through a pluggable `WebSearchProvider` (Tavily is the default and only provider in this PR) and feeds resulting articles into the existing pipeline (link-enrichment → dedup → ranking → archive). The provider abstraction makes adding Brave / Exa / Serper a one-file change.

## Reviewer artifact index

| Artifact | Purpose |
|---|---|
| [design.md](./design.md) | Original design (brainstorm output) — context, alternatives, declared external deps + fallback chain. |
| [library-probe.md](./library-probe.md) | Live-verified SDK probe for `@tavily/core@0.7.3` — selected SDK + probe transcripts. |
| [spec.md](./spec.md) | Requirements (REQ-001…) and verification scenarios (VS-0.x). |
| [plan.md](./plan.md) | 7-phase implementation plan with phase graph and parallel waves. |
| [verification/proof-report.md](./verification/proof-report.md) | Final functional-verify report — every VS scenario walked end-to-end with evidence. |
| [verification/adversarial-findings.md](./verification/adversarial-findings.md) | Role-swap adversarial pass — scenarios attempted, defects found. **ADV-1 (`anySource` guard missing webSearch in `runs.ts`) was found and fixed in Stage 5.** |
| [verification/screenshots/](./verification/screenshots/) | Playwright MCP screenshots for VS-0.5 (settings round-trip). |
| [learnings.md](./learnings.md) | Pipeline-friction learnings captured from this run. |

## Library-probe verdict

- Selected: **`@tavily/core@0.7.3`** (verified live in `library-probe.md`).
- Alternatives in the design's fallback chain: Brave Search API, Exa, Serper. Tavily picked for `topic: "news"` + `days` filter + Search Plan free tier.

## Notable scope notes

- The provider abstraction is in place; this PR ships **Tavily only** (per plan §What this PR does NOT do).
- `TAVILY_API_KEY` is **optional** at the env layer — when unset the collector logs a warning and degrades; all other collectors continue.
- `TavilyProvider.search()` does **not** forward an `AbortSignal` to the SDK call. The `@tavily/core` package wraps axios internally and does not expose any way to pass a signal. Documented in `pass-1.md`; collector-level abort (enrichment + DB writes) is still wired correctly.

## Pipeline run summary

- Stages: setup → coder (7 phases) → review (2 passes) → verify-finalize → commit/PR.
- 38 claims aggregated across 7 phases, 921 executed, 0 failed.
- 2 UI claims independently re-proven via Playwright MCP screenshots.
- Code review: pass-1 found 2 Important issues (1 FIXED, 1 documented limitation); pass-2 APPROVE; verification adversarial pass found 1 minor bug (FIXED).
