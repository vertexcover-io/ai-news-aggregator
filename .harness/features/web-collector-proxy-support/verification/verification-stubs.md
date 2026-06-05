# Verification Stubs (VS-0) — folded into spec by spec-generation

These re-run the library probes during functional verification to confirm the proxy still routes
correctly. Each requires outbound network to the live proxy `38.154.203.95:5863`.

### VS-0-undici-dispatcher: undici ProxyAgent routes fetch through the proxy
**Type:** api
**Run:** `node .harness/web-collector-proxy-support/probes/undici/probe.mjs`
**Expected:** exit 0; stdout includes `"differs": true` and `VERIFIED` (proxied IP = 38.154.203.95).

### VS-0-playwright-launch: chromium.launch({proxy}) egresses via the proxy
**Type:** api
**Run:** `node .harness/web-collector-proxy-support/probes/playwright/probe.mjs`
**Expected:** exit 0; status 200; body IP = `38.154.203.95`; stdout `VERIFIED`.

### VS-0-crawlee-static: Crawlee ProxyConfiguration (static sub-path)
**Type:** api
**Run:** `node .harness/web-collector-proxy-support/probes/crawlee/probe.mjs`
**Expected:** exit 0; `proxyHostname: 38.154.203.95`; stdout `VERIFIED`.

### VS-0-crawlee-browser: Crawlee ProxyConfiguration (adaptive browser sub-path, E4/R1)
**Type:** api
**Run:** `node .harness/web-collector-proxy-support/probes/crawlee/probe-browser.mjs`
**Expected:** exit 0; `viaBrowser: true`; body IP = `38.154.203.95`; stdout `VERIFIED_BROWSER_SUBPATH`.
