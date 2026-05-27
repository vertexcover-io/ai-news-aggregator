# SPEC: Admin LinkedIn OAuth + Failed-Post Slack Alerting

**Source:** docs/spec/admin-linkedin-oauth/design.md
**Generated:** 2026-05-27

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Event-driven | When an admin POSTs to `/api/admin/social-credentials/linkedin/oauth/start`, the system shall return a LinkedIn authorize URL containing `response_type=code`, the resolved `client_id`, the callback `redirect_uri`, `scope=openid profile email w_member_social`, and a generated `state`. | Response `200 { authorizeUrl }`; parsed URL query contains all five params; `state` is also persisted in Redis. | Must |
| REQ-002 | Unwanted | If no LinkedIn `clientId` is configured (DB nor env) when `start` is called, then the system shall respond `409 { error: "client_not_configured" }` and shall not generate a state. | Status 409; no Redis `state` key written. | Must |
| REQ-003 | Event-driven | When LinkedIn redirects to `/api/admin/social-credentials/linkedin/oauth/callback?code&state` with a state matching a stored Redis value, the system shall exchange the code for tokens, derive `personUrn` from `/v2/userinfo`, write an encrypted `social_tokens` row, and 302-redirect to `<PUBLIC_BASE_URL>/admin/settings?linkedin=connected`. | `social_tokens` LinkedIn row exists with encrypted access+refresh tokens and `metadata.personUrn`; response is 302 to the success URL. | Must |
| REQ-004 | Unwanted | If the callback `state` is missing, expired, or does not match a stored Redis value, then the system shall not exchange the code and shall 302-redirect to `?linkedin=error&reason=state`. | No token write; redirect carries `reason=state`; the consumed/stale state cannot be reused. | Must |
| REQ-005 | Unwanted | If the LinkedIn token exchange or `/v2/userinfo` call fails, then the system shall 302-redirect to `?linkedin=error&reason=exchange` (or `reason=userinfo`) without writing a token. | No `social_tokens` write on failure; redirect carries the matching reason. | Must |
| REQ-006 | Ubiquitous | The system shall store `social_tokens` access and refresh tokens encrypted at rest using `getCredentialCipher()`, exposing plaintext only after decryption in-process. | A raw DB read of `social_tokens` shows no plaintext token; decrypt round-trip yields the original token. | Must |
| REQ-007 | Ubiquitous | The system shall read and write `social_tokens` through one shared cipher-aware code path usable by both the API (initial write) and the pipeline (refresh write + read). | API-written encrypted row is decrypted and used by the pipeline notifier in a cross-service test. | Must |
| REQ-008 | Event-driven | When the `linkedin-post` worker's notifier returns `status: "failed"`, the system shall call `slackNotifier.notifyPublishFailed({ runId, channel: "linkedin-post" })` exactly once. | Worker test: `failed` result → `notifyPublishFailed` called once with `linkedin-post`; idempotent on retry via `linkedinFailure` marker. | Must |
| REQ-009 | Event-driven | When the `twitter-post` worker's notifier returns `status: "failed"`, the system shall call `slackNotifier.notifyPublishFailed({ runId, channel: "twitter-post" })` exactly once. | Worker test: `failed` result → `notifyPublishFailed` called once with `twitter-post`; idempotent via `twitterFailure` marker. | Must |
| REQ-010 | Unwanted | If a `linkedin-post`/`twitter-post` notifier returns `status: "skipped"` or `status: "posted"`, then the system shall not call `notifyPublishFailed`. | Worker test: `skipped`/`posted` → `notifyPublishFailed` not called. | Must |
| REQ-011 | Event-driven | When an admin loads `/admin/settings`, the system shall display LinkedIn connection status: connected-as name (when known), token expiry, and whether a refresh token is present. | Status response includes `{ connected, connectedAs?, expiresAt?, hasRefreshToken }`; UI renders the three facts or a "Not connected" state. | Must |
| REQ-012 | Event-driven | When an admin clicks "Connect/Reconnect LinkedIn" with client creds configured, the system shall call `start` and navigate the browser to the returned `authorizeUrl`. | Button click → `start` request fired → browser navigates to the authorize URL. | Must |
| REQ-013 | State-driven | While LinkedIn `clientId`/`clientSecret` are not configured, the system shall disable the Connect button and show a hint to configure client credentials first. | Button is `disabled`; hint text visible. | Should |
| REQ-014 | Unwanted | If LinkedIn returns no refresh token during the exchange, then the system shall still store the access token and report `hasRefreshToken=false` in the connection status. | `social_tokens` row written; status `hasRefreshToken=false`. | Should |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | Two `start` calls in quick succession generate two states | Both states valid in Redis until consumed/expired; callback consumes the matching one | REQ-001, REQ-004 |
| EDGE-002 | Callback replayed with an already-consumed state | Treated as state mismatch → `?linkedin=error&reason=state`, no second token write | REQ-004 |
| EDGE-003 | `clientId` in env but not DB (env fallback) | `start` resolves clientId from env and proceeds | REQ-001, REQ-002 |
| EDGE-004 | Migration runs against a DB whose `social_tokens` LinkedIn row holds a dead plaintext token | Old plaintext columns dropped; row re-created by next OAuth (no preservation needed) | REQ-006 |
| EDGE-005 | Pipeline reads `social_tokens` after API write but `SESSION_SECRET` differs | Decrypt fails → notifier treats as auth failure (not a silent wrong-token) | REQ-006, REQ-007 |
| EDGE-006 | `notifyPublishFailed` webhook itself errors (non-2xx) | Failure logged (`slack.publish_failed.failed`); marker NOT written so a retry can re-alert; worker never throws | REQ-008, REQ-009 |
| EDGE-007 | `SLACK_WEBHOOK_URL` unset | `notifyPublishFailed` is a no-op; worker still completes | REQ-008, REQ-009 |
| EDGE-008 | Callback hit without a session cookie (the LinkedIn browser redirect) | Allowed — route is state-gated, not cookie-gated; state is the CSRF control | REQ-003, REQ-004 |

