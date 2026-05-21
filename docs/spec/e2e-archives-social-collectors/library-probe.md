# Library probe — e2e-archives-social-collectors

<!-- LP:VERDICT:PASS -->

## Verdict: NOT_APPLICABLE / msw-only

All external APIs touched by the new tests are either mocked or already
live-used by production code:

| Library | Status | Why no probe |
|---|---|---|
| LinkedIn REST API | mocked (msw) | tests don't hit it |
| Twitter API v2 | mocked (msw) | tests don't hit it |
| rettiwt scraper | mocked (msw) | tests don't hit it |
| Tavily | LIVE | already used by `packages/pipeline/src/collectors/web-search/providers/tavily.ts`; existing unit tests + production usage are the proof. Skip-if-no-key in the new test. |
| Resend | not used | newsletter-send NOT in this PR |
| msw | NEW direct devDep | already in lockfile transitively via vitest. Mature, widely used. No probe required. |

## msw note

Adding `msw` as a direct devDependency in `packages/pipeline/package.json`
and `packages/api/package.json`. Version: `2.7.0` (the version already
resolved in pnpm-lock.yaml).
