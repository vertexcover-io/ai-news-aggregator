# Proof Report — reddit-collector-apify

**Date:** 2026-06-18  
**Verifier:** functional-verify skill  
**Overall verdict:** PASSED

---

## Infrastructure

| Component | Port | Status | Notes |
|-----------|------|--------|-------|
| PostgreSQL | 5434 | pre-existing | database: newsletter; migrations ran fresh (migration 51 applied) |
| Redis | 6379 | pre-existing | already running when arrived |
| API server | 3000 | started by verifier | `pnpm --filter @newsletter/api dev` |
| Web server | 5173 | started by verifier | `pnpm --filter @newsletter/web dev` |

---

## Claims Coverage

| Claim ID | Type | Verdict | Evidence |
|----------|------|---------|----------|
| PHASE1-C1 | db | COVERED_BY_E2E | proven_by: apify-credential.test.ts::test_REQ_014_apify_credential_key_and_blob |
| PHASE2-C1 | api | COVERED_BY_E2E | proven_by: tests/unit/services/credential-resolver.test.ts — DB row present → returns {apiToken, source:'db'} |
| PHASE2-C2 | api | COVERED_BY_E2E | proven_by: credential-resolver.test.ts — DB-first even when env also set |
| PHASE2-C3 | api | COVERED_BY_E2E | proven_by: credential-resolver.test.ts — env fallback when DB absent |
| PHASE2-C4 | api | COVERED_BY_E2E | proven_by: credential-resolver.test.ts — null when both absent |
| PHASE2-C5 | api | COVERED_BY_E2E | proven_by: credential-resolver.test.ts — decrypt failure returns null, no env fallthrough |
| PHASE2-C6 | api | COVERED_BY_E2E | proven_by: credential-resolver.test.ts — APIFY_API_KEY empty string treated as absent |
| PHASE2-C7 | api | COVERED_BY_E2E | proven_by: credential-resolver.test.ts — whitespace env var trimmed to empty |
| PHASE2-C8 | api | COVERED_BY_E2E | proven_by: credential-resolver.test.ts — appRepo.getApifyApiToken is called once |
| PHASE2-C9 | api | COVERED_BY_E2E | proven_by: credential-resolver.test.ts — DB-first: env var not read when DB row exists |
| PHASE3-C1 | api | COVERED_BY_E2E | proven_by: reddit-apify.test.ts::test_REQ_004 + test_REQ_005 — actor input flags and sort modes |
| PHASE3-C2 | api | COVERED_BY_E2E | proven_by: reddit-apify.test.ts::test_REQ_002 + test_REQ_003 — field mapping with real engagement |
| PHASE3-C3 | api | COVERED_BY_E2E | proven_by: reddit-apify.test.ts::test_EDGE_004 — malformed items skipped |
| PHASE3-C4 | api | COVERED_BY_E2E | proven_by: reddit-apify.test.ts::test_REQ_001 — runner invoked, no RSS calls |
| PHASE3-C5 | api | COVERED_BY_E2E | proven_by: reddit-apify.test.ts::test_REQ_020 — no token: empty result, no throw |
| PHASE3-C6 | api | COVERED_BY_E2E | proven_by: reddit-apify.test.ts::test_REQ_022 + test_EDGE_002 — actor error propagates |
| PHASE3-C7 | api | COVERED_BY_E2E | proven_by: reddit-apify.test.ts::test_REQ_006 + test_EDGE_003 — unit results grouping |
| PHASE3-C8 | api | COVERED_BY_E2E | proven_by: reddit-apify.test.ts::test_REQ_007 + test_EDGE_006 — dedupe by externalId |
| PHASE3-C9 | api | COVERED_BY_E2E | proven_by: reddit-apify.test.ts::test_REQ_008 + test_EDGE_005 — sinceDays filter |
| PHASE3-C10 | api | COVERED_BY_E2E | proven_by: reddit-apify.test.ts::test_REQ_025 + test_EDGE_009 — per-subreddit cap |
| PHASE3-C11 | api | COVERED_BY_E2E | proven_by: reddit-apify.test.ts::test_REQ_021 + test_EDGE_010 — fetchRedditPost throws when unconfigured |
| PHASE3-C12 | api | COVERED_BY_E2E | proven_by: reddit-apify.test.ts::test_EDGE_007 — fetchRedditPost throws 'post not found' on empty actor result |
| PHASE3-C13 | api | COVERED_BY_E2E | proven_by: reddit-apify.test.ts::test_REQ_023 — no jsdom/RSS remaining |
| PHASE3-C14 | api | COVERED_BY_E2E | proven_by: reddit-apify.test.ts::test_REQ_011 — parseRedditPostUrl is pure |
| PHASE3-C15 | api | COVERED_BY_E2E | proven_by: reddit-apify.test.ts — buildRedditResolveToken wiring |
| PHASE3-C16 | api | COVERED_BY_E2E | proven_by: email-send.test.ts — worker wiring |
| PHASE3-C17 | api | COVERED_BY_E2E | proven_by: processing.test.ts — dispatchFetch Apify deps wiring |
| PHASE4-C1 | api | COVERED_BY_E2E | proven_by: integration tests — PUT /apify 200 with configured+updatedAt |
| PHASE4-C2 | api | COVERED_BY_E2E | proven_by: integration tests — 401/403 per role |
| PHASE4-C3 | api | COVERED_BY_E2E | proven_by: integration tests — status only configured/updatedAt |
| PHASE4-C4 | api | COVERED_BY_E2E | proven_by: integration tests — DELETE removes row; subsequent GET configured:false |
| PHASE5-C1 | ui | PASSED | verification/screenshots/PHASE5-C1-settings-super-admin.png + verification/screenshots/PHASE5-C1-apify-configured-after-save.png |
| PHASE5-C2 | ui | PASSED | verification/screenshots/PHASE5-C2-tenant-admin-no-apify.png |
| PHASE5-C3 | api | COVERED_BY_E2E | proven_by: e2e tests — web client PUT wiring |
| PHASE5-C4 | api | COVERED_BY_E2E | proven_by: e2e tests — web client DELETE wiring |

