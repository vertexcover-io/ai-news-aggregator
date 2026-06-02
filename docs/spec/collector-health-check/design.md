# Collector Health Check — Design

**Date:** 2026-06-02
**Status:** Draft
**Author:** Aman (with Claude)

## 1. Motivation

The pipeline has 5 collector types (HN, Reddit, Twitter/X, Blog/Web, Web Search) spanning 14 source files. Currently, collector failures only surface during actual pipeline runs — there's no proactive health monitoring. An expired Twitter cookie, a changed Reddit RSS structure, or a degraded Algolia API is only discovered when the daily run fails, by which point the operator has already lost that day's newsletter coverage.

This feature adds proactive health checks that: (1) can be triggered manually from the admin settings page (all collectors or individually), (2) run automatically 15 minutes before each scheduled pipeline run, and (3) notify via Slack when any collector is unhealthy, with a concise actionable error message.

## 2. Architecture

```
web (SettingsPage)
  ├── "Check All" button + per-collector "Check" buttons
  └── POST /api/admin/health-check (all) or /:collectorType (single)
        │
        ▼
api (new route: admin/health-check.ts)
  └── Enqueues a BullMQ "health-check" job on the processing queue
        │
        ▼
pipeline (new worker: health-check.ts)
  ├── Runs per-collector strategy functions (parallel, Promise.allSettled)
  ├── Collects results: { collectorType, status: "healthy"|"failed", error? }
  └── If any fail → fires Slack notification via existing SlackNotifier
```

**Key design decisions:**

- **Health checks are BullMQ jobs**, not HTTP endpoints. This ensures they're non-blocking (the API returns 202 immediately) and benefit from BullMQ's retry, concurrency, and observability.
- **No new queue.** Health-check jobs go on the existing `processing` queue alongside `pipeline-run`, `run-process`, `email-send`, etc. The processing worker dispatches by `job.name`.
- **Manual triggers from the UI** enqueue a `health-check` job with an optional `collectorType` parameter to run a single collector's check.
- **Automatic triggers** use a BullMQ job scheduler (`upsertJobScheduler`) reconciled on every settings save — same pattern as the existing `social-health` scheduler.

## 3. Per-Collector Health Check Strategies

Every strategy is a function `(deps) => Promise<HealthCheckResult>` that performs a real, minimal fetch through the same code paths the collector uses in production. A **pass** means the collector should work in every case.

### 3.1 HN Collector

**Check:** Fetch 1 story from `https://hn.algolia.com/api/v1/search_by_date?hitsPerPage=1&tags=story` via the existing `fetchWithRetry`. Parse with `parseAlgoliaStoryResponse`. Validate at least 1 hit with non-empty `objectID` and `title`.

**Why a generic query instead of the user's configured keywords:** The HN collector's `keywords` filter is optional and the `feeds` config determines which Algolia endpoint (`search` vs `search_by_date`). A health check with no keyword filter against `search_by_date` is the most reliable — it validates Algolia is reachable, the response schema is intact, and `fetchWithRetry` works. A keyword-specific check would flake when no stories match that day's narrow keyword set.

**Reuses:** `fetchWithRetry` from `hn.ts`, `parseAlgoliaStoryResponse` (imported from `hn.ts`).

**Failure modes caught:** Algolia API down (5xx/network), response schema change (missing fields).

| Error condition | Actionable message |
|---|---|
| HTTP 5xx / network error | `HN collector: Algolia API unreachable — service may be degraded` |
| No valid hits / schema change | `HN collector: response schema changed — no stories with required fields returned` |

### 3.2 Reddit Collector

