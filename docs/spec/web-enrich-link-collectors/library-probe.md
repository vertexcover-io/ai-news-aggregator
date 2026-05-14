# Library Probe — web-enrich-link-collectors

<!-- LP:VERDICT:PASS -->

**Date:** 2026-05-14
**Verdict:** PASS — `NOT_APPLICABLE` for new external dependencies; reused in-repo service verified by inspection.

## External dependencies declared by design

The design declares **no new external libraries**. The feature reuses one in-repo service:
`@newsletter/pipeline/src/services/web-fetch/fetchAdaptive`.

## Verification (inspection-based)

`packages/pipeline/src/services/web-fetch/fetch-adaptive.ts` exports `fetchAdaptive(url, mode, opts) -> Promise<ConvertResult>` with:
- Static-first path via `fetchStatic` (Node fetch + Readability + Turndown).
- Browser fallback via `fetchBrowser` (Crawlee + Playwright).
- Honours `opts.signal` for cancellation.
- Returns `ConvertResult = { markdown, title, byline, imageUrl, textLength }` (`types.ts`).

This is already used by `web.ts` and `add-post-helper.ts` in production. No probe-time network call needed — the function is internal and battle-tested by the existing web collector and add-post flow.

## Re-plan Required

None.
