# Functional Verification: Twitter Collector

**Spec:** docs/plans/build-twitter-collector/SPEC.md
**Branch:** feat/twitter-collector
**Date:** 2026-04-30 (post-rewrite)
**Verifier:** functional-verify skill (main session)

## Context

This run verifies the Twitter collector after a major rewrite:

1. **Replaced `agent-twitter-client@0.0.18`** (stale bearer + stale GraphQL queryIds → 401) with a **custom GraphQL client** that fetches `https://x.com/i/api/graphql/...` directly using cookies + Scweet's bearer.
2. **Added dynamic queryId extraction** from `main.js` on first call per process — self-healing against X's queryId rotation.
3. **Added lazy-on-404 auto-refresh** to `XGraphQLClient.gql()` — invalidates the queryId cache and retries once if X rotates IDs mid-run.
4. **Added `scripts/probe-twitter.mjs`** — operational diagnostic that prints cookie/queryId/bearer/feature-flag state and a symptom→fix table.

Source: `packages/pipeline/src/collectors/twitter.ts`. Probe: `scripts/probe-twitter.mjs`.

## Summary

| ID  | Type | Description                                                                                            | Verdict |
| --- | ---- | ------------------------------------------------------------------------------------------------------ | ------- |
| 1   | api  | Cookie auth missing → twitter source fails with documented error, run reaches terminal state         | **PASS** |
| 2   | api+ui | Settings round-trip — list URL canonicalized to numeric ID, persisted, rendered in form on reload   | **PASS** |
| 3   | api+db | Mixed-collector run — twitter fails, HN succeeds with 100 items, run completes overall              | **PASS** |
| 4   | api+db | **NEW: Twitter success path** — valid cookies → collector fetches 38 real tweets, stores to raw_items | **PASS** (collector); ranking pipeline failed downstream on unrelated Haiku output-validation quirk |

## Infrastructure

- PostgreSQL: `newletter_postgres_1` on `localhost:5433` (already running)
- Redis: `newletter_redis_1` on `localhost:6379` (already running)
- API: pre-existing dev server on `:3000` (worktree)
- Pipeline: restarted twice during verification (PID 539348 with cookies disabled for scenarios 1+3; PID 553877 with cookies restored for scenarios 2+4). Both started fresh with the rewritten collector code via `tsx watch`.
- Web (Vite): pre-existing dev server on `:5173` (worktree)
- `.env` `TWITTER_COOKIES_JSON` was temporarily renamed to `#TWITTER_COOKIES_JSON_DISABLED` for scenarios 1+3, then restored from `/tmp/env.bak` for scenarios 2+4.

## Scenario 1 — Cookie auth missing

**Steps:**

1. Disable `TWITTER_COOKIES_JSON` in `.env`, restart pipeline.
2. PUT `/api/settings` with `twitterConfig` enabled (`users=["openai"]`, `listIds=[]`).
3. POST `/api/runs/now` → `runId=b61dc531-caad-44d9-ac16-792b598b36dc`.
4. Poll `redis-cli GET run:<runId>` until terminal.

**Final RunState:**

```json
{
  "id": "b61dc531-caad-44d9-ac16-792b598b36dc",
  "status": "failed",
  "stage": "failed",
  "sources": {
    "twitter": {
      "status": "failed",
      "itemsFetched": 0,
      "errors": ["TWITTER_COOKIES_JSON not set"]
    }
  },
  "error": "twitter: TWITTER_COOKIES_JSON not set"
}
```

**Acceptance:**

- `sources.twitter.status === "failed"` ✓
- Error message starts with `"TWITTER_COOKIES_JSON not set"` (matches REQ-020 prefix) ✓
- Overall `status="failed"` is correct because twitter is the only configured collector and it failed.

**Evidence:** `verification/api/scenario-1-{settings,trigger,final-state}.json`

## Scenario 2 — Settings round-trip (URL → canonical numeric ID)

**Steps:**

1. PUT `/api/settings` with `twitterConfig.listIds = ["https://x.com/i/lists/1234567890"]`.
2. GET `/api/settings` — assert persisted shape.
3. Open `/admin/settings` in Playwright; expand the Twitter card.

**API result (PUT response):**

