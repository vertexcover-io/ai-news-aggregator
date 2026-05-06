# Design — Better Newsletter Digest Headline (VER-96)

## Problem

The archive listing (`/`) renders each digest row using the rank-1 story's title as the headline and the rank-1 story's `recap.summary` as the (featured-only) dek. This:

1. Treats one story's title as if it summarized the whole digest.
2. Often produces a too-long headline (titles regularly exceed 12 words).
3. Shows tag-like chips of top-3 story titles that add visual noise without conveying what's in the digest.
4. Hides the subheading entirely on non-featured rows, so the reader sees only a single story's title and a count.

## Goal

Each digest row in the archive listing has:
- **Headline:** ~6–8 words capturing the *day's overall theme*.
- **Subheading:** one sentence describing the day's main stories — a glimpse of what's in the digest.
- **No story-title chip row.**

## Approach

**Generate digest-level `headline` and `summary` at the ranking step, store on `run_archives`.**

The pipeline ranker (`packages/pipeline/src/processors/rank.ts`) already calls Claude Haiku via the Vercel AI SDK and produces structured per-item recap (`summary`/`bullets`/`bottomLine`). Extending the same call to also emit a digest-level `{ headline, summary }` is a one-shot extension — no new LLM call, no new model, no new dep.

Store the result on `run_archives` as two new nullable text columns: `digest_headline` and `digest_summary`. The API surfaces them on `ArchiveListItem` and the `GET /api/archives/:runId` detail endpoint. The web UI prefers them over the legacy fallbacks.

### Why not: pure deterministic (truncate title + concatenate bottom-lines)

Title truncation produces ugly mid-word cuts. Concatenating bottom-lines reads as Frankenstein prose because each was written about a different story.

### Why not: generate at API request time

Every public listing fetch would pay an LLM round-trip — expensive, slow, and hard to cache. Generating once at rank time is one call per run (≈1/day).

## Data flow changes

### Schema — `run_archives`
- `digest_headline` text NULL — 6–8 word digest headline (~50 chars guideline)
- `digest_summary` text NULL — one-sentence digest subheading

Both nullable so existing rows keep working without backfill. Migration is additive only.

### Pipeline — `processors/rank.ts`
Extend `rankedResponseSchema` to include a top-level `digest: { headline, summary }`:

```ts
export const rankedResponseSchema = z.object({
  digest: z.object({
    headline: z.string().min(1).max(80),  // ~6–8 words; 80-char ceiling for guard rail
    summary: z.string().min(1).max(280),  // one sentence
  }),
  ranked: z.array(rankedEntrySchema),
});
```

`RankResult` gains `digestHeadline: string` and `digestSummary: string`. The system prompt gets a short addition explaining the new fields and word/sentence constraints.

The processor that writes the run archive (downstream of `rank.ts`) writes the new columns alongside `rankedItems`.

### API — `repositories/run-archives.ts`
- `RunArchiveRow` and `ArchiveListItem` gain `digestHeadline: string | null` and `digestSummary: string | null`.
- `listReviewed()` selects and returns them.
- `findById()` selects them so the detail endpoint can surface them.
- The existing `leadSummary` field (computed from rank-1 recap) is **kept** as a fallback for archives generated before this change, so old archives continue to render. New consumers prefer `digestSummary` then fall back to `leadSummary`.

### Review page (admin) — out of scope for this PR
The reviewer should eventually be able to edit the digest headline/summary inline (same pattern as recap field overrides). **This is deferred** — covered in a follow-up issue. For this PR the headline/summary are generated and read-only on the listing.

### Web — `ArchiveRow.tsx` and `format.ts`
- Headline: `item.digestHeadline ?? topItems[0].title`. Keep current font/size.
- Subheading: `item.digestSummary ?? leadSummary`.
  - Render on **every** row that has a value, not just the featured row. Featured retains its larger styling.
- **Remove the `<ul>` chip row** entirely (lines 117–130 in `ArchiveRow.tsx`) and the `truncateChip` helper.
- Remove the `+ N more` standalone count — story count is already shown in the right meta column ("N stories / Read →").

### Types — `packages/shared/src/types/archive.ts`
- `ArchiveListItem` gains `digestHeadline: string | null` and `digestSummary: string | null`.

## Backfill

No backfill. Existing archives' `digestHeadline`/`digestSummary` stay NULL; the UI falls back to `topItems[0].title` and `leadSummary`. New runs from the day this ships forward will populate them.

## External Dependencies & Fallback Chain

No new external dependencies are introduced. The work uses:
- `ai` and `@ai-sdk/anthropic` — already in the stack, already used by `rank.ts`.
- `claude-haiku-4-5-20251001` — already the default model.
- `zod` — already used for the ranking response schema.
- `drizzle-orm`, `drizzle-kit` — already used for migrations.

**Fallback chain:** Not applicable (no new deps to fall back on).

If the LLM omits the `digest` field for some reason, the structured-output validator (zod) rejects the response and the existing rank-failure path runs (the run is marked failed and surfaced in the dashboard). UI still renders correctly because the fields are nullable and the legacy fallbacks remain.

## Out of scope

- Backfilling old archives.
- Editing digest headline/summary in the review page (deferred to a follow-up).
- Translating/localizing the headline.
- A/B testing different headline styles.

## Acceptance criteria

1. `run_archives` table has `digest_headline` and `digest_summary` columns (text, nullable). Migration applies cleanly.
2. The ranker emits `{ headline, summary }` along with the per-item ranking, stored on the new columns.
3. `GET /api/archives` returns `digestHeadline` and `digestSummary` on each row.
4. Archive listing page renders the digest headline (or falls back to top-story title) and renders the digest summary on every row that has one (or falls back to lead summary on featured rows only — the existing behavior).
5. The chip row of top-story titles and the `+ N more` count are removed from `ArchiveRow.tsx`. The right-column "N stories / Read →" meta block is kept.
6. Existing archives without the new fields still render via fallbacks.
7. Web unit tests pass; new tests cover the fallback logic and chip removal.
