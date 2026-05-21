# admin-ranking-prompt

**Status:** Verified — PASSED ([verification/proof-report.md](./verification/proof-report.md))
**Branch:** `feat/admin-ranking-prompt`
**PR:** _filled in after open_

## Summary

Moves the rerank LLM system prompt from a hardcoded constant compiled into the pipeline into the `user_settings.ranking_prompt` column. Admins can now edit the prompt at `/admin/settings`; the next pipeline run picks up the new value without a worker restart. The migration seeds the singleton row with the verbatim current prompt as `DEFAULT_RANKING_PROMPT`, exported from `@newsletter/shared/constants` and used by the UI's "Reset to default" button. Newlines and special characters round-trip byte-for-byte. Validation rejects empty/whitespace and >20000 characters at both client and server.

## Artifacts

| File | Purpose |
|------|---------|
| [design.md](./design.md) | Architectural design — problem, options, chosen approach, risks, no external deps |
| [library-probe.md](./library-probe.md) | Library trust gate — verdict: NOT_APPLICABLE (pure-internal feature) |
| [spec.md](./spec.md) | EARS requirements (11 REQ, 9 EDGE), verification matrix, 5 user-visible scenarios, out-of-scope |
| [plan.md](./plan.md) | Implementation plan — 5 phases with phase graph |
| [verification/proof-report.md](./verification/proof-report.md) | Live e2e verification result — PASSED for VS-1..VS-5 |
| [verification/adversarial-findings.md](./verification/adversarial-findings.md) | 12 break-it scenarios attempted; 0 defects found |
| [verification/screenshots/](./verification/screenshots/) | 4 full-page screenshots captured during Playwright-MCP-driven verification |

## Implementation surface

7 packages touched, ~13 files of source + ~7 files of tests:

- `@newsletter/shared` — new `DEFAULT_RANKING_PROMPT` constant (subpath export), `userSettings.rankingPrompt` column, 3-step migration `0026_chief_morlun.sql` (ADD nullable → UPDATE seed → SET NOT NULL), drift test
- `@newsletter/api` — zod validation (`max(20000)` + non-empty refine), repo upsert + `toDomain`, settings PUT route
- `@newsletter/pipeline` — `RankOptions.systemPrompt`, `rankCandidates` uses options.systemPrompt, `run-process` worker passes `settings.rankingPrompt` per job (no memoisation)
- `@newsletter/web` — form schema field, `RankingPromptSection` component (monospace textarea, char counter, "Reset to default" using the shared constant), mounted on Settings page

## Test totals

1722 unit tests passing across all packages (shared 102, api 469, pipeline 726, web 425). Drift test passes byte-for-byte. Live Playwright-MCP verification PASSED for all 5 VS scenarios.

## Notable design choices

- **NOT NULL + seed-in-migration** instead of fallback-to-constant: the user explicitly chose a stricter contract.
- **Shared constant via subpath** (`@newsletter/shared/constants`): avoids leaking the Drizzle DB client into the web bundle (prior learning).
- **Per-job re-read, no caching**: avoids the freshness-regression failure mode from a prior feature (prior learning).
- **Three-step migration**: `ADD COLUMN nullable` → `UPDATE singleton` → `SET NOT NULL` so deployments against existing prod DBs don't fail on a NOT NULL violation.
