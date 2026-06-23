# Library Probe — chrome-extension-url-collector

> **Run at:** 2026-06-18
> **Verdict:** PASS

## Summary
| Library | Health | Smoke | Final |
|---|---|---|---|
| @crxjs/vite-plugin 2.6.1 | trusted (332k wk dl, modified 2026-06-11) | VERIFIED — built loadable MV3 dist (manifest+sw+popup) | SELECTED |
| wxt 0.20.26 | trusted (588k wk dl) | not needed (primary passed) | FALLBACK (unused) |
| @playwright/test 1.59.1 | trusted (already in repo, CfT installed) | VERIFIED — loaded unpacked ext, derived id, read popup DOM | SELECTED |
| hono/cors | trusted (built into hono, already dep) | VERIFIED — import OK | SELECTED |

## Selected
- **@crxjs/vite-plugin** for the MV3 extension build. Evidence: `.harness/runtime/chrome-extension-url-collector/probes/crxjs/probe.log` — `vite build` emitted `dist/manifest.json` (mv3, service-worker-loader.js, action popup index.html).
- **@playwright/test (channel chromium)** for e2e loading of the unpacked extension. Evidence: `probes/crxjs/probe-pw-load.log` — `launchPersistentContext` + `--load-extension` loaded the build, service worker detected, extension id `hfmfgcamhjjakbeaofjikbmebkbdpfdj` derived, popup DOM read.
- **hono/cors** for scoped CORS on extension routes (no fallback needed; part of hono).

## Pivot Log
None — primary libraries verified on first probe.

## Setup Needed
None. No credentials required (all dev/build tooling; no external network service). The 2025 `@crxjs/vite-plugin` maintenance concern is resolved — v2.6.1 is actively maintained.

## Notes for planning
- Pin a deterministic extension id via manifest `"key"` so the CORS allowlist + e2e id are stable across dev/CI (probe used a random-path id; production must fix it).
- e2e flags that worked: `channel:"chromium"`, `--headless=new`, `--no-sandbox`, `--disable-dev-shm-usage`.
- Grab the service-worker handle once (MV3 sleeps ~30s); don't re-wait for a new `serviceworker` event.

<!-- LP:VERDICT:PASS -->
