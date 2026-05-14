# Design — Social `hook` digest field

Date: 2026-05-14
Owner: Aman
Linear: (n/a — internal)

> **History note.** Earlier drafts of this design included a second LLM field, `tldr`, intended for a 2–3 sentence sweep at the top of the social post. After running it end-to-end the output read like marketing copy and was dropped before merge. The implementation, schema, and tests below describe the final shape: **`hook` only**.

## Problem

The LinkedIn and X (Twitter) auto-posts that fire after `newsletter-send` currently consist of three lines:

```
<digest_headline>

<digest_summary>

<archive_url>
```

That copy is fine as a one-shot but doesn't pull readers in, and it doesn't preview the day's actual stories. For LinkedIn we want a real "blog-post-shaped" body — a hook, a numbered list of stories, a promo line. For X we want a thread with one tweet per story instead of a single truncated post.

The per-story copy we need (`recap.title`, `recap.summary`) is already generated and stored on `raw_items.metadata.recap`. What's missing at the digest level is one piece of LLM-written prose tuned for social — a punchy news-hook opener — distinct from the existing `digest_headline` / `digest_summary` which serve the archive UI and listing page.

## Goals

1. Generate one new digest-level field from the existing stage-2 rerank LLM call:
   - **`hook`** — one news-hook sentence (≤140 chars) for the top-of-post opener.
2. Persist it on `run_archives` (nullable).
3. Expose it on the archive API responses (public + admin).
4. Rewrite `composePosts` to emit a long-form LinkedIn body (all ranked stories, no cap) and a Twitter thread array (all ranked stories, one per tweet) using the new field plus per-story `recap.title` / `recap.summary`.
5. Switch the Twitter notifier to post a chained thread (each tweet replies to the previous).

## Non-goals

- Do **not** change `digest_headline` / `digest_summary` semantics, content, or storage.
- Do **not** change archive UI rendering (`/archive/:runId`, listing `/`).
- Do **not** add hashtag generation.
- Do **not** touch OAuth, the fan-out trigger from `newsletter-send`, or the existing `social_metadata` idempotency plumbing.
- Do **not** add review-page editing for `hook` (deferred — re-run the day if it's bad).

## Architecture

### Field placement

`hook` lives at the **digest level**, a peer of `digest_headline` / `digest_summary`. It is not per-story. It is written by the same LLM call that produces the digest fields today, in a single round trip — no second LLM call.

### LLM schema change

In `packages/pipeline/src/processors/rank.ts`, extend `digestSchema`:

```ts
const digestSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  hook: z.string(),
});
```

In `packages/pipeline/src/processors/rank-prompts.ts`, append a new section after the existing digest block:

```
Also return a social-post hook on the same `digest` object, written for LinkedIn and X:
- digest.hook: ONE sentence that opens the social post. Lead with the day's biggest shift, framed as a news hook. ≤140 chars. No clickbait, no questions, no editorial filler ("quietly", "finally"). End with a single period and nothing else.
```

The existing `digest.headline` and `digest.summary` instructions stay verbatim. `hook` is required (not `.optional()`) so the LLM always emits it.

### Storage

`run_archives` adds one nullable text column:

```ts
hook: text("hook"),
```

Nullable so old archives keep working — identical pattern to VER-96's `digest_headline` / `digest_summary`.

Migration generated via `pnpm --filter @newsletter/shared db:generate`. Lands as `0016_add_hook.sql`.

### Write path

`packages/pipeline/src/workers/run-process.ts` already extracts `digestHeadline` / `digestSummary` from `RankResult` and calls `archivesRepo.upsert(...)`. Extend:

- `RankResult` gets `hook: string`.
- `RunArchiveUpsertInput` gets `hook?: string | null`.
- The worker passes it through alongside `digestHeadline` / `digestSummary`.
- `pickArchiveDigest` in `run-process.ts` keeps its existing fallback logic untouched; `hook` has no fallback (null if missing, social post just skips).

### Read path

Pipeline-side `RunArchivesRepo.findById` adds `hook: string | null` to `PipelineRunArchiveRow`.

API-side `RunArchivesRepo` adds the same field to its `RunArchiveRow` and select projections. It flows through `GET /api/archives/:runId` (public) and `GET /api/admin/archives/:runId`.

### Composer rewrite

`packages/pipeline/src/social/compose.ts` changes signature:

```ts
export interface RankedStory {
  title: string;
  summary: string;
}

export interface ComposeInput {
  hook: string | null;
  stories: RankedStory[];
  archiveUrl: string;
}

export interface ComposedPosts {
  linkedinText: string;
  twitterThread: string[];
}

export function composePosts(input: ComposeInput): ComposedPosts | null;
```

**Null guard:** if `hook` is null or blank, return null. `stories` may be empty — composer still emits hook + archive URL.

**LinkedIn output** (single post):

```
<hook>

1) <story[0].title>
   <story[0].summary>

2) <story[1].title>
   <story[1].summary>

... every ranked story (no cap)

Full breakdown: <archiveUrl>
```

All ranked stories are included verbatim, in order. No cap and no character-budget truncation — LinkedIn's 3000-char limit is more than enough for a typical 8–12-story digest. If the day's recaps ever balloon past 3000 chars, the LinkedIn API will reject the post and the failure surfaces in `social_metadata.linkedinError`.

**X/Twitter output** (`twitterThread: string[]`):

- Tweet 1: `<hook>`. Hook is bounded at ≤140 by the prompt so it always fits.
- Tweets 2..N (one per ranked item, all of them): `N) <title>\n<summary>`. If a single tweet exceeds 280, truncate the summary with `…`. The `N)` prefix counts toward the limit.
- Final tweet: `Full breakdown: <archiveUrl>`.

### Twitter thread posting

Existing `TwitterApiClient.createPost({ accessToken, text })` becomes:

```ts
createPost({ accessToken, text, replyToTweetId?: string })
```

`twitter-api-v2` supports threading via `v2.tweet(text, { reply: { in_reply_to_tweet_id } })`. The notifier loops the `twitterThread` array, threading each tweet onto the previous one's `tweetId`. If any tweet after the first fails, the notifier logs the failure but keeps what was already posted (the run is marked `posted` with the first tweet's permalink — no rollback). `social_metadata.twitter.thread_ids` stores all successful tweet IDs.