**Check:** Uses the first configured subreddit from `user_settings.reddit_config.subreddits`. Falls back to `r/programming` if no subreddits are configured (shouldn't happen — the settings schema requires at least one when Reddit is enabled). Fetches `https://www.reddit.com/r/<subreddit>/hot.rss?limit=1` via the existing `fetchTextWithRetry`. Parses XML via jsdom. Validates at least 1 `<entry>` with a `t3_`-prefixed `<id>`.

**Why the first configured subreddit instead of a hardcoded one:** Validates the user's actual configuration works — a misconfigured or banned subreddit would fail, which is exactly what the operator needs to know. The fallback to `r/programming` is a safety net for edge cases where subreddits is somehow empty despite validation.

**Reuses:** `fetchTextWithRetry` from `reddit.ts`, jsdom XML parsing pattern.

**Failure modes caught:** Reddit RSS down, XML structure change, User-Agent rejection.

| Error condition | Actionable message |
|---|---|
| HTTP 403 | `Reddit collector: RSS endpoint returned 403 — User-Agent may be blocked` |
| HTTP 5xx / network error | `Reddit collector: RSS endpoint unreachable — Reddit may be down` |
| No valid entries in XML | `Reddit collector: RSS XML structure changed — no valid post entries found` |

### 3.3 Twitter/X Collector

**Check:** Resolves credentials via `resolveTwitterCollectorCookie` (DB-first, env-fallback). Picks the first configured source from `user_settings.twitter_config`: first user in `users[]` if any, else first ID in `listIds[]` if any, else skips (no sources configured). Fetches 1 tweet from that source via the `TwitterClient` interface (`RettiwtAdapter`). Validates the response isn't an auth error (401/403) and returns at least 1 tweet with a non-empty `id`.

**Why the first configured source instead of a hardcoded account:** Tests the user's actual credentials against their actual configured source. If a user ID is invalid or a list was deleted, the health check catches it — which is more valuable than testing against `@karpathy` and missing a config issue. The Rettiwt cookie is the same regardless of which user/list is queried, so a 401/403 from any source means the cookie itself is bad.

**Reuses:** `resolveTwitterCollectorCookie`, `TwitterClient` interface (existing `RettiwtAdapter`).

**Failure modes caught:** Cookie expiry (auth), API schema change, rate limiting.

| Error condition | Actionable message |
|---|---|
| 401/403 (auth) | `Twitter collector: authentication failed — cookies may have expired. Rotate at /admin/settings` |
| 404 | `Twitter collector: configured user/list not found — check settings` |
| Schema error | `Twitter collector: API response schema changed — tweet objects missing required fields` |
| Network error | `Twitter collector: Twitter API unreachable — network or DNS issue` |

### 3.4 Web Search Collector

**Check:** Instantiate `TavilyProvider` via `createWebSearchProvider`, call `search("test", { maxResults: 1 })`. Validate the response contains at least 1 result with a non-empty `url`.

**Reuses:** `createWebSearchProvider`, `WebSearchProvider` interface.

**Failure modes caught:** Invalid/missing API key, Tavily API down, response schema change.

| Error condition | Actionable message |
|---|---|
| Missing API key | `Web Search collector: Tavily API key not configured — set TAVILY_API_KEY in .env` |
| Auth error (401/403) | `Web Search collector: Tavily API key invalid — check TAVILY_API_KEY` |
| API 5xx / network error | `Web Search collector: Tavily API unreachable — service may be degraded` |
| Empty results | `Web Search collector: Tavily returned no results — API may have changed` |

### 3.5 Blog/Web Collector

**Check:** This is the most complex collector — it has a two-stage LLM pipeline (DeepSeek for discovery + extraction) plus Crawlee/Playwright for fetching. The health check:

1. Picks the first configured blog source from `user_settings.web_config.sources[0]`
2. Runs Crawlee against its `listingUrl` with `maxPages: 1`, extracts markdown
3. Calls `discoverPostUrls` via DeepSeek to try to get at least 1 post URL
4. If discovery succeeds → optionally extracts fields from the first post URL (lightweight validation)
5. If no sources are configured, skips with `"no sources configured"` (not a failure)

**Reuses:** `runWebCrawl`, `discoverPostUrls` (from `web.ts`), `createDeepSeek`.

**Failure modes caught:** Crawlee/Playwright crash, DeepSeek API key invalid, listing page structure change, proxy config invalid, no configured sources.

| Error condition | Actionable message |
|---|---|
| Missing API key | `Blog collector: DeepSeek API key not configured — set DEEPSEEK_API_KEY in .env` |
| DeepSeek auth error (401) | `Blog collector: DeepSeek API key invalid — check DEEPSEEK_API_KEY` |
| Listing page unreachable | `Blog collector: listing page unreachable for "<source>" — URL may have changed` |
| Proxy error | `Blog collector: HTTP proxy connection failed — check WEB_HTTP_PROXY in .env` |
| No post URLs discovered | `Blog collector: LLM discovery returned no posts for "<source>" — listing page structure may have changed` |
| No sources configured | Not a failure — skips silently |

### 3.6 Skipped Strategies (Not Failures)

Some conditions result in `status: "skipped"` — not a failure, no Slack notification:

| Collector | Skip condition |
|---|---|
| HN | Never skipped — always checkable via Algolia public API |
| Reddit | No subreddits configured (shouldn't happen — settings validation requires ≥1 when enabled) |
| Twitter | Neither `users[]` nor `listIds[]` configured (no sources), or `RETTIWT_API_KEY` not set |
| Web Search | `TAVILY_API_KEY` not set (collector is effectively disabled) |
| Blog | `web_config.sources[]` empty (no listing URLs configured), or `DEEPSEEK_API_KEY` not set |

Skip conditions where the API key is missing are NOT failures — the collector is effectively disabled and the operator doesn't need a Slack alert about it. The manual health check UI shows "Skipped — no API key configured" inline. The automatic check silently skips.

### 3.7 Shared Contract

```ts
interface HealthCheckResult {
  collectorType: "hn" | "reddit" | "twitter" | "web_search" | "blog";
  status: "healthy" | "failed" | "skipped";
  durationMs: number;
  itemsFound?: number;
  error?: string;       // concise actionable message, present only when failed
  reason?: string;      // present only when skipped (e.g., "no sources configured")
}
```

The worker runs all 5 strategies in parallel via `Promise.allSettled`. Failures are collected and reported. A Slack notification fires if and only if at least one collector has `status: "failed"`.

## 4. API Routes

### `POST /api/admin/health-check`

Admin-gated. Triggers a health check for all collectors.

**Request:** `{}` (no body needed)

**Response:** `202 Accepted`
```json
{
  "jobId": "uuid",
  "collectors": ["hn", "reddit", "twitter", "web_search", "blog"]
}
```

### `POST /api/admin/health-check/:collectorType`

Admin-gated. Triggers a health check for a single collector.

**Path params:** `collectorType ∈ { hn, reddit, twitter, web_search, blog }`

**Response:** `202 Accepted`
```json
{
  "jobId": "uuid",
  "collector": "twitter"
}
```

**Error cases:**
- `400` — unknown `collectorType`
- `404` — collector not enabled/configured (e.g., webSearch config missing)

Both routes enqueue a BullMQ job with `jobName: "health-check"` on the `processing` queue. The job payload carries an optional `collectorType` (undefined = all).

## 5. Settings UI Changes

### 5.1 Source Section Changes

Each source section in `SourcesSection` gains a **"Check Health"** button in its expanded panel header:

```
┌─────────────────────────────────────────────────────────┐
│  HN  [✓ Enabled]                          [Check Health] │
│  ┌─ expanded config ──────────────────────────────────┐ │
│  │  keywords: [...]   pointsThreshold: 15             │ │
│  │  ...                                               │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

Clicking the button:
1. Calls `POST /api/admin/health-check/hn`
2. Shows a spinner on the button while the check runs (or a toast-based approach)
3. On completion: green checkmark ("Healthy") or red X ("Failed — see Slack")

### 5.2 Global "Check All" Button

A **"Check All Collectors"** button in the `SaveBar` (or above the Sources section):

```
[Check All Collectors]   [Save changes]   [Run now]
```

Calls `POST /api/admin/health-check`, shows aggregate result: "3 healthy, 1 failed (Twitter — check Slack for details)".

### 5.3 State Display

The health check result for the **automatic** (scheduled) check is NOT displayed in the UI — it goes directly to Slack. Only manual checks show inline results.

The UI shows the **last check timestamp** per collector (from the job result), so the operator knows how fresh the health data is. This is a "Last checked: 2 min ago" label, not a persisted historical record.

## 6. Scheduling Integration

### 6.1 New Scheduler Key

A new constant `HEALTH_CHECK_SCHEDULER_KEY = "health-check:default"` in `packages/shared/src/scheduling/job-ids.ts`.

### 6.2 reconcilePipelineSchedule Changes

In `scheduler.ts`, alongside the existing `social-health` scheduler (which runs 15 min before `pipelineTime`), add a `health-check` scheduler at the same offset:

```typescript
await queue.upsertJobScheduler(
  HEALTH_CHECK_SCHEDULER_KEY,
  { every: 60_000 }, // 1-min interval for idempotency
  {
    name: "health-check",
    data: {},
    opts: {
      repeat: { pattern: toCronMinusMinutes(settings.pipelineTime, 15) },
      tz: settings.scheduleTimezone,
    },
  },
);
```

When `scheduleEnabled` is false → scheduler is removed (alongside all others). When `pipelineTime` changes → the next `PUT /api/settings` call reconciles and the scheduler is rescheduled to the new `pipelineTime - 15 min`. **No additional code needed** — the existing `reconcilePipelineSchedule` pattern handles this.

### 6.3 Worker Dispatch

In `processing.ts`, add a new case to the `switch (job.name)`:

```typescript
case "health-check":
  await handleHealthCheckJob(job, deps);
  break;
```

The `handleHealthCheckJob` function in `workers/health-check.ts`:
1. Reads settings to know which collectors are enabled
2. Runs strategies in parallel for enabled collectors
3. If `job.data.collectorType` is set → runs only that one
4. On any failure → fires Slack notification via `deps.slack`

## 7. Slack Notification Format

### 7.1 New Notification Keys

Two new keys in `NotificationKey`:
- `"healthCheckFailed"` — automatic pre-run health check failures
- Not a separate key for manual checks — manual check results are shown inline in the UI

### 7.2 Message Format

A new builder `health-check-failed.ts` in `packages/shared/src/slack/builders/`:

```
┌──────────────────────────────────────────────────┐
│  🩺 Collector Health Check Failed               │
│                                                  │
│  2 of 5 collectors are unhealthy:                │
│                                                  │
│  ✕ Twitter                                       │
│    authentication failed — cookies may have      │
│    expired. Rotate at /admin/settings             │
│                                                  │
│  ✕ Blog                                          │
│    DeepSeek API key invalid — check              │
│    DEEPSEEK_API_KEY in .env                       │
│                                                  │
│  3 collectors healthy: HN, Reddit, Web Search    │
│                                                  │
│  Next pipeline run in ~15 minutes.               │
│  Fix before then to avoid coverage gaps.         │
│                                                  │
│  Settings: https://<base>/admin/settings          │
└──────────────────────────────────────────────────┘
```

**Building blocks:**
- Header: `"🩺 Collector Health Check Failed"`
- Per-failure: `✕ <collectorName>` + indented actionable error message
- Summary line: `"N collectors healthy: <names>"`
- Context line: warning about upcoming pipeline run + settings link
- Archive link is omitted (this notification is not tied to a specific run)

### 7.3 Idempotency

Health check failures do NOT use `run_archives.notification_state` (there's no run). Instead, the notifier uses a simple debounce: if the same set of collectors has been failing with the same error messages, don't re-notify within a time window (e.g., 1 hour). This is tracked in a Redis key `health-check:last-notified` with a hash of the failure set. This prevents Slack spam from repeated health check failures while still re-alerting when something new breaks.

## 8. Error Classification & Actionable Messages

Each collector strategy classifies caught errors and maps them to concise messages. The mapping is explicit — no raw error text is ever sent to Slack.

```ts
function classifyHealthError(collector: CollectorType, err: unknown): string {
  // Per-collector switch that inspects error type, HTTP status, error codes
  // Returns a pre-written actionable message string
}
```

The classification logic lives alongside each strategy function so it stays co-located with the collector it validates.

## 9. Testing Strategy

- **Unit tests** for each health check strategy function (mock external APIs, verify result shape)
- **Unit tests** for error classification (each error type → correct actionable message)
- **Integration tests** for the `health-check` job handler (enqueue job, verify strategies called, verify Slack only fires on failure)
- **E2E test** for the API route → job enqueue flow
- **E2E test** for the settings UI buttons (Playwright)

## 10. External Dependencies & Fallback Chain

| Dependency | Used By | Fallback |
|---|---|---|
| Algolia HN Search API | HN health check | None (public API, no auth needed) |
| Reddit RSS | Reddit health check | None (public, no auth needed) |
| Rettiwt API (Twitter internal) | Twitter health check | None (cookie-based, resolveTwitterCollectorCookie) |
| Tavily Search API | Web Search health check | None (TAVILY_API_KEY required) |
| DeepSeek API | Blog health check | None (DEEPSEEK_API_KEY required) |
| BullMQ | Job scheduling + execution | Already a core dependency |
| Slack Webhook | Failure notifications | Disabled when SLACK_WEBHOOK_URL unset |
| Crawlee/Playwright | Blog health check | Already installed, used by existing web collector |

No new external dependencies are introduced. All health checks use existing APIs and libraries.
