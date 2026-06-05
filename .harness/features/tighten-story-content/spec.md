# Spec: Tighten Per-Story Content

Authoritative spec derived from `design.md`. Implementation must satisfy every
requirement here.

## Goal

Bring average per-story recap content from ~218 words → ~100 words so that an
8-story digest reads in 3-4 minutes at 200 WPM.

## Scope

- `packages/pipeline/src/processors/rank-prompts.ts` — rewrite the per-item
  output spec section with hard word caps and concrete examples.
- `packages/pipeline/src/processors/rank.ts` — add post-generation word-count
  telemetry (log-only).
- Optional: extract a tiny `countWords` helper if it's reused; otherwise inline.

## Out of scope

- Zod schema changes in `rank.ts` (stays permissive).
- DB schema / migrations.
- React components (`ArchiveStoryCard.tsx`, `ReviewCard.tsx`, email template).
  These render whatever's in `recap` — shorter content renders shorter naturally.
- Read-time chip in the archive header (deferred to a follow-up PR).
- Retroactive shortening of existing archives.

## Functional Requirements

**FR-1 — Word caps in prompt.** The rank prompt MUST specify, in plain
language inside the system prompt:
- `summary`: one sentence, ≤25 words, fact-first, no analysis.
- `bullets`: **exactly 3** items, each ≤15 words, ~12 words average. Bullets
  are facts/numbers/names, not analysis. The prompt MUST explicitly forbid
  analysis phrases ("this signals", "this means") inside bullets.
- `bottomLine`: one sentence, ≤25 words, the only place analysis lives.
- Total per-story ceiling of ~100 words, hard ceiling 110.

**FR-2 — Examples in prompt.** Each of the four fields (`title`, `summary`,
`bullets`, `bottomLine`) MUST have one concrete "Good:" example showing
the target shape and length.

**FR-3 — Reader-experience framing.** The prompt MUST state that the reader
has a 3-4 minute total read budget across all stories, so per-story brevity
is a quality bar — not an arbitrary limit.

**FR-4 — Soft length telemetry.** After `generateObject` returns in
`rank.ts`, the code MUST iterate the ranked items and emit a structured
`logger.warn` with payload `{ rawItemId, totalWords, bulletCount }` and
message `"rank.recap.over_budget"` for any story whose
`summary + bullets + bottomLine` word count exceeds 130. Never throw, never
fail the run.

**FR-5 — Word counter.** Use the same word-counting algorithm already in
`packages/web/src/lib/readingTime.ts` (`trim().split(/\s+/).filter(Boolean)`).
Either reuse via shared utility or duplicate the one-line function in
pipeline — both acceptable; reuse preferred if it doesn't cross package
import rules.

## Non-Functional Requirements

- **No schema break.** Zod `rankedEntrySchema` keeps `bullets: z.array(z.string())`
  with no min/max. Old data continues to parse and render.
- **No new dependencies.**
- **No additional LLM round-trip.** All tightening happens in the existing
  single `generateObject` call.
- **Typecheck and lint must pass** with zero new errors (`pnpm typecheck`,
  `pnpm lint`).
- **Existing unit tests stay green.** No e2e tests required for this change.

## Acceptance Criteria (EARS)

- **AC-1** — When the pipeline ranking step runs, the system prompt SHALL
  contain hard word caps (≤25 / ≤15 / ≤25) for summary, bullets, bottomLine,
  and SHALL specify exactly 3 bullets.
- **AC-2** — When `generateObject` returns a ranked story whose
  `summary + bullets + bottomLine` word count exceeds 130, the system SHALL
  emit a `logger.warn` with the structured fields named in FR-4.
- **AC-3** — When `generateObject` returns a ranked story whose word count
  is ≤130, the system SHALL NOT emit a warning for that story.
- **AC-4** — Existing recap data in `raw_items.metadata.recap` (pre-change
  archives) SHALL continue to parse, render, and be searchable without
  modification.
- **AC-5** — `pnpm typecheck` and `pnpm lint` SHALL pass with zero new errors.

## Verification Scenarios

**VS-1 — Prompt content (static).**
Read `rank-prompts.ts` and confirm the new block contains the strings:
"≤25 words" (or equivalent), "Exactly 3", "≤15 words" (or equivalent),
"3-minute" or "3-4 minute" framing, and one "Good:" example per field.

**VS-2 — Telemetry unit test.**
Add a unit test that constructs a synthetic ranked-response with one
over-budget story (e.g. 5 bullets × 30 words) and one under-budget story
(3 short bullets), and asserts the warn logger fires exactly once with the
expected payload.

**VS-3 — Telemetry under-budget unit test.**
Construct a ranked-response where every story is under 100 words and
assert the warn logger fires zero times.

**VS-4 — Existing-data parse test.**
A unit test that feeds an old-style recap (5 long bullets, 50-word summary,
30-word bottomLine) through `rankedEntrySchema.parse` and asserts it parses
without error.

**VS-5 — Live run (manual).**
After deploying to dev, trigger a manual run via `/admin` "Run Now". Query
the resulting `raw_items.metadata.recap` for that run and confirm avg
per-story words is between 70-110 and bullet count is 3 on every story.
(Manual check — not automated in this PR.)

## Done Criteria

- All FRs implemented.
- All ACs pass.
- VS-1, VS-2, VS-3, VS-4 covered by tests committed in this change.
- VS-5 is a post-merge manual smoke test, not blocking the PR.
- Quality gate (lint + typecheck + unit tests) green.
