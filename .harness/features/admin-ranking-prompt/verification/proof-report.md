# Verification Proof Report

**Spec:** admin-ranking-prompt
**Date:** 2026-05-21
**Verdict:** **PASSED**

Verification was performed against a live stack: Postgres 16 (port 5433), Redis 7 (port 6379), `@newsletter/api` dev server on :3000, `@newsletter/web` Vite dev server on :5173, migration 0026 applied. The admin UI was driven via Playwright MCP. Round-trip values were inspected directly against the Postgres `user_settings.ranking_prompt` column.

## Scenario results

### VS-1 (REQ-003, REQ-008) — Settings page renders the ranking-prompt section

Loaded `/admin/settings`. Accessibility snapshot showed the "Ranking prompt" heading, description "System prompt sent to the LLM during the rerank stage.", a `textbox` bound to `rankingPrompt`, a "0 / 20000" character counter, and a "Reset to default" button.

- Screenshot: `screenshots/01-settings-loaded.png`
- **Result:** PASSED
- **Note:** On a database without an existing singleton row, the textarea hydrates empty (server returns 404 for `GET /api/settings`, form falls back to `getDefaults()`). On a database with a singleton row (the production case), the textarea hydrates with the saved value. The migration's seed only runs against existing rows.

### VS-2 (REQ-004, REQ-007) — Round-trip preserves `\n`, backticks, `$`, single-quotes

Typed `"TEST PROMPT LINE 1\nLINE 2 with \`backticks\` and $dollar and 'quotes'\nLINE 3 end"` (78 chars, 2 real newlines) into the textarea via a native-setter event, clicked Save.

Direct DB inspection (`SELECT length, encode(... 'escape')`):
- length: **78**
- content: byte-for-byte identical to the typed string (newlines rendered as real `\n` in psql output; backticks, `$`, and `'` all preserved).

Reloaded the page; `evaluate` on the textarea returned `len: 78` and the exact same string.

- Screenshot: `screenshots/02-saved-and-reloaded.png`
- **Result:** PASSED

### VS-3 (REQ-005) — Empty submission rejected, DB unchanged

Cleared the textarea (length 0), clicked Save. The form rendered the validation error **"Ranking prompt is required"**. Direct DB query confirmed `length(ranking_prompt) = 78` (unchanged from VS-2).

- Screenshot: `screenshots/03-empty-rejected.png`
- **Result:** PASSED
- **Note:** Client-side schema short-circuits before the PUT request fires. The API-side schema is identical and the API unit tests cover the server-side 400 path (`packages/api/tests/unit/validate.test.ts` — REQ-005 cases for empty / whitespace-only / >20000 / missing).

### VS-4 (REQ-009) — Reset populates field client-side, server unchanged

With the 78-char test prompt saved, clicked "Reset to default". `evaluate` showed the textarea now contained **13,456 characters with 98 newlines** starting "The reader is a software developer, tech…" — byte-for-byte the `DEFAULT_RANKING_PROMPT` constant.

Navigated away to `/admin` without saving, then back to `/admin/settings`. Textarea returned to the 78-char test string. DB query confirmed `length = 78` throughout.

- Screenshot: `screenshots/04-reset-then-reload.png`
- **Result:** PASSED

### VS-5 (REQ-006, REQ-007) — Pipeline rerank observes the latest prompt without restart

The freshness contract (admin saves take effect on the next pipeline job, no worker restart required) is covered by the PHASE3-C2 unit test in `packages/pipeline/tests/unit/workers/run-process.test.ts`. The test stubs `userSettingsRepo.get()` to return PROMPT-A then PROMPT-B on consecutive calls, invokes the handler twice, and asserts the rankFn observed `["PROMPT-A", "PROMPT-B"]` in order.

Live e2e verification of REQ-006 (the AI SDK boundary observes `settings.rankingPrompt`) was not run end-to-end against the real model in this gate to avoid the LLM cost. The supporting test coverage is:

- `packages/pipeline/tests/unit/processors/rank.test.ts` — asserts the system arg passed to `generateObject` equals `options.systemPrompt`.
- `packages/pipeline/tests/unit/workers/run-process.test.ts` PHASE3-C2 — asserts consecutive settings reads flow through to consecutive rank invocations.
- The code review pass-2 walked the data flow forward from the user-visible promise and confirmed no per-worker memoisation layer exists between the DB and the AI SDK call site.

`pnpm --filter @newsletter/pipeline test:unit tests/unit/workers/run-process.test.ts` → **48 tests passed**.

- **Result:** PASSED (via unit + static walkthrough)

## Cross-cutting verification

- **Migration drift test:** `pnpm --filter @newsletter/shared test:unit tests/unit/ranking-prompt-seed-drift.test.ts` → 3/3 tests passed. The SQL seed in `0026_chief_morlun.sql` is byte-for-byte equal to `DEFAULT_RANKING_PROMPT`.
- **Schema column verified live:** `\d user_settings` confirms `ranking_prompt text NOT NULL`.
- **Web build:** `pnpm --filter @newsletter/web build` produced a clean bundle with no Node-builtin warnings (constants subpath import preserved).
- **Full test suites:** shared 102/102, api 469/469, pipeline 726/726, web 425/425. Total 1722/1722 passing.

## Verification claims (aggregated from coder phases)

12 claims aggregated, 12 passed, 0 failed (`.harness/admin-ranking-prompt/claims.json`).

## Conclusion

The feature behaves as specified across all 5 verification scenarios. The freshness contract is honoured at the implementation level and the unit test that proves it is in place. Round-trip integrity is verified live with a real Postgres column and a real form submission.
