# Chrome extension (MV3) build + e2e testing gotchas

Captured during the `chrome-extension-url-collector` feature (2026-06-18).

## Build (@crxjs/vite-plugin)
- crxjs 2.6.1 + Vite 8 emits `dist/manifest.json` whose `background.service_worker` points at a
  `service-worker-loader.js` shim (handles MV3 module loading), NOT the hashed background bundle.
  Expected — don't try to point the manifest directly at the background file.
- Pin a fixed manifest `"key"` for a deterministic extension id. The id is derived as
  `sha256(DER public key).hex.slice(0,32)` mapped `0-9a-f → a-p`. The API CORS allowlist and e2e
  assertions depend on this id being stable across builds/checkouts.
- Scope `host_permissions` to the API origin; `https://*/*` triggers an all-sites install warning.

## E2E (Playwright loading the unpacked extension)
- Extensions load ONLY via `launchPersistentContext` (never `launch()`), with
  `channel:"chromium"`, `--load-extension=<dist>`, `--disable-extensions-except=<dist>`,
  `--headless=new --no-sandbox --disable-dev-shm-usage`.
- **Grab the MV3 service-worker handle ONCE** right after launch and store the derived id on the
  context. MV3 SWs sleep after ~30s; re-waiting for a `serviceworker` event in later tests times out.
- **Boot the API via `playwright.config.ts` webServer**, not manually in the run-e2e entrypoint.
  The entrypoint owns PG+Redis+migrations+extension-build; let playwright's webServer own API
  lifecycle (it gets health-check + retry for free). A symptom of getting this wrong: login shows
  a generic "Login failed" (fetch threw) instead of the status-specific 401 path.
- Build the extension with `VITE_API_BASE` pointed at the hermetic API URL BEFORE launching, so
  the popup's cross-origin fetch hits the right (and CORS-allowed, because id is deterministic) origin.

## Popup UI for Playwright
- `getByLabel('URL')` only resolves if the `<label>` is associated with the input via
  `htmlFor`+`id`. Bare `<label>URL</label>` won't resolve — `.fill()` silently targets nothing
  and the test times out. Always pair `htmlFor="x"` with `id="x"` (also better a11y).

## chrome.* stubs (unit tests)
- Stub MV3 chrome APIs with `vi.fn((k) => Promise.resolve(...))`, not `vi.fn(async (k) => ...)`
  — async-without-await trips `@typescript-eslint/require-await`; behavior is identical.
- React 19 (`@types/react` 19.x): `React.FormEvent` is deprecated (`no-deprecated` catches it).
  Use `React.SyntheticEvent` in form submit handlers.

## Hono buildApp() unit tests
- A stub router that matches a broad path (e.g. `r.all('/*')` mounted at `/api`) can intercept
  requests to the route under test (e.g. `OPTIONS /api/extension/login`) before its middleware
  runs. Use empty `new Hono()` instances for stubs that would otherwise shadow the route.

## Test hygiene (reviewed defect)
- An integration test that cleans up with `DELETE WHERE sourceType='manual'` wipes ALL such rows.
  Combined with a worktree `.env` symlinked to the shared dev DB, that destroys real data. Always
  scope test cleanup to the ids the test itself seeded (`inArray(id, [...seeded])`).