## Verification Matrix

| REQ ID | Unit Test | Integration Test | E2E Test | Manual Test | Notes |
|--------|-----------|-----------------|----------|-------------|-------|
| REQ-001 | Yes | No | No | No | authorize URL shape; mock Redis |
| REQ-002 | Yes | No | No | No | 409 on missing client cred |
| REQ-003 | Yes | No | No | Yes | exchange+userinfo mocked in unit; live exchange verified manually by admin at connect |
| REQ-004 | Yes | No | No | No | state mismatch/expiry |
| REQ-005 | Yes | No | No | No | exchange/userinfo failure → error redirect |
| REQ-006 | Yes | No | No | No | encrypt round-trip; raw read shows ciphertext |
| REQ-007 | Yes | Yes | No | No | cross-service: API write → pipeline read |
| REQ-008 | Yes | No | No | No | linkedin worker failed → notifyPublishFailed |
| REQ-009 | Yes | No | No | No | twitter worker failed → notifyPublishFailed |
| REQ-010 | Yes | No | No | No | skipped/posted → not called |
| REQ-011 | Yes | No | Yes | No | status response + UI render (Playwright) |
| REQ-012 | Yes | No | Yes | No | Connect button → start → navigate (Playwright) |
| REQ-013 | Yes | No | Yes | No | disabled state when no client creds (Playwright) |
| REQ-014 | Yes | No | No | No | missing refresh token still stores access |
| EDGE-001 | Yes | No | No | No | |
| EDGE-002 | Yes | No | No | No | |
| EDGE-003 | Yes | No | No | No | |
| EDGE-004 | Yes | No | No | No | migration test |
| EDGE-005 | Yes | No | No | No | |
| EDGE-006 | Yes | No | No | No | marker-not-written-on-webhook-fail (existing notifier behavior) |
| EDGE-007 | Yes | No | No | No | |
| EDGE-008 | Yes | No | No | No | callback not behind requireAdmin |

## Verification Scenarios (VS-0 — from library probe)

- **VS-0a:** `buildLinkedInAuthorizeUrl({ clientId, redirectUri, state, scope })` returns a URL with
  `response_type=code` and the correct `client_id`, `redirect_uri`
  (`<PUBLIC_BASE_URL>/api/admin/social-credentials/linkedin/oauth/callback`), `scope`, `state`.
  (Extends `packages/pipeline/tests/unit/social/linkedin/oauth.test.ts`.)
- **VS-0b:** `parseTokenResponse` extracts `access_token`/`refresh_token`/`expires_in`; a response with
  no `refresh_token` yields `refreshToken=null` (→ `hasRefreshToken=false`), not a throw.
- **VS-0c:** LinkedIn OAuth endpoints reachable: authorize → 200, token (empty POST) → 411,
  userinfo (unauth) → 401.

## Out of Scope

- Re-triggering today's already-failed run `1172e372` (operational; use existing
  `POST /api/runs/:runId/post/linkedin` after deploy + reconnect).
- Twitter/X OAuth UI — only the Twitter failure-alert wiring (REQ-009) touches the Twitter worker.
- Automatic background token refresh on a timer — the pipeline's existing reactive-refresh-at-post-time
  stays; this spec only ensures a refresh token now exists for it to use.
- Removing the `LINKEDIN_CLIENT_ID`/`LINKEDIN_CLIENT_SECRET` env vars — env-fallback for **client**
  creds is retained (the no-env-vars goal applies to the OAuth **tokens**, which never live in env).
- Multi-account LinkedIn (one connection only, singleton `social_tokens` row per platform).
