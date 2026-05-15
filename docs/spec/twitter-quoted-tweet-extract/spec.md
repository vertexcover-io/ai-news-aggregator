# SPEC: Twitter Quoted-Tweet Extraction

**Design doc:** `docs/plans/2026-05-15-twitter-quoted-tweet-extract-design.md`
**Library probe:** `docs/spec/twitter-quoted-tweet-extract/library-probe.md` — PASS

## Requirements (EARS format)

### R1 — `NormalizedTweet` exposes a structured quoted-tweet field
**WHEN** the Twitter client adapter denormalises a Rettiwt tweet that contains a `quoted` inner tweet,
**THE SYSTEM SHALL** populate `NormalizedTweet.quotedTweet` with `{ id, authorHandle, fullText, url, createdAt, photoUrls }` extracted from the inner tweet.

### R2 — Retweet-of-quote nesting
**WHEN** the Rettiwt tweet is a retweet (`retweetedTweet` present) **AND** the retweeted tweet itself has a `quoted` inner tweet,
**THE SYSTEM SHALL** extract that inner quote into `NormalizedTweet.quotedTweet`, after the existing retweet-unwrap step.

### R3 — Plain tweet unchanged
**WHEN** a Rettiwt tweet has neither `quoted` nor `retweetedTweet.quoted`,
**THE SYSTEM SHALL** leave `NormalizedTweet.quotedTweet` undefined and produce the same `RawItemInsert` shape as before this feature.

### R4 — Mapper appends quoted text to `RawItem.content`
**WHEN** `tweetToRawItem` receives a `NormalizedTweet` whose `quotedTweet` is set,
**THE SYSTEM SHALL** append a block of the form `\n\nQuoting @<authorHandle>: <fullText>` to the outer tweet's `fullText` and use the combined text as `RawItem.content`.

### R5 — Mapper writes structured `metadata.quotedTweet`
**WHEN** `tweetToRawItem` receives a `NormalizedTweet` whose `quotedTweet` is set,
**THE SYSTEM SHALL** include `quotedTweet` in `RawItem.metadata` alongside the existing `comments` field, preserving the exact `{ id, authorHandle, fullText, url, createdAt, photoUrls }` payload.

### R6 — Title source unchanged
**WHEN** `tweetToRawItem` runs,
**THE SYSTEM SHALL** derive `RawItem.title` solely from the outer tweet's `fullText` (no quoted text in title) so that dedup-key behaviour is unchanged.

### R7 — Link enrichment scope unchanged
**WHEN** the Twitter collector decides which external URL to expose on the `RawItem`,
**THE SYSTEM SHALL** continue to read `entities.urls` only from the outer (or retweet-unwrapped) tweet, ignoring `quotedTweet`'s URLs.

### R8 — `isQuote` flag semantics preserved
**WHEN** the adapter denormalises any Rettiwt tweet,
**THE SYSTEM SHALL** set `NormalizedTweet.isQuote = true` iff the outer envelope's `quoted` field is present (existing semantics retained — the feature does not change the meaning of `isQuote`).

### R9 — Backwards-compatible metadata
**WHEN** an existing `raw_items` row is read by any downstream consumer,
**THE SYSTEM SHALL** continue to function when `metadata.quotedTweet` is absent (i.e. for rows written before this feature). No migration is required.

## Out of scope

- Reddit/HN collector changes
- Ranker prompt or recap prompt changes
- Web UI changes (dashboard or archive views)
- Link enrichment of quoted-tweet URLs
- Quote chains deeper than depth 1 (we extract one level of quote; we do NOT recursively extract a quote inside a quote)
- Migration of historical `raw_items` rows to backfill `metadata.quotedTweet`

## Edge cases

| Case | Expected behaviour |
|---|---|
| Plain tweet (no `quoted`, no `retweetedTweet`) | `quotedTweet` undefined; content/metadata unchanged from current code |
| Retweet of a non-quote | `quotedTweet` undefined; existing retweet-unwrap behaviour preserved |
| Retweet of a quote-tweet | After retweet-unwrap, extract `inner.quoted` into `quotedTweet` |
| Quote of a deleted/protected tweet | API returns no `quoted` field → `quotedTweet` undefined, `isQuote` false. No special handling. |
| Quote where `fullText` is empty (media-only quote) | Content gets `\n\nQuoting @<handle>: ` (trailing empty). `photoUrls` preserved in metadata. |
| Quote where the quoted tweet itself has a `quoted` field (depth-2) | We extract only the direct quote (depth 1). The depth-2 quote is dropped — explicitly out of scope. |

## Verification Scenarios

### VS-0 — Live `rettiwt-api` `quoted` shape (re-runnable)
**Source:** `docs/spec/twitter-quoted-tweet-extract/probes/verification-stubs.md`
**Script:** `packages/pipeline/scripts/probes/probe-quoted-shape.mjs`
**Pass criteria:** Probe exits 0, log contains `PASS — quoted field shape verified`, all 4 required fields and 2 optional fields shape-match.
**Already verified once** in Stage 1.5 — `functional-verify` re-runs the probe to confirm no drift.

### VS-1 — Unit: client adapter extracts direct quote
Calling `denormalize()` (via the test export or via `fetchListTweets` with a stubbed `RettiwtFacade`) with a tweet that has `quoted` populated produces `NormalizedTweet.quotedTweet` with all six fields (`id`, `authorHandle`, `fullText`, `url`, `createdAt`, `photoUrls`) matching the inner tweet.

### VS-2 — Unit: client adapter extracts retweet-of-quote
Calling `denormalize()` with `{ retweetedTweet: { quoted: {...} } }` produces `NormalizedTweet.quotedTweet` matching the deepest inner tweet. Existing retweet-flatten behaviour (id/handle/text come from `retweetedTweet`, not the outer envelope) is preserved.

### VS-3 — Unit: client adapter leaves quotedTweet undefined for plain/non-quote tweets
Three sub-cases (plain tweet, retweet of non-quote, missing `quoted` field) all produce `quotedTweet: undefined`.

### VS-4 — Unit: mapper appends `Quoting @handle: …` to content
`tweetToRawItem` of a `NormalizedTweet` with `quotedTweet` set produces a `RawItemInsert` whose `content` equals the outer `fullText` + `\n\nQuoting @<handle>: <quotedFullText>`. Title still derives from outer text only (no quoted text in title).

### VS-5 — Unit: mapper writes `metadata.quotedTweet`
The same `tweetToRawItem` call writes `quotedTweet` into `metadata` with the exact six-field payload, alongside the existing `comments: []` field.

### VS-6 — Unit: mapper unchanged for plain tweets
A `NormalizedTweet` with `quotedTweet === undefined` produces the same `RawItemInsert` as the pre-feature code (same content, same metadata).

### VS-7 — `isQuote` flag semantics preserved
For all four denormalize cases (plain, retweet, direct quote, retweet-of-quote), `NormalizedTweet.isQuote` is `true` iff the outer envelope had a `quoted` field — i.e. existing semantics. (Note: in the retweet-of-quote case, the outer envelope is the retweet wrapper and does not itself have a top-level `quoted`, so `isQuote` is false for that case under the current rule. This documents the trade-off; we do not change `isQuote` semantics.)

## Acceptance summary

The feature is complete when:
- All 8 unit-test scenarios (VS-1 .. VS-7, plus the existing test suite) pass.
- The library probe (VS-0) still PASSes when re-run.
- `pnpm --filter @newsletter/pipeline typecheck`, `lint`, and `test:unit` all pass (matching baseline).
- No changes to files outside `packages/pipeline/src/collectors/twitter/` and its test directory (except possibly newly-added test fixtures).
