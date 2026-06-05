# Proof Report — web-collector-proxy-support

**Verdict: PASS**
**Date:** 2026-06-01
**Spec:** docs/spec/web-collector-proxy-support/spec.md
**Claims:** `.harness/web-collector-proxy-support/claims.json` — 44 executed, 44 passed, 0 failed.
**Feature type:** backend-only. No `type:"ui"` claims → no Playwright/browser-UI proof required.

## Summary

Routes the web collector's outbound HTTP through `WEB_HTTP_PROXY` across three transport seams
(undici `ProxyAgent` dispatcher for static fetch, Playwright `chromium.launch({proxy})` for browser
fetch, Crawlee `ProxyConfiguration` for the adaptive crawler). All four live VS-0 probes egress
through the proxy (proxied IP `38.154.203.95`), the pipeline unit suite passes at the expected count
(1131), and the fail-open / secret-never-logged / injected-fetchFn-bypass contracts hold under
adversarial probing.

## Live probe results (VS-0 — re-run against proxy 38.154.203.95:5863)

Probes were copied into `packages/pipeline/.probe-tmp/` and run with `node` so ESM bare-specifier
resolution (`undici`, `playwright-core`, `crawlee`) walks up into the pipeline package's
`node_modules` (undici@7.24.7 confirmed present there). Direct (home) IP redacted; only the proxied
IP `38.154.203.95` is retained as evidence.

### VS-0-undici-dispatcher — PASS (exit 0)
```
{
  "mechanism": "undici.ProxyAgent dispatcher",
  "directIp": "<redacted>",
  "proxiedIp": "38.154.203.95",
  "differs": true
}
VERIFIED
```

### VS-0-playwright-launch — PASS (exit 0)
```
{
  "mechanism": "playwright chromium.launch({proxy})",
  "status": 200,
  "body": "{\"ip\":\"38.154.203.95\"}"
}
VERIFIED
```

### VS-0-crawlee-static — PASS (exit 0)
```
INFO  AdaptivePlaywrightCrawler: Finished! Total 1 requests: 1 succeeded, 0 failed.
{
  "mechanism": "crawlee ProxyConfiguration on AdaptivePlaywrightCrawler",
  "results": [ { "url": "https://api.ipify.org?format=json",
    "text": "{\"ip\":\"38.154.203.95\"}", "proxyUsed": "yes", "proxyHostname": "38.154.203.95" } ]
}
VERIFIED
```

### VS-0-crawlee-browser — PASS (exit 0)
```
INFO  AdaptivePlaywrightCrawler: Finished! Total 1 requests: 1 succeeded, 0 failed.
{
  "mechanism": "crawlee ProxyConfiguration — BROWSER sub-path",
  "results": [ { "url": "https://api.ipify.org?format=json", "viaBrowser": true,
    "text": "{\"ip\":\"38.154.203.95\"}", "proxyHostname": "38.154.203.95" } ]
}
VERIFIED_BROWSER_SUBPATH
```

## Unit suite

`pnpm --filter @newsletter/pipeline test:unit` → **Test Files 97 passed (97), Tests 1131 passed
(1131)**, duration 18.51s. Matches the expected 1131. This proves the unit/api-typed claims
(REQ-002/003/004/005/006/007/010 + all EDGE cases marked Unit:Yes in the matrix).

## Spec coverage table

| REQ / EDGE | Scenario / evidence | Verdict |
|------------|---------------------|---------|
| REQ-001 (resolver returns trimmed value / null) | unit `proxy.test.ts` + adversarial A1–A8 | MET |
| REQ-002 (static fetch attaches ProxyAgent dispatcher) | unit `fetch-static.test.ts`; live VS-0-undici (egress=proxy); code `fetch-static.ts:25–31` | MET |
| REQ-003 (browser launch with parsed proxy) | unit `fetch-browser.test.ts`; live VS-0-playwright (body IP=proxy); code `fetch-browser.ts:41–47` | MET |
| REQ-004 (runWebCrawl passes ProxyConfiguration) | unit `web-crawler.test.ts`; live VS-0-crawlee static+browser; code `web-crawler.ts:100–106` | MET |
| REQ-005 (unset ⇒ unchanged behaviour) | unit (each seam omits wiring); full suite 1131 green; adversarial A1 | MET |
| REQ-006 (injected fetchFn not wrapped) | unit `fetch-static.test.ts`; adversarial A11 (no-dispatcher); code `fetch-static.ts:22–25` | MET |
| REQ-007 (proxy URL never logged) | grep A14 (no interpolation) + A15 (no proxy field in crawler.stats) + A10 (warn branches carry no secret) | MET |
| REQ-008 (undici@7.24.7 pinned + importable) | `package.json:52` `"undici":"7.24.7"`; probes import + construct `ProxyAgent` from pipeline scope; typecheck green | MET |
| REQ-009 (docs threading) | `.env.prod.example:45` commented placeholder; `deploy.yml:142` env block + `:189` optional list; `.env:51` local value | MET |
| REQ-010 (abort still works with dispatcher) | unit `fetch-static.test.ts`; code `fetch-static.ts:17–21` abort short-circuit precedes dispatcher attach | MET |
| EDGE-001 (empty ⇒ null) | adversarial A2; unit | MET |
| EDGE-002 (malformed ⇒ null + warn, no value) | adversarial A4/A9/A10; code `proxy.ts:12–29` | MET |
| EDGE-003 (abort mid static fetch) | unit; code read | MET |
| EDGE-004 (crawlee browser sub-path proxied) | live VS-0-crawlee-browser (`viaBrowser:true`, IP=proxy) | MET |
| EDGE-005 (collectWeb injects runWebCrawl ⇒ proxy-free) | unit suite green; no proxy resolution at collectWeb level | MET |
| EDGE-006 (URL-encoded creds decoded) | unit `fetch-browser.test.ts`; code `fetch-browser.ts:25–26` `decodeURIComponent` | MET |
| EDGE-007 (proxy unreachable at runtime) | NOT VERIFIED — documented behaviour, runtime-ops concern, explicitly out of scope (see adversarial §4) | N/A (out of scope) |

## Adversarial pass

See `verification/adversarial-findings.md`. 15 scenarios attempted across boundary inputs,
transport-ownership, secret-leak, error-recovery, and dependency-phantom categories. **0 defects.**

## Not executed

- **EDGE-007 runtime proxy-outage** — requires a deliberately-dead proxy; explicitly out of scope per
  spec §Out of Scope (reuses existing fetch/crawl failure handling, unchanged by this feature).
- **Live `collectWeb`/full-run end-to-end** — the three seams are proven individually live (VS-0) and
  the integration is unit-pinned; a full pipeline run is not part of VS-0.

## Cleanup

Temporary probe copies under `packages/pipeline/.probe-tmp/` were removed after each run. No
processes were left running. Verification artifacts retained under `verification/`.
