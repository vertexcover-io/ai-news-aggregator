# Spec — LLM-Based Shortlisting Rewrite

**Status:** approved
**Linked design:** [design.md](./design.md)
**Library probe:** [library-probe.md](./library-probe.md) (NOT_APPLICABLE)

## Requirements (EARS format)

### Shortlist processor

- **REQ-001** When `shortlistCandidates` is invoked with a non-empty `candidates: Candidate[]` and a non-empty `systemPrompt`, the system SHALL extract `{ id, title }` pairs for every candidate (no cap), invoke `generateObject` with `model: anthropic(modelId)`, `system: systemPrompt`, and a zod schema `{ ids: z.array(z.string()) }`, and return a `ShortlistResult` whose `shortlist` field contains the `Candidate` objects matching the returned ids, preserving the LLM-returned order.
- **REQ-002** When the LLM returns an id that is NOT in the input `candidates` set, the system SHALL drop that id (logging at warn level) and SHALL NOT include it in `shortlist`. The remaining valid ids are returned in order.
- **REQ-003** When the LLM returns fewer than `shortlistSize` ids, the system SHALL return those ids as the full shortlist with no padding.
- **REQ-004** When the LLM returns zero ids, the system SHALL return `{ shortlist: [], breakdowns: [] }`.
- **REQ-005** When the LLM call throws (after Vercel AI SDK retries), the system SHALL re-throw the error to the caller (no swallow, no fallback to recency-decay).
- **REQ-006** When `options.tracker` is provided, the system SHALL call `tracker.record({ stage: "shortlist", modelId, usage, providerMetadata })` exactly once per successful LLM call. On LLM failure, no record is made.
- **REQ-007** The default `modelId` SHALL be `process.env.SHORTLIST_MODEL ?? "claude-haiku-4-5-20251001"`. If `options.modelId` is supplied, it overrides both.
- **REQ-008** The system prompt sent to the LLM SHALL include `shortlistSize` interpolated into the user prompt payload (so the LLM knows the target N).

### Database schema

- **REQ-010** The `user_settings` table SHALL have a `shortlist_size` integer column (NOT NULL).
- **REQ-011** The `user_settings` table SHALL have a `shortlist_prompt` text column (NOT NULL).
- **REQ-012** Migration `0027_*.sql` SHALL add both columns. `shortlist_size` SHALL default to 30 for the existing singleton row. `shortlist_prompt` SHALL be seeded with the verbatim text of `DEFAULT_SHORTLIST_PROMPT` exported from `@newsletter/shared/constants`.
- **REQ-013** A new constant `DEFAULT_SHORTLIST_PROMPT` SHALL be exported from `packages/shared/src/constants/shortlist-prompt.ts` and re-exported via `@newsletter/shared/constants`. It SHALL be a non-empty string containing a focused newsletter-shortlisting system prompt.

### Cost-breakdown type

- **REQ-020** The `CostStage` union in `packages/shared/src/types/cost-breakdown.ts` SHALL include the literal `"shortlist"`. Existing values (`web-discovery`, `web-extraction`, `rank`, `recap`) SHALL be preserved.
- **REQ-021** Reading an archive created BEFORE this change SHALL still work: `cost_breakdown.stages.shortlist` will be absent (`Partial<Record<...>>`), and consumers SHALL NOT throw when iterating.

### API — `/api/settings`

- **REQ-030** `GET /api/settings` SHALL return `shortlistPrompt: string` and `shortlistSize: number` alongside existing fields.
- **REQ-031** `PUT /api/settings` zod schema SHALL validate `shortlistPrompt: z.string().min(1).max(20000)` and `shortlistSize: z.number().int().min(5).max(100)`. A request missing either field, or with an invalid value, SHALL return HTTP 400 with a validation error.
- **REQ-032** When `PUT /api/settings` succeeds, the next pipeline job (without a worker restart) SHALL read the updated `shortlistPrompt` and `shortlistSize` via `userSettingsRepo.get()` inside `handleRunProcessJob`. (Tested at integration layer: PUT → trigger run → assert stub `generateObject` received the new prompt.)

### Pipeline wiring

- **REQ-040** Inside `handleRunProcessJob`, the call to `shortlistFn` SHALL pass `systemPrompt: settings.shortlistPrompt`, `shortlistSize: settings.shortlistSize`, `tracker`, and `abortSignal: signal`.
- **REQ-041** The deprecated options `halfLifeHours`, `engagementWeight`, `recencyWeight`, `scoreFloor` SHALL be removed from `ShortlistOptions` and from the call site in `run-process.ts`.
- **REQ-042** On a successful run, the persisted `run_archives.cost_breakdown.stages` JSONB SHALL contain a `shortlist` key with `calls > 0`.
- **REQ-043** On a run that fails AFTER shortlist succeeded but BEFORE rank completed, the persisted `cost_breakdown` SHALL still contain `stages.shortlist` (cost tracker merges into archive on failure paths per existing precondition rule).

### Web UI

