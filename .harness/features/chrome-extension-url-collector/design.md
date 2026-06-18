# Design: Chrome Extension — Add URL to Next-Day Newsletter

## Problem

The operator finds useful AI links throughout the day while browsing. There is no
low-friction way to capture a URL so it becomes a ranked candidate in the next day's
newsletter. Today the only injection path is `POST /archives/:runId/add-post`, which
appends to an *already-running* archive — wrong timing and requires an active run.

We want a Chrome extension: log in once, then one-click "add this page" to feed the
URL into the **next** scheduled run's candidate pool.

## Goal / Non-Goals

**Goals**
- A separate `@newsletter/extension` package (Manifest V3, React+Vite popup).
- Popup: login screen (shared password → bearer token) → "Add this page" button that
  submits the current tab's URL (editable) + optional title.
- A new API auth path for the extension (bearer token) that does NOT touch the existing
  admin cookie gate.
- Submitted URLs land in `raw_items` with a new `manual` SourceType and are enriched,
  so the next run's `CandidatesRepo.findSince()` picks them up and they flow through
  dedup → shortlist → rank → recap normally.
- E2E tested (Playwright, loading the unpacked extension) against hermetic infra.

**Non-Goals**
- No per-user accounts (single shared password, matching the existing app).
- No context menu / right-click capture (popup-only this version).
- No injection into the *current* run (explicitly next-day).
- No publishing/review changes — submitted items appear as ordinary candidates.

## Key Decisions (user-approved)

1. **Auth = bearer token, isolated from the cookie gate.**
   New `POST /api/extension/login` accepts `{ password }`, verifies against
   `ADMIN_PASSWORD`, and returns a signed bearer token (HMAC-SHA256 over an issued-at
   timestamp using the existing `SESSION_SECRET`, mirroring `auth/session.ts`'s
   `issueToken`/`verifyToken`, but a distinct token namespace). A new
   `requireExtensionAuth` middleware verifies `Authorization: Bearer <token>`.
   - Rationale: the existing `admin_session` cookie is `SameSite=Lax` + no CORS, so it
     cannot be sent from a `chrome-extension://` origin. Making it `SameSite=None`
     would downgrade CSRF protection on the existing dashboard — rejected. A separate
     bearer path leaves the admin gate untouched.
   - CORS: add `hono/cors` scoped ONLY to the new extension routes, allowing the
     `chrome-extension://<id>` origin (configurable via `EXTENSION_ORIGIN` env, default
     permissive `chrome-extension://*`-style match handled by reflecting the request
     origin when it starts with `chrome-extension://`). Admin/runs/settings routes get
     NO CORS change.

2. **Ingestion = insert into `raw_items` with a new `manual` SourceType.**
   New `POST /api/extension/submissions` (behind `requireExtensionAuth`) validates the
   URL, enriches it (reuse the existing link-enrichment / `hydrateAddedPost` path that
   `add-post` already uses to fetch title/author/content), and upserts a `raw_items`
   row with `sourceType: "manual"`, `externalId = hash(canonicalUrl)`,
   `collectedAt: now()`. The next scheduled run picks it up via
   `CandidatesRepo.findSince()` — no pipeline changes needed beyond allowing `manual`
   in the candidate source filter.
   - Add `"manual"` to the `SourceType` union in `shared/src/db/schema.ts` +
     `constants/sources.ts` (label e.g. "Manually added"). New nullable usage degrades
     gracefully (legacy archives never reference it).

3. **UI = popup login + add-current-tab.** React + Vite, MV3. Token persisted in
   `chrome.storage.local`. The popup reads the active tab URL via `chrome.tabs.query`.

## Architecture

```
Chrome popup (React/Vite, MV3)
  │  chrome.tabs.query → current URL
  │  fetch (Authorization: Bearer <token>)   ← token from chrome.storage.local
  ▼
@newsletter/api
  POST /api/extension/login         → { token }          (verifies ADMIN_PASSWORD)
  POST /api/extension/submissions   → { id, url, ... }    (requireExtensionAuth + CORS)
        │ enrich URL (hydrate title/author/content)
        ▼
  raw_items  (sourceType="manual", externalId=hash(url), collectedAt=now)
        │
        ▼  (next scheduled run)
  CandidatesRepo.findSince()  → dedup → shortlist → rank → recap → archive
```

### Component breakdown

- **`packages/extension/`** (`@newsletter/extension`)
  - `manifest.json` (MV3): `action` popup, `permissions: ["tabs","storage","activeTab"]`,
    `host_permissions` for the API base, a stable `"key"` for a deterministic extension
    ID (needed for CORS allowlist + e2e), `background.service_worker` (minimal — token
    refresh/no-op; popup does the work).
  - `src/popup/` — React app: `LoginView`, `AddView`, an `api.ts` client (base URL from
    a build-time `VITE_API_BASE`), `storage.ts` wrapper over `chrome.storage.local`.
  - Vite config with `@crxjs/vite-plugin` (or manual MV3 build) producing
    `dist/` loadable unpacked.
