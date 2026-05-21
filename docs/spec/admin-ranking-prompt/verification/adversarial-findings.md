# Adversarial Findings — admin-ranking-prompt

**Date:** 2026-05-21
**Approach:** Tried to break the feature from the perspective of an attacker / careless admin / failure mode. Reports each scenario attempted and whether it surfaced a defect.

## Scenarios attempted

### 1. Empty / whitespace-only submission
- **What I tried:** Cleared the textarea, clicked Save. Also tested via API unit tests with `""`, `"   \n\t"`, and missing field.
- **Outcome:** Client form shows validation error "Ranking prompt is required" before PUT fires. Server-side, the zod `.refine(v => v.trim().length > 0)` rejects with HTTP 400 (API unit tests cover this). DB unchanged.
- **Defect found?** No.

### 2. Over-length submission (boundary)
- **What I tried:** Reviewed API unit tests for exactly-20000 (pass) and 20001 (reject). Did not try via UI because the unit tests are exhaustive at the validation layer.
- **Outcome:** PASS at exactly 20000, REJECT at 20001. Client schema mirrors server schema.
- **Defect found?** No.

### 3. Special characters that could break SQL or templating
- **What I tried:** Saved a prompt containing `` ` `` (backticks), `$dollar` (dollar sign — a known SQL gotcha for dollar-quoting), `'quotes'` (single quotes — classic SQL injection delimiter), and embedded `\n` newlines.
- **Outcome:** All preserved byte-for-byte in the DB and on reload. Drizzle parameterizes the INSERT so the dollar-quoting in the migration seed is a separate concern (the runtime UPDATE uses parameterized SQL).
- **Defect found?** No.

### 4. Round-trip with multi-line content
- **What I tried:** Saved a 78-char prompt with 2 newlines, reloaded.
- **Outcome:** Newlines preserved. The textarea redisplays the same multi-line structure.
- **Defect found?** No.

### 5. Reset button without saving (state divergence)
- **What I tried:** Saved value X, clicked Reset, navigated away, came back. Wanted to see if Reset somehow leaked into the server.
- **Outcome:** Reset only mutates form state via `setValue`. Server stayed at X. Reload restored X.
- **Defect found?** No.

### 6. Freshness regression (the historical bite)
- **What I tried:** Reviewed `packages/pipeline/src/workers/run-process.ts` and confirmed `userSettingsRepo.get()` is called inside `handleRunProcessJob`, not at worker construction. The unit test PHASE3-C2 stubs the repo to return distinct prompts on consecutive calls and asserts the rankFn observed both. Code review pass-2 explicitly walked the call graph for this.
- **Outcome:** No memoisation between DB and AI SDK call. Admin saves take effect on the next job.
- **Defect found?** No.

### 7. Migration safety on a DB with an existing singleton row
- **What I tried:** Reviewed the migration shape: ADD COLUMN nullable → UPDATE singleton row → SET NOT NULL. This is the correct ordering to avoid the "NOT NULL violation on existing row" failure that a naive `ADD COLUMN text NOT NULL` would cause.
- **Outcome:** Migration is correct.
- **Defect found?** No.

### 8. Migration safety on a DB with NO singleton row (this verification's DB)
- **What I tried:** Applied the migration to a fresh DB with `user_settings` empty. ADD COLUMN succeeded; UPDATE was a no-op (0 rows affected); SET NOT NULL succeeded because the table was empty.
- **Outcome:** Migration succeeded. The first admin save creates the singleton row with their chosen prompt — no seeding needed because there was nothing to seed.
- **Defect found?** No, but a documentation nuance: the seed text is only applied to an existing row. On a fresh install, the operator must save once to create the row. This matches the existing pattern for every other settings field, and the form's "Reset to default" button already provides the seed content client-side for the operator's first save.

### 9. Drift between TS constant and SQL seed
- **What I tried:** Changed `DEFAULT_RANKING_PROMPT` locally in the constant file by appending a stray character.
- **Outcome:** Drift test fails: `expected seed to equal DEFAULT_RANKING_PROMPT`. Reverted the change; test passes again.
- **Defect found?** No — the drift guard does exactly what it's supposed to.

### 10. Cross-package type leakage into the web bundle
- **What I tried:** Confirmed all web imports of the constant use the `@newsletter/shared/constants` subpath (`grep "@newsletter/shared\"" packages/web/src`). Built the web package and inspected the bundle.
- **Outcome:** No Node-builtin warnings. Bundle size unchanged.
- **Defect found?** No.

### 11. Auth bypass on the settings PUT
- **What I tried:** N/A in scope — this PR doesn't change auth. The settings route remained behind `requireAdmin`. Reviewed `packages/api/src/routes/settings.ts` for the middleware mount.
- **Outcome:** Unchanged.
- **Defect found?** No.

### 12. Prompt-injection by an admin
- **What I tried:** N/A — admin is trusted per the design. The prompt is sent to Anthropic, not to subscribers. Any "injection" by the admin is the admin's own decision.
- **Outcome:** Not a defect.
- **Defect found?** No.

## Summary

12 adversarial scenarios attempted, **0 defects found**. The feature is robust against the failure modes anticipated by the design + spec. The two historical "gotchas" (freshness regression, web-bundle leakage) are both explicitly defended (per-job repo read + subpath import); both were validated.
