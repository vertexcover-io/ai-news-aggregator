# SPEC — Ranking Prompt Split

**Source:** docs/plans/2026-05-16-ranking-prompt-split-design.md
**Branch:** feat/ranking-orchestrator
**Date:** 2026-05-16

## Glossary

- **Contract prompt** — the code-owned generic system prompt that defines
  input/output structure, editorial layering, word budgets, placeholder
  rules, etc. Stays in `rank-prompts.ts`.
- **Ranking workflow** — admin-editable free-form English text persisted
  in `user_settings.ranking_workflow`. Describes scoring axes, boost/downrank
  taste, and tie-breaking rules.
- **Resolved workflow** — `rankingWorkflow.trim() === ""` is treated as
  "use default" and substituted with `DEFAULT_RANKING_WORKFLOW`. The
  resolved workflow is always non-empty.

## Functional requirements (EARS)

### REQ-RPS-001 — Generic contract prompt is code-owned

The system **shall** export a constant `RANK_SYSTEM_PROMPT_CONTRACT` from
`packages/pipeline/src/processors/rank-prompts.ts` that contains only
structural rules (input shape, output shape, editorial layering, word
budgets, placeholder rules, same-event duplicate rules, digest field
specs, source-neutrality rule).

The constant **shall not** contain:
- The five named scoring axes (`Developer-relevance`, `Builder-impact`,
  `Agentic-systems-relevance`, `Evidence-quality`, `Signal-vs-hype`).
- The reader-frame paragraph ("software developer, tech lead, …").
- The "Prefer …", "Boost …", "Downrank …", "For the top 3 prefer …"
  paragraphs.
- The numbered 1-5 priority list.

The constant **shall** state that the editorial workflow appended below
defines the axes and the rationale-axis-naming requirement.

### REQ-RPS-002 — Default ranking workflow is code-owned

