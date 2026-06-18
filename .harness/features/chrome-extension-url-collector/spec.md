# SPEC: Chrome Extension — Add URL to Next-Day Newsletter

**Source:** .harness/features/chrome-extension-url-collector/design.md
**Generated:** 2026-06-18

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Event-driven | When the extension popup posts the correct shared password to `POST /api/extension/login`, the system shall return a signed bearer token | Response 200 with `{ token: string, expiresAt: number }`; token verifies via `verifyExtensionToken` | Must |
| REQ-002 | Unwanted | If the password posted to `POST /api/extension/login` is incorrect, then the system shall reject it | Response 401 `{ error: "invalid_password" }`; no token issued | Must |
| REQ-003 | Event-driven | When a request to `POST /api/extension/submissions` carries a valid `Authorization: Bearer <token>`, the system shall authorize it | `requireExtensionAuth` calls next; route handler runs | Must |
| REQ-004 | Unwanted | If a request to `POST /api/extension/submissions` has a missing, malformed, tampered, or expired bearer token, then the system shall reject it | Response 401 `{ error: "unauthorized" }`; no raw_items write | Must |
| REQ-005 | Event-driven | When an authorized submission posts a valid URL, the system shall insert a `raw_items` row with `sourceType: "manual"`, `externalId = hash(canonicalUrl)`, and recent `collectedAt` | Row exists with those fields; response 201 with `{ id, url, sourceType: "manual", alreadyExisted: false }` | Must |
| REQ-006 | Event-driven | When an authorized submission posts a URL already submitted, the system shall upsert (not duplicate) and report it | Exactly one row for that `externalId`; response 201 `alreadyExisted: true` | Must |
| REQ-007 | Unwanted | If the submission body fails `submitUrlSchema` (non-URL, or title > 200 chars), then the system shall reject it | Response 400 with zod error; no raw_items write | Must |
| REQ-008 | Ubiquitous | The system shall enrich a submitted URL (title/author/content) before persisting, reusing the existing link-enrichment path | Persisted row has enriched title when fetch succeeds; falls back to URL as title on enrichment failure | Must |
| REQ-009 | Ubiquitous | The system shall make `manual` raw_items eligible candidates for the next run | `CandidatesRepo.findSince(t)` returns a `manual` item with `collectedAt > t` | Must |
| REQ-010 | Ubiquitous | The system shall scope CORS to `chrome-extension://` origins on extension routes only | Extension routes return `Access-Control-Allow-Origin` reflecting a `chrome-extension://` origin; admin/runs/settings routes unchanged (no CORS header) | Must |
| REQ-011 | State-driven | While no token is stored, the extension popup shall show the login view | Popup renders password input; no AddView | Must |
| REQ-012 | State-driven | While a valid token is stored, the extension popup shall show the add view prefilled with the active tab URL | Popup renders editable URL field prefilled from `chrome.tabs.query({active,currentWindow})` + "Add this page" button | Must |
| REQ-013 | Event-driven | When the user clicks "Add this page" with a stored token, the extension shall POST the URL to the submissions endpoint and show success | On 201, popup shows a success state; on 401 it returns to login view | Must |
| REQ-014 | Ubiquitous | The system shall build the extension as a separate `@newsletter/extension` package producing a loadable MV3 `dist/` | `pnpm --filter @newsletter/extension build` exits 0; `dist/manifest.json` is MV3 with sw + popup | Must |
| REQ-015 | Ubiquitous | The extension shall use a fixed manifest `"key"` yielding a deterministic extension ID | Built `dist/manifest.json` contains `key`; loaded extension ID is stable across builds | Must |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | Bearer token signed with a different secret | 401 unauthorized | REQ-004 |
| EDGE-002 | Bearer token past `expiresAt` | 401 unauthorized | REQ-004 |
| EDGE-003 | Submission URL with tracking params (`?utm_*`) duplicates an existing canonical URL | Treated as same `externalId`; `alreadyExisted: true`, one row | REQ-006 |
| EDGE-004 | Link enrichment fetch fails/times out | Row still inserted with URL as fallback title; 201 returned | REQ-008 |
| EDGE-005 | Active tab is a `chrome://` or empty URL | AddView shows empty/editable field, submit of invalid URL → 400 surfaced as inline error | REQ-007, REQ-012 |
| EDGE-006 | Stored token rejected (401) on submit | Popup clears token and returns to login view | REQ-013 |

## Verification Matrix

