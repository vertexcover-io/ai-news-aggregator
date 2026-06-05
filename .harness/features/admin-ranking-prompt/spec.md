# SPEC: Admin-editable ranking prompt

**Source:** docs/spec/admin-ranking-prompt/design.md
**Generated:** 2026-05-21

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-001 | Ubiquitous | The `user_settings` table shall include a `ranking_prompt` column of type `text` with a `NOT NULL` constraint. | `\d user_settings` (or Drizzle introspection) shows the column with `text NOT NULL`. | Must |
| REQ-002 | Event-driven | When migration `0026_*` is applied against a database that already contains a `user_settings` singleton row, the singleton row's `ranking_prompt` shall be populated with the verbatim text of `DEFAULT_RANKING_PROMPT`. | `SELECT ranking_prompt FROM user_settings WHERE singleton = true` returns a string byte-for-byte equal to `DEFAULT_RANKING_PROMPT`. | Must |
| REQ-003 | Event-driven | When the admin requests `GET /api/settings`, the response body shall include `rankingPrompt` populated from the singleton row. | Response JSON has `rankingPrompt: string` whose length > 0. | Must |
| REQ-004 | Event-driven | When the admin sends `PUT /api/settings` with a valid `rankingPrompt`, the system shall persist the value to the singleton row, preserving all `\n` characters byte-for-byte. | Round-trip: PUT a multi-line string `X` containing `\n`; the next `GET /api/settings` returns the same `X`. | Must |
| REQ-005 | Unwanted | If `PUT /api/settings` receives a `rankingPrompt` that is empty, whitespace-only, or longer than 20 000 characters, the system shall reject the request with HTTP 400 and shall not modify the database. | Response status is 400, response body contains a validation error mentioning `rankingPrompt`, `SELECT ranking_prompt …` is unchanged. | Must |
| REQ-006 | Event-driven | When a pipeline run reaches the rerank stage, the rerank shall use the current value of `user_settings.ranking_prompt` as the system prompt passed to the LLM. | `rankCandidates` is invoked with `systemPrompt` equal to the DB value at the time settings were loaded for that run. | Must |
| REQ-007 | Ubiquitous | The pipeline run-process worker shall re-read `user_settings.ranking_prompt` on every job (no per-worker-process memoisation). | Save prompt X, trigger run R1 → R1 uses X. Save prompt Y, trigger run R2 → R2 uses Y. Same worker process for both. | Must |
| REQ-008 | Ubiquitous | The admin Settings page shall render a multi-line input bound to `rankingPrompt` that preserves newlines as typed. | Form textarea has `value` equal to the server-stored prompt; typing `\n` does not collapse it. | Must |
| REQ-009 | Event-driven | When the admin clicks the "Reset to default" control on the Settings page, the form's `rankingPrompt` field shall be set to `DEFAULT_RANKING_PROMPT` without persisting (until the admin submits the form). | After click: form value equals `DEFAULT_RANKING_PROMPT`; server value unchanged until Save is clicked. | Should |
| REQ-010 | Ubiquitous | The `DEFAULT_RANKING_PROMPT` constant shall be exposed via the `@newsletter/shared/constants` subpath export (not the root barrel). | `import { DEFAULT_RANKING_PROMPT } from "@newsletter/shared/constants"` resolves in the web package without pulling DB code into the browser bundle. | Must |
| REQ-011 | Ubiquitous | The seed default text written to migration `0026_*.sql` shall match `DEFAULT_RANKING_PROMPT` byte-for-byte. | A drift-check test reads the SQL file, extracts the dollar-quoted literal, and asserts equality with `DEFAULT_RANKING_PROMPT`. | Must |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|--------------|
| EDGE-001 | Migration `0026_*` applied to a database where the singleton row pre-exists with no `ranking_prompt` column. | Three-step migration: `ALTER ADD COLUMN … (nullable)` → `UPDATE … SET ranking_prompt = $$default$$ WHERE singleton = true` → `ALTER … SET NOT NULL`. Migration succeeds. | REQ-001, REQ-002 |
| EDGE-002 | `PUT /api/settings` body contains `rankingPrompt: ""`. | HTTP 400, DB unchanged. | REQ-005 |
| EDGE-003 | `PUT /api/settings` body contains `rankingPrompt: "   \n\t  "` (whitespace only). | HTTP 400 — validation runs after `.trim()` and rejects via `.min(1)`. DB unchanged. | REQ-005 |
| EDGE-004 | `PUT /api/settings` body contains `rankingPrompt` of length 20 001. | HTTP 400, DB unchanged. | REQ-005 |
| EDGE-005 | `PUT /api/settings` body omits `rankingPrompt` entirely. | HTTP 400 (required field). DB unchanged. | REQ-005 |
| EDGE-006 | Admin saves prompt Y while job R1 (already in flight) holds prompt X. | R1 finishes using X (matches existing per-job snapshot semantics). R2 (next job) uses Y. | REQ-006, REQ-007 |
| EDGE-007 | Admin types a string containing literal backticks, single quotes, and `$` characters. | Round-trips losslessly through API → Postgres → DB read → AI SDK system prompt. | REQ-004, REQ-006 |
| EDGE-008 | A developer edits `DEFAULT_RANKING_PROMPT` in the TS constant without updating the SQL seed. | Drift-check unit test fails CI. | REQ-011 |
| EDGE-009 | A developer adds a barrel re-export of DB code that accidentally pulls into the web bundle via the constants subpath. | `pnpm --filter @newsletter/web build` succeeds and does not warn about Node built-ins. | REQ-010 |

