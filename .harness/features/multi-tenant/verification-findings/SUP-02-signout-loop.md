# Finding: Sign-out from the super-admin console hangs in a runaway loop (no redirect)

- **Feature:** SUP-02 / super-admin console session (`/admin/tenants`); logout
- **Role:** SuperAdmin (`super_admin`)
- **Severity:** **Major** — a super-admin cannot cleanly sign out; the page is left blank and stuck while hammering the API and analytics.
- **Suspected scope:** Web auth/logout + route-guard interaction. Not a data-isolation issue. A related latent bug affects tenant_admin logout (below).
- **Status:** ✅ **FIXED** (2026-06-17).

## Resolution (applied)
Both sign-out handlers now drop the cached session with `queryClient.removeQueries({ queryKey: ["auth","me"] })` (no refetch) instead of `invalidateQueries` (which refetched `/api/auth/me`, 401-rejected, and skipped the navigate):
- `packages/web/src/pages/SuperAdminTenantsPage.tsx` — `handleSignOut` → removeQueries, then `navigate("/admin/login")`.
- `packages/web/src/layouts/AdminLayout.tsx` — `handleSignOut` → fixed the key (`["admin","me"]` → `["auth","me"]`) + removeQueries, then `navigate("/")`.

Regression test: `packages/web/tests/e2e/super-admin-console.spec.ts` → "signing out of the console returns to login (no auth-check loop)".

Live verification (Playwright against the running stack): after Sign out the URL settles on `/admin/login`, the Sign-in form renders, and `/api/auth/me` is called **once** (previously thousands in a tight loop). Typecheck + lint clean; 911 web unit tests pass.

## Expected
Clicking **Sign out** on the super-admin console logs the user out and redirects to `/admin/login` (or `/`), leaving a clean unauthenticated state.

## Observed (reproduced deterministically, twice)
After clicking **Sign out** on `/admin/tenants`:
- The URL **stays** on `/admin/tenants` (no redirect to login).
- The page goes **blank** (snapshot shows only the notifications region).
- The console floods with a tight, unbounded loop of, repeating thousands of times within seconds (≈4000 new entries between two snapshots):
  ```
  [ERROR] Failed to load resource: 401 (Unauthorized) @ /api/auth/me
  [ERROR] [PostHog.js] This capture call is ignored due to client rate limiting.
  ```
- Navigating away (to `/`) is the only way to stop it.

**Isolation:** A *clean* unauthenticated navigation directly to `/admin/tenants` (no prior login) redirects properly to `/admin/login?next=%2Fadmin%2Ftenants` with **no loop**. So the fault is in the **logout transition from the console**, not the guard for unauthenticated access in general.

## Root cause
`packages/web/src/pages/SuperAdminTenantsPage.tsx` — `handleSignOut`:
```ts
async function handleSignOut(): Promise<void> {
  await logout();                                                   // clears the session cookie
  await queryClient.invalidateQueries({ queryKey: ["auth", "me"] }); // ← forces refetch of /api/auth/me, now 401
  await navigate("/admin/login");                                    // ← never reached
}
```
1. `logout()` clears the cookie.
2. `invalidateQueries(["auth","me"])` immediately refetches `/api/auth/me`. `fetchMe` **throws `UnauthenticatedError` on 401**, and `queryClient.invalidateQueries(...)` **rejects when a refetch errors**. The rejection propagates out of `handleSignOut` (swallowed by the `void handleSignOut()` call site), so **`navigate("/admin/login")` never runs** — matching the observed "URL stays on `/admin/tenants`".
3. The page is now mounted on a guarded route while unauthenticated. The guard chain oscillates against the re-fetching session observer:
   - `useSession` (`packages/web/src/hooks/useSession.ts`) has `staleTime: 60_000`; react-query **retains the last-good `data` (the super-admin session) even after the query errors**. So renders see *both* stale `data` (super_admin) *and* `error = UnauthenticatedError` depending on timing.
   - `RequireAdmin` → on `UnauthenticatedError` wants `/admin/login`.
   - `RequireOnboarding` → sees stale `data.role === "super_admin"` + no impersonation ⇒ `isIdleSuperAdmin` ⇒ `<Navigate to="/admin/tenants" replace />`.
   - These two pull in opposite directions across refetch cycles; each remount re-runs `useSession` → refetch `/api/auth/me` (401) and fires a PostHog capture, producing the unbounded loop (the PostHog client then rate-limits, hence the paired message).

The trigger unique to this path is awaiting an invalidation of a query that is **guaranteed to fail right after logout**, before navigating away.

## Related latent bug (same family) — tenant_admin logout invalidates the wrong key
`packages/web/src/layouts/AdminLayout.tsx` — `handleSignOut`:
```ts
await logout();
await queryClient.invalidateQueries({ queryKey: ["admin", "me"] });  // ← key mismatch
await navigate("/");
```
The session query key is **`["auth","me"]`** (see `useSession`), not `["admin","me"]`. So this invalidation matches **no query** — the tenant_admin sign-out does **not** actually invalidate the session cache. It "works" only because it navigates to the public `/` and the stale session later expires via `staleTime`. Inconsistent with the super console (which uses the correct `["auth","me"]` key) and a latent correctness bug.

## Reproduction
1. Log in as `super@vertexcover.io` → lands on `/admin/tenants`.
2. Click **Sign out**.
3. Observe: URL stays `/admin/tenants`, page blank, console loops `GET /api/auth/me 401` + PostHog rate-limit, thousands of entries.
4. Contrast: log out, then in a clean state navigate to `/admin/tenants` → redirects to `/admin/login` with no loop.

## Notes for the (future) fix — NOT applied
For the record only:
- Navigate first, then clear session state; or use `queryClient.removeQueries`/`setQueryData(["auth","me"], null)` (which don't refetch) instead of `invalidateQueries`; or don't `await` the invalidation; or wrap it so its rejection can't skip the navigate.
- Fix the `AdminLayout` key mismatch (`["admin","me"]` → `["auth","me"]`).
- Consider gating `RequireOnboarding`'s `isIdleSuperAdmin` redirect on a non-errored session so it can't fight `RequireAdmin` during an auth error.
