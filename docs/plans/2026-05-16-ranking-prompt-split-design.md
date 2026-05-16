# Ranking Prompt Split — Design

**Date:** 2026-05-16
**Branch:** feat/ranking-orchestrator
**Linear:** _(no ticket yet)_

## Problem

Today the entire ranking prompt lives as a single hardcoded string in
`packages/pipeline/src/processors/rank-prompts.ts` — the `RANK_SYSTEM_PROMPT_NO_PROFILE`
const. That string mixes two very different concerns:

1. **The contract** the LLM must obey — input shape (`requestedTopN`, items array),
   output shape (`digest`, `ranked` array with `id`, `score`, `rationale`, `title`,
   `summary`, `bullets`, `bottomLine`, `digest.headline`, `digest.summary`,
   `digest.hook`), word budgets, editorial layering rules (`summary = ORIENT`,
   `bullets = EXPLAIN`, `bottomLine = INTERPRET`), and structural guards
   (omit invalid items, no placeholders, no duplicate same-event coverage,
   exact id preservation, 110-word ceiling, ≤25-word summary, etc.).
2. **The editorial taste** — what topics to boost, what to downrank, the priority
   order between developer-tooling / agent ops / infra / governance, the
   five scoring axes and how to apply them, "for the top 3 prefer X over Y".
   This is the **opinion** of the newsletter's editor, and today it's wired
   to a developer/engineering-team frame in code.

These two have completely different change frequencies. The contract barely
moves; the editorial taste needs to change when the editor decides "I'm
tilting today's digest more toward agent ops, less toward funding stories",
or "give higher rank to posts from well-known authors", or "downrank anything
from $unloved_source". Today every taste change requires a code deploy.

## Goal

Split the prompt into two pieces:

1. **Generic system prompt (code-owned)** — contains everything that defines
   the *contract*: the input/output structure, the editorial layering, the
   word/bullet budgets, the duplicate-handling rules, the placeholder rules,
   the rationale-axis-naming requirement, the digest shape. Stays in
   `rank-prompts.ts` as a TS const so it ships atomically with the code that
   parses the LLM response.
