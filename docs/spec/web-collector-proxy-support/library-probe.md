# Library Probe — web-collector-proxy-support

> **Run at:** 2026-06-01
> **Verdict:** PASS

All three proxy-wiring mechanisms were validated against the **live** proxy
`http://…@38.154.203.95:5863/`. Each probe confirmed egress through the proxy IP `38.154.203.95`
(distinct from the direct/home egress IP), proving the wiring routes traffic correctly.

## Summary
| Library | Version | Health | Smoke (live proxy) | Final |
|---|---|---|---|---|
| undici (`ProxyAgent` dispatcher) | 7.24.7 | trusted | VERIFIED — proxied IP `38.154.203.95` ≠ direct | SELECTED |
| playwright-core (`chromium.launch({proxy})`) | 1.52.0 | trusted | VERIFIED — status 200, body IP `38.154.203.95` | SELECTED |
| crawlee (`ProxyConfiguration` on `AdaptivePlaywrightCrawler`) | 3.13.3 | trusted | VERIFIED (static **and** browser sub-path) — IP `38.154.203.95` | SELECTED |

## Selected
- **undici `ProxyAgent`** as a per-request `dispatcher` for static fetch (design D2). Evidence:
  `.harness/web-collector-proxy-support/probes/undici/probe.log` — `{directIp:106.x, proxiedIp:38.154.203.95, differs:true}`.
- **playwright-core `chromium.launch({ proxy })`** for browser fetch (design D3). The
  `http://user:pass@host:port` URL parses into `{ server, username, password }` via `new URL`.
  Evidence: `.harness/web-collector-proxy-support/probes/playwright/probe.log`.
- **crawlee `ProxyConfiguration({ proxyUrls: [url] })`** for the adaptive crawler (design D4).
  Evidence: `.harness/web-collector-proxy-support/probes/crawlee/probe.log` (static sub-path,
  `proxyInfo.hostname=38.154.203.95`) AND `probe-browser.log` (browser sub-path forced via
  `renderingTypeDetectionRatio:1` + `context.page` access — `viaBrowser:true`, IP confirmed).
  **This resolves design risk R1 / edge-case E4:** Crawlee's single `proxyConfiguration` covers
  BOTH the HTTP and the adaptive-browser sub-paths. No fallback needed.

## Key finding — undici must become an explicit dependency
`undici@7.24.7` is present in the workspace's pnpm store as a **phantom transitive dependency**
but is **NOT declared** in `packages/pipeline/package.json`. Under pnpm's strict node_modules
layout, `import { ProxyAgent } from "undici"` from pipeline source fails with
`ERR_MODULE_NOT_FOUND` / `MODULE_NOT_FOUND` (confirmed: `require.resolve("undici")` from the
pipeline package throws). The probe imported undici from the store path to prove the mechanism.

**Plan/coder action (hard requirement):** add `"undici": "7.24.7"` to
`packages/pipeline/package.json` `dependencies` (exact version, matching the installed
transitive version and the repo's no-`^`/`~` policy) and `pnpm install` before importing it.
`globalThis.fetch` is undici-backed, so the major is guaranteed compatible.

## No pivots
No library failed; the fallback chain (https-proxy-agent / HTTPS_PROXY env / per-URL fetchAdaptive)
was not exercised.

## Setup Needed
- None for CI tests (proxy wiring is unit-tested without a live proxy — see verification stubs).
- The live-proxy probes require outbound network to `38.154.203.95:5863`; they are gated as VS-0
  scenarios re-runnable during functional verification.

<!-- LP:VERDICT:PASS -->
