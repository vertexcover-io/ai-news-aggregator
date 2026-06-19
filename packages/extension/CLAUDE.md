# @newsletter/extension

Manifest V3 Chrome extension (React + Vite via `@crxjs/vite-plugin`). A toolbar popup lets
a logged-in operator submit the current tab's URL so it becomes a `manual`-sourced candidate
in the next newsletter run.

## Shape
- `manifest.config.ts` — MV3 manifest via `defineManifest`. Fixed `key` → deterministic
  extension id `alnmmlkpbceggejnpiajajenakencoeb` (the API CORS allowlist + e2e assertions
  rely on this id being stable). Minimal permissions: `tabs`, `storage`, `activeTab`.
  `host_permissions` is scoped to the API origin — do NOT widen to `https://*/*` (triggers an
  all-sites install warning); add the production API host explicitly when deploying.
- `src/popup/` — `App` (token in `chrome.storage.local` → `LoginView` | `AddView`),
  `LoginView` (password → bearer token), `AddView` (active-tab URL prefill → "Add this page").
- `src/lib/api.ts` — fetches `VITE_API_BASE` (`POST /api/extension/login`, `/submissions`)
  with `Authorization: Bearer`. `src/lib/storage.ts` — token persistence.
- `src/background.ts` — minimal MV3 service worker (popup does the work).

## Rules
- Token lives in `chrome.storage.local`, never `localStorage`. On a 401, clear it and return
  to LoginView.
- The backend auth is a SEPARATE bearer path (`ext|`-namespaced HMAC) — it is NOT the admin
  cookie. Never try to reuse the `admin_session` cookie (SameSite=Lax, no CORS, can't cross
  the `chrome-extension://` origin).
- Keep popup components thin and unit-testable; stub `chrome.*` with `vi.stubGlobal` (MV3
  chrome APIs are promise-based).

## Commands
pnpm --filter @newsletter/extension build       # vite build → loadable dist/
pnpm --filter @newsletter/extension dev         # vite dev
pnpm --filter @newsletter/extension test:unit   # vitest (storage + api client)
pnpm --filter @newsletter/extension test:e2e    # hermetic infra + Playwright loads unpacked ext

## E2E
`tests/e2e/run-e2e.mjs` brings up ephemeral PG+Redis (podman) + the API, builds the extension
with `VITE_API_BASE` pointed at the hermetic API, then Playwright loads it unpacked
(`launchPersistentContext`, `channel:"chromium"`, `--load-extension`, `--headless=new`).
Grab the service-worker handle ONCE (MV3 sw sleeps ~30s). Requires `pnpm infra` deps available.

## Loading manually
`pnpm --filter @newsletter/extension build`, then chrome://extensions → Developer mode →
Load unpacked → select `packages/extension/dist`.
