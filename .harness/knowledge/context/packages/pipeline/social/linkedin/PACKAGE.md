---
governs: packages/pipeline/src/social/linkedin/
last_verified_sha: f7d27361d5e1390adf9561d55d413e75457b584c
key_files: [index.ts, notifier.ts, api-client.ts, oauth.ts, little-text.ts, types.ts]
flow_fns: [notifier.ts::createLinkedInNotifier.notifyArchiveReady, oauth.ts::refreshLinkedInToken]
decisions: [D-114, D-109, D-121]
status: active
---

# social/linkedin/ — LinkedIn auto-post via Posts API with OAuth token management

## Purpose
Posts the daily digest headline + story bullets to LinkedIn, then posts the archive URL as a follow-up comment. Manages OAuth 2.0 token refresh with row-level locking to prevent parallel-refresh races. The `little-text.ts` module escapes LinkedIn's Little Text Format reserved characters to prevent silent post truncation.

## Public surface
- `createLinkedInNotifier(deps)` → `LinkedInNotifier` — `notifyArchiveReady({ runId })` orchestrates token acquisition, post creation, comment creation, and archive marking
- `createLinkedInApiClient(options?)` → `LinkedInApiClient` — `createPost`, `createComment` (low-level REST API calls)
- `refreshLinkedInToken(input, fetchFn?)` → `LinkedInRefreshResult` — token refresh against LinkedIn's OAuth endpoint
- `escapeLittleText(text)` → `string` — escapes reserved LTF characters (from `little-text.ts`)

## Depends on / used by
- Uses: `@pipeline/repositories/run-archives`, `@pipeline/repositories/raw-items`, `@pipeline/repositories/social-tokens`, `@pipeline/social/compose`, `@pipeline/social/types`, `@newsletter/shared/utils` (withUtmSource)
- Used by: `workers/processing.ts::buildDefaultPublishDeps`, `workers/linkedin-post.ts`

## Data flows

### notifyArchiveReady({ runId }) → SocialResult
  runId → archives.findById
    ├─ null / already posted (linkedinPostedAt !== null) → skip
    └─ ok → buildStories (resolve recap titles/summaries) → composePosts
        → withUtmSource(baseUrl/archive/runId, "linkedin") → archiveUrl  (D-121)
        → token acquisition:
          tokens.withTokenLock("linkedin") → FOR UPDATE row lock
            ├─ no token → skip "no_token"
            ├─ no personUrn → fail "no_person_urn"
            ├─ not expired (with 60s skew) → use stored accessToken
            └─ expired → refreshLinkedInToken → save refreshed token → use new accessToken
        → apiClient.createPost(text, accessToken, personUrn)
          ├─ ok → apiClient.createComment(postUrn, archiveUrl) [best-effort; failure logged not fatal]
          │        → archives.markLinkedInPosted(runId, now, postUrn)
          │        → return { status: "posted", permalink: postUrn }
          ├─ 401/403 → force re-acquire token (refresh) → retry createPost once
          ├─ 422 DUPLICATE_POST → markLinkedInPosted(null permalink) → return "posted"
          └─ other → archives.recordSocialFailure → return "failed"

### refreshLinkedInToken(input, fetchFn?) → LinkedInRefreshResult
  input { clientId, clientSecret, refreshToken }
    → POST https://www.linkedin.com/oauth/v2/accessToken
      → grant_type=refresh_token
        ├─ 200 → parse access_token, expires_in, refresh_token (or reuse old)
        │        → { ok: true, accessToken, refreshToken, expiresAt }
        └─ !200 / parse error → { ok: false, status, body }

## Gotchas / landmines
- **LTF escaping is post-only**: `createPost` applies `escapeLittleText()` to the commentary. `createComment` does NOT escape because comment text is plain text, not Little Text Format. (D-114)
- **Token refresh racing prevented by FOR UPDATE**: `withTokenLock` uses `SELECT ... FOR UPDATE` inside a transaction. Two concurrent jobs refreshing the same token serialize — the second sees the first's updated row. (D-109)
- **No refresh_token → hard fail**: LinkedIn apps without "Programmatic refresh tokens" enabled never get a `refresh_token`. The notifier detects this (`row.refreshToken === ""`) and returns `"refresh_unavailable"` instead of calling the refresh endpoint with an empty string.
- **Comment failure doesn't block post**: The archive link comment is best-effort. A failed comment logs a warning but the head post is still marked as posted.

## Decisions
- **D-114**: LTF escaping in `createPost` only. Why: LinkedIn's Posts API parses commentary as Little Text Format; unescaped reserved chars (including `)` in `"1)"`) silently truncate the post. Comments use the `message.text` field which is plain text. Tradeoff: the escape function must stay in sync with LinkedIn's LTF spec. Governs: `social/linkedin/api-client.ts`, `social/linkedin/little-text.ts`. (renumbered from D-110 — that id is now the cross-package collector-health decision in root DECISIONS.md.)
- **D-109**: FOR UPDATE row-level lock for token refresh. Why: without locking, two concurrent `linkedin-post` jobs could both read the same expired token, both refresh, and one's refresh token would be invalidated by the other's. Tradeoff: the lock scope is the transaction — callers must not hold it across external API calls (this notifier acquires, posts, releases). Governs: `repositories/social-tokens.ts::withTokenLock`. (renumbered from D-111 — that id is now the cross-package collector-health-Slack decision in root DECISIONS.md.)