2. **Ranking workflow (admin-owned)** — free-form English written by the
   admin in the Settings UI, persisted in `user_settings.ranking_workflow`,
   loaded at run-time, injected into the LLM call. This is where the
   editorial taste lives. Phrased as a "workflow" so the admin can describe
   the *process* the LLM should follow ("first identify duplicates, then
   apply these priority rules, then score on these axes"), which leaves
   room to evolve into an agentic flow with tool calls later without
   changing the storage shape.

The two get **concatenated** at run-time and sent as a single `system` field
to `generateObject`. Order: generic contract first, workflow second. The
workflow can say "score on these axes" or "use this priority order", and the
generic prompt has already established that there's a five-axis scoring
mechanic (axis names live in the workflow because they're editorial). The
generic prompt does NOT name the current five axes — those are editorial
choices that move out of code.

## Non-goals

- **No agentic flow yet.** One-shot prompting only, same `generateObject`
  call. The workflow text can *describe* an agentic flow ("if you need
  more context, fetch the author's recent posts") and the LLM will see
  it as guidance, but no tool-calling wiring exists yet.
- **No multi-version / per-source / per-time workflows.** Singleton row,
  one global workflow string. If the admin wants different rankings on
  different days they edit the workflow.
- **No prompt history / audit log.** `user_settings` already lacks history
  for the other fields — this matches that pattern. If we need history
  later, add it then.
- **No UI for the generic contract.** The system prompt stays in code.
  Only the workflow is editable.
- **No "ranking preview" / dry-run UI** that re-ranks today's collected
  items with the new workflow before saving. Save-and-run-now is the
  feedback loop.
- **No validation of the workflow content.** It's free-form English. We
  validate length (e.g. ≤ 8000 chars to keep prompt size reasonable) and
  presence-when-required, nothing semantic.
- **No new tests beyond what the new behavior needs.** We update the
  existing `rank-prompts.test.ts` because half of those assertions were
  testing editorial taste (which moves to settings) and the other half
  were testing the contract (which stays). New assertions on the contract
  stay; assertions on developer-relevance / boost-keywords / specific axes
  delete.
- **Backwards compat for old digest content.** Recap content already
  persisted in `raw_items.metadata.recap` is unaffected. We're only
  changing how *future* runs build the system prompt.

## Five concrete components

### 1. Generic system prompt (code)

Replace `RANK_SYSTEM_PROMPT_NO_PROFILE` with a new const that *only* covers
the contract. Strip out:

- Reader-frame paragraph ("software developer, tech lead, engineering manager…").
- "Prefer stories with practical consequences…", "Boost primary-source releases…",
  "For the top 3 prefer…", "Downrank generic AI hype…" — all editorial.
- The five named axes (`Developer-relevance`, `Builder-impact`, etc.). The
  generic prompt instead says: "Score each candidate 0-100 on the axes
  defined in the editorial workflow below. Every rationale must name the
  driving axis using the exact axis name from the workflow."
- The priority list (numbered 1-5).

Keep, verbatim:

- Input shape description (`requestedTopN`, items array with `id`/`title`/`url`/etc.).
- Output shape description (`digest` object + `ranked` array).
- Editorial layering rules (`summary = ORIENT`, `bullets = EXPLAIN`,
  `bottomLine = INTERPRET`, the three pre-return checks).
- Per-field constraints (title: 4-7 words / sentence case / no clickbait;
  summary: ≤25 words / one sentence / no analysis; bullets: exactly 3 / ≤15
  words each / no "this signals…"; bottomLine: ≤25 words / strategic so-what).
- Per-story 110-word hard ceiling and cut-order.
- Total read 3-4 minutes framing.
- Placeholder / id / empty-title rules.
- Same-event duplicate collapse + the "OpenAI ships Codex" example.
- Source-neutrality rule (still verbatim, still REQ-052).
- Digest headline / digest.summary / digest.hook field specs and examples.

The workflow text is appended after the contract with a clear marker:

```
====== EDITORIAL WORKFLOW ======
<workflow text here>
======
```

…and the contract section ends with a sentence pointing forward:
"The editorial workflow below tells you which axes to score on, what to
boost, what to downrank, and how to break ties. Apply it strictly."

Rename the const because the meaning changed. `RANK_SYSTEM_PROMPT_CONTRACT`
(stays exported from `rank-prompts.ts`). A new helper
`buildRankSystemPrompt(workflow: string): string` does the concatenation.
If `workflow` is empty after trimming, throw — the pipeline must not
fall back to "any ranking will do".

### 2. Default workflow (code constant)

Today's editorial paragraphs become the **default** workflow string,
shipped as a TS const in shared:
`packages/shared/src/constants/default-ranking-workflow.ts`. Exported as
`DEFAULT_RANKING_WORKFLOW`. The same string is the seed for the settings
row when none exists, and it's also what the Settings UI shows in the
textarea placeholder + a "Reset to default" button.

Why shared and not in the pipeline? Because the API needs it too — when
the settings repo returns `null` (no row yet), the API substitutes the
default so the UI has something to render. Pipeline reads it via the
settings load path that already happens.

### 3. Database — `user_settings.ranking_workflow`

New column. Drizzle migration in `packages/shared/src/db/schema.ts`:

```ts
rankingWorkflow: text("ranking_workflow").notNull().default(""),
```

`text` because there is no realistic upper limit short of "a few KB" and
we enforce that in zod, not in the column. `notNull` with `default("")`
so existing rows don't break on `MIGRATE`. The repo and API treat empty
string as "not set yet" and substitute the default; the pipeline never
receives an empty string (see below).

`UserSettings` interface (`packages/shared/src/types/settings.ts`) gains
`rankingWorkflow: string`.

`UserSettingsSelect`/`UserSettingsInsert` are inferred — no manual change.

### 4. API — read / write / inject into job

- `userSettingsCommonShape` (`packages/api/src/lib/validate.ts`) gains
  `rankingWorkflow: z.string().trim().max(8000)`. No min, because
  empty means "use default" — the repo handles the substitution.
- `createUserSettingsRepo.get()` (`packages/api/src/repositories/user-settings.ts`)
  returns the row as-is. The route that calls `get()` is responsible for
  substituting the default when the field is empty string. Cleaner: the
  repo substitutes (so callers always get the resolved value). Pick the
  repo. Add a `resolveWorkflow(raw: string): string` helper in shared
  that does `raw.trim() === "" ? DEFAULT_RANKING_WORKFLOW : raw.trim()`.
- `createUserSettingsRepo.upsert()` writes the raw value (empty string
  allowed; that's how the admin says "reset to default").
- `GET /api/settings` returns the resolved value so the form always
  starts with a non-empty textarea.
- `PUT /api/settings` accepts the raw value (could be empty). After
  upsert, the response is again resolved.
- `RunProcessJobPayload` (`packages/shared/src/run-start.ts`) gains
  `rankingWorkflow: string` (required, post-resolution). `startRun()`
  resolves the workflow before queueing so the worker never has to
  re-resolve.
- `RunProcessJobData` (`packages/pipeline/src/workers/run-process.ts:110`)
  gains the same field. `handleRunProcessJob` reads it and passes it
  into `rankCandidates` via a new option (see below).

### 5. Pipeline — ranking workflow flows into `rankCandidates`

`RankOptions` (`packages/pipeline/src/processors/rank.ts:32`) gains:
```ts
rankingWorkflow: string;
```
Required, not optional. The worker (`run-process.ts:506`) passes it from
the job payload. The function calls `buildRankSystemPrompt(rankingWorkflow)`
in place of the bare `RANK_SYSTEM_PROMPT_NO_PROFILE` reference at line 195.

The `evaluate-rank-prompt` and `evaluate-run-rank-prompt` CLI scripts
(`packages/pipeline/src/scripts/*`) get updated to pass
`DEFAULT_RANKING_WORKFLOW` so they keep working without a settings row.

### 6. Settings UI

A new `RankingSection` component (`packages/web/src/components/settings/RankingSection.tsx`)
slots between `SourcesSection` and `ScheduleSection` in `SettingsPage.tsx`.
Contains:
- A `<textarea>` bound via `react-hook-form` to `rankingWorkflow`,
  ~12 rows tall, monospace optional, with a character counter
  (e.g. `1247 / 8000`).
- A "Reset to default" button that calls `form.setValue("rankingWorkflow", "")`
  and triggers a confirmation toast (because saving an empty value means
  "fall back to default", which is what they want).
- Short helper text above the textarea: "How should stories be ranked?
  Write in plain English. This becomes the workflow part of the LLM prompt;
  it's appended to the structural contract every run. Examples: 'Boost
  primary-source release notes from labs', 'downrank funding-only stories',
  'in the top 3 prefer agent-ops over benchmark posts'."

`settingsFormSchema` and `settingsCommonShape` (web + api) both add the
`rankingWorkflow` field with the same `max(8000)`. `getDefaults()`
seeds it with the empty string (server resolves to default on first
mount; once mounted the resolved value comes back from `useSettings`
and replaces the empty default).

## What the new prompt looks like at run-time

```
<RANK_SYSTEM_PROMPT_CONTRACT — the structural rules>

====== EDITORIAL WORKFLOW ======
<DEFAULT_RANKING_WORKFLOW, or whatever the admin saved>
======
```

Concatenation is done in `buildRankSystemPrompt(workflow)` exported from
`rank-prompts.ts`. The function:
1. Throws if `workflow.trim() === ""` — defensive only; API has already
   resolved before enqueueing.
2. Returns `${RANK_SYSTEM_PROMPT_CONTRACT}\n\n====== EDITORIAL WORKFLOW ======\n${workflow.trim()}\n======\n`.

## Migration risk

Singleton row; default-value migration covers it. The only safety check
is: after the migration applies, a `GET /api/settings` against a freshly-
migrated DB must return a non-empty `rankingWorkflow` (because the repo
substitutes the default). Cover this with an e2e test.

## Future direction (documented, not implemented)

When we move to an agentic flow:
- The workflow text already lets the admin write "first dedupe, then…"
  or "if you need more context fetch the author's recent posts" — the
  model just doesn't have tools to act on it yet.
- The `rankingWorkflow` field stays a single text blob. The agentic
  scaffolding (tool registry, multi-step loop) lives in code; the
  workflow describes which tools to use and how.
- If we need structured workflow steps later (e.g. "step 1: dedupe with
  this rule, step 2: score with these axes"), we can layer a parser on
  top of the text — the storage shape doesn't need to change.

## External Dependencies & Fallback Chain

This feature reuses libraries already in the stack and adds **none**.

- **Drizzle Kit** (already in stack) for the migration. No fallback needed —
  every schema change goes through Drizzle Kit; that's project policy.
- **Vercel AI SDK + `@ai-sdk/anthropic`** (already in stack) for the
  `generateObject` call. The system prompt change is a string concat;
  no new SDK surface is touched.
- **`react-hook-form` + zod + `@hookform/resolvers`** (already in stack)
  for the new textarea field. Just adds a string field to existing form.
- **Hono** (already in stack) for the new request body field. No new
  middleware or route handler.

No new external libraries are introduced. Library probe is therefore
NOT_APPLICABLE for this design — see Stage 1.5.

## Risks / open questions

- **Prompt-injection risk.** The admin types raw text that becomes part
  of the LLM system prompt. The admin is the operator with elevated
  access already, so this is low-risk — they can deploy code if they
  wanted to break things. We don't sanitize. If we ever open the workflow
  field to less-trusted users this needs to change.
- **Token budget.** The current full prompt is ~3500 chars. With an
  8000-char workflow cap and ~2500 chars of contract, worst case ~10.5KB
  ≈ 2.6K tokens. Claude Haiku 4.5 / Sonnet 4.6 both handle this fine.
- **Empty workflow on first run after migration.** Resolved by the repo
  substituting `DEFAULT_RANKING_WORKFLOW` when the column is empty
  string. The pipeline never sees an empty workflow.
- **Tests that asserted specific axis names will fail.** Expected — those
  assertions are testing editorial taste, which is no longer code. They
  migrate to two places: (a) `default-ranking-workflow.test.ts` keeps a
  short sanity check that the default includes recognizable axis names
  and the source-neutrality rule, (b) `rank-prompts.test.ts` is rewritten
  to assert only contract things (output shape framing, layering rules,
  ceiling, etc.). REQ-052 (source-neutrality rule verbatim) lives in
  the default workflow now and the test moves with it.
