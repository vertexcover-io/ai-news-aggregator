# Design: Proxy Support for the Web Collector

**Status:** Draft (auto-mode brainstorm)
**Spec name:** `web-collector-proxy-support`
**Date:** 2026-06-01
**Scope:** Medium (new cross-cutting capability inside an existing subsystem; three fetch seams)

## Problem

The web collector (`packages/pipeline/src/collectors/web.ts`) fetches blog listing and detail
pages directly from the production VPS IP. Some target sites block or rate-limit that IP, the
same failure class that already forced Reddit collection behind an HTTP proxy
(`REDDIT_HTTP_PROXY`). The web collector currently has **no proxy support at all** — every
outbound request egresses from the host IP. When a site blocks the VPS, the collector's static
fetch, browser fetch, and Crawlee crawl all fail with HTTP errors or timeouts, and the `blog`
source silently degrades.

We need to route the web collector's outbound HTTP traffic through a configurable HTTP proxy,
following the established `REDDIT_HTTP_PROXY` convention, so production runs egress from a
residential/datacenter proxy IP instead of the blocked VPS IP.

The proxy to use is `http://<user>:<pass>@38.154.203.95:5863/` (a distinct proxy
endpoint from the Reddit one — same credentials, different host).

## Context

The web collector has **three distinct outbound-HTTP seams**, all of which must honour the proxy:

| Seam | File | Mechanism | Used by |
|------|------|-----------|---------|
| Static fetch | `services/web-fetch/fetch-static.ts` | `globalThis.fetch` (undici-backed at runtime; undici is not imported today — the new `ProxyAgent` dispatcher is the only direct undici touch-point added) | `fetchAdaptive` first attempt; `fetchWebPost` (add-post) |
| Browser fetch | `services/web-fetch/fetch-browser.ts` | `playwright-core` `chromium.launch` | `fetchAdaptive` fallback |
| Crawlee crawl | `services/web-crawler.ts` | `AdaptivePlaywrightCrawler` (own HTTP + browser pool) | `collectWeb` Pass-1 listings + Pass-2 details (the batch path) |

The **batch collection path** (`collectWeb`) uses `runWebCrawl` (Crawlee) for both listing and
detail fetches — this is the dominant production path and the one that egresses the most traffic.
`fetchAdaptive` (static → browser) is used by the **add-post single-post flow** (`fetchWebPost`).
Both paths must be proxied for the feature to be complete.

Installed deps (exact versions, do not change): `undici@7.24.7` (transitive, available),
`playwright-core@1.52.0`, `crawlee@3.13.3`.

### Existing convention (`REDDIT_HTTP_PROXY`)

- Env var named `<SOURCE>_HTTP_PROXY`, value `http://user:pass@host:port`.
- Documented in `.env` with a comment: "required in production where the VPS IP is blocked …
  treat as a secret, never log."
- Listed in `.github/workflows/deploy.yml` as an `optional` env var, threaded from a GH secret
  of the same name into the container env block.
- Convention is **opt-in**: unset ⇒ no proxy, direct egress (current behaviour preserved for
  local dev and tests).

This design adds the symmetric `WEB_HTTP_PROXY` env var.

### Context map alignment

- The pipeline package owns collectors; web-fetch + web-crawler are pipeline services. No
  package boundary is crossed.
- Repository-access and no-HTTP-framework rules are unaffected (no DB, no HTTP server changes).
- The proxy value is a secret — the existing "never log the proxy" rule from `.env` applies.

## Requirements

### Functional

- **F1** — WHEN `WEB_HTTP_PROXY` is set to a valid `http://user:pass@host:port` URL, the web
  collector's static fetch (`fetch-static.ts`) SHALL route its request through that proxy.
- **F2** — WHEN `WEB_HTTP_PROXY` is set, the web collector's browser fetch (`fetch-browser.ts`)
  SHALL launch chromium with that proxy configured.
- **F3** — WHEN `WEB_HTTP_PROXY` is set, the Crawlee crawl (`web-crawler.ts`) SHALL route both
  listing and detail requests (HTTP and browser sub-paths) through that proxy.
- **F4** — WHEN `WEB_HTTP_PROXY` is unset or empty, all three seams SHALL behave exactly as
  today (direct egress, no proxy) — zero behaviour change for local dev and the existing test
  suite.
- **F5** — The proxy URL SHALL be resolved from the environment once per fetch operation (read
  at call time, not cached at module load) so a deploy-time env change takes effect without a
  code change, consistent with how other env-driven config is read.

### Non-functional

- **NF1 — Secret hygiene:** The proxy URL (which embeds credentials) SHALL NEVER appear in any
  log line, error message, or telemetry field. Existing log events (`crawler.stats`,
  `collector.web.*`) must not gain a proxy field.
- **NF2 — Minimal dependency change:** Use the already-installed transports (`playwright-core`,
  `crawlee`). The one required `package.json` change is promoting `undici@7.24.7` from a phantom
  transitive dep to an **explicit pinned** dependency of `@newsletter/pipeline` (library-probe
  confirmed pipeline cannot `import "undici"` otherwise). Exact version, no `^`/`~`. No other new
  package.
