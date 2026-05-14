# Design — Social `hook` and `tldr` digest fields

Date: 2026-05-14
Owner: Aman
Linear: (n/a — internal)

## Problem

The LinkedIn and X (Twitter) auto-posts that fire after `newsletter-send` currently consist of three lines:

```
<digest_headline>

<digest_summary>

<archive_url>
```

That copy is fine as a one-shot but doesn't pull readers in, and it doesn't preview the day's actual stories. For LinkedIn we want a real "blog-post-shaped" body — a hook, a TLDR sweep, a numbered list of stories, a promo line. For X we want a thread with one tweet per story instead of a single truncated post.

The per-story copy we need (`recap.title`, `recap.summary`) is already generated and stored on `raw_items.metadata.recap`. What's missing at the digest level is two pieces of LLM-written prose tuned for social, distinct from the existing `digest_headline` / `digest_summary` which serve the archive UI and listing page.

## Goals

1. Generate two new digest-level fields from the existing stage-2 rerank LLM call:
   - **`hook`** — one news-hook sentence (≤140 chars) for the top-of-post opener.
   - **`tldr`** — 2–3 sentence plain-prose sweep across the day's top stories.
2. Persist both on `run_archives` (nullable).
3. Expose both on the archive API responses (public + admin).
4. Rewrite `composePosts` to emit a long-form LinkedIn body (all ranked stories, no cap) and a Twitter thread array (all ranked stories, one per tweet) using the new fields plus per-story `recap.title` / `recap.summary`.
5. Switch the Twitter notifier to post a chained thread (each tweet replies to the previous).

## Non-goals

- Do **not** change `digest_headline` / `digest_summary` semantics, content, or storage.
- Do **not** change archive UI rendering (`/archive/:runId`, listing `/`).
- Do **not** add hashtag generation.
- Do **not** touch OAuth, the fan-out trigger from `newsletter-send`, or the existing `social_metadata` idempotency plumbing.

## Architecture

### Field placement

`hook` and `tldr` live at the **digest level**, peers of `digest_headline` / `digest_summary`. They are not per-story. They are written by the same LLM call that produces the digest fields today, in a single round trip — no second LLM call.

### LLM schema change

In `packages/pipeline/src/processors/rank.ts`, extend `digestSchema`:

```ts
const digestSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  hook: z.string(),
  tldr: z.string(),
});
```

In `packages/pipeline/src/processors/rank-prompts.ts`, append a new section after the existing digest block:

```
Also return social-post fields for LinkedIn and X:
- digest.hook: ONE sentence that opens a social post. Lead with the day's biggest shift, framed as a news hook. ≤140 chars. No clickbait, no questions, no editorial filler ("quietly", "finally"). No trailing punctuation other than a single period.
- digest.tldr: 2–3 sentences of plain prose summarising the day's top stories for a social audience. No bullet syntax, no markdown, no hashtags. Mentions 4–6 specific actors / models / events from the ranked items. Reads like a friend recapping the news.
```

The existing `digest.headline` and `digest.summary` instructions stay verbatim. Both new fields are required (not `.optional()`) so the LLM always emits them.

### Storage

`run_archives` adds two nullable text columns:

```ts
hook: text("hook"),
tldr: text("tldr"),
```

Both nullable so old archives keep working — identical pattern to VER-96's `digest_headline` / `digest_summary` (see `0009_goofy_grey_gargoyle.sql` for precedent).

Migration generated via `pnpm --filter @newsletter/shared db:generate`.

### Write path

`packages/pipeline/src/workers/run-process.ts` already extracts `digestHeadline` / `digestSummary` from `RankResult` and calls `archivesRepo.upsert(...)`. Extend:

- `RankResult` gets `hook: string` and `tldr: string`.
- `RunArchiveUpsertInput` gets `hook?: string | null` and `tldr?: string | null`.
- The worker passes them through alongside `digestHeadline` / `digestSummary`.
- `pickArchiveDigest` in `run-process.ts` keeps its existing `digestHeadline`/`digestSummary` fallback logic untouched; `hook` and `tldr` have no fallback (null if missing, social post just skips).

### Read path

Pipeline-side `RunArchivesRepo.findById` adds `hook: string | null` and `tldr: string | null` to `PipelineRunArchiveRow`.

API-side `RunArchivesRepo` adds the same fields to its `RunArchiveRow`, `RunArchiveDetail` types, and select projections. They flow through `GET /api/archives/:runId` (public) and `GET /api/admin/archives/:runId` (already wired by routing).

### Composer rewrite

`packages/pipeline/src/social/compose.ts` changes signature:

```ts
export interface RankedStory {
  title: string;
  summary: string;
}

export interface ComposeInput {
  hook: string | null;
  tldr: string | null;
  stories: RankedStory[];
  archiveUrl: string;
}

export interface ComposedPosts {
  linkedinText: string;
  twitterThread: string[];
}

export function composePosts(input: ComposeInput): ComposedPosts | null;
```

**Null guard:** if `hook` is null or blank, return null. `tldr` may be null — composer gracefully omits the TLDR line. `stories` may be empty — composer still emits hook + archive URL.

**LinkedIn output** (single post):

