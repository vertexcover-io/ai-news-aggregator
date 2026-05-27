# Verification Stubs — admin-linkedin-oauth

Re-runnable probe scenarios folded into the spec's Verification Scenarios (VS-0).

## VS-0a — Authorize URL construction
`buildLinkedInAuthorizeUrl({ clientId, redirectUri, state, scope })` returns a URL whose query carries
`response_type=code`, the given `client_id`, `redirect_uri`, `scope`, and `state`.
Covered by: `packages/pipeline/tests/unit/social/linkedin/oauth.test.ts` (extend for the API redirect URI).

## VS-0b — Token response parsing
`parseTokenResponse(json)` extracts `access_token`/`refresh_token`/`expires_in`; a response missing
`refresh_token` yields `refreshToken=null` (→ status `hasRefreshToken=false`), not a throw.

## VS-0c — LinkedIn endpoint reachability
```bash
curl -s -o /dev/null -w "%{http_code}" "https://www.linkedin.com/oauth/v2/authorization"   # 200
curl -s -o /dev/null -w "%{http_code}" -X POST "https://www.linkedin.com/oauth/v2/accessToken"  # 411
curl -s -o /dev/null -w "%{http_code}" "https://api.linkedin.com/v2/userinfo"               # 401
```
All three non-zero/non-5xx ⇒ endpoints live.
