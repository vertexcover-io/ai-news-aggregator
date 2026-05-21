# Design: Admin-editable ranking prompt

**Status:** Draft → ready for spec-generation
**Date:** 2026-05-21
**Scope:** Minor change (single field on existing settings page, 7 files touched, no new external deps)

---

## Problem Statement

The LLM rerank stage of the pipeline uses a hardcoded prompt (`RANK_SYSTEM_PROMPT_NO_PROFILE`, ~60 lines of multi-line template text) compiled into the pipeline package. Iterating on the prompt requires a code change, a build, a deploy, and a worker restart. The admin (operator) should be able to edit the prompt directly from `/admin/settings` and have the change apply to the next pipeline job without a deploy.

## Context

- `user_settings` is a singleton row table that already holds runtime-mutable operator config (HN/Reddit toggles, schedule times, social-post enable flags, etc.).
- The settings page (`/admin/settings`) is a react-hook-form + zod form that PUTs the full settings object to `PUT /api/settings`.
- The pipeline worker (`run-process.ts`) already loads `user_settings` once per job and passes derived fields into stage processors. A previously captured project learning (`cache-vs-spec-promise-review.md`) is relevant: **the rerank prompt must be re-read on every job, not memoised at worker startup**, so admin saves take effect on the next run without a worker restart.
- Migration cadence: latest is `0025_good_psylocke.sql`; this PR will add `0026_*` for the column **and** seed the default value into the singleton row in the same migration.

## Requirements

### Functional

- **FR-1** Admin can view the current ranking prompt at `/admin/settings`, edit it in a multi-line textarea, and persist it via the existing `PUT /api/settings` endpoint.
- **FR-2** The pipeline rerank stage uses the DB-stored prompt on every run (not the hardcoded constant), preserving newlines exactly as stored.
- **FR-3** On a fresh database, the singleton `user_settings` row has `ranking_prompt` already populated with the current `RANK_SYSTEM_PROMPT_NO_PROFILE` text (seeded by the same migration that adds the column).
- **FR-4** The admin UI provides a "Reset to default" button that re-fills the textarea with the seeded default (client-side reset; the seeded default text is exposed via a shared constants module that the web bundle imports).
- **FR-5** Newlines (`\n`) entered in the textarea round-trip losslessly: typed in form → JSON body → Postgres `text` column → DB read in pipeline → AI SDK `system` field.

### Non-functional

- **NFR-1** No worker restart required after admin saves. Pipeline must read the latest value on each job (no per-process cache).
- **NFR-2** Validation rejects empty / whitespace-only prompts at both API and form level. The DB column is `text NOT NULL` with no fallback in pipeline code — if the row is somehow missing or empty, the run fails fast.
- **NFR-3** Soft length cap of 20,000 characters enforced in both zod schemas (API + form). DB column itself is unbounded `text`.
- **NFR-4** No new external dependencies.
- **NFR-5** No regression to existing settings flow (HN/Reddit/schedule fields still save, schedule reconciliation still fires).

### Edge cases

- **EC-1** **Fresh DB / fresh migration on existing DB:** the migration must populate `ranking_prompt` for the existing singleton row, not just add the column with a NULL default. If we add `NOT NULL` without populating first, the migration fails on any deployed DB.
- **EC-2** **Whitespace-only or empty submission:** API returns 400 with a clear error; form shows inline error and keeps the previous value.
- **EC-3** **Over-length submission (>20 000 chars):** API and form both reject with a clear "too long" error.
- **EC-4** **Bundled default kept in sync:** the seed text in the SQL migration and the constant exported to the web bundle must be the same string. We solve this by extracting the prompt text into a shared constant in `@newsletter/shared/constants` (subpath import per `web-shared-subpath-imports.md` learning) and **the migration writes a hand-copied snapshot of that text** at migration time — migrations must be deterministic and never reference TS code. We add a build-time check (lightweight script + unit test) that asserts the migration body contains the current default text byte-for-byte, so an accidental drift fails CI.
- **EC-5** **In-flight job during save:** a job that already loaded settings keeps using its loaded prompt; only the next job sees the new value. Acceptable — matches existing semantics for every other settings field.
- **EC-6** **Prompt-injection risk:** the prompt is set by the trusted admin, not subscribers. No additional sanitisation needed beyond the length cap. We do **not** strip control chars — preserving exact whitespace is the whole point.

## Key insights

