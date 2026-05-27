# Library Probe: Regenerate Digest Meta

<!-- LP:VERDICT:PASS -->

## Verdict: NOT_APPLICABLE (no new external dependencies)

This feature introduces **zero new external libraries or services**. Every dependency it uses is already in
the stack and already exercised — including against the live external service (Anthropic API) — by existing
code paths with passing tests.

| Dependency | Use in this feature | Already proven by |
|-----------|--------------------|-------------------|
| `ai` (Vercel AI SDK) `generateObject` | digest-only LLM synthesis call | `processors/rank.ts::rankCandidates` (digest produced inline today), `processors/recap.ts::generateRecap`, `processors/shortlist.ts` — all hit the live Anthropic API every run |
| `@ai-sdk/anthropic` | Anthropic model binding | Same call sites |
| `zod` | validate the 4-field digest LLM response + the API request body | `rankedResponseSchema.digest` (`rank.ts:78-83`) validates this exact shape on every run; `archivePatchSchema` validates the PATCH body |
| Hono | new `POST /api/admin/archives/:runId/regenerate-digest-meta` route | The API framework; every admin route uses it |
| `@tanstack/react-query` + `react-hook-form` | UI mutation + field state | Used across `ReviewPage.tsx` and the rest of the web app |

## Why no live smoke test is needed

The single external surface this feature touches is the Anthropic API via `generateObject` with the existing
`digestSchema`. That schema and call pattern are not new — the stage-2 reranker already calls
`generateObject({ schema: rankedResponseSchema, ... })` where `rankedResponseSchema.digest === digestSchema`,
producing `{ headline, summary, hook, twitterSummary }` successfully in production on every pipeline run. The
regenerate path reuses the **same schema, same SDK function, same model binding, same provider options
(`structuredOutputMode: "outputFormat"`), and the same `TWITTER_SUMMARY_MAX_CHARS` over-budget retry**. The
only difference is a smaller prompt (digest-only, no ranking) — strictly less LLM surface than what already
works.

There is no new auth, no new endpoint, no new SDK version, no new response shape. A library-probe smoke test
would re-prove an integration the rerank path proves every day.

## Folded into verification

The spec's VS-0 / verification scenarios reuse the existing AI SDK call pattern under test via mocked
`generateObject` (the project's established unit-test seam for these processors) plus a live e2e exercise of
the new endpoint against the real Anthropic API during functional verification.
