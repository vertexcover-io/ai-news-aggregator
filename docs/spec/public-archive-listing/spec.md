# Public Archive Listing — Spec

**Date:** 2026-04-17
**Design doc:** [../../plans/2026-04-17-public-archive-listing-design.md](../../plans/2026-04-17-public-archive-listing-design.md)
**Status:** Ready for planning

## Mockups

- Public listing: [../../plans/2026-04-17-public-archive-listing-mockups/public-listing.png](../../plans/2026-04-17-public-archive-listing-mockups/public-listing.png)
- Admin login: [../../plans/2026-04-17-public-archive-listing-mockups/admin-login.png](../../plans/2026-04-17-public-archive-listing-mockups/admin-login.png)

## Summary

Add a public root page that lists reviewed newsletter issues (date + story count, grouped by month, newest first). Move the operator dashboard and all its sub-pages under `/admin/*` behind a shared-password cookie session. Add a minimal login page and the API endpoints required to support the split.

Out of scope: RSS feed, email subscriptions, per-user accounts, About page content, rate limiting.

## Functional Requirements

### REQ-001 — Public listing page at `/`
- Route `/` renders the `ArchiveListing` component for any visitor, no auth.
- Page has: top nav with brand + "About" link, hero strip with tagline, main column (max 720px, centered), footer.
- Main column lists reviewed archives grouped by month, months descending, rows within a month descending by date.
- Each row renders as: `<Month Day, Year> — <N> stories` (e.g. `Apr 15, 2026 — 12 stories`, or `1 story` when N=1). Entire row is an `<a href="/archive/:runId">`.
- Row shows a chevron icon on the right; chevron visible on hover/focus only.
- Page `<title>` is `Newsletter archive`. `<meta name="description">` is `A hand-curated daily digest of what's actually moving in AI.`

### REQ-002 — Empty state
- When `GET /api/archives` returns an empty list, render centered copy: `No issues yet. Check back soon.` under the hero. No month headers, no rows.

### REQ-003 — Single-issue page stays public
- Route `/archive/:runId` remains publicly accessible and unchanged.
- The existing `GET /api/archives/:runId` endpoint remains public.

### REQ-004 — Admin route relocation
Relocate these routes:

| Old path | New path |
|---|---|
| `/` | `/admin` |
| `/run` | `/admin/run` |
| `/review/:runId` | `/admin/review/:runId` |
| `/settings` | `/admin/settings` |

- `/admin/login` is new and renders the login card.
- No server-side redirects from old paths to new paths (internal users, clean break).

### REQ-005 — Admin gate (client)
- A `<RequireAdmin>` wrapper wraps every `/admin/*` route except `/admin/login`.
- On mount, `<RequireAdmin>` calls `GET /api/admin/me` via react-query.
- While the request is pending, render nothing (no flash of admin UI).
- On 401, navigate to `/admin/login?next=<currentPath>` (preserve path + search).
- On 200, render children.

### REQ-006 — Admin gate (server)
- A Hono middleware mounted on `/api/admin/*` reads the `admin_session` cookie and verifies the HMAC.
- On missing/invalid/expired cookie: respond `401 { error: "unauthorized" }` and do not invoke the route handler.
- On valid cookie: attach `{ admin: true }` to the context and continue.

### REQ-007 — Login endpoint
- `POST /api/admin/login` accepts `{ password: string }` (zod-validated, non-empty).
- If `password === process.env.ADMIN_PASSWORD` (constant-time compare via `crypto.timingSafeEqual`): set `admin_session` cookie and return `200 { ok: true }`.
- Otherwise: return `401 { error: "invalid_password" }` and log `warn` with `{ ip, timestamp }`. Do not reveal whether the password env var is configured.
- If `ADMIN_PASSWORD` is unset at server startup, the server must fail to start with a clear error.

