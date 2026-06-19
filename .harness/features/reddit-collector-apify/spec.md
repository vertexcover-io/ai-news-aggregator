# SPEC: Apify-Based Reddit Collector

**Source:** .harness/features/reddit-collector-apify/design.md
**Generated:** 2026-06-18

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Event-driven | When `collectReddit(deps, config)` runs with a resolved token, the system shall fetch posts for the configured subreddits via the Apify actor `trudax/reddit-scraper-lite` instead of Reddit RSS | Collector invokes an injected Apify runner with `startUrls` built from subreddits + sort; no `reddit.com/*.rss` request is made | Must |
| REQ-002 | Ubiquitous | The system shall map each actor post item to a `RawItemInsert` preserving the RSS-era field set | For a sample item: `sourceType="reddit"`, `externalId=parsedId`, `title`, `url=link??permalink`, `sourceUrl=permalink`, `author=username`, `content=body`, `publishedAt=Date(createdAt)`, `imageUrl=imageUrls[0]`, `metadata.sourceUnit={identifier,displayName:"r/<sub>"}`, `metadata.comments=[]` | Must |
| REQ-003 | Ubiquitous | The system shall populate engagement from real actor data | Mapped `engagement = { points: upVotes, commentCount: numberOfComments }` (non-zero when source has them) | Must |
| REQ-004 | Event-driven | When `config` specifies `sort`/`timeframe`/`limit`, the system shall translate them into the actor input | `sort="top"`→`/r/<sub>/top/?t=<timeframe>`; `sort∈{new,hot}`→`/r/<sub>/<sort>/`; `maxPostCount=limit`; `maxItems=limit*subreddits.length`; defaults match RSS era (subs default list, top, day, 25) | Must |
| REQ-005 | Ubiquitous | The system shall build the actor input with `skipComments:true`, `skipUserPosts:true`, `skipCommunity:true`, `includeMediaLinks:true` | Generated input object equals those flags (posts-only; media flag on so engagement is returned) | Must |
| REQ-006 | Ubiquitous | The system shall return per-subreddit `unitResults` by grouping returned items by their `parsedCommunityName` | Each requested subreddit appears once in `unitResults`; counts equal grouped item counts; status `completed` | Must |
| REQ-007 | Ubiquitous | The system shall de-duplicate posts by `externalId` within a single collection run | Two items with the same `parsedId` yield one `RawItemInsert` | Must |
| REQ-008 | Event-driven | When `config.sinceDays` > 0, the system shall drop items older than the cutoff by `publishedAt` | Items with `publishedAt` before `now - sinceDays*86_400_000` are excluded; 0-dropped logs the existing "feed may be truncated" warning | Must |
| REQ-009 | Event-driven | When mapped items remain after filtering, the system shall persist them via `rawItemsRepo.upsertItems()` | `upsertItems` called once with the mapped array; `CollectorResult.itemsStored` equals its length | Must |
| REQ-010 | Event-driven | When `fetchRedditPost(url, deps)` is called with a token, the system shall fetch that single post via the actor and return one `RawItemInsert` | Returns the post whose `externalId` equals the permalink's post id | Must |
| REQ-011 | Ubiquitous | The system shall retain `parseRedditPostUrl(url)` as a pure (no-network) function for source detection | `detectAddPostSourceType` still classifies Reddit permalinks; no actor/network call in parse | Must |
| REQ-012 | Ubiquitous | The system shall resolve the Apify token DB-first via `resolveApifyApiToken({appRepo,env})`, falling back to the `APIFY_API_KEY` env var | DB row present→`{source:"db"}`; absent→env `APIFY_API_KEY`→`{source:"env"}`; neither→`null` | Must |
| REQ-013 | Unwanted | If an `apify_api_token` DB row exists but fails to decrypt, then the system shall treat the token as unconfigured and not fall through to env | Resolver returns `null` (not the env value) on decrypt failure | Must |
| REQ-014 | Ubiquitous | The system shall store the Apify token as encrypted app-credential key `apify_api_token` (no tenant scope) | `AppCredentialKey` includes `"apify_api_token"`; value is an `EncryptedBlob` via `credential-cipher`; new migration present | Must |
| REQ-015 | Event-driven | When a super-admin calls `PUT /api/super/app-credentials/apify` with a token, the system shall upsert the encrypted token and return status without the secret | 200 with `{configured:true, updatedAt}`; response body contains no token value | Must |
| REQ-016 | Unwanted | If a non-super-admin calls any `/api/super/app-credentials` Apify route, then the system shall reject it | 401 when unauthenticated, 403 when `role!=="super_admin"` | Must |
| REQ-017 | Event-driven | When the super-admin views app-credentials status, the system shall report Apify configured-state and `updatedAt` only | `GET /` status includes apify `{configured:boolean, updatedAt}`; never the token | Must |
| REQ-018 | Event-driven | When the super-admin clears the Apify credential via `DELETE /:key`, the system shall remove the `apify_api_token` row | `DELETE` with key `apify_api_token` returns success; subsequent status `configured:false` | Should |
| REQ-019 | Ubiquitous | The system shall expose a super-admin-only web panel to set/clear the Apify token and show configured status | Panel reachable only under `RequireSuperAdmin`; shows configured + updatedAt; never renders the secret | Must |
| REQ-020 | Unwanted | If no token resolves when `collectReddit` runs, then the system shall log a warning and return an empty `CollectorResult` (itemsFetched 0) without throwing | No exception; `itemsStored=0`; warning logged; `upsertItems` not called | Must |
| REQ-021 | Unwanted | If no token resolves when `fetchRedditPost` runs, then the system shall throw a typed "Apify integration not configured" error | Throws (not empty result); add-post flow surfaces a fetch failure | Must |
| REQ-022 | Unwanted | If the actor run fails or times out during `collectReddit`, then the system shall propagate the error so the worker marks the `reddit` source failed | Error thrown out of `collectReddit`; existing worker catch marks source failed | Must |
| REQ-023 | Ubiquitous | The system shall remove all Reddit RSS/jsdom code from the collector | No jsdom import, no `*.rss` URL construction, no atom parsing remain in `collectors/reddit.ts` | Must |
| REQ-024 | Ubiquitous | The system shall never log or serialize the Apify token value | Token absent from logs (token-source label only) and from all API/web responses | Must |
| REQ-025 | Ubiquitous | The system shall cap returned posts to `limit` per subreddit even if the actor over-delivers | After grouping, each subreddit's mapped items ≤ `config.limit` | Should |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | Token unconfigured (DB + env both absent) at batch collect | Empty `CollectorResult`, warning, no `upsertItems` | REQ-020 |
| EDGE-002 | Actor run throws / times out | Error propagates from `collectReddit` | REQ-022 |
| EDGE-003 | A subreddit yields 0 items | That unit reports `itemsFetched:0, status:"completed"` | REQ-006 |
| EDGE-004 | Actor item missing required fields (no title / permalink / parsedId) | Item skipped, not mapped | REQ-002 |
| EDGE-005 | `sinceDays` filter drops 0 of N>0 items | Items kept; "feed may be truncated" warning logged | REQ-008 |
| EDGE-006 | Same `parsedId` returned for two subreddits in one run | De-duplicated to one item | REQ-007 |
| EDGE-007 | `fetchRedditPost` permalink the actor returns nothing for | Throws "post not found" | REQ-010 |
| EDGE-008 | DB token row present but undecryptable (rotated `SESSION_SECRET`) | Resolver returns null; treated as unconfigured | REQ-013 |
| EDGE-009 | Actor over-delivers (>`limit` posts for a subreddit) | Capped to `limit` per subreddit | REQ-025 |
| EDGE-010 | Token unconfigured at single-post fetch | Throws typed "not configured" error | REQ-021 |
| EDGE-011 | Non-super-admin hits Apify super route | 401 (unauth) / 403 (wrong role) | REQ-016 |
| EDGE-012 | `sort="new"` (no timeframe) | startUrl `/r/<sub>/new/` with no `?t=` param | REQ-004 |

