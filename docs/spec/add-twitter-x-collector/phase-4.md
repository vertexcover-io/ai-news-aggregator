# Phase 4: Collector orchestration

> **Status:** pending

## Overview

Brings the pieces together: `collectTwitter(deps, config)` iterates lists then users, paginates, applies cutoffs, dedups, upserts, and returns a `CollectorResult`. After this phase, all 41 REQ-* + 15 EDGE-* in the spec have a passing test, but the collector is not yet wired into a real pipeline run (Phase 5 does that).

## Implementation

**Files:**
- Create: `packages/pipeline/src/collectors/twitter/index.ts` — the public `collectTwitter` function.
- Create: `packages/pipeline/src/collectors/twitter/__tests__/collect-twitter.test.ts` — orchestration tests with a stubbed `TwitterClient`.

**Pattern to follow:** `packages/pipeline/src/collectors/web.ts` for partial-failure handling (per-source try/catch, per-source failures recorded, all-failed → throw, ≥1 success → return). `hn.ts:83-115` for the 429 retry-with-backoff pattern.

### Function signature

```ts
import type { CollectorResult, RawItemInsert } from "@newsletter/shared";
import type { RawItemsRepo } from "../../repositories/raw-items";
import type { TwitterClient, TwitterCollectorResult, TwitterCollectConfig } from "./types";

export interface TwitterCollectorDeps {
  client: TwitterClient;
  rawItemsRepo: RawItemsRepo;
  signal?: AbortSignal;
  now?: () => Date;          // injectable for sinceHours tests
  sleep?: (ms: number) => Promise<void>;  // injectable for retry tests
}

export async function collectTwitter(
  deps: TwitterCollectorDeps,
  config: TwitterCollectConfig,
): Promise<CollectorResult>;
```

(ESLint rule `newsletter/collector-return-shape` will check this.)

### Algorithm

```
start = now()
batch = []
failures = []
authFailed = false

if !RETTIWT_API_KEY:
  log(missing_api_key)
  return zeros

if config.listIds.length === 0 && config.users.length === 0:
  log(no_lists_configured)
  return zeros

log(started, listCount=…, userCount=…)

for source of [...listIds.map(asList), ...users.map(asUser)]:
  if authFailed: break
  if signal.aborted: throw AbortError
  try:
    tweets = await fetchSource(source, deps, config)  # paginates, applies sinceHours, applies maxTweetsPerSource
    rows = tweets.map(tweetToRawItem)
    batch.push(...rows)
    log(list_completed | user_completed)
  catch err:
    if isAuthError(err):
      authFailed = true
      log(auth_failed)
      throw new Error("twitter auth failed")
    if isAbort(err): throw
    failures.push({ source, err })
    log(list_failed | user_failed, code=classify(err))

# in-memory dedup by externalId
deduped = dedupByExternalId(batch)
if deduped.length:
  await deps.rawItemsRepo.upsertItems(deduped)

if failures.length === (listIds.length + users.length):
  throw new Error("all twitter sources failed: " + failures.map(f => f.source.id).join(", "))

log(completed, …)
return { itemsFetched: batch.length, commentsFetched: 0, itemsStored: deduped.length, durationMs: now() - start }
```

### `fetchSource` (private helper)

For a list:
```
opts = { maxTweets: config.maxTweetsPerSource ?? 200, signal: deps.signal }
all = []
cursor = undefined
while all.length < opts.maxTweets:
  res = await retryOn429(() => deps.client.fetchListTweets(source.id, { ...opts, cursor }))
  for t of res.tweets:
    if config.sinceHours && new Date(t.createdAt) < cutoff: return all
    all.push(t)
    if all.length >= opts.maxTweets: return all
  if !res.nextCursor: return all   # <-- handles user-timeline single-page case (REQ-003b)
  cursor = res.nextCursor
return all
```

Same shape for users, just `fetchUserTimeline(source.userId, …)`.

### `retryOn429` (private helper)

Three attempts with delays `[250, 1000, 4000]` ms. Uses `deps.sleep` for testability.

### Tests

Group by REQ. Each test instantiates a stub `TwitterClient` and a spy `RawItemsRepo`. Use a fake `now()` to control time; use a synchronous `sleep` to skip waits.

| Test name (excerpt) | REQs |
|---|---|
| `iterates listIds in order` | REQ-002 |
| `iterates users in order` | REQ-002b |
| `lists then users in mixed config` | REQ-002c |
| `stops paginating at maxTweetsPerSource` | REQ-003 |
| `does not paginate when nextCursor is null` | REQ-003b |
| `stops paginating at sinceHours cutoff` | REQ-004 |
| `dedups in-memory before upsert` | REQ-014, EDGE-006, EDGE-008 |
| `calls upsertItems exactly once` | REQ-015 |
| `result fields shape` | REQ-016 |
| `aborts mid-list on signal` | REQ-017, EDGE-011 |
| `missing RETTIWT_API_KEY returns zeros, logs, no client calls` | REQ-050 |
| `auth error stops remaining sources and throws` | REQ-051 |
| `404 on one list logs and continues` | REQ-052, EDGE-010 |
| `429 retries 3x then records failure` | REQ-053 |
| `all-failed throws aggregated error` | REQ-054 |
| `empty config returns zeros` | REQ-055 |
| `start log emitted with listCount and userCount` | REQ-060 |
| `complete log emitted with all five fields` | REQ-061 |
| `per-source completion log emitted` | REQ-062 |

**Traces to:** REQ-001, REQ-002, REQ-002b, REQ-002c, REQ-003, REQ-003b, REQ-004, REQ-014..017, REQ-050..062, EDGE-006..011, EDGE-014, EDGE-015 (the last two are UI edges; not relevant here).

**Commit:** `feat(twitter): collector orchestration`

## Done when

- [ ] `pnpm --filter @newsletter/pipeline test:unit` passes with all new tests.
- [ ] `pnpm lint` clean — `newsletter/collector-return-shape` and `newsletter/enforce-repository-access` pass.
- [ ] `pnpm typecheck` clean.
- [ ] One commit.

## Notes

- The 429 detection should look for `err.message` containing "rate" / "429" or for a `status === 429` field. Confirm against actual rettiwt-api error shapes during TDD.
- The 401-class detection should match the exact string `"Not authorized to access requested resource"` (verified empirically in the library probe) plus a fallback regex for variations.
- Logging should use `createLogger("collector:twitter")` for `event: "collector.twitter.*"` events. Use `event` field as a discriminant, follow the existing convention from other collectors.
- Do NOT add a separate "user.timeline failed" event name — use a generic `event: "collector.twitter.source_failed"` with `kind: "list" | "user"` so callers can filter consistently. (Update spec REQs if needed during TDD; flag this as a deviation in the commit.)
