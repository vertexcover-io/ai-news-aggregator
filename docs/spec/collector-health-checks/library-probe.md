# Library Probe — collector-health-checks

> **Run at:** 2026-06-03
> **Verdict:** NOT_APPLICABLE

## Summary

No new external library or third-party API is introduced by this feature. The
`## External Dependencies & Fallback Chain` section of `design.md` declares
**"None — pure-internal feature."**

The collector health checks *exercise* external services at runtime (Algolia/HN,
Reddit RSS, `rettiwt-api`, Crawlee, Tavily via `@tavily/core`), but every one of
these libraries is **already integrated and in production use** by the existing
collectors. This feature adds no package to any `package.json`, so there is no new
library surface to probe before planning.

Liveness of those services is instead validated *by the feature itself* — that is
the entire point of a collector health check — and is covered by the spec's own
verification scenarios rather than a VS-0 library probe.

## Selected

- N/A — no library selection required.

## Setup Needed

- None.

<!-- LP:VERDICT:NOT_APPLICABLE -->
