# Functional Verification Report — Reddit Proxy

**Spec:** `docs/spec/reddit-proxy/spec.md`
**Date:** 2026-05-07
**Environment:** Production VPS (AWS us-east-1, IP `54.196.200.246`), inside ephemeral `node:22-slim` container running the same `createProxyFetch` logic shipped in `packages/pipeline/src/lib/proxy-fetch.ts`.

## Method

A standalone ESM script (`reddit-proxy-verify.mjs`, archived alongside this report) reproduces verbatim the `createProxyFetch` function and exercises:

1. **Listing fetch:** `GET https://www.reddit.com/r/MachineLearning/top.json?t=day&limit=2`
2. **Comments fetch:** `GET https://www.reddit.com/r/MachineLearning/comments/<first_id>.json?limit=5`

Each test runs once with `REDDIT_HTTP_PROXY` unset, once with it set to the proxy URL. The script asserts `fetchFn === globalThis.fetch` to verify the unset path returns the unwrapped fetch (REQ-1) and the set path returns a wrapped fetch (REQ-2).

The script ran inside a fresh `node:22-slim` Docker container started with `--rm` so it left no state on the host. No host services were touched.

## Results

### VS-7a: Without proxy (control — REQ-1)

```json
{
  "label": "without_proxy",
  "sameAsGlobal": true,
  "listingStatus": 403,
  "listingBodyHead": "<body class=theme-beta><div><style>.theme-light,:root{--rem360:22.5rem;--rem320:20rem;--rem192:12rem;--rem144:9rem;--rem",
  "elapsedMs": 52
}
```

- `sameAsGlobal: true` ✅ — helper returns identity when env is unset (REQ-1).
- HTTP 403 with Cloudflare-style HTML challenge body confirms the VPS IP is blocked.

### VS-7b: With proxy (REQ-2 + REQ-3)

```json
{
  "label": "with_proxy",
  "sameAsGlobal": false,
  "listingStatus": 200,
  "listingItemCount": 2,
  "firstTitle": "Stop letting LLMs edit your .bib [D]",
  "commentsStatus": 200,
  "commentsCount": 4,
  "elapsedMs": 1195
}
```

- `sameAsGlobal: false` ✅ — helper returned a wrapped fetch (REQ-2).
- Listing endpoint returned 200 with 2 valid posts (REQ-3 e2e effect).
- Comments endpoint returned 200 with 4 parsed comments (full code path including post ID extraction).
- Total round-trip 1.2s — acceptable for batch collection.

## Verdict

**PASS.** All verification scenarios from spec.md satisfied:

| Scenario | Result |
|---|---|
| VS-1..4 (helper unit behavior) | ✅ pass — covered by `tests/unit/lib/proxy-fetch.test.ts` (4/4) |
| VS-5..6 (caller fetchFn wins) | ✅ pass — covered by `tests/unit/collectors/reddit-proxy-wiring.test.ts` (4/4) |
| VS-7a (no proxy → 403 from VPS) | ✅ pass — `listingStatus: 403`, `sameAsGlobal: true` |
| VS-7b (proxy → 200 from VPS) | ✅ pass — `listingStatus: 200`, 2 items + 4 comments fetched |

## Cleanup

- All temp files on the VPS deleted (`sudo rm -rf /tmp/verify /tmp/reddit-proxy-verify.mjs`).
- No services restarted, no config changed, no `docker exec` against running containers.
- The `node:22-slim` image is now cached on the VPS (~150 MB). Harmless; ignored.

## Caveats

- The verification ran the production `createProxyFetch` logic *inline* (copy of the source file), not by importing the built `@newsletter/pipeline` package. This is because the deployed image (`ea6ecb8...`) predates this change. Once the change is deployed, a quick smoke run of `collectReddit` against the same proxy in the deployed environment will provide end-to-end confirmation. The unit-test suite plus this functional probe gives high confidence the deployed code will behave identically.
- The proxy URL contains credentials and was passed only via `-e REDDIT_HTTP_PROXY=...` to a `--rm` container. No log line written to the VPS persistent storage contains the URL.
