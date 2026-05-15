# Twitter Quoted-Tweet Extraction — Design

**Date:** 2026-05-15
**Status:** Approved (user-confirmed scope before brainstorm)
**Linear:** (no ticket — internal feature)
**Authoritative SPEC:** `docs/spec/twitter-quoted-tweet-extract/spec.md`

## Problem

The Twitter collector (`packages/pipeline/src/collectors/twitter/`) currently drops the content of a quoted tweet on the floor. `denormalize()` already flags `isQuote: true` when the outer tweet has a `quoted` field, but neither the inner text, the inner author, nor the inner URL are ever surfaced. Downstream consumers — most importantly the stage-2 reranker and the recap LLM — only see the outer commentary tweet, which is often the *less* informative half of a quote-tweet pair ("This is huge 🔥" + a quoted research-paper announcement). As a result the model can't rank or summarise the underlying signal.

## Goal

Extract the quoted tweet's content and surface it to downstream stages so ranking and recap reason over both the outer commentary and the quoted source.

## Scope (user-confirmed)

| Decision | Choice |
|---|---|
| Storage shape | Append `Quoting @handle: …` block to `RawItem.content` **and** store structured `metadata.quotedTweet` |
| Nesting | Unwrap retweet first, then extract quote (matches existing retweet behaviour in `denormalize`) |
| Link enrichment | Outer tweet only — quoted URLs stored in metadata but not fetched |
| Title source | Outer tweet only (unchanged) |

**Out of scope:** Reddit/HN collectors, ranker prompt, web UI, link enrichment of quoted URLs, multi-level quote chains beyond depth 1.

## Approach

Three layers, in dependency order:

1. **Type (`twitter/types.ts`)** — extend `NormalizedTweet` with `quotedTweet?: QuotedTweet` (id, authorHandle, fullText, url, createdAt, photoUrls). `isQuote` semantics unchanged.
2. **Client adapter (`twitter/clients/rettiwt.ts`)** — in `denormalize()`, after `inner = t.retweetedTweet ?? t`, also denormalise `inner.quoted` (if present) into the new `QuotedTweet` shape. Reuse the same photo-URL extraction logic. Recursion is depth-bounded to 1 — we do not extract a quote inside a quote.
3. **Mapper (`twitter/map.ts`)** — when `t.quotedTweet` is set:
   - **Content:** append `\n\nQuoting @<handle>: <fullText>` to the outer `fullText` before passing to `tweetToRawItem`'s content field. Title still derived from outer text only (preserves dedup behaviour).
   - **Metadata:** add `quotedTweet` alongside the existing `comments` field.

### Key invariants

- **Title stays from outer tweet.** Dedup keys on title prefix; changing this would re-shuffle existing dedup behaviour.
- **`isRetweet`/`isQuote` flags unchanged.** Existing consumers that branch on them keep working.
- **Link enrichment unchanged.** `pickExternalUrl` still reads `inner.entities.urls` from the outer (or retweet-unwrapped) tweet. Quoted entities are not consulted.
- **Engagement metrics unchanged.** Likes/retweets/replies/quotes still come from the outer (or retweet-unwrapped) layer.

### Edge cases

- **Plain tweet (no quote, no retweet):** unchanged path, `quotedTweet` is undefined.
- **Retweet of a non-quote:** unchanged path (unwrap retweet, no quote on the unwrapped tweet).
- **Retweet of a quote-tweet:** unwrap retweet to inner tweet, then extract `inner.quoted`. Quoted content surfaces with the retweeter's commentary attribution stripped (consistent with existing retweet flattening).
- **Quote of a deleted/protected tweet:** `quoted` field absent from API response → nothing extracted, `isQuote` stays false. No special handling needed.
- **Quote with media but no text:** `fullText: ""` is rendered as `Quoting @handle: ` (empty trailer). `photoUrls` preserved in metadata. Acceptable — ranker can still use the author handle and photo as signal.

## External Dependencies & Fallback Chain

| Dependency | Version | What we use | Confidence | Fallback |
|---|---|---|---|---|
| `rettiwt-api` (already in `packages/pipeline/package.json`) | 7.0.3 | `ITweet.quoted?: ITweet` (typed projection — already in our `RettiwtRawTweet`) | **High — type declared in `dist/types/data/Tweet.d.ts:30`** | None needed (we already use the library; no new dep) |

**Library-probe expectations:** Verify that a real Rettiwt fetch returns a `quoted` populated with the expected shape (`id`, `fullText`, `tweetBy.userName`, `createdAt`) for a known public quote tweet. If the live shape diverges from the `.d.ts` declaration, narrow the projection accordingly.

**No new packages required.** No fallback chain needed because `rettiwt-api` is already the chosen Twitter source and the field is part of its stable public surface.

## Verification

- **Unit (mapper):** outer + quoted text appears in `RawItem.content`; `metadata.quotedTweet` matches inner; title still from outer; plain-tweet case unchanged.
- **Unit (client):** `denormalize` populates `quotedTweet` when input has `quoted`; populates `quotedTweet` when input is a retweet-of-quote; leaves `quotedTweet` undefined for plain and retweet-of-non-quote.
- **Library probe:** live Rettiwt call returns the documented `quoted` shape (VS-0 in spec).

## Risks

- **Title-prefix dedup interaction.** Dedup uses outer title (unchanged), so existing behaviour is preserved. If we later want quoted text to influence dedup, that's a separate change.
- **Ranker prompt scope.** Ranker reads `content`; appending quoted text means the model sees longer documents. With current token budgets and tweet length caps, the increase is bounded (≤ ~280 chars extra per quote tweet). No prompt changes required.
- **Backwards compatibility for stored items.** New `metadata.quotedTweet` is optional and additive; existing `raw_items` rows without it continue to work. No migration needed.