## Verification Matrix

| REQ/EDGE ID | Test Level | Test Name | Rationale for Level | Notes |
|-------------|-----------|-----------|---------------------|-------|
| REQ-001 | unit | test_REQ_001_uses_apify_runner_not_rss | injected runner, assert called; no rss | fake runner dep |
| REQ-002 | unit | test_REQ_002_maps_item_to_rawiteminsert | pure mapping | fixture item |
| REQ-003 | unit | test_REQ_003_engagement_from_upvotes_comments | pure mapping | |
| REQ-004 | unit | test_REQ_004_config_to_actor_input | pure input build | covers EDGE-012 inputs |
| REQ-005 | unit | test_REQ_005_input_flags_posts_only | pure input build | |
| REQ-006 | unit | test_REQ_006_unit_results_grouped_by_subreddit | pure grouping | |
| REQ-007 | unit | test_REQ_007_dedupes_by_external_id | pure logic | |
| REQ-008 | unit | test_REQ_008_sincedays_filters_old_posts | pure filter | |
| REQ-009 | unit | test_REQ_009_persists_via_upsertitems | fake repo, assert call | |
| REQ-010 | unit | test_REQ_010_fetch_single_post | injected runner | |
| REQ-011 | unit | test_REQ_011_parse_reddit_post_url_pure | pure URL parse | retained behavior |
| REQ-012 | unit | test_REQ_012_resolve_token_db_first_env_fallback | fake appRepo + env | |
| REQ-013 | unit | test_REQ_013_decrypt_failure_returns_null | fake appRepo throws | |
| REQ-014 | unit | test_REQ_014_apify_credential_key_and_blob | schema/type + cipher | migration presence checked in gate |
| REQ-015 | integration | test_REQ_015_put_apify_token_upserts | crosses API+repo+cipher | super-admin authed |
| REQ-016 | integration | test_REQ_016_apify_route_requires_super_admin | middleware boundary | 401/403 |
| REQ-017 | integration | test_REQ_017_status_excludes_secret | API+repo projection | |
| REQ-018 | integration | test_REQ_018_delete_apify_credential | API+repo | |
| REQ-019 | e2e | test_REQ_019_super_admin_apify_panel | UI flow under RequireSuperAdmin | Playwright; UI claim |
| REQ-020 | unit | test_REQ_020_no_token_empty_result_no_throw | fake resolver→null | |
| REQ-021 | unit | test_REQ_021_no_token_single_post_throws | fake resolver→null | |
| REQ-022 | unit | test_REQ_022_actor_error_propagates | runner throws | |
| REQ-023 | unit | test_REQ_023_no_rss_jsdom_remaining | static: grep collector source | guards regression |
| REQ-024 | integration | test_REQ_024_token_never_serialized | API response body assertion | reuse REQ-017 fixture if same assertion + add log check |
| REQ-025 | unit | test_REQ_025_caps_items_per_subreddit | pure cap logic | |
| EDGE-001 | unit | test_EDGE_001_unconfigured_batch_empty | covered alongside REQ-020 path | distinct assert: upsert not called |
| EDGE-002 | unit | test_EDGE_002_actor_timeout_propagates | runner rejects timeout | |
| EDGE-003 | unit | test_EDGE_003_empty_subreddit_unit_completed | grouping with empty sub | |
| EDGE-004 | unit | test_EDGE_004_skips_malformed_item | mapping skip | |
| EDGE-005 | unit | test_EDGE_005_sincedays_zero_drop_warns | filter warn | |
| EDGE-006 | unit | test_EDGE_006_cross_subreddit_dedupe | dedupe | |
| EDGE-007 | unit | test_EDGE_007_single_post_not_found_throws | runner returns [] | |
| EDGE-008 | unit | test_EDGE_008_decrypt_fail_no_env_fallthrough | resolver path | distinct from REQ-013: asserts env NOT read |
| EDGE-009 | unit | test_EDGE_009_overdelivery_capped | cap logic | |
| EDGE-010 | unit | test_EDGE_010_single_post_unconfigured_throws | resolver→null | |
| EDGE-011 | integration | test_EDGE_011_super_route_forbidden | 403 wrong role | |
| EDGE-012 | unit | test_EDGE_012_new_sort_no_timeframe | input build | |