```
<hook>

TLDR: <tldr>

1) <story[0].title>
   <story[0].summary>

2) <story[1].title>
   <story[1].summary>

... every ranked story (no cap)

Full breakdown: <archiveUrl>
```

All ranked stories are included verbatim, in order. No story cap and no character-budget truncation — LinkedIn's 3000-char limit is more than enough for a typical 8–12-story digest. If the day's recaps ever balloon past 3000 chars, the LinkedIn API will reject the post and the failure surfaces in `social_metadata.linkedinError` via the existing path; we'll deal with it then.

**X/Twitter output** (`twitterThread: string[]`):

- Tweet 1: `<hook>\n\n<tldr>`. If combined > 280, drop tldr from this tweet (it lives in the LinkedIn post only — better to lose tldr than truncate the hook). Hook itself is bounded at ≤140 by the prompt so it's never solo-truncated.
- Tweets 2..N (one per ranked item, all of them): `N) <title>\n<summary>`. If a single tweet exceeds 280, truncate the summary with `…`. The `N)` prefix counts toward the limit.
- Final tweet: `Full breakdown: <archiveUrl>`.

### Twitter thread posting

Existing `TwitterApiClient.createPost({ accessToken, text })` becomes:

```ts
createPost({ accessToken, text, replyToTweetId?: string })
```

`twitter-api-v2` supports threading via `v2.tweet(text, { reply: { in_reply_to_tweet_id } })`. The notifier loops the `twitterThread` array, threading each tweet onto the previous one's `tweetId`. If any tweet after the first fails, the notifier logs the failure but keeps what was already posted (the run is marked `posted` with the first tweet's permalink — no rollback). `social_metadata.twitter.thread_ids` stores all successful tweet IDs.

Idempotency: only the first tweet's posting marks `twitter_posted_at`. If the worker retries after a partial-thread failure, `twitter_posted_at` is non-null → notifier short-circuits with `already_posted`. We don't try to "resume" a partial thread — that's a future-Aman problem if it ever happens; for now, partial threads stay partial.

### LinkedIn notifier

Trivial change — read `composed.linkedinText` from the new composer output. No structural change.

### Review-page editability

Out of scope for this cut. `hook` and `tldr` are LLM-only on first pass. If a value comes out bad, we re-run the day. Adding inline editing for them is a separate feature.

## External Dependencies & Fallback Chain

- `@ai-sdk/anthropic` + `ai` (already in use, no version change). The structured-output schema change is additive; the existing `generateObject` call returns the new fields automatically.
- `twitter-api-v2` (already in use). Thread support is documented and stable in the version we have. **Fallback:** if `in_reply_to_tweet_id` rejects on a given client version, post only the first tweet (today's behavior) and log a warning.

No new libraries.

## Open questions (resolved)

- Story count for LinkedIn and X: **all ranked items** on both platforms (no cap).
- `hook` and `tldr` editable on review page: **no** (deferred).
- Hashtags: **skipped this cut**.

## Risks

- **LLM omits the new fields.** Mitigated by making them required in the Zod schema — the AI SDK will retry up to `maxRetries: 2` (already configured). If validation still fails the run hard-errors, same as today.
- **Existing archives have null `hook` / `tldr`.** Social notifier already null-guards on `digestHeadline` (returns `skipped: no_headline`). Same pattern with `hook`.
- **Thread partial failure.** Documented above — we accept partial threads, mark `posted` on first tweet, store any successful tweet IDs. Manual retry not supported in v1.
- **Drizzle migration drift.** Generated via `db:generate`, applied via `db:migrate`. Nullable columns are zero-downtime.

## Files touched

| Layer | File | Change |
|---|---|---|
| Schema | `packages/shared/src/db/schema.ts` | Add `hook`, `tldr` columns |
| Migration | `packages/shared/src/db/migrations/0016_*.sql` | Generated |
| LLM | `packages/pipeline/src/processors/rank.ts` | Schema + RankResult |
| LLM | `packages/pipeline/src/processors/rank-prompts.ts` | Prompt block |
| Pipeline repo | `packages/pipeline/src/repositories/run-archives.ts` | Upsert/findById fields |
| Pipeline worker | `packages/pipeline/src/workers/run-process.ts` | Pass-through |
| Composer | `packages/pipeline/src/social/compose.ts` | Full rewrite |
| Twitter client | `packages/pipeline/src/social/twitter/api-client.ts` + `types.ts` | `replyToTweetId` param |
| Twitter notifier | `packages/pipeline/src/social/twitter/notifier.ts` | Thread loop, `thread_ids` metadata |
| LinkedIn notifier | `packages/pipeline/src/social/linkedin/notifier.ts` | Read new composer output |
| Shared types | `packages/shared/src/types/social-metadata.ts` (or equivalent) | `twitter.thread_ids?: string[]` |
| API repo | `packages/api/src/repositories/run-archives.ts` | Expose fields on read |
| API route | `packages/api/src/routes/archives.ts` | Pass through to detail response |
| Web API types | `packages/web/src/api/runs.ts` | `hook`/`tldr` on `RunStateResponse` |
| Tests | various | composer, rank schema, repo, notifier |

## Roll-out

Single PR. Nullable columns ship the schema; the prompt change starts populating values on the next run. Old archives stay null and the social notifier skips them with `no_headline` (existing behavior). No backfill needed.