- **`packages/api`**
  - `src/auth/extension-token.ts` — `issueExtensionToken` / `verifyExtensionToken`
    (HMAC, reuse SESSION_SECRET, distinct prefix).
  - `src/auth/extension-middleware.ts` — `requireExtensionAuth`.
  - `src/routes/extension.ts` — `createExtensionRouter({ login, submissions })`.
  - `src/services/user-submissions.ts` — `createUserSubmission(url, title?)` → enrich +
    upsert raw_items, returns inserted id.
  - `src/lib/validate.ts` — `submitUrlSchema`, `extensionLoginSchema`.
  - `app.ts` — mount `/api/extension/*` with scoped CORS; login is unauthenticated,
    submissions behind `requireExtensionAuth`.
- **`packages/shared`** — add `"manual"` SourceType + label.
- **`packages/pipeline`** — ensure `manual` is included in the candidate source filter
  (so manual items are eligible candidates).

## Data / API contracts

```
POST /api/extension/login
  req:  { "password": string }
  200:  { "token": string, "expiresAt": number }
  401:  { "error": "invalid_password" }

POST /api/extension/submissions      (Authorization: Bearer <token>)
  req:  { "url": string(url), "title"?: string(1..200) }
  201:  { "id": number, "url": string, "sourceType": "manual", "title": string, "alreadyExisted": boolean }
  400:  { "error": "<zod msg>" }
  401:  { "error": "unauthorized" }
```

Dedup: `externalId = hash(canonicalUrl)`; re-submitting the same URL upserts (returns
`alreadyExisted: true`), no duplicate row.

## Testing strategy

- **Unit (vitest)**: token issue/verify (incl. tamper + expiry), `requireExtensionAuth`
  (missing/invalid/expired bearer), `submitUrlSchema`, `createUserSubmission` (enrich
  mocked, asserts raw_items upsert shape incl. `sourceType:"manual"`, hashed externalId,
  dedup upsert). Popup logic units where practical (storage wrapper, api client) with
  `chrome.*` stubbed via `vi.stubGlobal`.
- **E2E (Playwright, MANDATORY — UI surface)**: load the built unpacked extension via
  `launchPersistentContext` + `--load-extension` + `--disable-extensions-except`,
  `channel: "chromium"`. Derive extension ID from the service worker URL. Stand up the
  hermetic API (reuse `packages/web/tests/e2e/run-e2e.mjs` infra pattern: ephemeral
  PG+Redis, migrate, boot API). Scenarios:
  1. Open popup → login with correct password → AddView shown; wrong password → error.
  2. Logged-in popup → "Add this page" → 201 → assert a `raw_items` row exists with
     `source_type='manual'` and the submitted URL.
  3. Re-submit same URL → `alreadyExisted`, no duplicate row (DB count == 1).
  4. (Candidate eligibility) a `manual` raw_item with recent `collectedAt` is returned
     by `CandidatesRepo.findSince()` — covered at integration level.
- **Extension-loading gotchas** (from prior research, fold into the e2e harness):
  pin extension ID via manifest `"key"`; grab the service-worker handle once
  (MV3 sleeps ~30s); wait for markers, never fixed sleeps; CORS allowlist must include
  the deterministic extension origin; `--no-sandbox --disable-dev-shm-usage` in CI.

## External Dependencies & Fallback Chain

| Dependency | Purpose | Verify | Fallback chain |
|---|---|---|---|
| `@crxjs/vite-plugin` | Build MV3 extension with Vite (HMR, manifest handling) | Probe: scaffold a minimal MV3 manifest + Vite build, confirm it emits a loadable `dist/` with service worker + popup html | 1) `@crxjs/vite-plugin` → 2) **`wxt`** (wxt.dev, actively maintained, strong testing story) → 3) **manual Vite multi-entry build** (plain `vite build` with a hand-written `manifest.json` copied to dist; no plugin). Manual is the guaranteed-works floor. |
| `playwright` (already a devDep via web e2e) | Load unpacked extension + drive popup in e2e | Probe: `launchPersistentContext` with `--load-extension` pointing at a trivial built extension; assert a service worker appears and its URL yields an extension id | 1) Playwright (already in repo) → 2) Puppeteer (`enableExtensions`). Playwright is already used for web e2e, so strongly preferred. |
| `hono/cors` | Scoped CORS for extension routes | Built into `hono` (already a dep) — probe just confirms the import path + that it can reflect a `chrome-extension://` origin | None needed (part of hono); if absent, hand-roll an OPTIONS handler + headers. |

No new *runtime* network services are introduced — auth reuses SESSION_SECRET, ingestion
reuses the existing enrichment + raw_items path. The only genuinely new external tooling
is the **extension build plugin**, hence the fallback chain centered there.

## Risks

- **Extension build tooling churn**: `@crxjs/vite-plugin` has had maintenance scares.
  Mitigated by the wxt → manual-build fallback chain (probed before coding).
- **CORS + extension origin**: deterministic ID via manifest `"key"` is required so the
  CORS allowlist is stable across dev/CI. Probe verifies the id derivation.
- **MV3 service-worker lifecycle in e2e**: capture the SW handle once; don't re-wait.
- **Backwards compat**: adding `"manual"` to SourceType is additive; legacy archives
  never reference it, so reads degrade gracefully (follows existing nullable-column rule).
```