| REQ/EDGE ID | Test Level | Test Name | Rationale for Level | Notes |
|-------------|-----------|-----------|---------------------|-------|
| REQ-001 | unit | test_REQ_001_login_returns_token | pure token issuance | |
| REQ-002 | unit | test_REQ_002_login_rejects_bad_password | pure validation | |
| REQ-003 | unit | test_REQ_003_middleware_accepts_valid_bearer | middleware logic | |
| REQ-004 | unit | test_REQ_004_middleware_rejects_invalid_bearer | middleware logic | covers EDGE-001/002 variants |
| REQ-005 | integration | test_REQ_005_submission_inserts_manual_raw_item | crosses DB boundary | enrichment mocked |
| REQ-006 | integration | test_REQ_006_resubmit_upserts_no_duplicate | crosses DB boundary | |
| REQ-007 | unit | test_REQ_007_submit_schema_rejects_bad_input | zod validation | |
| REQ-008 | integration | test_REQ_008_enrichment_failure_falls_back_to_url | crosses enrichment boundary | mock enrichment throw |
| REQ-009 | integration | test_REQ_009_manual_item_is_candidate | crosses DB boundary | CandidatesRepo.findSince |
| REQ-010 | unit | test_REQ_010_cors_scoped_to_extension_routes | header assertion on app | |
| REQ-011 | e2e | test_EDGE_login_view_when_no_token | UI state (popup) | covered by VS-1 |
| REQ-012 | e2e | test_REQ_012_addview_prefills_active_tab | UI state (popup) | covered by VS-2 |
| REQ-013 | e2e | test_REQ_013_add_page_submits_and_succeeds | critical user journey | covered by VS-2 |
| REQ-014 | build | test_REQ_014_extension_builds_mv3 | build artifact | VS-0-crxjs-build |
| REQ-015 | e2e | test_REQ_015_deterministic_extension_id | UI/loading | VS-0-pw-load |
| EDGE-001 | unit | test_EDGE_001_token_wrong_secret_rejected | pure logic | folded into REQ-004 test |
| EDGE-002 | unit | test_EDGE_002_token_expired_rejected | pure logic | folded into REQ-004 test |
| EDGE-003 | integration | test_EDGE_003_tracking_params_dedupe | crosses DB boundary | |
| EDGE-004 | integration | test_EDGE_004_enrichment_failure_fallback | crosses enrichment boundary | = REQ-008 test |
| EDGE-005 | e2e | test_EDGE_005_invalid_tab_url_inline_error | UI error path | covered by VS-2 |
| EDGE-006 | e2e | test_EDGE_006_stale_token_returns_to_login | UI error path | covered by VS-2 |

## Verification Scenarios

### VS-1: Login flow (popup)
1. Build the extension; load it unpacked in Playwright (`channel:"chromium"`, `--load-extension`).
2. Open `chrome-extension://<id>/index.html` with no stored token → **login view shown**.
3. Enter the wrong password, submit → **inline error**, still on login view.
4. Enter the correct password, submit → token stored, **AddView shown**.

### VS-2: Add-current-tab flow (popup, end-to-end against hermetic API)
1. With a logged-in popup and an active tab URL prefilled (editable), click "Add this page".
2. Extension POSTs to `/api/extension/submissions` with the bearer token.
3. Response 201 → **success state shown**.
4. Assert a `raw_items` row exists with `source_type='manual'` and the submitted URL.
5. Re-click with the same URL → **alreadyExisted**, DB count for that URL stays 1.
6. (Error path) corrupt the stored token, submit → 401 → popup returns to login view.

### VS-0-crxjs-build: @crxjs/vite-plugin builds a loadable MV3 extension
**Type:** build
**Run:** `pnpm --filter @newsletter/extension build`; assert `dist/manifest.json` is MV3 with `background.service_worker` + `action.default_popup`.
**Expected:** exit 0; valid MV3 manifest with sw + popup.

### VS-0-pw-load: Playwright loads the unpacked extension and derives the extension ID
**Type:** ui
**Run:** `launchPersistentContext` with `channel:"chromium"`, `--load-extension=<dist>`, `--disable-extensions-except=<dist>`, `--headless=new --no-sandbox --disable-dev-shm-usage`; wait for the service worker; derive id; navigate `chrome-extension://<id>/index.html`.
**Expected:** service worker appears, extension id derived, popup DOM renders.

## Out of Scope

- Per-user accounts (single shared password, matching the existing app).
- Right-click / context-menu capture (popup-only this version).
- Injecting into the *current* run (explicitly next-day only).
- Any review/publishing UI changes — submitted items appear as ordinary candidates.
- Firefox / cross-browser support (Chromium MV3 only).
- Token refresh / rotation beyond a fixed expiry.