- **NF3 — Type-safety:** No `any`, no `@ts-ignore`. Explicit return types on new exported
  functions (project TS standard).
- **NF4 — Testability:** Proxy resolution and wiring SHALL be unit-testable without a live proxy
  — the env→config mapping is a pure function; the wiring is verified by asserting the
  dispatcher/launch-option/proxyConfiguration is constructed when the env is set and omitted when
  not.

### Edge cases

- **E1 — Empty string:** `WEB_HTTP_PROXY=""` (set but empty) SHALL be treated as unset (no
  proxy). Mirrors the `resolveChromiumExecutablePath` empty-string handling already in the code.
- **E2 — Malformed URL:** A non-parseable `WEB_HTTP_PROXY` SHALL NOT crash the collector at
  module load. Decision: treat a malformed value as "no proxy" and emit a single non-secret
  `warn` (logging the fact that the var was malformed, NOT its value), so a typo degrades to
  direct egress rather than killing the `blog` source. Rationale: matches F4's
  fail-open-to-direct posture; the proxy is an availability aid, not a security control.
- **E3 — Static path proxied but abort fires:** The existing `AbortSignal` handling
  (`fetch-static.ts` checks `opts.signal`) must continue to work when a proxy dispatcher is
  attached. The dispatcher is passed alongside `signal` in the same `fetch` init.
- **E4 — Crawlee browser sub-path:** `AdaptivePlaywrightCrawler` promotes some URLs to its
  internal browser pool. Crawlee's `proxyConfiguration` covers BOTH the HTTP and browser
  sub-paths of the adaptive crawler, so a single `proxyConfiguration` wiring covers F3 fully
  (to be confirmed by library-probe).
- **E5 — fetchWebPost with caller-supplied `fetchFn`:** `fetchWebPost` and `fetchStatic` accept
  an optional `fetchFn` injection (used by add-post and tests). When the caller injects a
  `fetchFn`, the proxy SHALL NOT be force-applied (the caller owns the transport). The proxy is
  applied only to the **default** `globalThis.fetch` path. This keeps tests and the add-post
  dispatcher deterministic.

- **E6 — Batch-path proxy lives only in `runWebCrawl`, not `collectWeb`.** The batch path has no
  `fetchFn` seam; its proxy comes solely from Crawlee's `proxyConfiguration` (D4) inside
  `runWebCrawl`. `collectWeb` SHALL NOT resolve or inject the proxy — tests that inject
  `deps.runWebCrawl` replace the whole crawl and therefore stay proxy-free, preserving F4's
  "zero behaviour change for the existing test suite".

## Architectural Decisions

- **D1 — One shared resolver, three wiring points.** A single pure helper
  `resolveWebProxyUrl(env): string | null` reads `WEB_HTTP_PROXY`, trims, treats empty/malformed
  as `null`. Each of the three seams consumes it independently with its own mechanism. *Why:*
  the env→value decision (empty, malformed, secret) is identical across seams; the transport
  wiring is not. One resolver, no duplicated trimming/validation logic.

- **D2 — Static fetch uses undici `ProxyAgent` as a per-request `dispatcher`, not a global
  dispatcher.** *Why:* `setGlobalDispatcher` would silently route *all* `globalThis.fetch` in
  the worker process (email, Slack, LLM SDKs) through the proxy — scope creep and a hard-to-debug
  global side effect. A per-request `dispatcher` on the `fetch` init confines the proxy to the
  web-collector's own requests.

- **D3 — Browser fetch passes `proxy` to `chromium.launch`.** Playwright parses the
  `http://user:pass@host:port` URL into `{ server, username, password }`. *Why:* native
  Playwright launch option; no extra dependency.

- **D4 — Crawlee uses `ProxyConfiguration({ proxyUrls: [url] })` on the crawler options.** *Why:*
  Crawlee's first-class proxy mechanism; covers both the HTTP and browser sub-paths of the
  adaptive crawler in one place (E4).

- **D5 — Resolve at call time, fail open.** Each seam resolves the proxy when it runs, not at
  module import. Unset/empty/malformed ⇒ no proxy, run continues. *Why:* F4/F5 + E2 — the proxy
  is an availability aid; a config error must not take the source offline.

- **D6 — New env var `WEB_HTTP_PROXY`, not a reuse of `REDDIT_HTTP_PROXY`.** *Why:* the task
  supplies a distinct proxy endpoint for the web collector, and per-source proxy vars match the
  established `<SOURCE>_HTTP_PROXY` naming. Keeps the two sources independently rotatable.

### Data flow

```mermaid
graph TB
  subgraph collectWeb["collectWeb (batch path)"]
    RW[runWebCrawl]
  end
  subgraph fetchWebPost["fetchWebPost (add-post path)"]
    FA[fetchAdaptive]
  end
  FA --> FS[fetchStatic]
  FA -.fallback.-> FB[fetchBrowser]
  RES["resolveWebProxyUrl(process.env)"]
  RES -->|dispatcher| FS
  RES -->|launch proxy| FB
  RES -->|proxyConfiguration| RW
  RW -->|HTTP + browser sub-paths| NET[(target sites via proxy)]
  FS --> NET
  FB --> NET
```

