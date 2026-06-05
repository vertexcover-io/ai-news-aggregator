# SPEC: Proxy Support for the Web Collector

**Source:** docs/spec/web-collector-proxy-support/design.md
**Library probe:** docs/spec/web-collector-proxy-support/library-probe.md (verdict PASS)
**Generated:** 2026-06-01

## Overview

Route the web collector's outbound HTTP through a configurable HTTP proxy (`WEB_HTTP_PROXY`,
`http://user:pass@host:port`), following the `REDDIT_HTTP_PROXY` convention. Three transport
seams must honour it: static fetch (undici `ProxyAgent` dispatcher), browser fetch (Playwright
`chromium.launch({proxy})`), and the Crawlee `AdaptivePlaywrightCrawler` (`ProxyConfiguration`).
Unset/empty/malformed ⇒ direct egress, zero behaviour change. The proxy URL is a secret and is
never logged.

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Ubiquitous | The system shall provide a pure resolver `resolveWebProxyUrl(env)` that returns the trimmed `WEB_HTTP_PROXY` value or `null`. | Given `{WEB_HTTP_PROXY:"http://u:p@h:1"}` returns that string; given `{}` returns `null`. | Must |
| REQ-002 | Event-driven | When `WEB_HTTP_PROXY` is a valid URL, static fetch (`fetch-static.ts`, default `globalThis.fetch` path) shall attach an undici `ProxyAgent` dispatcher built from it. | Unit: with the proxy set and no injected `fetchFn`, the `fetch` init carries a `dispatcher`; live (VS-0) egress IP = proxy IP. | Must |
| REQ-003 | Event-driven | When `WEB_HTTP_PROXY` is a valid URL, browser fetch (`fetch-browser.ts`) shall launch chromium with `proxy:{server,username,password}` parsed from the URL. | Unit: launch options include the parsed `proxy`; live (VS-0) page egress IP = proxy IP. | Must |
| REQ-004 | Event-driven | When `WEB_HTTP_PROXY` is a valid URL, `runWebCrawl` shall pass a `ProxyConfiguration({proxyUrls:[url]})` to `AdaptivePlaywrightCrawler`. | Unit: crawler options include `proxyConfiguration`; live (VS-0) static + browser sub-path egress IP = proxy IP. | Must |
| REQ-005 | Unwanted | If `WEB_HTTP_PROXY` is unset, all three seams shall behave exactly as before (no dispatcher, no launch `proxy`, no `proxyConfiguration`). | Unit: each seam omits its proxy wiring; existing suite unchanged (1108 tests still pass). | Must |
| REQ-006 | State-driven | While a caller injects an explicit `fetchFn` into `fetchStatic`/`fetchWebPost`, the system shall NOT force-apply the proxy dispatcher (caller owns transport). | Unit: injected `fetchFn` is called without an added `dispatcher`. | Must |
| REQ-007 | Ubiquitous | The system shall never emit the proxy URL (or its credentials) in any log line, error message, or telemetry field. | Grep of all new/changed code: no log/throw includes the proxy value; existing log events gain no proxy field. | Must |
| REQ-008 | Ubiquitous | The build shall declare `undici@7.24.7` as an explicit pinned dependency of `@newsletter/pipeline`. | `packages/pipeline/package.json` lists `"undici":"7.24.7"`; `import {ProxyAgent} from "undici"` resolves; typecheck passes. | Must |
| REQ-009 | Ubiquitous | The system shall document `WEB_HTTP_PROXY` in `.env` (with the value), `deployment/.env.prod.example`, and thread it through `deploy.yml` as an optional secret. | `.env` has the var; `.env.prod.example` has a commented placeholder; `deploy.yml` lists it in `optional` + the env block. | Must |
| REQ-010 | State-driven | While the proxy is attached to static fetch, the existing `AbortSignal` handling shall continue to function. | Unit: an aborted signal still rejects/aborts with the dispatcher present. | Should |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | `WEB_HTTP_PROXY=""` (set but empty) | Resolver returns `null`; treated as no proxy (mirrors `resolveChromiumExecutablePath`). | REQ-001, REQ-005 |
| EDGE-002 | `WEB_HTTP_PROXY="not a url"` (malformed) | Resolver returns `null`; a single non-secret `warn` is logged (the fact, not the value); seams run direct (fail-open). | REQ-001, REQ-007 |
| EDGE-003 | Proxy set, abort fires mid static fetch | Fetch aborts; dispatcher does not suppress the abort. | REQ-010 |
| EDGE-004 | Crawlee promotes a URL to its browser pool | `proxyConfiguration` covers the browser sub-path too (probe VERIFIED). | REQ-004 |
| EDGE-005 | `collectWeb` test injects `deps.runWebCrawl` | No proxy resolution happens at `collectWeb` level; injected crawl stays proxy-free. | REQ-005 |
| EDGE-006 | Proxy URL has URL-encoded credentials | `new URL` decodes `username`/`password` for the Playwright `proxy` object. | REQ-003 |
| EDGE-007 | Proxy host is unreachable at runtime | Surfaces as a normal fetch/crawl failure (not fail-open); same handling as a blocked site today. | REQ-002, REQ-004 |