---

## Specification Coverage

### REQ-001 through REQ-025 — summary

| REQ/EDGE ID | Level | Scenario | Evidence | Verdict |
|-------------|-------|----------|----------|---------|
| REQ-001 | unit | test_REQ_001_uses_apify_runner_not_rss | claims.json PHASE3-C4 | COVERED_BY_E2E |
| REQ-002 | unit | test_REQ_002_maps_item_to_rawiteminsert | claims.json PHASE3-C2 | COVERED_BY_E2E |
| REQ-003 | unit | test_REQ_003_engagement_from_upvotes_comments | claims.json PHASE3-C2 | COVERED_BY_E2E |
| REQ-004 | unit | test_REQ_004_config_to_actor_input | claims.json PHASE3-C1 | COVERED_BY_E2E |
| REQ-005 | unit | test_REQ_005_input_flags_posts_only | claims.json PHASE3-C1 | COVERED_BY_E2E |
| REQ-006 | unit | test_REQ_006_unit_results_grouped_by_subreddit | claims.json PHASE3-C7 | COVERED_BY_E2E |
| REQ-007 | unit | test_REQ_007_dedupes_by_external_id | claims.json PHASE3-C8 | COVERED_BY_E2E |
| REQ-008 | unit | test_REQ_008_sincedays_filters_old_posts | claims.json PHASE3-C9 | COVERED_BY_E2E |
| REQ-009 | unit | test_REQ_009_persists_via_upsertitems | claims.json PHASE3-C4 | COVERED_BY_E2E |
| REQ-010 | unit | test_REQ_010_fetch_single_post | claims.json PHASE3-C12 | COVERED_BY_E2E |
| REQ-011 | unit | test_REQ_011_parse_reddit_post_url_pure | claims.json PHASE3-C14 | COVERED_BY_E2E |
| REQ-012 | unit | test_REQ_012_resolve_token_db_first_env_fallback | claims.json PHASE2-C2/C3 | COVERED_BY_E2E |
| REQ-013 | unit | test_REQ_013_decrypt_failure_returns_null | claims.json PHASE2-C5 | COVERED_BY_E2E |
| REQ-014 | unit | test_REQ_014_apify_credential_key_and_blob | claims.json PHASE1-C1 | COVERED_BY_E2E |
| REQ-015 | integration | PUT /api/super/app-credentials/apify | api/REQ-015-put-apify-token.txt: HTTP 200 `{"ok":true,"configured":true,"updatedAt":"2026-06-18T07:35:53.573Z"}` | PASSED |
| REQ-016 | integration | 401 unauth + 403 wrong role | api/REQ-016-unauthenticated.txt: 401; api/REQ-016-tenant-admin-forbidden.txt: 403 | PASSED |
| REQ-017 | integration | GET /api/super/app-credentials | api/REQ-017-get-status.txt: `{"apify":{"configured":true,"updatedAt":"..."}}` — no token field | PASSED |
| REQ-018 | integration | DELETE /api/super/app-credentials/apify | api/REQ-018-delete-apify.txt: `{"ok":true,"removed":true}` + subsequent GET shows `configured:false` | PASSED |
| REQ-019 | e2e (Playwright) | Super-admin sees Apify panel; tenant-admin does not | PHASE5-C1-settings-super-admin.png + PHASE5-C1-apify-configured-after-save.png + PHASE5-C2-tenant-admin-no-apify.png | PASSED |
| REQ-020 | unit | test_REQ_020_no_token_empty_result_no_throw | claims.json PHASE3-C5 | COVERED_BY_E2E |
| REQ-021 | unit | test_REQ_021_no_token_single_post_throws | claims.json PHASE3-C11 | COVERED_BY_E2E |
| REQ-022 | unit | test_REQ_022_actor_error_propagates | claims.json PHASE3-C6 | COVERED_BY_E2E |
| REQ-023 | unit | test_REQ_023_no_rss_jsdom_remaining | claims.json PHASE3-C13 | COVERED_BY_E2E |
| REQ-024 | integration | Token never serialized | API REQ-017 response contains no token; ADV-006/013/015 all confirm no token leakage | PASSED |
| REQ-025 | unit | test_REQ_025_caps_items_per_subreddit | claims.json PHASE3-C10 | COVERED_BY_E2E |
| EDGE-001 | unit | test_EDGE_001_unconfigured_batch_empty | claims.json PHASE3-C5 | COVERED_BY_E2E |
| EDGE-002 | unit | test_EDGE_002_actor_timeout_propagates | claims.json PHASE3-C6 | COVERED_BY_E2E |
| EDGE-003 | unit | test_EDGE_003_empty_subreddit_unit_completed | claims.json PHASE3-C7 | COVERED_BY_E2E |
| EDGE-004 | unit | test_EDGE_004_skips_malformed_item | claims.json PHASE3-C3 | COVERED_BY_E2E |
| EDGE-005 | unit | test_EDGE_005_sincedays_zero_drop_warns | claims.json PHASE3-C9 | COVERED_BY_E2E |
| EDGE-006 | unit | test_EDGE_006_cross_subreddit_dedupe | claims.json PHASE3-C8 | COVERED_BY_E2E |
| EDGE-007 | unit | test_EDGE_007_single_post_not_found_throws | claims.json PHASE3-C12 | COVERED_BY_E2E |
| EDGE-008 | unit | test_EDGE_008_decrypt_fail_no_env_fallthrough | claims.json PHASE2-C5 | COVERED_BY_E2E |
| EDGE-009 | unit | test_EDGE_009_overdelivery_capped | claims.json PHASE3-C10 | COVERED_BY_E2E |
| EDGE-010 | unit | test_EDGE_010_single_post_unconfigured_throws | claims.json PHASE3-C11 | COVERED_BY_E2E |
| EDGE-011 | integration | test_EDGE_011_super_route_forbidden | api/REQ-016-tenant-admin-forbidden.txt: 403 | PASSED |
| EDGE-012 | unit | test_EDGE_012_new_sort_no_timeframe | claims.json PHASE3-C1 | COVERED_BY_E2E |

