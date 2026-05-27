# Adversarial Findings — admin-linkedin-oauth

**Date:** 2026-05-27  
**Verdict:** No blocking defects found. One UX observation noted.

---

## Scenarios Attempted

### 1. Start endpoint without admin cookie (auth bypass attempt)

**Attack:** Call `POST /api/admin/social-credentials/linkedin/oauth/start` without the `admin_session` cookie.

**Result:** `401 {"error":"unauthorized"}` — endpoint is properly admin-gated (PHASE3-C4 confirmed).

---

### 2. Callback state replay (second use of consumed state)

**Coverage:** Unit test `EDGE-002: consumed state (second use) → 302 error` (PHASE3-C7).  
The callback uses `GETDEL` on the Redis state key — once consumed, replaying the same state produces `?linkedin=error&reason=state`. No second token write occurs.

---

### 3. Start endpoint with no credentials (client_not_configured path)

**Attack:** Ensure no LinkedIn credentials are in DB/env, then POST to start.

**Result (pre-save state):** `409 {"error":"client_not_configured"}` confirmed by initial curl test.  
After saving credentials: `200 {"authorizeUrl":"..."}` — correct state machine.

---

### 4. Token exchange failure path

**Coverage:** Unit test `PHASE3-C8 / PHASE3-C9` — non-2xx token exchange → `?linkedin=error&reason=exchange`; userinfo failure → `?linkedin=error&reason=userinfo`. Neither writes a token.

---

### 5. Wrong SESSION_SECRET after token write

**Coverage:** Unit test `PHASE1-C5` — decrypting with a different `SESSION_SECRET` throws (AuthenticationTagMismatch), not a silent wrong-token. Treated as auth failure by callers.

---

### 6. Slack alert when notifyPublishFailed itself throws

**Coverage:** Unit tests `PHASE2-C5 / PHASE2-C6` (EDGE-006) — worker completes without throwing even when the Slack webhook call itself errors. Failure is logged at `warn` level, marker NOT written (so a retry can re-alert).

---

### 7. Connect button availability without saved credentials

**Attack:** Navigate to /admin/settings without any saved LinkedIn client credentials. Attempt to click Connect.

**Result:** Button is `disabled` (HTML `disabled` attribute present). Click cannot fire. Hint "Save Client ID & Secret first" is visible. (PHASE4-C3 confirmed via Playwright).

---

### 8. Placeholder credentials build valid OAuth URL shape

**Test:** Saved `test-client-id-placeholder` / `test-client-secret-placeholder` as credentials. Clicked Connect. Browser navigated to `https://www.linkedin.com/oauth/v2/authorization` with:
- `response_type=code` ✓
- `client_id=test-client-id-placeholder` ✓  
- `redirect_uri=http://localhost:3000/api/admin/social-credentials/linkedin/oauth/callback` ✓
- `scope=openid profile email w_member_social` ✓
- `state=<64-char hex>` ✓

LinkedIn rejected the request ("invalid client_id") as expected for a placeholder. The app-side URL construction was correct.

---

## Observations (Non-Blocking)

### OBS-1: Toast auto-dismiss prevents live screenshot capture in Playwright

The `?linkedin=connected` and `?linkedin=error` URL params are stripped immediately on mount via `setSearchParams(next, {replace: true})` inside the `useEffect`. The sonner toast fires and dismisses in ~4 seconds. By the time the Playwright screenshot call returns, the toast has already auto-dismissed.

**Impact:** Screenshots for C5/C6 show a clean page state rather than the toast overlay. The behavior is correctly proven by unit tests which mock `toast.success`/`toast.error` and assert they were called.

**Recommendation (optional):** For future Playwright-only verification of toast messages, consider adding a `data-testid="toast-success"` element on the toast container, or using `page.waitForSelector` with a very short timeout immediately after navigation. This is a testing ergonomics issue only — the production behavior is correct.

---

### OBS-2: Reconnect flow after valid token write not exercised in live browser

The "connected as Name / expires at / refresh ✓" UI state (PHASE4-C1 connected variant) could not be exercised in a live browser without completing a real LinkedIn OAuth consent flow. It is fully proven by unit tests using a mocked OAuth status response.

---

## Conclusion

No blocking defects found. The implementation correctly:
- Gates the start endpoint behind `requireAdmin` middleware
- Returns 409 on missing credentials, 200 with valid authorize URL on configured credentials
- Auto-dismisses URL params and shows toasts on mount
- Builds the authorize URL with all 5 required OAuth params
- Disables the Connect button until credentials are configured
- Does not throw when Slack alerts fail