## Verification Scenarios

### VS-1: Super-admin manages the Apify token (PRD-less, operator flow)
1. Sign in as super-admin → navigate to the super-admin Apify panel. Expected: panel renders, status "not configured" when no row.
2. Enter a token and save. Expected: 200; panel shows "configured" + updatedAt; no token echoed back.
3. Reload. Expected: status persists as configured; secret never present in any response.
4. Sign in as tenant-admin → the Apify panel/route is not reachable (no nav entry; direct API call → 403).

### VS-0-apify-listing: Library probe — subreddit listing via apify-client
**Type:** api
**Run:** bash .harness/runtime/reddit-collector-apify/probes/apify-client/probe.sh
**Expected:** exit 0; listing run returns ≥1 post grouped by subreddit with real `upVotes`/`numberOfComments`; single-post run returns the requested post (`parsedId` match). Requires `APIFY_API_KEY` in `.env.harness`. Actor runs are slow (~60–120s each) with transient auto-retried 403s — allow generous timeouts.

## Out of Scope

- Fetching/collecting Reddit comments (posts-only; `commentsPerItem` remains accepted-but-ignored).
- Per-tenant Apify accounts/tokens (the token is a single platform-level secret).
- Exposing the Apify token to tenant admins (super-admin only).
- Migrating non-Reddit collectors (HN, web, Twitter) to Apify.
- Adding an actor-id config knob (the actor is hardcoded; swap is a one-file change).
- Backfilling engagement on previously-collected RSS-era items.
- Custom Reddit retry/backoff/rate-limit handling (the actor owns this now).
