# Learnings — reddit-collector-apify

## L-001: super_admin login requires Host: localhost (domain config)

During live verification, `POST /api/auth/login` to a super_admin user returned 404 when curl omitted the `Host` header. The API's domain config has a set of recognized hosts (`appHosts`); requests arriving without a known host header do not route correctly. Fix: pass `-H "Host: localhost"` in all curl commands targeting the local dev server.

## L-002: super_admin is redirected to /admin/tenants by RequireOnboarding

A super_admin session that navigates directly to `/admin/settings` is redirected by the `RequireOnboarding` middleware to `/admin/tenants` (no tenant context). To verify the settings page as a super_admin, first impersonate a tenant via the "Open →" button on `/admin/tenants`, then navigate to `/admin/settings`. This is correct behavior, not a bug.

## L-003: Platform-level credential pattern and DB-first resolver

Two global lessons extracted from this feature — see:
- `.harness/knowledge/lessons/architecture/platform-level-secret-via-app-credentials-table-20260618.md`
- `.harness/knowledge/lessons/architecture/db-first-credential-resolver-pattern-20260618.md`

## L-004: collector-health probe for Reddit still uses RSS ping (separate from full collection)

The health probe in `packages/pipeline/src/services/collector-health/index.ts` does a lightweight RSS fetch for Reddit — it does NOT call the Apify actor. This is correct: the health check only verifies the subreddit is reachable, not that the Apify token works. The Apify actor is called only during the full collection run (`collectReddit`). Do not confuse the two paths.