## Verification Matrix

| REQ ID | Unit Test | Integration Test | E2E Test | Manual/Live (VS-0) | Notes |
|--------|-----------|-----------------|----------|-------------|-------|
| REQ-001 | Yes | No | No | No | Pure function table test (set/empty/malformed). |
| REQ-002 | Yes | No | No | Yes | Unit asserts dispatcher; VS-0-undici live. |
| REQ-003 | Yes | No | No | Yes | Unit asserts launch `proxy`; VS-0-playwright live. |
| REQ-004 | Yes | No | No | Yes | Unit asserts `proxyConfiguration`; VS-0-crawlee static+browser live. |
| REQ-005 | Yes | No | No | No | Each seam omits wiring when unset; full suite green. |
| REQ-006 | Yes | No | No | No | Injected `fetchFn` not wrapped. |
| REQ-007 | Yes | No | No | No | Static grep / review gate; no proxy field in logs. |
| REQ-008 | No | No | No | Yes | `package.json` + `pnpm install` + typecheck/import resolves. |
| REQ-009 | No | No | No | Yes | File-content assertions on `.env`, `.env.prod.example`, `deploy.yml`. |
| REQ-010 | Yes | No | No | No | Abort-with-dispatcher unit test. |
| EDGE-001 | Yes | No | No | No | Covered by REQ-001 table. |
| EDGE-002 | Yes | No | No | No | Resolver returns null + warn (no value). |
| EDGE-003 | Yes | No | No | No | Abort unit test. |
| EDGE-004 | No | No | No | Yes | VS-0-crawlee-browser. |
| EDGE-005 | Yes | No | No | No | `collectWeb` existing tests stay green. |
| EDGE-006 | Yes | No | No | No | URL-decode in proxy parse. |
| EDGE-007 | No | No | No | No | Documented behaviour; not separately tested (runtime ops concern). |

## Verification Scenarios (VS-0 — re-run live probes during functional-verify)

These require outbound network to the live proxy `38.154.203.95:5863`.

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

## Out of Scope

- Proxying any other collector (Reddit has its own `REDDIT_HTTP_PROXY`; HN/Twitter/web-search excluded).
- Proxy rotation, proxy pools, health-checking, or per-request proxy selection (single static URL).
- Changing the global undici dispatcher or proxying non-collector worker traffic (LLM, email, Slack).
- Making the proxy mandatory — unset = direct egress.
- Logging, persisting, or surfacing the proxy URL anywhere.
- Runtime proxy-outage handling beyond existing fetch/crawl failure paths (REQ-/EDGE-007 documents, does not add new handling).
