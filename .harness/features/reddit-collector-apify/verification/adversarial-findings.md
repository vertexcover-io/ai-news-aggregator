# Adversarial Findings — reddit-collector-apify

**Role swap complete. Verifier hat off. Critic hat on.**

---

## 1. Attack Surface Derived

Sources: spec-gap diff (spec REQs/EDGEs not directly covered in claims[]), plus boundary/sequence categories.

Gaps identified in claims[] vs spec (spec items with no direct claims coverage, exercise needed):
- REQ-024 (token never serialized): PHASE4-C3 covers status response, but no claim explicitly for GET-after-large-or-weird-token
- REQ-015 validation: no claim for invalid/empty/null body rejection
- EDGE-011 GET path: PHASE4-C2 covers PUT/DELETE rejection, no claim for GET /api/super/app-credentials as tenant_admin
- No claim for double-submit / concurrent write consistency
- No claim for key collision: PUT when key exists (upsert semantics)
- No claim for remove-nonexistent token idempotency

Attack categories attempted:
- **Boundary inputs**: empty string, null, missing key, max-length string (10001 chars), unicode/emoji, SQL injection string, whitespace-only
- **Status accuracy**: response body after each write — confirm no token value ever leaks
- **Permissions/auth**: tenant_admin GET on super endpoint, unauthenticated GET on super endpoint
- **Unexpected sequences**: double-submit (concurrent PUT), delete when already deleted, GET on PUT-only route
- **Broader surface**: settings API still accessible to tenant_admin after Apify changes, all other credential types unaffected

---

## 2. Scenarios Attempted

| ID | Category | Description | Inputs | Verdict |
|----|----------|-------------|--------|---------|
| ADV-001 | Boundary input | Empty string token rejected | `{"apiToken":""}` → PUT /apify | EXPECTED (400, min-length validation) |
| ADV-002 | Boundary input | Missing apiToken key rejected | `{}` → PUT /apify | EXPECTED (400, invalid_type undefined) |
| ADV-003 | Boundary input | 10001-char token accepted (no max enforced by spec) | `{"apiToken":"a"*10001}` | EXPECTED (200 — spec has no max-length; encrypted storage handles it) |
| ADV-004 | Boundary input | SQL injection string stored correctly; table not dropped | `{"apiToken":"apify_token_'; DROP TABLE..."}` | EXPECTED (200; parameterized ORM, table intact) |
| ADV-005 | Boundary input | Invalid key slug rejected on DELETE | `DELETE /app-credentials/notakey` | EXPECTED (400 invalid_key) |
| ADV-006 | Status accuracy | Status after long token save — no token in response | GET status after 10001-char token | EXPECTED (only {configured:true, updatedAt}) |
| ADV-007 | Concurrency | Concurrent double-PUT: both 200, final state consistent | Two simultaneous PUT requests | EXPECTED (both 200, state consistent — upsert idempotent) |
| ADV-008 | Broader surface | Tenant admin settings endpoint still works after Apify writes | GET /api/settings as tenant_admin | EXPECTED (200, unaffected) |
| ADV-009 | Unexpected sequence | GET on apify key-specific route (no GET route exists) | `GET /api/super/app-credentials/apify` | EXPECTED (404 — only PUT/DELETE on keyed path) |
| ADV-010 | Unexpected sequence | Delete non-existent token (already cleared) | `DELETE /apify` when no row | EXPECTED (`{ok:true,removed:false}` — idempotent, not a 404/error) |
| ADV-011 | Permissions/auth | Tenant-admin GET on super endpoint → unauthorized | GET /api/super/app-credentials as tenant_admin | EXPECTED (401 — cookie is tenant-scoped; super route requires super_admin) |
| ADV-012 | Boundary input | Unicode/emoji token accepted | `{"apiToken":"apify_api_🔑_unicode_token_test"}` | EXPECTED (200 — token stored encrypted, content-agnostic) |
| ADV-013 | Status accuracy | Unicode token not echoed in status response | GET status after emoji token | EXPECTED (no 🔑 in response) |
| ADV-014 | Boundary input | null apiToken rejected | `{"apiToken":null}` | EXPECTED (400 invalid_type) |
| ADV-015 | Status accuracy | GET status field projection — only {configured, updatedAt} | Inspect all fields in apify status object | EXPECTED (only 2 fields; no apiToken/token/secret/encryptedFields) |

---

## 3. Defects

None found across 15 scenarios attempted.

---

## 4. Cannot Assess

- **Token rotation**: Cannot simulate `SESSION_SECRET` rotation and verify that a token encrypted with the old secret correctly returns null via the resolver (EDGE-008). This would require starting the API with a different SECRET, which risks destabilizing the running test environment. The unit test `test_REQ_013_decrypt_failure_returns_null` covers this path.
- **Actor timeout**: Cannot simulate a 60-second actor timeout in the live probe without paying real actor compute time. Unit test `test_EDGE_002_actor_timeout_propagates` covers the error-propagation logic.
- **Concurrent DB write during decrypt**: Cannot produce a race between `getApifyApiToken()` read and a concurrent `upsertApifyApiToken()` write in a single curl session. Drizzle/pg serializes these naturally.

---

## 5. Honest Declaration

No defects found across 15 scenarios attempted.

Categories exercised: boundary inputs (empty, null, missing, very long, unicode, SQL injection), status-accuracy checks (token never echoed in GET responses after any PUT), permissions/auth (tenant_admin 401 on super endpoint), unexpected sequences (GET on PUT-only route 404, double-submit idempotent, delete-nonexistent returns removed:false), broader surface (settings endpoint unaffected by Apify credential changes).

Most promising attack tried: the SQL injection token (`'; DROP TABLE app_credentials; --`). This is the classic stored-injection vector — a naive string concatenation ORM would drop the table. The attack did not land because Drizzle uses parameterized queries throughout the repository layer, and the token value is also immediately encrypted before storage. The table remained intact and only `configured:true` was returned in the status response.

A second promising attack was the concurrent double-PUT race condition (ADV-007). If upsert had a non-atomic check-then-insert implementation, two simultaneous writes could produce duplicate rows or a 500. The attack returned two 200s with timestamps 1ms apart and consistent state — the `INSERT ... ON CONFLICT DO UPDATE` pattern (enforced by the primary key on `app_credentials.key`) makes this safe.