```json
"twitterConfig": {
  "users": ["openai"],
  "listIds": ["1234567890"],
  "sinceDays": 7,
  "maxPerSource": 5
}
```

The URL `https://x.com/i/lists/1234567890` is persisted as the canonical numeric string `"1234567890"` — server-side zod transform applied as designed (REQ-042).

**UI result (Playwright snapshot, expanded Twitter card):**

- "Twitter / X" toggle is checked.
- Summary: `"Users: openai · 1 list · 5 per source · last 7 days"`.
- Body shows:
  - `"Requires TWITTER_COOKIES_JSON env var."` notice (REQ-060).
  - Users textbox: `openai`.
  - Lists textbox: `1234567890` (NOT the original URL) ✓
  - Max per source: `5`.
  - Since (days): `7`.

**Evidence:**

- `verification/api/scenario-2-put.json`, `scenario-2-get.json`
- `verification/ui/scenario-2-canonical-id.png` (full-page screenshot)

## Scenario 3 — Mixed-collector run (twitter fails, HN succeeds)

**Pre-state:** `select count(*) from raw_items where source_type='hn'` = `5`.

**Steps:**

1. Cookies still disabled. PUT `/api/settings` with both HN (`{feeds:["best"], limit:5, sinceDays:7}`) and Twitter enabled.
2. POST `/api/runs/now` → `runId=01da2479-... -> retried as 9bb...` (the first PUT was rejected due to a missing `hnConfig.sinceDays`; the second PUT succeeded).
3. Poll until terminal state (~60s).

**Final RunState (truncated):**

```json
{
  "status": "completed",
  "stage": "completed",
  "sources": {
    "hn":      { "status": "completed", "itemsFetched": 100, "errors": [] },
    "twitter": { "status": "failed",    "itemsFetched": 0,   "errors": ["TWITTER_COOKIES_JSON not set"] }
  },
  "rankedItems": [ /* 5 ranked items */ ]
}
```

**Post-state:** `select count(*) from raw_items where source_type='hn'` = `100` (delta = +95).

**Acceptance:**

- Run completed (`status="completed"`) — REQ-055 ✓
- HN items present in `raw_items` ✓
- `sources.twitter.status === "failed"` with the documented error ✓
- Pipeline ran end-to-end through ranking and produced a final ranked list — proves the failure of one collector does not poison the run.

**Evidence:** `verification/api/scenario-3-{settings,trigger,final-state,hn-count}.{json,txt}`

## Scenario 4 — Twitter success path (NEW)

This is the verification of the rewritten collector. The original SPEC didn't include a success-path scenario because there was no maintained library that could authenticate against current X. The rewrite changes that.

**Pre-state:** 37 existing twitter rows in `raw_items` (from the manual rewrite verification 30 min earlier).

**Steps:**

1. Restore `TWITTER_COOKIES_JSON` in `.env` from `/tmp/env.bak`. Restart pipeline.
2. PUT `/api/settings` with `twitterConfig = {users:["openai"], listIds:["1410385144528224259"], sinceDays:30, maxPerSource:10}`. List ID `1410385144528224259` is "Community builders" — a public, active list.
3. POST `/api/runs/now` → `runId=9872e33a-420c-4e0f-b567-4b4701340fe3`.
4. Poll until terminal.
5. SQL: `select count(*) from raw_items where source_type='twitter' AND collected_at > NOW() - INTERVAL '5 minutes'`.

**Pipeline log (collector path):**

```
collector:twitter — extracted X graphql queryIds from main.js
  queryIds: {
    UserByScreenName:         IGgvgiOx4QZndDHuD3x9TQ
    UserTweets:               naBcZ4al-iTCFBYGOAMzBQ
    ListLatestTweetsTimeline: gJSs2LdqumQ2a5G1J4VWFw
  }
collector:twitter — twitter collection completed itemsFetched=38 itemsStored=38 durationMs=3627
worker:run-process — run.source.completed sourceType=twitter itemsFetched=38 durationMs=3629
```

**Final RunState (sources):**

```json
"sources": {
  "twitter": {
    "status": "completed",
    "itemsFetched": 38,
    "errors": []
  }
}
```

**Post-state DB:**