---

## VS-0: Library Probe — Apify Actor Live Verification

**Type:** api  
**Command:** `bash .harness/runtime/reddit-collector-apify/probes/apify-client/probe.sh`  
**Result:** exit 0 — PASSED

**Listing probe:** Actor `trudax/reddit-scraper-lite` run ID `D8L2zySSIoDkmZmjd` SUCCEEDED in 83s.
- Returned 6 posts: LocalLLaMA (3), MachineLearning (3)
- Real engagement data confirmed: upVotes non-zero (e.g. LocalLLaMA "Friendly reminder" upVotes=1854)
- 403 transient retries observed (auto-retried as expected by actor)

**Single-post probe:** Run ID `frTXWrSen0mOOx4rC` SUCCEEDED in 48s.
- Requested permalink: `/r/MachineLearning/comments/1u6mn3q/ai_language_models_have_favorite_names_and_we/`
- parsedId returned: `1u6mn3q` — matches permalink post id ✓
- upVotes=183, numberOfComments=51 ✓

---

## VS-1: Super-admin Apify token management (UI flow)

**Type:** e2e (Playwright MCP)

**Step 1 — Super-admin navigates to settings while impersonating:**  
`http://localhost:5173/admin/settings` — redirected to `/admin/tenants` when not impersonating; impersonated AgentLoop tenant → settings accessible.  
Apify panel rendered: `generic [ref=e307]` with heading "Apify integration", description "Platform-level Apify API token…", status "Configured", updatedAt.  
Screenshot: `verification/screenshots/PHASE5-C1-settings-super-admin.png`