### REQ-008 — Session cookie
- Name: `admin_session`.
- Value: `<issuedAtMs>.<hmacHex>` where `hmacHex = HMAC-SHA256(process.env.SESSION_SECRET, "admin|" + issuedAtMs)`.
- Attributes: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=2592000` (30 days), `Secure` when `NODE_ENV === "production"`.
- Verification: HMAC must match AND `(now - issuedAt) <= 30 days`.
- If `SESSION_SECRET` is unset at server startup, the server must fail to start with a clear error.

### REQ-009 — Logout endpoint
- `POST /api/admin/logout` clears the `admin_session` cookie (same attributes, `Max-Age=0`) and returns `200 { ok: true }`. No auth required (idempotent).

### REQ-010 — Me endpoint
- `GET /api/admin/me` returns `200 { admin: true }` when the cookie is valid, `401 { error: "unauthorized" }` otherwise. Sits behind the admin middleware.

### REQ-011 — Listing endpoint
- `GET /api/archives` is public. No auth.
- Response: `{ archives: Array<{ runId: string; runDate: string; storyCount: number }> }`.
  - `runDate` is ISO-8601 date (`YYYY-MM-DD`).
  - `storyCount` is the length of `run_archives.rankedItems`.
- Ordering: `runDate DESC`.
- Only includes rows where `run_archives.reviewed = true`.
- No pagination in MVP (≤400 rows expected).

### REQ-012 — Admin API relocation
- Move these endpoints to require the admin middleware:
  - `POST /api/runs/now`
  - `POST /api/runs/:runId/cancel`
  - `GET /api/runs` and `GET /api/runs/:runId` (dashboard data)
  - `GET /api/settings`, `PUT /api/settings`
  - `PATCH /api/admin/archives/:runId` (moved from `/api/archives/:runId`)
  - `POST /api/admin/archives/:runId/add-post` (moved from `/api/archives/:runId/add-post`)
  - `GET /api/admin/archives/:runId/pool` (moved from `/api/archives/:runId/pool`)
  - `POST /api/admin/archives/:runId/promote` (moved from `/api/archives/:runId/promote`)
- `GET /api/archives` (list) and `GET /api/archives/:runId` (single) stay public.
- Admin archive mutations moved under `/api/admin/archives/*` to keep all gated endpoints in one namespace; `/api/runs/*` and `/api/settings` remain at their existing URLs (gated via middleware).

### REQ-013 — Login page
- Route `/admin/login` renders a centered card matching the mockup.
- Form has one password `<input type="password" required>`, a `Sign in` button, and a `← Back to archive` link to `/`.
- On submit: POST to `/api/admin/login`.
  - On 200: invalidate the `me` query and navigate to the `next` query param (default `/admin`).
  - On 401: show inline error under the field: `Incorrect password.` Keep the user on the login page. Clear the error on next keystroke.
- If the user is already authenticated (a probe to `/api/admin/me` returns 200), redirect immediately to `next` or `/admin`.

### REQ-014 — Sign-out in admin UI
- The admin layout header has a `Sign out` button. Clicking posts to `/api/admin/logout`, invalidates the `me` query, and navigates to `/`.

### REQ-015 — Session expiry mid-session
- Any admin-API call that returns 401 while the admin SPA is open triggers a navigation to `/admin/login?next=<currentPath>`.

### REQ-016 — Responsive layout
- Public listing and admin login must render usably at 375px width:
  - Listing: main column becomes full-width with 16px horizontal padding. Month headers remain readable. Row text wraps to two lines if needed.
  - Login card: shrinks to `min(360px, 100% - 32px)`.

## Non-Functional Requirements

- **NFR-A — Security of password.** `ADMIN_PASSWORD` is read only inside `packages/api` server code. Adding a CI grep check: `ADMIN_PASSWORD` must not appear in any file under `packages/web/` or `packages/shared/`.
- **NFR-B — Constant-time compare.** Password comparison uses `crypto.timingSafeEqual` over equal-length `Buffer`s. If the submitted password has a different length, still run the compare with a dummy buffer of equal length to avoid early-return timing leaks.
- **NFR-C — HMAC integrity.** Cookie verification uses `crypto.timingSafeEqual` on the decoded hex HMAC.
- **NFR-D — Listing performance.** `GET /api/archives` responds in < 200ms at 400 rows. Single Drizzle query, no N+1.
- **NFR-E — SEO.** Both public routes set unique `<title>` and `<meta name="description">`. No `noindex` tag. No sitemap required for MVP.
- **NFR-F — Accessibility.** Row anchors are keyboard-focusable; focus ring is visible. Month headers use `<h2>`. Login form uses `<label for>` linked to the input. Error messages are announced (aria-live="polite").
- **NFR-G — Logging.** Failed login logs `warn` with `{ ip, userAgent, timestamp }`. Successful login logs `info` with `{ timestamp }` (no password echoed).

## Edge Cases

- **EDGE-1** — Zero reviewed archives: render empty state (REQ-002).
- **EDGE-2** — Archive with `rankedItems.length === 0`: listing shows `0 stories`. Row is still clickable.
- **EDGE-3** — Archive unreviewed after being shown: next listing refresh drops the row; existing `ArchivePage` link still resolves.
- **EDGE-4** — Password rotated in `.env` without restart: new password rejected until server restart (acceptable; env vars load once at boot).
- **EDGE-5** — `SESSION_SECRET` rotated: all existing sessions invalidate; operators must log in again.
- **EDGE-6** — Clock skew between issue and verify: tolerance is whatever the 30-day window naturally absorbs; no sub-minute precision required.
- **EDGE-7** — User submits empty password: HTML `required` blocks on the client; server also rejects (zod `min(1)`).
- **EDGE-8** — User lands on `/admin/login` while already authenticated: immediately redirect to `next` or `/admin` (REQ-013).
- **EDGE-9** — Concurrent tabs: each tab's `<RequireAdmin>` independently probes `/api/admin/me`; cookie is shared, so all tabs agree.
- **EDGE-10** — Malformed or forged cookie: middleware rejects as 401. No distinction from "missing cookie" in the response body.

## API Contracts

### `GET /api/archives`
```
200 OK
{
  "archives": [
    { "runId": "uuid", "runDate": "2026-04-15", "storyCount": 12 },
    ...
  ]
}
```

### `POST /api/admin/login`
```
Request:  { "password": "string" }
200 OK:   { "ok": true }    (+ Set-Cookie: admin_session=...)
401:      { "error": "invalid_password" }
400:      { "error": "invalid_body" }
```

### `POST /api/admin/logout`
```
200 OK: { "ok": true }    (+ Set-Cookie: admin_session=; Max-Age=0)
```

### `GET /api/admin/me`
```
200 OK: { "admin": true }
401:    { "error": "unauthorized" }
```

## Data Model

No schema changes. Uses existing `run_archives` columns: `runId`, `runDate`, `rankedItems` (jsonb array), `reviewed`.

Optional index (only if listing latency becomes an issue):
```
CREATE INDEX run_archives_reviewed_rundate_idx
  ON run_archives (reviewed, run_date DESC)
  WHERE reviewed = true;
```
Not required for MVP — defer.

## Environment Variables

Add to `.env.example` and `.env`:
- `ADMIN_PASSWORD` — plaintext shared password. Required at API boot.
- `SESSION_SECRET` — 32+ byte random string (hex or base64). Required at API boot.

## Acceptance Criteria

1. Visiting `/` as an unauthenticated user renders the listing matching the public-listing mockup, showing only reviewed archives grouped by month, newest first.
2. The listing displays the correct empty-state copy when no reviewed archives exist.
3. Visiting `/admin` as an unauthenticated user redirects to `/admin/login?next=/admin` and renders the admin-login mockup.
4. Submitting the correct password logs the user in (cookie set) and navigates to the path in `next`.
5. Submitting an incorrect password shows `Incorrect password.` inline and keeps the user on the login page.
6. After login, all previously-working admin pages (`/admin`, `/admin/run`, `/admin/review/:runId`, `/admin/settings`) function identically to before the split.
7. `POST /api/admin/logout` clears the cookie; subsequent admin API calls return 401.
8. `GET /api/archives/:runId` still works unauthenticated (public archive page unaffected).
9. Non-admin APIs (`GET /api/archives`, `GET /api/archives/:runId`) do not require a cookie.
10. Admin APIs listed in REQ-012 return 401 without a valid cookie.
11. Starting the API with `ADMIN_PASSWORD` or `SESSION_SECRET` unset fails fast with a clear error.
12. `pnpm build`, `pnpm typecheck`, and `pnpm lint` pass from the repo root.