## Verification Matrix

| ID | Unit Test | Integration Test | E2E Test | Manual Test | Notes |
|----|-----------|------------------|----------|-------------|-------|
| REQ-001 | — | Yes | — | — | Drizzle migration applied against a test DB; introspect schema |
| REQ-002 | Yes | Yes | — | — | Unit reads SQL file; integration applies migration to seeded DB and asserts row value |
| REQ-003 | Yes | Yes | Yes | — | API route handler unit; route integration with test DB; e2e via Playwright loading `/admin/settings` |
| REQ-004 | Yes | Yes | Yes | — | Repository round-trip unit; route PUT integration; Playwright save-and-reload |
| REQ-005 | Yes | Yes | — | — | Zod schema rejection unit; route returns 400 integration. Each EDGE-002…005 is a distinct test case |
| REQ-006 | Yes | — | Yes | — | Mock AI SDK in unit, assert `system` arg equals DB value; e2e covers via REQ-007 |
| REQ-007 | Yes | — | Yes | — | Same-process double-fetch unit (mock repo); e2e: save X → run → assert observed X; save Y → run → assert observed Y |
| REQ-008 | — | — | Yes | — | Playwright: textarea visible, value matches GET response, newlines preserved on edit |
| REQ-009 | — | — | Yes | — | Playwright: click Reset → field equals `DEFAULT_RANKING_PROMPT`; dirty form not yet saved |
| REQ-010 | Yes | — | — | — | Build the web package; grep dist for Buffer/postgres tokens; assert absent |
| REQ-011 | Yes | — | — | — | Drift check: read `0026_*.sql`, extract dollar-quoted literal, compare to constant |
| EDGE-001 | — | Yes | — | — | Apply migration to a DB that already has the singleton row (simulates prod) |
| EDGE-002 | Yes | Yes | — | — | Covered by REQ-005 tests |
| EDGE-003 | Yes | Yes | — | — | Covered by REQ-005 tests |
| EDGE-004 | Yes | Yes | — | — | Covered by REQ-005 tests |
| EDGE-005 | Yes | Yes | — | — | Covered by REQ-005 tests |
| EDGE-006 | — | — | Yes | — | E2E flow: trigger long-running mock job; save mid-flight; assert R1 used old, R2 used new |
| EDGE-007 | Yes | Yes | — | — | Round-trip with special chars; assert byte-equality |
| EDGE-008 | Yes | — | — | — | Drift-check test (REQ-011) failing path |
| EDGE-009 | — | Yes | — | — | Web build smoke test |

## Verification Scenarios

No VS-0 probe scenarios — `library-probe.md` returned `NOT_APPLICABLE` (no external dependencies).

User-visible verification scenarios (Playwright via `mcp__playwright__browser_*`, screenshots captured):

- **VS-1 (REQ-003, REQ-008):** Load `/admin/settings`. Verify the ranking-prompt textarea is rendered, contains the seeded `DEFAULT_RANKING_PROMPT` text, and visibly preserves the multi-line structure. Screenshot: `01-settings-loaded.png`.
- **VS-2 (REQ-004, REQ-007):** Edit the textarea to a known multi-line string `X` (contains `\n`, backticks, and a `$` character). Save. Reload the page. Verify the textarea now contains `X` byte-for-byte. Screenshot: `02-saved-and-reloaded.png`.
- **VS-3 (REQ-005):** Clear the textarea entirely. Click Save. Verify a validation error appears inline and the network response is 400. Screenshot: `03-empty-rejected.png`.
- **VS-4 (REQ-009):** After VS-2 (textarea contains `X`), click "Reset to default". Verify the textarea now shows `DEFAULT_RANKING_PROMPT`. Do NOT save. Reload the page. Verify the textarea shows `X` again (server unchanged). Screenshot: `04-reset-then-reload.png`.
- **VS-5 (REQ-006, REQ-007):** With prompt `X` saved, trigger a pipeline run via "Run Now". Inspect the rank-stage LLM call (mocked at the AI SDK boundary in test mode, or via log inspection in dev) and verify the system prompt equals `X`. Update prompt to `Y`. Trigger another run. Verify the second run's system prompt equals `Y`. Screenshot: `05-freshness-contract.png` (logs / DB state).

## Out of Scope

- **Per-source or per-mode rerank prompts** — single global prompt only.
- **Prompt version history / rollback** — no edit history table. Most recent save wins. (Explicitly rejected as premature per design.md Approach C.)
- **Multi-tenant prompts** — singleton-row design unchanged.
- **Real-time live-update to in-flight jobs** — a job already past the rerank stage continues to use the prompt it loaded at run start.
- **Prompt-injection sanitisation / content filtering** — admin is trusted; only length validation applies.
- **A/B testing two prompts in parallel** — out of scope.
- **Surface the prompt in the public archive UI or API** — admin-only surface.
- **Auto-format / lint of the prompt text** (e.g., normalise CRLF → LF) — no transformations; bytes round-trip verbatim.
- **Migration of historical archives' ranking decisions** — past archives keep their stored rankings; only future runs use the new prompt.
