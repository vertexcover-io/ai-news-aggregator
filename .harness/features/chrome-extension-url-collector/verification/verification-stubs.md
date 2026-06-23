# Verification Stubs (VS-0 — promoted from library probe)

### VS-0-crxjs-build: @crxjs/vite-plugin builds a loadable MV3 extension
**Type:** build
**Run:** build the extension package (`pnpm --filter @newsletter/extension build`) and assert `dist/manifest.json` exists with `manifest_version: 3`, a `background.service_worker`, and an `action.default_popup`.
**Expected:** build exits 0; `dist/manifest.json` is valid MV3 with sw + popup.

### VS-0-pw-load: Playwright loads the unpacked extension and derives the extension ID
**Type:** ui
**Run:** `launchPersistentContext` with `channel:"chromium"`, `--load-extension=<dist>`, `--disable-extensions-except=<dist>`, `--headless=new --no-sandbox --disable-dev-shm-usage`; wait for the service worker; derive id from `serviceWorker.url().split('/')[2]`; navigate `chrome-extension://<id>/index.html`.
**Expected:** a service worker appears, an extension id is derived, the popup DOM renders.
