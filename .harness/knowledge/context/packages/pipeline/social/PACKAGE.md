---
governs: packages/pipeline/src/social/
last_verified_sha: ad0153a
key_files: [types.ts, compose.ts, utils.ts, cli-helpers.ts]
flow_fns: [compose.ts::composePosts]
decisions: [D-100]
status: active
---

# social/ — platform-agnostic message composition and OAuth bootstrap helpers

## Purpose
Shared utilities for composing LinkedIn and X/Twitter post text from newsletter digests, plus OAuth PKCE/URL-building helpers used by the admin OAuth flows. Platform-specific API clients and notifiers live in `social/linkedin/` and `social/twitter/`.

## Public surface
- `composePosts(input)` → `ComposedPosts | null` — builds LinkedIn + Twitter post text from stories + digest meta
- `twitterWeightedLength(value)` → `number` — counts chars with URLs counting as 23 (Twitter's t.co weight)
- `buildLinkedInAuthorizeUrl(args)` → `string` — constructs LinkedIn OAuth authorize URL
- `buildTwitterAuthorizeUrl(args)` → `string` — constructs Twitter OAuth 2.0 authorize URL with PKCE
- `generatePkcePair()` → `PkcePair` — S256 code verifier + challenge
- `parseTokenResponse(json)` → `ParseTokenResponseResult` — validates OAuth token response shape
- `truncate(value)` → `string` — caps string at 500 chars for error logging
- `SocialResult` type — `{ status: "posted" | "skipped" | "failed", ... }`

## Depends on / used by
- Uses: `@newsletter/shared/constants` (buildLinkedinPostBody, DEFAULT_LINKEDIN_HOOK), `node:crypto`
- Used by: `social/linkedin/notifier.ts`, `social/twitter/notifier.ts`, `@newsletter/api` (admin OAuth routes)

## Data flows

### composePosts(input) → ComposedPosts | null
  input { heading, hook, linkedinPostBody, twitterSummary, twitterIsPremium, stories }
    → normalize all nullable strings
      → LinkedIn:
        ├─ linkedinPostBody present → use verbatim
        └─ else → stories.length > 0 → buildLinkedinPostBody(hook, stories) [from shared constants]
                 → null (no usable stories)
      → Twitter:
        ├─ premium → heading + summary + "Also inside:" story list (max 3) + "Full breakdown ↓"
        ├─ free → summary + "Full breakdown ↓" (no story titles)
        └─ free + weightedLength > 280 → { ok: false, reason: "free_plan_over_limit" }
      → return null only when BOTH linkedinText is null AND twitter has nothing to render

## Gotchas / landmines
- **Archive URL is NEVER in the post body**: Both LinkedIn and Twitter posts end with "Full breakdown ↓" as a teaser. The actual archive URL is posted as a separate comment (LinkedIn) or reply tweet (Twitter) by the notifier — outbound links in post bodies penalize reach on both platforms. (D-100)
- **LinkedIn body uses LTF escaping**: The `linkedinPostBody` from admin override is passed verbatim to `escapeLittleText()` — but the compose function does NOT escape; escaping happens in `api-client.ts::createPost`.
- **Twitter free-plan length check**: Non-premium accounts get a 280-char check with URL-weighted counting. If over, the notifier records a social failure instead of posting truncated text.

## Decisions
- **D-100**: Separate post body + comment/reply for archive link. Why: outbound links in social post bodies are algorithmically penalized. Posting the link as a follow-up comment/reply keeps the head post clean while still making the archive accessible. Tradeoff: the notifier must make two API calls per platform (head post + comment/reply), doubling the chance of a partial failure. Governs: `social/compose.ts`, `social/linkedin/notifier.ts`, `social/twitter/notifier.ts`.