The system **shall** export a constant `DEFAULT_RANKING_WORKFLOW` from
`packages/shared/src/constants/default-ranking-workflow.ts`. The default
**shall** contain:
- The reader-frame paragraph.
- The boost / downrank / priority-order paragraphs (today's content).
- The five named axes with their definitions.
- The source-neutrality rule verbatim (preserves REQ-052).
- The rationale-axis-naming requirement.

The constant **shall** be re-exported from `@newsletter/shared` so both
the API package and the pipeline package can import it.

### REQ-RPS-003 — `buildRankSystemPrompt` concatenates contract + workflow

The system **shall** export `buildRankSystemPrompt(workflow: string): string`
from `packages/pipeline/src/processors/rank-prompts.ts`. The function:

- **Shall** throw `Error("buildRankSystemPrompt requires a non-empty workflow")`
  when `workflow.trim() === ""`.
- **Shall** return a string of the form:
  ```
  <RANK_SYSTEM_PROMPT_CONTRACT>

  ====== EDITORIAL WORKFLOW ======
  <workflow.trim()>
  ======
  ```
  (blank line between contract and marker; trailing newline after the
  closing `======`).

### REQ-RPS-004 — Schema: `user_settings.ranking_workflow` column

The Drizzle schema `userSettings` (`packages/shared/src/db/schema.ts`)
**shall** include a column `rankingWorkflow: text("ranking_workflow").notNull().default("")`.

A new Drizzle Kit migration file **shall** add the column to the existing
`user_settings` table with `DEFAULT ''` and `NOT NULL`.

The TypeScript type `UserSettings` (`packages/shared/src/types/settings.ts`)
**shall** include `rankingWorkflow: string`.

### REQ-RPS-005 — Workflow resolution at the repo boundary

A helper `resolveRankingWorkflow(raw: string): string` **shall** be
exported from `packages/shared/src/constants/default-ranking-workflow.ts`.
It **shall** return `DEFAULT_RANKING_WORKFLOW` when `raw.trim() === ""`,
otherwise `raw.trim()`.

`createUserSettingsRepo.get()` **shall** apply `resolveRankingWorkflow`
to the value read from the DB before returning. The returned
`UserSettings.rankingWorkflow` is therefore always non-empty.

`createUserSettingsRepo.upsert()` **shall** write the **raw** input
value to the column (including empty string). It is the API caller's
job to pass through whatever the admin sent; the repo does not coerce.

### REQ-RPS-006 — API validation accepts the workflow field

The zod schemas in `packages/api/src/lib/validate.ts`:

- `userSettingsCommonShape` **shall** include
  `rankingWorkflow: z.string().max(8000)`.
- `userSettingsUpsertSchema` and `userSettingsPersistedSchema` therefore
  both accept the field. Empty string is allowed (means "reset to default").

The web form schema (`packages/web/src/pages/settingsSchema.ts`)
**shall** mirror this with the same `max(8000)` cap.

When `PUT /api/settings` receives `rankingWorkflow` longer than 8000
characters, the route **shall** return HTTP 400 with the existing zod-issue
shape (`{ error, issues }`).

### REQ-RPS-007 — `GET /api/settings` returns a resolved workflow

`GET /api/settings` **shall** return `rankingWorkflow` as the **resolved**
(non-empty) value. When the row is missing entirely (no upsert has ever
happened), the route **shall** return `null` exactly as it does today;
the field substitution only applies once a row exists.

### REQ-RPS-008 — Workflow flows into the BullMQ job

`RunProcessJobPayload` (`packages/shared/src/run-start.ts`) **shall** add
`rankingWorkflow: string`. `startRun(settings, deps)` **shall** read
`settings.rankingWorkflow` (already resolved by the repo) and put it on
the job payload **without further mutation**.

`RunProcessJobData` (`packages/pipeline/src/workers/run-process.ts`)
**shall** add the same field. `handleRunProcessJob` **shall** read it
from `job.data` and pass it into the rank step via `RankOptions`.

### REQ-RPS-009 — `rankCandidates` uses the workflow

`RankOptions` (`packages/pipeline/src/processors/rank.ts`) **shall** add
`rankingWorkflow?: string` (**optional**, falling back to
`DEFAULT_RANKING_WORKFLOW` when not provided — defense-in-depth that
matches the empty-string resolution already done at the API/repo layer).
`rankCandidates` **shall** call `buildRankSystemPrompt` with the
resolved workflow and use the result as the `system` argument to
`generateObject` in place of the bare `RANK_SYSTEM_PROMPT_NO_PROFILE`
reference at line 195.

The old `RANK_SYSTEM_PROMPT_NO_PROFILE` constant **shall** be renamed to
`RANK_SYSTEM_PROMPT_CONTRACT` per REQ-RPS-001. Production callers
(`run-process` worker) **shall** always thread the workflow through;
the fallback only protects against future refactors.

CLI scripts `evaluate-rank-prompt.ts` and `evaluate-run-rank-prompt.ts`
**shall** continue to work without explicit `rankingWorkflow` arguments
thanks to the fallback.

### REQ-RPS-010 — Settings UI exposes the workflow field

A new component `packages/web/src/components/settings/RankingSection.tsx`
**shall** render:

- A heading "Ranking" with helper copy: "How should stories be ranked?
  Write in plain English. This text is the workflow part of the LLM
  prompt; it's appended to the structural contract every run."
- A `<textarea>` bound to `rankingWorkflow` via `react-hook-form`. Min
  height visually ~12 rows. Auto-resize is not required.
- A character counter `<n> / 8000` next to the textarea. Counter
  **shall** turn red (`text-destructive`) when `n > 8000`.
- A "Reset to default" button. Clicking it **shall** call
  `form.setValue("rankingWorkflow", "")` and **shall not** save
  immediately; the operator still needs to press Save.

`SettingsPage.tsx` **shall** render `<RankingSection>` between
`<SourcesSection>` and `<ScheduleSection>`.

`getDefaults()` **shall** seed `rankingWorkflow: ""` (the server returns
the resolved value on mount and `useEffect` rehydrates the form via
`form.reset`).

### REQ-RPS-011 — Run-Now and daily scheduled runs use the saved workflow

When the operator clicks **Run Now** (`POST /api/runs/now`) or the
BullMQ `daily-run` scheduler fires, the pipeline **shall** use the
`rankingWorkflow` from the loaded `UserSettings` (resolved by the repo).
Operators **shall not** have to save settings twice to apply a workflow
edit — saving once is enough, and the next run picks it up.

### REQ-RPS-012 — Source-neutrality rule preserved

The literal string of `SOURCE_NEUTRALITY_RULE` **shall** remain unchanged
and **shall** continue to appear verbatim in the prompt assembled by
`buildRankSystemPrompt` when the default workflow is used (preserves REQ-052).
The rule lives in the default workflow (because it's editorial taste:
"don't penalize blog posts for having no comments"). The existing
`rank-prompts.test.ts` assertion that the assembled prompt contains
`SOURCE_NEUTRALITY_RULE` is updated to assemble the prompt with
`DEFAULT_RANKING_WORKFLOW` and assert the rule appears in the result.

## Non-functional requirements

### NFR-RPS-001 — No new external dependencies

The implementation **shall not** add any new runtime or dev dependencies.

### NFR-RPS-002 — Migration is idempotent

The Drizzle migration **shall** be re-runnable safely (add-column with
`NOT NULL DEFAULT ''` is naturally idempotent under Drizzle Kit's
`drizzle-kit migrate` tracking).

### NFR-RPS-003 — Tests assert behavior, not constant contents

The existing `rank-prompts.test.ts` content-mirror assertions ("contains
'Developer-relevance'", "contains '110 words'", "contains 'OpenAI ships
Codex'", etc.) **shall be deleted** rather than migrated. Asserting that
a string constant contains its own substrings does not protect any
behavior — it only blocks edits to the constant by re-stating them.

The replacement tests **shall** assert real behavior at decision points
(see Verification Scenarios): `buildRankSystemPrompt` throws on empty and
follows the format; `resolveRankingWorkflow` substitutes the default;
the repo round-trips empty-to-default and custom-to-custom; the route
rejects oversize input; `rankCandidates` forwards the workflow to
`generateObject`; the form UI updates state and counter.

No test **shall** assert what `RANK_SYSTEM_PROMPT_CONTRACT` or
`DEFAULT_RANKING_WORKFLOW` contain as strings. If their content matters,
the failure surfaces through the rank LLM call or the integration test —
not through a content mirror.

### NFR-RPS-004 — Coverage gate

New code paths (`buildRankSystemPrompt`, `resolveRankingWorkflow`,
`RankingSection`, repo round-trip with empty string, API zod validation
of the field) **shall** all be covered by unit/integration tests.

## Verification Scenarios

| ID | Scenario | Type |
|----|----------|------|
| VS-1 | `buildRankSystemPrompt("")` throws | unit |
| VS-2 | `buildRankSystemPrompt("WORKFLOW_X")` returns a string where `"WORKFLOW_X"` appears between `====== EDITORIAL WORKFLOW ======` and the closing `======` marker, with the contract preceding it | unit |
| VS-3 | `resolveRankingWorkflow("")` and `resolveRankingWorkflow("  \n\t ")` return `DEFAULT_RANKING_WORKFLOW`; `resolveRankingWorkflow(" foo ")` returns `"foo"` | unit |
| VS-4 | Repo `get()` after `upsert({ rankingWorkflow: "" })` returns a `UserSettings` whose `rankingWorkflow === DEFAULT_RANKING_WORKFLOW` | integration (DB) |
| VS-5 | Repo `get()` after `upsert({ rankingWorkflow: "boost agent stuff" })` returns `rankingWorkflow === "boost agent stuff"` | integration (DB) |
| VS-6 | `PUT /api/settings` with `rankingWorkflow` of length 9000 returns HTTP 400 | API |
| VS-7 | `PUT /api/settings` with `rankingWorkflow: "custom workflow"` then `GET /api/settings` returns `rankingWorkflow: "custom workflow"` | API |
| VS-8 | `PUT /api/settings` with `rankingWorkflow: ""` then `GET /api/settings` returns `rankingWorkflow === DEFAULT_RANKING_WORKFLOW` | API |
| VS-9 | `rankCandidates(shortlist, { rankingWorkflow: "WORKFLOW_X", ... })` calls the injected `generateObject` mock with `system` that contains `"WORKFLOW_X"` between the workflow markers | unit (pipeline) |
| VS-10 | Settings page renders the `RankingSection` with a textarea; typing into it updates form state; clicking "Reset to default" sets the textarea to empty | unit (web) |
| VS-11 | Character counter updates as the operator types and turns red when the value exceeds 8000 chars | unit (web) |
| VS-12 | E2E (functional verify): start the API + pipeline, PUT a custom workflow via API, trigger a run, observe that the system prompt sent to the ranking LLM contains the custom workflow text (or the rank mock receives it) | functional-verify |

Removed: assertions on what `RANK_SYSTEM_PROMPT_CONTRACT` or
`DEFAULT_RANKING_WORKFLOW` *contain* as strings, and pass-through tests
that TypeScript already enforces. Constants are not behavior; required
struct fields are not behavior.

## Out-of-scope (explicit non-requirements)

- Prompt injection sanitization (operator is trusted).
- A "ranking preview" or dry-run UI.
- Per-source / per-time-of-day / multi-version workflows.
- A workflow audit log or version history.
- Tool-calling / agentic loop (documented as future direction in design).
- Removing `RANK_SYSTEM_PROMPT_NO_PROFILE` name without an export-rename
  fallback — instead, we rename the const to `RANK_SYSTEM_PROMPT_CONTRACT`
  and update the few CLI scripts and one test file that reference the
  old name. No legacy alias is kept.

## Risk register

| Risk | Mitigation |
|------|------------|
| Migration fails on prod due to a row-level constraint we forgot | `NOT NULL DEFAULT ''` is safe; verify with a local `drizzle-kit migrate` against the dev DB before merging |
| Empty workflow reaches the LLM (no editorial guidance) | Repo resolves at the boundary; `buildRankSystemPrompt` throws as a backstop |
| Operator pastes a 100KB blob and slows ranking | `max(8000)` at the API + form layer |
| Tests fail noisily because old axis-name assertions live in `rank-prompts.test.ts` | Rewrite that file as part of REQ-RPS-001 + move editorial assertions to `default-ranking-workflow.test.ts` |
