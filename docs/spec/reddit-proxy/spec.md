# Reddit Collector — HTTP Proxy Support

## Problem

Reddit blocks all anonymous traffic from AWS datacenter IPs (the production VPS at `54.196.200.246`). Every public endpoint — `www.reddit.com`, `old.reddit.com`, `oauth.reddit.com` (anonymous), `*.json`, `.rss` — returns HTTP 403 with a Cloudflare-style challenge HTML page. From a residential IP the same requests return 200. The block is purely IP-reputation, not header- or path-based.

Empirical proof (research session, 2026-05-07): routing the existing anonymous-JSON requests through an HTTP proxy with a non-datacenter egress IP (`31.59.20.176`) returns 200 across all 7 default subreddits, comments endpoints, and 10 burst requests with no rate-limit pushback.

## Goal

Add **opt-in HTTP proxy support** to the Reddit collector. When `REDDIT_HTTP_PROXY` is set in the environment, all outbound Reddit requests (listing, comments, single-post) route through that proxy. When unset, behavior is unchanged.

Non-goals:
- Proxying any other collector (HN, web, Twitter)
- Switching to OAuth (separate, future ticket)
- Proxy rotation / fallback chains

## Requirements

- **REQ-1**: A helper `createProxyFetch(proxyUrl?: string)` returns the global `fetch` unchanged when `proxyUrl` is undefined / empty / whitespace-only.
- **REQ-2**: When `proxyUrl` is set to a valid http(s) URL with embedded credentials, the returned fetch routes requests through that proxy via `undici.ProxyAgent`.
- **REQ-3**: `collectReddit` reads `REDDIT_HTTP_PROXY` from the environment and uses the proxy-aware fetch for every listing and comments request.
- **REQ-4**: `fetchRedditPost` (add-post flow) reads `REDDIT_HTTP_PROXY` and uses the proxy-aware fetch for the single-post request.
- **REQ-5**: When the caller provides an explicit `fetchFn` in deps (test injection), that fetch is used as-is — the helper does not wrap it. Caller wins.
- **REQ-6**: `.env.example` documents `REDDIT_HTTP_PROXY` with a sanitized example value.
- **REQ-7**: The proxy URL (which contains credentials) is never logged. Logs may indicate "proxy enabled" / "proxy disabled" but never include the URL itself.

## Edge cases

- **EDGE-1**: `REDDIT_HTTP_PROXY=""` (empty string) — treat as unset, do not wrap fetch.
- **EDGE-2**: `REDDIT_HTTP_PROXY="   "` (whitespace) — treat as unset.
- **EDGE-3**: Malformed proxy URL — let `ProxyAgent` throw at first request (fail fast). Do not pre-validate.
- **EDGE-4**: Caller-supplied `fetchFn` overrides any env-derived proxy fetch (REQ-5). Existing tests continue to inject mock fetches without proxying.

## Verification scenarios

- **VS-1** (unit): `createProxyFetch(undefined)` returns the same function reference as `globalThis.fetch`.
- **VS-2** (unit): `createProxyFetch("")` returns the same function reference as `globalThis.fetch`.
- **VS-3** (unit): `createProxyFetch("   ")` returns the same function reference as `globalThis.fetch`.
- **VS-4** (unit): `createProxyFetch("http://user:pass@host:1234")` returns a function distinct from `globalThis.fetch`.
- **VS-5** (unit): `collectReddit` does not wrap a caller-supplied `fetchFn` (existing tests must continue to pass).
- **VS-6** (unit): `fetchRedditPost` does not wrap a caller-supplied `fetchFn`.
- **VS-7** (functional, VPS): Running the built pipeline on the VPS with `REDDIT_HTTP_PROXY` set, `collectReddit` returns ≥ 1 item from `r/MachineLearning` (HTTP 200, JSON parsed, `RawItemInsert[]` non-empty). Without the env var, the same call fails with 403.

## Out of scope

- OAuth migration
- Proxy retry / rotation
- Proxying other collectors
