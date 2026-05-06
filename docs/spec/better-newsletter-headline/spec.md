# SPEC — Better Newsletter Digest Headline (VER-96)

Linear issue: [VER-96 — Better headline for the newsletter](https://linear.app/vertexcover/issue/VER-96/better-headline-for-the-newsletter)

## Scope

- Generate a digest-level **headline** (~6–8 words) and **summary** (one sentence describing the day's main stories) at rank time, alongside the existing per-item recap.
- Persist them on `run_archives` as two new nullable columns.
- Surface them on the public archive listing (`/`) and archive detail (`/archive/:runId`) responses.
- Update `ArchiveRow.tsx` to render the new headline + summary, with fallback to today's behavior for archives that predate the change.
- Remove the chip row of top-story titles and the `+ N more` count from the listing row.

Out of scope:
- Inline editing of digest headline/summary on the review page (deferred to a follow-up).
- Backfilling old archives.

## Functional Requirements

### REQ-1 — Schema

The `run_archives` table has two new nullable text columns:
- `digest_headline TEXT NULL`
- `digest_summary TEXT NULL`

A Drizzle migration is generated via `pnpm --filter @newsletter/shared db:generate` and applies cleanly on a fresh database.

### REQ-2 — Ranker output

`packages/pipeline/src/processors/rank.ts`:
- `rankedResponseSchema` is extended to require a top-level `digest: { headline: string, summary: string }` object.
- `headline.min(1).max(80)` (a guard rail; ~6–8 words ≈ 50 chars).
- `summary.min(1).max(280)` (one sentence).
- The system prompt (`RANK_SYSTEM_PROMPT_NO_PROFILE`) includes a short instruction explaining the new fields and constraints (≈6–8 words, one sentence describing the day's main stories).
- `RankResult` exposes `digestHeadline: string` and `digestSummary: string`.

### REQ-3 — Persisting on the archive

Whichever processor writes a `run_archives` row after ranking writes `digestHeadline` and `digestSummary` to the new columns. Existing rows keep `NULL`.

### REQ-4 — Repository + API

`packages/api/src/repositories/run-archives.ts`:
- `RunArchiveRow` and the `findById()` SELECT include `digestHeadline` and `digestSummary`.
- `listReviewed()` SELECTs and returns them on each `ArchiveListItem`.
- `ArchiveListItem` (in `@newsletter/shared`) gains `digestHeadline: string | null` and `digestSummary: string | null`.

The single-archive detail response (used by `GET /api/archives/:runId`) also includes the two fields so the detail page can use them in a follow-up.

### REQ-5 — Listing UI

`packages/web/src/components/archive-listing/ArchiveRow.tsx`:
- Headline text = `item.digestHeadline ?? topItems[0].title` (when no top item exists, the existing "—" fallback for `!hasTopItems` and "No stories" for `!hasStories && !hasTopItems` are kept).
- Subheading text = `item.digestSummary ?? leadSummary`.
  - On **featured** rows (existing `data-featured="true"` row) the subheading renders with current dek styling whenever it is non-empty (was: only when `leadSummary` non-empty; widens to also include `digestSummary`).
  - On non-featured rows the subheading also renders, but only when `digestSummary` is present (never `leadSummary`, which is rank-1's recap and was deliberately featured-only). This preserves the original visual hierarchy: featured row uses lead summary as a fallback, non-featured rows only show digest-level copy when it exists.
- The `<ul>` chip row (lines 117–130 of the current file) is **removed**.
- The `+ N more` standalone count is **removed**.
- The `truncateChip` helper is **removed** (dead after chip removal).
- The right-column meta block ("N stories / Read →") is unchanged.

### REQ-6 — Backwards compatibility

For archives whose `digest_headline`/`digest_summary` are `NULL`:
- API returns `null` for both fields.
- UI falls back to `topItems[0].title` (headline) and `leadSummary` (subheading on featured rows only).
- No errors, no missing copy; the page renders identically to today for these old rows except chips are gone.

### REQ-7 — Tests

- `packages/web/tests/unit/components/archive-listing/ArchiveRow.test.tsx` is updated:
  - Existing chip-related assertions are replaced with assertions that no chips render and no `+ N more` text appears.
  - New tests cover: headline prefers `digestHeadline` over `topItems[0].title`; subheading prefers `digestSummary` over `leadSummary`; falls back when each is `null`; non-featured row shows subheading iff `digestSummary` is present.
- API repo unit tests (if any cover `listReviewed`) are extended to verify the two new fields propagate. If no such tests exist, this is not a blocker.
- Pipeline ranker unit tests are extended with one fixture that asserts the structured-output schema requires `digest` and that `RankResult` propagates `digestHeadline` and `digestSummary`.

## Verification Scenarios

| ID | Scenario | How verified |
|---|---|---|
| VS-1 | Migration applies cleanly | `pnpm --filter @newsletter/shared db:migrate` succeeds against a fresh DB. |
| VS-2 | Ranker emits `digest` field | Pipeline unit test calls `rankItems` with a mocked `generateObject` and asserts `result.digestHeadline` / `result.digestSummary` are propagated. |
| VS-3 | API surfaces fields | API unit test (or e2e if exists) hits `listReviewed()` against a row with the new columns populated and asserts the response includes them. |
| VS-4 | UI renders new headline | RTL test renders `ArchiveRow` with `digestHeadline="AI safety, regulation, and the open-model push"` and asserts the `<h3>` text is exactly that string. |
| VS-5 | UI fallback when null | RTL test renders with `digestHeadline=null` and asserts `<h3>` text is `topItems[0].title`. |
| VS-6 | Chips and "+ N more" gone | RTL test asserts there is no `<ul>` and no element containing "+ ", "more". |
| VS-7 | Existing archives still render | Manual spot-check / e2e: load `/` against the dev DB; old archives (digest cols NULL) show top-story title + featured-row dek as before, minus the chips. |

## Non-functional

- No new runtime deps. No new env vars. No new infra.
- LLM cost increase: the ranker already runs once per run; the additional ~50 tokens of structured output for `digest` is a rounding error.
- No schema break for older API clients — both new fields are optional in the type and `null` for old rows.
