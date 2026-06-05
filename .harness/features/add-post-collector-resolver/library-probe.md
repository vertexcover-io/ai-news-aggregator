# Library Probe: add-post-collector-resolver

<!-- LP:VERDICT:PASS -->

## Summary

Single external dependency: **`rettiwt-api@7.0.3`** (already in repo). The probe confirms the SDK contract we depend on still holds, and the cookie refresh / retry strategy in the bulk collector works for the new add-post call too.

| Library | Use case | Verdict |
|---|---|---|
| `rettiwt-api` | `rettiwt.tweet.details(id)` — single-tweet read | **VERIFIED** (after CSRF refresh) |

## Probe scenarios

### VS-LP-1: `tweet.details(<valid id>)` returns a populated `Tweet`

Initial call with the env-supplied `RETTIWT_API_KEY` failed with 403 ("Request failed with status code 403"). This is the **stale-cookie / stale-CSRF** symptom the bulk collector already handles. After a CSRF refresh via `AuthService.refreshCsrfToken(config)` (the same call `refreshRettiwtCsrfToken` uses), the cookie was rotated (length 392 → 388) and the second call to `tweet.details("20")` succeeded.

Captured tweet shape (top-level keys):
```
['_raw', 'bookmarkCount', 'conversationId', 'createdAt', 'entities',
 'fullText', 'id', 'lang', 'likeCount', 'media', 'quoteCount', 'quoted',
 'replyCount', 'replyTo', 'retweetCount', 'retweetedTweet', 'tweetBy',
 'url', 'viewCount']
```

This is a **superset** of the fields `RettiwtRawTweet` declares — `denormalize()` only reads `id`, `fullText`, `createdAt`, `tweetBy`, `likeCount`, `retweetCount`, `replyCount`, `quoteCount`, `media`, `entities`, `retweetedTweet`, `quoted`. All present. **Contract holds.**

### VS-LP-2: `tweet.details(<invalid id>)` behavior

After CSRF refresh, behavior with the live cookie:

| Input id | Result |
|---|---|
| `"1"` | Returns `undefined` (treat as 404) |
| `"1234567890"` | Returns a valid old tweet (this id happens to exist) |
| `"999999999999999999999"` (out-of-range) | **Throws** `Error("Unknown error")` with `status: undefined` |

**Implication for the design:** `fetchTwitterPost` must treat both `null`/`undefined` AND a thrown error as failure cases. The implementation already does — `null` → `NotFoundError`, thrown → caught by the outer try/catch and surfaced as a 502 with the tweet ID in the message.

### VS-LP-3: Bad cookie behavior

`new Rettiwt({ apiKey: "INVALID_BOGUS_KEY_FOR_PROBE" })` throws **synchronously at construction**:

```
Error: Invalid authentication data
    at AuthService.getUserId
    at new RettiwtConfig
    at new Rettiwt
```

**Implication for the design:** The Rettiwt constructor is not safe to call inside a `try` block that catches only async errors — it can throw synchronously when the cookie shape is invalid. Wrap construction in the same `try`/`catch` block as the call. (The existing bulk collector already does this implicitly by constructing once at worker startup; for the add-post per-call path we construct per call, so the catch must include construction.)

## Verification stubs (folded into spec verification scenarios)

The probe artifacts and verification stubs live at:

- `.harness/add-post-collector-resolver/probes/rettiwt-tweet-details.mjs` — the probe script (gitignored working state)
- `.harness/add-post-collector-resolver/probes/rettiwt-tweet-details.live.log` — captured probe output (gitignored)
- `docs/spec/add-post-collector-resolver/verification/verification-stubs.md` — the committed verification scenarios (next file)

## Selected dependency

`rettiwt-api@7.0.3` — **already pinned** in `packages/pipeline/package.json`. No new install required.

## Alternatives tried

None needed — the primary path (rettiwt + CSRF refresh + retry) is the same one the bulk collector already uses in production. The fallback chain in `design.md` (cookies missing → typed error to operator → long-term swap to paid X API v2) is documented but does not need to be exercised in this spec.

## Risks confirmed by probe

1. **Cookies expire silently.** First call after a long idle period commonly fails 403. The CSRF refresh + retry strategy works — must be implemented in `fetchTwitterPost`.
2. **Malformed-id behavior is inconsistent.** Some invalid ids return `undefined`, others throw. Both paths must be handled.
3. **Construction-time auth check.** `new Rettiwt({ apiKey })` validates the cookie shape eagerly — the per-call construction path needs a synchronous-error catch.

These three are now requirements in the spec.
