---
governs: packages/web/src/layouts/
last_verified_sha: 5a2ff20
key_files: [PublicLayout.tsx, AdminLayout.tsx, RequireAdmin.tsx]
flow_fns: [PublicLayout.tsx::PublicLayout, RequireAdmin.tsx::RequireAdmin]
decisions: [D-011]
status: active
---

# layouts/ — route-level layout wrappers

## Purpose

Three layout components used by the router: public chrome (nav + footer), admin nav bar, and an auth guard that redirects unauthenticated users.

## Public surface

| Component | Effect |
|---|---|
| `PublicLayout` | Wraps `/` and `/archive/:runId`: `#FAFAF7` bg, 960px max-width, Masthead + Outlet + Footer. Also handles `#subscribe` hash scroll on mount. |
| `AdminLayout` | Top nav bar: Dashboard, Settings, Analytics, Eval, Canon, View site links + Sign out button. Renders `<Outlet />`. |
| `RequireAdmin` | Calls `useAdminSession()`: renders `<Navigate to="/admin/login?next=...">` on unauthenticated, `<Outlet />` on success, `null` while loading. |

## Depends on / used by

- **Uses:** `hooks/useAdminSession`, `components/shell/Masthead`, `components/shell/Footer`, `components/ui/button`
- **Used by:** `App.tsx` (route definitions)

## Data flows

```
PublicLayout:
  useLocation() → { pathname, hash }
    ├─ hash === "#subscribe"
    │    → requestAnimationFrame poll (up to 5s) → scrollIntoView("#subscribe") on DOM ready
    └─ renders: Masthead + Outlet + Footer

RequireAdmin:
  useAdminSession() → { data, isLoading, error }
    ├─ isLoading → return null (blank page, avoids flash)
    ├─ error is UnauthenticatedError OR !data → Navigate to /admin/login?next=<current_path>
    └─ data.admin === true → Outlet
```

## Gotchas / landmines

- **Subscribe hash scroll polling**: `PublicLayout` polls for the `#subscribe` element up to 5s using `requestAnimationFrame`. This handles the case where the subscribe section hasn't rendered yet when the page first mounts (e.g., after a React suspense boundary). If the element doesn't appear within 5s, polling silently stops.
- **RequireAdmin blank during loading**: Returns `null` while the session query is loading. The admin login page check in `apiFetchAdmin`'s 401 handler is the redundancy for this case — if session check fails downstream, the redirect still fires.

## Decisions

### D-011: RequireAdmin returns null during loading

**Why:** Rendering `<Outlet />` before the session is confirmed would briefly expose admin-only content to an unauthenticated user. Returning `null` shows a blank page for the ~60ms the session check takes.

**Tradeoff:** A perceptible flash of white during navigation to admin pages. Could be improved with a loading skeleton, but not worth the complexity for a single-operator tool.

**Governs:** `layouts/RequireAdmin.tsx`