```mermaid
sequenceDiagram
  participant C as collectWeb
  participant R as resolveWebProxyUrl
  participant Crawl as runWebCrawl
  participant Crawlee as AdaptivePlaywrightCrawler
  participant Site as Target site
  C->>Crawl: jobs, opts
  Crawl->>R: process.env.WEB_HTTP_PROXY
  R-->>Crawl: url | null
  alt url present
    Crawl->>Crawlee: options + ProxyConfiguration({proxyUrls:[url]})
  else null
    Crawl->>Crawlee: options (no proxy)
  end
  Crawlee->>Site: request via proxy (or direct)
  Site-->>Crawlee: HTML
```

## Approaches Considered

**Chosen: per-seam wiring with a shared resolver (D1–D5).** Each transport gets its native
proxy mechanism; one resolver normalises the env value.

**Why not a single global undici `setGlobalDispatcher`?** It would proxy unrelated worker
traffic (LLM SDKs, Resend, Slack) — wrong blast radius, and Crawlee/Playwright don't use the
undici global dispatcher anyway, so it wouldn't even cover seams 2 and 3. Rejected.

**Why not a separate proxy module/abstraction over all three?** The three transports share no
call shape (a `dispatcher` vs a `launch` option vs a `ProxyConfiguration` instance). A unifying
wrapper would be a premature abstraction over three one-line wirings. Hardcode each; share only
the resolver. (YAGNI.)

## External Dependencies & Fallback Chain

All three are **already installed** — no new dependency is introduced. The library-probe stage
must verify the exact proxy-wiring API for each against the installed version:

- **undici `ProxyAgent`** (`undici@7.24.7`) — for the static-fetch `dispatcher`. *Probe:* fetch a
  URL through the live proxy via `new ProxyAgent(url)` passed as `dispatcher`; assert egress IP
  differs from direct. *Maturity:* undici is the Node.js core HTTP client, actively maintained.
  *Fallback:* `https-proxy-agent` (add as dep) → build a minimal CONNECT tunnel (last resort).
- **playwright-core `chromium.launch({ proxy })`** (`playwright-core@1.52.0`) — for browser
  fetch. *Probe:* launch with proxy, navigate, assert page loads via proxy IP. *Maturity:*
  first-class Playwright feature, stable since 1.x. *Fallback:* set `HTTPS_PROXY` env for the
  chromium process → route browser fetch through the static path only (degraded).
- **crawlee `ProxyConfiguration`** (`crawlee@3.13.3`) — for the adaptive crawler. *Probe:* run a
  one-URL crawl with `proxyConfiguration`, assert it fetches through the proxy. *Maturity:*
  core Crawlee feature. *Fallback:* drop Crawlee's batch path to per-URL `fetchAdaptive` (already
  proxied via seams 1+2) — heavier but functional.

Auth surface for all probes: the proxy itself is `http-basic` embedded in the URL
(`<user>:<pass>@38.154.203.95:5863`). No project `.env.harness` key needed beyond the
proxy URL, which the probe reads from the task / `WEB_HTTP_PROXY`.

## Risks & Mitigations

- **R1 — Crawlee's `proxyConfiguration` may not cover the adaptive browser sub-path.** Mitigation:
  library-probe verifies E4 explicitly; if it doesn't, fallback is per-URL `fetchAdaptive`.
- **R2 — Proxy credential leaks into a log.** Mitigation: NF1 is a hard review-gate item; no log
  event gains a proxy field; the resolver never logs the value (E2 logs only "malformed",
  not the string).
- **R3 — Proxy adds latency / the proxy itself is down.** Mitigation: out of scope for this
  change (availability of the proxy is an ops concern); the existing per-request timeouts and
  `maxRequestRetries` already bound the blast radius. Fail-open on *config* errors only, not on
  proxy-runtime errors (those surface as normal fetch failures, same as a blocked site today).

## Assumptions

- The supplied proxy supports `http://` CONNECT tunnelling for HTTPS target sites (standard for
  this proxy class; verified by library-probe).
- `WEB_HTTP_PROXY` is the desired var name (symmetric with `REDDIT_HTTP_PROXY`); no existing
  consumer of that name exists (greppable: none today).

## What This Does NOT Do

- Does NOT proxy any other collector (Reddit already has its own; HN/Twitter/web-search are out
  of scope).
- Does NOT add proxy rotation, a proxy pool, health-checking, or per-request proxy selection
  (single static proxy URL; YAGNI — add when a second proxy is genuinely needed).
- Does NOT change the global worker dispatcher or proxy non-collector traffic (LLM, email, Slack).
- Does NOT make the proxy mandatory — unset = direct egress, current behaviour preserved.
- Does NOT log, persist, or surface the proxy URL anywhere.
```