1. **Pipeline freshness is the contract.** Per the `cache-vs-spec-promise-review.md` learning, this design lives or dies on whether the prompt is re-read each job. The architecture solves this by passing the prompt down through `startRun → run-process → rankCandidates` exactly the same way HN/Reddit configs already flow — no new caching layer.
2. **NOT NULL + seed-in-migration is the right shape.** The user explicitly chose "reject empty, no fallback" over "fallback to constant." This pushes the contract to the DB level: the column is `NOT NULL`, the migration seeds the existing row, and the pipeline never has to think about a missing value. Per the `partial-update-db-writers-precondition.md` learning, we make this precondition explicit with a NOT NULL DB constraint rather than trusting callers.
3. **Subpath imports.** Per the `web-shared-subpath-imports.md` learning, the web bundle imports the default prompt text via `@newsletter/shared/constants` (a new subpath if not already exposed), never via the root `@newsletter/shared`, to avoid leaking the Drizzle client into the browser bundle.

## Architectural challenges

- **Boundaries:** the prompt text is now owned by `user_settings` (DB). The hardcoded constant in `rank-prompts.ts` moves to `@newsletter/shared/constants` so it can be referenced by (a) the seed migration's documentation header, (b) the build-time drift check, and (c) the web UI's "Reset to default" button. The pipeline reads exclusively from DB; the constant exists only as a default/baseline for seed + reset.
- **Data flow:** identical to other settings fields — `useSettingsRepo().get()` in `run-process.ts` → `settings.rankingPrompt` → `rankCandidates(shortlist, { systemPrompt: settings.rankingPrompt, ... })` → AI SDK call.
- **Migration safety:** since this column is `NOT NULL` with no DB default, we must run the seed in the same migration. Drizzle migrations are raw SQL files — we'll author it as:
  1. `ALTER TABLE user_settings ADD COLUMN ranking_prompt text` (nullable initially).
  2. `UPDATE user_settings SET ranking_prompt = $default_text_here$ WHERE singleton = true`.
  3. `ALTER TABLE user_settings ALTER COLUMN ranking_prompt SET NOT NULL`.
  The default text is dollar-quoted (`$default_text_here$ … $default_text_here$`) to avoid escaping all the embedded single quotes and backticks in the prompt.

## Approaches considered

**Approach A — Move prompt to DB with NOT NULL + seed-in-migration (chosen).**
Single column on `user_settings`, seeded in the same migration. Pipeline reads on every job. Admin UI Reset button uses a client-bundled snapshot of the default.
*Pros:* Simple. One field. Matches existing config patterns. No fallback logic.
*Cons:* Migration runs a multi-step ADD → UPDATE → SET NOT NULL — slightly more complex than a `DEFAULT … NOT NULL` add. But `DEFAULT … NOT NULL` with a 2.5KB text default produces a less-clean schema and locks us into the default text being a column default forever, which is awkward.

**Approach B — Keep hardcoded prompt, layer DB override on top.**
Pipeline falls back to the constant if DB value is null/empty.
*Cons:* User explicitly rejected this. Adds an implicit "I changed the prompt but it's not taking effect" failure mode (empty submission → silently reverts to default).

**Approach C — Store as JSONB with versioning / history.**
Track every edit, allow rollback.
*Cons:* Out of scope. Premature. User asked for "set the ranking prompt myself," not version history. Premature abstraction per project rules.

## Chosen approach

Approach A. See architectural challenges above for the migration shape.

## High-level design

### Component changes