Idempotency: only the first tweet's posting marks `twitter_posted_at`. If the worker retries after a partial-thread failure, `twitter_posted_at` is non-null → notifier short-circuits with `already_posted`. Partial threads stay partial.

### LinkedIn notifier

Trivial change — read `composed.linkedinText` from the new composer output. No structural change.

## External Dependencies & Fallback Chain

- `@ai-sdk/anthropic` + `ai` (already in use, no version change). The structured-output schema change is additive.
- `twitter-api-v2` (already in use). Thread support is documented and stable. **Fallback:** if `in_reply_to_tweet_id` rejects on a given client version, post only the first tweet and log a warning.

No new libraries.

## Open questions (resolved)

- Story count for LinkedIn and X: **all ranked items** on both platforms (no cap).
- Editable on review page: **no** (deferred).
- Hashtags: **skipped this cut**.
- `tldr` field: **dropped before merge** — output read like marketing copy.

## Risks

- **LLM omits `hook`.** Mitigated by making it required in the Zod schema — AI SDK retries up to `maxRetries: 2`. If validation still fails the run hard-errors, same as today.
- **Existing archives have null `hook`.** Social notifier already null-guards on `digestHeadline` (returns `skipped: no_headline`). Same pattern with `hook`.
- **Thread partial failure.** Documented above — we accept partial threads, mark `posted` on first tweet, store any successful tweet IDs. Manual retry not supported in v1.
- **LinkedIn body over 3000 chars on heavy days.** Notifier surfaces the LinkedIn API rejection in `social_metadata.linkedinError`. We'll add soft truncation if it actually happens.
- **Drizzle migration drift.** Generated via `db:generate`, applied via `db:migrate`. Nullable column is zero-downtime.

## Files touched

| Layer | File | Change |
|---|---|---|
| Schema | `packages/shared/src/db/schema.ts` | Add `hook` column |
| Migration | `packages/shared/src/db/migrations/0016_add_hook.sql` | Generated |
| LLM | `packages/pipeline/src/processors/rank.ts` | Schema + RankResult |
| LLM | `packages/pipeline/src/processors/rank-prompts.ts` | Prompt block |
| Pipeline repo | `packages/pipeline/src/repositories/run-archives.ts` | Upsert/findById field |
| Pipeline worker | `packages/pipeline/src/workers/run-process.ts` | Pass-through |
| Composer | `packages/pipeline/src/social/compose.ts` | Full rewrite |
| Twitter client | `packages/pipeline/src/social/twitter/api-client.ts` + `types.ts` | `replyToTweetId` param |
| Twitter notifier | `packages/pipeline/src/social/twitter/notifier.ts` | Thread loop, `thread_ids` metadata |
| LinkedIn notifier | `packages/pipeline/src/social/linkedin/notifier.ts` | Read new composer output |
| Shared types | `packages/shared/src/types/index.ts` | `SocialMetadata.twitterThreadIds` |
| API repo | `packages/api/src/repositories/run-archives.ts` | Expose `hook` on read |
| API route | `packages/api/src/routes/archives.ts` | Pass `hook` through to detail response |
| Web API types | `packages/web/src/api/runs.ts` | `hook` on `RunStateResponse` |
| Tests | various | composer, rank schema, repo, notifier |

## Roll-out

Single PR. Nullable column ships the schema; the prompt change starts populating values on the next run. Old archives stay null and the social notifier skips them with `no_headline` (existing behavior). No backfill needed.
