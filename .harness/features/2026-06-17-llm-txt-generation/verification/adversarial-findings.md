# Adversarial Findings — llm.txt / llms.txt Generation

Attempts to break the feature, and outcomes.

| # | Attack / edge case | Outcome |
|---|---|---|
| A1 | Route collision: does `/api/archives/:runId/llm.txt` get swallowed by the public `/:runId` catch-all? | **No break.** Proven with an isolated Hono test — different path depths route independently; per-issue, detail, and `/search` all resolve correctly regardless of mount order. |
| A2 | Public data leak: can an admin-only field reach the text output? | **No break.** Render paths consume only `{title, url, recap}` + `{runId, issueDate, digestHeadline, digestSummary}`. No `costBreakdown`, raw `publishedAt`, `reviewed`, or `shortlistedItemIds` is referenced. |
| A3 | Unreviewed / dry-run issue exposed via per-issue endpoint? | **No break.** `GET /api/archives/:runId/llm.txt` returns 404 when `!reviewed || isDryRun`. Covered by unit tests. |
| A4 | **Limit-before-filter (CONFIRMED break, now fixed):** dry-run/unreviewed runs consuming slots in the index's 30-row window, dropping published issues. | **Was a real defect.** Fixed via SQL-level `listReviewedRows` (filter → order → limit). |
| A5 | Null `digestHeadline` / `digestSummary`, empty `rankedItems`, empty canon, empty issue list. | **No break.** Fallback headline, omitted summary, "No stories in this issue.", "None yet.", "No published issues yet." All unit-covered. |
| A6 | Same-date issues overwriting each other's file. | **No break.** Issue filenames are `<date>-<runId>.llm.txt`; the runId UUID disambiguates. |
| A7 | Drift between served `/llms.txt` and the committed `llms/llms.txt`. | **No break.** Both call `buildLlmTxtSnapshot`; byte-equality enforced by `llm-txt-drift.test.ts`. |
| A8 | Repository-access lint rule (no drizzle/db outside repositories). | **No break.** Generator imports types only; routes/script use repo factories; script's `getDb()` is in the globally-ignored `scripts/` dir. Lint passes. |
| A9 | **Cache serves stale content** after a new issue/canon edit. | **No break.** Version key embeds issue (`runId:completedAt:draftSavedAt`) + canon (`id:addedAt`) signatures; any change → new key → regenerate. Proven by unit, e2e, and a live curl test (seeding canon flipped the response + wrote a new key). |
| A10 | **Redis down** breaks the endpoints. | **No break.** `withCache` is fail-open: a get/set error is logged at `warn` and the render still runs. Unit-tested with a throwing cache. |
| A11 | Per-issue cache key collision across runs. | **No break.** The per-issue key includes the `runId` scope + that row's signature; distinct runs → distinct keys (unit + e2e). |

No unresolved breaks remain.