- **REQ-050** `/admin/settings` SHALL render a `<ShortlistPromptSection />` containing a textarea bound to `shortlistPrompt`, a live char counter (current / 20000), and a "Reset to default" button that calls `setValue("shortlistPrompt", DEFAULT_SHORTLIST_PROMPT)`. Visually mirrors `RankingPromptSection`.
- **REQ-051** `/admin/settings` SHALL render a `<ShortlistSizeField />` (or extension of the existing form) for `shortlistSize` with min 5, max 100, integer-only validation. Default value reflects the value from `GET /api/settings`.
- **REQ-052** `<ShortlistPromptSection />` and `<ShortlistSizeField />` SHALL import shared constants/types via the subpath form (`@newsletter/shared/constants`, `@newsletter/shared/types`) per `.claude/rules/learnings/web-shared-subpath-imports.md`.
- **REQ-053** `CostDialog.tsx`'s `STAGE_LABELS` SHALL include `shortlist: "Shortlist"`. When an archive's `cost_breakdown.stages.shortlist` is present, the dialog SHALL render a row labelled "Shortlist" with the standard columns (Calls, Input tokens, Output tokens, Cached input, Cache creation 5m/1h, Reasoning, Model, Cost USD).

### Pricing lookup

- **REQ-060** The cost-tracker pricing table SHALL return a non-null `costUsd` for usage records with `modelId = "claude-haiku-4-5-20251001"` and `stage = "shortlist"`. (Already true via recap; this requirement is a regression guard.)

### Backwards compatibility

- **REQ-070** Archives created BEFORE the migration runs (i.e. `cost_breakdown.stages.shortlist` is absent) SHALL still render correctly in `CostDialog` — the total at the bottom of the table omits the missing stage; no React errors are thrown.
- **REQ-071** Archives created AFTER the migration but with an LLM that returned 0 ids SHALL still write a `cost_breakdown.stages.shortlist` entry with `calls = 1` (one record per LLM call, regardless of return count) and the archive itself is the standard empty-shortlist outcome (no rank, no recap).

## Verification Scenarios

(Functional-verify re-runs these — every UI claim needs a screenshot.)

### VS-1: Shortlist replaces recency-decay (unit)
Stub `generate` to return 30 of 50 ids. Assert returned shortlist has 30 items in the LLM order. Asserts REQ-001.

### VS-2: Unknown id dropped
Stub `generate` to return `["valid-1", "bogus", "valid-2"]`. Assert shortlist length 2, contains valid-1 and valid-2. Asserts REQ-002.

### VS-3: Cost tracker records shortlist stage (unit)
Stub generate to return successfully. Assert `tracker.record` called once with `stage: "shortlist"`. Asserts REQ-006.

### VS-4: LLM failure bubbles up (unit)
Stub generate to throw. Assert error rethrown; no record made. Asserts REQ-005.

### VS-5: Live settings reload (integration)
PUT /api/settings with `shortlistPrompt: "TEST_PROMPT_MARKER"`. Trigger pipeline job (stub generate). Assert the `system:` arg passed to `generateObject` equals `"TEST_PROMPT_MARKER"`. Asserts REQ-032.

### VS-6: Archive contains shortlist cost stage (e2e)
Run a full pipeline with stubbed LLMs (shortlist + rank + recap all stubbed). Assert `run_archives.cost_breakdown.stages.shortlist.calls >= 1`. Asserts REQ-042.

### VS-7: Migration is applied
Run `pnpm --filter @newsletter/shared db:migrate` against a fresh DB. Assert `user_settings.shortlist_size = 30` and `user_settings.shortlist_prompt` matches `DEFAULT_SHORTLIST_PROMPT` byte-for-byte. Asserts REQ-010, REQ-011, REQ-012.

### VS-8: Settings page renders new fields (UI — Playwright MCP, requires screenshot)
Navigate to `/admin/settings`. Confirm: shortlistPrompt textarea visible with current text, char counter shows length, reset button present, shortlistSize numeric field visible with current value. Screenshot saved to `docs/spec/llm-shortlisting-rewrite/verification/screenshots/`. Asserts REQ-050, REQ-051.

### VS-9: Cost dialog renders Shortlist row (UI — Playwright MCP, requires screenshot)
On `/admin`, click Cost on a recent run that ran post-migration. Confirm the dialog table contains a row labelled "Shortlist" with non-zero Calls. Screenshot saved. Asserts REQ-053.

### VS-10: Old archive still renders (UI — Playwright MCP, requires screenshot)
On `/admin`, click Cost on an archive with `cost_breakdown` that lacks the shortlist key. Confirm dialog renders without errors (no Shortlist row, totals correct). Screenshot saved. Asserts REQ-070.

## Verification Matrix

| REQ | Type | Verification |
|---|---|---|
| 001 | unit | VS-1 |
| 002 | unit | VS-2 |
| 003 | unit | dedicated unit test (LLM returns < N) |
| 004 | unit | dedicated unit test (LLM returns 0) |
| 005 | unit | VS-4 |
| 006 | unit | VS-3 |
| 007 | unit | env-override unit test |
| 008 | unit | assert prompt payload includes shortlistSize |
| 010-012 | e2e | VS-7 |
| 013 | unit | import + non-empty assertion |
| 020 | type | typecheck passes with new union value |
| 021 | unit | iterate empty stages, no throw |
| 030 | integration | GET /api/settings returns new fields |
| 031 | integration | PUT with invalid values returns 400 |
| 032 | integration | VS-5 |
| 040-041 | e2e | VS-6 + grep run-process.ts for removed options |
| 042 | e2e | VS-6 |
| 043 | e2e | failure-injection test (rank throws after shortlist) |
| 050 | UI | VS-8 |
| 051 | UI | VS-8 |
| 052 | static | eslint no-restricted-imports already enforces |
| 053 | UI | VS-9 |
| 060 | unit | pricing lookup unit test |
| 070 | UI | VS-10 |
| 071 | e2e | shortlist returns 0 ids → archive still has stages.shortlist |
