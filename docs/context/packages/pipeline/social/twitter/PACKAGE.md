---
governs: packages/pipeline/src/social/twitter/
last_verified_sha: 5a2ff20
key_files: [index.ts, notifier.ts, api-client.ts, oauth.ts, types.ts]
flow_fns: [notifier.ts::createTwitterNotifier.notifyArchiveReady, api-client.ts::createTwitterApiClient]
decisions: [D-120]
status: active
---

# social/twitter/ — X/Twitter auto-post via OAuth 1.0a with reply-threading

## Purpose
Posts the daily digest summary as a tweet, then posts the archive URL as a reply tweet. Uses Twitter API v2 via `twitter-api-v2` with OAuth 1.0a User Context credentials. No token refresh — OAuth 1.0a access tokens are long-lived.

## Public surface
- `createTwitterNotifier(deps)` → `TwitterNotifier` — `notifyArchiveReady({ runId })` orchestrates tweet creation + reply + archive marking
- `createTwitterApiClient(credentials, options?)` → `TwitterApiClient` — `createPost`, `validateCredentials` (wraps `twitter-api-v2`)
- `refreshTwitterToken(input, fetchFn?)` → `TwitterRefreshResult` — OAuth 2.0 token refresh (for future use; notifier uses OAuth 1.0a)
- `TwitterOAuth1Credentials` interface — `{ appKey, appSecret, accessToken, accessSecret }`

## Depends on / used by
- Uses: `twitter-api-v2`, `@pipeline/repositories/run-archives`, `@pipeline/repositories/raw-items`, `@pipeline/social/compose`, `@pipeline/social/types`
- Used by: `workers/processing.ts::buildDefaultPublishDeps`, `workers/twitter-post.ts`, `workers/social-health.ts`

## Data flows

### notifyArchiveReady({ runId }) → SocialResult
  runId → archives.findById
    ├─ null / already posted (twitterPostedAt !== null) → skip
    └─ ok → check twitterSummary ?? hook (bail if null/empty)
        → premium? → buildStories (resolve recap titles) : empty stories
        → composePosts({ heading, hook, twitterSummary, twitterIsPremium, stories })
          ├─ compose returned null → skip
          ├─ twitter !ok (free_plan_over_limit) → recordSocialFailure → return "failed"
          └─ twitter ok → apiClient.createPost(text)
              ├─ ok → apiClient.createPost(archiveUrl, replyToTweetId) [best-effort reply]
              │        → archives.markTwitterPosted(runId, now, headTweetUrl, tweetIds)
              │        → return { status: "posted", permalink: headTweetUrl }
              └─ !ok → recordSocialFailure → return "failed"

### createTwitterApiClient(credentials, options?) → TwitterApiClient
  credentials → new TwitterApi(appKey, appSecret, accessToken, accessSecret)
    → createPost(input):
      ├─ reply → client.v2.tweet(text, { reply: { in_reply_to_tweet_id } })
      └─ head  → client.v2.tweet(text)
    → validateCredentials: client.currentUserV2(true)

## Gotchas / landmines
- **No token refresh for OAuth 1.0a**: Twitter OAuth 1.0a access tokens don't expire. The `social-health` worker periodically validates credentials and alerts Slack on failure so operators can rotate manually. (D-120)
- **Free-plan length enforcement**: `composePosts` checks `twitterWeightedLength` against 280 chars for free-tier accounts. Premium accounts skip the check and include story titles.
- **Reply tweet failure is non-fatal**: A failed archive-link reply logs a warning but the head tweet is still marked as posted. The `tweetIds` array only contains the head tweet ID on reply failure.
- **OAuth 1.0a env key partial-config warning**: If DB is empty and only some of the 4 OAuth keys are set, the resolver returns null and the worker logs a warning with the missing key names.

## Decisions
- **D-120**: Social-health worker for proactive credential validation. Why: OAuth 1.0a tokens are long-lived and can be silently revoked. A periodic health check catches invalidation before the daily post job runs. Tradeoff: adds a scheduled job that may fire Slack alerts during off-hours. Governs: `workers/social-health.ts`.