| Layer | File | Change |
|-------|------|--------|
| Shared schema | `packages/shared/src/db/schema.ts` | Add `rankingPrompt: text("ranking_prompt").notNull()` to `userSettings` |
| Shared constants | `packages/shared/src/constants/ranking-prompt.ts` (new) | Export `DEFAULT_RANKING_PROMPT` (copy of current `RANK_SYSTEM_PROMPT_NO_PROFILE` body, no other code) |
| Shared exports | `packages/shared/src/constants/index.ts` + `package.json#exports` + `tsup.config.ts` | Re-export from `@newsletter/shared/constants` subpath |
| Shared types | `packages/shared/src/types/user-settings.ts` (or wherever `UserSettings` lives) | Add `rankingPrompt: string` to `UserSettings` |
| Migration | `packages/shared/src/db/migrations/0026_<auto>.sql` (manual) | ADD nullable → UPDATE row with default text → SET NOT NULL |
| API validation | `packages/api/src/lib/validate.ts` | Add `rankingPrompt: z.string().trim().min(1, "Required").max(20000, "Too long")` to `userSettingsCommonShape` |
| API repo | `packages/api/src/repositories/user-settings.ts` | Map `rankingPrompt` in `toDomain()`, INSERT values, and `onConflictDoUpdate` SET clause |
| Pipeline repo (parallel) | `packages/pipeline/src/repositories/user-settings.ts` | Mirror the same mapping changes |
| Pipeline rank options | `packages/pipeline/src/processors/rank.ts` | Add `systemPrompt: string` to `RankOptions`, use it at line 208 (replacing hardcoded constant) |
| Pipeline run-process | `packages/pipeline/src/workers/run-process.ts` | Read `settings.rankingPrompt` (already loading settings) and pass into `rankFn` options |
| Pipeline rank-prompts | `packages/pipeline/src/processors/rank-prompts.ts` | Remove the const export; replace with `export { DEFAULT_RANKING_PROMPT as RANK_SYSTEM_PROMPT_NO_PROFILE } from "@newsletter/shared/constants"` for any remaining consumers (or delete if no other consumers exist after migration). Reranker no longer imports this directly. |
| Web form schema | `packages/web/src/pages/settingsSchema.ts` | Add `rankingPrompt: z.string().min(1).max(20000)` |
| Web form defaults | `packages/web/src/pages/SettingsPage.tsx` `getDefaults()` | Import `DEFAULT_RANKING_PROMPT` from `@newsletter/shared/constants` and use as fallback when server returns nothing (first load before settings exist) |
| Web UI section | `packages/web/src/pages/sections/RankingPromptSection.tsx` (new) | Monospace textarea, character count, "Reset to default" button that calls `setValue("rankingPrompt", DEFAULT_RANKING_PROMPT)` |
| Web SettingsPage compose | `packages/web/src/pages/SettingsPage.tsx` | Mount `<RankingPromptSection />` in JSX |
| Build-time drift check | `packages/shared/src/db/migrations/__tests__/seed-default-drift.test.ts` (new) or similar unit test | Read `0026_*.sql` and assert it contains `DEFAULT_RANKING_PROMPT` text byte-for-byte — fails CI on drift |

### Test surface

- **Unit:** API validation rejects empty / whitespace / >20 000-char prompt. Repository upsert round-trips multi-line text with newlines.
- **Unit:** Pipeline `rankCandidates` uses the `systemPrompt` option, not the previous hardcoded constant. Mock AI SDK and assert the `system:` arg matches the input.
- **Unit:** Build-time drift check — read the SQL file, locate the dollar-quoted block, compare to `DEFAULT_RANKING_PROMPT`.
- **e2e (Playwright):** Admin loads `/admin/settings`, sees the textarea populated with the seeded prompt, edits to a multi-line value, saves, reloads, and sees the same multi-line value. Verifies the freshness contract by inspecting the DB after save (or by triggering a run and confirming the next rank call observes the new value — the freshness contract is the *user-visible promise* of this feature; see `cache-vs-spec-promise-review.md`).

## Open questions

None — the three explicit decisions (fallback, UI affordance, length cap) are settled.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Migration fails on prod DB because singleton row already exists with wrong constraint ordering | Low | High (deploy block) | Three-step migration (nullable → UPDATE → NOT NULL); tested locally against a non-fresh DB before merge |
| Drift between seed text in migration and `DEFAULT_RANKING_PROMPT` in TS constant | Medium | Medium (reset button gives wrong text, no functional break) | Build-time drift test asserts byte-for-byte equality |
| Prompt re-read silently skipped (cached at worker start) | Medium-low | High (admin save appears to work but doesn't take effect) | E2E test for freshness: save value X, trigger run, assert rank call observed X. Code review pass explicitly checks for `publishDeps`-style memoisation |
| Web bundle pulls in DB code via wrong import | Low | Medium (Buffer-undefined runtime error) | Use `@newsletter/shared/constants` subpath; verified by `pnpm --filter @newsletter/web build` |

## Assumptions

- The shared schema's `userSettings` table is the only DB representation of admin-editable config — confirmed by exploration.
- `react-hook-form` + `zod` with `zodResolver` is already the pattern; no need to introduce a new form library.
- The `RANK_SYSTEM_PROMPT_NO_PROFILE` body is safe to copy verbatim into a SQL string via dollar-quoting (`$default_text_here$ … $default_text_here$`); the only escape risk in dollar-quoted strings is collision of the tag itself with text inside, and `default_text_here` is unique enough.
- No multi-tenant concerns — the singleton-row model means there's exactly one prompt for the whole installation.

## External Dependencies & Fallback Chain

**None — pure-internal feature.** No new npm packages, no new third-party APIs, no new SDKs. All changes touch existing infrastructure: Drizzle ORM, zod, react-hook-form, Vercel AI SDK (already wired to read the system prompt from a string passed in). Library-probe stage is `NOT_APPLICABLE`.
