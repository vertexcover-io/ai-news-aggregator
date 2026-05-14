# SPEC — Social `hook` digest field

Linked design: `../../plans/2026-05-14-social-hook-tldr-fields-design.md`

> Note: this feature originally included a second field, `tldr`, but it was removed before merge — the LLM output was too floral and didn't read well on social. Only `hook` ships.

## Requirements (EARS)

### LLM digest field

- **REQ-001** — *When* the stage-2 reranker (`rankCandidates`) finishes successfully, *then* its returned `RankResult` *shall* include a `hook: string` field in addition to the existing `digestHeadline` and `digestSummary`.
- **REQ-002** — *When* the rank LLM call returns, *then* the `digestSchema` Zod schema *shall* require `hook` as a non-empty string; if the LLM omits it, the AI SDK retry path applies (`maxRetries: 2`), and on final failure the rank step throws — same behaviour as missing `digest.headline` today.
- **REQ-003** — *When* the rank prompt is constructed, *then* it *shall* include instructions that bound `hook` to ≤140 characters with no clickbait/questions/editorial-filler.

### Storage

- **REQ-010** — *When* the schema is applied, *then* `run_archives` *shall* have a new nullable text column: `hook`. Pre-existing rows *shall* read back `null`.
- **REQ-011** — *When* `RunArchivesRepo.upsert` is called from `run-process`, *then* the persisted row *shall* store `hook` from the rank result. If the rank result field is blank or whitespace, the column *shall* be persisted as `null`.

### Read path

- **REQ-020** — *When* `GET /api/archives/:runId` (public) returns an archive detail, *then* the response body *shall* include `hook: string | null`.
- **REQ-021** — *When* the pipeline's `RunArchivesRepo.findById` returns a row, *then* the `PipelineRunArchiveRow` *shall* include `hook: string | null` so the social notifiers can read it.

### Composer

- **REQ-030** — *When* `composePosts({ hook, stories, archiveUrl })` is called with a null or whitespace-only `hook`, *then* it *shall* return `null`.
- **REQ-031** — *When* `composePosts` is called with a non-null `hook`, *then* the returned `linkedinText` *shall* start with `<hook>\n\n1) <first story>…`.
- **REQ-032** — *When* the LinkedIn body is assembled, *then* it *shall* include every ranked story in `stories` in order, formatted as `N) <title>\n   <summary>`, separated by blank lines, *and* end with `\n\nFull breakdown: <archiveUrl>`. No story cap; no truncation.
- **REQ-034** — *When* `composePosts` returns a non-null result, *then* `twitterThread` *shall* be a non-empty `string[]` whose first element is exactly `hook`, and whose last element is exactly `Full breakdown: <archiveUrl>`.
- **REQ-035** — *When* the thread is assembled, *then* tweets 2..(N-1) *shall* each correspond to one ranked story in `stories`, formatted as `N) <title>\n<summary>`, truncated with `…` if the formatted tweet would exceed 280 characters.
- **REQ-036** — *When* `stories` is empty, *then* `twitterThread` *shall* contain exactly two elements: the hook and the archive-URL closer.

### Twitter API client

- **REQ-040** — *When* `TwitterApiClient.createPost` is called with `replyToTweetId` set, *then* the call *shall* post the tweet as a reply to that tweet ID (using `twitter-api-v2`'s `reply: { in_reply_to_tweet_id }` option). When `replyToTweetId` is undefined, the call posts a standalone tweet (current behaviour).

### Twitter notifier

- **REQ-050** — *When* the Twitter notifier composes successfully and acquires a token, *then* it *shall* post each tweet in `twitterThread` in order, threading each subsequent tweet onto the previous successful tweet's ID.
- **REQ-051** — *When* the first tweet posts successfully, *then* the run *shall* be marked `twitter_posted_at = now()` and `social_metadata.twitter.permalink = <first tweet URL>`, regardless of whether subsequent thread tweets succeed.
- **REQ-052** — *When* one or more thread tweets post successfully, *then* their IDs *shall* be persisted to `social_metadata.twitter.thread_ids: string[]`.
- **REQ-053** — *When* a non-first thread tweet fails, *then* the notifier *shall* log the failure with the tweet index and stop posting further tweets in the thread; the notifier *shall* still return `{ status: "posted", permalink: <first tweet URL> }` because the headline tweet went live.
- **REQ-054** — *When* the notifier is re-invoked for a run that already has `twitter_posted_at` set, *then* it *shall* short-circuit with `{ status: "skipped", reason: "already_posted" }` (no thread-resume logic).

### LinkedIn notifier

- **REQ-060** — *When* the LinkedIn notifier composes successfully, *then* it *shall* call `apiClient.createPost` with `text: composed.linkedinText`. Existing token, retry, and idempotency behaviour is unchanged.

## Acceptance Criteria (testable)

| ID | Test | Layer |
|---|---|---|
| AC-001 | Rank Zod schema rejects digest payload missing `hook`. | unit (`rank.test.ts`) |
| AC-002 | Rank Zod schema accepts digest payload with `hook` populated. | unit |
| AC-003 | Drizzle migration adds `hook text` column; nullable. | migration inspection |
| AC-004 | Pipeline upsert persists `hook`; blank/whitespace stored as `null`. | unit (`run-archives.test.ts`) |
| AC-005 | API `GET /api/archives/:runId` exposes `hook` in JSON. | unit (api route) |
| AC-006 | `composePosts` returns `null` when `hook` is null/blank. | unit (`compose.test.ts`) |
| AC-007 | `composePosts` LinkedIn output contains hook, every ranked story, and `Full breakdown: <url>`. | unit |
| AC-009 | `composePosts` Twitter thread first tweet = hook; per-story tweets formatted `N) title\nsummary`; final tweet `Full breakdown: <url>`. | unit |
| AC-010 | Per-story Twitter tweet truncates summary with `…` when over 280. | unit |
| AC-011 | Twitter notifier threads tweets using `replyToTweetId`. | unit (`twitter/notifier.test.ts`) |
| AC-012 | Twitter notifier persists `social_metadata.twitter.thread_ids` after a successful thread. | unit |
| AC-013 | Twitter notifier marks `posted` with first tweet's permalink even when a later tweet fails. | unit |
| AC-014 | LinkedIn notifier passes `composed.linkedinText` (long-form) to `createPost`. | unit (`linkedin/notifier.test.ts`) |
| AC-015 | `pnpm typecheck` passes across all packages. | gate |
| AC-016 | `pnpm lint` passes across all packages. | gate |
| AC-017 | `pnpm test:unit` passes across all packages. | gate |

## Verification Scenarios

**VS-1 — Rank pipeline writes hook.**
Stub `generateObject` to return a fixed digest with `hook`. Run `rankCandidates` over a fixture shortlist. Assert `RankResult` contains the field verbatim and `upsert` is called with it.

**VS-2 — Composer LinkedIn end-to-end.**
Call `composePosts` with a fixture (1 hook, 8 stories, URL). Assert the body matches the template byte-for-byte.

**VS-3 — Twitter thread shape.**
Call `composePosts` with 12 stories. Assert `twitterThread.length === 14` (1 opener + 12 stories + 1 closer), every element ≤280 chars, opener is the hook, closer is the archive URL.

**VS-4 — Twitter notifier threading.**
Mock `apiClient.createPost` to capture calls. Run the notifier on a fixture archive with `hook` + 3 stories. Assert 5 createPost calls in order; the 2nd–5th carry `replyToTweetId` pointing at the previous tweet's ID.