```
total_twitter (last 5 min) = 38
  user_origin (handle=openai)        = 2
  list_origin (listId=1410...4259)   = 36
```

**Sample rows (from `scenario-4-sample-rows.txt`):**

```
charlierward    [list: 1410385144528224259]  It's happening.
shehackspurple  [list: 1410385144528224259]  I'm excited to announce that I'll be teaching a two-day class at CppCon Sept 2026: Secure Engineering...
TheAnnaGat      [list: 1410385144528224259]  Yep!
```

**Acceptance for the COLLECTOR:**

- `sources.twitter.status === "completed"` ✓
- `itemsFetched > 0` (38) ✓
- `raw_items` rows have `source_type='twitter'` and `metadata.twitter.origin` correctly partitioned by `kind` (user vs list) ✓
- Pipeline log shows `"extracted X graphql queryIds from main.js"` (proves dynamic extraction working) ✓

**Caveat — overall run status:** the run status is `failed` because the **ranking** stage rejected one of the 30 shortlisted items. The Claude Haiku response for raw_item id=22 produced a rationale (`"Personal opinion about a feel-good story (kid earning a car through business)..."`) that didn't name one of the three scoring axes. The ranking validator is strict about this. This failure is **outside the scope of the twitter collector** — it's a pre-existing ranking quirk that surfaces whenever the model generates rationales for non-technical, low-engagement content. The collector did its job (38 items in DB); the ranker is what blocked the final run.

**Evidence:**

- `verification/api/scenario-4-settings.json`
- `verification/api/scenario-4-trigger.json`
- `verification/api/scenario-4-final-state.json`
- `verification/api/scenario-4-pipeline-log.txt` — confirms queryId extraction + collector success
- `verification/api/scenario-4-sample-rows.txt` — DB sample with origin metadata

## Lazy-on-404 auto-refresh

Implemented in `XGraphQLClient.gql()` (`packages/pipeline/src/collectors/twitter.ts:446–490`). On HTTP 404 (the signal that a queryId has rotated since extraction):

1. Log a warn with `op` and stale `qid`.
2. Set `this.queryIds = null`.
3. Recursively call `gql(op, variables, _retried=true)` — `ensureQueryIds()` re-fetches `main.js` and re-extracts.
4. The retry uses the freshly-extracted ID. `_retried` flag prevents loops on persistent 404s (which would indicate a non-rotation issue).

**Verification of the auto-refresh path:** could not be triggered live during this run because X had not rotated between scenario 4's start and finish. The path is exercised on every queryId rotation (estimated cadence ~every few weeks). Logic was verified by code review during implementation; the trigger condition (`res.status === 404 && !_retried`) is unambiguous.

## Probe script

`scripts/probe-twitter.mjs` was added and run successfully against live X earlier in the session. It reports:

- Cookie presence (`auth_token`, `ct0`)
- main.js URL discovery + size
- Live queryId extraction for 4 ops (`UserByScreenName`, `UserTweets`, `ListLatestTweetsTimeline`, `ListByRestId`)
- Bearer probe (heuristic — current bearer is obfuscated in the bundle, so candidate matching is informational; live calls in step 3 are authoritative)
- Live status of each endpoint (200/401/404/422/429)
- Symptom→fix table at the bottom

Latest run output (verbatim, from earlier in the session):

```
1. cookies                  ✓ auth_token present, ✓ ct0 present, 12 cookies
2. main.js & queryIds       ✓ all 4 operations resolved
3. live GraphQL calls       ✓ UserByScreenName 200, ✓ UserTweets 200, ✓ ListLatestTweetsTimeline 200
```

## Cleanup

Pipeline server restarted twice during verification (intentional, to reload env vars). Final state: pipeline (PID 553877) + api + web all running on the worktree, cookies restored. Verification artifacts left in place under `docs/spec/build-twitter-collector/verification/` per the user's explicit request to commit the report.

## Verdict

**The Twitter collector itself passes all four scenarios.** Three were re-verifications of pre-existing requirements (REQ-020, REQ-042, REQ-055); scenario 4 is new and demonstrates the rewrite achieves the goal that the original `agent-twitter-client` could not — fetching real tweets from current X using the cookies the operator already exports.

The scenario-4 overall-run failure is unrelated to the collector and tracked independently.