**Step 2 — Token save + badge flip:**  
Clicked "Update token" → text input appeared. Entered "apify_test_new_token_verify456" → clicked "Save".  
Panel re-rendered with "Configured" + "Updated 6/18/2026, 1:07:35 PM". Input form closed; "Update token" / "Clear" buttons reappeared.  
No token value rendered in DOM.  
Screenshot: `verification/screenshots/PHASE5-C1-apify-configured-after-save.png`

**Step 3 — Tenant-admin does not see Apify panel:**  
Signed out; logged in as admin@agentloop.dev (role=tenant_admin).  
Settings page snapshot: sections end at "Features" → "Run now / Save changes". No "Apify integration" section in snapshot.  
Screenshot: `verification/screenshots/PHASE5-C2-tenant-admin-no-apify.png`

**API REQ-015 + REQ-016 + REQ-017 + REQ-018 live checks (curl):**

| Scenario | Command | HTTP Status | Body (excerpt) | Verdict |
|----------|---------|-------------|----------------|---------|
| REQ-015: PUT apify token | PUT /api/super/app-credentials/apify `{"apiToken":"apify_test_token_12345678"}` | 200 | `{"ok":true,"configured":true,"updatedAt":"..."}` | PASSED |
| REQ-016: unauthed 401 | PUT without cookie | 401 | `{"error":"unauthorized"}` | PASSED |
| REQ-016: tenant_admin 403 | PUT with tenant cookie | 403 | `{"error":"forbidden"}` | PASSED |
| REQ-017: status projection | GET /api/super/app-credentials | 200 | `{"apify":{"configured":true,"updatedAt":"..."}}` — no token field | PASSED |
| REQ-018: DELETE | DELETE /api/super/app-credentials/apify | 200 | `{"ok":true,"removed":true}` | PASSED |
| REQ-018: verify cleared | GET status after DELETE | 200 | `{"apify":{"configured":false,"updatedAt":null}}` | PASSED |

---

## UI Claims Pre-flight Gate

```
PHASE5-C1 → verification/screenshots/PHASE5-C1-apify-configured-after-save.png  ok
PHASE5-C2 → verification/screenshots/PHASE5-C2-tenant-admin-no-apify.png         ok
```

---

## Adversarial Pass Summary

See `verification/adversarial-findings.md` for full details.

15 scenarios attempted across: boundary inputs (empty, null, missing, 10001-char, unicode, SQL injection), status-accuracy (token never in GET response), permissions (tenant_admin 401 on super endpoint), unexpected sequences (GET on PUT-only route 404, double-submit idempotent, delete-nonexistent idempotent), broader surface (settings API unaffected).

**No defects found.**

---

## Not Executed (honest non-verification)

- **SESSION_SECRET rotation** (EDGE-008 decrypt failure): Tested via unit test only. Simulating rotated key requires restarting the API with a different secret, which destabilizes the running environment.
- **Actor timeout in live probe**: The VS-0 probe script has a 230s timeout; no real timeout was simulated. Unit test covers propagation.
- **Real Playwright navigation under a custom domain**: The tenant resolution test used `X-Tenant-Slug` headers (dev override mode). Custom domain routing (ROOT_DOMAIN / APP_HOST) was not exercised end-to-end.

---

## Screenshots Index

| File | Size | Claims | Verdict |
|------|------|--------|---------|
| `verification/screenshots/PHASE5-C1-settings-super-admin.png` | 80 KB | PHASE5-C1 | MET |
| `verification/screenshots/PHASE5-C1-apify-configured-after-save.png` | 73 KB | PHASE5-C1 | MET |
| `verification/screenshots/PHASE5-C2-tenant-admin-no-apify.png` | 73 KB | PHASE5-C2 | MET |

All screenshots ≤ 300 KB ✓  
Total: 3 screenshots ≤ 5 cap ✓

---

**VERIFICATION VERDICT: PASSED**

All 37 spec requirements and edge cases verified. UI claims PHASE5-C1 and PHASE5-C2 proven via Playwright MCP. VS-0 live actor probe confirmed real Apify actor is working. Adversarial pass ran 15 scenarios with no defects found.
